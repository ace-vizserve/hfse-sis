import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import { getStaffDisplayNameById } from '@/lib/auth/staff-list';
import { isReliefLive } from '@/lib/auth/teacher-assignments';
import { sgToday } from '@/lib/dates';
import {
  isEmptyRichText,
  normalizeRichText,
  proseLength,
} from '@/lib/rich-text';
import { SowSnapshotSchema } from '@/lib/schemas/sow';
import { isSubjectRole } from '@/lib/schemas/teacher-assignment';
import { resolveCurrentTerm } from '@/lib/sis/current-term';
import { subjectDisplayNameResolver } from '@/lib/sis/subjects/display-names-for-ay';
import {
  type CellMark,
  CHECK_NOTE_MAX,
  type CheckOption,
  cellMark,
} from '@/lib/sow/check-options';
import { type CheckRow, latestChecks } from '@/lib/sow/checks';
import type { SowActor } from '@/lib/sow/create';
import { loadTermWeeks, type TermWeek, weekForDate } from '@/lib/sow/weeks';

// The relief teacher's lesson page and note (spec §5.2, boards 13–14).
//
// WHO: a teacher with LIVE cover on the class for that subject — a subject or
// co-teacher row whose `relief_teacher_user_id` is the caller, with today
// inside its window. The window is `isReliefLive`, the one rule shared with
// SQL's `relief_is_live` (KD #191); it is called here, never re-derived.
// Somebody who never covered the class gets a plain 404; somebody whose cover
// has ended is told so. Office roles have no special way in: they have the
// SOW page itself.
//
// ⚠ WHAT IT READS: ONLY THE APPROVED SNAPSHOT (spec §4.4). A scheme the office
// reopened is being revised, and the plan a relief teacher teaches from is
// still the last one approved — so `scheme_of_work_weeks` (the working copy)
// is never touched here.
//
// THE NOTE ("What did you cover?") is rich text (KD #205), required, capped
// like a weekly-check note. There is one per relief teacher, class, subject
// and DAY: saving again the same day replaces it. Unlike the weekly check the
// table is not an append-only ledger — a relief note is a hand-over message,
// not a record a sign-off is made against. It is kept against the scheme and
// week when the class has an approved scheme, and against neither when it
// does not (board 14: the note does not depend on the plan existing).

export const RELIEF_COVER_ENDED = 'Your cover for this class has ended.';
export const RELIEF_NOT_COVERING = "You aren't covering this class.";
export const RELIEF_NOTE_REQUIRED = 'Write what you covered before saving.';

export type SowWeekView = {
  weekNumber: number;
  /** How many numbered weeks the term has ("Week 3 of 10"). */
  weekCount: number;
  startsOn: string;
  endsOn: string;
  /** Today is a weekend or a break, so this is the next week to be taught. */
  isNext: boolean;
  topic: string | null;
  learningOutcomes: string | null;
  activities: string | null;
  assessment: string | null;
};

export type ReliefNoteView = { taughtOn: string; name: string; note: string };

export type CoveringLesson = {
  /** The approved scheme the class follows, or null when there is none. */
  sow: { id: string; label: string } | null;
  week: SowWeekView | null;
  /** This week's school events (the shown week's). */
  events: string[];
  lastWeek: {
    weekNumber: number;
    mark: CellMark;
    /** The options teachers chose, where the week didn't go as planned. */
    options: CheckOption[];
    /** Each teacher's latest note on it (rich text). */
    notes: string[];
    /** Notes earlier relief teachers left on it. */
    reliefNotes: ReliefNoteView[];
  } | null;
  /** The note the caller already saved today, if any. */
  myNoteToday: string | null;
  /** The week today's note is kept against; null when there is no scheme. */
  noteWeekNumber: number | null;
  context: {
    today: string;
    /** "Secondary 1 Discipline 2". */
    sectionName: string;
    subjectName: string;
    /** The teacher being covered; null when the name cannot be read. */
    coveredTeacherName: string | null;
  };
};

type Refusal = { ok: false; status: 403 | 404; error: string };

export type LoadCoveringLessonResult =
  | { ok: true; lesson: CoveringLesson }
  | Refusal;

export type SaveReliefNoteResult =
  | { ok: true; weekNumber: number | null }
  | { ok: false; status: 403 | 404 | 422; error: string };

type CoverRow = {
  teacher_user_id: string;
  role: string;
  relief_started_on: string | null;
  relief_ended_on: string | null;
};

