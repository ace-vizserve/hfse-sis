import type { SupabaseClient } from '@supabase/supabase-js';

import { eachDateInclusive } from '@/lib/attendance/sheet-columns';
import {
  isEncodableDayType,
  type Audience,
  type DayType,
} from '@/lib/schemas/attendance';

// Attendance module — "is this a day the register can be marked on?", in one
// place.
//
// This rule used to live as a closure inside the daily PATCH handler, where
// nothing else could reach it. Phase 3 of the absence declaration needs the
// same rule for a different shape of question — not "may a teacher click this
// cell" but "which days inside an approved date range actually carry marks" —
// and a second copy of a calendar rule is a bill this repo has already paid
// (migration 115, and the seven app-side gates in KD #193).
//
// So the DECISION is a pure function, and the two callers differ only in how
// they fetch the rows it decides on:
//
//   createNonSchoolDayChecker  one date at a time, cached — the daily PATCH
//                              route, whose dates arrive as an arbitrary list
//   expandSchoolDays           a whole date range in one query — the approved
//                              declaration, whose dates are contiguous
//
// ⚠ The per-day checker's behaviour must stay byte-identical to what shipped,
// including the legacy branch: a term with ZERO `school_calendar` rows blocks
// nothing at all (the pre-migration-019 world, where schools had not filled
// the calendar in yet). Removing that would refuse marks on every date of any
// term nobody has configured.

export type CalendarLevelType = 'primary' | 'secondary' | null;

/** One day inside an approved range that the register can carry a mark for. */
export type SchoolDay = { date: string; termId: string };

type CalendarRow = {
  day_type: DayType;
  audience: Audience;
  hbl_overlay: boolean | null;
};

export type NonSchoolDayChecker = (
  termId: string,
  date: string,
  levelType: CalendarLevelType
) => Promise<boolean>;

/**
 * The rule itself, with no I/O.
 *
 * `rowsForDate` is every `school_calendar` row for this date whose audience
 * the section can see ('all', plus its own level type). `termHasAnyRows` says
 * whether the term has been configured at all.
 *
 * Audience precedence: a row aimed at this level beats the 'all' row for the
 * same date. Preschool sections (levelType null) only ever see 'all'.
 */
export function decideNonSchoolDay(
  rowsForDate: CalendarRow[],
  levelType: CalendarLevelType,
  termHasAnyRows: boolean
): boolean {
  if (rowsForDate.length === 0) {
    // Date not listed for any audience this section sees. If the term has any
    // rows at all, treat as non-school (implicit holiday); otherwise legacy
    // mode — no block.
    return termHasAnyRows;
  }
  const specific = rowsForDate.find((r) => r.audience === levelType);
  const chosen = specific ?? rowsForDate[0];
  // school_holiday + hbl_overlay=true IS encodable — teachers deliver HBL
  // while the day is a school closure for students (migration 051).
  return !isEncodableDayType(chosen.day_type, chosen.hbl_overlay ?? false);
}

/**
 * Per-date checker with a per-(term,date,level) cache, for callers holding an
 * arbitrary list of dates. Two round-trips per cache miss, which is why the
 * range expander below does not use it.
 */
export function createNonSchoolDayChecker(
  service: SupabaseClient
): NonSchoolDayChecker {
  const blockCache = new Map<string, boolean>();
  const termHasRowsCache = new Map<string, boolean>();

  return async function isNonSchoolDay(termId, date, levelType) {
    const key = `${termId}|${date}|${levelType ?? 'all'}`;
    const cached = blockCache.get(key);
    if (cached !== undefined) return cached;

    const audiences: Audience[] = levelType ? ['all', levelType] : ['all'];
    const { data } = await service
      .from('school_calendar')
      .select('day_type, audience, hbl_overlay')
      .eq('term_id', termId)
      .eq('date', date)
      .in('audience', audiences);

    const rows = (data ?? []) as CalendarRow[];

    let termHasAnyRows = termHasRowsCache.get(termId);
    if (termHasAnyRows === undefined) {
      if (rows.length > 0) {
        // A row for this date is itself proof the term is configured; skip
        // the count. (The shipped version only counted on the empty branch,
        // so this changes no outcome — it just remembers the answer.)
        termHasAnyRows = true;
      } else {
        const { count } = await service
          .from('school_calendar')
          .select('*', { count: 'exact', head: true })
          .eq('term_id', termId);
        termHasAnyRows = (count ?? 0) > 0;
      }
      termHasRowsCache.set(termId, termHasAnyRows);
    }

    const blocked = decideNonSchoolDay(rows, levelType, termHasAnyRows);
    blockCache.set(key, blocked);
    return blocked;
  };
}

