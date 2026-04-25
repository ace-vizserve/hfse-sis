import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { computeQuarterly } from '@/lib/compute/quarterly';
import { buildAuditRows, writeAuditRows } from '@/lib/audit/log-grade-change';
import { logAction, type AuditAction } from '@/lib/audit/log-action';
import {
  CORRECTION_REASONS,
  CORRECTION_REASON_LABELS,
  type CorrectionReason,
} from '@/lib/schemas/change-request';
import { notifyRequestApplied } from '@/lib/notifications/email-change-request';
import { fetchApproverEmails, fetchLabels } from '@/app/api/change-requests/route';

// PATCH /api/grading-sheets/[id]/entries/[entryId]
// Rules (Sprint 9):
//   * Teachers: allowed only while the sheet is UNLOCKED. Post-lock → 403.
//   * Registrar/admin/superadmin: allowed always. Post-lock edits must include
//     EITHER a `change_request_id` (Path A — points at an approved request) OR
//     `correction_reason` + `correction_justification` (Path B — registrar-only
//     data entry fix). Free-text `approval_reference` is no longer accepted.
//   * Hard Rule #5 stays satisfied: approval_reference is still written to
//     grade_audit_log for every post-lock edit, but derived server-side from
//     the path taken.
//   * Score validation vs max and server-side compute are unchanged from S3.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const auth = await requireRole(['teacher', 'registrar', 'school_admin', 'admin', 'superadmin']);
  if ('error' in auth) return auth.error;
  const role = auth.role;

  const { id: sheetId, entryId } = await params;
  const body = (await request.json().catch(() => null)) as
    | {
        ww_scores?: (number | null)[];
        pt_scores?: (number | null)[];
        qa_score?: number | null;
        letter_grade?: string | null;
        is_na?: boolean;
        // Sprint 9 — post-lock edits must use exactly one of these branches.
        change_request_id?: string;
        correction_reason?: string;
        correction_justification?: string;
        patch_target?: {
          field: 'ww_scores' | 'pt_scores' | 'qa_score' | 'letter_grade' | 'is_na';
          slotIndex?: number | null;
        };
        // Rejected — legacy clients. Return a clear error if present.
        approval_reference?: string;
      }
    | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  if (body.approval_reference) {
    return NextResponse.json(
      {
        error:
          'approval_reference is no longer accepted — use change_request_id or correction_reason',
      },
      { status: 400 },
    );
  }

  const service = createServiceClient();

  const [sheetRes, entryRes] = await Promise.all([
    service
      .from('grading_sheets')
      .select(
        `id, ww_totals, pt_totals, qa_total, is_locked,
         subject:subjects(is_examinable),
         subject_config:subject_configs(ww_weight, pt_weight, qa_weight)`,
      )
      .eq('id', sheetId)
      .single(),
    service
      .from('grade_entries')
      .select('id, grading_sheet_id, ww_scores, pt_scores, qa_score, letter_grade, is_na')
      .eq('id', entryId)
      .single(),
  ]);

  if (sheetRes.error || !sheetRes.data) {
    return NextResponse.json({ error: 'sheet not found' }, { status: 404 });
  }
  if (entryRes.error || !entryRes.data) {
    return NextResponse.json({ error: 'entry not found' }, { status: 404 });
  }
  const sheet = sheetRes.data as unknown as {
    id: string;
    ww_totals: number[];
    pt_totals: number[];
    qa_total: number | null;
    is_locked: boolean;
    subject: { is_examinable: boolean } | { is_examinable: boolean }[] | null;
    subject_config:
      | { ww_weight: number; pt_weight: number; qa_weight: number }
      | { ww_weight: number; pt_weight: number; qa_weight: number }[]
      | null;
  };
  const entry = entryRes.data;
  if (entry.grading_sheet_id !== sheetId) {
    return NextResponse.json({ error: 'entry does not belong to sheet' }, { status: 400 });
  }

  // ----- Lock-gate (Sprint 9 two-path workflow) -----
  // Server-derived approval reference for grade_audit_log (Hard Rule #5).
  let approval_reference = '';
  // Path metadata for logging + post-save request state transitions.
  let appliedChangeRequest:
    | {
        id: string;
        grading_sheet_id: string;
        grade_entry_id: string;
        field_changed: string;
        slot_index: number | null;
        current_value: string | null;
        proposed_value: string;
        reason_category: string;
        justification: string;
        requested_by_email: string;
        requested_at: string;
        reviewed_by_email: string | null;
        decision_note: string | null;
      }
    | null = null;
  let correctionMeta: {
    reason: CorrectionReason;
    justification: string;
  } | null = null;

  if (sheet.is_locked) {
    if (role === 'teacher') {
      return NextResponse.json({ error: 'sheet is locked' }, { status: 403 });
    }
    const hasRequest = typeof body.change_request_id === 'string' && body.change_request_id.length > 0;
    const hasCorrection =
      typeof body.correction_reason === 'string' &&
      typeof body.correction_justification === 'string';
    if (hasRequest === hasCorrection) {
      return NextResponse.json(
        {
          error:
            'post-lock edits require exactly one of change_request_id or correction_reason',
        },
        { status: 400 },
      );
    }

    if (hasRequest) {
      // ----- Path A: apply an approved change request -----
      const { data: reqRow, error: reqErr } = await service
        .from('grade_change_requests')
        .select('*')
        .eq('id', body.change_request_id as string)
        .single();
      if (reqErr || !reqRow) {
        return NextResponse.json(
          { error: 'change request not found' },
          { status: 404 },
        );
      }
      if (reqRow.status !== 'approved') {
        return NextResponse.json(
          { error: `change request is in status "${reqRow.status}", not approved` },
          { status: 400 },
        );
      }
      if (reqRow.grading_sheet_id !== sheetId || reqRow.grade_entry_id !== entryId) {
        return NextResponse.json(
          { error: 'change request does not match this entry' },
          { status: 400 },
        );
      }
      // Target must line up with the request's field + slot.
      const target = body.patch_target;
      if (!target || target.field !== reqRow.field_changed) {
        return NextResponse.json(
          { error: 'patch_target field does not match approved request' },
          { status: 400 },
        );
      }
      if (
        (reqRow.field_changed === 'ww_scores' || reqRow.field_changed === 'pt_scores') &&
        (target.slotIndex ?? null) !== reqRow.slot_index
      ) {
        return NextResponse.json(
          { error: 'patch_target slot does not match approved request' },
          { status: 400 },
        );
      }

      // Verify the proposed value in the payload matches the request's proposed_value.
      const typedProposed = proposedFromPayload(body, reqRow.field_changed, reqRow.slot_index);
      if (typedProposed === undefined) {
        return NextResponse.json(
          { error: 'payload does not include the field being changed' },
          { status: 400 },
        );
      }
      if (String(typedProposed) !== String(reqRow.proposed_value)) {
        return NextResponse.json(
          {
            error: `typed value "${typedProposed}" does not match approved proposal "${reqRow.proposed_value}"`,
          },
          { status: 400 },
        );
      }

      appliedChangeRequest = reqRow;
      approval_reference = `Request #${reqRow.id.slice(0, 8)} approved by ${
        reqRow.reviewed_by_email ?? '(unknown)'
      } ${reqRow.reviewed_at ? new Date(reqRow.reviewed_at).toISOString().slice(0, 10) : ''}`.trim();
    } else {
      // ----- Path B: data entry correction -----
      const reason = body.correction_reason as string;
      if (!(CORRECTION_REASONS as readonly string[]).includes(reason)) {
        return NextResponse.json(
          { error: `invalid correction_reason "${reason}"` },
          { status: 400 },
        );
      }
      const justification = (body.correction_justification ?? '').trim();
      if (justification.length < 20) {
        return NextResponse.json(
          { error: 'correction_justification must be at least 20 characters' },
          { status: 400 },
        );
      }
      correctionMeta = {
        reason: reason as CorrectionReason,
        justification,
      };
      approval_reference = `Data entry correction: ${CORRECTION_REASON_LABELS[reason as CorrectionReason]}`;
    }
  }
  const changed_by = auth.user.email ?? auth.user.id;

  // Audit action taxonomy for post-save logging.
  const actionForAudit: AuditAction = !sheet.is_locked
    ? 'entry.update'
    : appliedChangeRequest
      ? 'grade_change_applied'
      : 'grade_correction';

  const subject = Array.isArray(sheet.subject) ? sheet.subject[0] : sheet.subject;
  const config = Array.isArray(sheet.subject_config) ? sheet.subject_config[0] : sheet.subject_config;

  // ----- Non-examinable: letter grade only -----
  if (subject && !subject.is_examinable) {
    const letter = body.letter_grade ?? null;
    if (letter != null && !['A', 'B', 'C', 'IP', 'UG', 'NA', 'INC', 'CO', 'E'].includes(letter)) {
      return NextResponse.json({ error: `invalid letter_grade "${letter}"` }, { status: 400 });
    }
    const { data: updated, error } = await service
      .from('grade_entries')
      .update({ letter_grade: letter, updated_at: new Date().toISOString() })
      .eq('id', entryId)
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const letterDiff = buildAuditRows(
      { letter_grade: entry.letter_grade as string | null },
      { letter_grade: letter },
      { grading_sheet_id: sheetId, grade_entry_id: entryId, changed_by, approval_reference },
    );
    if (letterDiff.length > 0) {
      if (sheet.is_locked) {
        await writeAuditRows(service, letterDiff);
      }
      for (const row of letterDiff) {
        await logAction({
          service,
          actor: { id: auth.user.id, email: auth.user.email ?? null },
          action: actionForAudit,
          entityType: sheet.is_locked && appliedChangeRequest ? 'grade_change_request' : 'grade_entry',
          entityId: sheet.is_locked && appliedChangeRequest ? appliedChangeRequest.id : entryId,
          context: {
            grading_sheet_id: sheetId,
            grade_entry_id: entryId,
            field: row.field_changed,
            old: row.old_value,
            new: row.new_value,
            was_locked: sheet.is_locked,
            ...(sheet.is_locked ? { approval_reference } : {}),
            ...(appliedChangeRequest ? { change_request_id: appliedChangeRequest.id } : {}),
            ...(correctionMeta
              ? { correction_reason: correctionMeta.reason, correction_justification: correctionMeta.justification }
              : {}),
          },
        });
      }
    }
    await finalizeChangeRequestPathA({
      appliedChangeRequest,
      actorUser: auth.user,
      sheetId,
      entryId,
      service,
    });
    return NextResponse.json({ entry: updated });
  }

  if (!config) {
    return NextResponse.json({ error: 'missing subject_config on sheet' }, { status: 500 });
  }

  // ----- Examinable: merge + validate vs max -----
  const merged = {
    ww_scores: body.ww_scores ?? (entry.ww_scores as (number | null)[]) ?? [],
    pt_scores: body.pt_scores ?? (entry.pt_scores as (number | null)[]) ?? [],
    qa_score:
      'qa_score' in body
        ? (body.qa_score ?? null)
        : (entry.qa_score as number | null | undefined) ?? null,
  };

  const normalizeArr = (arr: (number | null)[], length: number) => {
    const out: (number | null)[] = new Array(length).fill(null);
    for (let i = 0; i < Math.min(arr.length, length); i++) out[i] = arr[i] ?? null;
    return out;
  };
  const ww_scores = normalizeArr(merged.ww_scores, sheet.ww_totals.length);
  const pt_scores = normalizeArr(merged.pt_scores, sheet.pt_totals.length);
  const qa_score = merged.qa_score;

  for (let i = 0; i < ww_scores.length; i++) {
    const v = ww_scores[i];
    if (v != null && (v < 0 || v > sheet.ww_totals[i])) {
      return NextResponse.json(
        { error: `W${i + 1} score ${v} out of range [0, ${sheet.ww_totals[i]}]` },
        { status: 400 },
      );
    }
  }
  for (let i = 0; i < pt_scores.length; i++) {
    const v = pt_scores[i];
    if (v != null && (v < 0 || v > sheet.pt_totals[i])) {
      return NextResponse.json(
        { error: `PT${i + 1} score ${v} out of range [0, ${sheet.pt_totals[i]}]` },
        { status: 400 },
      );
    }
  }
  if (qa_score != null && sheet.qa_total != null) {
    if (qa_score < 0 || qa_score > sheet.qa_total) {
      return NextResponse.json(
        { error: `QA score ${qa_score} out of range [0, ${sheet.qa_total}]` },
        { status: 400 },
      );
    }
  }

  const is_na = 'is_na' in body ? Boolean(body.is_na) : Boolean(entry.is_na);

  const computed = computeQuarterly({
    ww_scores,
    ww_totals: sheet.ww_totals,
    pt_scores,
    pt_totals: sheet.pt_totals,
    qa_score,
    qa_total: sheet.qa_total,
    ww_weight: Number(config.ww_weight),
    pt_weight: Number(config.pt_weight),
    qa_weight: Number(config.qa_weight),
  });

  const { data: updated, error } = await service
    .from('grade_entries')
    .update({
      ww_scores,
      pt_scores,
      qa_score,
      is_na,
      ww_ps: computed.ww_ps,
      pt_ps: computed.pt_ps,
      qa_ps: computed.qa_ps,
      initial_grade: computed.initial_grade,
      quarterly_grade: computed.quarterly_grade,
      updated_at: new Date().toISOString(),
    })
    .eq('id', entryId)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit-log every changed field (pre-lock AND post-lock in the new
  // generic audit_log; still also write post-lock to grade_audit_log for
  // backward compat during the first term on the new system).
  const diffRows = buildAuditRows(
    {
      ww_scores: entry.ww_scores as (number | null)[] | null,
      pt_scores: entry.pt_scores as (number | null)[] | null,
      qa_score: entry.qa_score as number | null,
      is_na: entry.is_na as boolean,
    },
    { ww_scores, pt_scores, qa_score, is_na },
    { grading_sheet_id: sheetId, grade_entry_id: entryId, changed_by, approval_reference },
  );
  if (diffRows.length > 0) {
    if (sheet.is_locked) {
      await writeAuditRows(service, diffRows);
    }
    for (const row of diffRows) {
      await logAction({
        service,
        actor: { id: auth.user.id, email: auth.user.email ?? null },
        action: actionForAudit,
        entityType: sheet.is_locked && appliedChangeRequest ? 'grade_change_request' : 'grade_entry',
        entityId: sheet.is_locked && appliedChangeRequest ? appliedChangeRequest.id : entryId,
        context: {
          grading_sheet_id: sheetId,
          grade_entry_id: entryId,
          field: row.field_changed,
          old: row.old_value,
          new: row.new_value,
          was_locked: sheet.is_locked,
          ...(sheet.is_locked ? { approval_reference } : {}),
          ...(appliedChangeRequest ? { change_request_id: appliedChangeRequest.id } : {}),
          ...(correctionMeta
            ? { correction_reason: correctionMeta.reason, correction_justification: correctionMeta.justification }
            : {}),
        },
      });
    }
  }
  await finalizeChangeRequestPathA({
    appliedChangeRequest,
    actorUser: auth.user,
    sheetId,
    entryId,
    service,
  });

  return NextResponse.json({ entry: updated, computed });
}