/** The caller's live cover on (section, subject), or why there is none. */
async function findLiveCover(
  service: SupabaseClient,
  userId: string,
  sectionId: string,
  subjectId: string,
  today: string
): Promise<{ ok: true; coveredTeacherId: string } | Refusal> {
  const { data, error } = await service
    .from('teacher_assignments')
    .select('teacher_user_id, role, relief_started_on, relief_ended_on')
    .eq('section_id', sectionId)
    .eq('subject_id', subjectId)
    .eq('relief_teacher_user_id', userId);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as CoverRow[]).filter((r) =>
    isSubjectRole(r.role as never)
  );
  if (rows.length === 0) {
    return { ok: false, status: 404, error: RELIEF_NOT_COVERING };
  }
  const live = rows
    .filter((r) => isReliefLive(r.relief_started_on, r.relief_ended_on, today))
    // The subject teacher before a co-teacher: the banner names one person.
    // (Ordering only — both roles already passed `isSubjectRole` above.)
    .sort(
      (a, b) =>
        Number(a.role.startsWith('co_')) - Number(b.role.startsWith('co_'))
    );
  if (live.length === 0) {
    // Booked but not started yet reads differently from finished.
    const upcoming = rows.find(
      (r) => r.relief_started_on && r.relief_started_on > today
    );
    return {
      ok: false,
      status: 403,
      error: upcoming
        ? "Your cover for this class hasn't started yet."
        : RELIEF_COVER_ENDED,
    };
  }
  return { ok: true, coveredTeacherId: live[0].teacher_user_id };
}

type NumberedWeek = Extract<TermWeek, { kind: 'week' }>;

/**
 * The class's approved scheme for the subject in the term today falls in, and
 * the term's weeks. One scheme at most: a scheme is unique per term × subject
 * × level, and a class has one level.
 */
async function resolvePlan(
  service: SupabaseClient,
  section: { id: string; level_id: string; academic_year_id: string },
  subjectId: string,
  today: string
): Promise<{
  sow: { id: string; snapshot: ReturnType<typeof parseSnapshot> } | null;
  weeks: NumberedWeek[];
  eventsByWeek: Map<number, string[]>;
}> {
  const empty = { sow: null, weeks: [], eventsByWeek: new Map() };
  const { data: terms, error: termsError } = await service
    .from('terms')
    .select('id, term_number, start_date, end_date, is_current')
    .eq('academic_year_id', section.academic_year_id);
  if (termsError) throw new Error(termsError.message);
  const term = resolveCurrentTerm(
    (terms ?? []) as {
      id: string;
      term_number: number;
      start_date: string | null;
      end_date: string | null;
      is_current: boolean | null;
    }[],
    today
  );
  if (!term) return empty;

  const [termWeeks, classRes] = await Promise.all([
    loadTermWeeks(service, term.id, section.level_id),
    service
      .from('scheme_of_work_classes')
      .select('sow_id')
      .eq('section_id', section.id),
  ]);
  if (classRes.error) throw new Error(classRes.error.message);
  const weeks = termWeeks.weeks.filter(
    (w): w is NumberedWeek => w.kind === 'week'
  );
  const sowIds = ((classRes.data ?? []) as { sow_id: string }[]).map(
    (c) => c.sow_id
  );
  if (sowIds.length === 0) {
    return { sow: null, weeks, eventsByWeek: termWeeks.eventsByWeek };
  }
  const { data: schemes, error: schemesError } = await service
    .from('schemes_of_work')
    .select('id, approved_snapshot')
    .in('id', sowIds)
    .eq('subject_id', subjectId)
    .eq('term_id', term.id);
  if (schemesError) throw new Error(schemesError.message);
  const approved = (
    (schemes ?? []) as {
      id: string;
      approved_snapshot: unknown;
    }[]
  )
    .map((s) => ({ id: s.id, snapshot: parseSnapshot(s.approved_snapshot) }))
    .find((s) => s.snapshot !== null);
  return {
    sow: approved ?? null,
    weeks,
    eventsByWeek: termWeeks.eventsByWeek,
  };
}

function parseSnapshot(raw: unknown) {
  if (raw == null) return null;
  const parsed = SowSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(
      '[sow.relief] the approved snapshot did not validate:',
      parsed.error.issues[0]?.message
    );
    return null;
  }
  return parsed.data;
}

/**
 * The week a note written today belongs to: the week today is in, else the
 * latest week that has started (a note written at the weekend is about the
 * week just taught). Null before the term's first week.
 */
