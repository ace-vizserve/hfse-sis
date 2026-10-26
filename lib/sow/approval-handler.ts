import 'server-only';

import type {
  SubjectHandler,
  SubjectHandlerContext,
  SubjectHandlerResult,
  SubjectPrecheck,
} from '@/lib/approvals/decide';
import { APPROVAL_OUTCOME_MESSAGES } from '@/lib/approvals/state-machine';
import { logAction } from '@/lib/audit/log-action';
import { isEmptyRichText } from '@/lib/rich-text';
import { SowSnapshotSchema, type SowSnapshot } from '@/lib/schemas/sow';
import { RETURN_NOTE_REQUIRED } from '@/lib/sow/approval';

// What happens to a scheme of work once one step of its approval has been
// decided. Registered in `lib/approvals/decide.ts` under
// `scheme_of_work_submission`; the pipeline there has already committed the
// decision before this runs, so the scheme follows the ENGINE's outcome and
// never anything the client sent.
//
// The subject is the submission (lib/sow/approval.ts); its row says which
// scheme it is.

export const OWN_SOW_REFUSAL =
  'You sent this scheme of work, so someone else has to approve it.';

/**
 * Before anything is decided: the teacher who sent it never decides it, and a
 * return always says what to change.
 *
 * ⚠ THE FILER IS ALREADY OFF EVERY POOL (`excludeUserIds`, and the subject
 * head re-point drops `filed_by`), so the first rule only matters if a pool
 * was edited some other way — the same belt-and-braces the grade change has.
 */
export const sowApprovalPrecheck: SubjectPrecheck = (ctx) => {
  if (ctx.filedBy != null && ctx.filedBy === ctx.actor.id) {
    return {
      status: 403,
      body: { error: OWN_SOW_REFUSAL, outcome: 'not_authorised' },
    };
  }
  if (ctx.action === 'reject' && isEmptyRichText(ctx.note ?? '')) {
    return { status: 400, body: { error: RETURN_NOTE_REQUIRED } };
  }
  return null;
};

/** The request's own copy of a step's name, so a rename since reads as it was. */
async function loadStageLabel(
  service: SubjectHandlerContext['service'],
  requestId: string,
  stageOrder: number | null
): Promise<string | null> {
  if (stageOrder == null) return null;
  const { data } = await service
    .from('approval_request_stages')
    .select('label')
    .eq('request_id', requestId)
    .eq('stage_order', stageOrder)
    .maybeSingle();
  return (data as { label: string | null } | null)?.label ?? null;
}

type WeekRow = {
  week_number: number;
  topic: string | null;
  learning_outcomes: string | null;
  textbook_pages: string | null;
  activities: string | null;
  assessment: string | null;
  remarks: string | null;
};

const FOLLOW_UP_FAILED =
  'The decision was recorded, but the scheme of work could not be updated yet. Tell an administrator.';

