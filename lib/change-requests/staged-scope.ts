import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  hasDecidedStep,
  loadLaddersBySubject,
  type RequestLadder,
} from '@/lib/approvals/inbox';
import { GRADE_CHANGE_SUBJECT_TYPE } from '@/lib/change-requests/approval-route';
import {
  GRADE_CHANGE_FLOWS,
  GRADE_CHANGE_ROUTE_LABELS,
  isGradeChangeFlow,
  type StagedGradeChangeView,
} from '@/lib/change-requests/staged-flows';

/**
 * The server half of "a grade change decided step by step" (migration 144):
 * who is involved in one, what its ladder looks like, and whether THIS person
 * may decide the step that is live.
 *
 * ⚠ ONLY FOR ROWS WITH `approval_flow` SET. A row without it predates the
 * engine and is scoped by `primary_approver_id` / `secondary_approver_id`, the
 * way it always was. Nothing here reads those columns, and nothing that reads
 * those columns should reach for this.
 */

/**
 * Every grade change's ladder, keyed by the grade change request id, across
 * both flows. Three reads per flow (`loadLaddersBySubject`), six in all, never
 * one per request.
 */
export async function loadGradeChangeLadders(
  service: SupabaseClient,
  gradeChangeRequestIds: readonly string[]
): Promise<Map<string, RequestLadder>> {
  const ids = [...new Set(gradeChangeRequestIds.filter(Boolean))];
  const out = new Map<string, RequestLadder>();
  if (ids.length === 0) return out;

  const perFlow = await Promise.all(
    GRADE_CHANGE_FLOWS.map((flow) =>
      loadLaddersBySubject(service, {
        flow,
        subjectType: GRADE_CHANGE_SUBJECT_TYPE,
        subjectIds: ids,
      })
    )
  );
  for (const ladders of perFlow) {
    for (const [subjectId, ladder] of ladders) out.set(subjectId, ladder);
  }
  return out;
}

/**
 * The grade change request ids this person sits on ANY step of — named in its
 * pool, or advising the class a form-adviser step was worked out from.
 *
 * ⚠ ANY STEP, WHATEVER ITS STATUS. "What is waiting for me" (the inbox) only
 * reads pending steps, which would hide a request from the person who approved
 * step 1 while it sits at step 2 — and from the step-3 approver before it
 * reaches them. Both are on the request, and both may open it.
 *
 * `advisedSectionIds` comes from `loadAdvisedSectionIds`, passed in so a
 * caller that already read it does not read it twice.
 */
export async function listGradeChangeInvolvement(
  service: SupabaseClient,
  opts: { userId: string; advisedSectionIds: readonly string[] }
): Promise<string[]> {
  // ⚠ Both arms are ROOT columns. PostgREST cannot `or` across a root column
  // and an embedded one, which is why the flow filter is a separate `.in`.
  const arms = [`approver_pool.cs.{${opts.userId}}`];
  if (opts.advisedSectionIds.length > 0) {
    arms.push(`section_id.in.(${opts.advisedSectionIds.join(',')})`);
  }

  const { data, error } = await service
    .from('approval_request_stages')
    .select(
      'request_id, approval_requests!inner(flow, subject_type, subject_id)'
    )
    .in('approval_requests.flow', [...GRADE_CHANGE_FLOWS])
    .or(arms.join(','));
  if (error) throw new Error(error.message);

  type Embedded = { subject_type: string; subject_id: string };
  type Row = { approval_requests: Embedded | Embedded[] | null };

  const ids = new Set<string>();
  for (const row of (data ?? []) as unknown as Row[]) {
    const req = Array.isArray(row.approval_requests)
      ? row.approval_requests[0]
      : row.approval_requests;
    if (req?.subject_type === GRADE_CHANGE_SUBJECT_TYPE && req.subject_id) {
      ids.add(req.subject_id);
    }
  }
  return [...ids];
}

/**
 * Whether this person may decide the step that is live right now.
 *
 * The same rule `listInboxStages` applies and `approval_advance` re-checks
 * inside its lock: a named step admits its pool, a form-adviser step admits
 * whoever advises that class today. This is for SHOWING the buttons; the RPC
 * is what actually refuses.
 *
 * ⚠ NEVER THE PERSON WHO FILED IT. The filing route leaves the filer off every
 * named step, but a form adviser step works its people out live, and a
 * teacher filing for their own advisory class is exactly who it would admit.
 * The decide pipeline refuses them (`gradeChangeApprovalPrecheck`); this keeps
 * the button from being offered in the first place.
 *
 * ⚠ NOR SOMEBODY WHO HAS ALREADY DECIDED THE LIVE STEP (migration 145). On a
 * step that needs everyone, a person who approved is still on it while it
 * waits for the others — it is no longer waiting for them, and
 * `approval_advance` would answer 'already_approved'.
 */
export function canDecideCurrentStep(
  ladder: RequestLadder,
  userId: string,
  advisedSectionIds: ReadonlySet<string>
): boolean {
  if (ladder.status !== 'pending') return false;
  if (ladder.filedBy != null && ladder.filedBy === userId) return false;
  const live = ladder.stages.find((s) => s.status === 'pending');
  if (!live) return false;
  if (hasDecidedStep(live, userId)) return false;
  return live.resolver === 'named'
    ? live.approverPool.includes(userId)
    : live.sectionId != null && advisedSectionIds.has(live.sectionId);
}

/**
 * A ladder as a table row carries it: names instead of ids, and the viewer's
 * own right to decide worked out once, here.
 *
 * Returns null for a ladder on some other flow, which cannot happen through
 * `loadGradeChangeLadders` but is cheaper to refuse than to reason about.
 */
export function toStagedGradeChangeView(
  ladder: RequestLadder,
  opts: {
    userId: string;
    advisedSectionIds: ReadonlySet<string>;
    nameById: ReadonlyMap<string, string>;
  }
): StagedGradeChangeView | null {
  if (!isGradeChangeFlow(ladder.flow)) return null;
  const { nameById } = opts;

  return {
    approvalRequestId: ladder.requestId,
    flow: ladder.flow,
    routeLabel: GRADE_CHANGE_ROUTE_LABELS[ladder.flow],
    requestStatus: ladder.status,
    currentStageOrder: ladder.currentStageOrder,
    stages: ladder.stages.map((s) => ({
      stageOrder: s.stageOrder,
      label: s.label,
      resolver: s.resolver,
      status: s.status,
      decidedBy: s.decidedBy,
      decidedByEmail: s.decidedByEmail,
      decidedAt: s.decidedAt,
      decisionNote: s.decisionNote,
    })),
    peopleByStageOrder: Object.fromEntries(
      ladder.stages.map((s) => [
        s.stageOrder,
        s.approverPool
          .map((id) => nameById.get(id) ?? '(account removed)')
          .join(', '),
      ])
    ),
    decidedByNames: Object.fromEntries(
      ladder.stages
        .filter((s) => s.decidedBy)
        .map((s) => [
          s.stageOrder,
          nameById.get(s.decidedBy as string) ?? s.decidedByEmail ?? 'Someone',
        ])
    ),
    canDecide: canDecideCurrentStep(
      ladder,
      opts.userId,
      opts.advisedSectionIds
    ),
  };
}

/** Every account id a ladder names — for narrowing a staff-name map. */
export function ladderPersonIds(ladder: RequestLadder | undefined): string[] {
  if (!ladder) return [];
  return ladder.stages.flatMap((s) => [
    ...s.approverPool,
    ...(s.decidedBy ? [s.decidedBy] : []),
  ]);
}
