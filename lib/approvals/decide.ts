import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Role } from '@/lib/auth/roles';
import type { ApprovalOutcome } from '@/lib/schemas/approval-flows';
import { APPROVAL_OUTCOME_MESSAGES } from '@/lib/approvals/state-machine';
import { DECLARATION_SUBJECT_TYPE } from '@/lib/declarations/approval';
import { declarationApprovalHandler } from '@/lib/declarations/approval-handler';
import { GRADE_CHANGE_SUBJECT_TYPE } from '@/lib/change-requests/approval-route';
import {
  gradeChangeApprovalHandler,
  gradeChangeApprovalPrecheck,
} from '@/lib/change-requests/approval-handler';

/**
 * Deciding one step of an ordered approval ladder (KD #196), for ANY subject.
 *
 * ⚠ THE ENGINE IS GENERIC AND ITS CONSUMERS ARE NOT. `approval_advance`
 * (migration 127) knows nothing about what it is approving — it holds no key
 * back to its consumer (migrations 125 and 126). Everything that makes an
 * approval MEAN something — the parent's status moving, the register being
 * marked, the audit row naming a child — belongs to the subject, so it lives in
 * that subject's handler below, not in this pipeline.
 *
 * ⚠ NO NEXT RESPONSE OBJECTS IN HERE, on purpose. The in-app route and a future
 * signed-email-token route decide the same step the same way; the only thing
 * that differs between them is how the caller proved who they are. So this
 * returns a plain `{ status, body }` and each route turns it into a response.
 */

export type DecideAction = 'approve' | 'reject';

/**
 * How the decision reached us. Recorded on the audit row so "approved from the
 * email" and "approved on the screen" can be told apart afterwards.
 *
 * `repoint` (migrations 145 and 146) is nobody's click: the school changed a
 * live step's people or rule, and its new terms were already met, so the step
 * moved on. The actor is the admin who changed the step; the approver is in
 * `closedStepApprover`. See `runSubjectFollowUp`.
 */
export type DecideVia = 'in_app' | 'email_token' | 'repoint';

export type DecideActor = {
  id: string;
  email: string | null;
  role: Role | null;
};

/**
 * The outcomes in which something was actually recorded.
 *
 * ⚠ 'recorded' (migration 145) IS ONE OF THEM. A yes on an 'all' step that
 * still waits on others moves nothing, but it IS a decision somebody made, and
 * the subject's handler owns its audit row. A handler must treat it as "no
 * projection, no side effects" — the request is exactly where it was.
 */
export type DecidedOutcome = Extract<
  ApprovalOutcome,
  'advanced' | 'completed' | 'rejected' | 'recorded'
>;

function isDecidedOutcome(outcome: ApprovalOutcome): outcome is DecidedOutcome {
  return (
    outcome === 'advanced' ||
    outcome === 'completed' ||
    outcome === 'rejected' ||
    outcome === 'recorded'
  );
}

export type SubjectHandlerContext = {
  service: SupabaseClient;
  actor: DecideActor;
  requestId: string;
  flow: string;
  subjectId: string;
  action: DecideAction;
  outcome: DecidedOutcome;
  decidedStageOrder: number | null;
  nextStageOrder: number | null;
  /** Already trimmed to null when empty. */
  note: string | null;
  via: DecideVia;
  /**
   * `via: 'repoint'` only — whose approval the closed step now stands in the
   * name of (its `decided_by` / `decided_by_email`), read by
   * `runSubjectFollowUp` once the step has closed.
   *
   * ⚠ `actor` IS NOT THE APPROVER ON THAT DOOR. It is the admin whose change to
   * the step's people or rule let it finish. A handler that projects a
   * reviewer, emails "approved by", or audits who approved takes the name from
   * here — never from `actor`. Absent (or null) on every click.
   */
  closedStepApprover?: { id: string | null; email: string | null } | null;
};

/**
 * What a subject handler hands back.
 *
 * `ok: true` — the pipeline answers 200 with `message` and merges `extra` into
 * the body. `ok: false` — the pipeline answers with exactly `status` and
 * `body`; a handler uses it when the decision landed but the subject could not
 * be brought in line with it, and says so in its own words.
 */
