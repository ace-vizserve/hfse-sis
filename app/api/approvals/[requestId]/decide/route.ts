import { NextResponse } from 'next/server';

import { requireCurrentAyCode } from '@/lib/academic-year';
import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { createServiceClient } from '@/lib/supabase/service';
import {
  DecideApprovalSchema,
  type ApprovalOutcome,
} from '@/lib/schemas/approval-flows';
import { APPROVAL_OUTCOME_MESSAGES } from '@/lib/approvals/state-machine';
import { DECLARATION_SUBJECT_TYPE } from '@/lib/declarations/approval';
import { writeRegisterForDeclaration } from '@/lib/declarations/register';

// POST /api/approvals/[requestId]/decide — approve or turn down one step.
//
// ── WHO MAY CALL THIS ──────────────────────────────────────────────────────
//
// Any signed-in member of staff. There is deliberately NO capability gate, and
// that is not laziness:
//
//   * the two people on this flow are a form class adviser and an officer in
//     charge, and they hold no capability in common — the officer holds no
//     grade capability at all, which is exactly why the existing approver
//     picker's eligibility rule was the wrong one to reuse;
//   * a new capability would be INERT until a matching `role_permissions` row
//     exists in the live database (KD #166), so shipping one would ship a
//     feature that silently does nothing until somebody remembers to run a
//     grant. Migration 120 declined to mint one for the same reason.
//
// THE STAGE POOL IS THE PERMISSION. `approval_advance` re-checks it inside the
// lock and refuses anybody who is not on the step — see migration 127. The role
// check here only keeps out people with no business in the app at all.

