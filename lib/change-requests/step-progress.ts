// No `import 'server-only'`: pure. Called from the two change-request pages
// (server components) with names already resolved.

import {
  viewerApprovedLiveStep,
  withApprovalProgress,
  type LadderStageProgress,
} from '@/lib/approvals/rail';
import type { ApprovalRequestStatus } from '@/lib/schemas/approval-flows';
import type { StagedGradeChangeView } from '@/lib/change-requests/staged-flows';

/**
 * A grade change's table view, with what an "Everyone must approve" step
 * (migration 145) adds to it: each step's setting, a tick per person on a step
 * that needs everyone, and whether THIS viewer has already approved the step
 * that is still waiting.
 *
 * ⚠ LAYERED ON AFTER `toStagedGradeChangeView`, not folded into it, so the view
 * builder stays about who may decide and this stays about how far a step has
 * got. Both read the same ladder.
 *
 * ⚠ `canDecide` IS TURNED OFF HERE TOO when the viewer has already approved.
 * The engine refuses a second approval (`already_approved`), so a button that
 * offered one would be a button that fails.
 */
export function withStepProgress(
  view: StagedGradeChangeView | null,
  ladder: {
    status: ApprovalRequestStatus;
    stages: readonly LadderStageProgress[];
  },
  viewerId: string,
  nameById: ReadonlyMap<string, string>
): StagedGradeChangeView | null {
  if (!view) return null;
  const viewerApprovedWaiting = viewerApprovedLiveStep(ladder, viewerId);
  return {
    ...view,
    stages: withApprovalProgress(view.stages, ladder.stages, nameById),
    canDecide: view.canDecide && !viewerApprovedWaiting,
    viewerApprovedWaiting,
  };
}