export type SubjectHandlerResult =
  | { ok: true; message: string; extra?: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Runs AFTER `approval_advance` has committed a decision. Responsible for the
 * subject's projection, side effects, audit row, cache invalidation and the
 * sentence the approver reads.
 */
export type SubjectHandler = (
  ctx: SubjectHandlerContext
) => Promise<SubjectHandlerResult>;

/**
 * Every subject the engine can decide, keyed on `approval_requests.subject_type`.
 *
 * A new consumer registers by adding ONE entry here. There is deliberately no
 * runtime registration: a handler added from somewhere else would be missing
 * whenever that somewhere else had not been imported yet, and the failure would
 * be a decision recorded with nothing done about it.
 */
export const SUBJECT_HANDLERS: Record<string, SubjectHandler> = {
  [DECLARATION_SUBJECT_TYPE]: declarationApprovalHandler,
  [GRADE_CHANGE_SUBJECT_TYPE]: gradeChangeApprovalHandler,
};

/** What a pre-check sees: the request as filed, and who is trying to decide. */
export type SubjectPrecheckContext = {
  actor: DecideActor;
  requestId: string;
  flow: string;
  subjectId: string;
  /** `approval_requests.filed_by`. Null when the filer's account is unknown. */
  filedBy: string | null;
  action: DecideAction;
};

/** A refusal the pipeline returns as-is. Nothing has been recorded. */
export type SubjectPrecheckRefusal = {
  status: number;
  body: Record<string, unknown>;
};

/**
 * Runs BEFORE `approval_advance`. Returns null to let the decision through, or
 * a refusal to stop it with nothing recorded.
 *
 * ⚠ FOR RULES THE ENGINE CANNOT KNOW. `approval_advance` decides who may act
 * from the step alone — its pool, or the class it advises. Whether the person
 * acting is also the person who asked is a fact about the SUBJECT, and only
 * some subjects care about it.
 */
export type SubjectPrecheck = (
  ctx: SubjectPrecheckContext
) => SubjectPrecheckRefusal | null | Promise<SubjectPrecheckRefusal | null>;

/**
 * Optional pre-checks, keyed like `SUBJECT_HANDLERS`. A subject with no entry
 * is decided exactly as before.
 *
 * ⚠ A SEPARATE MAP, NOT A FIELD ON THE HANDLER. The handlers stay plain
 * functions, so a subject that needs no pre-check — declarations — is
 * untouched, down to the call shape its tests spy on.
 */
export const SUBJECT_PRECHECKS: Record<string, SubjectPrecheck> = {
  [GRADE_CHANGE_SUBJECT_TYPE]: gradeChangeApprovalPrecheck,
};

// Named `Params`, not `Input`: `DecideApprovalInput` is already the request
// body's type in `lib/schemas/approval-flows.ts`.
export type DecideApprovalParams = {
  service: SupabaseClient;
  actor: DecideActor;
  requestId: string;
  action: DecideAction;
  note: string | null;
  via: DecideVia;
};

export type DecideApprovalResult =
  | { ok: true; status: 200; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> };

/** Shown when a decision landed but no handler could finish the job. */
export const DECISION_RECORDED_FOLLOW_UP_FAILED =
  'The decision was recorded, but the rest of the update could not be finished. Tell an administrator.';

/**
 * Shown when nothing in this app knows how to finish a decision on this kind
 * of request. Nothing has been recorded, so this is not "try again" either —
 * trying again would meet the same gap.
 */
export const SUBJECT_NOT_DECIDABLE =
  'This kind of request cannot be decided here yet. Nothing was recorded. Tell an administrator.';

function lookupHandler(subjectType: string): SubjectHandler | undefined {
  // Own keys only — `subject_type` comes from a database row, and "toString"
  // must not resolve to something callable.
  return Object.prototype.hasOwnProperty.call(SUBJECT_HANDLERS, subjectType)
    ? SUBJECT_HANDLERS[subjectType]
    : undefined;
}

function lookupPrecheck(subjectType: string): SubjectPrecheck | undefined {
  return Object.prototype.hasOwnProperty.call(SUBJECT_PRECHECKS, subjectType)
    ? SUBJECT_PRECHECKS[subjectType]
    : undefined;
}

export async function decideApproval(
  input: DecideApprovalParams
): Promise<DecideApprovalResult> {
  const { service, actor, requestId, action, via } = input;
  const note = input.note && input.note.length > 0 ? input.note : null;

  // Read the subject BEFORE deciding. Two reasons: the audit row describes the
  // filing, not the request id, and after the RPC the row we would want to
  // describe may already have moved on.
  const { data: requestRow, error: requestErr } = await service
    .from('approval_requests')
    .select('id, flow, subject_type, subject_id, filed_by')
    .eq('id', requestId)
    .maybeSingle();
  if (requestErr) {
    console.error('[approvals] request read failed:', requestErr.message);
    return {
      ok: false,
      status: 500,
      body: { error: 'Could not open that request. Please try again.' },
    };
  }
  if (!requestRow) {
    return {
      ok: false,
      status: 404,
      body: { error: APPROVAL_OUTCOME_MESSAGES.request_not_found },
    };
  }
  const subject = requestRow as unknown as {
    flow: string;
    subject_type: string;
    subject_id: string;
    filed_by?: string | null;
  };

  // ⚠ LOOKED UP BEFORE DECIDING, NOT AFTER. A subject nobody registered used to
  // be discovered once `approval_advance` had already committed, which left a
  // step decided with nothing done about it and an approver told "recorded,
  // tell an administrator" about a decision that should never have been taken.
  // Refusing here records nothing, so the step stays open for when the handler
  // exists.
  const handler = lookupHandler(subject.subject_type);
  if (!handler) {
    console.error(
      '[approvals] no handler for subject type; refused before deciding:',
      subject.subject_type,
      requestId
    );
    return {
      ok: false,
      status: 500,
      body: { error: SUBJECT_NOT_DECIDABLE },
    };
  }

  // ⚠ ALSO BEFORE DECIDING, for the same reason: a refusal here must leave the
  // step exactly as it was, open for the person who is allowed to decide it.
  const precheck = lookupPrecheck(subject.subject_type);
  if (precheck) {
    const refusal = await precheck({
      actor,
      requestId,
      flow: subject.flow,
      subjectId: subject.subject_id,
      filedBy: subject.filed_by ?? null,
      action,
    });
    if (refusal) {
      return { ok: false, status: refusal.status, body: refusal.body };
    }
  }

  const { data: rpcData, error: rpcError } = await service.rpc(
    'approval_advance',
    {
      p_request_id: requestId,
      p_actor: actor.id,
      p_actor_email: actor.email,
      p_action: action,
      p_note: note,
    }
  );

  if (rpcError) {
    console.error('[approvals] approval_advance failed:', rpcError.message);
    return {
      ok: false,
      status: 500,
      body: { error: 'Could not record that decision. Please try again.' },
    };
  }

  // `returns table` comes back as an array of one row.
  const result = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as {
    outcome: ApprovalOutcome;
    request_status: string | null;
    decided_stage_order: number | null;
    next_stage_order: number | null;
  } | null;

  if (!result) {
    console.error('[approvals] approval_advance returned nothing');
    return {
      ok: false,
      status: 500,
      body: { error: 'Could not record that decision. Please try again.' },
    };
  }

  if (!isDecidedOutcome(result.outcome)) {
    // ⚠ NONE OF THESE IS AN ERROR IN THE ORDINARY SENSE and the copy says so.
    // With several people on one step, being the second to click is the NORMAL
    // case. 409 rather than 500 because nothing went wrong — the world simply
    // moved while this screen was open. `already_approved` is the same: a
    // second click on a step that needs everyone, from somebody already done.
    const status =
      result.outcome === 'not_authorised'
        ? 403
        : result.outcome === 'request_not_found'
          ? 404
          : 409;
    return {
      ok: false,
      status,
      body: {
        error: APPROVAL_OUTCOME_MESSAGES[result.outcome],
        outcome: result.outcome,
      },
    };
  }
  const outcome = result.outcome;

  // ── Hand the landed decision to its subject ──────────────────────────────
  //
  // ⚠ EVERYTHING FROM HERE ON RUNS AFTER THE DECISION IS COMMITTED. A failure
  // below must never read as "nothing happened" — the approver would click
  // again and `approval_advance` would refuse them as already-decided. So every
  // failure path says the decision was recorded.
  let handled: SubjectHandlerResult;
  try {
    handled = await handler({
      service,
      actor,
      requestId,
      flow: subject.flow,
      subjectId: subject.subject_id,
      action,
      outcome,
      decidedStageOrder: result.decided_stage_order,
      nextStageOrder: result.next_stage_order,
      note,
      via,
    });
  } catch (e) {
    console.error(
      '[approvals] subject handler threw after the decision landed:',
      subject.subject_type,
      requestId,
      e instanceof Error ? e.message : String(e)
    );
    return {
      ok: false,
      status: 500,
      body: { error: DECISION_RECORDED_FOLLOW_UP_FAILED, outcome },
    };
  }

  if (!handled.ok) {
    return { ok: false, status: handled.status, body: handled.body };
  }

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      outcome,
      message: handled.message,
      requestStatus: result.request_status,
      nextStageOrder: result.next_stage_order,
      ...(handled.extra ?? {}),
    },
  };
}

