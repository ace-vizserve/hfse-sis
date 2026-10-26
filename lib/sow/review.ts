import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  listInboxStagesAcrossFlows,
  loadLaddersBySubject,
  type RequestLadder,
} from '@/lib/approvals/inbox';
import { canDecideCurrentStep } from '@/lib/change-requests/staged-scope';
import type { ApprovalRailStage } from '@/lib/approvals/rail';
import { withApprovalProgress } from '@/lib/approvals/rail';
import type { Role } from '@/lib/auth/roles';
import { getStaffDisplayNameById } from '@/lib/auth/staff-list';
import { SOW_APPROVAL_FLOW } from '@/lib/schemas/approval-flows';
import { SOW_APPROVAL_SUBJECT_TYPE, type SowTrack } from '@/lib/sow/access';

// The review side of a scheme of work (Task 10): the "Waiting for you" queue,
// the ladder the SOW page draws, and the step names the teacher's list shows.
//
// ⚠ THE REQUEST'S SUBJECT IS THE SUBMISSION (lib/sow/approval.ts), so every
// read here goes submission → scheme, and a scheme that has been sent again
// since is judged by its CURRENT submission only. An old submission's request
// that is somehow still open is not a scheme waiting for anyone.

/** Staff names by account id. A lookup failure falls back to no names. */
async function namesById(): Promise<Map<string, string>> {
  try {
    return new Map(await getStaffDisplayNameById());
  } catch {
    return new Map();
  }
}

/**
 * When the live step started waiting: the moment the step before it was
 * decided, or the send itself for step 1.
 */
function liveSince(ladder: RequestLadder | undefined, stageOrder: number) {
  const before = ladder?.stages.find((s) => s.stageOrder === stageOrder - 1);
  return before?.decidedAt ?? ladder?.filedAt ?? null;
}

// ── The queue ───────────────────────────────────────────────────────────────

export type SowQueueRow = {
  sowId: string;
  requestId: string;
  subjectName: string;
  levelLabel: string;
  track: SowTrack;
  termNumber: number;
  classes: string[];
  /** Who sent it. */
  teacher: string;
  /** The step it is waiting on — the viewer's. */
  step: string;
  /** ISO moment the step became the viewer's. */
  waitingSince: string | null;
};

/**
 * One row per scheme of work whose LIVE step this person may decide.
 *
 * ⚠ ASKED WITH `role: null`, AS THE HOME TO-DO ASKS. An office role widens
 * what the inbox returns (every open step in the school) but never what it
 * lets them decide, and this queue is only the second: "waiting for you".
 */
