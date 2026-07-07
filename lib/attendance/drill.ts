import { unstable_cache } from 'next/cache';

import { applyDateRangeFilter } from '@/lib/dashboard/drill-range';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { createServiceClient } from '@/lib/supabase/service';

// Attendance drill primitives — sibling of `lib/markbook/drill.ts`.
// Attendance is registrar+ only on the dashboard (KD #55), so we don't need
// per-teacher row scoping at this layer.

const CACHE_TTL_SECONDS = 60;

function tags(ayCode: string): string[] {
  return ['attendance-drill', `attendance-drill:${ayCode}`];
}

// ─── Targets ────────────────────────────────────────────────────────────────

export type AttendanceDrillTarget =
  | 'attendance-summary' // attendance %
  | 'lates' // late entries
  | 'excused' // excused entries
  | 'absent' // absent entries
  | 'daily-attendance-day' // entries on a specific day
  | 'ex-reason' // entries with that EX reason
  | 'day-type' // calendar days of that type
  | 'top-absent' // student × absences in range
  | 'top-active' // student × attendance % (highest attenders)
  | 'attendance-by-section' // section × attendance %
  | 'compassionate-quota' // student × quota usage (AY-wide)
  | 'vacation-leave-quota'; // student × vacation-leave quota (per term, KD #94)

export type AttendanceDrillRowKind =
  | 'entry'
  | 'top-absent'
  | 'section-rollup'
  | 'compassionate'
  | 'vacation-leave'
  | 'calendar-day';

export function rowKindForTarget(
  t: AttendanceDrillTarget
): AttendanceDrillRowKind {
  switch (t) {
    case 'attendance-summary':
    case 'lates':
    case 'excused':
    case 'absent':
    case 'daily-attendance-day':
    case 'ex-reason':
      return 'entry';
    case 'day-type':
      return 'calendar-day';
    case 'top-absent':
    case 'top-active':
      return 'top-absent';
    case 'attendance-by-section':
      return 'section-rollup';
    case 'compassionate-quota':
      return 'compassionate';
    case 'vacation-leave-quota':
      return 'vacation-leave';
    default: {
      const _exhaustive: never = t;
      throw new Error(`unreachable target: ${String(_exhaustive)}`);
    }
  }
}

// ─── Row shapes ─────────────────────────────────────────────────────────────

export type AttendanceEntryRow = {
  entryId: string;
  attendanceDate: string;
  termId: string;
  sectionId: string;
  sectionName: string;
  studentSectionId: string;
  studentName: string;
  studentNumber: string;
  level: string | null;
  status: 'P' | 'L' | 'EX' | 'A' | 'NC';
  exReason: string | null; // 'mc' | 'compassionate' | 'vacation' | null
  notes: string | null;
};

export type TopAbsentDrillRow = {
  studentSectionId: string;
  studentName: string;
  studentNumber: string;
  sectionId: string;
  sectionName: string;
  level: string | null;
  absences: number;
  lates: number;
  excused: number;
  encodedDays: number;
  attendancePct: number;
};

export type SectionAttendanceRow = {
  sectionId: string;
  sectionName: string;
  level: string | null;
  encodedDays: number;
  presentCount: number;
  lateCount: number;
  excusedCount: number;
  absentCount: number;
  attendancePct: number;
};

export type CompassionateUsageRow = {
  studentSectionId: string;
  studentName: string;
  studentNumber: string;
  sectionId: string;
  sectionName: string;
  level: string | null;
  allowance: number;
  used: number;
  remaining: number;
  isOverQuota: boolean;
};

// KD #94 — vacation-leave drill row. Quota is per-term (HFSE policy: 1 per
// term), so this row carries the term context and a separate over-quota flag.
export type VacationLeaveUsageRow = {
  studentSectionId: string;
  studentName: string;
  studentNumber: string;
  sectionId: string;
  sectionName: string;
  level: string | null;
  termId: string;
  termNumber: number;
  allowance: number;
  usedThisTerm: number;
  remainingThisTerm: number;
  isOverTermQuota: boolean;
};

export type CalendarDayRow = {
  date: string;
  termId: string;
  termNumber: number;
  dayType:
    | 'school_day'
    | 'public_holiday'
    | 'school_holiday'
    | 'hbl'
    | 'no_class';
  label: string | null;
};

export type AttendanceDrillRow =
  | AttendanceEntryRow
  | TopAbsentDrillRow
  | SectionAttendanceRow
  | CompassionateUsageRow
  | VacationLeaveUsageRow
  | CalendarDayRow;

// ─── Range input ────────────────────────────────────────────────────────────

export type DrillRangeInput = {
  ayCode: string;
  from?: string;
  to?: string;
};

// ─── AY context resolver ────────────────────────────────────────────────────

