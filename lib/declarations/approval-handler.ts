import 'server-only';

import { requireCurrentAyCode } from '@/lib/academic-year';
import { logAction } from '@/lib/audit/log-action';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import type { ApprovalOutcome } from '@/lib/schemas/approval-flows';
import { APPROVAL_OUTCOME_MESSAGES } from '@/lib/approvals/state-machine';
import type {
  SubjectHandler,
  SubjectHandlerContext,
  SubjectHandlerResult,
} from '@/lib/approvals/decide';
import { writeRegisterForDeclaration } from '@/lib/declarations/register';

// What happens to an absence or travel declaration once one of its approval
// steps has been decided. Registered in `lib/approvals/decide.ts` under
// `student_declaration`; the pipeline there has already committed the decision
// before this runs.
//
// ⚠ `server-only` IS FINE HERE, unlike `approval.ts` and `register.ts` beside
// it: no script imports this file — it busts Next's cache, which a script has
// no business doing.

/** Only the fields the audit row describes — never the note's text. */
type DeclarationForAudit = {
  section_id: string;
  start_date: string;
  end_date: string;
  declaration_type: string;
  with_medical: boolean | null;
  parent_note: string | null;
};

export const declarationApprovalHandler: SubjectHandler = async (
  ctx: SubjectHandlerContext
): Promise<SubjectHandlerResult> => {
  const { service, actor, requestId, flow, subjectId, action, outcome } = ctx;

  // ── Project the outcome onto the subject ─────────────────────────────────
  //
  // The engine holds no key back to its consumer (migrations 125 and 126), so
  // the status a parent watches is refreshed here rather than by the RPC. It
  // moves ONLY when the whole ladder is finished: 'advanced' means one person
  // has said yes and the next has not, which to the parent is still "with the
  // school", because it is. 'recorded' (migration 145) — one yes on a step
  // that needs everyone — moves nothing and marks nothing; it is audited below
  // and nothing else.
  let declarationRow: DeclarationForAudit | null = null;
  let registerDaysWritten: number | null = null;
  let registerDaysSkipped: number | null = null;
  let registerWriteError: string | null = null;

  const { data: declaration } = await service
    .from('student_declarations')
    .select(
      'section_id, start_date, end_date, declaration_type, with_medical, parent_note'
    )
    .eq('id', subjectId)
    .maybeSingle();
  declarationRow = (declaration ?? null) as DeclarationForAudit | null;

  if (outcome === 'completed' || outcome === 'rejected') {
    const { error: projectErr } = await service
      .from('student_declarations')
      .update({
        status: outcome === 'completed' ? 'approved' : 'rejected',
        updated_at: new Date().toISOString(),
      })
      .eq('id', subjectId);
    if (projectErr) {
      // The decision itself is recorded and correct; only the parent's copy
      // of it is stale. Say so plainly rather than pretend nothing happened —
      // and `scripts/repair-declaration-approvals.ts` reports the drift.
      console.error(
        '[approvals] declaration status projection failed:',
        projectErr.message
      );
      return {
        ok: false,
        status: 500,
        body: {
          error:
            'The decision was recorded, but the parent may not see it yet. Tell an administrator.',
          outcome,
        },
      };
    }
  }

  // ── The last approval marks the register ─────────────────────────────────
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
  if (outcome === 'completed') {
    try {
      const write = await writeRegisterForDeclaration(
        service,
        subjectId,
        actor.id
      );
      if (write.ok) {
        registerDaysWritten = write.written;
        registerDaysSkipped = write.skipped;
      } else {
        registerWriteError = write.error;
        console.error(
          '[approvals] register write failed:',
          subjectId,
          write.error
        );
      }
    } catch (e) {
      registerWriteError = e instanceof Error ? e.message : String(e);
      console.error(
        '[approvals] register write threw:',
        subjectId,
        registerWriteError
      );
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
    actor: { id: actor.id, email: actor.email, role: actor.role },
    action: action === 'approve' ? 'declaration.approve' : 'declaration.reject',
    entityType: 'student_declaration',
    entityId: subjectId,
    context: {
      request_id: requestId,
      flow,
      outcome,
      stage_order: ctx.decidedStageOrder,
      next_stage_order: ctx.nextStageOrder,
      section_id: declarationRow?.section_id ?? null,
      section_name: sectionName,
      start_date: declarationRow?.start_date ?? null,
      end_date: declarationRow?.end_date ?? null,
      declaration_type: declarationRow?.declaration_type ?? null,
      with_medical: declarationRow?.with_medical ?? null,
      // Presence only, for both notes. See above.
      note_present: ctx.note != null,
      parent_note_present: declarationRow?.parent_note != null,
      // How many register days the approval actually marked. A COUNT, not the
      // dates — the dates are on the filing, and the log is read by every
      // registrar-and-above user. Null when nothing was attempted (a
      // rejection, an intermediate stage, or a travel filing).
      register_days_written: registerDaysWritten,
      register_days_skipped: registerDaysSkipped,
      register_write_failed: registerWriteError != null,
      // Which door the decision came through — the screen or an email link.
      via: ctx.via,
      // ⚠ NOBODY CLICKED ON `via: 'repoint'`. The actor is the admin whose
      // change to the step's people or rule let it finish, not an approver,
      // so the row says so and names the approval the step closed on — a staff
      // email, not anything about the child. The register write above keeps
      // the admin as its author: they are who set it moving.
      ...(ctx.via === 'repoint'
        ? {
            closed_by_step_edit: true,
            final_approver_email: ctx.closedStepApprover?.email ?? null,
          }
        : {}),
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

  return {
    ok: true,
    // "Approved." on its own is now an understatement — the approval also
    // marked the register, and the person who clicked should be told what
    // landed on the sheet rather than having to go and look.
    message: decisionMessage(outcome, registerDaysWritten, registerWriteError),
    extra: {
      registerDaysWritten,
      registerWriteFailed: registerWriteError != null,
    },
  };
};

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
