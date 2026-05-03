import { createServiceClient } from '@/lib/supabase/service';

import type { AttendanceStatus, ExReason } from '@/lib/schemas/attendance';

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
  date: string;           // yyyy-MM-dd
  status: AttendanceStatus;
  exReason: ExReason | null;
  periodId: string | null;
  recordedBy: string | null;
  recordedAt: string;     // ISO 8601 UTC
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

// Internal row shapes from supabase — camel/snake boundary handled per-query.
type DailyRaw = {
  id: string;
  section_student_id: string;
  term_id: string;
  date: string;
  status: AttendanceStatus;
  ex_reason: ExReason | null;
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

// ─────────────────────────────────────────────────────────────────────────
// Daily grid — one (section × date range) fetch
// ─────────────────────────────────────────────────────────────────────────
//
// Returns the LATEST row per (section_student_id, date, period_id). Older
// corrections are filtered out client-side for simplicity; the dataset per
// section × date-range is at most ~30 students × ~47 school-days = 1,410 rows
// which dedupe in-memory without pain. If volume explodes, push the distinct-
// on into a view.

export async function getDailyForSection(
  sectionId: string,
  termId: string,
  opts?: { fromDate?: string; toDate?: string },
): Promise<DailyEntryRow[]> {
  const service = createServiceClient();

  // Step 1: get section_student IDs for this section.
  const { data: enrolments, error: enrErr } = await service
    .from('section_students')
    .select('id')
    .eq('section_id', sectionId);
  if (enrErr) {
    console.error('[attendance] getDailyForSection enrolments failed:', enrErr.message);
    return [];
  }
  const enrolmentIds = (enrolments ?? []).map((e) => e.id as string);
  if (enrolmentIds.length === 0) return [];

  // Step 2: pull daily rows.
  let query = service
    .from('attendance_daily')
    .select('id, section_student_id, term_id, date, status, ex_reason, period_id, recorded_by, recorded_at')
    .eq('term_id', termId)
    .in('section_student_id', enrolmentIds)
    .order('recorded_at', { ascending: false });

  if (opts?.fromDate) query = query.gte('date', opts.fromDate);
  if (opts?.toDate) query = query.lte('date', opts.toDate);

  const { data, error } = await query;
  if (error) {
    console.error('[attendance] getDailyForSection fetch failed:', error.message);
    return [];
  }

  // Dedupe to latest per (student, date, period). `recorded_at desc` came first.
  const seen = new Set<string>();
  const out: DailyEntryRow[] = [];
  for (const raw of (data ?? []) as DailyRaw[]) {
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
  termId?: string,
): Promise<DailyEntryRow[]> {
  const service = createServiceClient();

  let query = service
    .from('attendance_daily')
    .select('id, section_student_id, term_id, date, status, ex_reason, period_id, recorded_by, recorded_at')
    .eq('section_student_id', sectionStudentId)
    .order('date', { ascending: false })
    .order('recorded_at', { ascending: false });

  if (termId) query = query.eq('term_id', termId);

  const { data, error } = await query;
  if (error) {
    console.error('[attendance] getDailyForStudent fetch failed:', error.message);
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

export async function getRollupForSection(
  sectionId: string,
  termId: string,
): Promise<RollupRow[]> {
  const service = createServiceClient();

  const { data: enrolments, error: enrErr } = await service
    .from('section_students')
    .select('id')
    .eq('section_id', sectionId);
  if (enrErr) {
    console.error('[attendance] getRollupForSection enrolments failed:', enrErr.message);
    return [];
  }
  const enrolmentIds = (enrolments ?? []).map((e) => e.id as string);
  if (enrolmentIds.length === 0) return [];

  const { data, error } = await service
    .from('attendance_records')
    .select(
      'section_student_id, term_id, school_days, days_present, days_late, days_excused, days_absent, attendance_pct',
    )
    .eq('term_id', termId)
    .in('section_student_id', enrolmentIds);
  if (error) {
    console.error('[attendance] getRollupForSection fetch failed:', error.message);
    return [];
  }

  return ((data ?? []) as RollupRaw[]).map(normalizeRollup);
}

// Aggregate view for the Markbook section-detail summary card.
export type SectionAttendanceSummary = {
  sectionId: string;
  termId: string;
  studentCount: number;
  schoolDays: number;             // max across students (handles NC variance)
  averageAttendancePct: number | null;
  totalDaysPresent: number;
  totalDaysLate: number;
  totalDaysAbsent: number;
  totalDaysExcused: number;
  perfectAttendanceCount: number;
};

export async function getSectionAttendanceSummary(
  sectionId: string,
  termId: string,
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
    if (r.daysAbsent === 0 && r.daysLate === 0 && r.schoolDays > 0) perfect += 1;
  }
  return {
    sectionId,
    termId,
    studentCount: rollups.length,
    schoolDays: maxDays,
    averageAttendancePct: pctCount > 0 ? Math.round((sumPct / pctCount) * 100) / 100 : null,
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
  month: string;          // yyyy-MM
  label: string;          // "January 2026"
  schoolDays: number;
  present: number;        // P + L + EX (matches rollup semantics)
  late: number;
  excused: number;
  absent: number;
  pct: number | null;
};

// Computes monthly breakdown from the latest-per-(date,period_id) rows in
// `attendance_daily`. Pass `termId` to scope; otherwise covers all terms.
//
// `schoolDays` per month is the count of encodable days from
// `school_calendar` (`day_type IN ('school_day', 'hbl')`) — NOT the count
// of days the student has rows for. Rows-based counting under-reports
// when entries are missing (late enrollee, ungraded days, etc.). The
// calendar is the source of truth for "how many school days were there
// this month"; entries tell us "how many of those the student attended".
//
// Pct is calendar-based: present / schoolDays. Days without entries
// drag the percentage down — that's the intended signal so missing
// attendance entries surface (vs. silently appearing 100% on whatever
// rows happen to exist).
export async function getMonthlyBreakdown(
  sectionStudentId: string,
  termId?: string,
): Promise<MonthlyBreakdownRow[]> {
  const daily = await getDailyForStudent(sectionStudentId, termId);
  if (daily.length === 0) return [];

  const byMonth = new Map<string, { P: number; L: number; EX: number; A: number; NC: number }>();
  for (const r of daily) {
    const key = r.date.slice(0, 7); // yyyy-MM
    if (!byMonth.has(key)) {
      byMonth.set(key, { P: 0, L: 0, EX: 0, A: 0, NC: 0 });
    }
    byMonth.get(key)![r.status] += 1;
  }

  // Calendar-based schoolDays per month. Range = first of earliest month
  // seen → last of latest month seen. Encodable day_types only —
  // public_holiday / school_holiday / no_class don't count toward
  // schoolDays per migration 019 (KD #50).
  const months = Array.from(byMonth.keys()).sort();
  const [latestY, latestM] = months[months.length - 1].split('-').map(Number);
  const startDate = `${months[0]}-01`;
  const lastDayOfLatest = new Date(latestY, latestM, 0).getDate();
  const endDate = `${months[months.length - 1]}-${String(lastDayOfLatest).padStart(2, '0')}`;

  const service = createServiceClient();
  const { data: calRows } = await service
    .from('school_calendar')
    .select('date')
    .gte('date', startDate)
    .lte('date', endDate)
    .in('day_type', ['school_day', 'hbl']);

  const calByMonth = new Map<string, number>();
  for (const row of (calRows ?? []) as Array<{ date: string }>) {
    const month = row.date.slice(0, 7);
    calByMonth.set(month, (calByMonth.get(month) ?? 0) + 1);
  }

  const rows: MonthlyBreakdownRow[] = [];
  for (const [month, counts] of byMonth.entries()) {
    const present = counts.P + counts.L + counts.EX;
    // Fallback: if the calendar isn't seeded for this date range
    // (legacy data or a test env without seeded calendar), fall back to
    // the records-based count so we don't render a misleading "0".
    const calendarDays = calByMonth.get(month) ?? 0;
    const recordsBasedDays = present + counts.A;
    const schoolDays = calendarDays > 0 ? calendarDays : recordsBasedDays;
    const pct = schoolDays > 0 ? Math.round((present / schoolDays) * 10000) / 100 : null;
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
  academicYearId: string,
): Promise<CompassionateUsage> {
  const service = createServiceClient();

  // 1. Student's allowance.
  const { data: studentRow } = await service
    .from('students')
    .select('urgent_compassionate_allowance')
    .eq('id', studentId)
    .maybeSingle();
  const allowance = (studentRow?.urgent_compassionate_allowance as number | undefined) ?? 5;

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
  sectionStudentIds: string[],
): Promise<number> {
  if (sectionStudentIds.length === 0) return 0;
  const { data } = await service
    .from('attendance_daily')
    .select('section_student_id, date, period_id, status, ex_reason, recorded_at')
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
  academicYearId: string,
): Promise<Map<string, CompassionateUsage>> {
  const service = createServiceClient();

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
      allowanceByStudent.set(s.id, s.urgent_compassionate_allowance ?? 5);
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
      const allowance = allowanceByStudent.get(s.id) ?? 5;
      out.set(r.id, { allowance, used: 0, remaining: allowance });
    }
    return out;
  }
  const { data: daily } = await service
    .from('attendance_daily')
    .select('section_student_id, date, period_id, status, ex_reason, recorded_at')
    .in('section_student_id', allAyEnrolmentIds)
    .order('recorded_at', { ascending: false });

  type DailyRow = {
    section_student_id: string;
    date: string;
    period_id: string | null;
    status: AttendanceStatus;
    ex_reason: ExReason | null;
    recorded_at: string;
  };

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
        (compassionateBySsId.get(r.section_student_id) ?? 0) + 1,
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
    const allowance = allowanceByStudent.get(studentId) ?? 5;
    const used = usedByStudent.get(studentId) ?? 0;
    out.set(enrolmentId, { allowance, used, remaining: Math.max(0, allowance - used) });
  }
  return out;
}
