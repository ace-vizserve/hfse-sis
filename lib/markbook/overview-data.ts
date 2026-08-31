import 'server-only';

import { unstable_cache } from 'next/cache';

import { type AwardThresholds } from '@/lib/compute/awards';
import {
  type OverviewAttendanceInput,
  type OverviewGradeInput,
  type OverviewLevelInput,
  type OverviewSectionInput,
  type OverviewStudentInput,
  type OverviewSubjectInput,
  type OverviewTermInput,
} from '@/lib/markbook/academic-overview-compute';
import { getSchoolConfig } from '@/lib/sis/school-config';
import { subjectDisplayNamesForAy } from '@/lib/sis/subjects/display-names-for-ay';
import { fetchAllPages, fetchInChunks } from '@/lib/supabase/paginate';
import { createServiceClient } from '@/lib/supabase/service';

// ONE sweep per academic year, shared by every school-wide Markbook surface.
//
// Extracted from academic-overview.ts when the Awards page went school-wide:
// both pages need the same rows — every grade cell joined to its term, subject,
// level, class and student, plus the attendance rollups and the roster — and
// running that sweep twice per page load would be two identical round trips.
//
// It also fixes a smaller thing. The sweep used to sit INSIDE the filtered,
// per-scope cache entry, so changing a filter re-ran the database read. The
// cache key here carries no filters, because filters change only the maths;
// narrowing to one class now recomputes in memory off a warm entry.
//
// ⚠ Both pagination helpers are load-bearing, for different reasons:
// `fetchInChunks` because a 260-UUID `.in()` filter is already past half the
// gateway's URL budget, and `fetchAllPages` because PostgREST silently caps a
// response at 1000 rows. Dropping either produces a smaller, wrong answer with
// no error — see the comments in lib/supabase/paginate.ts. Every paginated read
// below is also `.order()`ed: without one PostgREST gives no stable row order,
// so past 1000 rows pages repeat and skip.
//
// Scale check against production (AY2026): 21 sections, 260 grading sheets,
// 4,640 grade entries, 1,192 attendance rollups. AY2025 is the heavier year at
// 620 sheets / 11,814 entries, still one bounded sweep.

const CACHE_TTL_SECONDS = 60;

/** Everything a school-wide Markbook view needs, before any filtering. */
export type OverviewData = {
  ayCode: string;
  terms: OverviewTermInput[];
  levels: OverviewLevelInput[];
  subjects: OverviewSubjectInput[];
  sections: OverviewSectionInput[];
  students: OverviewStudentInput[];
  grades: OverviewGradeInput[];
  attendance: OverviewAttendanceInput[];
  enrolledStudentIds: string[];
  sectionCount: number;
  subjectsTaught: number;
  subjectsConfigured: number;
  sheets: { total: number; locked: number };
  /** Award cut-offs in effect, from School config — HFSE tunes these. */
  thresholds: AwardThresholds;
};

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

/**
 * The sweep itself, with no cache around it.
 *
 * Exported for verification scripts, which run outside a request and so have no
 * incremental cache for `unstable_cache` to sit on. Application code must call
 * `getOverviewData` — a script that reimplemented this read would agree with
 * itself and prove nothing.
 */
export async function loadOverviewDataUncached(
  ayCode: string,
  academicYearId: string
): Promise<OverviewData> {
  const service = createServiceClient();

  // School config carries the award cut-offs. Read alongside the rest rather
  // than by the awards view, so both pages read one set of thresholds from one
  // cache entry and cannot disagree about where Gold starts.
  const schoolConfig = await getSchoolConfig();
  const thresholds: AwardThresholds = {
    bronzeMin: schoolConfig.subjectAwardBronzeMin,
    silverMin: schoolConfig.subjectAwardSilverMin,
    goldMin: schoolConfig.subjectAwardGoldMin,
    max: schoolConfig.subjectAwardMax,
  };

  const [{ data: termRows }, { data: levelRows }, { data: subjectRows }] =
    await Promise.all([
      service
        .from('terms')
        .select('id, term_number, label, start_date, end_date, is_current')
        .eq('academic_year_id', academicYearId)
        .order('term_number', { ascending: true }),
      service.from('levels').select('id, code, label, sort_order'),
      // report_label comes along so the per-year overlay below can fall
      // through the full rule (this year's name -> report label -> catalogue
      // name) rather than only its first and last steps.
      service.from('subjects').select('id, name, report_label, is_examinable'),
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

  const subjectCatalog = (subjectRows ?? []) as {
    id: string;
    name: string;
    report_label: string | null;
    is_examinable: boolean | null;
  }[];
  // `subjects` here is the panel's own label set, read by a person, so it
  // carries the name this academic year uses (migration 137).
  const subjectNames = await subjectDisplayNamesForAy(
    service,
    academicYearId,
    subjectCatalog
  );
  const subjects: OverviewSubjectInput[] = subjectCatalog.map((s) => ({
    id: s.id,
    name: subjectNames.get(s.id) ?? s.name,
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
    return {
      ayCode,
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
      thresholds,
    };
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

  return {
    ayCode,
    terms,
    levels,
    subjects,
    sections: sections
      .filter((s) => !!s.level_id)
      .map((s) => ({ id: s.id, name: s.name, levelId: s.level_id as string })),
    students: [...studentsById.values()],
    grades,
    attendance,
    enrolledStudentIds,
    sectionCount: sections.length,
    subjectsTaught: new Set(sheets.map((s) => s.subject_id)).size,
    subjectsConfigured: subjects.length,
    sheets: {
      total: sheets.length,
      locked: sheets.filter((s) => s.is_locked === true).length,
    },
    thresholds,
  };
}

/**
 * The shared sweep, cached per academic year.
 *
 * No `today` in the key and no filters: nothing read here depends on either.
 * Callers that need the date — term status, for instance — resolve it
 * themselves and pass it to their own pure compute step (KD #32).
 */
export function getOverviewData(
  ayCode: string,
  academicYearId: string
): Promise<OverviewData> {
  return unstable_cache(
    () => loadOverviewDataUncached(ayCode, academicYearId),
    ['markbook', 'overview-data', ayCode, academicYearId],
    {
      revalidate: CACHE_TTL_SECONDS,
      // ⚠ KEYED ON THE AY CODE, NOT THE UUID, AND THAT IS THE WHOLE POINT.
      // This tag read `markbook:${academicYearId}` until 2026-08-27 — the only
      // AY-scoped tag in the codebase built from a uuid. Every invalidator
      // passes an ay_code (`invalidateDrillTags(module, ayCode)` in
      // `lib/cache/invalidate-drill-tags.ts`), so `markbook:AY2026` never
      // matched `markbook:<uuid>` and THIS ENTRY WAS NEVER BUSTED BY ANYTHING.
      // It only ever expired on its own TTL, which is why the Markbook
      // overview could sit on figures a grade change had already superseded.
      //
      // The bare `'markbook'` tag saved it from being unreachable, not from
      // being wrong: nothing busts that either, since the helper only emits
      // the AY-scoped pair.
      tags: ['markbook', `markbook:${ayCode}`],
    }
  )();
}
