import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  type EffectiveAssignmentRow,
  loadEffectiveAssignmentsForUser,
} from '@/lib/auth/teacher-assignments';
import { sgToday } from '@/lib/dates';
import { toPlainText } from '@/lib/rich-text';
import { SowSnapshotSchema } from '@/lib/schemas/sow';
import { isSubjectRole } from '@/lib/schemas/teacher-assignment';
import { resolveCurrentTerm } from '@/lib/sis/current-term';
import { listMySowRows, type MySowRow, type SowState } from '@/lib/sow/access';
import {
  type CheckRow,
  checksAsSigned,
  latestChecks,
  newestSignoff,
  openAsk,
  type SignoffRow,
} from '@/lib/sow/checks';
import {
  loadTermWeeksForLevels,
  type TermWeek,
  weekForDate,
} from '@/lib/sow/weeks';

// A teacher's Classroom home above the class list (spec §5, board 15): this
// week's lesson for each class they teach, and what is waiting on them.
//
// ⚠ EVERY READ IS BATCHED. The home is classes x weeks; nothing here asks the
// database per class. After the assignments, the year and its terms, the
// teacher's rows (`listMySowRows`) and one wave over ALL their schemes, the
// number of queries does not grow with the number of classes
// (`__tests__/sow/home.test.ts` pins that).
//
// ⚠ IT READS THE APPROVED SNAPSHOT, like the weekly check does: a scheme the
// office reopened is a draft again, but the plan in force is still the one
// last approved, and its lessons are what is taught this week.
//
// Who sees it: whoever holds a substantive subject or co-teacher assignment
// this term — any role can teach. Someone with none gets two empty lists, and
// the page then renders nothing at all.

export type LessonTone = 'quiet' | 'info' | 'locked' | 'muted';

export type LessonRow = {
  /** `${sectionId}|${subjectId}` */
  id: string;
  /** "Secondary 1 Discipline 1 · Science" */
  className: string;
  /** "Week 3", or "Week 4 · next week" on a weekend or a break; null without one. */
  weekLabel: string | null;
  topic: string;
  /** Null when there is nothing to say beyond the topic line. */
  state: { label: string; tone: LessonTone } | null;
  href: string;
};

export type TodoKind = 'returned' | 'asked' | 'check' | 'start';

export type TodoRow = {
  id: string;
  kind: TodoKind;
  text: string;
  href: string;
  /** The dot: destructive for returned and asked, attention for due, muted for start. */
  tone: 'locked' | 'warning' | 'muted';
};

export type SowHome = { lessons: LessonRow[]; todos: TodoRow[] };

const EMPTY: SowHome = { lessons: [], todos: [] };

export const LESSON_IN_REVIEW = 'SOW in review, no lessons to show yet';
export const LESSON_RETURNED = 'SOW returned by the subject head';
export const LESSON_NOT_STARTED = 'SOW not started';
export const LESSON_DRAFT = 'SOW not sent for review yet';
export const LESSON_NOTHING_PLANNED = 'Nothing planned for this week';
export const LESSON_NO_WEEK = 'No lessons this week';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Fri" from an ISO date, read in UTC so no machine can shift the day. */
function weekdayName(iso: string): string {
  const dow = new Date(
    Date.UTC(
      Number(iso.slice(0, 4)),
      Number(iso.slice(5, 7)) - 1,
      Number(iso.slice(8, 10))
    )
  ).getUTCDay();
  return WEEKDAYS[dow];
}

/** "Secondary 3 Science". */
function subjectLevel(r: Pick<MySowRow, 'levelLabel' | 'subjectName'>) {
  return `${r.levelLabel} ${r.subjectName}`;
}

type NumberedWeek = Extract<TermWeek, { kind: 'week' }>;

type SchemeLite = {
  id: string;
  state: SowState;
  approved_snapshot: unknown;
};

type ReliefWindow = { from: string | null; to: string | null };

/** The weekday the cover starts in this week, when its window touches the week. */
function reliefDay(windows: ReliefWindow[], week: NumberedWeek): string | null {
  let first: string | null = null;
  for (const w of windows) {
    if (w.from && w.from > week.endsOn) continue;
    if (w.to && w.to < week.startsOn) continue;
    const day = w.from && w.from > week.startsOn ? w.from : week.startsOn;
    if (first === null || day < first) first = day;
  }
  return first;
}

