import { createServiceClient } from '@/lib/supabase/service';
import {
  DAY_AUDIENCE_VALUES,
  isEncodableDayType,
  type Audience,
  type DayAudience,
  type DayType,
  type EventCategory,
} from '@/lib/schemas/attendance';
import { eventAppliesToSection } from '@/lib/attendance/event-scope';
import {
  dayAudiencesFor,
  pickDayRowPerDate,
} from '@/lib/attendance/school-days';
import {
  LEVEL_CODES,
  LEVEL_TYPE_BY_CODE,
  type LevelCode,
} from '@/lib/sis/levels';

// Attendance module — school-calendar helpers. Server-only reads.
//
// Writes go through /api/attendance/calendar (service-role). RLS blocks
// direct cookie-client writes.
//
// Audience scope (migration 037, widened by 196): every `school_calendar` row
// carries `audience IN ('all','primary','secondary', P1–P6, S1–S4)`. For one
// section on a date the row that applies is its level code's, else its band's,
// else the 'all' row — `pickDayRow` in ./school-days is that rule.
// `calendar_events.audience` stays three-valued (events scope to levels
// through `levels` / `section_ids`, migration 158).

export type SchoolCalendarRow = {
  id: string;
  termId: string;
  date: string; // yyyy-MM-dd
  /** 5 typed values per KD #50. `school_day` + `hbl` are encodable. */
  dayType: DayType;
  /** Legacy derived column (`day_type NOT IN ('school_day','hbl')`).
   *  New code should branch on `dayType`. */
  isHoliday: boolean;
  label: string | null;
  /** 'all', a band, or one level code (migration 196). */
  audience: DayAudience;
  /** When true, a school_holiday row is also encodable as HBL (migration 051). */
  hblOverlay: boolean;
};

export type CalendarEventRow = {
  id: string;
  termId: string;
  startDate: string;
  endDate: string;
  label: string;
  category: EventCategory;
  /**
   * Coarse scope, DERIVED from `levels` by a trigger (migration 158). Kept
   * because the teacher's sheet, the register export and the SIS calendar
   * filter all branch on it. Prefer `levels` for anything new.
   */
  audience: Audience;
  /** Level codes this event is for; null means whole school (migration 158). */
  levels: LevelCode[] | null;
  /** Sections it is for when narrower than a level; null otherwise. */
  sectionIds: string[] | null;
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
  audience: DayAudience;
  hbl_overlay: boolean;
};

type RawCalendarEventRow = {
  id: string;
  term_id: string;
  start_date: string;
  end_date: string;
  label: string;
  category: EventCategory;
  audience: Audience;
  levels: LevelCode[] | null;
  section_ids: string[] | null;
  tentative: boolean;
};

// Filter helper for the admin calendar's view — given the active audience
// filter, returns the `school_calendar` audience values that should be
// visible. 'all' returns every value (all thirteen); 'primary' / 'secondary'
// returns that band's rows, its levels' rows (a P1 row belongs in the Primary
// view) and the 'all' rows.
function audienceFilterValues(filter: Audience): DayAudience[] {
  if (filter === 'all') return [...DAY_AUDIENCE_VALUES];
  return [
    'all',
    filter,
    ...LEVEL_CODES.filter((c) => LEVEL_TYPE_BY_CODE[c] === filter),
  ];
}

// Same question for `calendar_events`, whose audience is still three-valued.
function eventAudienceFilterValues(filter: Audience): Audience[] {
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
  audience: Audience = 'all'
): Promise<SchoolCalendarRow[]> {
  return readSchoolCalendarRows(termId, audienceFilterValues(audience));
}

async function readSchoolCalendarRows(
  termId: string,
  audiences: DayAudience[]
): Promise<SchoolCalendarRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('school_calendar')
    .select(
      'id, term_id, date, day_type, is_holiday, label, audience, hbl_overlay'
    )
    .eq('term_id', termId)
    .in('audience', audiences)
    .order('date', { ascending: true });
  if (error) {
    console.error(
      '[attendance] getSchoolCalendarForTerm failed:',
      error.message
    );
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
    hblOverlay: r.hbl_overlay ?? false,
  }));
}

