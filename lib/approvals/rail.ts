// No `import 'server-only'`: the step rail is drawn in client components, and
// everything here is pure.

import type {
  ApprovalRequestStatus,
  ApprovalResolver,
  ApprovalRule,
  ApprovalStageStatus,
} from '@/lib/schemas/approval-flows';

/**
 * One person on an "Everyone must approve" step, as a screen draws them: a name
 * resolved on the server, and when they approved — null while they have not.
 */
export type ApprovalRailPerson = {
  name: string;
  approvedAt: string | null;
  /**
   * What they wrote when they approved — rich-text HTML, as stored. Present
   * only when they wrote something; the rail strips it to plain text.
   */
  note?: string | null;
};

/**
 * One step, as a screen needs it — the display half of `RequestLadderStage`
 * (lib/approvals/inbox.ts) with the approver ids left behind.
 *
 * ⚠ NO POOL IDS. Who sits on a step reaches the browser as NAMES, resolved on
 * the server (`peopleByStageOrder`). A uuid on screen tells nobody anything,
 * and there is no reason to ship the list of accounts that can decide a
 * filing to everyone who can read it.
 */
export type ApprovalRailStage = {
  stageOrder: number;
  label: string;
  resolver: ApprovalResolver;
  status: ApprovalStageStatus;
  decidedAt: string | null;
  decisionNote: string | null;
  /**
   * `any` (one person carries the step) unless set. Optional so a caller that
   * has not been taught about the setting draws every step the way it always
   * did.
   */
  approvalRule?: ApprovalRule;
  /**
   * For an "Everyone must approve" step only: every person on it and whether
   * they have approved yet. Built on the server by `withApprovalProgress`.
   * Absent on an "any one of them" step, which needs no tally.
   */
  people?: readonly ApprovalRailPerson[];
};

/**
 * The step that stopped the ladder — a turn-down or a withdrawal — if any.
 *
 * ⚠ BOTH END IT. After a rejection OR a cancellation every later step keeps
 * status 'waiting' in the table forever (migrations 127 and 144). Drawn like a
 * step that is still coming, those read as "not yet" when the truth is "never".
 */
export function ladderStoppedAt(
  stages: readonly ApprovalRailStage[]
): ApprovalRailStage | undefined {
  return stages.find(
    (s) => s.status === 'rejected' || s.status === 'cancelled'
  );
}

/** Is this an "Everyone must approve" step? Only a named step can be. */
export function isEveryoneStep(
  stage: Pick<ApprovalRailStage, 'resolver' | 'approvalRule'>
): boolean {
  return stage.resolver === 'named' && stage.approvalRule === 'all';
}

/**
 * "2 of 3 approved", as numbers — or null for a step that needs only one.
 *
 * ⚠ A STEP WITH NOBODY ON IT IS NOT "0 OF 0, DONE". It returns a total of 0,
 * and every reader treats that as the empty-step case, never as complete.
 */
export function approvalTally(
  stage: Pick<ApprovalRailStage, 'resolver' | 'approvalRule' | 'people'>
): { approved: number; total: number } | null {
  if (!isEveryoneStep(stage)) return null;
  const people = stage.people ?? [];
  return {
    approved: people.filter((p) => p.approvedAt != null).length,
    total: people.length,
  };
}

/**
 * Where a request has got to, in one line — for a table cell that has no room
 * for the whole rail. "Waiting on step 2 of 4 — Ms Christina".
 *
 * On an "Everyone must approve" step the names give way to the count, because
 * the count is the news: "Waiting on step 3 of 4 — 1 of 2 approved".
 *
 * `people` is the already-resolved names for each step, keyed by step number.
 * A form-adviser step has no fixed list, so it is named by the post.
 */
export function describeLadderPosition(
  stages: readonly ApprovalRailStage[],
  people: Readonly<Record<number, string>>
): string {
  const total = stages.length;
  if (total === 0) return 'No steps set up';

  const stopped = ladderStoppedAt(stages);
  if (stopped?.status === 'rejected') {
    return `Turned down at step ${stopped.stageOrder} of ${total}`;
  }
  if (stopped?.status === 'cancelled') {
    return `Cancelled at step ${stopped.stageOrder} of ${total}`;
  }

  const pending = stages.find((s) => s.status === 'pending');
  if (!pending) {
    return stages.every((s) => s.status === 'approved')
      ? 'Every step approved'
      : `Step 1 of ${total}`;
  }

  const tally = approvalTally(pending);
  if (tally && tally.total > 0) {
    return `Waiting on step ${pending.stageOrder} of ${total} — ${tally.approved} of ${tally.total} approved`;
  }

  const who =
    pending.resolver === 'form_adviser'
      ? "the child's form class adviser"
      : people[pending.stageOrder] || 'nobody yet';
  return `Waiting on step ${pending.stageOrder} of ${total} — ${who}`;
}

// ── Building the tally on the server ────────────────────────────────────────

/** One recorded decision on a step (migration 145's per-person table). */
export type ApprovalDecisionRecord = {
  userId: string;
  email: string | null;
  decision: 'approve' | 'reject';
  decidedAt: string;
  /** Their own words, rich-text HTML. Optional for callers that do not read it. */
  note?: string | null;
};

