import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Role } from '@/lib/auth/roles';
import type {
  ApprovalRequestStatus,
  ApprovalResolver,
  ApprovalRule,
  ApprovalStageStatus,
  StagedApprovalFlow,
} from '@/lib/schemas/approval-flows';
import { sgToday } from '@/lib/dates';
import { loadAdvisedSectionIds } from '@/lib/approvals/resolve';

/**
 * ONE scope helper. Everything that asks "what is waiting for this person"
 * comes through here.
 *
 * ⚠ THIS FILE EXISTS BECAUSE THE OTHER FLOW DOES NOT HAVE ONE. The
 * change-request scope predicate — "I am primary, or secondary, or this is a
 * legacy row with neither" — is written out by hand in SIX places (the sidebar
 * count hook, the inbox route, two functions in `sidebar-counts.ts`, the home
 * to-do list and the admin page) plus a seventh imperative copy inside
 * `decide.ts`. Three of the six already disagree with each other about what a
 * superadmin sees, and the parity test written to catch that compares only
 * three of them. A queue and its badge that disagree send somebody to an empty
 * screen; that bug has already shipped here once.
 *
 * So: one function, and every caller takes what it returns.
 */

/**
 * Roles that see the whole school's queue rather than only their own classes.
 *
 * ⚠ ONE DEFINITION, and the activity feed imports it rather than restating it.
 * A feed that hid what the queue page shows is the same badge-versus-panel
 * disagreement this file's header was written about.
 */
export const OVERSIGHT_ROLES: ReadonlySet<Role> = new Set<Role>([
  'academic_coordinator',
  'school_admin',
  'superadmin',
]);

/**
 * One person's decision on one step (migration 145's
 * `approval_request_stage_decisions`).
 *
 * ⚠ AN 'all' STEP COLLECTS SEVERAL OF THESE BEFORE IT CLOSES, and the step's
 * own `decidedBy` names only the person who closed it — the last approver, or
 * whoever turned it down. This list is where the rest of the yeses live.
 */
export type StepDecision = {
  userId: string;
  email: string | null;
  decision: 'approve' | 'reject';
  decidedAt: string;
  /**
   * What this person wrote with their decision — rich-text HTML, or null.
   *
   * ⚠ ON AN 'all' STEP THIS IS THE ONLY PLACE MOST NOTES LIVE. The step row's
   * `decision_note` holds only the closer's words; everyone who approved
   * before them wrote into this row and nowhere else.
   */
  note: string | null;
};

/** Has this person already decided this step — said yes, or no? */
export function hasDecidedStep(
  stage: { decisions: readonly StepDecision[] },
  userId: string
): boolean {
  return stage.decisions.some((d) => d.userId === userId);
}

/** The ids of everyone who has said yes to this step. */
export function approvedByOf(stage: {
  decisions: readonly StepDecision[];
}): string[] {
  return stage.decisions
    .filter((d) => d.decision === 'approve')
    .map((d) => d.userId);
}

/**
 * Every decision on the given steps, keyed by step id, oldest first. One read,
 * never one per step. Nothing is read when there are no steps.
 */
export async function loadStepDecisions(
  service: SupabaseClient,
  stageIds: readonly string[]
): Promise<Map<string, StepDecision[]>> {
  const out = new Map<string, StepDecision[]>();
  const ids = [...new Set(stageIds.filter(Boolean))];
  // `in.()` is not valid PostgREST.
  if (ids.length === 0) return out;

  const { data, error } = await service
    .from('approval_request_stage_decisions')
    .select('request_stage_id, user_id, user_email, decision, note, decided_at')
    .in('request_stage_id', ids)
    .order('decided_at', { ascending: true });
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as unknown as Array<{
    request_stage_id?: string;
    user_id?: string;
    user_email?: string | null;
    decision?: string;
    note?: string | null;
    decided_at?: string;
  }>) {
    if (!row.request_stage_id || !row.user_id) continue;
    if (row.decision !== 'approve' && row.decision !== 'reject') continue;
    const list = out.get(row.request_stage_id) ?? [];
    list.push({
      userId: row.user_id,
      email: row.user_email ?? null,
      decision: row.decision,
      decidedAt: row.decided_at ?? '',
      note: row.note ?? null,
    });
    out.set(row.request_stage_id, list);
  }
  return out;
}

