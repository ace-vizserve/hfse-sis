import { createServiceClient } from '@/lib/supabase/service';
import {
  isEncodableDayType,
  type Audience,
  type DayType,
  type EventCategory,
} from '@/lib/schemas/attendance';

// Attendance module — school-calendar helpers. Server-only reads.
//
// Writes go through /api/attendance/calendar (service-role). RLS blocks
// direct cookie-client writes.
//
// Audience scope (migration 037): every row carries `audience IN
// ('all','primary','secondary')`. The default 'all' matches every section.
// Primary / secondary rows take precedence over the matching 'all' row for
// the same date, scoped to the section's level type.

export type SchoolCalendarRow = {
  id: string;
  termId: string;
  date: string;         // yyyy-MM-dd
  /** 5 typed values per KD #50. `school_day` + `hbl` are encodable. */
  dayType: DayType;
  /** Legacy derived column (`day_type NOT IN ('school_day','hbl')`).
   *  New code should branch on `dayType`. */
  isHoliday: boolean;
  label: string | null;
  audience: Audience;
};

export type CalendarEventRow = {
  id: string;
  termId: string;
  startDate: string;
  endDate: string;
  label: string;
  category: EventCategory;
  audience: Audience;
  tentative: boolean;
};

// Internal — what we read off Supabase before camel-casing.
type RawSchoolCalendarRow = {
  id: string;
  term_id: string;
  date: string;
  day_type: DayType;
  is_holiday: boolean;
  label: string | null;
  audience: Audience;
};

type RawCalendarEventRow = {
  id: string;
  term_id: string;
  start_date: string;
  end_date: string;
  label: string;
  category: EventCategory;
  audience: Audience;
  tentative: boolean;
};

// Filter helper — given the active audience filter, returns the audience
// values that should be visible. 'all' returns everything; 'primary' /
// 'secondary' returns rows for that audience plus the 'all' rows.
export function audienceFilterValues(filter: Audience): Audience[] {
  if (filter === 'all') return ['all', 'primary', 'secondary'];
  return ['all', filter];
}

// Full term calendar: returns ALL days including holidays so the UI can
// grey out cells instead of dropping them.
//
// `audience` selects which rows to include (see `audienceFilterValues`).
// Defaults to 'all' which returns every row regardless of audience.
export async function getSchoolCalendarForTerm(
  termId: string,
  audience: Audience = 'all',
): Promise<SchoolCalendarRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('school_calendar')
    .select('id, term_id, date, day_type, is_holiday, label, audience')
    .eq('term_id', termId)
    .in('audience', audienceFilterValues(audience))
    .order('date', { ascending: true });
  if (error) {
    console.error('[attendance] getSchoolCalendarForTerm failed:', error.message);
    return [];
  }
  return ((data ?? []) as RawSchoolCalendarRow[]).map((r) => ({
    id: r.id,
    termId: r.term_id,
    date: r.date,
    dayType: r.day_type,
    isHoliday: r.is_holiday,
    label: r.label,
    audience: r.audience,
  }));
}

export async function getCalendarEventsForTerm(
  termId: string,
  audience: Audience = 'all',
): Promise<CalendarEventRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('calendar_events')
    .select('id, term_id, start_date, end_date, label, category, audience, tentative')
    .eq('term_id', termId)
    .in('audience', audienceFilterValues(audience))
    .order('start_date', { ascending: true });
  if (error) {
    console.error('[attendance] getCalendarEventsForTerm failed:', error.message);
    return [];
  }
  return ((data ?? []) as RawCalendarEventRow[]).map((r) => ({
    id: r.id,
    termId: r.term_id,
    startDate: r.start_date,
    endDate: r.end_date,
    label: r.label,
    category: r.category,
    audience: r.audience,
    tentative: r.tentative,
  }));
}