// ------ helpers ------

// Extracts the proposed value a client is trying to save for a given field.
// Used by Path A to verify the typed value matches the approved request's
// proposed_value before flipping the request to applied.
function proposedFromPayload(
  body: {
    ww_scores?: (number | null)[];
    pt_scores?: (number | null)[];
    qa_score?: number | null;
    letter_grade?: string | null;
    is_na?: boolean;
  },
  field: string,
  slotIndex: number | null,
): string | number | boolean | null | undefined {
  switch (field) {
    case 'ww_scores':
      if (!Array.isArray(body.ww_scores) || slotIndex == null) return undefined;
      return body.ww_scores[slotIndex] ?? null;
    case 'pt_scores':
      if (!Array.isArray(body.pt_scores) || slotIndex == null) return undefined;
      return body.pt_scores[slotIndex] ?? null;
    case 'qa_score':
      return 'qa_score' in body ? (body.qa_score ?? null) : undefined;
    case 'letter_grade':
      return 'letter_grade' in body ? (body.letter_grade ?? null) : undefined;
    case 'is_na':
      return 'is_na' in body ? Boolean(body.is_na) : undefined;
    default:
      return undefined;
  }
}

// Side effects for Path A only — after a successful entry write, flip the
// change request to applied and fire an email to the teacher + approvers.
// Never throws; email failures are logged but non-fatal.
async function finalizeChangeRequestPathA(args: {
  appliedChangeRequest: {
    id: string;
    grading_sheet_id: string;
    grade_entry_id: string;
    field_changed: string;
    slot_index: number | null;
    current_value: string | null;
    proposed_value: string;
    reason_category: string;
    justification: string;
    requested_by_email: string;
    requested_at: string;
    reviewed_by_email: string | null;
    decision_note: string | null;
  } | null;
  actorUser: { id: string; email?: string | null };
  sheetId: string;
  entryId: string;
  service: ReturnType<typeof createServiceClient>;
}): Promise<void> {
  const { appliedChangeRequest, actorUser, sheetId, entryId, service } = args;
  if (!appliedChangeRequest) return;
  try {
    await service
      .from('grade_change_requests')
      .update({
        status: 'applied',
        applied_by: actorUser.id,
        applied_at: new Date().toISOString(),
      })
      .eq('id', appliedChangeRequest.id);

    // Fire the teacher/approver notification fire-and-forget.
    void (async () => {
      try {
        const [labels, approverEmails] = await Promise.all([
          fetchLabels(service, sheetId, entryId),
          fetchApproverEmails(service),
        ]);
        await notifyRequestApplied(
          {
            id: appliedChangeRequest.id,
            grading_sheet_id: appliedChangeRequest.grading_sheet_id,
            field_changed: appliedChangeRequest.field_changed,
            current_value: appliedChangeRequest.current_value,
            proposed_value: appliedChangeRequest.proposed_value,
            reason_category: appliedChangeRequest.reason_category,
            justification: appliedChangeRequest.justification,
            requested_by_email: appliedChangeRequest.requested_by_email,
            requested_at: appliedChangeRequest.requested_at,
            reviewed_by_email: appliedChangeRequest.reviewed_by_email,
            decision_note: appliedChangeRequest.decision_note,
            student_label: labels.student_label,
            sheet_label: labels.sheet_label,
          },
          appliedChangeRequest.requested_by_email,
          approverEmails,
        );
      } catch (e) {
        console.error('[change-requests] notify applied failed', e);
      }
    })();
  } catch (e) {
    console.error('[change-requests] flip-to-applied failed', e);
  }
}
