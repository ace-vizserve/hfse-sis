import 'server-only';

import { unstable_cache } from 'next/cache';

import {
  computeAnnualGrade,
  computeGeneralAverage,
} from '@/lib/compute/annual';
import { deriveAnnualLetterForNonExam } from '@/lib/compute/letter-grade';
import {
  DEFAULT_AWARD_THRESHOLDS,
  overallAcademicAward,
  subjectAward,
  type AwardEligibility,
  type AwardThresholds,
  type OverallAwardLabel,
  type SubjectAwardLabel,
} from '@/lib/compute/awards';
import { getStaffDisplayNameById } from '@/lib/auth/staff-list';
import { getSchoolConfig } from '@/lib/sis/school-config';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { createServiceClient } from '@/lib/supabase/service';
import {
  isEnrolledForTerm,
  type EnrolmentInterval,
} from '@/lib/report-card/enrolment-coverage';

// HFSE Masterfile — registrar-facing cross-subject grid (KD #95).
//
// Mirrors the AY2025 Final Report Book Masterfile sheet: rows = students at
// one level (optionally filtered to one or more sections), columns = subjects
// (examinable first with T1-T4 + Overall + Subject Award badge; non-examinable
// after with T1-T4 letter cells only). Plus per-term attendance and an
// Overall Academic Award badge per student.
//
// Cached per (level × ay × class-filter × term-set) for 60s. Grades change via
// the existing /api/grading-sheets/* + /api/change-requests/* routes — both
// invalidate the markbook drill cache tag, which clears this loader too.

const CACHE_TTL_SECONDS = 60;

export type MasterfileSubject = {
  id: string;
  code: string;
  name: string;
  isExaminable: boolean;
};

export type MasterfileTerm = {
  id: string;
  termNumber: number;
  label: string;
};

export type MasterfileCell = {
  // Examinable cells: integer quarterly grade or null.
  quarterly: number | null;
  // Non-examinable cells: letter grade or null.
  letter: string | null;
  // True when a real grade_entries.is_na row exists, OR (when no grade entry
  // exists at all for this cell) the student's enrolment coverage doesn't
  // overlap this term — a late enrollee's pre-join term or a withdrawn
  // student's post-leave term. Render as "N.A." KD #148's coverage rule,
  // reused from lib/report-card/enrolment-coverage.ts.
  isNa: boolean;
};

export type MasterfileSubjectRow = {
  subjectId: string;
  // T1-T4 cells.
  cells: MasterfileCell[];
  // Subject Overall (2dp). null when subject is non-examinable, or when any
  // quarterly term is null (incomplete).
  overall: number | null;
  // Subject Award badge. null when non-examinable or withdrawn.
  award: SubjectAwardLabel;
  // For non-examinable subjects only: registrar-entered year-end override.
  // null means "use the auto-derived letter". Always null for examinable.
  annualLetter: string | null;
  // Auto-derived final letter from the weighted term average (T1×0.20+T2×0.20+T3×0.20+T4×0.40),
  // N/A terms excluded and re-weighted. null for examinable or when no term data exists.
  derivedAnnualLetter: string | null;
  // grade_entries.id for the T4 row — needed by the masterfile inline editor.
  annualLetterEntryId: string | null;
  // grading_sheets.id for the T4 sheet.
  annualLetterSheetId: string | null;
};

/**
 * ⚠ `present` CONTAINS both `late` and `excused` — migration 014 counts P, L
 * and EX into `days_present` alike. Treating the three as separate quantities
 * double-counts; the only partition of `schoolDays` is
 * (present − late − excused) + late + excused + absent.
 */
export type MasterfileAttendanceTermCell = {
  termId: string;
  schoolDays: number | null;
  present: number | null;
  late: number | null;
  /** Authorised absence — MC, compassionate, school activity. Inside `present`. */
  excused: number | null;
};

