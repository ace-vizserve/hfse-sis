import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { openApprovalRequest } from '@/lib/approvals/materialise';
import { logAction } from '@/lib/audit/log-action';
import type { Role } from '@/lib/auth/roles';
import { isEmptyRichText } from '@/lib/rich-text';
import {
  APPROVAL_NOTE_MAX,
  type ApproverLevelScope,
  SOW_APPROVAL_FLOW,
} from '@/lib/schemas/approval-flows';
import { SOW_APPROVAL_SUBJECT_TYPE } from '@/lib/sow/access';
import type { SowActor } from '@/lib/sow/create';
import { authorizeEdit } from '@/lib/sow/edit';
import { listSubjectHeads, subjectHeadPool } from '@/lib/sow/subject-heads';
import { loadTermWeeks } from '@/lib/sow/weeks';

// Sending a scheme of work for review, and reopening an approved one — the
// SOW's side of the shared approval engine (KD #196). What each DECISION does
// to the scheme is `lib/sow/approval-handler.ts`, registered in
// `lib/approvals/decide.ts`.
//
// ⚠ THE REQUEST'S SUBJECT IS THE SUBMISSION, NOT THE SCHEME. Every send writes
// a new `scheme_of_work_submissions` row and opens a request on it, so a resend
// after a return gets a fresh ladder that starts again at step 1 — the engine's
// unique (flow, subject_type, subject_id) index would refuse a second request
// on the scheme itself, and reopening the old one would carry its decided
// steps along.

/** One definition: `lib/sow/access.ts` reads it to find the current request. */
export const SOW_SUBJECT_TYPE = SOW_APPROVAL_SUBJECT_TYPE;

export const TOPIC_REQUIRED_MESSAGE =
  'Every week needs a topic before it can be sent.';
export const SURPLUS_WEEKS_MESSAGE =
  'Merge or delete the extra weeks from last year before sending it.';
export const NO_STEPS_MESSAGE =
  "Approval steps for schemes of work haven't been set up yet. Ask an SIS administrator.";
export const RETURN_NOTE_REQUIRED =
  'Say what needs changing before you return it.';
const SEND_FAILED_MESSAGE =
  'Could not send it for review. Nothing was sent. Please try again.';

export type SubmitSowResult =
  | {
      ok: true;
      submissionId: string;
      requestId: string;
      stalled: boolean;
      /** The live step's name when it has nobody on it, for the page's line. */
      stalledStep?: string;
    }
  | {
      ok: false;
      status: 403 | 404 | 409 | 422 | 423 | 500;
      error: string;
    };

/**
 * Mark a submission that never reached a ladder as cancelled. Best-effort: the
 * scheme itself was not touched, so a failure here leaves only a stray row.
 */
async function cancelSubmission(
  service: SupabaseClient,
  submissionId: string
): Promise<void> {
  const { error } = await service
    .from('scheme_of_work_submissions')
    .update({ outcome: 'cancelled' })
    .eq('id', submissionId);
  if (error) {
    console.error(
      '[sow.submit] could not cancel an unsent submission:',
      submissionId,
      error.message
    );
  }
}