type SectionLite = { id: string; name: string; level_id: string };
type StudentSectionLite = {
  id: string;
  section_id: string;
  student_id: string;
  enrollment_status: string;
};
type StudentLite = {
  id: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  student_number: string;
  urgent_compassionate_allowance: number | null;
  vacation_leave_allowance_per_term: number | null;
};
type LevelLite = { id: string; code: string };
type TermLite = { id: string; term_number: number; academic_year_id: string };

async function resolveAyContext(ayCode: string) {
  const service = createServiceClient();
  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = (ayRow?.id as string | undefined) ?? null;
  if (!ayId) {
    return {
      ayId: null,
      sections: [] as SectionLite[],
      sectionStudents: [] as StudentSectionLite[],
      students: new Map<string, StudentLite>(),
      levels: new Map<string, string>(),
      terms: [] as TermLite[],
    };
  }
  const [sectionsRes, levelsRes, termsRes] = await Promise.all([
    service
      .from('sections')
      .select('id, name, level_id')
      .eq('academic_year_id', ayId),
    service.from('levels').select('id, code'),
    service
      .from('terms')
      .select('id, term_number, academic_year_id')
      .eq('academic_year_id', ayId),
  ]);
  const sections = (sectionsRes.data ?? []) as SectionLite[];
  const sectionIds = sections.map((s) => s.id);

  const levels = new Map<string, string>();
  for (const l of (levelsRes.data ?? []) as LevelLite[])
    levels.set(l.id, l.code);

  let sectionStudents: StudentSectionLite[] = [];
  const studentMap = new Map<string, StudentLite>();
  if (sectionIds.length > 0) {
    // Paginate — same reasoning as lib/attendance/dashboard.ts: AY9999's
    // section_students count can exceed 1000 with transfers + re-enrols,
    // and a silent truncation halves the drill's row set.
    const ssRows = await fetchAllPages<StudentSectionLite>((from, to) =>
      service
        .from('section_students')
        .select('id, section_id, student_id, enrollment_status')
        .in('section_id', sectionIds)
        .range(from, to)
    );
    sectionStudents = ssRows;
    const studentIds = Array.from(
      new Set(sectionStudents.map((s) => s.student_id))
    );
    if (studentIds.length > 0) {
      // chunk to avoid URL length limits (100 UUIDs ≈ 3.7 KB; ~400+ ids overflow ~8 KB)
      const chunks: string[][] = [];
      for (let i = 0; i < studentIds.length; i += 100) {
        chunks.push(studentIds.slice(i, i + 100));
      }
      for (const chunk of chunks) {
        const { data: studs } = await service
          .from('students')
          .select(
            'id, first_name, middle_name, last_name, student_number, urgent_compassionate_allowance, vacation_leave_allowance_per_term'
          )
          .in('id', chunk);
        for (const s of (studs ?? []) as StudentLite[]) studentMap.set(s.id, s);
      }
    }
  }
  return {
    ayId,
    sections,
    sectionStudents,
    students: studentMap,
    levels,
    terms: (termsRes.data ?? []) as TermLite[],
  };
}

function studentName(s: StudentLite): string {
  const parts = [s.first_name, s.middle_name, s.last_name].filter(Boolean);
  const name = parts.join(' ').trim();
  return name || s.student_number || s.id;
}

// ─── Loaders ────────────────────────────────────────────────────────────────

