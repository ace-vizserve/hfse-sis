import 'server-only';

import { after } from 'next/server';

import { requireCurrentAyCode } from '@/lib/academic-year';
import { logAction } from '@/lib/audit/log-action';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import type {
  SubjectHandler,
  SubjectHandlerContext,
  SubjectHandlerResult,
  SubjectPrecheck,
} from '@/lib/approvals/decide';
import {
  loadGradeChangeStepRecipients,
  sendGradeChangeStepEmails,
} from '@/lib/change-requests/approval-notify';
import {
  fetchLabels,
  fetchRegistrarEmails,
} from '@/lib/change-requests/labels';
import {
  notifyRequestApproved,
  notifyRequestRejected,
} from '@/lib/notifications/email-change-request';
import {
  GRADE_CHANGE_AEB_APPROVAL_FLOW,
  GRADE_CHANGE_APPROVAL_FLOW,
  type GradeChangeApprovalFlow,
} from '@/lib/schemas/approval-flows';
import { APPROVAL_OUTCOME_MESSAGES } from '@/lib/approvals/state-machine';
import { buildGradeChangeProjectionPatch } from '@/lib/change-requests/approval-projection';

// What happens to a grade change request once one of its approval steps has
// been decided. Registered in `lib/approvals/decide.ts` under
// `grade_change_request`; the pipeline there has already committed the decision
// before this runs.
//
// ⚠ ONLY REQUESTS FILED ON THE LADDER COME THROUGH HERE. A row with a null
// `approval_flow` was filed before migration 144 and is decided by
// `lib/change-requests/decide.ts`, untouched. The engine only ever holds
// requests for rows that have a flow, so the two paths cannot cross.

type GradeChangeRow = {
  id: string;
  grading_sheet_id: string;
  grade_entry_id: string;
  field_changed: string;
  slot_index: number | null;
  current_value: string | null;
  proposed_value: string;
  reason_category: string;
  justification: string;
  requested_by_email: string;
  requested_at: string;
  reviewed_by_email: string | null;
  decision_note: string | null;
};

const ROW_COLUMNS =
  'id, grading_sheet_id, grade_entry_id, field_changed, slot_index, current_value, proposed_value, reason_category, justification, requested_by_email, requested_at, reviewed_by_email, decision_note';

/** Shown when the decision landed but the teacher's copy of it did not move. */
export const GRADE_CHANGE_PROJECTION_FAILED =
  'The decision was recorded, but the teacher may not see it yet. Tell an administrator.';

function asGradeChangeFlow(flow: string): GradeChangeApprovalFlow | null {
  return flow === GRADE_CHANGE_APPROVAL_FLOW ||
    flow === GRADE_CHANGE_AEB_APPROVAL_FLOW
    ? flow
    : null;
}

/** Said to a teacher who tries to decide a step of their own request. */
export const OWN_GRADE_CHANGE_REFUSAL =
  'You filed this request, so someone else has to approve it.';

/**
 * Nobody decides a step of a grade change they filed themselves.
 *
 * ⚠ THE FILING ROUTE ALREADY LEAVES THE FILER OFF EVERY NAMED STEP, so this is
 * the only thing standing on a FORM ADVISER step. Those work out their people
 * when somebody acts, and a teacher filing a change for their own advisory
 * class is exactly who that step would admit. Runs before `approval_advance`,
 * so the step stays open for somebody else — and it covers the in-app button
 * and the email link alike, because both come through `decideApproval`.
 *
 * Approve and reject alike: turning down your own request is not a decision
 * about it; withdrawing it is, and that is the Cancel button.
 */
export const gradeChangeApprovalPrecheck: SubjectPrecheck = (ctx) => {
  if (ctx.filedBy != null && ctx.filedBy === ctx.actor.id) {
    return {
      status: 403,
      body: { error: OWN_GRADE_CHANGE_REFUSAL, outcome: 'not_authorised' },
    };
  }
  return null;
};

