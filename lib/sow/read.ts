import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getStaffDisplayEntries } from '@/lib/auth/staff-list';
import { loadEffectiveAssignmentsForUser } from '@/lib/auth/teacher-assignments';
import { SOW_APPROVAL_FLOW } from '@/lib/schemas/approval-flows';
import {
  isOnCurrentApprovalStep,
  SOW_APPROVAL_SUBJECT_TYPE,
  type SowCapability,
  type SowKey,
  type SowState,
  sowCapability,
} from '@/lib/sow/access';
import { sgToday } from '@/lib/dates';
import { isSubjectRole } from '@/lib/schemas/teacher-assignment';
import { REOPEN_ROLES } from '@/lib/sow/approval';
import { loadSowChecking, type SowChecking } from '@/lib/sow/checks';
import type { SowActor } from '@/lib/sow/create';
import { inOversightScope, resolveOversightScope } from '@/lib/sow/oversight';
import {
  loadFirstSowStepLabel,
  loadSowReview,
  type SowReview,
} from '@/lib/sow/review';
import { loadTermWeeks, weekForDate } from '@/lib/sow/weeks';

// One scheme of work as the page reads it (Task 8): the module, the classes,
// every week with the term's events, and what the caller may do with it.

export type SowView = {
  id: string;
  key: SowKey;
  state: SowState;
  module: Record<string, unknown>;
  updatedAt: string;
  classes: { sectionId: string; name: string }[];
  weeks: {
    weekNumber: number;
    startsOn: string;
    endsOn: string;
    topic: string | null;
    learningOutcomes: string | null;
    textbookPages: string | null;
    activities: string | null;
    assessment: string | null;
    remarks: string | null;
    updatedAt: string;
    /** A stored week the term no longer reaches; it can be deleted. */
    isSurplus: boolean;
    events: string[];
  }[];
  /** Weeks of the term with no school day, between the numbered weeks. */
  breaks: { startsOn: string; endsOn: string; label: string | null }[];
  /** What the page prints: names for the ids in `key`, and the copy lines. */
  display: {
    subjectName: string;
    levelLabel: string;
    ayCode: string;
    termNumber: number;
    termStart: string | null;
    termEnd: string | null;
    /** "AY2025 Term 2 · Secondary 1 Science", when it was copied. */
    copiedFrom: string | null;
    /**
     * The note it came back with, while it is returned, and who returned it
     * when (null when the step's decider cannot be read).
     */
    returnNote: {
      note: string;
      weekNumber: number | null;
      by: string | null;
      at: string | null;
    } | null;
    /**
     * Set while it is a draft again after the office reopened it: who, when,
     * and the reason they gave (kept on the `sow.reopen` audit row).
     */
    reopened: { by: string; at: string; note: string | null } | null;
  };
  capability: SowCapability;
  /**
   * The current submission's ladder (Task 10) — where it is in review, who
   * has decided, and whether THIS viewer may decide the live step. Null for a
   * scheme never sent.
   */
  review: SowReview | null;
  /** The viewer holds one of its classes for the subject (relief excluded). */
  teachesIt: boolean;
  /** The viewer may reopen it once approved (the office). */
  canReopen: boolean;
  /** While returned or in review: the step a resend starts at, as configured now. */
  firstStepLabel: string | null;
  /** While approved: the week today falls in (Singapore), if any. */
  thisWeekNumber: number | null;
  /**
   * The weekly check (Task 13), read from the APPROVED snapshot — so it is
   * set while approved and also while a reopened scheme is being revised.
   * Null when the scheme has never been approved.
   */
  checking: SowChecking | null;
  /** The viewer may open the oversight page (`resolveOversightScope`). */
  canOversee: boolean;
};