export async function getCalendarEventsForTerm(
  termId: string,
  audience: Audience = 'all'
): Promise<CalendarEventRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('calendar_events')
    .select(
      'id, term_id, start_date, end_date, label, category, audience, levels, section_ids, tentative'
    )
    .eq('term_id', termId)
    .in('audience', eventAudienceFilterValues(audience))
    .order('start_date', { ascending: true });
  if (error) {
    console.error(
      '[attendance] getCalendarEventsForTerm failed:',
      error.message
    );
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
    levels: r.levels ?? null,
    sectionIds: r.section_ids ?? null,
    tentative: r.tentative,
  }));
}

/**
 * The events that belong on ONE section's register.
 *
 * Separate from `getCalendarEventsForTerm`, which answers the admin calendar's
 * question ("show me the primary view") and still filters on `audience`. This
 * answers the teacher's ("what is on MY class's sheet?"), which since migration
 * 158 can be narrower than a band.
 *
 * Filtered in TypeScript rather than SQL on purpose: the predicate is a
 * three-level precedence over two nullable array columns, which reads as one
 * clear function and as an unmaintainable `.or()` string. A term holds a couple
 * of dozen events, so there is nothing to win by pushing it down.
 */
export async function getCalendarEventsForSection(
  termId: string,
  levelCode: LevelCode | null,
  sectionId: string | null
): Promise<CalendarEventRow[]> {
  const all = await getCalendarEventsForTerm(termId, 'all');
  return all.filter((e) =>
    eventAppliesToSection(
      { audience: e.audience, levels: e.levels, sectionIds: e.sectionIds },
      { levelCode, sectionId }
    )
  );
}

// Returns the term's `school_calendar` rows with audience precedence
// applied — exactly one row per date: the section's level-code row, else its
// band's, else the `'all'` baseline (KD #50 + KD #76, migration 196).
//
// `levelCode` is the section's level code (e.g. 'P1'). The band is derived
// from it; null, or a level with no band, reads only audience='all' rows.
//
// Use this helper anywhere the UI iterates one column / row per date
// (the attendance grid, calendar admin, anything that mustn't double up
// on dates that have both a baseline and an override).
export async function getDedupedSchoolCalendarForTerm(
  termId: string,
  levelCode: string | null
): Promise<SchoolCalendarRow[]> {
  const rows = await readSchoolCalendarRows(termId, dayAudiencesFor(levelCode));
  return pickDayRowPerDate(rows, levelCode);
}

// Convenience: returns the list of encodable dates for a term in
// chronological order. Encodable = day_type IN ('school_day','hbl').
//
// Same audience-precedence semantics as `getDedupedSchoolCalendarForTerm`.
export async function getEncodableDatesForTerm(
  termId: string,
  levelCode: string | null
): Promise<string[]> {
  const rows = await getDedupedSchoolCalendarForTerm(termId, levelCode);
  return rows
    .filter((r) => isEncodableDayType(r.dayType, r.hblOverlay))
    .map((r) => r.date);
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
  termNumber: number
): Promise<{
  sourceAy: {
    id: string;
    ay_code: string;
    label: string;
    term_id: string;
  } | null;
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

  const productionAys = (
    ays as Array<{ id: string; ay_code: string; label: string }>
  ).filter((ay) => !/^AY9/i.test(ay.ay_code));

  for (const ay of productionAys) {
    const { data: term } = await service
      .from('terms')
      .select('id')
      .eq('academic_year_id', ay.id)
      .eq('term_number', termNumber)
      .maybeSingle();
    if (!term) continue;
    const termId = (term as { id: string }).id;
    // 'all' reads every audience, level-code rows (migration 196) included —
    // a "No class — P1" closure is an override like any other.
    const allRows = await getSchoolCalendarForTerm(termId, 'all');
    // Copy-forward focuses on overrides — school_day rows are the auto-seed
    // default and don't need to be re-copied.
    const overrides = allRows.filter((r) => r.dayType !== 'school_day');
    const events = await getCalendarEventsForTerm(termId, 'all');
    if (overrides.length === 0 && events.length === 0) {
      // Nothing to copy on this term — keep this AY as the source anyway
      // (registrar gets a clear "no prior entries" empty state).
      return {
        sourceAy: {
          id: ay.id,
          ay_code: ay.ay_code,
          label: ay.label,
          term_id: termId,
        },
        holidays: [],
        events: [],
      };
    }
    return {
      sourceAy: {
        id: ay.id,
        ay_code: ay.ay_code,
        label: ay.label,
        term_id: termId,
      },
      holidays: overrides,
      events,
    };
  }
  return { sourceAy: null, holidays: [], events: [] };
}