export async function submitSow(
  service: SupabaseClient,
  actor: SowActor,
  sowId: string
): Promise<SubmitSowResult> {
  // Who may send is who may edit: a substantive teacher of the subject on one
  // of its classes, while it is a draft or returned (404 / 403 / 423).
  const auth = await authorizeEdit(service, actor, sowId);
  if (!auth.ok) {
    return {
      ok: false,
      status: auth.status as 403 | 404 | 423,
      error: auth.error,
    };
  }
  const sow = auth.sow;

  // ── Every term week has a topic ──────────────────────────────────────────
  //
  // Term weeks only: a surplus week (beyond the term's count, left over from a
  // copy) is the teacher's to merge or delete, not a week anyone teaches —
  // and it must be gone before the scheme is sent (checked next).
  const [{ weeks: termWeeks }, weekRes, levelRes] = await Promise.all([
    loadTermWeeks(service, sow.term_id, sow.level_id),
    service
      .from('scheme_of_work_weeks')
      .select(
        'week_number, topic, learning_outcomes, textbook_pages, activities, assessment, remarks'
      )
      .eq('sow_id', sowId),
    service
      .from('levels')
      .select('level_type')
      .eq('id', sow.level_id)
      .maybeSingle(),
  ]);
  if (weekRes.error) throw new Error(weekRes.error.message);
  if (levelRes.error) throw new Error(levelRes.error.message);
  const topicByWeek = new Map(
    (
      (weekRes.data ?? []) as { week_number: number; topic: string | null }[]
    ).map((w) => [w.week_number, w.topic])
  );
  const termWeekNumbers = new Set(
    termWeeks.flatMap((w) => (w.kind === 'week' ? [w.weekNumber] : []))
  );
  const missingTopic = [...termWeekNumbers].some((n) => {
    const topic = topicByWeek.get(n);
    return !topic || topic.trim() === '';
  });
  if (missingTopic) {
    return { ok: false, status: 422, error: TOPIC_REQUIRED_MESSAGE };
  }

  // ⚠ NO SURPLUS WEEKS IN WHAT IS SENT. The approved snapshot is taken from
  // the stored rows, and next year's copy reads it, so a week the term does
  // not have would be signed off and carried forward (controller ruling,
  // Task 9 review).
  if ([...topicByWeek.keys()].some((n) => !termWeekNumbers.has(n))) {
    return { ok: false, status: 422, error: SURPLUS_WEEKS_MESSAGE };
  }

  const rawLevelType = (levelRes.data as { level_type: string | null } | null)
    ?.level_type;
  const levelType: ApproverLevelScope | null =
    rawLevelType === 'primary' ||
    rawLevelType === 'secondary' ||
    rawLevelType === 'preschool'
      ? rawLevelType
      : null;
  const headLevelType =
    levelType === 'primary' || levelType === 'secondary' ? levelType : null;

  // ── 1. The submission ────────────────────────────────────────────────────
  const { data: created, error: createErr } = await service
    .from('scheme_of_work_submissions')
    .insert({ sow_id: sowId, submitted_by: actor.id })
    .select('id')
    .single();
  if (createErr) throw new Error(createErr.message);
  const submissionId = (created as { id: string }).id;

  // ── 2. The request ───────────────────────────────────────────────────────
  //
  // ⚠ ONLY THE SENDER IS EXCLUDED. The subject-heads re-point leaves out only
  // `filed_by`, so any other id excluded here would be put back on the pool
  // the next time somebody edits the heads.
  let opened;
  try {
    const heads = await listSubjectHeads(service);
    opened = await openApprovalRequest(service, {
      flow: SOW_APPROVAL_FLOW,
      subjectType: SOW_SUBJECT_TYPE,
      subjectId: submissionId,
      // The SOW flow has no form adviser step (resolversForFlow), so a request
      // about a teacher's plan needs no class.
      sectionId: null,
      levelType,
      filedBy: actor.id,
      filedByEmail: actor.email ?? '',
      subjectHeadPool: subjectHeadPool(heads, sow.subject_id, headLevelType),
      excludeUserIds: [actor.id],
    });
  } catch (e) {
    await cancelSubmission(service, submissionId);
    throw e;
  }

  if (!opened.opened) {
    await cancelSubmission(service, submissionId);
    if (opened.reason === 'no_stages_configured') {
      return { ok: false, status: 422, error: NO_STEPS_MESSAGE };
    }
    // `already_open` cannot happen on a fresh submission id, and
    // `derived_stage_without_section` cannot happen on a flow that refuses
    // form adviser steps. Either is a bug, not a state.
    console.error(
      '[sow.submit] the request could not be opened:',
      submissionId,
      opened.reason
    );
    return { ok: false, status: 500, error: SEND_FAILED_MESSAGE };
  }
  const requestId = opened.requestId;

  // ── 3. The scheme ────────────────────────────────────────────────────────
  //
  // ⚠ PINNED TO THE STATE IT WAS READ IN. Two sends that start together both
  // pass the checks above; only one may move the scheme, and the other's
  // request is withdrawn so no approver sees a ladder for a send that lost.
  const previousState = sow.state;
  const nowIso = new Date().toISOString();
  const { data: moved, error: moveErr } = await service
    .from('schemes_of_work')
    .update({
      state: 'in_review',
      current_submission_id: submissionId,
      updated_at: nowIso,
    })
    .eq('id', sowId)
    .eq('state', previousState)
    .select('id');
  if (moveErr || !moved || moved.length === 0) {
    await withdrawRequest(service, requestId);
    await cancelSubmission(service, submissionId);
    if (moveErr) throw new Error(moveErr.message);
    return {
      ok: false,
      status: 409,
      error:
        'Someone else sent or changed this scheme of work a moment ago. Reload to see where it is.',
    };
  }

  // A live step with nobody on it waits, visibly (KD #196: a stall is never a
  // skip). The page says so rather than "sent" and nothing more.
  const { data: liveStage } = await service
    .from('approval_request_stages')
    .select('label, approver_pool, resolver')
    .eq('request_id', requestId)
    .eq('stage_order', 1)
    .maybeSingle();
  const live = liveStage as {
    label: string;
    approver_pool: string[] | null;
    resolver: string;
  } | null;
  const stalled =
    live != null &&
    live.resolver === 'named' &&
    (live.approver_pool ?? []).length === 0;

  await logAction({
    service,
    actor: { id: actor.id, email: actor.email, role: actor.role ?? null },
    action: 'sow.submit',
    entityType: 'scheme_of_work',
    entityId: sowId,
    context: {
      submission_id: submissionId,
      request_id: requestId,
      resend: previousState === 'returned',
      stage_count: opened.stageCount,
      stalled,
    },
  });

  return {
    ok: true,
    submissionId,
    requestId,
    stalled,
    ...(stalled && live ? { stalledStep: live.label } : {}),
  };
}