export async function listSowReviewQueue(
  service: SupabaseClient,
  viewer: { userId: string; role: Role | null }
): Promise<SowQueueRow[]> {
  const stages = (
    await listInboxStagesAcrossFlows(service, {
      flows: [SOW_APPROVAL_FLOW],
      userId: viewer.userId,
      role: null,
    })
  ).filter((s) => s.canDecide && s.subjectType === SOW_APPROVAL_SUBJECT_TYPE);
  if (stages.length === 0) return [];

  const submissionIds = [...new Set(stages.map((s) => s.subjectId))];
  const { data: subs, error: subErr } = await service
    .from('scheme_of_work_submissions')
    .select('id, sow_id, submitted_by')
    .in('id', submissionIds);
  if (subErr) throw new Error(subErr.message);
  const submissions = (subs ?? []) as {
    id: string;
    sow_id: string;
    submitted_by: string | null;
  }[];
  const sowIds = [...new Set(submissions.map((s) => s.sow_id))];
  if (sowIds.length === 0) return [];

  const { data: schemeRows, error: sowErr } = await service
    .from('schemes_of_work')
    .select(
      'id, state, current_submission_id, subject_id, level_id, term_id, track, scheme_of_work_classes(section_id)'
    )
    .in('id', sowIds);
  if (sowErr) throw new Error(sowErr.message);
  type Scheme = {
    id: string;
    state: string;
    current_submission_id: string | null;
    subject_id: string;
    level_id: string;
    term_id: string;
    track: SowTrack;
    scheme_of_work_classes: { section_id: string }[] | null;
  };
  const schemes = (schemeRows ?? []) as Scheme[];
  const schemeById = new Map(schemes.map((s) => [s.id, s]));

  const ids = (pick: (s: Scheme) => string[]) => [
    ...new Set(schemes.flatMap(pick)),
  ];
  const [subjects, levels, terms, sections, ladders, names] = await Promise.all(
    [
      service
        .from('subjects')
        .select('id, name')
        .in(
          'id',
          ids((s) => [s.subject_id])
        ),
      service
        .from('levels')
        .select('id, label')
        .in(
          'id',
          ids((s) => [s.level_id])
        ),
      service
        .from('terms')
        .select('id, term_number')
        .in(
          'id',
          ids((s) => [s.term_id])
        ),
      service
        .from('sections')
        .select('id, name')
        .in(
          'id',
          ids((s) => (s.scheme_of_work_classes ?? []).map((c) => c.section_id))
        ),
      loadLaddersBySubject(service, {
        flow: SOW_APPROVAL_FLOW,
        subjectType: SOW_APPROVAL_SUBJECT_TYPE,
        subjectIds: submissionIds,
      }),
      namesById(),
    ] as const
  );
  for (const r of [subjects, levels, terms, sections]) {
    if (r.error) throw new Error(r.error.message);
  }
  const nameOf = <T extends { id: string }>(
    rows: T[] | null,
    key: keyof T
  ): Map<string, string> =>
    new Map((rows ?? []).map((r) => [r.id, String(r[key])]));
  const subjectName = nameOf(
    subjects.data as { id: string; name: string }[] | null,
    'name'
  );
  const levelLabel = nameOf(
    levels.data as { id: string; label: string }[] | null,
    'label'
  );
  const termNumber = nameOf(
    terms.data as { id: string; term_number: number }[] | null,
    'term_number'
  );
  const sectionName = nameOf(
    sections.data as { id: string; name: string }[] | null,
    'name'
  );
  const submissionById = new Map(submissions.map((s) => [s.id, s]));

  const rows: SowQueueRow[] = [];
  for (const stage of stages) {
    const submission = submissionById.get(stage.subjectId);
    const scheme = submission ? schemeById.get(submission.sow_id) : undefined;
    // Sent again, or already settled: not this request's scheme any more.
    if (
      !submission ||
      !scheme ||
      scheme.state !== 'in_review' ||
      scheme.current_submission_id !== submission.id
    ) {
      continue;
    }
    rows.push({
      sowId: scheme.id,
      requestId: stage.requestId,
      subjectName: subjectName.get(scheme.subject_id) ?? '',
      levelLabel: levelLabel.get(scheme.level_id) ?? '',
      track: scheme.track,
      termNumber: Number(termNumber.get(scheme.term_id) ?? 0),
      classes: (scheme.scheme_of_work_classes ?? [])
        .map((c) => sectionName.get(c.section_id) ?? '')
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
      teacher:
        (submission.submitted_by && names.get(submission.submitted_by)) ||
        stage.filedByEmail ||
        'A teacher',
      step: stage.label,
      waitingSince: liveSince(ladders.get(submission.id), stage.stageOrder),
    });
  }
  // Longest-waiting first: the queue is a to-do list.
  return rows.sort((a, b) =>
    (a.waitingSince ?? '').localeCompare(b.waitingSince ?? '')
  );
}

// ── One scheme's ladder, for its page ───────────────────────────────────────

export type SowReview = {
  /** `approval_requests.id` — what the decide route takes. */
  requestId: string;
  stages: ApprovalRailStage[];
  peopleByStageOrder: Record<number, string>;
  decidedByNames: Record<number, string>;
  /** Who sent this submission, and when. */
  sentBy: string | null;
  sentAt: string;
  /** The step it waits on now, while it is in review. */
  live: {
    label: string;
    stageOrder: number;
    since: string | null;
    /** Nobody is on the step, so it will not move (KD #196: said out loud). */
    empty: boolean;
    /** It is the last step, so deciding it approves the scheme. */
    isLast: boolean;
  } | null;
  /** This viewer may decide the live step now. */
  canDecide: boolean;
  /** The step that returned it, when it was returned. */
  returnedBy: string | null;
};