// Perf note (measured 2026-05-06 against AY9999 with ~200 students +
// ~12K attendance_daily rows): full cold-load wall time ~335ms total
// (sections 99ms + section_students 115ms + attendance_daily 119ms). The
// chunking by 500 section_student_ids per `.in()` clause is a single
// query at this scale, not the 60+ parallel queries an earlier audit
// claimed. Cached 60s via unstable_cache, so consecutive renders are
// instant. Refactor to DB-side aggregation only if HFSE crosses ~1000
// students per AY (currently ~3-4× headroom).
async function loadEntryRowsUncached(
  ayCode: string
): Promise<AttendanceEntryRow[]> {
  const service = createServiceClient();
  const ctx = await resolveAyContext(ayCode);
  if (!ctx.ayId) return [];

  const ssById = new Map<string, StudentSectionLite>();
  for (const ss of ctx.sectionStudents) ssById.set(ss.id, ss);
  const sectionById = new Map<string, SectionLite>();
  for (const s of ctx.sections) sectionById.set(s.id, s);

  const ssIds = ctx.sectionStudents.map((ss) => ss.id);
  if (ssIds.length === 0) return [];

  // Chunk by section_student_id to bound each PostgREST IN-clause, then
  // paginate via .range() inside each chunk so the server's 1000-row
  // response cap doesn't silently truncate at HFSE scale (200 students ×
  // 60+ school days = 12K+ rows for a full term per AY).
  // Column is `date` on the schema (migration 014); the camelCase alias
  // `attendanceDate` on the public row shape is mapped below. `notes` was
  // referenced here but isn't a real column on attendance_daily — dropped.
  type EntryLite = {
    id: string;
    date: string;
    term_id: string;
    section_student_id: string;
    status: string;
    ex_reason: string | null;
  };
  const CHUNK = 100; // UUIDs per IN-clause — keep URL < ~8 KB (100 ≈ 3.7 KB)
  const all = (
    await Promise.all(
      Array.from({ length: Math.ceil(ssIds.length / CHUNK) }, (_, i) =>
        fetchAllPages<EntryLite>((from, to) =>
          service
            .from('attendance_daily')
            .select('id, date, term_id, section_student_id, status, ex_reason')
            .in('section_student_id', ssIds.slice(i * CHUNK, (i + 1) * CHUNK))
            .range(from, to)
        )
      )
    )
  ).flat();

  const out: AttendanceEntryRow[] = [];
  for (const e of all) {
    const ss = ssById.get(e.section_student_id);
    if (!ss) continue;
    const section = sectionById.get(ss.section_id);
    if (!section) continue;
    const student = ctx.students.get(ss.student_id);
    if (!student) continue;
    out.push({
      entryId: e.id,
      attendanceDate: e.date,
      termId: e.term_id,
      sectionId: section.id,
      sectionName: section.name,
      studentSectionId: ss.id,
      studentName: studentName(student),
      studentNumber: student.student_number,
      level: ctx.levels.get(section.level_id) ?? null,
      status: e.status as AttendanceEntryRow['status'],
      exReason: e.ex_reason,
      notes: null,
    });
  }
  return out;
}

// loadEntryRows: uncached on purpose. The full AY's attendance_daily set
// runs ~12K rows now and ~50K at a full school year — well past Next.js's
// 2MB unstable_cache limit. Wrapping this in unstable_cache silently failed
// the cache write and made every drill render re-hit Supabase from cold.
//
// Per KD #56: pre-fetch returns ROLLED-UP shapes (which DO get cached, see
// buildAllRowSets below). Raw entries are consumed by:
//   1. The dashboard pre-fetch (buildAllRowSets) — same-render React
//      request dedup means the multi-rollup pass shares one DB fetch.
//   2. Drill API routes for entry-kind drills — already lazy-fetch on
//      demand, the per-request latency is acceptable.
function loadEntryRows(ayCode: string): Promise<AttendanceEntryRow[]> {
  return loadEntryRowsUncached(ayCode);
}

async function loadCalendarRowsUncached(
  ayCode: string
): Promise<CalendarDayRow[]> {
  const service = createServiceClient();
  const ctx = await resolveAyContext(ayCode);
  if (!ctx.ayId || ctx.terms.length === 0) return [];
  const termById = new Map<string, TermLite>();
  for (const t of ctx.terms) termById.set(t.id, t);
  const termIds = ctx.terms.map((t) => t.id);

  // Column is `date` per migration 015 (school_calendar) — earlier code
  // referenced `calendar_date` which doesn't exist; PostgREST 400'd and
  // the calendar drill silently returned an empty array.
  const { data } = await service
    .from('school_calendar')
    .select('term_id, date, day_type, label')
    .in('term_id', termIds);
  type CalLite = {
    term_id: string;
    date: string;
    day_type: string;
    label: string | null;
  };
  const rows = (data ?? []) as CalLite[];
  return rows
    .map((r): CalendarDayRow | null => {
      const term = termById.get(r.term_id);
      if (!term) return null;
      const dt = r.day_type as CalendarDayRow['dayType'];
      return {
        date: r.date,
        termId: r.term_id,
        termNumber: term.term_number,
        dayType: dt,
        label: r.label,
      };
    })
    .filter((r): r is CalendarDayRow => r !== null);
}

function loadCalendarRows(ayCode: string): Promise<CalendarDayRow[]> {
  return unstable_cache(
    () => loadCalendarRowsUncached(ayCode),
    ['attendance-drill', 'calendar', ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(ayCode) }
  )();
}

// ─── Aggregators on top of entries ──────────────────────────────────────────

