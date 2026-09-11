import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getStaffDisplayNameById } from '@/lib/auth/staff-list';
import { loadLevelTypesBySection } from '@/lib/approvals/level-types';
import { loadConfiguredLadder } from '@/lib/approvals/materialise';
import { resolveGradeChangeFlowsForSheet } from '@/lib/change-requests/approval-route';
import {
  summariseGradeChangeLadder,
  type GradeChangeFilingRoute,
} from '@/lib/change-requests/ladder-summary';
import {
  GRADE_CHANGE_AEB_APPROVAL_FLOW,
  GRADE_CHANGE_APPROVAL_FLOW,
} from '@/lib/schemas/approval-flows';

export type { GradeChangeFilingRoute };

/**
 * Where a grade change filed on this sheet would go, worked out before the
 * teacher presses Submit — so the form can name the people rather than have
 * the teacher pick them, and refuse up front when a step has nobody.
 *
 * ⚠ BOTH SETS OF STEPS ARE LOADED, not just the one this class needs. The
 * route is decided per CHILD: a child who moved in may have had a report card
 * published in the class they left, which sends their change to the Academic
 * and Examination Board while their classmates' go to the ordinary approvers.
 * The form switches between the two as the teacher picks a student.
 *
 * The filing route re-decides all of this from scratch when the request is
 * sent. This is what the screen shows, not what the server trusts.
 */
export async function loadGradeChangeFilingRoute(
  service: SupabaseClient,
  opts: {
    gradingSheetId: string;
    sectionId: string;
    /**
     * The person looking at the form — who would be filing. Left off every
     * step, exactly as the filing route leaves them off, so a teacher who is
     * the only person on a step is told why Submit is off.
     */
    filerId: string | null;
  }
): Promise<GradeChangeFilingRoute> {
  const [flows, levelTypes, normalLadder, boardLadder, nameEntries] =
    await Promise.all([
      resolveGradeChangeFlowsForSheet(service, {
        gradingSheetId: opts.gradingSheetId,
      }),
      loadLevelTypesBySection(service, [opts.sectionId]),
      loadConfiguredLadder(service, GRADE_CHANGE_APPROVAL_FLOW),
      loadConfiguredLadder(service, GRADE_CHANGE_AEB_APPROVAL_FLOW),
      getStaffDisplayNameById(),
    ]);

  const levelType = levelTypes.get(opts.sectionId) ?? null;
  const names = new Map(nameEntries);
  const summaryOpts = { filerId: opts.filerId };

  return {
    sectionFlow: flows.sectionFlow,
    flowByEntryId: flows.flowByEntryId,
    steps: {
      normal: summariseGradeChangeLadder(
        normalLadder,
        levelType,
        names,
        summaryOpts
      ),
      board: summariseGradeChangeLadder(
        boardLadder,
        levelType,
        names,
        summaryOpts
      ),
    },
  };
}
