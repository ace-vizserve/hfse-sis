import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Role } from '@/lib/auth/roles';
import type {
  ApprovalRequestStatus,
  ApprovalResolver,
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
      `id, request_id, stage_order, label, resolver, approver_pool, section_id, status,
       approval_requests!inner(id, flow, subject_type, subject_id, status, filed_by_email, created_at)`
    )
    .eq('status', 'pending')
    .eq('approval_requests.flow', scope.flow)
    .eq('approval_requests.status', 'pending');

  if (!isOversight) {
    // ⚠ Both arms are ROOT columns. PostgREST cannot `or` across a root column
    // and an embedded table's column, which is why the flow filter above is a
    // separate `.eq` rather than being folded in here.
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
    filed_by_email: string;
    created_at: string;
  };
  type Row = {
    id: string;
    request_id: string;
    stage_order: number;
    label: string;
    resolver: ApprovalResolver;
    approver_pool: string[] | null;
    section_id: string | null;
    status: ApprovalStageStatus;
    approval_requests: EmbeddedRequest | EmbeddedRequest[];
  };

  const advised = new Set(advisedSectionIds);

  return ((data ?? []) as unknown as Row[]).map((row) => {
    // PostgREST returns an embedded to-one as an object or a single-element
    // array depending on how it infers the relationship; both shapes appear in
    // this codebase, so normalise rather than assume.
    const req = Array.isArray(row.approval_requests)
      ? row.approval_requests[0]
      : row.approval_requests;
    const pool = row.approver_pool ?? [];
    const canDecide =
      row.resolver === 'named'
        ? pool.includes(scope.userId)
        : row.section_id != null && advised.has(row.section_id);

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
      // A pending stage is by definition undecided.
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

  const { data: involvedRows, error: involvedErr } = await involvement;
  if (involvedErr) throw new Error(involvedErr.message);

  const requestIds = [
    ...new Set(
      ((involvedRows ?? []) as unknown as Array<{ request_id: string }>).map(
        (r) => r.request_id
      )
    ),
  ];
  if (requestIds.length === 0) return [];

  // ── The whole ladder for those requests, so the outcome can be found ─────
  const { data, error } = await service
    .from('approval_request_stages')
    .select(
      `id, request_id, stage_order, label, resolver, approver_pool, section_id, status,
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
    approver_pool: string[] | null;
    section_id: string | null;
    status: ApprovalStageStatus;
    decided_by: string | null;
    decided_by_email: string | null;
    decided_at: string | null;
    approval_requests: EmbeddedRequest | EmbeddedRequest[];
  };

  const byRequest = new Map<string, Row[]>();
  for (const row of (data ?? []) as unknown as Row[]) {
    const list = byRequest.get(row.request_id) ?? [];
    list.push(row);
    byRequest.set(row.request_id, list);
  }

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
    const representative =
      req.status === 'rejected'
        ? stages.find((s) => s.status === 'rejected')
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
      decidedBy: stage.decided_by,
      decidedByEmail: stage.decided_by_email,
      decidedAt: stage.decided_at,
      // Nothing here is actionable — it is already decided. Saying otherwise
      // would put an Approve button on a finished filing.
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
  filedByEmail: string;
  filedAt: string;
  decidedAt: string | null;
  stages: RequestLadderStage[];
};

/**
 * The full ladder for a set of subjects, keyed by subject id.
 *
 * This is what puts "with the form class adviser, then the officer in charge —
 * and Ms J approved it on Tuesday" on a screen. Two queries, never N.
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
      'id, flow, subject_type, subject_id, status, current_stage_order, filed_by_email, created_at, decided_at'
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
    filed_by_email: string;
    created_at: string;
    decided_at: string | null;
  };
  const reqRows = (requests ?? []) as unknown as ReqRow[];
  if (reqRows.length === 0) return out;

  const { data: stages, error: stageErr } = await service
    .from('approval_request_stages')
    .select(
      'request_id, stage_order, label, resolver, status, section_id, approver_pool, decided_by, decided_by_email, decided_at, decision_note'
    )
    .in(
      'request_id',
      reqRows.map((r) => r.id)
    )
    .order('stage_order', { ascending: true });
  if (stageErr) throw new Error(stageErr.message);

  type StageRow = {
    request_id: string;
    stage_order: number;
    label: string;
    resolver: ApprovalResolver;
    status: ApprovalStageStatus;
    section_id: string | null;
    approver_pool: string[] | null;
    decided_by: string | null;
    decided_by_email: string | null;
    decided_at: string | null;
    decision_note: string | null;
  };

  const byRequest = new Map<string, RequestLadderStage[]>();
  for (const s of (stages ?? []) as unknown as StageRow[]) {
    const list = byRequest.get(s.request_id) ?? [];
    list.push({
      stageOrder: s.stage_order,
      label: s.label,
      resolver: s.resolver,
      status: s.status,
      sectionId: s.section_id,
      approverPool: s.approver_pool ?? [],
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
