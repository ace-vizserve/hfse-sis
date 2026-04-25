import { unstable_cache } from 'next/cache';

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
  | 'attendance-summary'    // attendance %
  | 'lates'                  // late entries
  | 'excused'                // excused entries
  | 'absent'                 // absent entries
  | 'daily-attendance-day'   // entries on a specific day
  | 'ex-reason'              // entries with that EX reason
  | 'day-type'               // calendar days of that type
  | 'top-absent'             // student × absences in range
  | 'attendance-by-section'  // section × attendance %
  | 'compassionate-quota';   // student × quota usage

export type AttendanceDrillRowKind = 'entry' | 'top-absent' | 'section-rollup' | 'compassionate' | 'calendar-day';

export function rowKindForTarget(t: AttendanceDrillTarget): AttendanceDrillRowKind {
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
      return 'top-absent';
    case 'attendance-by-section':
      return 'section-rollup';
    case 'compassionate-quota':
      return 'compassionate';
    default: {
      const _exhaustive: never = t;
      throw new Error(`unreachable target: ${String(_exhaustive)}`);
    }
  }
}

export type DrillScope = 'range' | 'ay' | 'all';

// ─── Row shapes ─────────────────────────────────────────────────────────────

export type AttendanceEntryRow = {
  entryId: string;
  attendanceDate: string;
  sectionId: string;
  sectionName: string;
  studentSectionId: string;
  studentName: string;
  studentNumber: string;
  level: string | null;
  status: 'P' | 'L' | 'EX' | 'A' | 'NC';
  exReason: string | null; // 'mc' | 'compassionate' | 'school_activity' | null
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

export type CalendarDayRow = {
  date: string;
  termId: string;
  termNumber: number;
  dayType: 'school_day' | 'public_holiday' | 'school_holiday' | 'hbl' | 'no_class';
  label: string | null;
};

export type AttendanceDrillRow =
  | AttendanceEntryRow
  | TopAbsentDrillRow
  | SectionAttendanceRow
  | CompassionateUsageRow
  | CalendarDayRow;

// ─── Range input ────────────────────────────────────────────────────────────

export type DrillRangeInput = {
  ayCode: string;
  scope: DrillScope;
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
  for (const l of (levelsRes.data ?? []) as LevelLite[]) levels.set(l.id, l.code);

  let sectionStudents: StudentSectionLite[] = [];
  let studentMap = new Map<string, StudentLite>();
  if (sectionIds.length > 0) {
    const { data: ssRows } = await service
      .from('section_students')
      .select('id, section_id, student_id, enrollment_status')
      .in('section_id', sectionIds);
    sectionStudents = (ssRows ?? []) as StudentSectionLite[];
    const studentIds = Array.from(new Set(sectionStudents.map((s) => s.student_id)));
    if (studentIds.length > 0) {
      // chunk to avoid URL length limits
      const chunks: string[][] = [];
      for (let i = 0; i < studentIds.length; i += 500) {
        chunks.push(studentIds.slice(i, i + 500));
      }
      for (const chunk of chunks) {
        const { data: studs } = await service
          .from('students')
          .select('id, first_name, middle_name, last_name, student_number, urgent_compassionate_allowance')
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

async function loadEntryRowsUncached(ayCode: string): Promise<AttendanceEntryRow[]> {
  const service = createServiceClient();
  const ctx = await resolveAyContext(ayCode);
  if (!ctx.ayId) return [];

  const ssById = new Map<string, StudentSectionLite>();
  for (const ss of ctx.sectionStudents) ssById.set(ss.id, ss);
  const sectionById = new Map<string, SectionLite>();
  for (const s of ctx.sections) sectionById.set(s.id, s);

  const ssIds = ctx.sectionStudents.map((ss) => ss.id);
  if (ssIds.length === 0) return [];

  // Chunk attendance_daily fetch to avoid URL length limits.
  const chunks: string[][] = [];
  for (let i = 0; i < ssIds.length; i += 500) chunks.push(ssIds.slice(i, i + 500));
  type EntryLite = {
    id: string;
    attendance_date: string;
    section_student_id: string;
    status: string;
    ex_reason: string | null;
    notes: string | null;
  };
  const all: EntryLite[] = [];
  for (const chunk of chunks) {
    const { data } = await service
      .from('attendance_daily')
      .select('id, attendance_date, section_student_id, status, ex_reason, notes')
      .in('section_student_id', chunk);
    if (data) all.push(...(data as EntryLite[]));
  }

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
      attendanceDate: e.attendance_date,
      sectionId: section.id,
      sectionName: section.name,
      studentSectionId: ss.id,
      studentName: studentName(student),
      studentNumber: student.student_number,
      level: ctx.levels.get(section.level_id) ?? null,
      status: e.status as AttendanceEntryRow['status'],
      exReason: e.ex_reason,
      notes: e.notes,
    });
  }
  return out;
}

function loadEntryRows(ayCode: string): Promise<AttendanceEntryRow[]> {
  return unstable_cache(
    () => loadEntryRowsUncached(ayCode),
    ['attendance-drill', 'entries', ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tags(ayCode) },
  )();
}

async function loadCalendarRowsUncached(ayCode: string): Promise<CalendarDayRow[]> {
  const service = createServiceClient();
  const ctx = await resolveAyContext(ayCode);
  if (!ctx.ayId || ctx.terms.length === 0) return [];
  const termById = new Map<string, TermLite>();
  for (const t of ctx.terms) termById.set(t.id, t);
  const termIds = ctx.terms.map((t) => t.id);

  const { data } = await service
    .from('school_calendar')
    .select('term_id, calendar_date, day_type, label')
    .in('term_id', termIds);
  type CalLite = {
    term_id: string;
    calendar_date: string;
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
        date: r.calendar_date,
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
    { revalidate: CACHE_TTL_SECONDS, tags: tags(ayCode) },
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
        a.encoded > 0 ? Math.round(((a.present + a.late + a.excused) / a.encoded) * 100) : 0,
    });
  }
  rows.sort((a, b) => b.absences - a.absences || b.lates - a.lates);
  return rows;
}

