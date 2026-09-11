import type {
  ApprovalOutcome,
  ApprovalReevaluateOutcome,
  ApprovalRepointOutcome,
  ApprovalRequestStatus,
  ApprovalResolver,
  ApprovalRule,
  ApprovalStageStatus,
} from '@/lib/schemas/approval-flows';

/**
 * The approval rules, as a pure function.
 *
 * ⚠ THIS IS WRITTEN TWICE ON PURPOSE — here and in the database's
 * `approval_advance` (migration 127, rewritten by 145) — and
 * `__tests__/approvals/state-machine-parity.test.ts` pins the two together.
 *
 * The reason is the same one migration 123 wrote down for `relief_is_live` and
 * `isReliefLive`: the SQL is the one that actually decides, because it holds
 * the lock, but a rule that exists only inside a SECURITY DEFINER function is
 * a rule nobody can read, test at speed, or preview in a UI. This copy is what
 * lets the queue say "you can decide this" before anybody clicks, and what
 * makes the branch table testable without a database.
 *
 * ⚠ Where they must never disagree is the ORDER of the checks. Both ask, in
 * this sequence: does the request exist → is it still open → is the current
 * stage really pending → may this person act → have they already approved it.
 * Reordering the middle two would tell somebody they are not authorised when
 * the truth is that a colleague got there first, which is the difference
 * between "you may not" and "you needn't".
 */

export type StageSnapshot = {
  stageOrder: number;
  resolver: ApprovalResolver;
  status: ApprovalStageStatus;
  /** Frozen people, for a `named` stage. Empty for a derived one. */
  approverPool: string[];
  /** The section to resolve against, for a `form_adviser` stage. */
  sectionId: string | null;
  /**
   * Migration 145. Omitted reads as 'any' — first to act carries the step —
   * which is what every step was before the rule existed.
   */
  approvalRule?: ApprovalRule;
  /**
   * Who has already said yes to this step (migration 145's decisions table).
   * Only ever non-empty on a pending 'all' step or a closed one. Omitted reads
   * as nobody.
   */
  approvedBy?: readonly string[];
};

export type RequestSnapshot = {
  status: ApprovalRequestStatus;
  currentStageOrder: number;
  stages: StageSnapshot[];
};

export type ApprovalAction = 'approve' | 'reject';

/**
 * Who is acting, and — for a derived stage — a way to ask whether they advise a
 * given section.
 *
 * The predicate is injected rather than looked up, which is what keeps this
 * function pure. Its real implementation is `resolveAdviserPool` in
 * `./resolve.ts`; the database's own copy is `is_section_adviser(section, user)`.
 */
export type ApprovalActor = {
  userId: string;
  advisesSection: (sectionId: string) => boolean;
};

export type AdvanceResult = {
  outcome: ApprovalOutcome;
  requestStatus: ApprovalRequestStatus | null;
  decidedStageOrder: number | null;
  nextStageOrder: number | null;
};

export type ReevaluateResult = Omit<AdvanceResult, 'outcome'> & {
  outcome: ApprovalReevaluateOutcome;
};

/** The stage a request is sitting on, or null if it is closed or malformed. */
export function currentStage(
  request: RequestSnapshot | null | undefined
): StageSnapshot | null {
  if (!request) return null;
  return (
    request.stages.find((s) => s.stageOrder === request.currentStageOrder) ??
    null
  );
}

/** The step's rule, with a missing one read as 'any'. */
export function ruleOf(
  stage: Pick<StageSnapshot, 'approvalRule'>
): ApprovalRule {
  return stage.approvalRule ?? 'any';
}

/**
 * Has this person already said yes to an 'all' step?
 *
 * Always false on an 'any' step: one yes closes an 'any' step, so there is
 * never a yes on a pending one to find.
 */
export function hasApprovedStep(stage: StageSnapshot, userId: string): boolean {
  return ruleOf(stage) === 'all' && (stage.approvedBy ?? []).includes(userId);
}

/**
 * Does every person on this step have a yes on record?
 *
 * ⚠ AN EMPTY POOL IS NEVER "EVERYONE". `[].every(...)` is true, and a step
 * with nobody on it must stall visibly rather than slide through — migration
 * 145's `approval_step_everyone_approved` asks the same `cardinality > 0`.
 */
