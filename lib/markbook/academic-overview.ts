import 'server-only';

import { unstable_cache } from 'next/cache';

import { sgToday } from '@/lib/dates';
import {
  computeAcademicOverview,
  NO_FILTERS,
  type AcademicOverview,
  type AcademicOverviewFilters,
  type OverviewAttendanceInput,
  type OverviewGradeInput,
  type OverviewLevelInput,
  type OverviewSubjectInput,
  type OverviewTermInput,
} from '@/lib/markbook/academic-overview-compute';
import { fetchAllPages, fetchInChunks } from '@/lib/supabase/paginate';
import { createServiceClient } from '@/lib/supabase/service';

// School-wide Academic Overview loader.
//
// ONE sweep per academic year, not one masterfile per grade level: HFSE runs 10
// levels, and `loadMasterfile` builds a full per-student × subject × term grid
// each time. This needs far less — one row per grade cell — so it reads the
// sheets and their entries directly and hands them to the pure aggregator.
//
// Scale check against production (AY2026): 21 sections, 260 grading sheets,
// 4,640 grade entries. AY2025 is the heavier year at 620 sheets / 11,814
// entries, still one bounded sweep.
//
// ⚠ Both pagination helpers are load-bearing here and for different reasons:
// `fetchInChunks` because a 260-UUID `.in()` filter is already past half the
// gateway's URL budget, and `fetchAllPages` because PostgREST silently caps a
// response at 1000 rows. Dropping either produces a smaller, wrong answer with
// no error — see the comments in lib/supabase/paginate.ts.

const CACHE_TTL_SECONDS = 60;

function tag(academicYearId: string): string[] {
  return ['markbook', `markbook:${academicYearId}`];
}

type SectionRow = { id: string; name: string; level_id: string | null };
type StudentJoin = {
  id: string;
  student_number: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
};
type SectionStudentRow = {
  id: string;
  section_id: string;
  student_id: string | null;
  enrollment_status: string | null;
  student: StudentJoin | StudentJoin[] | null;
};
type SheetRow = {
  id: string;
  term_id: string;
  subject_id: string;
  section_id: string;
  is_locked: boolean | null;
};
type EntryRow = {
  grading_sheet_id: string;
  section_student_id: string;
  quarterly_grade: number | null;
  is_na: boolean | null;
};

