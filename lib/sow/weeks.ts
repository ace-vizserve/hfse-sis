import type { SupabaseClient } from '@supabase/supabase-js';

import { eventAppliesToSection } from '@/lib/attendance/event-scope';
import {
  dayAudiencesFor,
  decideNonSchoolDay,
  pickDayRow,
} from '@/lib/attendance/school-days';
import type { DayAudience, DayType } from '@/lib/schemas/attendance';
import type { LevelCode } from '@/lib/sis/levels';

// Scheme of Work — the term's teaching weeks, numbered from the school
// calendar.
//
// A week is Monday to Friday, clipped to the term. A week with at least one
// school day takes the next number; a week with none (mid-term break, a
// closed fortnight) is a `break` row that carries no number, so the teacher's
// "Week 4" is the fourth week the school is actually open.
//
// Dates are ISO `YYYY-MM-DD` strings and every bit of arithmetic here is done
// in UTC on date-only values. `new Date('2026-03-23')` is UTC midnight, but
// the getters that read a LOCAL calendar day would shift it on a machine that
// is not in Singapore — so only the UTC getters are used.

export type TermWeek =
  | {
      kind: 'week';
      weekNumber: number;
      startsOn: string;
      endsOn: string;
      schoolDays: string[];
    }
  | { kind: 'break'; startsOn: string; endsOn: string; label: string | null };

const DAY_MS = 86_400_000;

function toUtc(iso: string): number {
  return Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10))
  );
}