function rollupBySection(entries: AttendanceEntryRow[]): SectionAttendanceRow[] {
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
        a.encoded > 0 ? Math.round(((a.present + a.late + a.excused) / a.encoded) * 100) : 0,
    });
  }
  rows.sort((a, b) => a.attendancePct - b.attendancePct);
  return rows;
}

async function rollupCompassionate(ayCode: string): Promise<CompassionateUsageRow[]> {
  const ctx = await resolveAyContext(ayCode);
  if (!ctx.ayId || ctx.sectionStudents.length === 0) return [];
  const entries = await loadEntryRows(ayCode);
  const usage = new Map<string, number>();
  for (const e of entries) {
    if (e.status === 'EX' && e.exReason === 'compassionate') {
      usage.set(e.studentSectionId, (usage.get(e.studentSectionId) ?? 0) + 1);
    }
  }
  const sectionById = new Map<string, SectionLite>();
  for (const s of ctx.sections) sectionById.set(s.id, s);
  const rows: CompassionateUsageRow[] = [];
  for (const ss of ctx.sectionStudents) {
    if (ss.enrollment_status === 'withdrawn') continue;
    const student = ctx.students.get(ss.student_id);
    if (!student) continue;
    const section = sectionById.get(ss.section_id);
    if (!section) continue;
    const used = usage.get(ss.id) ?? 0;
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

// ─── Public builders ────────────────────────────────────────────────────────

export type BuildDrillRowsInput = DrillRangeInput & {
  target: AttendanceDrillTarget;
  segment?: string | null;
};

function applyScopeFilter<T extends { attendanceDate?: string; date?: string }>(
  rows: T[],
  input: DrillRangeInput,
): T[] {
  if (input.scope !== 'range' || !input.from || !input.to) return rows;
  return rows.filter((r) => {
    const d = (r.attendanceDate ?? r.date ?? '').slice(0, 10);
    if (!d) return true;
    return d >= input.from! && d <= input.to!;
  });
}

export async function buildAttendanceDrillRows(
  input: BuildDrillRowsInput,
): Promise<AttendanceDrillRow[]> {
  const kind = rowKindForTarget(input.target);

  if (kind === 'entry') {
    let rows = await loadEntryRows(input.ayCode);
    rows = applyScopeFilter(rows, input);
    return applyTargetFilter(rows, input.target, input.segment ?? null) as AttendanceDrillRow[];
  }
  if (kind === 'calendar-day') {
    let rows = await loadCalendarRows(input.ayCode);
    rows = applyScopeFilter(rows, input);
    return applyTargetFilter(rows, input.target, input.segment ?? null) as AttendanceDrillRow[];
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
  // compassionate
  return (await rollupCompassionate(input.ayCode)) as AttendanceDrillRow[];
}

export async function buildAllRowSets(input: {
  ayCode: string;
  scope: DrillScope;
  from?: string;
  to?: string;
}): Promise<{
  topAbsent: TopAbsentDrillRow[];
  sectionAttendance: SectionAttendanceRow[];
  calendar: CalendarDayRow[];
  compassionate: CompassionateUsageRow[];
}> {
  // We still need entries internally to build the rolled-up shapes, but we
  // do NOT return them — at 1000 students × 180 school days that's 180k
  // rows we'd ship through the RSC payload for nothing. Drill sheets that
  // need raw entries lazy-fetch via /api/attendance/drill/{target}.
  const [entriesAll, calendarAll, compassionate] = await Promise.all([
    loadEntryRows(input.ayCode),
    loadCalendarRows(input.ayCode),
    rollupCompassionate(input.ayCode),
  ]);
  const entries = applyScopeFilter(entriesAll, input);
  const calendar = applyScopeFilter(calendarAll, input);
  return {
    topAbsent: rollupTopAbsent(entries),
    sectionAttendance: rollupBySection(entries),
    calendar,
    compassionate,
  };
}

// ─── Target filter ──────────────────────────────────────────────────────────

export function applyTargetFilter(
  rows: AttendanceDrillRow[],
  target: AttendanceDrillTarget,
  segment: string | null,
): AttendanceDrillRow[] {
  switch (target) {
    case 'attendance-summary':
      return (rows as AttendanceEntryRow[]).filter((r) => r.status !== 'NC') as AttendanceDrillRow[];
    case 'lates':
      return (rows as AttendanceEntryRow[]).filter((r) => r.status === 'L') as AttendanceDrillRow[];
    case 'excused':
      return (rows as AttendanceEntryRow[]).filter((r) => r.status === 'EX') as AttendanceDrillRow[];
    case 'absent':
      return (rows as AttendanceEntryRow[]).filter((r) => r.status === 'A') as AttendanceDrillRow[];
    case 'daily-attendance-day':
      if (!segment) return rows;
      return (rows as AttendanceEntryRow[]).filter((r) => r.attendanceDate.slice(0, 10) === segment) as AttendanceDrillRow[];
    case 'ex-reason':
      if (!segment) return (rows as AttendanceEntryRow[]).filter((r) => r.status === 'EX') as AttendanceDrillRow[];
      return (rows as AttendanceEntryRow[]).filter((r) => r.exReason === segment.toLowerCase()) as AttendanceDrillRow[];
    case 'day-type':
      if (!segment) return rows;
      return (rows as CalendarDayRow[]).filter((r) => r.dayType === segment) as AttendanceDrillRow[];
    case 'top-absent':
    case 'attendance-by-section':
    case 'compassionate-quota':
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
  | 'isOverQuota';

export const DRILL_COLUMN_LABELS: Record<DrillColumnKey, string> = {
  studentName: 'Student',
  studentNumber: 'Student #',
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
};

const ENTRY_COLUMNS: DrillColumnKey[] = ['attendanceDate', 'studentName', 'sectionName', 'level', 'status', 'exReason'];
const TOP_ABSENT_COLUMNS: DrillColumnKey[] = ['studentName', 'sectionName', 'level', 'absences', 'lates', 'excused', 'attendancePct'];
const SECTION_COLUMNS: DrillColumnKey[] = ['sectionName', 'level', 'attendancePct', 'absences', 'lates', 'encodedDays'];
const COMPASSIONATE_COLUMNS: DrillColumnKey[] = ['studentName', 'sectionName', 'level', 'allowance', 'used', 'remaining', 'isOverQuota'];
const CALENDAR_COLUMNS: DrillColumnKey[] = ['date', 'dayType', 'label'];

export function allColumnsForKind(kind: AttendanceDrillRowKind): DrillColumnKey[] {
  switch (kind) {
    case 'entry': return ENTRY_COLUMNS;
    case 'top-absent': return TOP_ABSENT_COLUMNS;
    case 'section-rollup': return SECTION_COLUMNS;
    case 'compassionate': return COMPASSIONATE_COLUMNS;
    case 'calendar-day': return CALENDAR_COLUMNS;
  }
}

export function defaultColumnsForTarget(target: AttendanceDrillTarget): DrillColumnKey[] {
  return allColumnsForKind(rowKindForTarget(target));
}

export function drillHeaderForTarget(
  target: AttendanceDrillTarget,
  segment: string | null,
): { eyebrow: string; title: string } {
  switch (target) {
    case 'attendance-summary': return { eyebrow: 'Drill · Attendance', title: 'Encoded entries in scope' };
    case 'lates': return { eyebrow: 'Drill · Late', title: 'Late entries' };
    case 'excused': return { eyebrow: 'Drill · Excused', title: 'Excused entries' };
    case 'absent': return { eyebrow: 'Drill · Absent', title: 'Absent entries' };
    case 'daily-attendance-day': return { eyebrow: 'Drill · Daily', title: segment ? `Entries on ${segment}` : 'Daily entries' };
    case 'ex-reason': return { eyebrow: 'Drill · EX reason', title: segment ? `EX reason: ${segment}` : 'Excused breakdown' };
    case 'day-type': return { eyebrow: 'Drill · Calendar', title: segment ? `Day type: ${segment}` : 'Calendar make-up' };
    case 'top-absent': return { eyebrow: 'Drill · Needs attention', title: 'Top-absent students' };
    case 'attendance-by-section': return { eyebrow: 'Drill · By section', title: 'Attendance by section' };
    case 'compassionate-quota': return { eyebrow: 'Drill · Compassionate', title: 'Compassionate quota usage' };
    default: return { eyebrow: 'Drill', title: 'Attendance' };
  }
}