// ── A step that moved on without a click ───────────────────────────────────

export type RunSubjectFollowUpParams = {
  service: SupabaseClient;
  /** The admin whose change to the step's people let it move on. */
  actor: DecideActor;
  requestId: string;
  outcome: Extract<ApprovalOutcome, 'advanced' | 'completed'>;
  decidedStageOrder: number | null;
  nextStageOrder: number | null;
  via: Extract<DecideVia, 'repoint'>;
};

/**
 * Run the subject's handler for a step that `approval_repoint_request_stage`
 * (migration 146) just closed — the school changed a live step's people or
 * rule, and its new terms were already met: everyone left on an "everyone"
 * step had approved, or somebody on a step relaxed to "any one of them" had.
 *
 * ⚠ THE SAME HANDLER A CLICK RUNS, so the parent's status moves, the register
 * is marked and the next step is emailed exactly as they would have been had
 * the last approver clicked. The action is 'approve' (nothing else closes a
 * step this way) and there is no note: nobody wrote one now.
 *
 * ⚠ THE ACTOR IS THE ADMIN, THE APPROVER IS WHOEVER THE STEP CLOSED IN THE
 * NAME OF. Both are handed on — `closedStepApprover` is read from the closed
 * step row here, once — so no handler writes the admin in as having approved.
 *
 * Never throws. The ladder has already moved; a failure here is logged, and
 * the repair scripts bring the subject back in line.
 */
