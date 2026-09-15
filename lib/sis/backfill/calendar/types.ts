// lib/sis/backfill/calendar/types.ts
// The shared vocabulary for reconciling HFSE's school calendar from its two
// real sources: the PUBLISHED calendar (the plan, "AY 2026 Calendar.png") and
// the ATTENDANCE REGISTERS (the record of what actually happened).
//
// Why a kind enum of its own, rather than reusing DayType + EventCategory
// straight from lib/schemas/attendance.ts: the published calendar groups
// entries by the heading they sit under, and those headings do not map 1:1
// onto the database's two tables. "Term Break" and "Start of Term" are
// headings with no day-type at all; HBL is a day-type with no event; PFE and
// Parents Dialogue are events with no day-type. Naming the SOURCE's own
// categories keeps the transcription honest, and `targetFor` below is the one
// place that decides which table each kind lands in.
import type { LevelCode } from '../../levels';

export const CALENDAR_KINDS = [
  'public_holiday',
  'school_holiday',
  'hbl',
  'term_break',
  'start_of_term',
  'term_exam',
  'subject_week',
  'school_event',
  'pfe',
  'ptc',
  'parents_dialogue',
] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

/**
 * One dated entry from either source, already resolved to an inclusive ISO
 * date range.
 *
 * `levels` is the entry's real scope: `null` means whole-school, otherwise the
 * explicit level codes. The database cannot store this yet — `school_calendar`
 * and `calendar_events` only carry `audience IN ('all','primary','secondary')`
 * — so `audienceFor` below degrades it. Transcribing the true scope now means
 * the level column, when it lands, has correct data waiting rather than
 * needing a second pass over the same sources.
 */
export interface CalendarEntry {
  startDate: string; // yyyy-MM-dd, inclusive
  endDate: string; // yyyy-MM-dd, inclusive
  label: string;
  kind: CalendarKind;
  levels: LevelCode[] | null;
}

/** Which table a kind belongs in, and as what. */
export interface KindTarget {
  /** Non-null → a `school_calendar` row (the attendance gate). */
  dayType: 'public_holiday' | 'school_holiday' | 'hbl' | 'no_class' | null;
  /** Non-null → a `calendar_events` row. */
  eventCategory:
    | 'term_exam'
    | 'term_break'
    | 'start_of_term'
    | 'parents_dialogue'
    | 'subject_week'
    | 'school_event'
    | 'pfe'
    | 'ptc'
    | 'other'
    | null;
}

const KIND_TARGETS: Record<CalendarKind, KindTarget> = {
  // Closures — these decide whether a teacher can mark attendance.
  public_holiday: { dayType: 'public_holiday', eventCategory: null },
  school_holiday: { dayType: 'school_holiday', eventCategory: null },
  // HBL is encodable: teachers DO take attendance, from home. It is a
  // day-type, never an event (migration 019 / KD #50).
  hbl: { dayType: 'hbl', eventCategory: null },
  // Everything below is informational — a label on the date, no gate.
  term_break: { dayType: null, eventCategory: 'term_break' },
  start_of_term: { dayType: null, eventCategory: 'start_of_term' },
  term_exam: { dayType: null, eventCategory: 'term_exam' },
  subject_week: { dayType: null, eventCategory: 'subject_week' },
  school_event: { dayType: null, eventCategory: 'school_event' },
  pfe: { dayType: null, eventCategory: 'pfe' },
  ptc: { dayType: null, eventCategory: 'ptc' },
  parents_dialogue: { dayType: null, eventCategory: 'parents_dialogue' },
};

export function targetFor(kind: CalendarKind): KindTarget {
  return KIND_TARGETS[kind];
}

/**
 * Degrade a true level scope to the coarse `audience` the schema has today.
 *
 * A mixed-band scope (Leadership Camp runs P4→S4) has no honest
 * representation in three values, so it becomes 'all' — which is what the
 * database already does, just deliberately here rather than by accident.
 * `levelsFor` on the same entry keeps the real answer.
 */
export function audienceFor(
  levels: LevelCode[] | null
): 'all' | 'primary' | 'secondary' {
  if (levels === null || levels.length === 0) return 'all';
  const hasPrimary = levels.some((l) => l.startsWith('P'));
  const hasSecondary = levels.some((l) => l.startsWith('S'));
  if (hasPrimary && hasSecondary) return 'all';
  return hasPrimary ? 'primary' : 'secondary';
}

/** Every ISO date an entry covers, inclusive, weekends included. */
export function datesCovered(entry: {
  startDate: string;
  endDate: string;
}): string[] {
  const parse = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };
  const out: string[] = [];
  const cur = parse(entry.startDate);
  const end = parse(entry.endDate);
  while (cur.getTime() <= end.getTime()) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}