export const gradeChangeApprovalHandler: SubjectHandler = async (
  ctx: SubjectHandlerContext
): Promise<SubjectHandlerResult> => {
  const { service, actor, requestId, flow, subjectId, outcome, note } = ctx;
  const nowIso = new Date().toISOString();

  // ── Project the outcome onto the request the teacher watches ─────────────
  //
  // It moves ONLY when the ladder is finished. 'advanced' means one step said
  // yes and the next has not, which to the teacher is still "waiting for
  // approval", because it is. 'recorded' (migration 145) moves even less: one
  // person on a step that needs everyone said yes, and the step itself has
  // not moved — no projection, no email, only the audit row below.
  //
  // ⚠ Pinned to status 'pending'. A row that has already left pending while
  // its ladder was still open is drift, not a second decision to overwrite —
  // so zero rows updated is reported as a failure, the same as an error.
  //
  // ⚠ ONE EXCEPTION: A ROW ALREADY CARRYING THIS OUTCOME. The teacher's Cancel
  // can reach the closed ladder in the moment between `approval_advance`
  // committing and this write, and it writes the same outcome onto the row
  // from the engine's record (lib/change-requests/decide.ts,
  // `settleClosedLadder`) rather than tell her "decided" over a row still
  // reading pending. That is this decision, already projected — so the audit
  // row and the emails below still belong to it, and are still sent from here.
  //
  // ⚠ A STEP CLOSED BY AN APPROVER CHANGE (`via: 'repoint'`) IS NOBODY'S
  // CLICK. `actor` is then the admin who took somebody off the step or relaxed
  // its rule — not an approver — and writing them into `reviewed_by` would put
  // their name on the teacher's "approved by" email and on the apply reference
  // for a change they never approved. The reviewer is projected from the
  // closed step instead, the same record the repair path reads
  // (`buildGradeChangeProjectionPatch`).
  const closedByStepEdit = ctx.via === 'repoint';
  let row: GradeChangeRow | null = null;
  if (outcome === 'completed' || outcome === 'rejected') {
    const targetStatus = outcome === 'completed' ? 'approved' : 'rejected';
    let patch: Record<string, unknown>;
    if (closedByStepEdit) {
      const built = await buildGradeChangeProjectionPatch(
        service,
        requestId,
        targetStatus
      );
      if (!built.ok) {
        console.error(
          '[approvals] grade change reviewer could not be read from the closed step:',
          subjectId,
          built.message
        );
        return {
          ok: false,
          status: 500,
          body: { error: GRADE_CHANGE_PROJECTION_FAILED, outcome },
        };
      }
      patch = built.patch;
    } else {
      patch = {
        status: targetStatus,
        reviewed_by: actor.id,
        reviewed_by_email: actor.email ?? '(unknown)',
        reviewed_at: nowIso,
      };
      if (outcome === 'completed') patch.approved_at = nowIso;
      else patch.decision_note = note;
    }

    const { data, error } = await service
      .from('grade_change_requests')
      .update(patch)
      .eq('id', subjectId)
      .eq('status', 'pending')
      .select(ROW_COLUMNS)
      .maybeSingle();

    let projected = (data ?? null) as unknown as GradeChangeRow | null;
    if (!error && !projected) {
      const { data: current } = await service
        .from('grade_change_requests')
        .select(`${ROW_COLUMNS}, status`)
        .eq('id', subjectId)
        .maybeSingle();
      const already = current as (GradeChangeRow & { status?: string }) | null;
      if (already?.status === targetStatus) projected = already;
    }

    if (error || !projected) {
      console.error(
        '[approvals] grade change status projection failed:',
        subjectId,
        error?.message ?? 'no pending row to update'
      );
      return {
        ok: false,
        status: 500,
        body: { error: GRADE_CHANGE_PROJECTION_FAILED, outcome },
      };
    }
    row = projected;
  } else {
    const { data } = await service
      .from('grade_change_requests')
      .select(ROW_COLUMNS)
      .eq('id', subjectId)
      .maybeSingle();
    row = (data ?? null) as GradeChangeRow | null;
  }

  // ── Audit ────────────────────────────────────────────────────────────────
  //
  // `grade_change_approved` for every yes, with `final` telling a step apart
  // from the whole request — the audit page reads that to say "Approved step 2
  // of a grade change request" rather than claiming the change was approved.
  // The decision note is logged as the legacy path logs it.
  await logAction({
    service,
    actor: { id: actor.id, email: actor.email, role: actor.role },
    action:
      ctx.action === 'approve'
        ? 'grade_change_approved'
        : 'grade_change_rejected',
    entityType: 'grade_change_request',
    entityId: subjectId,
    context: {
      request_id: requestId,
      flow,
      outcome,
      final: outcome === 'completed',
      stage_order: ctx.decidedStageOrder,
      next_stage_order: ctx.nextStageOrder,
      grading_sheet_id: row?.grading_sheet_id ?? null,
      grade_entry_id: row?.grade_entry_id ?? null,
      field: row?.field_changed ?? null,
      slot_index: row?.slot_index ?? null,
      proposed: row?.proposed_value ?? null,
      decision_note: note,
      via: ctx.via,
      // ⚠ The actor above is the admin whose change let the step finish, so
      // the row says so and names the approval it finished on. The audit page
      // reads these to say "finished after an approver change (last approval
      // by …)" rather than "Fully approved" in the admin's name.
      ...(closedByStepEdit
        ? {
            closed_by_step_edit: true,
            final_approver_email:
              ctx.closedStepApprover?.email ?? row?.reviewed_by_email ?? null,
          }
        : {}),
    },
  });

  // The same tag the legacy decision path busts — the change-request queue,
  // the sheet's open-requests banner and the markbook drill cards read it.
  try {
    invalidateDrillTags('markbook', await requireCurrentAyCode(service));
  } catch (e) {
    // A missing current AY should not swallow a decision that already landed.
    console.error(
      '[approvals] cache invalidation skipped:',
      e instanceof Error ? e.message : String(e)
    );
  }

  // ── Emails ───────────────────────────────────────────────────────────────
  const gradeFlow = asGradeChangeFlow(flow);
  if (outcome === 'advanced' && gradeFlow && ctx.nextStageOrder != null) {
    const nextStageOrder = ctx.nextStageOrder;
    after(async () => {
      try {
        const step = await loadGradeChangeStepRecipients(service, {
          flow: gradeFlow,
          gradeChangeRequestId: subjectId,
          stageOrder: nextStageOrder,
        });
        if (!step) {
          console.error(
            '[approvals] next grade change step not found for email',
            subjectId,
            nextStageOrder
          );
          return;
        }
        await sendGradeChangeStepEmails(service, {
          gradeChangeRequestId: subjectId,
          step,
        });
      } catch (e) {
        console.error('[approvals] next step email failed', e);
      }
    });
  } else if ((outcome === 'completed' || outcome === 'rejected') && row) {
    const decided = row;
    after(async () => {
      try {
        const labels = await fetchLabels(
          service as Parameters<typeof fetchLabels>[0],
          decided.grading_sheet_id,
          decided.grade_entry_id
        );
        const summary = {
          id: decided.id,
          grading_sheet_id: decided.grading_sheet_id,
          field_changed: decided.field_changed,
          current_value: decided.current_value,
          proposed_value: decided.proposed_value,
          reason_category: decided.reason_category,
          justification: decided.justification,
          requested_by_email: decided.requested_by_email,
          requested_at: decided.requested_at,
          reviewed_by_email: decided.reviewed_by_email,
          decision_note: decided.decision_note,
          student_label: labels.student_label,
          sheet_label: labels.sheet_label,
        };
        if (outcome === 'completed') {
          const registrarEmails = await fetchRegistrarEmails(
            service as Parameters<typeof fetchRegistrarEmails>[0]
          );
          await notifyRequestApproved(
            summary,
            decided.requested_by_email,
            registrarEmails
          );
        } else {
          await notifyRequestRejected(summary, decided.requested_by_email);
        }
      } catch (e) {
        console.error('[approvals] grade change decision email failed', e);
      }
    });
  }

  return { ok: true, message: decisionMessage(outcome) };
};

/** What the approver reads after clicking. Plain sentences, no jargon. */
export function decisionMessage(
  outcome: SubjectHandlerContext['outcome']
): string {
  if (outcome === 'advanced') {
    return 'Approved. It has moved on to the next step.';
  }
  if (outcome === 'completed') {
    return 'Approved. The teacher has been told, and the change can now be applied to the sheet.';
  }
  if (outcome === 'recorded') {
    return APPROVAL_OUTCOME_MESSAGES.recorded;
  }
  return 'Turned down. The teacher has been told, and the grade stays as it is.';
}