/** Withdraw a request whose send lost a race. Logged, never thrown. */
async function withdrawRequest(
  service: SupabaseClient,
  requestId: string
): Promise<void> {
  try {
    const { error } = await service.rpc('approval_cancel', {
      p_request_id: requestId,
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error(
      '[sow.submit] could not withdraw the request of a send that lost a race:',
      requestId,
      e instanceof Error ? e.message : String(e)
    );
  }
}

// ── Reopen ──────────────────────────────────────────────────────────────────

export const REOPEN_ROLES: readonly Role[] = [
  'academic_coordinator',
  'school_admin',
  'superadmin',
];

export type ReopenSowResult =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

/**
 * Put an approved scheme back to draft so its teachers can change it.
 *
 * ⚠ THE APPROVED SNAPSHOT STAYS. Relief notes, the weekly checks and next
 * year's "copy from last year" read what was signed off, and a reopened plan
 * has not been signed off again yet. The next approval replaces it.
 *
 * The reason is kept on the audit row (it says why the office reopened it,
 * not what the plan contains), and the page reads it back from there.
 */
export async function reopenSow(
  service: SupabaseClient,
  actor: SowActor,
  sowId: string,
  note: string
): Promise<ReopenSowResult> {
  if (!actor.role || !REOPEN_ROLES.includes(actor.role)) {
    return {
      ok: false,
      status: 403,
      error:
        'Only an academic coordinator or a school administrator can reopen a scheme of work.',
    };
  }
  const reason = note.trim();
  if (isEmptyRichText(reason)) {
    return { ok: false, status: 400, error: 'Say why it is being reopened.' };
  }
  if (reason.length > APPROVAL_NOTE_MAX) {
    return {
      ok: false,
      status: 400,
      error: `Keep the note to ${APPROVAL_NOTE_MAX} characters or fewer.`,
    };
  }

  const { data, error } = await service
    .from('schemes_of_work')
    .select('id, state')
    .eq('id', sowId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    return {
      ok: false,
      status: 404,
      error: 'That scheme of work could not be found.',
    };
  }
  if ((data as { state: string }).state !== 'approved') {
    return {
      ok: false,
      status: 409,
      error: 'Only an approved scheme of work can be reopened.',
    };
  }

  const { data: moved, error: moveErr } = await service
    .from('schemes_of_work')
    .update({ state: 'draft', updated_at: new Date().toISOString() })
    .eq('id', sowId)
    .eq('state', 'approved')
    .select('id');
  if (moveErr) throw new Error(moveErr.message);
  if (!moved || moved.length === 0) {
    return {
      ok: false,
      status: 409,
      error: 'Only an approved scheme of work can be reopened.',
    };
  }

  await logAction({
    service,
    actor: { id: actor.id, email: actor.email, role: actor.role ?? null },
    action: 'sow.reopen',
    entityType: 'scheme_of_work',
    entityId: sowId,
    context: { note: reason },
  });
  return { ok: true };
}