export function everyoneApproved(
  pool: readonly string[],
  approvedBy: readonly string[]
): boolean {
  if (pool.length === 0) return false;
  const yes = new Set(approvedBy);
  return pool.every((id) => yes.has(id));
}

/**
 * May this person decide this request right now?
 *
 * Used by the queue to decide whether to render the buttons at all — a screen
 * that offers an action it will then refuse is worse than one that explains.
 * The database re-checks the same thing before it writes anything.
 *
 * ⚠ FALSE FOR SOMEBODY WHO HAS ALREADY APPROVED AN 'all' STEP. They are still
 * on it, and it is still waiting — but not on them.
 */
export function canActOn(
  request: RequestSnapshot | null | undefined,
  actor: ApprovalActor
): boolean {
  if (!request || request.status !== 'pending') return false;
  const stage = currentStage(request);
  if (!stage || stage.status !== 'pending') return false;
  if (!stageAllows(stage, actor)) return false;
  return !hasApprovedStep(stage, actor.userId);
}

/** The pool test for one stage. Frozen list, or live adviser lookup. */
export function stageAllows(
  stage: StageSnapshot,
  actor: ApprovalActor
): boolean {
  if (stage.resolver === 'named') {
    return stage.approverPool.includes(actor.userId);
  }
  return stage.sectionId != null && actor.advisesSection(stage.sectionId);
}

/**
 * What one decision does. Mirrors `approval_advance` branch for branch.
 *
 * It returns the OUTCOME rather than a mutated snapshot: nothing here writes,
 * and the caller that does write is the RPC, not this.
 */
export function advanceApproval(
  request: RequestSnapshot | null | undefined,
  action: ApprovalAction,
  actor: ApprovalActor
): AdvanceResult {
  const closed = (outcome: ApprovalOutcome): AdvanceResult => ({
    outcome,
    requestStatus: request?.status ?? null,
    decidedStageOrder: null,
    nextStageOrder: null,
  });

  if (!request) return closed('request_not_found');
  if (request.status !== 'pending') return closed('request_closed');

  const stage = currentStage(request);
  if (!stage || stage.status !== 'pending') {
    return closed('stage_already_decided');
  }

  if (!stageAllows(stage, actor)) return closed('not_authorised');

  // ⚠ AFTER authorisation, and for approve AND reject: somebody who has said
  // yes to an 'all' step has decided their part of it.
  if (hasApprovedStep(stage, actor.userId)) return closed('already_approved');

  if (action === 'reject') {
    // One no ends the whole request, on either rule. Later stages stay
    // `waiting` rather than being marked skipped — the ladder should read as
    // "it never got there", because it never did.
    return {
      outcome: 'rejected',
      requestStatus: 'rejected',
      decidedStageOrder: stage.stageOrder,
      nextStageOrder: null,
    };
  }

  if (ruleOf(stage) === 'all') {
    const approvals = [...(stage.approvedBy ?? []), actor.userId];
    if (!everyoneApproved(stage.approverPool, approvals)) {
      // The yes is kept; the step has not moved.
      return {
        outcome: 'recorded',
        requestStatus: 'pending',
        decidedStageOrder: stage.stageOrder,
        nextStageOrder: null,
      };
    }
  }

  return closeAndAdvance(request, stage);
}

/**
 * What `approval_reevaluate_stage` does after the people on a step change.
 *
 * Only the live 'all' step of an open request can move, and only when its
 * (non-empty) pool now has a yes from everyone — which happens when the one
 * person still to approve is taken off the step.
 */
export function reevaluateStage(
  request: RequestSnapshot | null | undefined,
  stageOrder: number
): ReevaluateResult {
  const unchanged: ReevaluateResult = {
    outcome: 'unchanged',
    requestStatus: request?.status ?? null,
    decidedStageOrder: null,
    nextStageOrder: null,
  };
  if (!request || request.status !== 'pending') return unchanged;
  const stage = currentStage(request);
  if (
    !stage ||
    stage.stageOrder !== stageOrder ||
    stage.status !== 'pending' ||
    stage.resolver !== 'named' ||
    ruleOf(stage) !== 'all' ||
    !everyoneApproved(stage.approverPool, stage.approvedBy ?? [])
  ) {
    return unchanged;
  }
  return closeAndAdvance(request, stage);
}