// Returns the term's `school_calendar` rows with audience precedence
// applied — exactly one row per date, preferring the level-specific
// override over the `'all'` baseline when both exist (KD #50 + KD #76).
//
// `levelType` is the section's level type ('primary' | 'secondary' | null).
// null = preschool — falls through to audience='all' rows.
//
// Use this helper anywhere the UI iterates one column / row per date
// (the attendance grid, calendar admin, anything that mustn't double up
// on dates that have both a baseline and an override).
export async function getDedupedSchoolCalendarForTerm(
  termId: string,
  levelType: 'primary' | 'secondary' | null = null,
): Promise<SchoolCalendarRow[]> {
  const audience: Audience = levelType ?? 'all';
  const rows = await getSchoolCalendarForTerm(termId, audience);
  const byDate = new Map<string, SchoolCalendarRow>();
  for (const r of rows) {
    const cur = byDate.get(r.date);
    if (!cur) {
      byDate.set(r.date, r);
      continue;
    }
    // Prefer the row whose audience matches `levelType` (specific wins).
    if (cur.audience === 'all' && r.audience !== 'all') {
      byDate.set(r.date, r);
    }
  }
  return Array.from(byDate.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
}

// Convenience: returns the list of encodable dates for a term in
// chronological order. Encodable = day_type IN ('school_day','hbl').
//
// Same audience-precedence semantics as `getDedupedSchoolCalendarForTerm`.
export async function getEncodableDatesForTerm(
  termId: string,
  levelType: 'primary' | 'secondary' | null = null,
): Promise<string[]> {
  const rows = await getDedupedSchoolCalendarForTerm(termId, levelType);
  return rows.filter((r) => isEncodableDayType(r.dayType)).map((r) => r.date);
}

// Fast lookup: is a given date a holiday in this term? Returns null when
// the term has no calendar rows (legacy mode). "Holiday" here means
// "not encodable" — public_holiday / school_holiday / no_class all return
// true. school_day + hbl return false.
//
// `levelType` enforces the audience-precedence rule (specific row wins
// over 'all'). null = preschool (only 'all' rows considered).
export async function isHoliday(
  termId: string,
  date: string,
  levelType: 'primary' | 'secondary' | null = null,
): Promise<boolean | null> {
  const service = createServiceClient();

  // Count all rows first (to distinguish "no calendar" from "not listed").
  const { count: termRowCount } = await service
    .from('school_calendar')
    .select('*', { count: 'exact', head: true })
    .eq('term_id', termId);
  if ((termRowCount ?? 0) === 0) return null;

  const audiences: Audience[] = levelType ? ['all', levelType] : ['all'];
  const { data } = await service
    .from('school_calendar')
    .select('day_type, audience')
    .eq('term_id', termId)
    .eq('date', date)
    .in('audience', audiences);
  if (!data || data.length === 0) {
    // Not listed → treat as "not a school day" (grid shouldn't render it).
    return true;
  }
  // Audience precedence: prefer the level-specific row over 'all'.
  const rows = data as Array<{ day_type: DayType; audience: Audience }>;
  const specific = rows.find((r) => r.audience === levelType);
  const chosen = specific ?? rows[0];
  return !isEncodableDayType(chosen.day_type);
}

// Find the most recent prior AY that has a term with the given term_number,
// and return that term's school_calendar overrides + calendar_events.
// Used by the "Copy from prior AY" dialog on the calendar admin.
//
// `targetAyId` is the AY we're carrying entries INTO (excluded from the
// "prior" search so we don't get circular results).
//
// Test AYs (KD #52, `^AY9` pattern) are excluded from the source pool —
// without this filter, lexicographic ordering picks AY9999 as the
// "most recent prior" (because '9' > '2'), leaking seeded test fixtures
// into production carry-forwards. Same convention used by the AY-setup
// wizard's source-AY filter and `lib/sis/seeder`.
//
// Returns `{ sourceAy, holidays, events }`. `holidays` keeps the historical
// name for backward-compat with existing callers, but it now contains every
// non-school_day school_calendar row (i.e. every override the registrar
// might want to copy forward, not just is_holiday=true). `events` carries
// every calendar_events row from the source term.
export async function listPriorAyEntriesForCopy(
  targetAyId: string,
  termNumber: number,
): Promise<{
  sourceAy: { id: string; ay_code: string; label: string; term_id: string } | null;
  holidays: SchoolCalendarRow[];
  events: CalendarEventRow[];
}> {
  const service = createServiceClient();

  const { data: ays, error: ayErr } = await service
    .from('academic_years')
    .select('id, ay_code, label')
    .neq('id', targetAyId)
    .order('ay_code', { ascending: false });
  if (ayErr || !ays) return { sourceAy: null, holidays: [], events: [] };

  const productionAys = (ays as Array<{ id: string; ay_code: string; label: string }>).filter(
    (ay) => !/^AY9/i.test(ay.ay_code),
  );

  for (const ay of productionAys) {
    const { data: term } = await service
      .from('terms')
      .select('id')
      .eq('academic_year_id', ay.id)
      .eq('term_number', termNumber)
      .maybeSingle();
    if (!term) continue;
    const termId = (term as { id: string }).id;
    const allRows = await getSchoolCalendarForTerm(termId, 'all');
    // Copy-forward focuses on overrides — school_day rows are the auto-seed
    // default and don't need to be re-copied.
    const overrides = allRows.filter((r) => r.dayType !== 'school_day');
    const events = await getCalendarEventsForTerm(termId, 'all');
    if (overrides.length === 0 && events.length === 0) {
      // Nothing to copy on this term — keep this AY as the source anyway
      // (registrar gets a clear "no prior entries" empty state).
      return {
        sourceAy: { id: ay.id, ay_code: ay.ay_code, label: ay.label, term_id: termId },
        holidays: [],
        events: [],
      };
    }
    return {
      sourceAy: { id: ay.id, ay_code: ay.ay_code, label: ay.label, term_id: termId },
      holidays: overrides,
      events,
    };
  }
  return { sourceAy: null, holidays: [], events: [] };
}

/** @deprecated Use {@link listPriorAyEntriesForCopy} which also returns events. */
export const listHolidaysForPriorTerm = listPriorAyEntriesForCopy;

// Shift a yyyy-MM-dd from its original year to a target year, preserving month+day.
// Used by the holiday-copy dialog. Returns null on invalid input; clamps Feb 29
// to Feb 28 if the target year isn't a leap year.
export function shiftYearPreserveMonthDay(iso: string, targetYear: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const month = Number(m[2]);
  let day = Number(m[3]);
  // Leap-year clamp
  if (month === 2 && day === 29) {
    const isLeap = (targetYear % 4 === 0 && targetYear % 100 !== 0) || targetYear % 400 === 0;
    if (!isLeap) day = 28;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${targetYear}-${pad(month)}-${pad(day)}`;
}

// Idempotent auto-seed: if a term has zero school_calendar rows, insert
// one row per weekday in [startIso, endIso] with day_type='school_day'
// and audience='all'. Returns the number of rows actually inserted (0 if
// the term already had rows, or if the term has no weekdays in the range).
//
// Called from the calendar admin page RSC on every visit so the registrar
// never sees an empty allowlist. Safe under concurrent loads thanks to the
// ignoreDuplicates upsert.
export async function ensureTermSeeded(
  termId: string,
  startIso: string,
  endIso: string,
  userId: string,
): Promise<number> {
  const service = createServiceClient();

  const { count: existing } = await service
    .from('school_calendar')
    .select('*', { count: 'exact', head: true })
    .eq('term_id', termId);
  if ((existing ?? 0) > 0) return 0;

  const dates = weekdaysBetween(startIso, endIso);
  if (dates.length === 0) return 0;

  const rows = dates.map((date) => ({
    term_id: termId,
    date,
    day_type: 'school_day' as const,
    audience: 'all' as const,
    // `is_holiday` is kept for backwards-compat but derived server-side via
    // the migration-019 trigger; writing false here is redundant-but-safe.
    is_holiday: false,
    label: null,
    created_by: userId,
  }));
  const { error, count } = await service
    .from('school_calendar')
    .upsert(rows, {
      onConflict: 'term_id,audience,date',
      ignoreDuplicates: true,
      count: 'exact',
    });
  if (error) {
    console.error('[attendance] ensureTermSeeded failed:', error.message);
    return 0;
  }
  return count ?? rows.length;
}

// Generate candidate dates for a term (Mon–Fri between start and end).
// Used by the admin wizard to seed school days in bulk.
export function weekdaysBetween(startIso: string, endIso: string): string[] {
  const parse = (iso: string): Date => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) throw new Error(`bad iso date: ${iso}`);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const out: string[] = [];
  const d = parse(startIso);
  const end = parse(endIso);
  while (d.getTime() <= end.getTime()) {
    const dow = d.getDay(); // 0=Sun, 6=Sat
    if (dow >= 1 && dow <= 5) out.push(fmt(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