function noteWeekFor(weeks: NumberedWeek[], today: string): number | null {
  const current = weekForDate(weeks, today);
  if (current) return current.weekNumber;
  const started = weeks.filter((w) => w.startsOn <= today);
  return started.at(-1)?.weekNumber ?? null;
}

async function loadSection(service: SupabaseClient, sectionId: string) {
  const { data, error } = await service
    .from('sections')
    .select('id, name, level_id, academic_year_id')
    .eq('id', sectionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as {
    id: string;
    name: string;
    level_id: string;
    academic_year_id: string;
  } | null;
}

/** Staff names by user id. A lookup failure leaves names out, never the page. */
async function staffNamesById(): Promise<Map<string, string>> {
  try {
    return new Map(await getStaffDisplayNameById());
  } catch {
    return new Map();
  }
}

export async function loadCoveringLesson(
  service: SupabaseClient,
  userId: string,
  sectionId: string,
  subjectId: string,
  today: string = sgToday()
): Promise<LoadCoveringLessonResult> {
  const cover = await findLiveCover(
    service,
    userId,
    sectionId,
    subjectId,
    today
  );
  if (!cover.ok) return cover;
  const section = await loadSection(service, sectionId);
  if (!section) return { ok: false, status: 404, error: RELIEF_NOT_COVERING };

  const [plan, levelRes, subjectRes, names, mineRes] = await Promise.all([
    resolvePlan(service, section, subjectId, today),
    service
      .from('levels')
      .select('label')
      .eq('id', section.level_id)
      .maybeSingle(),
    service
      .from('subjects')
      .select('id, name')
      .eq('id', subjectId)
      .maybeSingle(),
    staffNamesById(),
    service
      .from('scheme_of_work_relief_notes')
      .select('note, created_at')
      .eq('relief_teacher_user_id', userId)
      .eq('section_id', sectionId)
      .eq('subject_id', subjectId)
      .eq('taught_on', today)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);
  for (const r of [levelRes, subjectRes, mineRes]) {
    if (r.error) throw new Error(r.error.message);
  }
  const levelLabel = (levelRes.data as { label: string } | null)?.label ?? '';
  const subject = subjectRes.data as { id: string; name: string } | null;
  const resolveName = await subjectDisplayNameResolver(
    service,
    [section.academic_year_id],
    [subjectId]
  );
  const subjectName = subject
    ? resolveName(section.academic_year_id, subject)
    : '';

  const { sow, weeks, eventsByWeek } = plan;
  const current = weekForDate(weeks, today);
  // On a weekend or a break, the next week to be taught.
  const shown = current ?? weeks.find((w) => w.startsOn > today) ?? null;

  let week: SowWeekView | null = null;
  if (sow?.snapshot && shown) {
    const planned = sow.snapshot.weeks.find(
      (w) => w.weekNumber === shown.weekNumber
    );
    week = {
      weekNumber: shown.weekNumber,
      weekCount: weeks.length,
      startsOn: shown.startsOn,
      endsOn: shown.endsOn,
      isNext: current === null,
      topic: planned?.topic ?? null,
      learningOutcomes: planned?.learningOutcomes ?? null,
      activities: planned?.activities ?? null,
      assessment: planned?.assessment ?? null,
    };
  }

  // Last week in this class — the guard against a stale plan.
  const lastNumber = shown
    ? shown.weekNumber - 1
    : (weeks.filter((w) => w.endsOn < today).at(-1)?.weekNumber ?? 0);
  const last = weeks.find((w) => w.weekNumber === lastNumber) ?? null;
  let lastWeek: CoveringLesson['lastWeek'] = null;
  if (sow && last) {
    const [holderRes, checkRes, reliefRes] = await Promise.all([
      service
        .from('teacher_assignments')
        .select('teacher_user_id, role')
        .eq('section_id', sectionId)
        .eq('subject_id', subjectId),
      service
        .from('scheme_of_work_checks')
        .select(
          'week_number, section_id, teacher_user_id, option, note, recorded_at'
        )
        .eq('sow_id', sow.id)
        .eq('section_id', sectionId)
        .eq('week_number', last.weekNumber),
      service
        .from('scheme_of_work_relief_notes')
        .select('taught_on, relief_teacher_user_id, note, created_at')
        .eq('sow_id', sow.id)
        .eq('section_id', sectionId)
        .eq('week_number', last.weekNumber),
    ]);
    for (const r of [holderRes, checkRes, reliefRes]) {
      if (r.error) throw new Error(r.error.message);
    }
    // Who the week waits on: the holders, never the relief column.
    const holders = (
      (holderRes.data ?? []) as {
        teacher_user_id: string;
        role: string;
      }[]
    )
      .filter((a) => isSubjectRole(a.role as never))
      .map((a) => a.teacher_user_id);
    const checks = latestChecks((checkRes.data ?? []) as CheckRow[]);
    const notPlanned = checks.filter((c) => c.option !== 'as_planned');
    lastWeek = {
      weekNumber: last.weekNumber,
      mark: cellMark({
        teacherIds: [...new Set(holders)],
        latestChecks: checks.map((c) => ({
          teacherUserId: c.teacher_user_id,
          option: c.option,
        })),
        weekEnded: today > last.endsOn,
      }),
      options: [...new Set(notPlanned.map((c) => c.option))],
      notes: notPlanned
        .map((c) => c.note)
        .filter((n): n is string => !!n && !isEmptyRichText(n)),
      reliefNotes: (
        (reliefRes.data ?? []) as {
          taught_on: string;
          relief_teacher_user_id: string;
          note: string;
        }[]
      )
        .sort((a, b) => a.taught_on.localeCompare(b.taught_on))
        .map((r) => ({
          taughtOn: r.taught_on,
          name: names.get(r.relief_teacher_user_id) ?? 'Relief teacher',
          note: r.note,
        })),
    };
  }

  const mine = ((mineRes.data ?? []) as { note: string }[])[0];
  return {
    ok: true,
    lesson: {
      sow: sow
        ? { id: sow.id, label: `${levelLabel} ${subjectName}`.trim() }
        : null,
      week,
      events: shown ? (eventsByWeek.get(shown.weekNumber) ?? []) : [],
      lastWeek,
      myNoteToday: mine?.note ?? null,
      noteWeekNumber: sow ? noteWeekFor(weeks, today) : null,
      context: {
        today,
        sectionName: levelLabel
          ? `${levelLabel} ${section.name}`
          : section.name,
        subjectName,
        coveredTeacherName: names.get(cover.coveredTeacherId) ?? null,
      },
    },
  };
}

export async function saveReliefNote(
  service: SupabaseClient,
  actor: SowActor,
  input: { sectionId: string; subjectId: string; note: string; today?: string }
): Promise<SaveReliefNoteResult> {
  const today = input.today ?? sgToday();
  const note = normalizeRichText(input.note);
  if (isEmptyRichText(note)) {
    return { ok: false, status: 422, error: RELIEF_NOTE_REQUIRED };
  }
  if (proseLength(note) > CHECK_NOTE_MAX) {
    return {
      ok: false,
      status: 422,
      error: `Keep the note to ${CHECK_NOTE_MAX} characters or fewer.`,
    };
  }

  const cover = await findLiveCover(
    service,
    actor.id,
    input.sectionId,
    input.subjectId,
    today
  );
  if (!cover.ok) return cover;
  const section = await loadSection(service, input.sectionId);
  if (!section) return { ok: false, status: 404, error: RELIEF_NOT_COVERING };

  const { sow, weeks } = await resolvePlan(
    service,
    section,
    input.subjectId,
    today
  );
  const weekNumber = sow ? noteWeekFor(weeks, today) : null;

  // One note per teacher, class, subject and day: the new one replaces it.
  // An upsert on the table's unique key (migration 198,
  // `scheme_of_work_relief_notes_one_per_day`), so two saves at once still
  // leave one row and a failed write never loses the earlier note.
  const { error: upsertError } = await service
    .from('scheme_of_work_relief_notes')
    .upsert(
      {
        sow_id: sow && weekNumber !== null ? sow.id : null,
        week_number: weekNumber,
        section_id: input.sectionId,
        subject_id: input.subjectId,
        taught_on: today,
        relief_teacher_user_id: actor.id,
        note,
      },
      { onConflict: 'relief_teacher_user_id,section_id,subject_id,taught_on' }
    );
  if (upsertError) throw new Error(upsertError.message);

  await logAction({
    service,
    actor: { id: actor.id, email: actor.email, role: actor.role ?? null },
    action: 'sow.relief_note',
    entityType: 'scheme_of_work',
    entityId: sow?.id ?? null,
    // THAT there was a note, never what it said.
    context: {
      section_id: input.sectionId,
      subject_id: input.subjectId,
      taught_on: today,
      week_number: weekNumber,
      note_present: true,
    },
  });
  return { ok: true, weekNumber };
}
