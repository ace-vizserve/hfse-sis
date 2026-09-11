import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  approvedByOf,
  loadLaddersBySubject,
  type RequestLadder,
} from '@/lib/approvals/inbox';
import { resolveAdviserPools } from '@/lib/approvals/resolve';
import {
  APPROVAL_OUTCOME_MESSAGES,
  canActOn,
  hasApprovedStep,
  stageAllows,
  type ApprovalActor,
  type RequestSnapshot,
} from '@/lib/approvals/state-machine';
import { GRADE_CHANGE_SUBJECT_TYPE } from '@/lib/change-requests/approval-route';
import type {
  ApprovalRequestStatus,
  GradeChangeApprovalFlow,
} from '@/lib/schemas/approval-flows';

/**
 * Where a grade change on the approval ladder stands, for ONE person holding an
 * email link.
 *
 * The confirm page reads this to decide whether to offer Confirm at all. It is
 * a courtesy, not the gate — `approval_advance` re-checks the same thing inside
 * the lock when the button is pressed. But a page that offers an action it will
 * then refuse is worse than one that explains, and "it isn't your turn yet"
 * is a very different sentence from "this isn't yours".
 */
export type GradeChangeActState =
  | { kind: 'not_found' }
  | { kind: 'closed'; requestStatus: Exclude<ApprovalRequestStatus, 'pending'> }
  | {
      kind: 'can_act';
      requestId: string;
      stageOrder: number;
      stageCount: number;
      stageLabel: string;
    }
  | {
      kind: 'already_decided';
      stageOrder: number;
      stageCount: number;
      stageLabel: string;
    }
  | {
      kind: 'not_yet';
      stageOrder: number;
      stageCount: number;
      stageLabel: string;
    }
  | {
      kind: 'not_yours';
      stageOrder: number;
      stageCount: number;
      stageLabel: string;
    }
  | {
      /** The link's holder filed this request, and cannot decide any of it. */
      kind: 'own_request';
      stageOrder: number;
      stageCount: number;
      stageLabel: string;
    }
  | {
      /**
       * Migration 145. The link's holder already approved the live step, and
       * it needs everyone on it — so it is still waiting, on the others.
       * `approval_advance` would answer 'already_approved'; `message` is that
       * answer's own sentence.
       */
      kind: 'already_approved';
      stageOrder: number;
      stageCount: number;
      stageLabel: string;
      message: string;
    };

/** Pure: the ladder, the person, and the classes they advise right now. */
export function classifyGradeChangeActState(
  ladder: RequestLadder | null,
  approverId: string,
  advisedSectionIds: ReadonlySet<string>
): GradeChangeActState {
  if (!ladder) return { kind: 'not_found' };
  if (ladder.status !== 'pending') {
    return { kind: 'closed', requestStatus: ladder.status };
  }

  const snapshot: RequestSnapshot = {
    status: ladder.status,
    currentStageOrder: ladder.currentStageOrder,
    stages: ladder.stages.map((s) => ({
      stageOrder: s.stageOrder,
      resolver: s.resolver,
      status: s.status,
      approverPool: s.approverPool,
      sectionId: s.sectionId,
      approvalRule: s.approvalRule,
      approvedBy: approvedByOf(s),
    })),
  };
  const actor: ApprovalActor = {
    userId: approverId,
    advisesSection: (sectionId) => advisedSectionIds.has(sectionId),
  };

  const current = ladder.stages.find(
    (s) => s.stageOrder === ladder.currentStageOrder
  );
  const position = {
    stageOrder: ladder.currentStageOrder,
    stageCount: ladder.stages.length,
    stageLabel: current?.label ?? '',
  };

  // ⚠ BEFORE `canActOn`. On a form adviser step the filer can be the very
  // adviser the step admits; the decide pipeline would refuse them, so the page
  // must not offer Confirm.
  if (ladder.filedBy != null && ladder.filedBy === approverId) {
    return { kind: 'own_request', ...position };
  }
  // ⚠ BEFORE `canActOn`, which is false for this person — and after it every
  // later branch would misread them: the live step has no decider yet, so they
  // would fall through to "not yours" about a step they are on.
  const live = snapshot.stages.find(
    (s) => s.stageOrder === ladder.currentStageOrder
  );
  if (
    live &&
    live.status === 'pending' &&
    stageAllows(live, actor) &&
    hasApprovedStep(live, approverId)
  ) {
    return {
      kind: 'already_approved',
      ...position,
      message: APPROVAL_OUTCOME_MESSAGES.already_approved,
    };
  }
  if (canActOn(snapshot, actor)) {
    return { kind: 'can_act', requestId: ladder.requestId, ...position };
  }
  if (ladder.stages.some((s) => s.decidedBy === approverId)) {
    return { kind: 'already_decided', ...position };
  }
  const onLaterStep = snapshot.stages.some(
    (s) =>
      s.status === 'waiting' &&
      s.stageOrder > ladder.currentStageOrder &&
      stageAllows(s, actor)
  );
  if (onLaterStep) return { kind: 'not_yet', ...position };
  return { kind: 'not_yours', ...position };
}

export async function loadGradeChangeActState(
  service: SupabaseClient,
  opts: {
    flow: GradeChangeApprovalFlow;
    gradeChangeRequestId: string;
    approverId: string;
  }
): Promise<GradeChangeActState> {
  const ladders = await loadLaddersBySubject(service, {
    flow: opts.flow,
    subjectType: GRADE_CHANGE_SUBJECT_TYPE,
    subjectIds: [opts.gradeChangeRequestId],
  });
  const ladder = ladders.get(opts.gradeChangeRequestId) ?? null;

  const adviserSections = (ladder?.stages ?? [])
    .filter((s) => s.resolver === 'form_adviser' && s.sectionId)
    .map((s) => s.sectionId as string);
  const advised = new Set<string>();
  if (adviserSections.length > 0) {
    const pools = await resolveAdviserPools(service, adviserSections);
    for (const [sectionId, pool] of pools) {
      if (pool.includes(opts.approverId)) advised.add(sectionId);
    }
  }

  return classifyGradeChangeActState(ladder, opts.approverId, advised);
}