// Shift a yyyy-MM-dd from its original year to a target year, preserving month+day.
// Used by the holiday-copy dialog. Returns null on invalid input; clamps Feb 29
// to Feb 28 if the target year isn't a leap year.
// fallow-ignore-next-line unused-export
export function shiftYearPreserveMonthDay(
  iso: string,
  targetYear: number
): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const month = Number(m[2]);
  let day = Number(m[3]);
  // Leap-year clamp
  if (month === 2 && day === 29) {
    const isLeap =
      (targetYear % 4 === 0 && targetYear % 100 !== 0) ||
      targetYear % 400 === 0;
    if (!isLeap) day = 28;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${targetYear}-${pad(month)}-${pad(day)}`;
}

// Idempotent auto-seed: backfills missing school_day rows for every
// weekday in [startIso, endIso]. Existing rows (overrides like
// public_holiday / hbl / etc.) are preserved by the upsert's
// ignoreDuplicates against the (term_id, audience, date) unique key.
// Returns the number of rows actually inserted.
//
// Called from the calendar admin page RSC on every visit so the registrar
// never sees an empty allowlist — the prior count>0 early-bail meant a
// partially-seeded term (e.g. a few HBL rows but no school_day rows for
// the rest of the term) would silently leave the calendar sparse, and
// the report card's school-days denominator would collapse to 0/1
// because `getEncodableDatesForTerm` counts only rows that actually
// exist. Idempotent under concurrent loads.
export async function ensureTermSeeded(
  termId: string,
  startIso: string,
  endIso: string,
  userId: string
): Promise<number> {
  const service = createServiceClient();

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
  const { error, count } = await service.from('school_calendar').upsert(rows, {
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

// Bring a term's school_calendar into line with a new [start,end] window after
// its dates are edited: prune rows that fell outside the new window (any
// audience / day_type) and backfill missing weekday school_days inside it.
// In-range overrides (public_holiday, hbl, …) are preserved untouched. Returns
// the prune + insert counts for the audit trail.
//
// Note: attendance_daily entries previously recorded on now-out-of-range dates
// are NOT removed here (append-only, Hard Rule #6) — they're just no longer
// encodable; the recompute rollup (KD #113) already filters by the window.
export async function resyncTermCalendarWindow(
  termId: string,
  startIso: string,
  endIso: string,
  userId: string
): Promise<{ deleted: number; inserted: number }> {
  const service = createServiceClient();

  // 1. Prune rows now outside [start,end] (every audience, every day_type).
  const { data: deletedRows, error: delErr } = await service
    .from('school_calendar')
    .delete()
    .eq('term_id', termId)
    .or(`date.lt.${startIso},date.gt.${endIso}`)
    .select('id');
  if (delErr) {
    // Surface the failure — a swallowed prune would leave stale out-of-window
    // school days while the caller reports success. Let the route turn this
    // into a 500 so editing term dates can't silently desync the calendar.
    console.error(
      '[attendance] resyncTermCalendarWindow prune failed:',
      delErr.message
    );
    throw new Error(`Calendar resync failed: ${delErr.message}`);
  }

  // 2. Backfill missing in-range weekday school_days (idempotent).
  const inserted = await ensureTermSeeded(termId, startIso, endIso, userId);

  return { deleted: deletedRows?.length ?? 0, inserted };
}

// AY-wide aggregation — composes the per-term readers across all terms in an
// AY so the operational calendar can navigate continuously (spec D2). Returns
// rows tagged with their term_id (already present on each row).
export async function getSchoolCalendarForAy(
  ayId: string,
  audience: Audience = 'all'
): Promise<SchoolCalendarRow[]> {
  const service = createServiceClient();
  const { data: terms } = await service
    .from('terms')
    .select('id')
    .eq('academic_year_id', ayId);
  const termIds = ((terms ?? []) as Array<{ id: string }>).map((t) => t.id);
  const all = await Promise.all(
    termIds.map((id) => getSchoolCalendarForTerm(id, audience))
  );
  return all.flat();
}

export async function getCalendarEventsForAy(
  ayId: string,
  audience: Audience = 'all'
): Promise<CalendarEventRow[]> {
  const service = createServiceClient();
  const { data: terms } = await service
    .from('terms')
    .select('id')
    .eq('academic_year_id', ayId);
  const termIds = ((terms ?? []) as Array<{ id: string }>).map((t) => t.id);
  const all = await Promise.all(
    termIds.map((id) => getCalendarEventsForTerm(id, audience))
  );
  return all.flat();
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