export async function runSubjectFollowUp(
  params: RunSubjectFollowUpParams
): Promise<SubjectHandlerResult | null> {
  const { service, actor, requestId, outcome, via } = params;
  try {
    const { data, error } = await service
      .from('approval_requests')
      .select('id, flow, subject_type, subject_id')
      .eq('id', requestId)
      .maybeSingle();
    if (error || !data) {
      console.error(
        '[approvals] follow-up could not read the request:',
        requestId,
        error?.message ?? 'not found'
      );
      return null;
    }
    const subject = data as unknown as {
      flow: string;
      subject_type: string;
      subject_id: string;
    };
    const handler = lookupHandler(subject.subject_type);
    if (!handler) {
      console.error(
        '[approvals] follow-up has no handler for subject type:',
        subject.subject_type,
        requestId
      );
      return null;
    }
    const closedStepApprover = await loadClosedStepApprover(
      service,
      requestId,
      params.decidedStageOrder
    );
    const handled = await handler({
      service,
      actor,
      requestId,
      flow: subject.flow,
      subjectId: subject.subject_id,
      action: 'approve',
      outcome,
      decidedStageOrder: params.decidedStageOrder,
      nextStageOrder: params.nextStageOrder,
      note: null,
      via,
      closedStepApprover,
    });
    if (!handled.ok) {
      console.error(
        '[approvals] follow-up handler reported a failure:',
        requestId,
        handled.status,
        JSON.stringify(handled.body)
      );
    }
    return handled;
  } catch (e) {
    console.error(
      '[approvals] follow-up threw after the step moved on:',
      requestId,
      e instanceof Error ? e.message : String(e)
    );
    return null;
  }
}

/**
 * Who a step closed without a click stands in the name of — the closed step
 * row's own `decided_by` / `decided_by_email`.
 *
 * ⚠ NULL, NOT THE ADMIN, WHEN IT CANNOT BE READ. A handler with no approver to
 * name says less; one handed the admin says something false.
 */
async function loadClosedStepApprover(
  service: SupabaseClient,
  requestId: string,
  stageOrder: number | null
): Promise<{ id: string | null; email: string | null } | null> {
  if (stageOrder == null) return null;
  const { data, error } = await service
    .from('approval_request_stages')
    .select('decided_by, decided_by_email')
    .eq('request_id', requestId)
    .eq('stage_order', stageOrder)
    .maybeSingle();
  if (error || !data) {
    console.error(
      '[approvals] follow-up could not read who the closed step stands in the name of:',
      requestId,
      stageOrder,
      error?.message ?? 'not found'
    );
    return null;
  }
  const row = data as unknown as {
    decided_by: string | null;
    decided_by_email: string | null;
  };
  return { id: row.decided_by, email: row.decided_by_email };
}