export type InboxStage = {
  requestId: string;
  subjectType: string;
  subjectId: string;
  requestStatus: ApprovalRequestStatus;
  filedByEmail: string;
  filedAt: string;
  stageId: string;
  stageOrder: number;
  label: string;
  resolver: ApprovalResolver;
  status: ApprovalStageStatus;
  sectionId: string | null;
  approverPool: string[];
  /** Migration 145. 'any' — first to act carries it; 'all' — everyone must. */
  approvalRule: ApprovalRule;
  /** Every decision on this step so far, oldest first. */
  decisions: StepDecision[];
  /**
   * Who ended it, and when. Null while it is still moving — a stage waiting on
   * somebody has nobody to name yet.
   */
  decidedBy: string | null;
  decidedByEmail: string | null;
  decidedAt: string | null;
  /**
   * Whether THIS viewer may decide it, as opposed to merely see it.
   *
   * ⚠ The two are different and the difference shapes the screen. An academic
   * coordinator watching the school's queue is not an approver on anybody's
   * absence; showing them buttons that would then 403 is the bug
   * `/markbook/change-requests` still has for superadmins.
   *
   * ⚠ FALSE ONCE THE VIEWER HAS DECIDED THE STEP. On an 'all' step somebody who
   * has already approved is still on it while it waits on the others; it is no
   * longer waiting on them.
   */
  canDecide: boolean;
};

export type InboxScope = {
  flow: StagedApprovalFlow;
  userId: string;
  role: Role | null;
  today?: string;
};

/**
 * The same scope over SEVERAL flows at once — what a count that spans flows
 * (the notification bell, once grade change requests join it) asks with.
 */
export type InboxMultiFlowScope = Omit<InboxScope, 'flow'> & {
  flows: readonly StagedApprovalFlow[];
};

/**
 * The pending stages this person should see, and which of them they may act on.
 *
 * Oversight roles see every open request on the flow. Everybody else sees the
 * stages that name them, plus the stages derived from a class they advise —
 * including one they are covering this week, and excluding one whose cover
 * window has not started or has already ended.
 */
export async function listInboxStages(
  service: SupabaseClient,
  scope: InboxScope
): Promise<InboxStage[]> {
  return listInboxStagesAcrossFlows(service, {
    flows: [scope.flow],
    userId: scope.userId,
    role: scope.role,
    today: scope.today,
  });
}

/**
 * `listInboxStages` over several flows in ONE pass.
 *
 * ⚠ ONE QUERY, NOT ONE PER FLOW. A caller that looped `listInboxStages` would
 * re-read the person's advised classes once per flow, and the header count
 * runs in every module layout on every navigation. The scope rule is identical
 * — it is the same code — so the answer is the sum a loop would give: every
 * stage belongs to exactly one request, and every request to exactly one flow.
 */
