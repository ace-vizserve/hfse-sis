import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { loadEffectiveAssignmentsForUser } from '@/lib/auth/teacher-assignments';
import {
  isOnCurrentApprovalStep,
  type SowCapability,
  type SowKey,
  type SowState,
  sowCapability,
} from '@/lib/sow/access';
import type { SowActor } from '@/lib/sow/create';
import { loadTermWeeks } from '@/lib/sow/weeks';

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
    /** The note it came back with, while it is returned. */
    returnNote: { note: string; weekNumber: number | null } | null;
  };
  capability: SowCapability;
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
      'id, academic_year_id, term_id, subject_id, level_id, track, state, module, updated_at, current_submission_id, copied_from_sow_id'
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
  };

  const [classRes, weekRes, assignments, onStep, termWeeks] = await Promise.all(
    [
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
    ]
  );
  if (classRes.error) throw new Error(classRes.error.message);
  if (weekRes.error) throw new Error(weekRes.error.message);

  const sectionIds = ((classRes.data ?? []) as { section_id: string }[]).map(
    (c) => c.section_id
  );

  const capability = sowCapability({
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

  const display = await loadDisplay(service, sow);

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
  };
}

/** Names and copy lines for the page; one round of reads in parallel. */
async function loadDisplay(
  service: SupabaseClient,
  sow: {
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

  return {
    subjectName,
    levelLabel,
    ayCode: (ay.data as { ay_code: string } | null)?.ay_code ?? '',
    termNumber: t?.term_number ?? 0,
    termStart: t?.start_date ?? null,
    termEnd: t?.end_date ?? null,
    copiedFrom,
    returnNote: s?.return_note
      ? { note: s.return_note, weekNumber: s.return_week_number }
      : null,
  };
}
