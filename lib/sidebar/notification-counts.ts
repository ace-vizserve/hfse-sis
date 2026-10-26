import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Role } from '@/lib/auth/roles';
import {
  countInboxActionableAcrossFlows,
  countInboxActionableByFlow,
} from '@/lib/approvals/inbox';
import { GRADE_CHANGE_FLOWS } from '@/lib/change-requests/staged-flows';
import {
  DECLARATION_APPROVAL_FLOW,
  SOW_APPROVAL_FLOW,
  type StagedApprovalFlow,
} from '@/lib/schemas/approval-flows';
import { BELL_STAGED_FLOWS } from '@/lib/sidebar/bell-flows';

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

export type BellStagedCounts = {
  /** Both grade-change flows — Markbook's change-request badge half. */
  gradeChange: number;
  /** The scheme-of-work flow — Classroom's "Schemes to review" badge. */
  sow: number;
  /** Everything in `BELL_STAGED_FLOWS` — the bell's seed. */
  total: number;
};

/**
 * Grade-change and scheme-of-work steps waiting for THIS person, in ONE read
 * (`BELL_STAGED_FLOWS`), split so a nav badge can show its own flow's share.
 *
 * ⚠ THIS REPLACED A GRADE-CHANGE-ONLY CALL IN EVERY LAYOUT, AND MUST STAY ONE
 * CALL. Counting the SOW flow separately would add a full inbox read to every
 * page for every user.
 *
 * ⚠ NEVER THROWS, for the reason `getStagedWaitingCount` gives.
 */
export async function getBellStagedCounts(
  service: SupabaseClient,
  role: Role,
  userId: string
): Promise<BellStagedCounts> {
  try {
    const byFlow = await countInboxActionableByFlow(service, {
      flows: BELL_STAGED_FLOWS,
      userId,
      role,
    });
    const gradeChange = GRADE_CHANGE_FLOWS.reduce(
      (n, f) => n + (byFlow[f] ?? 0),
      0
    );
    const sow = byFlow[SOW_APPROVAL_FLOW] ?? 0;
    return { gradeChange, sow, total: gradeChange + sow };
  } catch (e) {
    console.error(
      '[approvals] could not seed the waiting count:',
      BELL_STAGED_FLOWS.join(', '),
      e instanceof Error ? e.message : String(e)
    );
    return { gradeChange: 0, sow: 0, total: 0 };
  }
}