export async function listInboxStagesAcrossFlows(
  service: SupabaseClient,
  scope: InboxMultiFlowScope
): Promise<InboxStage[]> {
  const flows = [...new Set(scope.flows)];
  // `in.()` is not valid PostgREST, and no flows means nothing is waiting.
  if (flows.length === 0) return [];

  const today = scope.today ?? sgToday();
  const isOversight = scope.role != null && OVERSIGHT_ROLES.has(scope.role);

  const advisedSectionIds = await loadAdvisedSectionIds(
    service,
    scope.userId,
    today
  );

  let query = service
    .from('approval_request_stages')
    .select(
      `id, request_id, stage_order, label, resolver, approval_rule, approver_pool, section_id, status,
       approval_requests!inner(id, flow, subject_type, subject_id, status, filed_by, filed_by_email, created_at)`
    )
    .eq('status', 'pending')
    .in('approval_requests.flow', flows)
    .eq('approval_requests.status', 'pending');

  if (!isOversight) {
    // ⚠ Both arms are ROOT columns. PostgREST cannot `or` across a root column
    // and an embedded table's column, which is why the flow filter above is a
    // separate `.in` rather than being folded in here.
    const arms = [`approver_pool.cs.{${scope.userId}}`];
    if (advisedSectionIds.length > 0) {
      arms.push(`section_id.in.(${advisedSectionIds.join(',')})`);
    }
    query = query.or(arms.join(','));
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  type EmbeddedRequest = {
    subject_type: string;
    subject_id: string;
    status: ApprovalRequestStatus;
    filed_by?: string | null;
    filed_by_email: string;
    created_at: string;
  };
  type Row = {
    id: string;
    request_id: string;
    stage_order: number;
    label: string;
    resolver: ApprovalResolver;
    approval_rule?: ApprovalRule | null;
    approver_pool: string[] | null;
    section_id: string | null;
    status: ApprovalStageStatus;
    approval_requests: EmbeddedRequest | EmbeddedRequest[];
  };

  const advised = new Set(advisedSectionIds);
  const rows = (data ?? []) as unknown as Row[];
  // One read for every step's decisions — what lets a step this person has
  // already approved stop counting as waiting for them.
  const decisionsByStage = await loadStepDecisions(
    service,
    rows.map((r) => r.id)
  );

  return rows.map((row) => {
    // PostgREST returns an embedded to-one as an object or a single-element
    // array depending on how it infers the relationship; both shapes appear in
    // this codebase, so normalise rather than assume.
    const req = Array.isArray(row.approval_requests)
      ? row.approval_requests[0]
      : row.approval_requests;
    const pool = row.approver_pool ?? [];
    // ⚠ NEVER THE PERSON WHO FILED IT. Nobody approves their own request, and
    // on a form adviser step the filer can be exactly the adviser the step
    // would admit. Judged here rather than filtered out of the query, so an
    // oversight reader still SEES their own filing in the school's queue —
    // they just are not offered it, and every count that reads `canDecide`
    // stops counting it. (A `filed_by <> me` filter would also have dropped
    // every request whose filer is null, since `<>` is never true of null.)
    // For declarations the filer is a parent, so this changes nothing there.
    const filedByViewer =
      req?.filed_by != null && req.filed_by === scope.userId;
    const decisions = decisionsByStage.get(row.id) ?? [];
    // ⚠ A step this person has already decided is not waiting for them, even
    // while an 'all' step is still waiting for somebody else on it.
    const decidedByViewer = decisions.some((d) => d.userId === scope.userId);
    const canDecide =
      !filedByViewer &&
      !decidedByViewer &&
      (row.resolver === 'named'
        ? pool.includes(scope.userId)
        : row.section_id != null && advised.has(row.section_id));

    return {
      requestId: row.request_id,
      subjectType: req?.subject_type ?? '',
      subjectId: req?.subject_id ?? '',
      requestStatus: req?.status ?? 'pending',
      filedByEmail: req?.filed_by_email ?? '',
      filedAt: req?.created_at ?? '',
      stageId: row.id,
      stageOrder: row.stage_order,
      label: row.label,
      resolver: row.resolver,
      status: row.status,
      sectionId: row.section_id,
      approverPool: pool,
      approvalRule: row.approval_rule ?? 'any',
      decisions,
      // A pending stage is by definition not yet closed.
      decidedBy: null,
      decidedByEmail: null,
      decidedAt: null,
      canDecide,
    };
  });
}

/** How many are waiting for this person to act — the panel's number. */
export async function countInboxActionable(
  service: SupabaseClient,
  scope: InboxScope
): Promise<number> {
  const rows = await listInboxStages(service, scope);
  return rows.filter((r) => r.canDecide).length;
}

/** The same number summed across several flows, in one pass. */
export async function countInboxActionableAcrossFlows(
  service: SupabaseClient,
  scope: InboxMultiFlowScope
): Promise<number> {
  const rows = await listInboxStagesAcrossFlows(service, scope);
  return rows.filter((r) => r.canDecide).length;
}

// ── What already happened ──────────────────────────────────────────────────

/**
 * Requests on this flow that have FINISHED — approved, or turned down.
 *
 * ⚠ A SIBLING OF `listInboxStages`, NOT A FLAG ON IT, and the reason is the
 * rejection case. That function scopes a person to the stages that name them,
 * which is right for "what is waiting for me". It is wrong for history: if an
 * adviser approves step 1 and the officer turns the filing down at step 2, the
 * adviser is in NEITHER step 2's pool nor its section, so a flag on the same
 * query would hide the outcome from the one person who most needs it. Right
 * now nothing tells an adviser what happened to something they approved.
 *
 * So involvement is judged across the WHOLE ladder — you were on any step of
 * it — and the row returned represents the request's OUTCOME.
 *
 * ⚠ PLUS ONE KIND OF OPEN REQUEST (migration 145): one whose live step needs
 * everyone and which THIS viewer has already approved. It is still pending
 * (`requestStatus: 'pending'`), represented by that live step, and never
 * decidable — the inbox has stopped offering it to them, and this is where
 * their yes stays visible while the others catch up.
 *
 * ⚠ THE COUNTS MUST NOT COME THROUGH HERE. The sidebar badge, the "Waiting for
 * you" panel and the notification bell all mean "there is work for you"; a
 * number that included last term's approvals would be a to-do list that never
 * reaches zero. Those keep calling `countInboxActionable`.
 */
export async function listDecidedStages(
  service: SupabaseClient,
  scope: InboxScope
): Promise<InboxStage[]> {
  const today = scope.today ?? sgToday();
  const isOversight = scope.role != null && OVERSIGHT_ROLES.has(scope.role);

  const advisedSectionIds = await loadAdvisedSectionIds(
    service,
    scope.userId,
    today
  );

  // ── Which finished requests was this person part of? ─────────────────────
  let involvement = service
    .from('approval_request_stages')
    .select('request_id, approval_requests!inner(flow, status)')
    .eq('approval_requests.flow', scope.flow)
    .in('approval_requests.status', ['approved', 'rejected']);

  if (!isOversight) {
    // Any step that names them, whatever that step's own outcome — this is the
    // whole point of the function.
    const arms = [`approver_pool.cs.{${scope.userId}}`];
    if (advisedSectionIds.length > 0) {
      arms.push(`section_id.in.(${advisedSectionIds.join(',')})`);
    }
    involvement = involvement.or(arms.join(','));
  }

  // ── And the 'all' steps this person has approved that still wait on others ─
  //
  // ⚠ STILL OPEN, BUT NOT WAITING ON THEM. The inbox stops offering a step the
  // viewer has already approved (migration 145), and without this their yes
  // would vanish from every list until the last person on the step caught up.
  // Personal, so the same for an oversight reader: it is about what THEY did.
  const [
    { data: involvedRows, error: involvedErr },
    { data: approvedRows, error: approvedErr },
  ] = await Promise.all([
    involvement,
    service
      .from('approval_request_stage_decisions')
      .select(
        'request_stage_id, approval_request_stages!inner(request_id, status, approval_requests!inner(flow, status))'
      )
      .eq('user_id', scope.userId)
      .eq('decision', 'approve')
      .eq('approval_request_stages.status', 'pending')
      .eq('approval_request_stages.approval_requests.flow', scope.flow)
      .eq('approval_request_stages.approval_requests.status', 'pending'),
  ]);
  if (involvedErr) throw new Error(involvedErr.message);
  if (approvedErr) throw new Error(approvedErr.message);

  type EmbeddedStep = { request_id?: string };
  const stillWaitingIds = (
    (approvedRows ?? []) as unknown as Array<{
      approval_request_stages?: EmbeddedStep | EmbeddedStep[] | null;
    }>
  )
    .map((r) =>
      Array.isArray(r.approval_request_stages)
        ? r.approval_request_stages[0]?.request_id
        : r.approval_request_stages?.request_id
    )
    .filter((id): id is string => Boolean(id));

  const requestIds = [
    ...new Set([
      ...((involvedRows ?? []) as unknown as Array<{ request_id: string }>).map(
        (r) => r.request_id
      ),
      ...stillWaitingIds,
    ]),
  ];
  if (requestIds.length === 0) return [];

  // ── The whole ladder for those requests, so the outcome can be found ─────
  const { data, error } = await service
    .from('approval_request_stages')
    .select(
      `id, request_id, stage_order, label, resolver, approval_rule, approver_pool, section_id, status,
       decided_by, decided_by_email, decided_at,
       approval_requests!inner(id, flow, subject_type, subject_id, status, filed_by_email, created_at)`
    )
    .in('request_id', requestIds)
    .order('stage_order', { ascending: true });
  if (error) throw new Error(error.message);

  type EmbeddedRequest = {
    subject_type: string;
    subject_id: string;
    status: ApprovalRequestStatus;
    filed_by_email: string;
    created_at: string;
  };
  type Row = {
    id: string;
    request_id: string;
    stage_order: number;
    label: string;
    resolver: ApprovalResolver;
    approval_rule?: ApprovalRule | null;
    approver_pool: string[] | null;
    section_id: string | null;
    status: ApprovalStageStatus;
    decided_by: string | null;
    decided_by_email: string | null;
    decided_at: string | null;
    approval_requests: EmbeddedRequest | EmbeddedRequest[];
  };

  const allRows = (data ?? []) as unknown as Row[];
  const byRequest = new Map<string, Row[]>();
  for (const row of allRows) {
    const list = byRequest.get(row.request_id) ?? [];
    list.push(row);
    byRequest.set(row.request_id, list);
  }
  const decisionsByStage = await loadStepDecisions(
    service,
    allRows.map((r) => r.id)
  );

  const out: InboxStage[] = [];
  for (const [, stages] of byRequest) {
    const first = stages[0];
    const req = Array.isArray(first.approval_requests)
      ? first.approval_requests[0]
      : first.approval_requests;
    if (!req) continue;

    // ⚠ ONE ROW PER REQUEST, representing HOW IT ENDED. A turned-down filing is
    // represented by the step that turned it down — that is the step carrying
    // the name and the reason somebody will want. An approved one is
    // represented by its LAST approval, which is the moment it became final.
    // One still waiting on others is represented by the live step the viewer
    // has already approved.
    const representative =
      req.status === 'rejected'
        ? stages.find((s) => s.status === 'rejected')
        : req.status === 'pending'
          ? stages.find((s) => s.status === 'pending')
          : [...stages].reverse().find((s) => s.status === 'approved');
    const stage = representative ?? stages[stages.length - 1];

    out.push({
      requestId: stage.request_id,
      subjectType: req.subject_type,
      subjectId: req.subject_id,
      requestStatus: req.status,
      filedByEmail: req.filed_by_email,
      filedAt: req.created_at,
      stageId: stage.id,
      stageOrder: stage.stage_order,
      label: stage.label,
      resolver: stage.resolver,
      status: stage.status,
      sectionId: stage.section_id,
      approverPool: stage.approver_pool ?? [],
      approvalRule: stage.approval_rule ?? 'any',
      decisions: decisionsByStage.get(stage.id) ?? [],
      decidedBy: stage.decided_by,
      decidedByEmail: stage.decided_by_email,
      decidedAt: stage.decided_at,
      // Nothing here is actionable — it is already decided, or (still open)
      // already decided by this viewer. Saying otherwise would put an Approve
      // button on a filing that would refuse it.
      canDecide: false,
    });
  }
  return out;
}

// ── Reading a whole ladder, for display ────────────────────────────────────

export type RequestLadderStage = {
  stageOrder: number;
  label: string;
  resolver: ApprovalResolver;
  status: ApprovalStageStatus;
  sectionId: string | null;
  approverPool: string[];
  /** Migration 145. 'any' — first to act carries it; 'all' — everyone must. */
  approvalRule: ApprovalRule;
  /**
   * Every decision on this step, oldest first. On an 'all' step this is where
   * the approvals before the last one live — `decidedBy` names only whoever
   * closed the step.
   */
  decisions: StepDecision[];
  /** Whoever CLOSED the step. Null while it is still open. */
  decidedBy: string | null;
  decidedByEmail: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
};

export type RequestLadder = {
  requestId: string;
  flow: string;
  subjectType: string;
  subjectId: string;
  status: ApprovalRequestStatus;
  currentStageOrder: number;
  /**
   * `approval_requests.filed_by`. What keeps a person from being offered a
   * decision on their own request (`canDecideCurrentStep`).
   */
  filedBy: string | null;
  filedByEmail: string;
  filedAt: string;
  decidedAt: string | null;
  stages: RequestLadderStage[];
};

/**
 * The full ladder for a set of subjects, keyed by subject id.
 *
 * This is what puts "with the form class adviser, then the officer in charge —
 * and Ms J approved it on Tuesday" on a screen. Three queries (requests, steps,
 * decisions), never N.
 */
export async function loadLaddersBySubject(
  service: SupabaseClient,
  opts: { flow: StagedApprovalFlow; subjectType: string; subjectIds: string[] }
): Promise<Map<string, RequestLadder>> {
  const out = new Map<string, RequestLadder>();
  const ids = [...new Set(opts.subjectIds.filter(Boolean))];
  if (ids.length === 0) return out;

  const { data: requests, error } = await service
    .from('approval_requests')
    .select(
      'id, flow, subject_type, subject_id, status, current_stage_order, filed_by, filed_by_email, created_at, decided_at'
    )
    .eq('flow', opts.flow)
    .eq('subject_type', opts.subjectType)
    .in('subject_id', ids);
  if (error) throw new Error(error.message);

  type ReqRow = {
    id: string;
    flow: string;
    subject_type: string;
    subject_id: string;
    status: ApprovalRequestStatus;
    current_stage_order: number;
    filed_by?: string | null;
    filed_by_email: string;
    created_at: string;
    decided_at: string | null;
  };
  const reqRows = (requests ?? []) as unknown as ReqRow[];
  if (reqRows.length === 0) return out;

  const { data: stages, error: stageErr } = await service
    .from('approval_request_stages')
    .select(
      'id, request_id, stage_order, label, resolver, approval_rule, status, section_id, approver_pool, decided_by, decided_by_email, decided_at, decision_note'
    )
    .in(
      'request_id',
      reqRows.map((r) => r.id)
    )
    .order('stage_order', { ascending: true });
  if (stageErr) throw new Error(stageErr.message);

  type StageRow = {
    id: string;
    request_id: string;
    stage_order: number;
    label: string;
    resolver: ApprovalResolver;
    approval_rule?: ApprovalRule | null;
    status: ApprovalStageStatus;
    section_id: string | null;
    approver_pool: string[] | null;
    decided_by: string | null;
    decided_by_email: string | null;
    decided_at: string | null;
    decision_note: string | null;
  };

  const stageRows = (stages ?? []) as unknown as StageRow[];
  // The third read — one, whatever the number of requests.
  const decisionsByStage = await loadStepDecisions(
    service,
    stageRows.map((s) => s.id)
  );

  const byRequest = new Map<string, RequestLadderStage[]>();
  for (const s of stageRows) {
    const list = byRequest.get(s.request_id) ?? [];
    list.push({
      stageOrder: s.stage_order,
      label: s.label,
      resolver: s.resolver,
      status: s.status,
      sectionId: s.section_id,
      approverPool: s.approver_pool ?? [],
      approvalRule: s.approval_rule ?? 'any',
      decisions: decisionsByStage.get(s.id) ?? [],
      decidedBy: s.decided_by,
      decidedByEmail: s.decided_by_email,
      decidedAt: s.decided_at,
      decisionNote: s.decision_note,
    });
    byRequest.set(s.request_id, list);
  }

  for (const r of reqRows) {
    out.set(r.subject_id, {
      requestId: r.id,
      flow: r.flow,
      subjectType: r.subject_type,
      subjectId: r.subject_id,
      status: r.status,
      currentStageOrder: r.current_stage_order,
      filedBy: r.filed_by ?? null,
      filedByEmail: r.filed_by_email,
      filedAt: r.created_at,
      decidedAt: r.decided_at,
      stages: byRequest.get(r.id) ?? [],
    });
  }
  return out;
}

/** One ladder by request id — what the decide route re-reads after acting. */
export async function loadLadderById(
  service: SupabaseClient,
  requestId: string
): Promise<RequestLadder | null> {
  const { data, error } = await service
    .from('approval_requests')
    .select('id, flow, subject_type, subject_id')
    .eq('id', requestId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as unknown as {
    flow: StagedApprovalFlow;
    subject_type: string;
    subject_id: string;
  };
  const ladders = await loadLaddersBySubject(service, {
    flow: row.flow,
    subjectType: row.subject_type,
    subjectIds: [row.subject_id],
  });
  return ladders.get(row.subject_id) ?? null;
}