export const sowApprovalHandler: SubjectHandler = async (
  ctx: SubjectHandlerContext
): Promise<SubjectHandlerResult> => {
  const { service, actor, requestId, flow, subjectId, outcome } = ctx;

  const { data: submission, error: subErr } = await service
    .from('scheme_of_work_submissions')
    .select('id, sow_id')
    .eq('id', subjectId)
    .maybeSingle();
  if (subErr) throw new Error(subErr.message);
  const sowId = (submission as { sow_id: string } | null)?.sow_id ?? null;

  const [decidedLabel, nextLabel] = await Promise.all([
    loadStageLabel(service, requestId, ctx.decidedStageOrder),
    outcome === 'advanced'
      ? loadStageLabel(service, requestId, ctx.nextStageOrder)
      : Promise.resolve(null),
  ]);

  // ⚠ THE WEEK COMES FROM THE APPROVER'S BODY, so it is kept only when this
  // scheme has that week. A number it does not have would point the teacher's
  // page at nothing; the return still lands, just without a week.
  let weekNumber: number | null = null;
  if (ctx.action === 'reject' && ctx.weekNumber != null && sowId) {
    const { data: weekRow } = await service
      .from('scheme_of_work_weeks')
      .select('week_number')
      .eq('sow_id', sowId)
      .eq('week_number', ctx.weekNumber)
      .maybeSingle();
    weekNumber = weekRow ? ctx.weekNumber : null;
  }

  const audit = (
    action: 'sow.vet' | 'sow.approve' | 'sow.return',
    extra: Record<string, unknown> = {}
  ) =>
    logAction({
      service,
      actor: { id: actor.id, email: actor.email, role: actor.role },
      action,
      entityType: 'scheme_of_work',
      entityId: sowId,
      context: {
        submission_id: subjectId,
        request_id: requestId,
        flow,
        outcome,
        stage_order: ctx.decidedStageOrder,
        stage_label: decidedLabel,
        next_stage_order: ctx.nextStageOrder,
        next_stage_label: nextLabel,
        note_present: ctx.note != null,
        via: ctx.via,
        // ⚠ NOBODY CLICKED ON `via: 'repoint'` — the actor is the admin whose
        // change to the step let it finish; the approval it closed on is named.
        ...(ctx.via === 'repoint'
          ? {
              closed_by_step_edit: true,
              final_approver_email: ctx.closedStepApprover?.email ?? null,
            }
          : {}),
        ...extra,
      },
    });

  if (!sowId) {
    console.error('[sow.approval] no submission for the request:', requestId);
    await audit(
      outcome === 'rejected'
        ? 'sow.return'
        : outcome === 'completed'
          ? 'sow.approve'
          : 'sow.vet',
      { partial: true, failed_step: 'submission_missing' }
    );
    return {
      ok: false,
      status: 500,
      body: { error: FOLLOW_UP_FAILED, outcome },
    };
  }

  // ── A step passed and the next one is up (or one yes on an "everyone"
  // step): the scheme stays in review, so only the log moves.
  if (outcome === 'advanced' || outcome === 'recorded') {
    await audit('sow.vet');
    return {
      ok: true,
      message:
        outcome === 'advanced'
          ? nextLabel
            ? `Vetted — it's gone to ${nextLabel}.`
            : APPROVAL_OUTCOME_MESSAGES.advanced
          : APPROVAL_OUTCOME_MESSAGES.recorded,
    };
  }

  const nowIso = new Date().toISOString();

  if (outcome === 'completed') {
    // ── The last approval freezes what was signed off ────────────────────
    //
    // ⚠ VALIDATED AGAINST THE SAME SCHEMA "COPY FROM LAST YEAR" READS WITH
    // (lib/sow/create.ts). A snapshot it cannot parse would refuse next
    // year's copy with no way to fix it but by hand.
    const [{ data: sowRow, error: sowErr }, { data: weekRows, error: wErr }] =
      await Promise.all([
        service
          .from('schemes_of_work')
          .select('id, module')
          .eq('id', sowId)
          .maybeSingle(),
        service
          .from('scheme_of_work_weeks')
          .select(
            'week_number, topic, learning_outcomes, textbook_pages, activities, assessment, remarks'
          )
          .eq('sow_id', sowId)
          .order('week_number', { ascending: true }),
      ]);
    if (sowErr) throw new Error(sowErr.message);
    if (wErr) throw new Error(wErr.message);

    const candidate: SowSnapshot = {
      module:
        ((sowRow as { module: Record<string, unknown> | null } | null)
          ?.module as Record<string, unknown> | null) ?? {},
      weeks: ((weekRows ?? []) as WeekRow[])
        .slice()
        .sort((a, b) => a.week_number - b.week_number)
        .map((w) => ({
          weekNumber: w.week_number,
          topic: w.topic,
          learningOutcomes: w.learning_outcomes,
          textbookPages: w.textbook_pages,
          activities: w.activities,
          assessment: w.assessment,
          remarks: w.remarks,
        })),
    };
    const parsed = SowSnapshotSchema.safeParse(candidate);
    if (!parsed.success) {
      console.error(
        '[sow.approval] the approved snapshot did not validate:',
        sowId,
        parsed.error.issues[0]?.message
      );
      await audit('sow.approve', {
        partial: true,
        failed_step: 'snapshot_invalid',
      });
      return {
        ok: false,
        status: 500,
        body: { error: FOLLOW_UP_FAILED, outcome },
      };
    }

    const projected = await project(service, sowId, subjectId, {
      state: 'approved',
      approved_at: nowIso,
      approved_snapshot: parsed.data,
      updated_at: nowIso,
    });
    if (!projected) {
      await audit('sow.approve', {
        partial: true,
        failed_step: 'state_projection',
      });
      return {
        ok: false,
        status: 500,
        body: { error: FOLLOW_UP_FAILED, outcome },
      };
    }
    await settleSubmission(service, subjectId, { outcome: 'approved' });
    await audit('sow.approve', { week_count: parsed.data.weeks.length });
    return { ok: true, message: 'Approved.' };
  }

  // ── Returned ─────────────────────────────────────────────────────────────
  //
  // The note is the engine's decision note (the reason the precheck made
  // compulsory); it goes on the submission because that is what the teacher
  // reads beside the week. The audit row keeps only that there was one.
  const projected = await project(service, sowId, subjectId, {
    state: 'returned',
    updated_at: nowIso,
  });
  if (!projected) {
    await audit('sow.return', {
      partial: true,
      failed_step: 'state_projection',
      week_number: weekNumber,
    });
    return {
      ok: false,
      status: 500,
      body: { error: FOLLOW_UP_FAILED, outcome },
    };
  }
  await settleSubmission(service, subjectId, {
    outcome: 'returned',
    return_note: ctx.note,
    return_week_number: weekNumber,
  });
  await audit('sow.return', { week_number: weekNumber });
  return { ok: true, message: 'Returned to the teacher.' };
};

/**
 * Move the scheme, pinned to "in review on THIS submission". A scheme that has
 * moved on (sent again, or changed by hand) is drift, not a second decision to
 * write over it, so zero rows is a failure.
 */
async function project(
  service: SubjectHandlerContext['service'],
  sowId: string,
  submissionId: string,
  patch: Record<string, unknown>
): Promise<boolean> {
  const { data, error } = await service
    .from('schemes_of_work')
    .update(patch)
    .eq('id', sowId)
    .eq('current_submission_id', submissionId)
    .eq('state', 'in_review')
    .select('id');
  if (error) {
    console.error('[sow.approval] state projection failed:', error.message);
    return false;
  }
  if (!data || data.length === 0) {
    console.error(
      '[sow.approval] the scheme was not in review on this submission:',
      sowId,
      submissionId
    );
    return false;
  }
  return true;
}

/** The submission's outcome. Logged, not thrown: the scheme already moved. */
async function settleSubmission(
  service: SubjectHandlerContext['service'],
  submissionId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const { error } = await service
    .from('scheme_of_work_submissions')
    .update(patch)
    .eq('id', submissionId)
    .eq('outcome', 'pending');
  if (error) {
    console.error(
      '[sow.approval] submission outcome not written:',
      submissionId,
      error.message
    );
  }
}
