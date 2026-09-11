// ⚠ NO `import 'server-only'`, and that is deliberate rather than an omission.
// `scripts/repair-grade-change-approvals.ts` imports this and runs under tsx,
// where the `server-only` package throws outright — the same call
// `lib/approvals/materialise.ts` makes for the declarations repair script.
//
//   THIS IS SERVER CODE. Call it with the service-role client only.
//
// Bringing a grade change request's `status` back in line with a ladder that
// has already closed.
//
// ⚠ WHY THIS EXISTS. `approval_advance` and `approval_cancel` commit the
// decision on the engine first; the row the teacher watches is written after,
// as a separate statement. When that second write fails, the ladder is closed
// and the row still says `pending` — and nothing on the normal path can move
// it, because every later decision or withdrawal is answered `request_closed`.
// Two things read this file to finish the job:
//
//   - the teacher's Cancel (lib/change-requests/decide.ts), which meets the
//     closed ladder first and must not tell her "someone already decided it"
//     over a row that still reads as waiting;
//   - scripts/repair-grade-change-approvals.ts, for everything nobody touches.
//
// The patch is written from the ENGINE'S OWN RECORD of the decision — the step
// that carried it, who decided, when, and what they wrote — so a re-projection
// says what the decide route would have said at the time, not "fixed today by
// nobody".

import type { SupabaseClient } from '@supabase/supabase-js';

/** The three ways a ladder can finish. */
export type ClosedApprovalStatus = 'approved' | 'rejected' | 'cancelled';

export function isClosedApprovalStatus(
  value: unknown
): value is ClosedApprovalStatus {
  return value === 'approved' || value === 'rejected' || value === 'cancelled';
}

export type GradeChangeProjectionPatch =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; reason: 'no_decided_step' | 'failed'; message: string };

/**
 * What `grade_change_requests` should say for a ladder that closed as
 * `status`. Mirrors `gradeChangeApprovalHandler`'s patch column for column:
 *
 *   approved  → status, approved_at, reviewed_by / _email / _at, from the LAST
 *               step that approved (the one that finished the ladder)
 *   rejected  → status, reviewed_by / _email / _at and decision_note, from the
 *               step that turned it down
 *   cancelled → status alone; nobody on the ladder decided anything
 */
export async function buildGradeChangeProjectionPatch(
  service: SupabaseClient,
  approvalRequestId: string,
  status: ClosedApprovalStatus
): Promise<GradeChangeProjectionPatch> {
  if (status === 'cancelled') {
    return { ok: true, patch: { status: 'cancelled' } };
  }

  const { data, error } = await service
    .from('approval_request_stages')
    .select(
      'stage_order, status, decided_by, decided_by_email, decided_at, decision_note'
    )
    .eq('request_id', approvalRequestId)
    .eq('status', status)
    .order('stage_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return { ok: false, reason: 'failed', message: error.message };
  }
  const stage = data as {
    decided_by: string | null;
    decided_by_email: string | null;
    decided_at: string | null;
    decision_note: string | null;
  } | null;
  if (!stage || !stage.decided_at) {
    return {
      ok: false,
      reason: 'no_decided_step',
      message: `no ${status} step on approval request ${approvalRequestId}`,
    };
  }

  const patch: Record<string, unknown> = {
    status,
    reviewed_by: stage.decided_by,
    // The decide route writes '(unknown)' when the approver had no email.
    reviewed_by_email: stage.decided_by_email ?? '(unknown)',
    reviewed_at: stage.decided_at,
  };
  if (status === 'approved') patch.approved_at = stage.decided_at;
  else patch.decision_note = stage.decision_note;
  return { ok: true, patch };
}

export type GradeChangeReprojection =
  | { ok: true; status: ClosedApprovalStatus }
  | { ok: false; reason: 'row_moved_on' }
  | { ok: false; reason: 'no_decided_step' | 'failed'; message: string };

/**
 * Write the closed ladder's outcome onto a grade change request that still
 * reads `pending`.
 *
 * ⚠ PINNED TO `status = 'pending'`, exactly as the decide route's own write
 * is. A row that has already moved — the decide route's projection landed a
 * moment later after all, or the coordinator applied it — is left alone and
 * reported as `row_moved_on`, which is not a failure.
 */
export async function reprojectGradeChangeRequest(
  service: SupabaseClient,
  input: {
    gradeChangeRequestId: string;
    approvalRequestId: string;
    status: ClosedApprovalStatus;
  }
): Promise<GradeChangeReprojection> {
  const built = await buildGradeChangeProjectionPatch(
    service,
    input.approvalRequestId,
    input.status
  );
  if (!built.ok) return built;

  const { data, error } = await service
    .from('grade_change_requests')
    .update(built.patch)
    .eq('id', input.gradeChangeRequestId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, reason: 'failed', message: error.message };
  if (!data) return { ok: false, reason: 'row_moved_on' };
  return { ok: true, status: input.status };
}
