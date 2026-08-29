import { cache } from 'react';

import { fetchAllPages } from '@/lib/supabase/paginate';
import { createServiceClient } from '@/lib/supabase/service';

import {
  isEncodableDayType,
  type Audience,
  type AttendanceStatus,
  type DayType,
  type ExReason,
} from '@/lib/schemas/attendance';
import { levelTypeForAudienceLookup } from '@/lib/sis/levels';
import { getSchoolConfig } from '@/lib/sis/school-config';
import { expandSchoolDays } from '@/lib/attendance/school-days';
import { countVacationTrips } from '@/lib/attendance/vacation-trips';

// Attendance module — server-side read helpers.
//
// Writes go through `lib/attendance/mutations.ts` (service-role); reads for
// the daily grid + student tab + Markbook summary card all come through here.
//
// Uses the service-role client per KD #22 — aggregating across sections /
// students bypasses the per-teacher RLS row-scoping (005) which would leak
// per-user shapes into a cached server-component read. Individual row-level
// access control is enforced at the API / page gate via `requireRole()` and
// the `teacher_assignments` helper.

export type DailyEntryRow = {
  id: string;
  sectionStudentId: string;
  termId: string;
  date: string; // yyyy-MM-dd
  status: AttendanceStatus;
  exReason: ExReason | null;
  /** Free-text "why" on an EX mark (migration 109). */
  exNote: string | null;
  periodId: string | null;
  recordedBy: string | null;
  recordedAt: string; // ISO 8601 UTC
};

export type RollupRow = {
  sectionStudentId: string;
  termId: string;
  schoolDays: number;
  daysPresent: number;
  daysLate: number;
  daysExcused: number;
  daysAbsent: number;
  attendancePct: number | null;
};

// `presentOnlyCount` lives in `./rollup-math` (a dependency-free module) so
// client components can import it without pulling this module's server-only
// transitive imports (e.g. `lib/sis/school-config.ts`) into the browser
// bundle. Re-exported here so existing server-side importers of this module
// keep working unchanged.
export { presentOnlyCount } from './rollup-math';

// Internal row shapes from supabase — camel/snake boundary handled per-query.
type DailyRaw = {
  id: string;
  section_student_id: string;
  term_id: string;
  date: string;
  status: AttendanceStatus;
  ex_reason: ExReason | null;
  ex_note: string | null;
  period_id: string | null;
  recorded_by: string | null;
  recorded_at: string;
};

type RollupRaw = {
  section_student_id: string;
  term_id: string;
  school_days: number | null;
  days_present: number | null;
  days_late: number | null;
  days_excused: number | null;
  days_absent: number | null;
  attendance_pct: number | null;
};

function normalizeDaily(row: DailyRaw): DailyEntryRow {
  return {
    id: row.id,
    sectionStudentId: row.section_student_id,
    termId: row.term_id,
    date: row.date,
    status: row.status,
    exReason: row.ex_reason,
    exNote: row.ex_note,
    periodId: row.period_id,
    recordedBy: row.recorded_by,
    recordedAt: row.recorded_at,
  };
}

function normalizeRollup(row: RollupRaw): RollupRow {
  return {
    sectionStudentId: row.section_student_id,
    termId: row.term_id,
    schoolDays: row.school_days ?? 0,
    daysPresent: row.days_present ?? 0,
    daysLate: row.days_late ?? 0,
    daysExcused: row.days_excused ?? 0,
    daysAbsent: row.days_absent ?? 0,
    attendancePct: row.attendance_pct,
  };
}

// Shape of an `attendance_daily` row as the quota tallies read it. Hoisted to
// module scope when both tallies moved to `fetchAllPages`, which needs the row
// type at the call site rather than after it.
type DailyRow = {
  section_student_id: string;
  date: string;
  period_id: string | null;
  status: AttendanceStatus;
  ex_reason: ExReason | null;
  recorded_at: string;
};

// ─────────────────────────────────────────────────────────────────────────
// Daily grid — one (section × date range) fetch
// ─────────────────────────────────────────────────────────────────────────
//
// Returns the LATEST row per (section_student_id, date, period_id). Older
// corrections are filtered out in memory.
//
// The volume note that used to sit here ("~1,410 rows... dedupe in-memory
// without pain") was the bug: it sized the dedupe and never mentioned the
// server's 1,000-row response cap, which the real worst case (1,610, measured
// 2026-08-10) had already passed. The read is paginated now; the dedupe cost
// was never the constraint.