function rollupTopAbsent(entries: AttendanceEntryRow[]): TopAbsentDrillRow[] {
  type Acc = {
    studentSectionId: string;
    studentName: string;
    studentNumber: string;
    sectionId: string;
    sectionName: string;
    level: string | null;
    absent: number;
    late: number;
    excused: number;
    encoded: number;
    present: number;
  };
  const map = new Map<string, Acc>();
  for (const e of entries) {
    const key = e.studentSectionId;
    let acc = map.get(key);
    if (!acc) {
      acc = {
        studentSectionId: e.studentSectionId,
        studentName: e.studentName,
        studentNumber: e.studentNumber,
        sectionId: e.sectionId,
        sectionName: e.sectionName,
        level: e.level,
        absent: 0,
        late: 0,
        excused: 0,
        encoded: 0,
        present: 0,
      };
      map.set(key, acc);
    }
    if (e.status === 'NC') continue;
    acc.encoded += 1;
    if (e.status === 'A') acc.absent += 1;
    if (e.status === 'L') acc.late += 1;
    if (e.status === 'EX') acc.excused += 1;
    if (e.status === 'P') acc.present += 1;
  }
  const rows: TopAbsentDrillRow[] = [];
  for (const a of map.values()) {
    rows.push({
      studentSectionId: a.studentSectionId,
      studentName: a.studentName,
      studentNumber: a.studentNumber,
      sectionId: a.sectionId,
      sectionName: a.sectionName,
      level: a.level,
      absences: a.absent,
      lates: a.late,
      excused: a.excused,
      encodedDays: a.encoded,
      attendancePct:
        a.encoded > 0
          ? Math.round(((a.present + a.late + a.excused) / a.encoded) * 100)
          : 0,
    });
  }
  rows.sort((a, b) => b.absences - a.absences || b.lates - a.lates);
  return rows;
}

function rollupBySection(
  entries: AttendanceEntryRow[]
): SectionAttendanceRow[] {
  type Acc = {
    sectionId: string;
    sectionName: string;
    level: string | null;
    encoded: number;
    present: number;
    late: number;
    excused: number;
    absent: number;
  };
  const map = new Map<string, Acc>();
  for (const e of entries) {
    let acc = map.get(e.sectionId);
    if (!acc) {
      acc = {
        sectionId: e.sectionId,
        sectionName: e.sectionName,
        level: e.level,
        encoded: 0,
        present: 0,
        late: 0,
        excused: 0,
        absent: 0,
      };
      map.set(e.sectionId, acc);
    }
    if (e.status === 'NC') continue;
    acc.encoded += 1;
    if (e.status === 'P') acc.present += 1;
    if (e.status === 'L') acc.late += 1;
    if (e.status === 'EX') acc.excused += 1;
    if (e.status === 'A') acc.absent += 1;
  }
  const rows: SectionAttendanceRow[] = [];
  for (const a of map.values()) {
    rows.push({
      sectionId: a.sectionId,
      sectionName: a.sectionName,
      level: a.level,
      encodedDays: a.encoded,
      presentCount: a.present,
      lateCount: a.late,
      excusedCount: a.excused,
      absentCount: a.absent,
      attendancePct:
        a.encoded > 0
          ? Math.round(((a.present + a.late + a.excused) / a.encoded) * 100)
          : 0,
    });
  }
  rows.sort((a, b) => a.attendancePct - b.attendancePct);
  return rows;
}

// Pure seam (exported for unit tests): tally leave usage per STUDENT — not per
// section_students row. A mid-year transfer (KD #67) leaves the pre-transfer
// usage recorded against the withdrawn enrolment row, so counting only the
// active row's own entries under-reports a transferred student's used days.
// The quota is attached to the student, so usage is the union across every
// enrolment row in the AY — mirroring `getCompassionateUsageForSection` /
// `getVacationLeaveUsageForSection` in lib/attendance/queries.ts.
export function tallyLeaveUsageByStudent(
  entries: Array<
    Pick<
      AttendanceEntryRow,
      'studentSectionId' | 'termId' | 'status' | 'exReason'
    >
  >,
  studentIdBySectionStudentId: Map<string, string>,
  exReason: 'compassionate' | 'vacation',
  termId?: string | null
): Map<string, number> {
  const usage = new Map<string, number>();
  for (const e of entries) {
    if (termId && e.termId !== termId) continue;
    if (e.status !== 'EX' || e.exReason !== exReason) continue;
    const studentId = studentIdBySectionStudentId.get(e.studentSectionId);
    if (!studentId) continue;
    usage.set(studentId, (usage.get(studentId) ?? 0) + 1);
  }
  return usage;
}