/**
 * The fields of a ladder stage (`RequestLadderStage`, lib/approvals/inbox.ts)
 * that the tally reads. Structural, so this client-safe file never imports the
 * server-only inbox module.
 *
 * `approvalRule` and `decisions` are optional only so a ladder read before the
 * setting existed still passes through — it reads as "any one of them".
 */
export type LadderStageProgress = {
  stageOrder: number;
  resolver: ApprovalResolver;
  status: ApprovalStageStatus;
  approverPool: readonly string[];
  approvalRule?: ApprovalRule;
  decisions?: readonly ApprovalDecisionRecord[];
};

/** Who on this step has approved it, by account id. */
function approvedBy(stage: LadderStageProgress): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of stage.decisions ?? []) {
    if (d.decision === 'approve') out.set(d.userId, d.decidedAt);
  }
  return out;
}

/** What each approver on this step wrote with their yes, by account id. */
function approvalNotes(stage: LadderStageProgress): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of stage.decisions ?? []) {
    if (d.decision === 'approve' && d.note) out.set(d.userId, d.note);
  }
  return out;
}

/**
 * "2 of 3 approved" straight from a ladder stage — for the email confirm page,
 * which has ids and no names. Null for a step that needs only one person.
 *
 * ⚠ COUNTED OVER THE PEOPLE ON THE STEP NOW. Somebody taken off a waiting step
 * leaves their decision in the record, but they are no longer somebody the step
 * is waiting on, so they are neither a tick nor a hold-out here.
 */
export function ladderStepTally(
  stage: LadderStageProgress
): { approved: number; total: number } | null {
  if (!isEveryoneStep(stage)) return null;
  const approved = approvedBy(stage);
  return {
    approved: stage.approverPool.filter((id) => approved.has(id)).length,
    total: stage.approverPool.length,
  };
}

/**
 * The people on an "Everyone must approve" step, named, with their tick — and,
 * under it, whatever they wrote when they approved.
 *
 * ⚠ THE NOTES ARE WHY THIS CARRIES MORE THAN A TICK. The step row keeps only
 * the words of whoever closed it; everyone who approved before them wrote into
 * their own decision row (migration 145), and without this those words were
 * stored and never shown anywhere.
 *
 * ⚠ A STEP THAT DID NOT FINISH LISTS ONLY WHO APPROVED. On a turned-down or
 * withdrawn step, "not yet" beside the others would promise a decision that is
 * never coming; the rail says who signed before it stopped and nothing more.
 */
export function railPeopleForStage(
  stage: LadderStageProgress,
  nameById: ReadonlyMap<string, string>
): ApprovalRailPerson[] | undefined {
  if (!isEveryoneStep(stage)) return undefined;
  const approved = approvedBy(stage);
  const notes = approvalNotes(stage);
  const emailById = new Map(
    (stage.decisions ?? []).map((d) => [d.userId, d.email] as const)
  );
  const people = stage.approverPool.map((id): ApprovalRailPerson => {
    const note = notes.get(id);
    return {
      name: nameById.get(id) ?? emailById.get(id) ?? '(account removed)',
      approvedAt: approved.get(id) ?? null,
      // Only when there is one, so a person with nothing to say carries no key.
      ...(note ? { note } : {}),
    };
  });
  return stage.status === 'rejected' || stage.status === 'cancelled'
    ? people.filter((p) => p.approvedAt != null)
    : people;
}

/**
 * Rail stages with each step's setting and, on an "everyone" step, its people.
 *
 * Matched by step number: the rail stages and the ladder stages are two views
 * of the same frozen ladder, so the numbers are the same set.
 */
export function withApprovalProgress<T extends { stageOrder: number }>(
  railStages: readonly T[],
  ladderStages: readonly LadderStageProgress[],
  nameById: ReadonlyMap<string, string>
): Array<T & Pick<ApprovalRailStage, 'approvalRule' | 'people'>> {
  type WithProgress = T & Pick<ApprovalRailStage, 'approvalRule' | 'people'>;
  const byOrder = new Map(ladderStages.map((s) => [s.stageOrder, s] as const));
  return railStages.map((stage): WithProgress => {
    const ladder = byOrder.get(stage.stageOrder);
    if (!ladder) return stage as WithProgress;
    const people = railPeopleForStage(ladder, nameById);
    return {
      ...stage,
      approvalRule: ladder.approvalRule ?? 'any',
      ...(people ? { people } : {}),
    } as WithProgress;
  });
}

/**
 * Has this person already approved the step that is live, while it still waits
 * on the others?
 *
 * The one state where a screen must show neither Approve nor "not yours": they
 * ARE on the step, they have done their part, and a second click would be
 * refused (`already_approved`).
 */
export function viewerApprovedLiveStep(
  ladder: {
    status: ApprovalRequestStatus;
    stages: readonly LadderStageProgress[];
  },
  viewerId: string
): boolean {
  if (ladder.status !== 'pending') return false;
  const live = ladder.stages.find((s) => s.status === 'pending');
  if (!live || !isEveryoneStep(live)) return false;
  return approvedBy(live).has(viewerId);
}