/** The scheme, or null when it does not exist or the caller cannot read it. */
export async function loadSowView(
  service: SupabaseClient,
  actor: SowActor,
  sowId: string
): Promise<SowView | null> {
  const { data, error } = await service
    .from('schemes_of_work')
    .select(
      'id, academic_year_id, term_id, subject_id, level_id, track, state, module, updated_at, current_submission_id, copied_from_sow_id, approved_snapshot'
    )
    .eq('id', sowId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const sow = data as {
    id: string;
    academic_year_id: string;
    copied_from_sow_id: string | null;
    term_id: string;
    subject_id: string;
    level_id: string;
    track: SowKey['track'];
    state: SowState;
    module: Record<string, unknown> | null;
    updated_at: string;
    current_submission_id: string | null;
    approved_snapshot: unknown;
  };

  const [
    classRes,
    weekRes,
    assignments,
    onStep,
    termWeeks,
    oversight,
    levelTypeRes,
  ] = await Promise.all([
    service
      .from('scheme_of_work_classes')
      .select('section_id')
      .eq('sow_id', sowId),
    service
      .from('scheme_of_work_weeks')
      .select(
        'week_number, starts_on, ends_on, topic, learning_outcomes, textbook_pages, activities, assessment, remarks, updated_at'
      )
      .eq('sow_id', sowId)
      .order('week_number', { ascending: true }),
    loadEffectiveAssignmentsForUser(service, actor.id),
    isOnCurrentApprovalStep(service, actor.id, sow.current_submission_id),
    loadTermWeeks(service, sow.term_id, sow.level_id),
    // Who oversees schemes of work (Task 15): the link to the oversight
    // page, and a read of this scheme for an overseer it is in scope for.
    resolveOversightScope(service, actor.id, actor.role ?? null),
    service
      .from('levels')
      .select('level_type')
      .eq('id', sow.level_id)
      .maybeSingle(),
  ]);
  if (classRes.error) throw new Error(classRes.error.message);
  if (weekRes.error) throw new Error(weekRes.error.message);

  const sectionIds = ((classRes.data ?? []) as { section_id: string }[]).map(
    (c) => c.section_id
  );

  let capability = sowCapability({
    role: actor.role ?? 'teacher',
    userId: actor.id,
    assignments,
    sow: {
      subjectId: sow.subject_id,
      state: sow.state,
      classSectionIds: sectionIds,
    },
    isOnCurrentApprovalStep: onStep,
  });
  // A subject head or an approver who oversees this scheme opens it from the
  // oversight page, so they may read it (never edit it) even when it is not
  // waiting on their step.
  const levelType = (levelTypeRes.data as { level_type?: string } | null)
    ?.level_type;
  if (
    capability === 'none' &&
    oversight &&
    inOversightScope(oversight, {
      subjectId: sow.subject_id,
      levelType:
        levelType === 'primary' || levelType === 'secondary' ? levelType : null,
    })
  ) {
    capability = 'read';
  }
  if (capability === 'none') return null;

  let classes: { sectionId: string; name: string }[] = [];
  if (sectionIds.length > 0) {
    const { data: sections, error: sectionsError } = await service
      .from('sections')
      .select('id, name')
      .in('id', sectionIds);
    if (sectionsError) throw new Error(sectionsError.message);
    classes = ((sections ?? []) as { id: string; name: string }[])
      .map((s) => ({ sectionId: s.id, name: s.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const termWeekCount = termWeeks.weeks.filter((w) => w.kind === 'week').length;
  type WeekRow = {
    week_number: number;
    starts_on: string;
    ends_on: string;
    topic: string | null;
    learning_outcomes: string | null;
    textbook_pages: string | null;
    activities: string | null;
    assessment: string | null;
    remarks: string | null;
    updated_at: string;
  };

  const [display, review, firstStepLabel, checking] = await Promise.all([
    loadDisplay(service, sow),
    sow.state === 'draft'
      ? Promise.resolve(null)
      : loadSowReview(service, actor.id, sow.current_submission_id),
    // Returned: "it starts over from …". In review: the return dialog says
    // the same before the approver sends it back.
    sow.state === 'returned' || sow.state === 'in_review'
      ? loadFirstSowStepLabel(service)
      : Promise.resolve(null),
    sow.approved_snapshot == null
      ? Promise.resolve(null)
      : loadSowChecking(service, {
          viewerId: actor.id,
          sowId: sow.id,
          subjectId: sow.subject_id,
          approvedSnapshot: sow.approved_snapshot,
          termWeeks: termWeeks.weeks,
          eventsByWeek: termWeeks.eventsByWeek,
          classes,
          viewerAssignments: assignments,
        }),
  ]);
  const teachesIt = assignments.some(
    (a) =>
      a.teacher_user_id === actor.id &&
      a.via === 'substantive' &&
      isSubjectRole(a.role) &&
      a.subject_id === sow.subject_id &&
      sectionIds.includes(a.section_id)
  );
  const thisWeekNumber =
    sow.state === 'approved'
      ? (weekForDate(termWeeks.weeks, sgToday())?.weekNumber ?? null)
      : null;

  return {
    id: sow.id,
    key: {
      termId: sow.term_id,
      subjectId: sow.subject_id,
      levelId: sow.level_id,
      track: sow.track,
    },
    state: sow.state,
    module: sow.module ?? {},
    updatedAt: sow.updated_at,
    classes,
    weeks: ((weekRes.data ?? []) as WeekRow[]).map((w) => ({
      weekNumber: w.week_number,
      startsOn: w.starts_on,
      endsOn: w.ends_on,
      topic: w.topic,
      learningOutcomes: w.learning_outcomes,
      textbookPages: w.textbook_pages,
      activities: w.activities,
      assessment: w.assessment,
      remarks: w.remarks,
      updatedAt: w.updated_at,
      isSurplus: w.week_number > termWeekCount,
      events: termWeeks.eventsByWeek.get(w.week_number) ?? [],
    })),
    breaks: termWeeks.weeks
      .filter((w) => w.kind === 'break')
      .map((w) => ({
        startsOn: w.startsOn,
        endsOn: w.endsOn,
        label: w.kind === 'break' ? w.label : null,
      })),
    display,
    capability,
    review,
    teachesIt,
    canReopen: actor.role != null && REOPEN_ROLES.includes(actor.role),
    firstStepLabel,
    thisWeekNumber,
    checking,
    canOversee: oversight !== null,
  };
}

/** Names and copy lines for the page; one round of reads in parallel. */
async function loadDisplay(
  service: SupabaseClient,
  sow: {
    id: string;
    academic_year_id: string;
    term_id: string;
    subject_id: string;
    level_id: string;
    state: SowState;
    current_submission_id: string | null;
    copied_from_sow_id: string | null;
  }
): Promise<SowView['display']> {
  const [subject, level, term, ay, copied, submission] = await Promise.all([
    service.from('subjects').select('name').eq('id', sow.subject_id).single(),
    service.from('levels').select('label').eq('id', sow.level_id).single(),
    service
      .from('terms')
      .select('term_number, start_date, end_date')
      .eq('id', sow.term_id)
      .single(),
    service
      .from('academic_years')
      .select('ay_code')
      .eq('id', sow.academic_year_id)
      .single(),
    sow.copied_from_sow_id
      ? service
          .from('schemes_of_work')
          .select('terms(term_number), academic_years(ay_code)')
          .eq('id', sow.copied_from_sow_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // The note belongs to the submission that was returned, which is still
    // the current one until the teacher sends it again.
    sow.state === 'returned' && sow.current_submission_id
      ? service
          .from('scheme_of_work_submissions')
          .select('return_note, return_week_number')
          .eq('id', sow.current_submission_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const r of [subject, level, term, ay, copied, submission]) {
    if (r.error) throw new Error(r.error.message);
  }

  const subjectName = (subject.data as { name: string } | null)?.name ?? '';
  const levelLabel = (level.data as { label: string } | null)?.label ?? '';
  const t = term.data as {
    term_number: number;
    start_date: string | null;
    end_date: string | null;
  } | null;

  // An embedded to-one row can come back as an object or a one-item array
  // depending on how PostgREST reads the foreign key; accept both.
  const one = <T>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  const c = copied.data as {
    terms: { term_number: number } | { term_number: number }[] | null;
    academic_years: { ay_code: string } | { ay_code: string }[] | null;
  } | null;
  const copiedTerm = one(c?.terms);
  const copiedAy = one(c?.academic_years);
  const copiedFrom =
    copiedTerm && copiedAy
      ? `${copiedAy.ay_code} Term ${copiedTerm.term_number} · ${levelLabel} ${subjectName}`
      : null;

  const s = submission.data as {
    return_note: string | null;
    return_week_number: number | null;
  } | null;

  const [returnedBy, reopened] = await Promise.all([
    s?.return_note && sow.current_submission_id
      ? loadReturnedBy(service, sow.current_submission_id)
      : Promise.resolve(null),
    sow.state === 'draft'
      ? loadReopened(service, sow.id)
      : Promise.resolve(null),
  ]);
  const needNames = Boolean(returnedBy?.email || reopened);
  const nameOf = needNames ? await staffNames() : new Map<string, string>();
  const name = (email: string | null) =>
    email ? (nameOf.get(email) ?? email) : null;

  return {
    subjectName,
    levelLabel,
    ayCode: (ay.data as { ay_code: string } | null)?.ay_code ?? '',
    termNumber: t?.term_number ?? 0,
    termStart: t?.start_date ?? null,
    termEnd: t?.end_date ?? null,
    copiedFrom,
    returnNote: s?.return_note
      ? {
          note: s.return_note,
          weekNumber: s.return_week_number,
          by: name(returnedBy?.email ?? null),
          at: returnedBy?.at ?? null,
        }
      : null,
    reopened: reopened
      ? {
          by: name(reopened.email) ?? 'The office',
          at: reopened.at,
          note: reopened.note,
        }
      : null,
  };
}

/** Who turned down the step that returned this submission, and when. */
async function loadReturnedBy(
  service: SupabaseClient,
  submissionId: string
): Promise<{ email: string | null; at: string | null } | null> {
  const { data: request, error } = await service
    .from('approval_requests')
    .select('id')
    .eq('flow', SOW_APPROVAL_FLOW)
    .eq('subject_type', SOW_APPROVAL_SUBJECT_TYPE)
    .eq('subject_id', submissionId)
    .maybeSingle();
  if (error || !request) return null;
  const { data: stage } = await service
    .from('approval_request_stages')
    .select('decided_by_email, decided_at')
    .eq('request_id', (request as { id: string }).id)
    .eq('status', 'rejected')
    .maybeSingle();
  const row = stage as {
    decided_by_email: string | null;
    decided_at: string | null;
  } | null;
  return row ? { email: row.decided_by_email, at: row.decided_at } : null;
}

/**
 * The newest reopen of this scheme. Only asked while it is a draft: a reopened
 * scheme stays a draft until it is sent again, and a scheme that was never
 * approved has no reopen row to find.
 */
async function loadReopened(
  service: SupabaseClient,
  sowId: string
): Promise<{ email: string | null; at: string; note: string | null } | null> {
  const { data, error } = await service
    .from('audit_log')
    .select('actor_email, created_at, context')
    .eq('action', 'sow.reopen')
    .eq('entity_id', sowId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    actor_email: string | null;
    created_at: string;
    context: { note?: unknown } | null;
  };
  return {
    email: row.actor_email,
    at: row.created_at,
    note: typeof row.context?.note === 'string' ? row.context.note : null,
  };
}

/** Staff names by email. A lookup failure falls back to the email itself. */
async function staffNames(): Promise<Map<string, string>> {
  try {
    return new Map(await getStaffDisplayEntries());
  } catch {
    return new Map();
  }
}