/**
 * The ladder of the scheme's current submission, as the SOW page draws it.
 * Null when it has never been sent (no submission, or no request on it).
 */
export async function loadSowReview(
  service: SupabaseClient,
  viewerId: string,
  submissionId: string | null
): Promise<SowReview | null> {
  if (!submissionId) return null;
  const [ladders, names] = await Promise.all([
    loadLaddersBySubject(service, {
      flow: SOW_APPROVAL_FLOW,
      subjectType: SOW_APPROVAL_SUBJECT_TYPE,
      subjectIds: [submissionId],
    }),
    namesById(),
  ]);
  const ladder = ladders.get(submissionId);
  if (!ladder) return null;

  const live =
    ladder.status === 'pending'
      ? (ladder.stages.find((s) => s.status === 'pending') ?? null)
      : null;
  const last = ladder.stages[ladder.stages.length - 1];
  const rejected = ladder.stages.find((s) => s.status === 'rejected');

  // The shared rule (never the sender, never someone who already decided, a
  // named step's pool). No advised classes: the SOW flow has no form adviser
  // step — a subject head step is resolved to names when it is sent.
  const canDecide = canDecideCurrentStep(ladder, viewerId, new Set());

  const railStages: ApprovalRailStage[] = ladder.stages.map((s) => ({
    stageOrder: s.stageOrder,
    label: s.label,
    resolver: s.resolver,
    status: s.status,
    decidedAt: s.decidedAt,
    decisionNote: s.decisionNote,
  }));

  return {
    requestId: ladder.requestId,
    stages: withApprovalProgress(railStages, ladder.stages, names),
    peopleByStageOrder: Object.fromEntries(
      ladder.stages.map((s) => [
        s.stageOrder,
        s.approverPool
          .map((id) =>
            id === viewerId ? 'You' : (names.get(id) ?? '(account removed)')
          )
          .join(', '),
      ])
    ),
    decidedByNames: Object.fromEntries(
      ladder.stages
        .filter((s) => s.decidedBy)
        .map((s) => [
          s.stageOrder,
          s.decidedBy === viewerId
            ? 'you'
            : (names.get(s.decidedBy as string) ??
              s.decidedByEmail ??
              'someone'),
        ])
    ),
    sentBy: ladder.filedBy
      ? ladder.filedBy === viewerId
        ? 'you'
        : (names.get(ladder.filedBy) ?? ladder.filedByEmail)
      : ladder.filedByEmail || null,
    sentAt: ladder.filedAt,
    live: live
      ? {
          label: live.label,
          stageOrder: live.stageOrder,
          since: liveSince(ladder, live.stageOrder),
          empty: live.approverPool.length === 0,
          isLast: last?.stageOrder === live.stageOrder,
        }
      : null,
    canDecide,
    returnedBy: rejected?.label ?? null,
  };
}

/**
 * The first step a send starts at, as configured now — what "it starts over
 * from the …" names on a returned scheme. Null when no steps are set up.
 */
export async function loadFirstSowStepLabel(
  service: SupabaseClient
): Promise<string | null> {
  const { data, error } = await service
    .from('approval_stages')
    .select('label, stage_order')
    .eq('flow', SOW_APPROVAL_FLOW)
    .eq('is_active', true)
    .order('stage_order', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as { label: string } | null)?.label ?? null;
}

/**
 * For the teacher's list: the step each scheme waits on (in review) or the
 * step that returned it (returned), keyed by submission id. Three reads for
 * the whole list.
 */
export async function loadSowStepLabels(
  service: SupabaseClient,
  submissionIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(submissionIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const ladders = await loadLaddersBySubject(service, {
    flow: SOW_APPROVAL_FLOW,
    subjectType: SOW_APPROVAL_SUBJECT_TYPE,
    subjectIds: ids,
  });
  for (const [submissionId, ladder] of ladders) {
    const step =
      ladder.stages.find((s) => s.status === 'pending') ??
      ladder.stages.find((s) => s.status === 'rejected');
    if (step) out.set(submissionId, step.label);
  }
  return out;
}
