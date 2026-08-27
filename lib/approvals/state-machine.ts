import type {
  ApprovalOutcome,
  ApprovalRequestStatus,
  ApprovalResolver,
  ApprovalStageStatus,
} from '@/lib/schemas/approval-flows';

/**
 * The approval rules, as a pure function.
 *
 * ⚠ THIS IS WRITTEN TWICE ON PURPOSE — here and in
 * `supabase/migrations/127_approval_advance.sql` — and
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
 * stage really pending → may this person act. Reordering the last two would
 * tell somebody they are not authorised when the truth is that a colleague got
 * there first, which is the difference between "you may not" and "you needn't".
 */

export type StageSnapshot = {
  stageOrder: number;
  resolver: ApprovalResolver;
  status: ApprovalStageStatus;
  /** Frozen people, for a `named` stage. Empty for a derived one. */
  approverPool: string[];
  /** The section to resolve against, for a `form_adviser` stage. */
  sectionId: string | null;
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

/**
 * May this person decide this request right now?
 *
 * Used by the queue to decide whether to render the buttons at all — a screen
 * that offers an action it will then refuse is worse than one that explains.
 * The database re-checks the same thing before it writes anything.
 */
export function canActOn(
  request: RequestSnapshot | null | undefined,
  actor: ApprovalActor
): boolean {
  if (!request || request.status !== 'pending') return false;
  const stage = currentStage(request);
  if (!stage || stage.status !== 'pending') return false;
  return stageAllows(stage, actor);
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

  if (action === 'reject') {
    // One no ends the whole request. Later stages stay `waiting` rather than
    // being marked skipped — the ladder should read as "it never got there",
    // because it never did.
    return {
      outcome: 'rejected',
      requestStatus: 'rejected',
      decidedStageOrder: stage.stageOrder,
      nextStageOrder: null,
    };
  }

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
 * Plain-English answer for an outcome that is not a decision.
 *
 * ⚠ None of these is an error message. Somebody clicking a screen that went
 * stale while they read it has done nothing wrong, and "stage already decided"
 * is the most likely of them: with several people on one step, being second is
 * the normal case, not the exception.
 */
export const APPROVAL_OUTCOME_MESSAGES: Record<ApprovalOutcome, string> = {
  advanced: 'Approved. It has moved on to the next person.',
  completed: 'Approved.',
  rejected: 'Turned down. The parent will see that on their side.',
  stage_already_decided:
    'Someone else got to this one first — it has already been decided.',
  not_authorised: 'This one is not yours to decide.',
  request_closed: 'This has already been decided.',
  request_not_found: 'That request could not be found.',
};