async function loadAcademicOverviewUncached(
  ayCode: string,
  academicYearId: string,
  today: string,
  filters: AcademicOverviewFilters
): Promise<AcademicOverview> {
  const service = createServiceClient();

  const [{ data: termRows }, { data: levelRows }, { data: subjectRows }] =
    await Promise.all([
      service
        .from('terms')
        .select('id, term_number, label, start_date, end_date, is_current')
        .eq('academic_year_id', academicYearId)
        .order('term_number', { ascending: true }),
      service.from('levels').select('id, code, label, sort_order'),
      service.from('subjects').select('id, name, is_examinable'),
    ]);

  const terms: OverviewTermInput[] = (
    (termRows ?? []) as {
      id: string;
      term_number: number;
      label: string | null;
      start_date: string | null;
      end_date: string | null;
      is_current: boolean | null;
    }[]
  ).map((t) => ({
    id: t.id,
    termNumber: t.term_number,
    label: t.label?.trim() || `Term ${t.term_number}`,
    startDate: t.start_date,
    endDate: t.end_date,
    isCurrent: t.is_current,
  }));

  const allLevels = (
    (levelRows ?? []) as {
      id: string;
      code: string;
      label: string;
      sort_order: number | null;
    }[]
  ).map((l) => ({
    id: l.id,
    code: l.code,
    label: l.label,
    sortOrder: l.sort_order ?? 0,
  }));
  const levelById = new Map(allLevels.map((l) => [l.id, l]));

  const subjects: OverviewSubjectInput[] = (
    (subjectRows ?? []) as {
      id: string;
      name: string;
      is_examinable: boolean | null;
    }[]
  ).map((s) => ({
    id: s.id,
    name: s.name,
    isExaminable: s.is_examinable === true,
  }));

  // Every paginated read below is ordered for the same reason — see the note
  // on the grade_entries fetch further down.
  const sections = await fetchAllPages<SectionRow>((from, to) =>
    service
      .from('sections')
      .select('id, name, level_id')
      .eq('academic_year_id', academicYearId)
      .order('id', { ascending: true })
      .range(from, to)
  );

  // Only levels that actually run a class this year — an unused level in the
  // catalogue is not a gap in the data.
  const levels: OverviewLevelInput[] = allLevels
    .filter((l) => sections.some((s) => s.level_id === l.id))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (sections.length === 0) {
    return computeAcademicOverview({
      ayCode,
      today,
      filters,
      attendance: [],
      terms,
      levels,
      subjects,
      sections: [],
      students: [],
      grades: [],
      enrolledStudentIds: [],
      sectionCount: 0,
      subjectsTaught: 0,
      subjectsConfigured: subjects.length,
      sheets: { total: 0, locked: 0 },
    });
  }

  const sectionIds = sections.map((s) => s.id);
  const levelBySectionId = new Map(
    sections.map((s) => [s.id, s.level_id ?? ''])
  );

  const [sectionStudents, sheets] = await Promise.all([
    fetchInChunks<SectionStudentRow>(sectionIds, (slice) =>
      fetchAllPages<SectionStudentRow>((from, to) =>
        service
          .from('section_students')
          .select(
            'id, section_id, student_id, enrollment_status, student:students(id, student_number, first_name, middle_name, last_name)'
          )
          .in('section_id', slice)
          .order('id', { ascending: true })
          .range(from, to)
      )
    ),
    fetchInChunks<SheetRow>(sectionIds, (slice) =>
      fetchAllPages<SheetRow>((from, to) =>
        service
          .from('grading_sheets')
          .select('id, term_id, subject_id, section_id, is_locked')
          .in('section_id', slice)
          .order('id', { ascending: true })
          .range(from, to)
      )
    ),
  ]);

  // section_students.id -> students.id. Keying grades on the ENROLMENT would
  // double-count a mid-year transfer, and the grade-level bars would stop
  // summing to the school total.
  const studentIdByEnrolment = new Map(
    sectionStudents
      .filter((r) => !!r.student_id)
      .map((r) => [r.id, r.student_id as string])
  );
  const enrolledStudentIds = sectionStudents
    .filter((r) => r.enrollment_status !== 'withdrawn' && !!r.student_id)
    .map((r) => r.student_id as string);

  // Name format mirrors the masterfile: "LAST, First Middle".
  const studentsById = new Map<
    string,
    { id: string; studentNumber: string; fullName: string }
  >();
  for (const row of sectionStudents) {
    const joined = Array.isArray(row.student) ? row.student[0] : row.student;
    if (!joined?.id || studentsById.has(joined.id)) continue;
    studentsById.set(joined.id, {
      id: joined.id,
      studentNumber: joined.student_number ?? '',
      fullName:
        [joined.last_name, joined.first_name, joined.middle_name]
          .filter(Boolean)
          .join(', ')
          .trim() ||
        (joined.student_number ?? 'Unnamed student'),
    });
  }

  const sheetById = new Map(sheets.map((s) => [s.id, s]));

  // ⚠ `.order('id')` is REQUIRED, not tidiness. `fetchAllPages` walks the
  // result with `.range()`, and PostgREST gives no stable row order for an
  // unordered query — so once a chunk exceeds the 1000-row page size, pages
  // can repeat rows and skip others. Measured on production 2026-08-17: the
  // same 4,640 AY2026 entries yielded 3,534 distinct (sheet, student) keys
  // unordered versus 4,640 ordered. It fails silently, as a plausible smaller
  // number — which is exactly how it went unnoticed.
  const entries =
    sheets.length === 0
      ? []
      : await fetchInChunks<EntryRow>(
          sheets.map((s) => s.id),
          (slice) =>
            fetchAllPages<EntryRow>((from, to) =>
              service
                .from('grade_entries')
                .select(
                  'grading_sheet_id, section_student_id, quarterly_grade, is_na'
                )
                .in('grading_sheet_id', slice)
                .order('id', { ascending: true })
                .range(from, to)
            )
        );

  // Attendance is keyed on the ENROLMENT, so it resolves through the same map
  // as grades — and is ordered for the same pagination reason.
  type AttendanceRow = {
    section_student_id: string;
    term_id: string;
    school_days: number | null;
    days_present: number | null;
    days_late: number | null;
    days_excused: number | null;
  };
  const enrolmentIds = sectionStudents.map((r) => r.id);
  const attendanceRows =
    enrolmentIds.length === 0
      ? []
      : await fetchInChunks<AttendanceRow>(enrolmentIds, (slice) =>
          fetchAllPages<AttendanceRow>((from, to) =>
            service
              .from('attendance_records')
              .select(
                'section_student_id, term_id, school_days, days_present, days_late, days_excused'
              )
              .in('section_student_id', slice)
              .order('section_student_id', { ascending: true })
              .range(from, to)
          )
        );

  const sectionIdByEnrolment = new Map(
    sectionStudents.map((r) => [r.id, r.section_id])
  );
  const attendance: OverviewAttendanceInput[] = [];
  for (const row of attendanceRows) {
    const studentId = studentIdByEnrolment.get(row.section_student_id);
    const sectionId = sectionIdByEnrolment.get(row.section_student_id);
    if (!studentId || !sectionId) continue;
    const levelId = levelBySectionId.get(sectionId) ?? '';
    if (!levelById.has(levelId)) continue;
    attendance.push({
      studentId,
      levelId,
      sectionId,
      termId: row.term_id,
      schoolDays: row.school_days,
      present: row.days_present,
      late: row.days_late,
      excused: row.days_excused,
    });
  }

  const grades: OverviewGradeInput[] = [];
  for (const e of entries) {
    const sheet = sheetById.get(e.grading_sheet_id);
    if (!sheet) continue;
    const studentId = studentIdByEnrolment.get(e.section_student_id);
    if (!studentId) continue;
    const levelId = levelBySectionId.get(sheet.section_id) ?? '';
    if (!levelById.has(levelId)) continue;
    grades.push({
      termId: sheet.term_id,
      subjectId: sheet.subject_id,
      levelId,
      studentId,
      // The SHEET's section, not the enrolment's: a transferred student's Term 1
      // marks belong to the class that taught them.
      sectionId: sheet.section_id,
      quarterly: e.quarterly_grade,
      isNa: e.is_na === true,
    });
  }

  return computeAcademicOverview({
    ayCode,
    today,
    filters,
    attendance,
    terms,
    levels,
    subjects,
    sections: sections
      .filter((s) => !!s.level_id)
      .map((s) => ({ id: s.id, name: s.name, levelId: s.level_id as string })),
    students: [...studentsById.values()],
    grades,
    enrolledStudentIds,
    sectionCount: sections.length,
    subjectsTaught: new Set(sheets.map((s) => s.subject_id)).size,
    subjectsConfigured: subjects.length,
    sheets: {
      total: sheets.length,
      locked: sheets.filter((s) => s.is_locked === true).length,
    },
  });
}

/**
 * School-wide academic overview for one academic year.
 *
 * `today` is resolved here rather than inside the cached function so the cache
 * key rolls over at the Singapore date boundary (KD #32) — otherwise a term
 * that finished overnight would keep reporting as in progress for up to a
 * minute, and, worse, the key would be identical across the change.
 */
export function getAcademicOverview(
  ayCode: string,
  academicYearId: string,
  filters: AcademicOverviewFilters = NO_FILTERS
): Promise<AcademicOverview> {
  const today = sgToday();
  // Filters are part of the cache key — they change the numbers, so a shared
  // entry would serve one scope's figures under another's heading.
  const key = [
    filters.levelId ?? '-',
    filters.sectionId ?? '-',
    filters.subjectId ?? '-',
    filters.termNumber == null ? '-' : String(filters.termNumber),
  ].join('|');
  return unstable_cache(
    () => loadAcademicOverviewUncached(ayCode, academicYearId, today, filters),
    ['markbook', 'academic-overview', ayCode, academicYearId, today, key],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(academicYearId) }
  )();
}