export async function getDailyForSection(
  sectionId: string,
  termId: string,
  opts?: { fromDate?: string; toDate?: string }
): Promise<DailyEntryRow[]> {
  const service = createServiceClient();

  // Step 1: get section_student IDs for this section.
  const { data: enrolments, error: enrErr } = await service
    .from('section_students')
    .select('id')
    .eq('section_id', sectionId);
  if (enrErr) {
    console.error(
      '[attendance] getDailyForSection enrolments failed:',
      enrErr.message
    );
    return [];
  }
  const enrolmentIds = (enrolments ?? []).map((e) => e.id as string);
  if (enrolmentIds.length === 0) return [];

  // Step 2: pull daily rows.
  //
  // PAGINATED, AND IT WAS OVER THE CAP BEFORE THIS WAS WRITTEN. Measured
  // 2026-08-10: the worst (section × term) holds **1,610 rows** against
  // PostgREST's 1,000-row response cap, so this query was silently returning
  // about two-thirds of a term and the register printed from it looked
  // complete. The comment above this function estimated "~1,410 rows" and
  // concluded that was fine to dedupe in memory — the estimate was roughly
  // right and the conclusion drawn from it was wrong, because it never
  // mentioned the cap.
  //
  // The dedupe below depends on `recorded_at desc` ordering to keep the LATEST
  // correction per (student, date, period). That ordering is applied by the
  // server across the whole result set, and `fetchAllPages` walks pages in
  // order, so the ORDERING survives pagination.
  //
  // ⚠ The ordering surviving is not the same as the ROWS surviving, and
  // `recorded_at` alone does not give the second. A class register submit
  // writes one row per student in a single statement, so ~25 rows share one
  // `recorded_at` to the microsecond — and `recorded_at desc` on its own
  // leaves PostgREST free to order those tied rows differently on each
  // `.range()` request. A tie straddling the 1,000-row page boundary then
  // repeats rows on the next page and skips others, in a read whose worst
  // (section × term) is 1,610 rows. `.order('id')` breaks every tie the same
  // way on every page, which is what makes the walk stable; it is a TIE-break
  // only, so `recorded_at desc` still decides which correction is latest.
  const data = await fetchAllPages<DailyRaw>((from, to) => {
    let query = service
      .from('attendance_daily')
      .select(
        'id, section_student_id, term_id, date, status, ex_reason, ex_note, period_id, recorded_by, recorded_at'
      )
      .eq('term_id', termId)
      .in('section_student_id', enrolmentIds)
      .order('recorded_at', { ascending: false })
      .order('id', { ascending: true });

    if (opts?.fromDate) query = query.gte('date', opts.fromDate);
    if (opts?.toDate) query = query.lte('date', opts.toDate);

    return query.range(from, to);
  });

  // Dedupe to latest per (student, date, period). `recorded_at desc` came first.
  const seen = new Set<string>();
  const out: DailyEntryRow[] = [];
  for (const raw of data) {
    const key = `${raw.section_student_id}|${raw.date}|${raw.period_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalizeDaily(raw));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Student chronological log — Records detail Attendance tab
// ─────────────────────────────────────────────────────────────────────────

export async function getDailyForStudent(
  sectionStudentId: string,
  termId?: string
): Promise<DailyEntryRow[]> {
  const service = createServiceClient();

  let query = service
    .from('attendance_daily')
    .select(
      'id, section_student_id, term_id, date, status, ex_reason, ex_note, period_id, recorded_by, recorded_at'
    )
    .eq('section_student_id', sectionStudentId)
    .order('date', { ascending: false })
    .order('recorded_at', { ascending: false });

  if (termId) query = query.eq('term_id', termId);

  const { data, error } = await query;
  if (error) {
    console.error(
      '[attendance] getDailyForStudent fetch failed:',
      error.message
    );
    return [];
  }

  // Supersede: latest recorded_at per (date, period_id).
  const seen = new Set<string>();
  const out: DailyEntryRow[] = [];
  for (const raw of (data ?? []) as DailyRaw[]) {
    const key = `${raw.date}|${raw.period_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalizeDaily(raw));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Rollup — Markbook section summary card + report card fetch
// ─────────────────────────────────────────────────────────────────────────

/**
 * Term rollups for one section. REQUEST-MEMOISED with React `cache()`, keyed on
 * `(sectionId, termId)`.
 *
 * WHY. Two pages call this twice with the SAME arguments in one render — the
 * classroom section page and the attendance section page both take
 * `getSectionAttendanceSummary(sectionId, termId)` (which calls this) and then
 * `getRollupForSection(sectionId, termId)` for the at-risk panel. Each call is
 * two round trips (roster, then rollups), so the second one was four wasted
 * queries per page load between them.
 *
 * WHY THAT IS SAFE — no write path reads through this. Searched: every
 * `getRollupForSection` and `getSectionAttendanceSummary` occurrence in the
 * repo, and every write of `attendance_records`. The consumers are three page
 * renders, one server component (`components/markbook/section-attendance-
 * summary.tsx`) and `loadAdviserAttendanceDashboard`, which is itself a page
 * loader — NO route handler calls either function, with any method. The table
 * is never written by application code at all: every `.from('attendance_records')`
 * in `app/`, `lib/` and `scripts/` is a `.select()`, and the rows are produced
 * by the `recompute_attendance_rollup` RPC (migration 014, reworked in 068).
 * Its two callers are `lib/attendance/mutations.ts` and
 * `app/api/sections/[id]/students/[enrolmentId]/route.ts`; neither imports
 * `lib/attendance/queries` at all, so no request can recompute a rollup and
 * then read a memoised pre-recompute copy of it.
 *
 * ⚠ THE BUDGET TEST CANNOT SEE THIS WIN. React `cache()` only memoises where
 * there is a dispatcher, i.e. inside a Server Component render; under Vitest it
 * falls through to a plain call every time (measured in
 * `__tests__/perf/school-config-request-cache.test.ts`). The classroom-page
 * budget therefore stays at 11/8 — the saving is real in the app and invisible
 * to the harness, which is a limit of the instrument, not of the fix.
 */
export const getRollupForSection = cache(async function getRollupForSection(
  sectionId: string,
  termId: string
): Promise<RollupRow[]> {
  const service = createServiceClient();

  const { data: enrolments, error: enrErr } = await service
    .from('section_students')
    .select('id')
    .eq('section_id', sectionId);
  if (enrErr) {
    console.error(
      '[attendance] getRollupForSection enrolments failed:',
      enrErr.message
    );
    return [];
  }
  const enrolmentIds = (enrolments ?? []).map((e) => e.id as string);
  if (enrolmentIds.length === 0) return [];

  const { data, error } = await service
    .from('attendance_records')
    .select(
      'section_student_id, term_id, school_days, days_present, days_late, days_excused, days_absent, attendance_pct'
    )
    .eq('term_id', termId)
    .in('section_student_id', enrolmentIds);
  if (error) {
    console.error(
      '[attendance] getRollupForSection fetch failed:',
      error.message
    );
    return [];
  }

  return ((data ?? []) as RollupRaw[]).map(normalizeRollup);
});

// Aggregate view for the Markbook section-detail summary card.
export type SectionAttendanceSummary = {
  sectionId: string;
  termId: string;
  studentCount: number;
  schoolDays: number; // max across students (handles NC variance)
  averageAttendancePct: number | null;
  totalDaysPresent: number;
  totalDaysLate: number;
  totalDaysAbsent: number;
  totalDaysExcused: number;
  perfectAttendanceCount: number;
};

export async function getSectionAttendanceSummary(
  sectionId: string,
  termId: string
): Promise<SectionAttendanceSummary> {
  const rollups = await getRollupForSection(sectionId, termId);
  if (rollups.length === 0) {
    return {
      sectionId,
      termId,
      studentCount: 0,
      schoolDays: 0,
      averageAttendancePct: null,
      totalDaysPresent: 0,
      totalDaysLate: 0,
      totalDaysAbsent: 0,
      totalDaysExcused: 0,
      perfectAttendanceCount: 0,
    };
  }

  let sumPct = 0;
  let pctCount = 0;
  let totalPresent = 0;
  let totalLate = 0;
  let totalAbsent = 0;
  let totalExcused = 0;
  let perfect = 0;
  let maxDays = 0;
  for (const r of rollups) {
    if (r.attendancePct != null) {
      sumPct += r.attendancePct;
      pctCount += 1;
    }
    totalPresent += r.daysPresent;
    totalLate += r.daysLate;
    totalAbsent += r.daysAbsent;
    totalExcused += r.daysExcused;
    maxDays = Math.max(maxDays, r.schoolDays);
    if (r.daysAbsent === 0 && r.daysLate === 0 && r.schoolDays > 0)
      perfect += 1;
  }
  return {
    sectionId,
    termId,
    studentCount: rollups.length,
    schoolDays: maxDays,
    averageAttendancePct:
      pctCount > 0 ? Math.round((sumPct / pctCount) * 100) / 100 : null,
    totalDaysPresent: totalPresent,
    totalDaysLate: totalLate,
    totalDaysAbsent: totalAbsent,
    totalDaysExcused: totalExcused,
    perfectAttendanceCount: perfect,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Monthly breakdown — per-month totals for the Records tab + Markbook page
// ─────────────────────────────────────────────────────────────────────────

export type MonthlyBreakdownRow = {
  month: string; // yyyy-MM
  label: string; // "January 2026"
  schoolDays: number;
  present: number; // P + L + EX (matches rollup semantics)
  late: number;
  excused: number;
  absent: number;
  pct: number | null;
};

// Pure seam (exported for unit tests): count encodable school days per month
// (yyyy-MM) from raw `school_calendar` rows, applying the KD #50/#76
// audience-precedence rule — exactly ONE row per date, the level-specific
// override beating the `'all'` baseline. Without the dedupe, a date carrying
// BOTH an `'all'` row and an audience-specific row (unique key is
// `(term_id, audience, date)`, migration 037) counted twice and deflated the
// monthly %. Encodable = `isEncodableDayType` (school_day / hbl / HBL-overlaid
// school_holiday, KD #98).
//
// Callers must pre-filter the rows to `audience IN ('all', <levelType>)` —
// any non-'all' row seen here is assumed to be the student's own audience.
export type CalendarDayLite = {
  date: string; // yyyy-MM-dd
  audience: Audience;
  day_type: DayType;
  hbl_overlay: boolean | null;
};

export function countSchoolDaysByMonth(
  rows: CalendarDayLite[]
): Map<string, number> {
  const byDate = new Map<string, CalendarDayLite>();
  for (const r of rows) {
    const cur = byDate.get(r.date);
    if (!cur) {
      byDate.set(r.date, r);
      continue;
    }
    // Specific audience wins over the 'all' baseline (KD #50 read rule).
    if (cur.audience === 'all' && r.audience !== 'all') byDate.set(r.date, r);
  }
  const out = new Map<string, number>();
  for (const [date, r] of byDate.entries()) {
    if (!isEncodableDayType(r.day_type, r.hbl_overlay ?? false)) continue;
    const month = date.slice(0, 7);
    out.set(month, (out.get(month) ?? 0) + 1);
  }
  return out;
}

// Computes monthly breakdown from the latest-per-(date,period_id) rows in
// `attendance_daily`. Pass `termId` to scope; otherwise covers all terms.
//
// `schoolDays` per month is the count of encodable days from
// `school_calendar` — NOT the count of days the student has rows for.
// Rows-based counting under-reports when entries are missing (late
// enrollee, ungraded days, etc.). The calendar is the source of truth for
// "how many school days were there this month"; entries tell us "how many
// of those the student attended". Audience precedence (KD #50/#76) is
// applied via `countSchoolDaysByMonth`, with the student's level type
// resolved from their section; rows are scoped to the section's AY terms
// so an overlapping test-AY calendar can't double-count dates.
//
// Pct is calendar-based: present / schoolDays. Days without entries
// drag the percentage down — that's the intended signal so missing
// attendance entries surface (vs. silently appearing 100% on whatever
// rows happen to exist).
export async function getMonthlyBreakdown(
  sectionStudentId: string,
  termId?: string
): Promise<MonthlyBreakdownRow[]> {
  const daily = await getDailyForStudent(sectionStudentId, termId);
  if (daily.length === 0) return [];

  const byMonth = new Map<
    string,
    { P: number; L: number; EX: number; A: number; NC: number }
  >();
  for (const r of daily) {
    const key = r.date.slice(0, 7); // yyyy-MM
    if (!byMonth.has(key)) {
      byMonth.set(key, { P: 0, L: 0, EX: 0, A: 0, NC: 0 });
    }
    byMonth.get(key)![r.status] += 1;
  }

  // Calendar-based schoolDays per month. Range = first of earliest month
  // seen → last of latest month seen.
  const months = Array.from(byMonth.keys()).sort();
  const [latestY, latestM] = months[months.length - 1].split('-').map(Number);
  const startDate = `${months[0]}-01`;
  const lastDayOfLatest = new Date(latestY, latestM, 0).getDate();
  const endDate = `${months[months.length - 1]}-${String(lastDayOfLatest).padStart(2, '0')}`;

  const service = createServiceClient();

  // Resolve the student's section → level type (for audience precedence) and
  // the section's AY term ids (so we never count another AY's calendar rows
  // for the same dates — test AYs share the current calendar year).
  let levelType: 'primary' | 'secondary' | null = null;
  let ayTermIds: string[] | null = null;
  {
    const { data: enr } = await service
      .from('section_students')
      .select('section_id, sections!inner(level_id, academic_year_id)')
      .eq('id', sectionStudentId)
      .maybeSingle();
    type EnrJoin = {
      sections:
        | { level_id: string | null; academic_year_id: string | null }
        | Array<{ level_id: string | null; academic_year_id: string | null }>
        | null;
    };
    const joined = (enr as EnrJoin | null)?.sections ?? null;
    const sec = Array.isArray(joined) ? joined[0] : joined;
    if (sec?.level_id) {
      const { data: levelRow } = await service
        .from('levels')
        .select('code')
        .eq('id', sec.level_id)
        .maybeSingle();
      levelType = levelTypeForAudienceLookup(
        (levelRow?.code as string | undefined) ?? null
      );
    }
    if (sec?.academic_year_id && !termId) {
      const { data: termRows } = await service
        .from('terms')
        .select('id')
        .eq('academic_year_id', sec.academic_year_id);
      ayTermIds = ((termRows ?? []) as Array<{ id: string }>).map((t) => t.id);
    }
  }

  // Preschool (levelType null) reads only 'all' rows per KD #50.
  const audiences: Audience[] = levelType ? ['all', levelType] : ['all'];
  let calQuery = service
    .from('school_calendar')
    .select('date, audience, day_type, hbl_overlay')
    .gte('date', startDate)
    .lte('date', endDate)
    .in('audience', audiences);
  if (termId) calQuery = calQuery.eq('term_id', termId);
  else if (ayTermIds && ayTermIds.length > 0)
    calQuery = calQuery.in('term_id', ayTermIds);
  const { data: calRows } = await calQuery;

  const calByMonth = countSchoolDaysByMonth(
    (calRows ?? []) as CalendarDayLite[]
  );

  const rows: MonthlyBreakdownRow[] = [];
  for (const [month, counts] of byMonth.entries()) {
    const present = counts.P + counts.L + counts.EX;
    // Fallback: if the calendar isn't seeded for this date range
    // (legacy data or a test env without seeded calendar), fall back to
    // the records-based count so we don't render a misleading "0".
    const calendarDays = calByMonth.get(month) ?? 0;
    const recordsBasedDays = present + counts.A;
    const schoolDays = calendarDays > 0 ? calendarDays : recordsBasedDays;
    const pct =
      schoolDays > 0 ? Math.round((present / schoolDays) * 10000) / 100 : null;
    const [y, m] = month.split('-');
    const d = new Date(Number(y), Number(m) - 1, 1);
    rows.push({
      month,
      label: d.toLocaleDateString('en-SG', { month: 'long', year: 'numeric' }),
      schoolDays,
      present,
      late: counts.L,
      excused: counts.EX,
      absent: counts.A,
      pct,
    });
  }
  rows.sort((a, b) => (a.month < b.month ? -1 : 1));
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────
// Compassionate-leave quota — counts EX days with ex_reason='compassionate'
// across all section_students for this student in the target AY.
// ─────────────────────────────────────────────────────────────────────────

export type CompassionateUsage = {
  allowance: number;
  used: number;
  remaining: number;
};

export async function getCompassionateUsage(
  studentId: string,
  academicYearId: string
): Promise<CompassionateUsage> {
  const service = createServiceClient();

  // 1. Student's allowance override + school default fallback (mirrors
  // getVacationLeaveUsage's override ?? schoolConfig pattern — previously
  // hardcoded ?? 5 here, which made school_config's
  // defaultCompassionateAllowancePerYear field inert).
  const [{ data: studentRow }, schoolConfig] = await Promise.all([
    service
      .from('students')
      .select('urgent_compassionate_allowance')
      .eq('id', studentId)
      .maybeSingle(),
    getSchoolConfig(),
  ]);
  const allowance =
    (studentRow?.urgent_compassionate_allowance as number | undefined) ??
    schoolConfig.defaultCompassionateAllowancePerYear;

  // 2. All section_students rows for this student in the target AY.
  const { data: ssRows } = await service
    .from('section_students')
    .select('id, sections!inner(academic_year_id)')
    .eq('student_id', studentId)
    .eq('sections.academic_year_id', academicYearId);
  const ssIds = ((ssRows ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (ssIds.length === 0) return { allowance, used: 0, remaining: allowance };

  // 3. ONE query for every `attendance_daily` row for these enrolments,
  //    ordered by recorded_at desc. Walk in a single pass to find the latest
  //    row per (ss_id, date, period_id) and count only those where the latest
  //    is still status=EX + ex_reason=compassionate. Previously this did two
  //    queries (compassionate-only + full re-scan); the rewrite is the
  //    Sprint 14.1 fix per `11-performance-patterns.md`.
  const used = await countLatestCompassionate(service, ssIds);

  return { allowance, used, remaining: Math.max(0, allowance - used) };
}

// Shared helper — walks `attendance_daily` once, returning the count of keys
// whose LATEST row is status=EX + ex_reason=compassionate. Used by both the
// per-student and per-section compassionate-usage helpers.
async function countLatestCompassionate(
  service: ReturnType<typeof createServiceClient>,
  sectionStudentIds: string[]
): Promise<number> {
  if (sectionStudentIds.length === 0) return 0;
  const { data } = await service
    .from('attendance_daily')
    .select(
      'section_student_id, date, period_id, status, ex_reason, recorded_at'
    )
    .in('section_student_id', sectionStudentIds)
    .order('recorded_at', { ascending: false });

  type Row = {
    section_student_id: string;
    date: string;
    period_id: string | null;
    status: AttendanceStatus;
    ex_reason: ExReason | null;
    recorded_at: string;
  };

  const seen = new Set<string>();
  let count = 0;
  for (const r of (data ?? []) as Row[]) {
    const key = `${r.section_student_id}|${r.date}|${r.period_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.status === 'EX' && r.ex_reason === 'compassionate') count += 1;
  }
  return count;
}

// Batch quota resolver for the Attendance wide grid. Previously fan-out:
// N parallel `getCompassionateUsage` calls × 2 queries each = O(N) round-trips.
// Rewritten for Sprint 14.1 as **three** total queries regardless of class
// size — students + section-students + one walk of `attendance_daily`.
export async function getCompassionateUsageForSection(
  sectionId: string,
  academicYearId: string
): Promise<Map<string, CompassionateUsage>> {
  const service = createServiceClient();
  const schoolConfig = await getSchoolConfig();
  const defaultAllowance = schoolConfig.defaultCompassionateAllowancePerYear;

  // 1. Section roster + allowances (one query).
  const { data: enrolments } = await service
    .from('section_students')
    .select('id, student:students(id, urgent_compassionate_allowance)')
    .eq('section_id', sectionId);

  type EnrRow = {
    id: string;
    student:
      | { id: string; urgent_compassionate_allowance: number | null }
      | Array<{ id: string; urgent_compassionate_allowance: number | null }>
      | null;
  };
  const enrolmentList = (enrolments ?? []) as EnrRow[];

  const out = new Map<string, CompassionateUsage>();
  if (enrolmentList.length === 0) return out;

  // enrolmentId → studentId + allowance (with 5-day default).
  const allowanceByStudent = new Map<string, number>();
  const enrolmentToStudent = new Map<string, string>();
  const studentIds = new Set<string>();
  for (const r of enrolmentList) {
    const s = Array.isArray(r.student) ? r.student[0] : r.student;
    if (!s) continue;
    enrolmentToStudent.set(r.id, s.id);
    studentIds.add(s.id);
    if (!allowanceByStudent.has(s.id)) {
      allowanceByStudent.set(
        s.id,
        s.urgent_compassionate_allowance ?? defaultAllowance
      );
    }
  }
  if (studentIds.size === 0) return out;

  // 2. All AY-wide enrolments for these students (one query). Quota is
  // AY-wide, so we need to look beyond this single section — a student
  // moved between sections mid-year still draws from the same quota.
  const { data: ayEnrolments } = await service
    .from('section_students')
    .select('id, student_id, sections!inner(academic_year_id)')
    .in('student_id', Array.from(studentIds))
    .eq('sections.academic_year_id', academicYearId);

  type AyEnrRow = { id: string; student_id: string };
  const ayEnrList = (ayEnrolments ?? []) as AyEnrRow[];

  const ssIdsByStudent = new Map<string, string[]>();
  const allAyEnrolmentIds: string[] = [];
  for (const r of ayEnrList) {
    allAyEnrolmentIds.push(r.id);
    const bucket = ssIdsByStudent.get(r.student_id) ?? [];
    bucket.push(r.id);
    ssIdsByStudent.set(r.student_id, bucket);
  }

  // 3. One walk of `attendance_daily` across every AY enrolment of every
  // student in this section (one query). Group by (ss_id, date, period_id)
  // to find the latest row; then count per section_student_id.
  if (allAyEnrolmentIds.length === 0) {
    // No AY enrolments — every student gets full allowance, 0 used.
    for (const r of enrolmentList) {
      const s = Array.isArray(r.student) ? r.student[0] : r.student;
      if (!s) continue;
      const allowance = allowanceByStudent.get(s.id) ?? defaultAllowance;
      out.set(r.id, { allowance, used: 0, remaining: allowance });
    }
    return out;
  }
  // PAGINATED — this one is the worst in the module. It is AY-wide with no
  // term filter at all, and the worst section measured **5,925 rows** on
  // 2026-08-10, nearly six times PostgREST's 1,000-row cap. Truncated, the
  // tally silently undercounts from roughly T2 onward, so a student who has
  // genuinely exceeded their compassionate-leave allowance stops showing as
  // over-quota and nobody follows up with the family.
  //
  // `recorded_at desc` + latest-per-key dedupe below survives paging: the
  // server orders the whole set and `fetchAllPages` walks it in order.
  //
  // ⚠ `.order('id')` is the TIE-break that makes that true, and it is required
  // here for the same reason as in `getDailyForSection`: a register submit
  // writes ~25 rows in one statement, so they share a `recorded_at`, and
  // `recorded_at desc` alone lets PostgREST order a tied group differently on
  // each `.range()` call. Over 5,925 rows that is six page boundaries for a
  // tie to straddle, and a repeated/skipped row here changes an allowance
  // tally. It does not touch which row wins the dedupe — `recorded_at desc`
  // still decides that.
  const daily = await fetchAllPages<DailyRow>((from, to) =>
    service
      .from('attendance_daily')
      .select(
        'section_student_id, date, period_id, status, ex_reason, recorded_at'
      )
      .in('section_student_id', allAyEnrolmentIds)
      .order('recorded_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to)
  );

  // Walk once: latest-per-key, tally compassionate by section_student_id.
  const seen = new Set<string>();
  const compassionateBySsId = new Map<string, number>();
  for (const r of (daily ?? []) as DailyRow[]) {
    const key = `${r.section_student_id}|${r.date}|${r.period_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.status === 'EX' && r.ex_reason === 'compassionate') {
      compassionateBySsId.set(
        r.section_student_id,
        (compassionateBySsId.get(r.section_student_id) ?? 0) + 1
      );
    }
  }

  // Sum compassionate days per student (across their AY enrolments), then
  // map back to each enrolment in THIS section.
  const usedByStudent = new Map<string, number>();
  for (const [studentId, ssIds] of ssIdsByStudent.entries()) {
    let used = 0;
    for (const ssId of ssIds) {
      used += compassionateBySsId.get(ssId) ?? 0;
    }
    usedByStudent.set(studentId, used);
  }

  for (const [enrolmentId, studentId] of enrolmentToStudent.entries()) {
    const allowance = allowanceByStudent.get(studentId) ?? defaultAllowance;
    const used = usedByStudent.get(studentId) ?? 0;
    out.set(enrolmentId, {
      allowance,
      used,
      remaining: Math.max(0, allowance - used),
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Vacation-leave quota — counts EX days with ex_reason='vacation' in the
// target term (KD #94). HFSE policy: 1 per term, no carry-forward.
// ─────────────────────────────────────────────────────────────────────────

export type VacationLeaveUsage = {
  allowance: number;
  usedThisTerm: number;
  remainingThisTerm: number;
  termId: string;
};

export async function getVacationLeaveUsage(
  studentId: string,
  academicYearId: string,
  termId: string
): Promise<VacationLeaveUsage> {
  const service = createServiceClient();

  // 1. Student's allowance override + school default fallback.
  const [{ data: studentRow }, schoolConfig] = await Promise.all([
    service
      .from('students')
      .select('vacation_leave_allowance_per_term')
      .eq('id', studentId)
      .maybeSingle(),
    getSchoolConfig(),
  ]);
  const override = studentRow?.vacation_leave_allowance_per_term as
    | number
    | null
    | undefined;
  const allowance = override ?? schoolConfig.defaultVlAllowancePerTerm;

  // 2. AY-wide enrolments for this student.
  const { data: ssRows } = await service
    .from('section_students')
    .select('id, sections!inner(academic_year_id)')
    .eq('student_id', studentId)
    .eq('sections.academic_year_id', academicYearId);
  const ssIds = ((ssRows ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (ssIds.length === 0) {
    return { allowance, usedThisTerm: 0, remainingThisTerm: allowance, termId };
  }

  // 3. Vacation-tagged days, grouped into trips.
  //
  // ⚠ A student can hold more than one enrolment in an AY (a mid-year section
  // transfer), so the dates are UNIONED before grouping. Counting per
  // enrolment would split one holiday in two if the child moved class in the
  // middle of it.
  const [{ schoolDays, priorSchoolDay }, datesByEnrolment] = await Promise.all([
    loadTermTripContext(service, termId),
    latestVacationDatesInTerm(service, ssIds, termId),
  ]);
  const dates = new Set<string>();
  for (const set of datesByEnrolment.values()) {
    for (const d of set) dates.add(d);
  }

  const carriedIn = priorSchoolDay
    ? (await wasOnVacation(service, ssIds, priorSchoolDay)).size > 0
    : false;

  const used = countVacationTrips(schoolDays, dates, carriedIn);

  return {
    allowance,
    usedThisTerm: used,
    remainingThisTerm: Math.max(0, allowance - used),
    termId,
  };
}

// Latest-row-per-(ss, date, period) walk for one term, returning the DATES
// each enrolment was on vacation leave.
//
// ⚠ It used to return a COUNT, and that count was the bug: a five-day holiday
// read as 5 used against an allowance of 1. Vacation leave is one TRIP (Mr
// Ace, 2026-08-27), so the caller groups these dates into runs of school days
// via `countVacationTrips`. Shape otherwise mirrors `countLatestCompassionate`
// — which is still a day count, correctly: the compassionate allowance really
// is 5 DAYS per year (KD #94), not 5 occasions.
async function latestVacationDatesInTerm(
  service: ReturnType<typeof createServiceClient>,
  sectionStudentIds: string[],
  termId: string
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (sectionStudentIds.length === 0) return out;

  const { data } = await service
    .from('attendance_daily')
    .select(
      'section_student_id, date, period_id, status, ex_reason, recorded_at'
    )
    .in('section_student_id', sectionStudentIds)
    .eq('term_id', termId)
    .order('recorded_at', { ascending: false });

  type Row = {
    section_student_id: string;
    date: string;
    period_id: string | null;
    status: AttendanceStatus;
    ex_reason: ExReason | null;
    recorded_at: string;
  };

  const seen = new Set<string>();
  for (const r of (data ?? []) as Row[]) {
    const key = `${r.section_student_id}|${r.date}|${r.period_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.status !== 'EX' || r.ex_reason !== 'vacation') continue;
    const dates = out.get(r.section_student_id) ?? new Set<string>();
    dates.add(r.date);
    out.set(r.section_student_id, dates);
  }
  return out;
}

/**
 * What a term looks like to the trip counter: its school days in order, and
 * the one school day immediately before it.
 *
 * ⚠ The preceding day is the whole term-boundary rule. Nothing between two
 * terms is a school day — `school_calendar` rows belong to a term — so the
 * school day before this term IS the previous term's last one. If a student
 * was on vacation leave then, the trip carries in and is not counted again
 * here (Mr Ace: count it where it started).
 */
async function loadTermTripContext(
  service: ReturnType<typeof createServiceClient>,
  termId: string
): Promise<{ schoolDays: string[]; priorSchoolDay: string | null }> {
  const { data: termRow } = await service
    .from('terms')
    .select('id, term_number, start_date, end_date, academic_year_id')
    .eq('id', termId)
    .maybeSingle();
  const term = termRow as {
    term_number: number;
    start_date: string | null;
    end_date: string | null;
    academic_year_id: string;
  } | null;
  if (!term?.start_date || !term.end_date) {
    return { schoolDays: [], priorSchoolDay: null };
  }

  // ⚠ Audience 'all' only, not the section's own half. A quota is a property
  // of the STUDENT and is reported on cross-section screens (Insights, the
  // drill) that hold no one level type; resolving per section would make the
  // same child's allowance read differently depending on which page asked.
  // A level-specific closure day is rare and would at worst merge two trips
  // that a primary-only holiday separated — far less wrong than a figure that
  // disagrees with itself between screens.
  // TWO INDEPENDENT WALKS OFF THE SAME TERM ROW. This term's window and the
  // previous term's last school day are both derived from `term` alone —
  // neither reads anything the other produces — but they ran end to end, so a
  // three-query calendar expansion waited for another three-query calendar
  // expansion for no reason. Run as a pair, the depth is the longer arm (the
  // prior one: look the term up, then expand it) instead of their sum.
  const [schoolDayRows, priorSchoolDay] = await Promise.all([
    expandSchoolDays(service, {
      startDate: term.start_date,
      endDate: term.end_date,
      academicYearId: term.academic_year_id,
      levelType: null,
    }),
    (async () => {
      const { data: priorRow } = await service
        .from('terms')
        .select('start_date, end_date')
        .eq('academic_year_id', term.academic_year_id)
        .eq('term_number', term.term_number - 1)
        .maybeSingle();
      const prior = priorRow as {
        start_date: string | null;
        end_date: string | null;
      } | null;
      if (!prior?.start_date || !prior.end_date) return null;

      const priorDays = await expandSchoolDays(service, {
        startDate: prior.start_date,
        endDate: prior.end_date,
        academicYearId: term.academic_year_id,
        levelType: null,
      });
      return priorDays.at(-1)?.date ?? null;
    })(),
  ]);

  return { schoolDays: schoolDayRows.map((d) => d.date), priorSchoolDay };
}

/** Was this enrolment on vacation leave on one specific earlier day? */
async function wasOnVacation(
  service: ReturnType<typeof createServiceClient>,
  sectionStudentIds: string[],
  date: string
): Promise<Set<string>> {
  const out = new Set<string>();
  if (sectionStudentIds.length === 0) return out;

  const { data } = await service
    .from('attendance_daily')
    .select('section_student_id, period_id, status, ex_reason, recorded_at')
    .in('section_student_id', sectionStudentIds)
    .eq('date', date)
    .order('recorded_at', { ascending: false });

  const seen = new Set<string>();
  for (const r of (data ?? []) as Array<{
    section_student_id: string;
    period_id: string | null;
    status: AttendanceStatus;
    ex_reason: ExReason | null;
  }>) {
    const key = `${r.section_student_id}|${r.period_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.status === 'EX' && r.ex_reason === 'vacation') {
      out.add(r.section_student_id);
    }
  }
  return out;
}

// Batch resolver — three queries regardless of class size, mirroring the
// compassionate helper. Scoped to one term (VL quota is per-term).
export async function getVacationLeaveUsageForSection(
  sectionId: string,
  academicYearId: string,
  termId: string
): Promise<Map<string, VacationLeaveUsage>> {
  const service = createServiceClient();
  const schoolConfig = await getSchoolConfig();
  const defaultAllowance = schoolConfig.defaultVlAllowancePerTerm;

  const { data: enrolments } = await service
    .from('section_students')
    .select('id, student:students(id, vacation_leave_allowance_per_term)')
    .eq('section_id', sectionId);

  type EnrRow = {
    id: string;
    student:
      | { id: string; vacation_leave_allowance_per_term: number | null }
      | Array<{ id: string; vacation_leave_allowance_per_term: number | null }>
      | null;
  };
  const enrolmentList = (enrolments ?? []) as EnrRow[];

  const out = new Map<string, VacationLeaveUsage>();
  if (enrolmentList.length === 0) return out;

  const allowanceByStudent = new Map<string, number>();
  const enrolmentToStudent = new Map<string, string>();
  const studentIds = new Set<string>();
  for (const r of enrolmentList) {
    const s = Array.isArray(r.student) ? r.student[0] : r.student;
    if (!s) continue;
    enrolmentToStudent.set(r.id, s.id);
    studentIds.add(s.id);
    if (!allowanceByStudent.has(s.id)) {
      allowanceByStudent.set(
        s.id,
        s.vacation_leave_allowance_per_term ?? defaultAllowance
      );
    }
  }
  if (studentIds.size === 0) return out;

  // VL quota is per-term, but a student who transferred mid-year may have
  // multiple section_students rows in the AY. We still need ALL of them in
  // play because the VL row is recorded against whichever section the
  // student belonged to on the day — quota stays attached to the student.
  const { data: ayEnrolments } = await service
    .from('section_students')
    .select('id, student_id, sections!inner(academic_year_id)')
    .in('student_id', Array.from(studentIds))
    .eq('sections.academic_year_id', academicYearId);

  type AyEnrRow = { id: string; student_id: string };
  const ayEnrList = (ayEnrolments ?? []) as AyEnrRow[];

  const ssIdsByStudent = new Map<string, string[]>();
  const allAyEnrolmentIds: string[] = [];
  for (const r of ayEnrList) {
    allAyEnrolmentIds.push(r.id);
    const bucket = ssIdsByStudent.get(r.student_id) ?? [];
    bucket.push(r.id);
    ssIdsByStudent.set(r.student_id, bucket);
  }

  if (allAyEnrolmentIds.length === 0) {
    for (const r of enrolmentList) {
      const s = Array.isArray(r.student) ? r.student[0] : r.student;
      if (!s) continue;
      const allowance = allowanceByStudent.get(s.id) ?? defaultAllowance;
      out.set(r.id, {
        allowance,
        usedThisTerm: 0,
        remainingThisTerm: allowance,
        termId,
      });
    }
    return out;
  }

  // PAGINATED for the same reason as its compassionate sibling above: the
  // worst (section x term) measured 1,610 rows on 2026-08-10, over the cap.
  //
  // ⚠ TRIPS, NOT DAYS. The term's school days and the day before it are the
  // same for everybody here, so they are resolved ONCE and reused across the
  // class — the per-student part is only which of those days they were away.
  //
  // `loadTermTripContext` takes the term id and nothing else, so it never
  // needed to wait for this class's marks; it ran after them anyway, and it
  // is by far the deeper of the two (a term row, then two calendar expansions).
  // Its single-student sibling `getVacationLeaveUsage` above has always paired
  // it with its own daily read in one `Promise.all` — this is the batch
  // version catching up with it.
  //
  // Started HERE and not earlier on purpose: the three guards above return
  // without ever needing a trip context, so hoisting this any higher would
  // trade one wave for a handful of wasted calendar reads on an empty class.
  //
  // `.order('id')` is the pagination tie-break, third instance of the same
  // shape in this file — a register submit's ~25 rows share one `recorded_at`,
  // and without a stable second key a tie sitting on a page boundary can come
  // back twice or not at all. Tie-break only; `recorded_at desc` still picks
  // the latest correction.
  const [daily, { schoolDays, priorSchoolDay }] = await Promise.all([
    fetchAllPages<DailyRow>((from, to) =>
      service
        .from('attendance_daily')
        .select(
          'section_student_id, date, period_id, status, ex_reason, recorded_at'
        )
        .in('section_student_id', allAyEnrolmentIds)
        .eq('term_id', termId)
        .order('recorded_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
    ),
    loadTermTripContext(service, termId),
  ]);

  const seen = new Set<string>();
  const vacationDatesBySsId = new Map<string, Set<string>>();
  for (const r of (daily ?? []) as DailyRow[]) {
    const key = `${r.section_student_id}|${r.date}|${r.period_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.status === 'EX' && r.ex_reason === 'vacation') {
      const dates =
        vacationDatesBySsId.get(r.section_student_id) ?? new Set<string>();
      dates.add(r.date);
      vacationDatesBySsId.set(r.section_student_id, dates);
    }
  }

  const carriedInEnrolments = priorSchoolDay
    ? await wasOnVacation(service, allAyEnrolmentIds, priorSchoolDay)
    : new Set<string>();

  const usedByStudent = new Map<string, number>();
  for (const [studentId, ssIds] of ssIdsByStudent.entries()) {
    // Union across the student's enrolments — a mid-year transfer must not
    // split one holiday into two trips.
    const dates = new Set<string>();
    for (const ssId of ssIds) {
      for (const d of vacationDatesBySsId.get(ssId) ?? []) dates.add(d);
    }
    const carriedIn = ssIds.some((id) => carriedInEnrolments.has(id));
    usedByStudent.set(
      studentId,
      countVacationTrips(schoolDays, dates, carriedIn)
    );
  }

  for (const [enrolmentId, studentId] of enrolmentToStudent.entries()) {
    const allowance = allowanceByStudent.get(studentId) ?? defaultAllowance;
    const used = usedByStudent.get(studentId) ?? 0;
    out.set(enrolmentId, {
      allowance,
      usedThisTerm: used,
      remainingThisTerm: Math.max(0, allowance - used),
      termId,
    });
  }
  return out;
}
