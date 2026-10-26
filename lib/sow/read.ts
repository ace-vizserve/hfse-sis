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
      'id, term_id, subject_id, level_id, track, state, module, updated_at, current_submission_id'
    )
    .eq('id', sowId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const sow = data as {
    id: string;
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
    capability,
  };
}