export type MasterfileStudentRow = {
  studentId: string;
  studentNumber: string;
  fullName: string;
  sectionId: string;
  sectionName: string;
  formClassAdviser: string | null;
  // 'active' | 'late_enrollee' | 'withdrawn'
  enrollmentStatus: string;
  // Per-section roll number (section_students.index_number) from the primary enrolment.
  indexNumber: number | null;
  // Per-subject row (in the same order as `subjects` on the payload).
  subjectRows: MasterfileSubjectRow[];
  // Cross-subject mean of examinable Subject Overalls — 1dp per canonical spec.
  generalAverage: number | null;
  // Overall Academic Award badge.
  overallAward: OverallAwardLabel;
  // Attendance per term + AY total.
  attendanceByTerm: MasterfileAttendanceTermCell[];
  attendanceTotal: {
    present: number;
    late: number;
    excused: number;
    schoolDays: number;
  };
  // Form Class Adviser write-up comments, T1–T3 only (KD #49 — T4 has no FCA
  // comment). Only terms with non-empty content appear. Sourced from
  // `evaluation_writeups`, resolved per the student's `student_id` (not the
  // denormalized `evaluation_writeups.section_id`) so a mid-year transfer
  // doesn't drop the comment (KD #120). `submitted` reflects the adviser's
  // explicit finalise action — consumers use it to distinguish Submitted /
  // Draft / Missing (KD #129).
  commentsByTerm: { termNumber: number; text: string; submitted: boolean }[];
  // Resolved joining term for late enrollees (explicit override → date-derived →
  // null). null for active/withdrawn students or when unresolvable. KD #111/#68.
  lateEnrolleeTermNumber: number | null;
  // Term numbers this student's enrolment coverage overlaps (union of all their
  // section_students rows in the AY, KD #67 transfer-safe). Drives the N.A.
  // distinction: a term NOT in this list means the student wasn't enrolled that
  // term (pre-join or post-withdrawal), so a blank cell there is legitimately
  // N.A., not "not yet entered." A term with unset dates is conservatively
  // treated as covered (never fabricates an N.A. from missing calendar data).
  enrolledTermNumbers: number[];
};

// One grading sheet in the selected scope, with just the fields the dashboard
// readiness aggregate needs (lock count + per (subject × term) identity so a
// Term filter can scope the count). No grade data — that's on the rows.
export type MasterfileSheetSummary = {
  id: string;
  subjectId: string;
  termId: string;
  sectionId: string;
  isLocked: boolean;
};

export type MasterfilePayload = {
  ayCode: string;
  level: { id: string; code: string; label: string };
  // Subjects ordered: examinable first (alphabetical within), then
  // non-examinable (alphabetical within). Matches the workbook layout.
  subjects: MasterfileSubject[];
  terms: MasterfileTerm[];
  // All sections at this level (so the toolbar can render a class filter).
  sections: Array<{ id: string; name: string }>;
  // Currently-selected sections (matches the URL filter; empty = all classes).
  selectedSectionIds: string[];
  // One row per active or withdrawn student in the selected sections.
  rows: MasterfileStudentRow[];
  // Grading sheets in scope — drives the "sheets locked" readiness metric.
  sheets: MasterfileSheetSummary[];
  // Award thresholds in effect (so the UI can label boundaries).
  thresholds: AwardThresholds;
};

export type MasterfileInput = {
  ayCode: string;
  levelId: string;
  // Optional — when omitted, includes every section at the level.
  sectionIds?: string[];
};

// Resolve a late enrollee's joining term: explicit override wins; else the
// term whose window contains enrollment_date; else the earliest term that
// starts after it (joined during a break -> next term); else null. KD #111/#68.
export function resolveLateEnrolleeTerm(
  override: number | null,
  enrollmentDate: string | null,
  terms: {
    termNumber: number;
    startDate: string | null;
    endDate: string | null;
  }[]
): number | null {
  if (override != null) return override;
  if (!enrollmentDate) return null;
  const d = enrollmentDate.slice(0, 10);
  const sorted = terms
    .filter((t) => t.startDate && t.endDate)
    .slice()
    .sort((a, b) => a.termNumber - b.termNumber);
  for (const t of sorted) {
    if (
      d >= (t.startDate as string).slice(0, 10) &&
      d <= (t.endDate as string).slice(0, 10)
    ) {
      return t.termNumber;
    }
  }
  for (const t of sorted) {
    if (d < (t.startDate as string).slice(0, 10)) return t.termNumber;
  }
  return null;
}