function fromUtc(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday, read in UTC. */
function weekdayOf(ms: number): number {
  return new Date(ms).getUTCDay();
}

export function buildTermWeeks(input: {
  termStart: string;
  termEnd: string;
  /** Holidays and no-school days for this level. */
  closedDays: ReadonlySet<string>;
  /** date → calendar label, used to name a break row. */
  closedLabels?: ReadonlyMap<string, string>;
}): TermWeek[] {
  const start = toUtc(input.termStart);
  const end = toUtc(input.termEnd);
  const out: TermWeek[] = [];
  if (end < start) return out;

  // Back up to the Monday of the week the term starts in.
  const dow = weekdayOf(start);
  let monday = start - ((dow + 6) % 7) * DAY_MS;

  let weekNumber = 0;
  for (; monday <= end; monday += 7 * DAY_MS) {
    // Mon–Fri slice, clipped to the term.
    const days: string[] = [];
    for (let i = 0; i < 5; i++) {
      const t = monday + i * DAY_MS;
      if (t >= start && t <= end) days.push(fromUtc(t));
    }
    if (days.length === 0) continue;

    const open = days.filter((d) => !input.closedDays.has(d));
    const startsOn = days[0];
    const endsOn = days[days.length - 1];
    if (open.length > 0) {
      weekNumber += 1;
      out.push({
        kind: 'week',
        weekNumber,
        startsOn,
        endsOn,
        schoolDays: open,
      });
    } else {
      const label =
        days
          .map((d) => input.closedLabels?.get(d))
          .find((l): l is string => !!l) ?? null;
      out.push({ kind: 'break', startsOn, endsOn, label });
    }
  }
  return out;
}

/**
 * The numbered week a date falls in. Null on a weekend, on a break week, and
 * outside the term. (A closed weekday inside a numbered week still returns
 * that week — the week is open even if that day is not.)
 */
export function weekForDate(
  weeks: TermWeek[],
  isoDate: string
): Extract<TermWeek, { kind: 'week' }> | null {
  const t = toUtc(isoDate);
  const dow = weekdayOf(t);
  if (dow === 0 || dow === 6) return null;
  for (const w of weeks) {
    if (w.kind === 'week' && w.startsOn <= isoDate && isoDate <= w.endsOn) {
      return w;
    }
  }
  return null;
}

/**
 * Lines stored weeks up against the term's current weeks, by week NUMBER (the
 * number is what a teacher's content hangs off). When the calendar changes,
 * `missing` are numbers the term now has that nothing is stored for, and
 * `surplus` are stored weeks the term no longer reaches — kept, never dropped.
 */
export function reconcileWeeks<T extends { weekNumber: number }>(
  stored: T[],
  weeks: TermWeek[]
): {
  kept: (T & { startsOn: string; endsOn: string })[];
  missing: number[];
  surplus: T[];
} {
  const termWeeks = new Map<number, { startsOn: string; endsOn: string }>();
  for (const w of weeks) {
    if (w.kind === 'week') {
      termWeeks.set(w.weekNumber, { startsOn: w.startsOn, endsOn: w.endsOn });
    }
  }
  const kept: (T & { startsOn: string; endsOn: string })[] = [];
  const surplus: T[] = [];
  const have = new Set<number>();
  for (const row of stored) {
    const tw = termWeeks.get(row.weekNumber);
    if (tw) {
      kept.push({ ...row, startsOn: tw.startsOn, endsOn: tw.endsOn });
      have.add(row.weekNumber);
    } else {
      surplus.push(row);
    }
  }
  const missing = [...termWeeks.keys()]
    .filter((n) => !have.has(n))
    .sort((a, b) => a - b);
  return { kept, missing, surplus };
}

type CalendarRow = {
  date: string;
  day_type: DayType;
  audience: DayAudience;
  hbl_overlay: boolean | null;
  label: string | null;
};

type EventRow = {
  start_date: string;
  end_date: string;
  label: string;
  audience: 'all' | 'primary' | 'secondary';
  levels: LevelCode[] | null;
  section_ids: string[] | null;
};

/**
 * A term's weeks for one level, plus the event labels that touch each numbered
 * week.
 *
 * Which days are closed is NOT re-derived here: the rows are read once for the
 * audiences this level sees and each weekday goes through `decideNonSchoolDay`
 * — the same function the register uses, so level → band → whole school
 * (KD #233) and the "unlisted day in a configured term is closed" rule agree
 * with attendance exactly. Events use `eventAppliesToSection`.
 */
export async function loadTermWeeks(
  service: SupabaseClient,
  termId: string,
  levelId: string
): Promise<{ weeks: TermWeek[]; eventsByWeek: Map<number, string[]> }> {
  const [termRes, levelRes] = await Promise.all([
    service
      .from('terms')
      .select('start_date, end_date')
      .eq('id', termId)
      .single(),
    service.from('levels').select('code').eq('id', levelId).single(),
  ]);
  if (termRes.error || !termRes.data) {
    throw new Error(`terms lookup failed: ${termRes.error?.message ?? 'none'}`);
  }
  const term = termRes.data as {
    start_date: string | null;
    end_date: string | null;
  };
  if (!term.start_date || !term.end_date) {
    return { weeks: [], eventsByWeek: new Map() };
  }
  const levelCode = (levelRes.data as { code: string } | null)?.code ?? null;

  const [calRes, evRes] = await Promise.all([
    service
      .from('school_calendar')
      .select('date, day_type, audience, hbl_overlay, label')
      .eq('term_id', termId)
      .in('audience', dayAudiencesFor(levelCode))
      .order('date', { ascending: true }),
    service
      .from('calendar_events')
      .select('start_date, end_date, label, audience, levels, section_ids')
      .eq('term_id', termId)
      .order('start_date', { ascending: true }),
  ]);
  if (calRes.error) {
    throw new Error(`school_calendar lookup failed: ${calRes.error.message}`);
  }
  if (evRes.error) {
    throw new Error(`calendar_events lookup failed: ${evRes.error.message}`);
  }
  const calRows = (calRes.data ?? []) as CalendarRow[];
  const events = (evRes.data ?? []) as EventRow[];

  const byDate = new Map<string, CalendarRow[]>();
  for (const r of calRows) {
    const bucket = byDate.get(r.date);
    if (bucket) bucket.push(r);
    else byDate.set(r.date, [r]);
  }
  const termHasAnyRows = calRows.length > 0;

  const closedDays = new Set<string>();
  const closedLabels = new Map<string, string>();
  for (let t = toUtc(term.start_date); t <= toUtc(term.end_date); t += DAY_MS) {
    const dow = weekdayOf(t);
    if (dow === 0 || dow === 6) continue;
    const date = fromUtc(t);
    const rows = byDate.get(date) ?? [];
    if (decideNonSchoolDay(rows, levelCode, termHasAnyRows)) {
      closedDays.add(date);
      const label = pickDayRow(rows, levelCode)?.label;
      if (label) closedLabels.set(date, label);
    }
  }

  const weeks = buildTermWeeks({
    termStart: term.start_date,
    termEnd: term.end_date,
    closedDays,
    closedLabels,
  });

  // Section-scoped events do not apply here: a scheme of work is per level.
  const levelEvents = events.filter((e) =>
    eventAppliesToSection(
      { audience: e.audience, levels: e.levels, sectionIds: null },
      { levelCode, sectionId: null }
    )
  );

  const eventsByWeek = new Map<number, string[]>();
  const add = (weekNumber: number, label: string) => {
    const list = eventsByWeek.get(weekNumber);
    if (!list) eventsByWeek.set(weekNumber, [label]);
    else if (!list.includes(label)) list.push(label);
  };
  for (const w of weeks) {
    if (w.kind !== 'week') continue;
    for (const e of levelEvents) {
      if (e.start_date <= w.endsOn && e.end_date >= w.startsOn) {
        add(w.weekNumber, e.label);
      }
    }
    for (const [date, label] of closedLabels) {
      if (date >= w.startsOn && date <= w.endsOn) add(w.weekNumber, label);
    }
  }
  return { weeks, eventsByWeek };
}