export async function loadSowHome(
  service: SupabaseClient,
  userId: string,
  today: string = sgToday(),
  /**
   * What the Classroom page already holds: the teacher's assignments (its
   * memoised read) and the CURRENT academic year's id. Given, neither is read
   * again; and with no subject seat in the assignments nothing is queried.
   */
  known: { assignments?: EffectiveAssignmentRow[]; ayId?: string } = {}
): Promise<SowHome> {
  const assignments = (
    known.assignments ??
    (await loadEffectiveAssignmentsForUser(service, userId))
  ).filter(
    (a) =>
      a.via === 'substantive' &&
      a.teacher_user_id === userId &&
      isSubjectRole(a.role) &&
      a.subject_id
  );
  if (assignments.length === 0) return EMPTY;

  let ayId = known.ayId;
  if (!ayId) {
    const { data: ay, error: ayError } = await service
      .from('academic_years')
      .select('id')
      .eq('is_current', true)
      .maybeSingle();
    if (ayError) throw new Error(ayError.message);
    ayId = (ay as { id: string } | null)?.id;
  }
  if (!ayId) return EMPTY;
  const { data: termRows, error: termError } = await service
    .from('terms')
    .select('id, term_number, start_date, end_date, is_current')
    .eq('academic_year_id', ayId);
  if (termError) throw new Error(termError.message);
  const term = resolveCurrentTerm(
    (termRows ?? []) as {
      id: string;
      term_number: number;
      start_date: string | null;
      end_date: string | null;
      is_current: boolean | null;
    }[],
    today
  );
  if (!term) return EMPTY;

  const rows = await listMySowRows(service, userId, term.id, {
    assignments,
    ayId,
  });
  if (rows.length === 0) return EMPTY;

  const sowIds = rows.flatMap((r) => (r.sow ? [r.sow.id] : []));
  const [schemeRes, checkRes, signRes, termWeeks] = await Promise.all([
    sowIds.length > 0
      ? service
          .from('schemes_of_work')
          .select('id, state, approved_snapshot')
          .in('id', sowIds)
      : Promise.resolve({ data: [], error: null }),
    // Every teacher's checks, not only mine: "asked" is answered by the next
    // check on that week, whoever recorded it (`openAsk`, as the SOW page).
    sowIds.length > 0
      ? service
          .from('scheme_of_work_checks')
          .select(
            'sow_id, week_number, section_id, teacher_user_id, option, note, recorded_at'
          )
          .in('sow_id', sowIds)
      : Promise.resolve({ data: [], error: null }),
    sowIds.length > 0
      ? service
          .from('scheme_of_work_signoffs')
          .select('sow_id, week_number, section_id, kind, remarks, created_at')
          .in('sow_id', sowIds)
      : Promise.resolve({ data: [], error: null }),
    loadTermWeeksForLevels(service, term.id, [
      ...new Set(rows.map((r) => r.levelId)),
    ]),
  ]);
  for (const r of [schemeRes, checkRes, signRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  const scheme = new Map(
    ((schemeRes.data ?? []) as SchemeLite[]).map((s) => [s.id, s])
  );
  type Scoped<T> = T & { sow_id: string };
  const bySow = <T extends { sow_id: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of list) m.set(r.sow_id, [...(m.get(r.sow_id) ?? []), r]);
    return m;
  };
  const checksOf = bySow((checkRes.data ?? []) as Scoped<CheckRow>[]);
  const signoffsOf = bySow((signRes.data ?? []) as Scoped<SignoffRow>[]);

  // My own seats, by class x subject — what makes a class mine, and where a
  // cover on it is read from.
  const seats = new Map<string, ReliefWindow[]>();
  for (const a of assignments) {
    const key = `${a.section_id}|${a.subject_id}`;
    const list = seats.get(key) ?? [];
    if (a.relief_teacher_user_id) {
      list.push({
        from: a.relief_started_on ?? null,
        to: a.relief_ended_on ?? null,
      });
    }
    seats.set(key, list);
  }

  const lessons: LessonRow[] = [];
  const returned: TodoRow[] = [];
  const asked: TodoRow[] = [];
  const due: TodoRow[] = [];
  const start: TodoRow[] = [];

  for (const row of rows) {
    // The teacher's own classes in this group: the scheme's classes and the
    // ones they teach that it leaves out; a not-started row lists only theirs.
    const own = [...row.classes, ...row.myClassesNotOnSow]
      .filter((c) => seats.has(`${c.sectionId}|${row.subjectId}`))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (own.length === 0) continue;

    const level = termWeeks.get(row.levelId);
    const numbered = (level?.weeks ?? []).filter(
      (w): w is NumberedWeek => w.kind === 'week'
    );
    const current = weekForDate(numbered, today);
    // On a weekend or a break, the next week to be taught (as Task 14 does).
    const shown = current ?? numbered.find((w) => w.startsOn > today) ?? null;
    const sow = row.sow ? (scheme.get(row.sow.id) ?? null) : null;
    const parsed = sow?.approved_snapshot
      ? SowSnapshotSchema.safeParse(sow.approved_snapshot)
      : null;
    const snapshot = parsed?.success ? parsed.data : null;
    const href = row.sow ? `/classroom/sow/${row.sow.id}` : '/classroom/sow';

    // ── To-dos that belong to the scheme ────────────────────────────────────
    if (row.sow?.state === 'returned') {
      returned.push({
        id: `returned|${row.sow.id}`,
        kind: 'returned',
        text: `Fix and resend ${subjectLevel(row)} SOW`,
        href,
        tone: 'locked',
      });
    }
    if (!row.sow) {
      start.push({
        id: `start|${row.subjectId}|${row.levelId}`,
        kind: 'start',
        text: `Start the ${subjectLevel(row)} SOW`,
        href,
        tone: 'muted',
      });
    }

    const checks = row.sow ? (checksOf.get(row.sow.id) ?? []) : [];
    const signoffs = row.sow ? (signoffsOf.get(row.sow.id) ?? []) : [];
    // A check that landed after the signature is not what was signed.
    const live = checksAsSigned(checks, signoffs);
    const mineNow = new Set(
      latestChecks(live)
        .filter((c) => c.teacher_user_id === userId)
        .map((c) => `${c.week_number}|${c.section_id}`)
    );
    const isSigned = (week: number, sectionId: string) =>
      newestSignoff(
        signoffs.filter(
          (s) => s.week_number === week && s.section_id === sectionId
        )
      )?.kind === 'signed';

    // An open "Ask the teacher" on any week of any of my classes.
    if (row.sow && snapshot) {
      for (const c of own) {
        const askedWeeks = new Set(
          signoffs
            .filter((s) => s.section_id === c.sectionId && s.kind === 'asked')
            .map((s) => s.week_number)
        );
        for (const week of [...askedWeeks].sort((a, b) => a - b)) {
          const at = (x: { week_number: number; section_id: string }) =>
            x.week_number === week && x.section_id === c.sectionId;
          const open = openAsk(
            signoffs.filter(at),
            latestChecks(live).filter(at)
          );
          if (!open) continue;
          asked.push({
            id: `asked|${row.sow.id}|${c.sectionId}|${week}`,
            kind: 'asked',
            text: `Your subject head asked about Week ${week} for ${row.levelLabel} ${c.name}`,
            href,
            tone: 'locked',
          });
        }
      }
    }

    // ── The lessons ─────────────────────────────────────────────────────────
    const planned =
      snapshot && shown
        ? (snapshot.weeks.find((w) => w.weekNumber === shown.weekNumber) ??
          null)
        : null;
    const weekLabel = shown
      ? `Week ${shown.weekNumber}${current ? '' : ' · next week'}`
      : null;

    let unchecked = 0;
    for (const c of own) {
      const className = `${row.levelLabel} ${c.name} · ${row.subjectName}`;
      const base = {
        id: `${c.sectionId}|${row.subjectId}`,
        className,
        weekLabel,
        href,
      };

      if (!row.sow) {
        lessons.push({
          ...base,
          topic: LESSON_NOT_STARTED,
          state: { label: 'Not started', tone: 'muted' },
        });
        continue;
      }
      if (!snapshot) {
        const s = row.sow.state;
        lessons.push({
          ...base,
          topic:
            s === 'returned'
              ? LESSON_RETURNED
              : s === 'in_review'
                ? LESSON_IN_REVIEW
                : LESSON_DRAFT,
          state:
            s === 'returned'
              ? { label: 'Returned', tone: 'locked' }
              : s === 'in_review'
                ? { label: 'In review', tone: 'info' }
                : { label: 'Draft', tone: 'muted' },
        });
        continue;
      }

      const topic = planned
        ? toPlainText(planned.topic ?? '').trim() || LESSON_NOTHING_PLANNED
        : shown
          ? LESSON_NOTHING_PLANNED
          : LESSON_NO_WEEK;
      const cover = shown
        ? reliefDay(seats.get(`${c.sectionId}|${row.subjectId}`) ?? [], shown)
        : null;

      let state: LessonRow['state'];
      if (cover) {
        state = { label: `Relief ${weekdayName(cover)}`, tone: 'info' };
      } else if (shown && current && planned) {
        const done =
          mineNow.has(`${shown.weekNumber}|${c.sectionId}`) ||
          isSigned(shown.weekNumber, c.sectionId);
        if (!done) unchecked += 1;
        state = done
          ? { label: 'Checked', tone: 'muted' }
          : {
              label: `Check due ${weekdayName(current.endsOn)}`,
              tone: 'quiet',
            };
      } else {
        // No plan for the week, or a break: the row already says so, so no chip.
        state =
          shown && !current && planned
            ? { label: 'Next week', tone: 'muted' }
            : null;
      }
      // The week still has to be checked under a cover (the regular teacher
      // answers for it), so the to-do counts it whatever the chip says.
      if (cover && current && planned) {
        const done =
          mineNow.has(`${current.weekNumber}|${c.sectionId}`) ||
          isSigned(current.weekNumber, c.sectionId);
        if (!done) unchecked += 1;
      }
      lessons.push({ ...base, topic, state });
    }

    if (unchecked > 0 && current && planned && row.sow) {
      due.push({
        id: `check|${row.sow.id}|${current.weekNumber}`,
        kind: 'check',
        text: `Check Week ${current.weekNumber} for ${subjectLevel(row)} (${unchecked} ${unchecked === 1 ? 'class' : 'classes'})`,
        href,
        tone: 'warning',
      });
    }
  }

  return { lessons, todos: [...returned, ...asked, ...due, ...start] };
}