async function rollupCompassionate(
  ayCode: string,
  preloadedEntries?: AttendanceEntryRow[]
): Promise<CompassionateUsageRow[]> {
  const ctx = await resolveAyContext(ayCode);
  if (!ctx.ayId || ctx.sectionStudents.length === 0) return [];
  // Compassionate quota is intentionally **AY-wide** — the registrar's
  // operational concern is "has student X consumed >5 compassionate
  // absences this AY?" The selected dashboard date range does NOT narrow
  // this metric; quota consumption accumulates over the whole AY and the
  // panel always shows year-to-date usage. This matches KD #74 (the
  // priority panel pulls this rollup for the chips, regardless of range).
  // When buildAllRowSets has already loaded entries, reuse them rather than
  // hitting the cache + re-iterating ~180k rows for a second roll-up.
  const entries = preloadedEntries ?? (await loadEntryRows(ayCode));
  // Per-student union across ALL enrolment rows (incl. withdrawn pre-transfer
  // rows, KD #67) — ctx.sectionStudents deliberately includes withdrawn rows.
  const studentIdBySsId = new Map<string, string>();
  for (const ss of ctx.sectionStudents)
    studentIdBySsId.set(ss.id, ss.student_id);
  const usage = tallyLeaveUsageByStudent(
    entries,
    studentIdBySsId,
    'compassionate'
  );
  const sectionById = new Map<string, SectionLite>();
  for (const s of ctx.sections) sectionById.set(s.id, s);
  const rows: CompassionateUsageRow[] = [];
  for (const ss of ctx.sectionStudents) {
    if (ss.enrollment_status === 'withdrawn') continue;
    const student = ctx.students.get(ss.student_id);
    if (!student) continue;
    const section = sectionById.get(ss.section_id);
    if (!section) continue;
    const used = usage.get(ss.student_id) ?? 0;
    const allowance = student.urgent_compassionate_allowance ?? 5;
    rows.push({
      studentSectionId: ss.id,
      studentName: studentName(student),
      studentNumber: student.student_number,
      sectionId: section.id,
      sectionName: section.name,
      level: ctx.levels.get(section.level_id) ?? null,
      allowance,
      used,
      remaining: allowance - used,
      isOverQuota: used > allowance,
    });
  }
  rows.sort((a, b) => b.used - a.used || a.remaining - b.remaining);
  return rows;
}

// Vacation-leave rollup (KD #94) — scoped to a single term. HFSE policy:
// 1 VL per term, no carry-forward. When termId is not provided we return
// an empty array — VL is term-scoped by design, the caller must resolve
// the current term first.
//
// Takes `defaultAllowance` as a parameter (vs reading school_config inline)
// so this module stays client-bundle-safe — client components import value
// symbols like the column-label maps, and pulling a 'server-only' module
// into the import graph would block the client build.
async function rollupVacationLeave(
  ayCode: string,
  termId: string | null,
  defaultAllowance: number,
  preloadedEntries?: AttendanceEntryRow[]
): Promise<VacationLeaveUsageRow[]> {
  if (!termId) return [];
  const ctx = await resolveAyContext(ayCode);
  if (!ctx.ayId || ctx.sectionStudents.length === 0) return [];
  const term = ctx.terms.find((t) => t.id === termId);
  if (!term) return [];

  const entries = preloadedEntries ?? (await loadEntryRows(ayCode));

  // Per-student union across ALL enrolment rows (incl. withdrawn pre-transfer
  // rows, KD #67) — the VL entry is recorded against whichever section the
  // student belonged to on the day; quota stays attached to the student
  // (mirrors getVacationLeaveUsageForSection in lib/attendance/queries.ts).
  const studentIdBySsId = new Map<string, string>();
  for (const ss of ctx.sectionStudents)
    studentIdBySsId.set(ss.id, ss.student_id);
  const usage = tallyLeaveUsageByStudent(
    entries,
    studentIdBySsId,
    'vacation',
    termId
  );

  const sectionById = new Map<string, SectionLite>();
  for (const s of ctx.sections) sectionById.set(s.id, s);
  const rows: VacationLeaveUsageRow[] = [];
  for (const ss of ctx.sectionStudents) {
    if (ss.enrollment_status === 'withdrawn') continue;
    const student = ctx.students.get(ss.student_id);
    if (!student) continue;
    const section = sectionById.get(ss.section_id);
    if (!section) continue;
    const used = usage.get(ss.student_id) ?? 0;
    const allowance =
      student.vacation_leave_allowance_per_term ?? defaultAllowance;
    rows.push({
      studentSectionId: ss.id,
      studentName: studentName(student),
      studentNumber: student.student_number,
      sectionId: section.id,
      sectionName: section.name,
      level: ctx.levels.get(section.level_id) ?? null,
      termId: term.id,
      termNumber: term.term_number,
      allowance,
      usedThisTerm: used,
      remainingThisTerm: Math.max(0, allowance - used),
      isOverTermQuota: used > allowance,
    });
  }
  rows.sort(
    (a, b) =>
      b.usedThisTerm - a.usedThisTerm ||
      a.remainingThisTerm - b.remainingThisTerm
  );
  return rows;
}

// ─── Public builders ────────────────────────────────────────────────────────

