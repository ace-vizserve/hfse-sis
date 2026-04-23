import { createServiceClient } from '@/lib/supabase/service';
import { isEncodableDayType, type DayType } from '@/lib/schemas/attendance';

// Attendance module — school-calendar helpers. Server-only reads.
//
// Writes go through /api/attendance/calendar (service-role). RLS blocks
// direct cookie-client writes.

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
};

export type CalendarEventRow = {
  id: string;
  termId: string;
  startDate: string;
  endDate: string;
  label: string;
};

// Full term calendar: returns ALL days including holidays so the UI can
// grey out cells instead of dropping them.
export async function getSchoolCalendarForTerm(
  termId: string,
): Promise<SchoolCalendarRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('school_calendar')
    .select('id, term_id, date, day_type, is_holiday, label')
    .eq('term_id', termId)
    .order('date', { ascending: true });
  if (error) {
    console.error('[attendance] getSchoolCalendarForTerm failed:', error.message);
    return [];
  }
  type Raw = {
    id: string;
    term_id: string;
    date: string;
    day_type: DayType;
    is_holiday: boolean;
    label: string | null;
  };
  return ((data ?? []) as Raw[]).map((r) => ({
    id: r.id,
    termId: r.term_id,
    date: r.date,
    dayType: r.day_type,
    isHoliday: r.is_holiday,
    label: r.label,
  }));
}

export async function getCalendarEventsForTerm(
  termId: string,
): Promise<CalendarEventRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('calendar_events')
    .select('id, term_id, start_date, end_date, label')
    .eq('term_id', termId)
    .order('start_date', { ascending: true });
  if (error) {
    console.error('[attendance] getCalendarEventsForTerm failed:', error.message);
    return [];
  }
  type Raw = {
    id: string;
    term_id: string;
    start_date: string;
    end_date: string;
    label: string;
  };
  return ((data ?? []) as Raw[]).map((r) => ({
    id: r.id,
    termId: r.term_id,
    startDate: r.start_date,
    endDate: r.end_date,
    label: r.label,
  }));
}

// Convenience: returns the list of encodable dates for a term in
// chronological order. Encodable = day_type IN ('school_day','hbl').
// If no calendar is configured, returns an empty list (the caller should
// fall back to legacy behaviour).
export async function getEncodableDatesForTerm(termId: string): Promise<string[]> {
  const rows = await getSchoolCalendarForTerm(termId);
  return rows.filter((r) => isEncodableDayType(r.dayType)).map((r) => r.date);
}

// Fast lookup: is a given date a holiday in this term? Returns null when
// the term has no calendar rows (legacy mode). "Holiday" here means
// "not encodable" — public_holiday / school_holiday / no_class all return
// true. school_day + hbl return false.
export async function isHoliday(
  termId: string,
  date: string,
): Promise<boolean | null> {
  const service = createServiceClient();

  // Count all rows first (to distinguish "no calendar" from "not listed").
  const { count: termRowCount } = await service
    .from('school_calendar')
    .select('*', { count: 'exact', head: true })
    .eq('term_id', termId);
  if ((termRowCount ?? 0) === 0) return null;

  const { data } = await service
    .from('school_calendar')
    .select('day_type')
    .eq('term_id', termId)
    .eq('date', date)
    .maybeSingle();
  // If not listed, treat as "not a school day" (grid shouldn't render it).
  if (!data) return true;
  return !isEncodableDayType(data.day_type as DayType);
}

// Find the most recent prior AY that has a term with the given term_number,
// and return its school_calendar holidays from that term. Used by the
// "Carry holidays from [prior AY]" dialog on the calendar admin.
//
// `targetAyId` is the AY we're carrying holidays INTO (excluded from the
// "prior" search so we don't get circular results).
//
// Returns `{ sourceAy, holidays }` — sourceAy is null when no prior term
// exists (first-ever AY at HFSE, or only one AY configured).
export async function listHolidaysForPriorTerm(
  targetAyId: string,
  termNumber: number,
): Promise<{
  sourceAy: { id: string; ay_code: string; label: string; term_id: string } | null;
  holidays: SchoolCalendarRow[];
}> {
  const service = createServiceClient();

  // Most recent AY != target, that has a term with this term_number.
  const { data: ays, error: ayErr } = await service
    .from('academic_years')
    .select('id, ay_code, label')
    .neq('id', targetAyId)
    .order('ay_code', { ascending: false });
  if (ayErr || !ays) return { sourceAy: null, holidays: [] };

  for (const ay of ays as Array<{ id: string; ay_code: string; label: string }>) {
    const { data: term } = await service
      .from('terms')
      .select('id')
      .eq('academic_year_id', ay.id)
      .eq('term_number', termNumber)
      .maybeSingle();
    if (!term) continue;
    const termId = (term as { id: string }).id;
    const holidays = (await getSchoolCalendarForTerm(termId)).filter((r) => r.isHoliday);
    if (holidays.length === 0) {
      // No holidays on that term — keep this AY as the source anyway
      // (registrar gets an empty list + clear "no prior holidays" state).
      return { sourceAy: { id: ay.id, ay_code: ay.ay_code, label: ay.label, term_id: termId }, holidays: [] };
    }
    return { sourceAy: { id: ay.id, ay_code: ay.ay_code, label: ay.label, term_id: termId }, holidays };
  }
  return { sourceAy: null, holidays: [] };
}

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
// one row per weekday in [startIso, endIso] with is_holiday=false. Returns
// the number of rows actually inserted (0 if the term already had rows, or
// if the term has no weekdays in the range).
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
    // `is_holiday` is kept for backwards-compat but derived server-side via
    // the migration-019 trigger; writing false here is redundant-but-safe.
    is_holiday: false,
    label: null,
    created_by: userId,
  }));
  const { error, count } = await service
    .from('school_calendar')
    .upsert(rows, { onConflict: 'term_id,date', ignoreDuplicates: true, count: 'exact' });
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