type TermWindow = { id: string; startDate: string; endDate: string };

/** Term windows for an academic year, with their ids. */
async function loadTermWindows(
  service: SupabaseClient,
  academicYearId: string
): Promise<TermWindow[]> {
  const { data, error } = await service
    .from('terms')
    .select('id, start_date, end_date')
    .eq('academic_year_id', academicYearId);
  if (error) {
    throw new Error(`terms lookup failed: ${error.message}`);
  }
  return (
    (data ?? []) as Array<{
      id: string;
      start_date: string | null;
      end_date: string | null;
    }>
  )
    .filter((t) => t.start_date && t.end_date)
    .map((t) => ({
      id: t.id,
      startDate: t.start_date as string,
      endDate: t.end_date as string,
    }));
}

/**
 * Every markable school day in [startDate, endDate], with the term each one
 * falls in.
 *
 * ⚠ `term_id` is resolved PER DAY, which is what makes a range crossing a
 * term boundary correct without anybody having to think about it — the marks
 * land in T1 up to the last day of T1 and in T2 from its first, and the two
 * rollups both recompute because `writeDailyBatch` keys on (term, student).
 *
 * Dropped, silently and on purpose:
 *   - dates outside every term window (a between-terms break, or a range that
 *     runs past the end of the year)
 *   - dates the calendar says are not school days
 *
 * A parent filing Friday-to-Tuesday is not making a claim about the weekend.
 * The daily PATCH route REFUSES a blocked date because a teacher clicking a
 * holiday has made a mistake; a date range has no mistake in it. The caller
 * reports how many days were actually written.
 */
export async function expandSchoolDays(
  service: SupabaseClient,
  args: {
    startDate: string;
    endDate: string;
    academicYearId: string;
    levelType: CalendarLevelType;
  }
): Promise<SchoolDay[]> {
  const { startDate, endDate, academicYearId, levelType } = args;

  const allDates = eachDateInclusive(startDate, endDate);
  if (allDates.length === 0) return [];

  const terms = await loadTermWindows(service, academicYearId);
  if (terms.length === 0) return [];

  // Date -> term, in memory. Terms do not overlap, so first match wins.
  const dated: SchoolDay[] = [];
  for (const date of allDates) {
    const term = terms.find((t) => t.startDate <= date && t.endDate >= date);
    if (term) dated.push({ date, termId: term.id });
  }
  if (dated.length === 0) return [];

  const termIds = [...new Set(dated.map((d) => d.termId))];
  const audiences: Audience[] = levelType ? ['all', levelType] : ['all'];

  // One query for the whole window rather than one per day. The shipped
  // per-date checker is fine for a class-sized submit; a declaration range is
  // contiguous and can be long, and N sequential round-trips inside an
  // approval click is how a route starts timing out.
  const { data, error } = await service
    .from('school_calendar')
    .select('term_id, date, day_type, audience, hbl_overlay')
    .in('term_id', termIds)
    .in('audience', audiences)
    .gte('date', dated[0].date)
    .lte('date', dated[dated.length - 1].date);
  if (error) {
    throw new Error(`school_calendar lookup failed: ${error.message}`);
  }

  const rowsByKey = new Map<string, CalendarRow[]>();
  const termsWithRows = new Set<string>();
  for (const row of (data ?? []) as Array<
    CalendarRow & {
      term_id: string;
      date: string;
    }
  >) {
    termsWithRows.add(row.term_id);
    const key = `${row.term_id}|${row.date}`;
    const bucket = rowsByKey.get(key);
    if (bucket) bucket.push(row);
    else rowsByKey.set(key, [row]);
  }

  // ⚠ "Does this term have any calendar rows" must be asked of the WHOLE
  // term, not of the window we just read. A range landing entirely inside an
  // unconfigured stretch of an otherwise-configured term would otherwise read
  // as legacy mode and mark straight through a holiday block.
  const termConfigured = new Map<string, boolean>();
  for (const termId of termIds) {
    if (termsWithRows.has(termId)) {
      termConfigured.set(termId, true);
      continue;
    }
    const { count } = await service
      .from('school_calendar')
      .select('*', { count: 'exact', head: true })
      .eq('term_id', termId);
    termConfigured.set(termId, (count ?? 0) > 0);
  }

  return dated.filter(
    ({ date, termId }) =>
      !decideNonSchoolDay(
        rowsByKey.get(`${termId}|${date}`) ?? [],
        levelType,
        termConfigured.get(termId) ?? false
      )
  );
}