export type BuildDrillRowsInput = DrillRangeInput & {
  target: AttendanceDrillTarget;
  segment?: string | null;
  // termId is required for the 'vacation-leave-quota' target (per KD #94).
  // Other targets ignore it.
  termId?: string | null;
  // School-wide VL allowance default — caller (drill API route or page)
  // fetches from school_config and passes in. Defaults to 1.
  defaultVlAllowance?: number;
};

function applyScopeFilter<T extends { attendanceDate?: string; date?: string }>(
  rows: T[],
  input: DrillRangeInput
): T[] {
  return applyDateRangeFilter(
    rows,
    input,
    (r) => r.attendanceDate ?? r.date ?? null,
    { caller: 'attendance/drill' }
  );
}

export async function buildAttendanceDrillRows(
  input: BuildDrillRowsInput
): Promise<AttendanceDrillRow[]> {
  const kind = rowKindForTarget(input.target);

  if (kind === 'entry') {
    let rows = await loadEntryRows(input.ayCode);
    rows = applyScopeFilter(rows, input);
    return applyTargetFilter(
      rows,
      input.target,
      input.segment ?? null
    ) as AttendanceDrillRow[];
  }
  if (kind === 'calendar-day') {
    let rows = await loadCalendarRows(input.ayCode);
    rows = applyScopeFilter(rows, input);
    return applyTargetFilter(
      rows,
      input.target,
      input.segment ?? null
    ) as AttendanceDrillRow[];
  }
  if (kind === 'top-absent') {
    let entries = await loadEntryRows(input.ayCode);
    entries = applyScopeFilter(entries, input);
    return rollupTopAbsent(entries) as AttendanceDrillRow[];
  }
  if (kind === 'section-rollup') {
    let entries = await loadEntryRows(input.ayCode);
    entries = applyScopeFilter(entries, input);
    return rollupBySection(entries) as AttendanceDrillRow[];
  }
  if (kind === 'vacation-leave') {
    return (await rollupVacationLeave(
      input.ayCode,
      input.termId ?? null,
      input.defaultVlAllowance ?? 1
    )) as AttendanceDrillRow[];
  }
  // compassionate
  return (await rollupCompassionate(input.ayCode)) as AttendanceDrillRow[];
}

type AllRowSets = {
  topAbsent: TopAbsentDrillRow[];
  sectionAttendance: SectionAttendanceRow[];
  calendar: CalendarDayRow[];
  compassionate: CompassionateUsageRow[];
  vacationLeave: VacationLeaveUsageRow[];
};

async function buildAllRowSetsUncached(input: {
  ayCode: string;
  from?: string;
  to?: string;
  vacationTermId?: string | null;
  // KD #94 — school-wide default VL allowance per term. Caller fetches
  // from school_config and passes in (keeps drill.ts free of server-only
  // module imports). Defaults to 1 (HFSE policy) when omitted.
  defaultVlAllowance?: number;
}): Promise<AllRowSets> {
  // We still need entries internally to build the rolled-up shapes, but we
  // do NOT return them — at 1000 students × 180 school days that's 180k
  // rows we'd ship through the RSC payload for nothing. Drill sheets that
  // need raw entries lazy-fetch via /api/attendance/drill/{target}.
  const [entriesAll, calendarAll] = await Promise.all([
    loadEntryRows(input.ayCode),
    loadCalendarRows(input.ayCode),
  ]);
  // Pass entriesAll into rollup helpers so they don't redundantly hit
  // loadEntryRows + re-iterate 180k rows for the same roll-up.
  const [compassionate, vacationLeave] = await Promise.all([
    rollupCompassionate(input.ayCode, entriesAll),
    rollupVacationLeave(
      input.ayCode,
      input.vacationTermId ?? null,
      input.defaultVlAllowance ?? 1,
      entriesAll
    ),
  ]);
  const entries = applyScopeFilter(entriesAll, input);
  const calendar = applyScopeFilter(calendarAll, input);
  return {
    topAbsent: rollupTopAbsent(entries),
    sectionAttendance: rollupBySection(entries),
    calendar,
    compassionate,
    vacationLeave,
  };
}

// Cached at the OUTPUT level — rolled-up shapes are tiny (sectionAttendance
// is ~21 rows; topAbsent is ~50; calendar is ~220; compassionate is ~10;
// vacationLeave is ~200 in current AY), total << 2MB so the cache write
// succeeds. Per-call key includes from/to + vacationTermId since those
// affect the filtered output.
export function buildAllRowSets(input: {
  ayCode: string;
  from?: string;
  to?: string;
  vacationTermId?: string | null;
  defaultVlAllowance?: number;
}): Promise<AllRowSets> {
  return unstable_cache(
    () => buildAllRowSetsUncached(input),
    [
      'attendance-drill',
      'all-row-sets',
      input.ayCode,
      input.from ?? '',
      input.to ?? '',
      input.vacationTermId ?? '',
      String(input.defaultVlAllowance ?? 1),
    ],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(input.ayCode) }
  )();
}

