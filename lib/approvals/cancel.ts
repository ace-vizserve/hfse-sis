import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ApprovalCancelOutcome } from '@/lib/schemas/approval-flows';

/**
 * Withdraw one open ordered approval (migration 144, `approval_cancel`).
 *
 * ⚠ THIS DOES NOT DECIDE WHO MAY CANCEL. The RPC knows nothing about the
 * subject, so the calling route checks that the caller is allowed to withdraw
 * it BEFORE calling this — for a grade change, the teacher who filed it.
 *
 * The RPC takes the same row lock as `approval_advance`, so a withdrawal that
 * loses the race to a decision comes back `request_closed` rather than
 * cancelling something already approved. The caller projects the outcome onto
 * its own subject and writes the audit row; this writes neither.
 *
 * Throws on a database error. Every answer the RPC can give is returned.
 */
export async function cancelApprovalRequest(
  service: SupabaseClient,
  requestId: string
): Promise<ApprovalCancelOutcome> {
  const { data, error } = await service.rpc('approval_cancel', {
    p_request_id: requestId,
  });
  if (error) throw new Error(`approval_cancel failed: ${error.message}`);

  // `returns table` comes back as an array of one row.
  const row = (Array.isArray(data) ? data[0] : data) as {
    outcome: ApprovalCancelOutcome;
  } | null;
  if (!row?.outcome) throw new Error('approval_cancel returned nothing');
  return row.outcome;
}
