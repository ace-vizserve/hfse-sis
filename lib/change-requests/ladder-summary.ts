// Pure and client-safe: no server-only, no database. The filing screen and the
// filing route both read a grade change's approval steps through this file, so
// the reason a screen gives for a disabled Submit is the same sentence the
// route answers with if the request is sent anyway.

import { joinNames } from '@/lib/approvals/readiness';
import type {
  ApprovalRule,
  ApproverLevelScope,
  GradeChangeApprovalFlow,
} from '@/lib/schemas/approval-flows';

/**
 * Where a grade change filed on one sheet would go — what the grading page
 * works out on the server and hands to the filing form. See
 * `lib/change-requests/filing-route.ts`.
 */
export type GradeChangeFilingRoute = {
  sectionFlow: GradeChangeApprovalFlow;
  flowByEntryId: Record<string, GradeChangeApprovalFlow>;
  /** `normal` is `markbook.grade_change`; `board` is the AEB flow. */
  steps: {
    normal: GradeChangeStepSummary[];
    board: GradeChangeStepSummary[];
  };
};

/** One configured step, as `loadConfiguredLadder` returns it. */
export type ConfiguredLadderStep = {
  label: string;
  resolver: 'named' | 'form_adviser';
  /** Migration 145. Missing reads as 'any'. */
  approval_rule?: ApprovalRule | null;
  approvers: Array<{
    userId: string;
    appliesToLevelType: ApproverLevelScope | null;
  }>;
};

/** One step as a teacher reads it before filing. */
export type GradeChangeStepSummary = {
  /** 1-based, in the order the steps run — not the configuration's numbers. */
  order: number;
  label: string;
  kind: 'named' | 'form_adviser';
  /**
   * Whether any one of the people approves the step, or all of them must
   * (migration 145). Optional so a summary built before the setting existed
   * reads as "any one".
   */
  approvalRule?: ApprovalRule;
  /**
   * Display names. Always empty for a form adviser step.
   *
   * ⚠ NEVER INCLUDES THE PERSON FILING. Nobody approves their own request, so
   * the request is opened with the filer left out of every step
   * (`excludeUserIds` on `openApprovalRequest`), and this list names exactly
   * the people who will be asked.
   */
  people: string[];
  /**
   * True when the filer was the ONLY person covering this step — so the step
   * is empty because of who is filing, not because the school forgot it.
   * The refusal says which.
   */
  onlyFiler?: boolean;
};

export const NO_STEPS_CONFIGURED_MESSAGE =
  'The approval steps for this kind of grade change have not been set up yet. Ask the superadmin to set them up in SIS Admin → Approvers.';

/**
 * The steps a request filed for this class would go through.
 *
 * ⚠ NUMBERED 1..n, exactly as `openApprovalRequest` numbers the ladder it
 * builds. A retired step leaves a gap in the configuration, and "step 3"
 * on this screen must be "step 3" in the approver's email.
 *
 * ⚠ A named step's people are ONLY those who cover this class's half of the
 * school (migration 128) — the same filter `poolForLevelType` applies when the
 * ladder is frozen. Showing the Secondary officer on a Primary class's request
 * would name somebody who will never be asked.
 */
export function summariseGradeChangeLadder(
  ladder: ConfiguredLadderStep[],
  levelType: ApproverLevelScope | null,
  nameById: ReadonlyMap<string, string>,
  opts: {
    /** Who is filing. Left off every step, the way the request is opened. */
    filerId?: string | null;
  } = {}
): GradeChangeStepSummary[] {
  const filerId = opts.filerId ?? null;
  return ladder.map((step, index) => {
    if (step.resolver === 'form_adviser') {
      return {
        order: index + 1,
        label: step.label,
        kind: 'form_adviser',
        people: [],
      };
    }
    const ids: string[] = [];
    for (const approver of step.approvers) {
      const covers =
        approver.appliesToLevelType === null ||
        approver.appliesToLevelType === levelType;
      if (covers && !ids.includes(approver.userId)) ids.push(approver.userId);
    }
    const others = filerId ? ids.filter((id) => id !== filerId) : ids;
    return {
      order: index + 1,
      label: step.label,
      kind: 'named',
      approvalRule: step.approval_rule ?? 'any',
      people: others.map((id) => nameById.get(id) ?? '(account removed)'),
      ...(others.length === 0 && ids.length > 0 ? { onlyFiler: true } : {}),
    };
  });
}

/**
 * Why a request for this class cannot be sent, in words a teacher can act on —
 * or null when it can.
 */
export function gradeChangeLadderProblem(
  steps: GradeChangeStepSummary[]
): string | null {
  if (steps.length === 0) return NO_STEPS_CONFIGURED_MESSAGE;
  const empty = steps.find((s) => s.kind === 'named' && s.people.length === 0);
  if (empty?.onlyFiler) {
    return `You're the only person on step ${empty.order} (${empty.label}), and you can't approve your own request. Ask the superadmin to add someone else.`;
  }
  if (empty) {
    return `Nobody is set up to approve step ${empty.order} (${empty.label}) for this class. Ask the superadmin to add someone in SIS Admin → Approvers.`;
  }
  return null;
}

/**
 * "Mr Gary or Ms Nina" — any one of a step's people can approve it. "Mr Gary
 * and Ms Nina" — the step needs all of them (migration 145). The same word the
 * approvers screen uses for the same step.
 */
export function stepPeopleLabel(step: GradeChangeStepSummary): string {
  if (step.kind === 'form_adviser') return 'Form class adviser';
  if (step.onlyFiler) return 'Nobody but you';
  if (step.people.length === 0) return 'Nobody set up yet';
  return joinNames(step.people, step.approvalRule === 'all' ? 'and' : 'or');
}
