import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Role } from '@/lib/auth/roles';
import { countInboxActionableAcrossFlows } from '@/lib/approvals/inbox';
import {
  DECLARATION_APPROVAL_FLOW,
  type StagedApprovalFlow,
} from '@/lib/schemas/approval-flows';

/**
 * How many ordered-approval steps (KD #196), across the named flows, are
 * waiting for THIS person to decide — seeded on the server so the badge is
 * right on first paint rather than after a round trip.
 *
 * ⚠ "WAITING FOR ME TO DECIDE", NOT "OPEN". An academic coordinator can see
 * the whole school's queue but approves nobody's absence, so this returns 0 for
 * them. It is the same rule the "Waiting for you" panel on the Attendance index
 * already uses — deliberately, because a badge and a panel showing different
 * numbers for the same question is the bug the change-request flow shipped when
 * its scope was written out by hand in six places.
 *
 * ⚠ NEVER THROWS. Eight module layouts call this in their header. Before
 * migrations 126–129 are applied these tables do not exist, and a throw here
 * would blank every page in the module rather than one number in a header.
 */
export async function getStagedWaitingCount(
  service: SupabaseClient,
  role: Role,
  userId: string,
  flows: readonly StagedApprovalFlow[]
): Promise<number> {
  try {
    return await countInboxActionableAcrossFlows(service, {
      flows,
      userId,
      role,
    });
  } catch (e) {
    console.error(
      '[approvals] could not seed the waiting count:',
      flows.join(', '),
      e instanceof Error ? e.message : String(e)
    );
    return 0;
  }
}

/**
 * How many absence or travel declarations are waiting for THIS person to
 * decide. The declaration flow alone — see `getStagedWaitingCount` for the
 * rules, which are the same ones.
 */
export async function getDeclarationWaitingCount(
  service: SupabaseClient,
  role: Role,
  userId: string
): Promise<number> {
  return getStagedWaitingCount(service, role, userId, [
    DECLARATION_APPROVAL_FLOW,
  ]);
}