/** Only the fields the audit row describes — never the note's text. */
type DeclarationForAudit = {
  section_id: string;
  start_date: string;
  end_date: string;
  declaration_type: string;
  with_medical: boolean | null;
  parent_note: string | null;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { requestId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = DecideApprovalSchema.safeParse(body);
  if (!parsed.success) {
    // ⚠ Say WHICH rule failed. A missing rejection reason is a mistake a real
    // approver makes on a real screen, and "Choose approve or turn down" would
    // be nonsense advice to somebody who has already chosen. The generic line
    // stays as the fallback for a genuinely malformed body.
    const first = parsed.error.issues[0]?.message;
    return NextResponse.json(
      { error: first ?? 'Choose approve or turn down.' },
      { status: 400 }
    );
  }
  const { action, note } = parsed.data;
  const trimmedNote = note && note.length > 0 ? note : null;

  const service = createServiceClient();

  // Read the subject BEFORE deciding. Two reasons: the audit row describes the
  // filing, not the request id, and after the RPC the row we would want to
  // describe may already have moved on.
  const { data: requestRow, error: requestErr } = await service
    .from('approval_requests')
    .select('id, flow, subject_type, subject_id')
    .eq('id', requestId)
    .maybeSingle();
  if (requestErr) {
    console.error('[approvals] request read failed:', requestErr.message);
    return NextResponse.json(
      { error: 'Could not open that request. Please try again.' },
      { status: 500 }
    );
  }
  if (!requestRow) {
    return NextResponse.json(
      { error: APPROVAL_OUTCOME_MESSAGES.request_not_found },
      { status: 404 }
    );
  }
  const subject = requestRow as unknown as {
    flow: string;
    subject_type: string;
    subject_id: string;
  };

  const { data: rpcData, error: rpcError } = await service.rpc(
    'approval_advance',
    {
      p_request_id: requestId,
      p_actor: auth.user.id,
      p_actor_email: auth.user.email,
      p_action: action,
      p_note: trimmedNote,
    }
  );

  if (rpcError) {
    console.error('[approvals] approval_advance failed:', rpcError.message);
    return NextResponse.json(
      { error: 'Could not record that decision. Please try again.' },
      { status: 500 }
    );
  }

  // `returns table` comes back as an array of one row.
  const result = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as {
    outcome: ApprovalOutcome;
    request_status: string | null;
    decided_stage_order: number | null;
    next_stage_order: number | null;
  } | null;

  if (!result) {
    console.error('[approvals] approval_advance returned nothing');
    return NextResponse.json(
      { error: 'Could not record that decision. Please try again.' },
      { status: 500 }
    );
  }

  const decided =
    result.outcome === 'advanced' ||
    result.outcome === 'completed' ||
    result.outcome === 'rejected';

  if (!decided) {
    // ⚠ NONE OF THESE IS AN ERROR IN THE ORDINARY SENSE and the copy says so.
    // With several people on one step, being the second to click is the NORMAL
    // case. 409 rather than 500 because nothing went wrong — the world simply
    // moved while this screen was open.
    const status =
      result.outcome === 'not_authorised'
        ? 403
        : result.outcome === 'request_not_found'
          ? 404
          : 409;
    return NextResponse.json(
      {
        error: APPROVAL_OUTCOME_MESSAGES[result.outcome],
        outcome: result.outcome,
      },
      { status }
    );
  }

  // ── Project the outcome onto the subject ─────────────────────────────────
  //
  // The engine holds no key back to its consumer (migrations 125 and 126), so
  // the status a parent watches is refreshed here rather than by the RPC. It
  // moves ONLY when the whole ladder is finished: 'advanced' means one person
  // has said yes and the next has not, which to the parent is still "with the
  // school", because it is.
  let declarationRow: DeclarationForAudit | null = null;
  let registerDaysWritten: number | null = null;
  let registerDaysSkipped: number | null = null;
  let registerWriteError: string | null = null;

  if (subject.subject_type === DECLARATION_SUBJECT_TYPE) {
    const { data: declaration } = await service
      .from('student_declarations')
      .select(
        'section_id, start_date, end_date, declaration_type, with_medical, parent_note'
      )
      .eq('id', subject.subject_id)
      .maybeSingle();
    declarationRow = (declaration ?? null) as DeclarationForAudit | null;

    if (result.outcome === 'completed' || result.outcome === 'rejected') {
      const { error: projectErr } = await service
        .from('student_declarations')
        .update({
          status: result.outcome === 'completed' ? 'approved' : 'rejected',
          updated_at: new Date().toISOString(),
        })
        .eq('id', subject.subject_id);
      if (projectErr) {
        // The decision itself is recorded and correct; only the parent's copy
        // of it is stale. Say so plainly rather than pretend nothing happened —
        // and `scripts/repair-declaration-approvals.ts` reports the drift.
        console.error(
          '[approvals] declaration status projection failed:',
          projectErr.message
        );
        return NextResponse.json(
          {
            error:
              'The decision was recorded, but the parent may not see it yet. Tell an administrator.',
            outcome: result.outcome,
          },
          { status: 500 }
        );
      }
    }

    // ── The last approval marks the register ─────────────────────────────
    //
    // Mr Ace, 2026-08-27: "the attendance sheet is not showing that the filed
    // student has been excused based on the approval details." Every school
    // day of an approved absence becomes EX / 'mc'; every school day of
    // approved travel becomes EX / 'vacation' (Phase 4).
    //
    // ⚠ THIS CAN FAIL WITHOUT UN-DOING THE APPROVAL. The decision is already
    // committed in Postgres and two people have made it; throwing here would
    // report a landed decision as an error and invite the approver to click
    // again, which `approval_advance` would then refuse as already-decided.
    // So the failure is recorded on the filing, shown to staff, repairable by
    // script — and the response still says the approval succeeded.
    if (result.outcome === 'completed') {
      try {
        const write = await writeRegisterForDeclaration(
          service,
          subject.subject_id,
          auth.user.id
        );
        if (write.ok) {
          registerDaysWritten = write.written;
          registerDaysSkipped = write.skipped;
        } else {
          registerWriteError = write.error;
          console.error(
            '[approvals] register write failed:',
            subject.subject_id,
            write.error
          );
        }
      } catch (e) {
        registerWriteError = e instanceof Error ? e.message : String(e);
        console.error(
          '[approvals] register write threw:',
          subject.subject_id,
          registerWriteError
        );
      }
    }
  }

  // ── Audit ────────────────────────────────────────────────────────────────
  //
  // ⚠ NEITHER NOTE IS IN HERE. Not the parent's message and not the approver's
  // reason — only whether one was written. Migration 109 set the rule for
  // `ex_note` and 125/126 restate it: `audit_log` is readable by every
  // is_registrar_or_above() user, is append-only, and can never be corrected,
  // so a sentence about a child's illness put here would be permanent and seen
  // by more people than the absence itself.
  let sectionName: string | null = null;
  if (declarationRow?.section_id) {
    const { data: section } = await service
      .from('sections')
      .select('name')
      .eq('id', declarationRow.section_id)
      .maybeSingle();
    sectionName = (section as { name: string } | null)?.name ?? null;
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    action: action === 'approve' ? 'declaration.approve' : 'declaration.reject',
    entityType: 'student_declaration',
    entityId: subject.subject_id,
    context: {
      request_id: requestId,
      flow: subject.flow,
      outcome: result.outcome,
      stage_order: result.decided_stage_order,
      next_stage_order: result.next_stage_order,
      section_id: declarationRow?.section_id ?? null,
      section_name: sectionName,
      start_date: declarationRow?.start_date ?? null,
      end_date: declarationRow?.end_date ?? null,
      declaration_type: declarationRow?.declaration_type ?? null,
      with_medical: declarationRow?.with_medical ?? null,
      // Presence only, for both notes. See above.
      note_present: trimmedNote != null,
      parent_note_present: declarationRow?.parent_note != null,
      // How many register days the approval actually marked. A COUNT, not the
      // dates — the dates are on the filing, and the log is read by every
      // registrar-and-above user. Null when nothing was attempted (a
      // rejection, an intermediate stage, or a travel filing).
      register_days_written: registerDaysWritten,
      register_days_skipped: registerDaysSkipped,
      register_write_failed: registerWriteError != null,
    },
  });

  // The queue, the Attendance index panel and the drill cards all read this.
  //
  // ⚠ BOTH MODULES, not just attendance. The marks this approval just wrote
  // are read by the permanent record and the Academic Summary as well, and
  // busting one tag leaves the other showing an absence that has since been
  // excused.
  try {
    const ayCode = await requireCurrentAyCode(service);
    invalidateDrillTags('attendance', ayCode);
    invalidateDrillTags('records', ayCode);
  } catch (e) {
    // A missing current AY should not swallow a decision that already landed.
    console.error(
      '[approvals] cache invalidation skipped:',
      e instanceof Error ? e.message : String(e)
    );
  }

  return NextResponse.json({
    ok: true,
    outcome: result.outcome,
    // "Approved." on its own is now an understatement — the approval also
    // marked the register, and the person who clicked should be told what
    // landed on the sheet rather than having to go and look.
    message: decisionMessage(
      result.outcome,
      registerDaysWritten,
      registerWriteError
    ),
    requestStatus: result.request_status,
    nextStageOrder: result.next_stage_order,
    registerDaysWritten,
    registerWriteFailed: registerWriteError != null,
  });
}

/** What the approver reads after clicking. Plain sentences, no jargon. */
function decisionMessage(
  outcome: ApprovalOutcome,
  daysWritten: number | null,
  writeError: string | null
): string {
  const base = APPROVAL_OUTCOME_MESSAGES[outcome];
  if (outcome !== 'completed') return base;
  if (writeError) {
    return 'Approved. The attendance sheet could not be updated yet — tell an administrator.';
  }
  if (daysWritten == null) return base;
  if (daysWritten === 0) {
    // Filed across a weekend or a school holiday only. Not an error, and
    // saying "0 days" would read like one.
    return 'Approved. No school days fall inside those dates, so the attendance sheet is unchanged.';
  }
  return `Approved. ${daysWritten} ${daysWritten === 1 ? 'day' : 'days'} marked as excused on the attendance sheet.`;
}
