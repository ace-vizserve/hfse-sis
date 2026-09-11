// No `import 'server-only'`: the sidebar badge, the notification bell and the
// two change-request tables are client components, and they read these.

import type { ApprovalRailStage } from '@/lib/approvals/rail';
import {
  GRADE_CHANGE_AEB_APPROVAL_FLOW,
  GRADE_CHANGE_APPROVAL_FLOW,
  type ApprovalRequestStatus,
  type GradeChangeApprovalFlow,
} from '@/lib/schemas/approval-flows';

/**
 * Both grade-change flows (migration 144), named once for everything that
 * counts or lists them together.
 *
 * ⚠ A MODULE CONSTANT, NOT AN INLINE `[...]` AT EACH CALL SITE. The live count
 * hook keys its subscription on the list's content, and every caller passing
 * the same frozen tuple keeps that trivially stable.
 */
export const GRADE_CHANGE_FLOWS: readonly GradeChangeApprovalFlow[] = [
  GRADE_CHANGE_APPROVAL_FLOW,
  GRADE_CHANGE_AEB_APPROVAL_FLOW,
] as const;

export function isGradeChangeFlow(
  value: string | null | undefined
): value is GradeChangeApprovalFlow {
  return (
    value === GRADE_CHANGE_APPROVAL_FLOW ||
    value === GRADE_CHANGE_AEB_APPROVAL_FLOW
  );
}

/**
 * The route a request took, as the school says it. Short on purpose — this
 * sits on a table row beside the child's name, not in a settings screen, where
 * the longer `STAGED_FLOW_LABELS` belong.
 */
export const GRADE_CHANGE_ROUTE_LABELS: Record<
  GradeChangeApprovalFlow,
  string
> = {
  'markbook.grade_change': 'Before publication',
  'markbook.grade_change_aeb': 'Academic and Examination Board',
};

/**
 * One step as the tables carry it: what the rail draws, plus WHO decided it —
 * the History timeline names the decider "You" when it is the reader, which
 * needs the id, not only the name. The pool of people who MAY decide stays on
 * the server; only names reach the browser (`peopleByStageOrder`).
 */
export type StagedGradeChangeStage = ApprovalRailStage & {
  decidedBy: string | null;
  decidedByEmail: string | null;
};

/**
 * A grade change that is decided step by step, as the tables render it.
 * Built on the server (lib/change-requests/staged-scope.ts) and passed down
 * whole, so no client component ever reads a pool of account ids.
 *
 * `null` on a row means the request predates migration 144 and still runs on
 * the two named approvers — every legacy affordance applies to it unchanged.
 */
export type StagedGradeChangeView = {
  /** `approval_requests.id` — what the decide route takes. */
  approvalRequestId: string;
  flow: GradeChangeApprovalFlow;
  routeLabel: string;
  requestStatus: ApprovalRequestStatus;
  currentStageOrder: number;
  stages: StagedGradeChangeStage[];
  /** Step number → the names of whoever may decide it. */
  peopleByStageOrder: Record<number, string>;
  /** Step number → the name of whoever did decide it. */
  decidedByNames: Record<number, string>;
  /** Whether THIS viewer may decide the step that is live now. */
  canDecide: boolean;
  /**
   * THIS viewer has already approved the live step, and it needs everyone, so
   * it is still waiting on the others (migration 145). The one state where a
   * row shows neither the buttons nor "not yours". Added by the page from the
   * ladder (`viewerApprovedLiveStep`, lib/approvals/rail.ts); absent reads as
   * false.
   */
  viewerApprovedWaiting?: boolean;
};