// Pure — batch-resolves each section's LIVE form-adviser display name, given
// the section's `teacher_assignments` row (role='form_adviser') and the
// staff id→name lookup. Extracted so the resolution logic is unit-testable
// without mocking the surrounding Supabase call graph.
//
// Reads teacher_assignments, never the denormalized `sections.form_class_adviser`
// mirror — that column is best-effort-written on assign and never cleared on
// unassign (app/api/teacher-assignments/*), so it can silently drift from
// who's actually assigned. Matches lib/markbook/publish-readiness.ts's
// existing rationale for the same authoritative-vs-mirror choice.
export function buildFormAdviserNameMap(
  assignments: Array<{ section_id: string; teacher_user_id: string }>,
  staffNameEntries: Array<[string, string]>
): Map<string, string> {
  const nameById = new Map(staffNameEntries);
  const out = new Map<string, string>();
  for (const a of assignments) {
    out.set(a.section_id, nameById.get(a.teacher_user_id) ?? a.teacher_user_id);
  }
  return out;
}

// Pure — resolves the term numbers a student's enrolment coverage overlaps
// (KD #148, reusing lib/report-card/enrolment-coverage.ts's interval math the
// same way build-report-card.ts does). Extracted so the loader's per-cell
// N.A. decision + the readiness/comment coverage gates are unit-testable
// without mocking the surrounding Supabase call graph — same rationale as
// resolveLateEnrolleeTerm / buildFormAdviserNameMap above.
//
// A term with unset start/end dates is conservatively treated as covered, so
// an unconfigured calendar never fabricates an N.A.
export function computeEnrolledTermNumbers(
  coverage: EnrolmentInterval[],
  terms: {
    termNumber: number;
    startDate: string | null;
    endDate: string | null;
  }[]
): number[] {
  return terms
    .filter((t) =>
      t.startDate && t.endDate
        ? isEnrolledForTerm(coverage, t.startDate, t.endDate)
        : true
    )
    .map((t) => t.termNumber);
}

export async function loadMasterfile(
  input: MasterfileInput
): Promise<MasterfilePayload | null> {
  return unstable_cache(
    () => loadMasterfileUncached(input),
    [
      'markbook-masterfile',
      input.ayCode,
      input.levelId,
      (input.sectionIds ?? []).slice().sort().join(','),
    ],
    {
      revalidate: CACHE_TTL_SECONDS,
      tags: ['markbook-drill', `markbook-drill:${input.ayCode}`],
    }
  )();
}