// ─── Target filter ──────────────────────────────────────────────────────────

function applyTargetFilter(
  rows: AttendanceDrillRow[],
  target: AttendanceDrillTarget,
  segment: string | null
): AttendanceDrillRow[] {
  switch (target) {
    case 'attendance-summary':
      return (rows as AttendanceEntryRow[]).filter(
        (r) => r.status !== 'NC'
      ) as AttendanceDrillRow[];
    case 'lates':
      return (rows as AttendanceEntryRow[]).filter(
        (r) => r.status === 'L'
      ) as AttendanceDrillRow[];
    case 'excused':
      return (rows as AttendanceEntryRow[]).filter(
        (r) => r.status === 'EX'
      ) as AttendanceDrillRow[];
    case 'absent':
      return (rows as AttendanceEntryRow[]).filter(
        (r) => r.status === 'A'
      ) as AttendanceDrillRow[];
    case 'daily-attendance-day':
      if (!segment) return rows;
      return (rows as AttendanceEntryRow[]).filter(
        (r) => r.attendanceDate.slice(0, 10) === segment
      ) as AttendanceDrillRow[];
    case 'ex-reason': {
      if (!segment)
        return (rows as AttendanceEntryRow[]).filter(
          (r) => r.status === 'EX'
        ) as AttendanceDrillRow[];
      // Donut sends the LABEL form ('MC / Excuse leave' / 'Compassionate' /
      // 'Vacation leave' / 'Other') from `lib/attendance/dashboard.ts`'s
      // `LABEL` map. Reverse-lookup to the raw `ex_reason` enum so the
      // filter actually matches. `'Other'` matches null (the dashboard
      // groups null reasons under that bucket).
      const labelToEnum: Record<string, string> = {
        'MC / Excuse leave': 'mc',
        Compassionate: 'compassionate',
        'Vacation leave': 'vacation',
      };
      if (segment === 'Other' || segment.toLowerCase() === 'other') {
        return (rows as AttendanceEntryRow[]).filter(
          (r) => r.status === 'EX' && r.exReason == null
        ) as AttendanceDrillRow[];
      }
      const target = labelToEnum[segment] ?? segment.toLowerCase();
      return (rows as AttendanceEntryRow[]).filter(
        (r) => r.status === 'EX' && r.exReason === target
      ) as AttendanceDrillRow[];
    }
    case 'day-type': {
      if (!segment) return rows;
      // Day-type donut sends the human-readable LABEL as segment
      // (e.g. 'School day'), but `r.dayType` stores the raw DB enum value
      // (e.g. 'school_day'). Reverse-lookup so segment clicks match.
      const labelToEnum: Record<string, string> = {
        'School day': 'school_day',
        HBL: 'hbl',
        'Public holiday': 'public_holiday',
        'School holiday': 'school_holiday',
        'No class': 'no_class',
      };
      const target = labelToEnum[segment] ?? segment;
      return (rows as CalendarDayRow[]).filter(
        (r) => r.dayType === target
      ) as AttendanceDrillRow[];
    }
    case 'top-absent':
      return rows;
    case 'top-active': {
      // Same row shape as top-absent — registrar's sibling lens. Sort
      // ascending by absences (then desc by attendancePct) so the front
      // of the list is the perfect-attender / honor-roll cohort.
      const sorted = [...(rows as TopAbsentDrillRow[])].sort(
        (a, b) => a.absences - b.absences || b.attendancePct - a.attendancePct
      );
      return sorted as AttendanceDrillRow[];
    }
    case 'attendance-by-section':
    case 'compassionate-quota':
    case 'vacation-leave-quota':
      return rows;
    default:
      return rows;
  }
}

// ─── Per-target columns ─────────────────────────────────────────────────────

export type DrillColumnKey =
  | 'studentName'
  | 'studentNumber'
  | 'sectionName'
  | 'level'
  | 'attendanceDate'
  | 'status'
  | 'exReason'
  | 'absences'
  | 'lates'
  | 'excused'
  | 'encodedDays'
  | 'attendancePct'
  | 'date'
  | 'dayType'
  | 'label'
  | 'allowance'
  | 'used'
  | 'remaining'
  | 'isOverQuota'
  | 'termNumber'
  | 'usedThisTerm'
  | 'remainingThisTerm'
  | 'isOverTermQuota';