export type RepointResult = Omit<AdvanceResult, 'outcome'> & {
  outcome: ApprovalRepointOutcome;
  /**
   * Whose name the step closes in, when it closes — null otherwise. Read from
   * `approvedBy`, which is oldest first (the order `loadStepDecisions` returns).
   */
  closedBy: string | null;
};

/**
 * What `approval_repoint_request_stage` (migration 146) does to one in-flight
 * step when the school changes its people or its rule.
 *
 * ⚠ THE RULE REACHES THE LIVE STEP, and each direction is safe for its own
 * reason. Tightening 'any' to 'all' cannot close anything: a pending 'any'
 * step has no approvals, because the first yes closes it. Relaxing 'all' to
 * 'any' closes a step somebody still on it has already approved, in the name
 * of the EARLIEST of them — the yes that would have carried it had the step
 * been 'any' all along. 'all' keeps approval_reevaluate_stage's choice: the
 * LATEST approver.
 */
export function repointStage(
  request: RequestSnapshot | null | undefined,
  stageOrder: number,
  pool: readonly string[],
  rule: ApprovalRule
): RepointResult {
  const result = (outcome: 'unchanged' | 'skipped'): RepointResult => ({
    outcome,
    requestStatus: request?.status ?? null,
    decidedStageOrder: null,
    nextStageOrder: null,
    closedBy: null,
  });

  if (!request || request.status !== 'pending') return result('skipped');
  const found = request.stages.find((s) => s.stageOrder === stageOrder);
  if (!found || (found.status !== 'waiting' && found.status !== 'pending')) {
    return result('skipped');
  }

  // A derived step holds no pool and can only be 'any'.
  const named = found.resolver === 'named';
  const stage: StageSnapshot = {
    ...found,
    approverPool: named ? [...pool] : found.approverPool,
    approvalRule: named ? rule : 'any',
  };

  if (
    stage.status !== 'pending' ||
    stage.stageOrder !== request.currentStageOrder ||
    !named
  ) {
    return result('unchanged');
  }

  const approvedOnStep = (stage.approvedBy ?? []).filter((id) =>
    stage.approverPool.includes(id)
  );

  let closedBy: string | null = null;
  if (ruleOf(stage) === 'all') {
    if (!everyoneApproved(stage.approverPool, stage.approvedBy ?? [])) {
      return result('unchanged');
    }
    closedBy = approvedOnStep[approvedOnStep.length - 1] ?? null;
  } else {
    closedBy = approvedOnStep[0] ?? null;
  }
  if (closedBy === null) return result('unchanged');

  return { ...closeAndAdvance(request, stage), closedBy };
}

function closeAndAdvance(
  request: RequestSnapshot,
  stage: StageSnapshot
): AdvanceResult & { outcome: 'advanced' | 'completed' } {
  const next = request.stages
    .filter((s) => s.status === 'waiting' && s.stageOrder > stage.stageOrder)
    .reduce<
      number | null
    >((lowest, s) => (lowest === null || s.stageOrder < lowest ? s.stageOrder : lowest), null);

  if (next === null) {
    return {
      outcome: 'completed',
      requestStatus: 'approved',
      decidedStageOrder: stage.stageOrder,
      nextStageOrder: null,
    };
  }

  return {
    outcome: 'advanced',
    requestStatus: 'pending',
    decidedStageOrder: stage.stageOrder,
    nextStageOrder: next,
  };
}

/**
 * Plain-English answer for an outcome.
 *
 * ⚠ None of the refusals is an error message. Somebody clicking a screen that
 * went stale while they read it has done nothing wrong, and "stage already
 * decided" is the most likely of them: with several people on one step, being
 * second is the normal case, not the exception.
 */
export const APPROVAL_OUTCOME_MESSAGES: Record<ApprovalOutcome, string> = {
  advanced: 'Approved. It has moved on to the next person.',
  completed: 'Approved.',
  rejected: 'Turned down. The parent will see that on their side.',
  recorded: 'Approved. This step is still waiting on the others.',
  stage_already_decided:
    'Someone else got to this one first — it has already been decided.',
  not_authorised: 'This one is not yours to decide.',
  already_approved:
    "You've already approved this step. It's waiting on the others.",
  request_closed: 'This has already been decided.',
  request_not_found: 'That request could not be found.',
};