async function loadMasterfileUncached(
  input: MasterfileInput
): Promise<MasterfilePayload | null> {
  const service = createServiceClient();

  // 1. AY id from code.
  const { data: ay } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', input.ayCode)
    .maybeSingle();
  if (!ay) return null;
  const ayId = (ay as { id: string }).id;

  // 2. Level + sections at this level.
  const [
    { data: levelRow },
    { data: sectionsRaw },
    { data: termsRaw },
    schoolConfig,
    staffNameEntries,
  ] = await Promise.all([
    service
      .from('levels')
      .select('id, code, label')
      .eq('id', input.levelId)
      .maybeSingle(),
    service
      .from('sections')
      .select('id, name, form_class_adviser')
      .eq('academic_year_id', ayId)
      .eq('level_id', input.levelId)
      .order('name'),
    service
      .from('terms')
      .select('id, term_number, label, start_date, end_date')
      .eq('academic_year_id', ayId)
      .order('term_number'),
    getSchoolConfig(),
    getStaffDisplayNameById(),
  ]);

  if (!levelRow) return null;

  type SectionRow = {
    id: string;
    name: string;
    form_class_adviser: string | null;
  };
  const sections = (sectionsRaw ?? []) as SectionRow[];
  const sectionByIid = new Map<string, SectionRow>();
  for (const s of sections) sectionByIid.set(s.id, s);

  // Form advisers — resolved LIVE from teacher_assignments, never the
  // denormalized `sections.form_class_adviser` mirror selected above (kept
  // only because over-fetching it is harmless; see buildFormAdviserNameMap).
  const adviserAssignmentsRaw =
    sections.length === 0
      ? []
      : ((
          await service
            .from('teacher_assignments')
            .select('section_id, teacher_user_id')
            .in(
              'section_id',
              sections.map((s) => s.id)
            )
            .eq('role', 'form_adviser')
        ).data ?? []);
  const adviserNameBySection = buildFormAdviserNameMap(
    adviserAssignmentsRaw as Array<{
      section_id: string;
      teacher_user_id: string;
    }>,
    staffNameEntries
  );

  type TermRow = {
    id: string;
    term_number: number;
    label: string;
    start_date: string | null;
    end_date: string | null;
  };
  const terms = (termsRaw ?? []) as TermRow[];

  const thresholds: AwardThresholds = {
    bronzeMin: schoolConfig.subjectAwardBronzeMin,
    silverMin: schoolConfig.subjectAwardSilverMin,
    goldMin: schoolConfig.subjectAwardGoldMin,
    max: schoolConfig.subjectAwardMax,
  };

  // 3. Apply optional class filter — narrow to the requested section ids.
  const filterIds =
    input.sectionIds && input.sectionIds.length > 0
      ? input.sectionIds.filter((id) => sectionByIid.has(id))
      : sections.map((s) => s.id);
  const sectionIdSet = new Set(filterIds);

  // 4. Subjects offered at this level — drives the column set. This is a
  // level-membership question, so it resolves via subject_level_offerings
  // (migration 080 dropped subject_configs.level_id — Pattern A).
  const { data: cfgRows } = await service
    .from('subject_level_offerings')
    .select('subject:subjects(id, code, name, is_examinable)')
    .eq('academic_year_id', ayId)
    .eq('level_id', input.levelId);

  type CfgRow = {
    subject:
      | { id: string; code: string; name: string; is_examinable: boolean }
      | { id: string; code: string; name: string; is_examinable: boolean }[]
      | null;
  };
  const subjectsRaw = ((cfgRows ?? []) as CfgRow[])
    .map((c) => (Array.isArray(c.subject) ? c.subject[0] : c.subject))
    .filter(
      (
        s
      ): s is {
        id: string;
        code: string;
        name: string;
        is_examinable: boolean;
      } => !!s
    );

  // Sort: examinable first (alphabetical within), then non-examinable
  // (alphabetical within). Matches the AY2025 workbook column layout.
  const subjects: MasterfileSubject[] = subjectsRaw
    .map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      isExaminable: s.is_examinable,
    }))
    .sort((a, b) => {
      if (a.isExaminable !== b.isExaminable) return a.isExaminable ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  if (filterIds.length === 0) {
    return {
      ayCode: input.ayCode,
      level: levelRow as { id: string; code: string; label: string },
      subjects,
      terms: terms.map((t) => ({
        id: t.id,
        termNumber: t.term_number,
        label: t.label,
      })),
      sections: sections.map((s) => ({ id: s.id, name: s.name })),
      selectedSectionIds: [],
      rows: [],
      sheets: [],
      thresholds,
    };
  }

  // 5. Roster — every section_students row in the selected sections, joined
  // to students. We include withdrawn rows (workbook lists them with blank
  // cells past withdrawal).
  const { data: enrolmentsRaw } = await service
    .from('section_students')
    .select(
      'id, section_id, enrollment_status, created_at, late_enrollee_term_number, enrollment_date, withdrawal_date, index_number, student:students(id, student_number, last_name, first_name, middle_name)'
    )
    .in('section_id', filterIds)
    .order('index_number');

  type EnrolmentRow = {
    id: string;
    section_id: string;
    enrollment_status: string;
    created_at: string | null;
    late_enrollee_term_number: number | null;
    enrollment_date: string | null;
    withdrawal_date: string | null;
    index_number: number | null;
    student:
      | {
          id: string;
          student_number: string;
          last_name: string;
          first_name: string;
          middle_name: string | null;
        }
      | Array<{
          id: string;
          student_number: string;
          last_name: string;
          first_name: string;
          middle_name: string | null;
        }>
      | null;
  };
  const enrolmentList = (enrolmentsRaw ?? []) as EnrolmentRow[];

  // Group enrolment rows per student. KD #67 mid-year transfers leave a
  // student with two rows in the AY (one withdrawn, one active) — both
  // are included so the Masterfile can union grade entries across them.
  type StudentGroup = {
    studentId: string;
    studentNumber: string;
    fullName: string;
    enrolments: Array<{
      id: string;
      sectionId: string;
      enrollmentStatus: string;
      createdAt: string | null;
      lateTermOverride: number | null;
      enrollmentDate: string | null;
      withdrawalDate: string | null;
      indexNumber: number | null;
    }>;
  };
  const groupedByStudent = new Map<string, StudentGroup>();
  for (const e of enrolmentList) {
    const s = Array.isArray(e.student) ? e.student[0] : e.student;
    if (!s) continue;
    const existing = groupedByStudent.get(s.id);
    const enrolment = {
      id: e.id,
      sectionId: e.section_id,
      enrollmentStatus: e.enrollment_status,
      createdAt: e.created_at,
      lateTermOverride: e.late_enrollee_term_number ?? null,
      enrollmentDate: e.enrollment_date ?? null,
      withdrawalDate: e.withdrawal_date ?? null,
      indexNumber: e.index_number ?? null,
    };
    if (existing) {
      existing.enrolments.push(enrolment);
    } else {
      groupedByStudent.set(s.id, {
        studentId: s.id,
        studentNumber: s.student_number,
        fullName: [s.last_name, s.first_name, s.middle_name]
          .filter(Boolean)
          .join(', ')
          .trim(),
        enrolments: [enrolment],
      });
    }
  }

  // 6. All grading sheets across the selected sections + AY.
  const allEnrolmentIds = enrolmentList.map((e) => e.id);
  const termIds = terms.map((t) => t.id);
  const subjectIds = subjects.map((s) => s.id);

  if (
    allEnrolmentIds.length === 0 ||
    termIds.length === 0 ||
    subjectIds.length === 0
  ) {
    return {
      ayCode: input.ayCode,
      level: levelRow as { id: string; code: string; label: string },
      subjects,
      terms: terms.map((t) => ({
        id: t.id,
        termNumber: t.term_number,
        label: t.label,
      })),
      sections: sections.map((s) => ({ id: s.id, name: s.name })),
      selectedSectionIds: filterIds,
      rows: [],
      sheets: [],
      thresholds,
    };
  }

  const { data: sheetsRaw } = await service
    .from('grading_sheets')
    .select('id, term_id, subject_id, section_id, is_locked')
    .in('section_id', filterIds)
    .in('term_id', termIds)
    .in('subject_id', subjectIds);

  type SheetRow = {
    id: string;
    term_id: string;
    subject_id: string;
    section_id: string;
    is_locked: boolean | null;
  };
  const sheets = (sheetsRaw ?? []) as SheetRow[];
  const sheetSummaries: MasterfileSheetSummary[] = sheets.map((s) => ({
    id: s.id,
    subjectId: s.subject_id,
    termId: s.term_id,
    sectionId: s.section_id,
    isLocked: s.is_locked === true,
  }));

  type EntryRow = {
    id: string;
    grading_sheet_id: string;
    section_student_id: string;
    quarterly_grade: number | null;
    letter_grade: string | null;
    is_na: boolean;
    annual_letter_grade: string | null;
  };

  // Paginate around PostgREST's 1000-row response cap — a level's
  // roster x subjects x terms routinely exceeds it (KD #95's masterfile
  // feeds both the Academic Summary dashboard and the official
  // .xlsx/.csv report-book export, so truncation here means wrong grades
  // + wrong derived award tiers in the school's official record).
  //
  // The per-LEVEL scoping is load-bearing, not just a UI convenience. Both
  // `.in()` filters below ride in the same request URL, and PostgREST's URL
  // ceiling is ~14.3KB (see lib/supabase/paginate.ts for the measurement).
  // Measured on AY2026: the widest level (P5) is 3.1KB, ~21% of the ceiling —
  // comfortable. Dropping the level filter to load an AY at once would be
  // 23.7KB, or 166% of it, and would fail outright. If a caller ever needs an
  // AY-wide masterfile, it must loop per level or chunk via fetchInChunks.
  const entries: EntryRow[] =
    sheets.length > 0
      ? await fetchAllPages<EntryRow>((from, to) =>
          service
            .from('grade_entries')
            .select(
              'id, grading_sheet_id, section_student_id, quarterly_grade, letter_grade, is_na, annual_letter_grade'
            )
            .in(
              'grading_sheet_id',
              sheets.map((s) => s.id)
            )
            .in('section_student_id', allEnrolmentIds)
            // ⚠ `.order('id')` is REQUIRED, not tidiness. `fetchAllPages`
            // walks with `.range()`, and PostgREST gives no stable row order
            // for an unordered query — so once this filter exceeds the
            // 1000-row page size, pages repeat rows and skip others. It fails
            // silently, as a plausible smaller number.
            //
            // Measured on production 2026-08-18: the widest level (Secondary
            // One) returns 672 rows with TWO terms marked, so nothing is lost
            // today. At four terms that is ~1,344 and four levels cross the
            // line — this bites when T3 and T4 are graded, not before. The
            // same defect was measured live in the Academic Overview loader,
            // where 4,640 entries came back as 3,534 distinct keys.
            .order('id', { ascending: true })
            .range(from, to)
        )
      : [];

  // Lookup helpers.
  const sheetById = new Map<string, SheetRow>();
  for (const s of sheets) sheetById.set(s.id, s);

  // 7. Attendance per term per enrolment. Paginated for the same reason
  // as the grade_entries fetch above (PostgREST's 1000-row cap).
  type AttRow = {
    section_student_id: string;
    term_id: string;
    school_days: number | null;
    days_present: number | null;
    days_late: number | null;
    days_excused: number | null;
  };
  const attendanceRows = await fetchAllPages<AttRow>((from, to) =>
    service
      .from('attendance_records')
      .select(
        'section_student_id, term_id, school_days, days_present, days_late, days_excused'
      )
      .in('section_student_id', allEnrolmentIds)
      .in('term_id', termIds)
      // Ordered for the same reason as the grade_entries fetch above.
      .order('id', { ascending: true })
      .range(from, to)
  );

  // 7b. FCA write-up comments (KD #49) — T1–T3 only (T4 has no FCA comment).
  // `evaluation_writeups` is uniquely keyed (term_id, student_id); we resolve
  // by the student's `student_id` rather than the denormalized
  // `evaluation_writeups.section_id`, so a mid-year transfer keeps the comment
  // (KD #120). Reuses the `writeup` content field that build-report-card reads.
  const commentTermIds = terms
    .filter((t) => t.term_number >= 1 && t.term_number <= 3)
    .map((t) => t.id);
  const studentIds = [...groupedByStudent.keys()];
  const termNumberById = new Map<string, number>();
  for (const t of terms) termNumberById.set(t.id, t.term_number);

  // commentsByStudent: studentId -> termId -> { text, submitted }.
  // Only non-empty entries are stored; submitted reflects the adviser's
  // finalise flag (KD #129). Empty writeups are excluded (text="" = Missing).
  const commentsByStudent = new Map<
    string,
    Map<string, { text: string; submitted: boolean }>
  >();
  if (commentTermIds.length > 0 && studentIds.length > 0) {
    const { data: writeupsRaw } = await service
      .from('evaluation_writeups')
      .select('student_id, term_id, writeup, submitted')
      .in('student_id', studentIds)
      .in('term_id', commentTermIds);
    for (const w of (writeupsRaw ?? []) as Array<{
      student_id: string;
      term_id: string;
      writeup: string | null;
      submitted: boolean | null;
    }>) {
      const text = (w.writeup ?? '').trim();
      if (!text) continue;
      let byTerm = commentsByStudent.get(w.student_id);
      if (!byTerm) {
        byTerm = new Map<string, { text: string; submitted: boolean }>();
        commentsByStudent.set(w.student_id, byTerm);
      }
      byTerm.set(w.term_id, { text, submitted: !!w.submitted });
    }
  }

  // 8. Build student rows.
  const STATUS_RANK: Record<string, number> = {
    active: 0,
    late_enrollee: 1,
    withdrawn: 2,
  };

  const rows: MasterfileStudentRow[] = [];
  for (const group of groupedByStudent.values()) {
    // Pick primary enrolment (highest-priority status, most-recent created_at).
    const sortedEnrolments = group.enrolments.slice().sort((a, b) => {
      const sa = STATUS_RANK[a.enrollmentStatus] ?? 3;
      const sb = STATUS_RANK[b.enrollmentStatus] ?? 3;
      if (sa !== sb) return sa - sb;
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
    const primary = sortedEnrolments[0];
    if (!primary) continue;
    if (!sectionIdSet.has(primary.sectionId)) continue;
    const primarySection = sectionByIid.get(primary.sectionId);
    if (!primarySection) continue;

    const studentEnrolmentIds = new Set(group.enrolments.map((e) => e.id));

    // Per-term enrolment coverage (KD #148, reused from build-report-card.ts).
    // Union of every section_students row this student holds in the AY — a
    // mid-year transfer (KD #67) leaves one withdrawn + one active row, both
    // must count. A term with unset dates is conservatively treated as
    // covered so an unconfigured calendar never fabricates an N.A.
    const coverage: EnrolmentInterval[] = group.enrolments.map((e) => ({
      start: e.enrollmentDate,
      end: e.withdrawalDate,
    }));
    const enrolledTermNumbers: number[] = computeEnrolledTermNumbers(
      coverage,
      terms.map((t) => ({
        termNumber: t.term_number,
        startDate: t.start_date,
        endDate: t.end_date,
      }))
    );
    const enrolledTermNumberSet = new Set(enrolledTermNumbers);

    // Subject rows.
    const subjectRows: MasterfileSubjectRow[] = subjects.map((sub) => {
      let annualLetter: string | null = null;
      let annualLetterEntryId: string | null = null;
      let annualLetterSheetId: string | null = null;

      const cells: MasterfileCell[] = terms.map((t) => {
        // All sheets covering (this term × this subject) across the
        // student's enrolments — union covers the mid-year transfer case.
        const sheetIds = sheets
          .filter((sh) => sh.term_id === t.id && sh.subject_id === sub.id)
          .map((sh) => sh.id);
        const candidates = entries.filter(
          (en) =>
            sheetIds.includes(en.grading_sheet_id) &&
            studentEnrolmentIds.has(en.section_student_id)
        );
        if (candidates.length === 0) {
          // No grade_entries row at all for this (term × subject) — distinguish
          // a genuine gap from a term the student wasn't enrolled for (KD
          // #148): the latter is N.A., not "not yet entered."
          return {
            quarterly: null,
            letter: null,
            isNa: !enrolledTermNumberSet.has(t.term_number),
          };
        }
        // Prefer entries with actual data over blanks.
        const filled = candidates.filter(
          (e) => e.quarterly_grade != null || e.letter_grade != null || e.is_na
        );
        const pool = filled.length > 0 ? filled : candidates;
        const best =
          pool.find((e) => e.section_student_id === primary.id) ?? pool[0];

        if (t.term_number === 4 && !sub.isExaminable) {
          annualLetter = best.annual_letter_grade ?? null;
          annualLetterEntryId = best.id;
          annualLetterSheetId = best.grading_sheet_id;
        }

        return {
          quarterly: best.quarterly_grade,
          letter: best.letter_grade,
          isNa: best.is_na,
        };
      });

      const examinable = sub.isExaminable;
      const overall = examinable
        ? computeAnnualGrade(
            cells[0]?.quarterly ?? null,
            cells[1]?.quarterly ?? null,
            cells[2]?.quarterly ?? null,
            cells[3]?.quarterly ?? null,
            [
              cells[0]?.isNa ?? false,
              cells[1]?.isNa ?? false,
              cells[2]?.isNa ?? false,
              cells[3]?.isNa ?? false,
            ]
          )
        : null;
      const derivedAnnualLetter = examinable
        ? null
        : deriveAnnualLetterForNonExam(
            cells.map((c) => ({ quarterly: c.quarterly, isNa: c.isNa }))
          );

      const eligibility: AwardEligibility = {
        enrolled: primary.enrollmentStatus !== 'withdrawn',
        hasCompleteData:
          examinable && cells.every((c) => c.quarterly != null || c.isNa),
      };
      const award: SubjectAwardLabel = examinable
        ? subjectAward(overall, thresholds, eligibility)
        : null;

      return {
        subjectId: sub.id,
        cells,
        overall,
        award,
        annualLetter,
        derivedAnnualLetter,
        annualLetterEntryId,
        annualLetterSheetId,
      };
    });

    // General Average across examinable subject overalls (1dp per spec).
    const examinableOveralls = subjectRows
      .filter((_, idx) => subjects[idx]?.isExaminable)
      .map((r) => r.overall);
    const generalAverage = computeGeneralAverage(examinableOveralls);

    const overallEligibility: AwardEligibility = {
      enrolled: primary.enrollmentStatus !== 'withdrawn',
      hasCompleteData: examinableOveralls.every((v) => v !== null),
    };
    const overallAward = overallAcademicAward(
      generalAverage,
      thresholds,
      overallEligibility
    );

    // Attendance per term — sum across the student's enrolment rows in this AY.
    const attendanceByTerm: MasterfileAttendanceTermCell[] = terms.map((t) => {
      const rowsForTerm = attendanceRows.filter(
        (r) =>
          r.term_id === t.id && studentEnrolmentIds.has(r.section_student_id)
      );
      if (rowsForTerm.length === 0) {
        return {
          termId: t.id,
          schoolDays: null,
          present: null,
          late: null,
          excused: null,
        };
      }
      let schoolDays: number | null = null;
      let present: number | null = null;
      let late: number | null = null;
      let excused: number | null = null;
      for (const r of rowsForTerm) {
        if (r.school_days != null)
          schoolDays = (schoolDays ?? 0) + r.school_days;
        if (r.days_present != null) present = (present ?? 0) + r.days_present;
        if (r.days_late != null) late = (late ?? 0) + r.days_late;
        if (r.days_excused != null) excused = (excused ?? 0) + r.days_excused;
      }
      return { termId: t.id, schoolDays, present, late, excused };
    });

    const attendanceTotal = attendanceByTerm.reduce(
      (acc, c) => ({
        schoolDays: acc.schoolDays + (c.schoolDays ?? 0),
        present: acc.present + (c.present ?? 0),
        late: acc.late + (c.late ?? 0),
        excused: acc.excused + (c.excused ?? 0),
      }),
      { schoolDays: 0, present: 0, late: 0, excused: 0 }
    );

    // FCA comments (T1–T3), ordered by term number, non-empty only.
    const byTermMap = commentsByStudent.get(group.studentId);
    const commentsByTerm: {
      termNumber: number;
      text: string;
      submitted: boolean;
    }[] = [];
    if (byTermMap) {
      for (const [termId, entry] of byTermMap) {
        const termNumber = termNumberById.get(termId);
        if (termNumber == null) continue;
        commentsByTerm.push({
          termNumber,
          text: entry.text,
          submitted: entry.submitted,
        });
      }
      commentsByTerm.sort((a, b) => a.termNumber - b.termNumber);
    }

    // Resolved joining term for late enrollees (KD #111/#68).
    const lateEnrolleeTermNumber =
      primary.enrollmentStatus === 'late_enrollee'
        ? resolveLateEnrolleeTerm(
            primary.lateTermOverride,
            primary.enrollmentDate,
            terms.map((t) => ({
              termNumber: t.term_number,
              startDate: t.start_date,
              endDate: t.end_date,
            }))
          )
        : null;

    rows.push({
      studentId: group.studentId,
      studentNumber: group.studentNumber,
      fullName: group.fullName,
      sectionId: primary.sectionId,
      sectionName: primarySection.name,
      formClassAdviser: adviserNameBySection.get(primary.sectionId) ?? null,
      enrollmentStatus: primary.enrollmentStatus,
      indexNumber: primary.indexNumber ?? null,
      subjectRows,
      generalAverage,
      overallAward,
      attendanceByTerm,
      attendanceTotal,
      commentsByTerm,
      lateEnrolleeTermNumber,
      enrolledTermNumbers,
    });
  }

  // Sort: by section name, then by full name within a section.
  rows.sort((a, b) => {
    const s = a.sectionName.localeCompare(b.sectionName);
    if (s !== 0) return s;
    return a.fullName.localeCompare(b.fullName);
  });

  return {
    ayCode: input.ayCode,
    level: levelRow as { id: string; code: string; label: string },
    subjects,
    terms: terms.map((t) => ({
      id: t.id,
      termNumber: t.term_number,
      label: t.label,
    })),
    sections: sections.map((s) => ({ id: s.id, name: s.name })),
    selectedSectionIds: filterIds,
    rows,
    sheets: sheetSummaries,
    thresholds,
  };
}