export const DRILL_COLUMN_LABELS: Record<DrillColumnKey, string> = {
  studentName: 'Student',
  studentNumber: 'Student ID',
  sectionName: 'Section',
  level: 'Level',
  attendanceDate: 'Date',
  status: 'Status',
  exReason: 'Reason',
  absences: 'Absent',
  lates: 'Late',
  excused: 'Excused',
  encodedDays: 'Encoded days',
  attendancePct: 'Attendance %',
  date: 'Date',
  dayType: 'Day type',
  label: 'Label',
  allowance: 'Allowance',
  used: 'Used',
  remaining: 'Remaining',
  isOverQuota: 'Over quota?',
  termNumber: 'Term',
  usedThisTerm: 'Used this term',
  remainingThisTerm: 'Remaining this term',
  isOverTermQuota: 'Over term quota?',
};

const ENTRY_COLUMNS: DrillColumnKey[] = [
  'attendanceDate',
  'studentName',
  'sectionName',
  'level',
  'status',
  'exReason',
];
const TOP_ABSENT_COLUMNS: DrillColumnKey[] = [
  'studentName',
  'sectionName',
  'level',
  'absences',
  'lates',
  'excused',
  'attendancePct',
];
const SECTION_COLUMNS: DrillColumnKey[] = [
  'sectionName',
  'level',
  'attendancePct',
  'absences',
  'lates',
  'encodedDays',
];
const COMPASSIONATE_COLUMNS: DrillColumnKey[] = [
  'studentName',
  'sectionName',
  'level',
  'allowance',
  'used',
  'remaining',
  'isOverQuota',
];
const VACATION_LEAVE_COLUMNS: DrillColumnKey[] = [
  'studentName',
  'sectionName',
  'level',
  'termNumber',
  'allowance',
  'usedThisTerm',
  'remainingThisTerm',
  'isOverTermQuota',
];
const CALENDAR_COLUMNS: DrillColumnKey[] = ['date', 'dayType', 'label'];

export function allColumnsForKind(
  kind: AttendanceDrillRowKind
): DrillColumnKey[] {
  switch (kind) {
    case 'entry':
      return ENTRY_COLUMNS;
    case 'top-absent':
      return TOP_ABSENT_COLUMNS;
    case 'section-rollup':
      return SECTION_COLUMNS;
    case 'compassionate':
      return COMPASSIONATE_COLUMNS;
    case 'vacation-leave':
      return VACATION_LEAVE_COLUMNS;
    case 'calendar-day':
      return CALENDAR_COLUMNS;
  }
}

export function defaultColumnsForTarget(
  target: AttendanceDrillTarget
): DrillColumnKey[] {
  // Late and Absent rows can never carry an `ex_reason` — the schema only
  // allows that column for `status='EX'`. Strip it from the defaults so the
  // drill doesn't render an always-blank Reason column. The Columns
  // dropdown can still surface it on demand.
  if (target === 'lates' || target === 'absent') {
    return ENTRY_COLUMNS.filter((c) => c !== 'exReason');
  }
  return allColumnsForKind(rowKindForTarget(target));
}

export function drillHeaderForTarget(
  target: AttendanceDrillTarget,
  segment: string | null
): { eyebrow: string; title: string } {
  switch (target) {
    case 'attendance-summary':
      return {
        eyebrow: 'Attendance',
        title: 'All daily attendance marks for this date range',
      };
    case 'lates':
      return {
        eyebrow: 'Attendance',
        title: 'Students who arrived late on each date',
      };
    case 'excused':
      return {
        eyebrow: 'Attendance',
        title: 'Excused absences (with reason category)',
      };
    case 'absent':
      return { eyebrow: 'Attendance', title: 'Students absent on each date' };
    case 'daily-attendance-day':
      return {
        eyebrow: 'Attendance',
        title: segment ? `Attendance on ${segment}` : 'Daily attendance',
      };
    case 'ex-reason':
      return {
        eyebrow: 'Attendance',
        title: segment
          ? `Excused absences — reason: ${segment}`
          : 'Excused absences by reason',
      };
    case 'day-type':
      return {
        eyebrow: 'School calendar',
        title: segment
          ? `Calendar days — type: ${segment}`
          : 'School calendar by day type',
      };
    case 'top-absent':
      return {
        eyebrow: 'Needs attention',
        title: 'Students with the most absences',
      };
    case 'top-active':
      return {
        eyebrow: 'Needs attention',
        title: 'Students with the best attendance',
      };
    case 'attendance-by-section':
      return {
        eyebrow: 'Attendance',
        title: 'Attendance percentage by section',
      };
    case 'compassionate-quota':
      return {
        eyebrow: 'Attendance',
        title: 'Compassionate-leave quota usage by student',
      };
    case 'vacation-leave-quota':
      return {
        eyebrow: 'Attendance',
        title: segment
          ? `Vacation-leave quota — ${segment}`
          : 'Vacation-leave quota usage by student this term',
      };
    default:
      return { eyebrow: 'Drill', title: 'Attendance' };
  }
}
