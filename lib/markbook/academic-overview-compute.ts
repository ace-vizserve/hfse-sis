// School-wide Academic Overview — pure aggregation.
//
// The per-level masterfile dashboard (lib/markbook/masterfile-dashboard.ts)
// answers "how is Primary Three doing". This answers "how is the SCHOOL doing,
// and which level should I look at first" — one row per grade level, one per
// subject, one per term.
//
// Runtime-pure: no Supabase client, no `server-only`, no `next/cache`. The
// loader (lib/markbook/academic-overview.ts) does the I/O and hands the rows
// here. Same split as masterfile.ts (loader) / masterfile-dashboard.ts (maths),
// so every number below is unit-testable — see
// __tests__/markbook/academic-overview.test.ts.
//
// Three rules run through all of it:
//   1. EXAMINABLE SUBJECTS ONLY. Non-examinable subjects write a transmuted
//      numeric `quarterly_grade` through the same pipeline (KD #104) — in
//      AY2026 they span 65–100 and look exactly like real marks. Averaging them
//      produces a wrong number that looks plausible.
//   2. `is_na` ROWS ARE NOT GRADES (Hard Rule #3 / KD #148).
//   3. COMPLETED TERMS ONLY for anything headline. A term still being taught
//      has partial marks; folding them into a school average silently drags it.

import {
  AT_RISK_ATTENDANCE_THRESHOLD_PCT,
  isAttendanceAtRisk,
} from '@/lib/attendance/risk';
import {
  GRADE_BANDS,
  PASS_MARK,
  classifyGradeBucket,
  type GradeBand,
} from '@/lib/markbook/drill-filter';

export { AT_RISK_ATTENDANCE_THRESHOLD_PCT };

// ---------------------------------------------------------------------------
// Inputs — the shapes the loader produces.

export type OverviewTermInput = {
  id: string;
  termNumber: number;
  label: string;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean | null;
};

export type OverviewLevelInput = {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
};

export type OverviewSubjectInput = {
  id: string;
  name: string;
  isExaminable: boolean;
};

/** One grade cell, already joined to its term / subject / level / student. */
export type OverviewGradeInput = {
  termId: string;
  subjectId: string;
  levelId: string;
  /**
   * `students.id`, NOT `section_students.id`. A student who transfers class
   * mid-year has two enrolment rows, and keying on the enrolment would count
   * them twice — which would break the invariant that the grade-level bars sum
   * to the school total.
   */
  studentId: string;
  sectionId: string;
  quarterly: number | null;
  isNa: boolean;
};

export type OverviewSectionInput = {
  id: string;
  name: string;
  levelId: string;
};

export type OverviewStudentInput = {
  id: string;
  studentNumber: string;
  fullName: string;
};

/**
 * What the operator has narrowed to. Every one of these narrows THIS page —
 * none of them navigates away — so the layout is identical at every scope and
 * only the numbers move.
 */
export type AcademicOverviewFilters = {
  levelId: string | null;
  sectionId: string | null;
  subjectId: string | null;
  termNumber: number | null;
};

export const NO_FILTERS: AcademicOverviewFilters = {
  levelId: null,
  sectionId: null,
  subjectId: null,
  termNumber: null,
};

/** One attendance rollup: a student's days for one term, in one class. */
export type OverviewAttendanceInput = {
  studentId: string;
  levelId: string;
  sectionId: string;
  termId: string;
  schoolDays: number | null;
  present: number | null;
  late: number | null;
};

export type AcademicOverviewInput = {
  ayCode: string;
  filters?: AcademicOverviewFilters;
  attendance: OverviewAttendanceInput[];
  sections: OverviewSectionInput[];
  students: OverviewStudentInput[];
  /** SGT date, yyyy-MM-dd (KD #32). Injected so term status is testable. */
  today: string;
  terms: OverviewTermInput[];
  levels: OverviewLevelInput[];
  subjects: OverviewSubjectInput[];
  grades: OverviewGradeInput[];
  /** Distinct non-withdrawn `students.id` enrolled this AY. */
  enrolledStudentIds: string[];
  sectionCount: number;
  /**
   * Distinct subjects with a grading sheet this AY — examinable or not, since
   * this counts what is being TAUGHT, not what is averaged below.
   */
  subjectsTaught: number;
  /** Rows in `subjects` — the catalogue, whether or not taught this year. */
  subjectsConfigured: number;
  sheets: { total: number; locked: number };
};

// ---------------------------------------------------------------------------
// Outputs.

export type TermStatus = 'completed' | 'in_progress' | 'upcoming';

export type BandCounts = Record<GradeBand, number>;

export type OverviewTermRow = {
  termId: string;
  termNumber: number;
  label: string;
  status: TermStatus;
  /** null when the term is not reportable yet — never 0 standing in for "no data". */
  average: number | null;
  passingRate: number | null;
  /** Always the real count, even when average/passingRate are withheld. */
  studentsGraded: number;
};

export type SubjectExtreme = { name: string; average: number } | null;
export type LevelExtreme = { label: string; average: number } | null;

export type OverviewLevelRow = {
  levelId: string;
  levelCode: string;
  levelLabel: string;
  sortOrder: number;
  students: number;
  average: number | null;
  passingRate: number | null;
  /** Mean number of subjects a student in this level is averaging below 75 in. */
  failedSubjectsAvg: number | null;
  strongestSubject: SubjectExtreme;
  weakestSubject: SubjectExtreme;
  bands: BandCounts;
  /** Last completed term minus first. null when fewer than two are comparable. */
  delta: number | null;
  /** Share of school days attended, 0–100. null when nothing is recorded. */
  attendanceRate: number | null;
  /**
   * Students in this level whose own rate is under the at-risk line. null —
   * not 0 — when the level has no attendance recorded at all, so "nobody is
   * below" is never confused with "nothing has been marked".
   */
  attendanceBelowThreshold: number | null;
};

export type OverviewSubjectRow = {
  subjectId: string;
  subjectName: string;
  students: number;
  average: number | null;
  passingRate: number | null;
  strongestLevel: LevelExtreme;
  weakestLevel: LevelExtreme;
  bands: BandCounts;
  delta: number | null;
};

export type OverviewStudentRow = {
  studentId: string;
  studentNumber: string;
  fullName: string;
  average: number;
  subjectsTaken: number;
  subjectsBelowPass: number;
  /** Share of school days attended over the reported terms. null = no record. */
  attendanceRate: number | null;
};

/** One student sitting under the at-risk line, worst first. */
export type AttendanceConcernRow = {
  studentId: string;
  studentNumber: string;
  fullName: string;
  levelLabel: string;
  sectionName: string;
  rate: number;
  schoolDays: number;
  daysMissed: number;
};

/** One term's attendance, for the trend beside the grade trend. */
export type OverviewAttendanceTermRow = {
  termId: string;
  termNumber: number;
  label: string;
  status: TermStatus;
  /** null when the term is not reportable yet — never 0 standing in for "no data". */
  rate: number | null;
  schoolDays: number;
  /** Always the real count, even when the rate is withheld. */
  studentsRecorded: number;
};

export type AttendanceHealth = {
  schoolDays: number;
  present: number;
  late: number;
  absent: number;
  presentRate: number | null;
  lateRate: number | null;
  absentRate: number | null;
  /**
   * True when a Subject filter is active. Attendance is recorded per DAY, not
   * per subject, so it cannot be narrowed that way — the card says so rather
   * than showing the whole cohort's days under a subject heading.
   */
  ignoresSubjectFilter: boolean;
  /**
   * Every term in the year, including the one being taught — the trend has to
   * show the shape of the whole year, exactly as the grade trend does. The
   * headline figures above stay completed-terms-only.
   */
  terms: OverviewAttendanceTermRow[];
  /** Students with any attendance recorded in scope — the denominator below. */
  studentsRecorded: number;
  /**
   * Named students under the at-risk line, worst first.
   *
   * ⚠ Named at EVERY scope, unlike `studentLists`, and the difference is
   * deliberate. The academic list is withheld school-wide because it is
   * unbounded — at a pass mark of 75 it would name every struggling child in
   * the school. This one is bounded by an explicit threshold nobody crosses
   * by accident (8 students school-wide in AY2026), and naming them is the
   * point: an attendance shortfall is an administrative fact the office has
   * to act on, and today finding out who means asking whoever keeps the
   * register. The threshold is a display heuristic, not a school rule — see
   * lib/attendance/risk.ts.
   */
  concerns: AttendanceConcernRow[];
};

export type AcademicOverview = {
  ayCode: string;
  filters: AcademicOverviewFilters;
  attendance: AttendanceHealth;
  /** e.g. "Primary Six · 6 - St. Clare" — null when nothing is narrowed. */
  scopeLabel: string | null;
  filterOptions: {
    levels: { id: string; label: string }[];
    sections: { id: string; name: string; levelId: string }[];
    subjects: { id: string; name: string }[];
    terms: { termNumber: number; label: string }[];
  };
  /**
   * Named students, and ONLY when a single class is in scope. A school-wide
   * list of the lowest-averaging children is a watchlist of named minors; at
   * one class of ~30 it is the register the teacher already has in front of
   * them. `null` means "not applicable at this scope", not "none found".
   */
  studentLists: {
    top: OverviewStudentRow[];
    needsImprovement: OverviewStudentRow[];
  } | null;
  scale: {
    studentsEnrolled: number;
    sections: number;
    subjectsTaught: number;
    subjectsConfigured: number;
    levels: number;
  };
  sheets: { total: number; locked: number };
  termProgress: {
    current: {
      termNumber: number;
      label: string;
      startDate: string | null;
      endDate: string | null;
      elapsedPct: number | null;
    } | null;
    completedCount: number;
    totalCount: number;
    /** e.g. "Term 1 – Term 2", or null when nothing has completed. */
    reportedRangeLabel: string | null;
  };
  kpis: {
    average: number | null;
    passingRate: number | null;
    needsSupport: number;
    needsSupportPct: number | null;
    outstanding: number;
    outstandingPct: number | null;
  };
  terms: OverviewTermRow[];
  levels: OverviewLevelRow[];
  subjects: OverviewSubjectRow[];
  distribution: { bands: BandCounts; total: number };
  coverage: {
    studentsEnrolled: number;
    /**
     * Everyone with at least one mark — which can EXCEED `studentsEnrolled`,
     * because a student who withdrew mid-year keeps the marks they earned
     * (Hard Rule #6). AY2025 reads 412 with grades against 383 enrolled.
     * So never phrase this as "X of Y enrolled"; use `enrolledWithoutGrades`
     * for the sentence that has to be true in both directions.
     */
    studentsWithGrades: number;
    /** Enrolled students with no mark at all — the actionable gap. */
    enrolledWithoutGrades: number;
  };
  anomalies: {
    /**
     * Examinable marks stored below 60. `transmute()` floors at 60, so these
     * cannot come from the grading formula — they are backfilled values, and
     * they drag every rate on the page. Reported, never silently dropped.
     */
    impossibleLowGrades: number;
  };
};

// ---------------------------------------------------------------------------
// Thresholds.

/**
 * A term still being taught only reports an average once this share of the
 * year's graded students have a mark in it. Below that the row shows its real
 * graded count with dashes for the rates: one student's 81.0 is a true number
 * and a misleading summary of a 400-student school.
 */
const IN_PROGRESS_MIN_COVERAGE = 0.2;

/** Below this a grade could not have come from `transmute()` (which floors at 60). */
const IMPOSSIBLE_GRADE_FLOOR = 60;

// ---------------------------------------------------------------------------
// Small helpers.

function emptyBands(): BandCounts {
  return { dnm: 0, fs: 0, s: 0, vs: 0, o: 0 };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** One decimal place — the precision the report card and masterfile already use. */
function round1(value: number | null): number | null {
  return value == null ? null : Math.round(value * 10) / 10;
}

function passingRateOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const passing = values.filter((v) => v >= PASS_MARK).length;
  return Math.round((passing / values.length) * 1000) / 10;
}

function pctOf(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((part / total) * 1000) / 10;
}

function addToBands(bands: BandCounts, average: number): void {
  const key = classifyGradeBucket(average);
  if (key) bands[key] += 1;
}

// ---------------------------------------------------------------------------
// Term status.

export function resolveTermStatus(
  term: Pick<OverviewTermInput, 'startDate' | 'endDate'>,
  today: string
): TermStatus {
  // No dates configured means nothing can be asserted about when it runs, so it
  // is treated as still ahead rather than quietly counted as finished.
  if (!term.endDate) return 'upcoming';
  if (term.endDate < today) return 'completed';
  if (term.startDate && term.startDate <= today) return 'in_progress';
  return 'upcoming';
}

/** How far through its window a term is, 0–100. null when it has no window. */
export function termElapsedPct(
  term: Pick<OverviewTermInput, 'startDate' | 'endDate'>,
  today: string
): number | null {
  if (!term.startDate || !term.endDate) return null;
  const start = Date.parse(term.startDate);
  const end = Date.parse(term.endDate);
  const now = Date.parse(today);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  const pct = ((now - start) / (end - start)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

// ---------------------------------------------------------------------------
// Main entry.

export function computeAcademicOverview(
  input: AcademicOverviewInput
): AcademicOverview {
  const terms = [...input.terms].sort((a, b) => a.termNumber - b.termNumber);
  const subjectById = new Map(input.subjects.map((s) => [s.id, s]));
  const levelById = new Map(input.levels.map((l) => [l.id, l]));

  const statusByTermId = new Map<string, TermStatus>(
    terms.map((t) => [t.id, resolveTermStatus(t, input.today)])
  );
  const completedTermIds = new Set(
    terms
      .filter((t) => statusByTermId.get(t.id) === 'completed')
      .map((t) => t.id)
  );

  const filters = input.filters ?? NO_FILTERS;
  const termNumberByIdAll = new Map(terms.map((t) => [t.id, t.termNumber]));

  // Every examinable, non-N.A., actually-graded cell, narrowed by everything
  // EXCEPT the term filter — the per-term table has to keep reporting each
  // term, including the one still being taught.
  const graded = input.grades.filter(
    (g) =>
      !g.isNa &&
      g.quarterly != null &&
      subjectById.get(g.subjectId)?.isExaminable === true &&
      (filters.levelId == null || g.levelId === filters.levelId) &&
      (filters.sectionId == null || g.sectionId === filters.sectionId) &&
      (filters.subjectId == null || g.subjectId === filters.subjectId)
  ) as (OverviewGradeInput & { quarterly: number })[];

  // The reported scope: completed terms only, plus the term filter if set.
  const scoped = graded.filter(
    (g) =>
      completedTermIds.has(g.termId) &&
      (filters.termNumber == null ||
        termNumberByIdAll.get(g.termId) === filters.termNumber)
  );

  // ---- per-student and per-(student, subject) means -----------------------
  const studentTotals = new Map<string, { sum: number; n: number }>();
  const studentSubjectTotals = new Map<
    string,
    { sum: number; n: number; studentId: string; subjectId: string }
  >();
  // Which level a student belongs to. A mid-year transfer across levels would
  // otherwise appear in two, and the grade-level bars would no longer sum to
  // the school total. Latest completed term wins.
  const studentLevel = new Map<
    string,
    { levelId: string; termNumber: number }
  >();
  const termNumberById = new Map(terms.map((t) => [t.id, t.termNumber]));

  for (const g of scoped) {
    const st = studentTotals.get(g.studentId) ?? { sum: 0, n: 0 };
    st.sum += g.quarterly;
    st.n += 1;
    studentTotals.set(g.studentId, st);

    const key = `${g.studentId} ${g.subjectId}`;
    const ss = studentSubjectTotals.get(key) ?? {
      sum: 0,
      n: 0,
      studentId: g.studentId,
      subjectId: g.subjectId,
    };
    ss.sum += g.quarterly;
    ss.n += 1;
    studentSubjectTotals.set(key, ss);

    const tn = termNumberById.get(g.termId) ?? 0;
    const held = studentLevel.get(g.studentId);
    if (!held || tn >= held.termNumber) {
      studentLevel.set(g.studentId, { levelId: g.levelId, termNumber: tn });
    }
  }

  // Subjects a student is failing, for the level table's "subjects below 75".
  const failedSubjectsByStudent = new Map<string, number>();
  for (const [, ss] of studentSubjectTotals) {
    const avg = ss.sum / ss.n;
    const prev = failedSubjectsByStudent.get(ss.studentId) ?? 0;
    failedSubjectsByStudent.set(ss.studentId, prev + (avg < PASS_MARK ? 1 : 0));
  }

  // ---- distribution + KPIs ------------------------------------------------
  const distributionBands = emptyBands();
  for (const [, totals] of studentTotals) {
    addToBands(distributionBands, totals.sum / totals.n);
  }
  const studentsWithGrades = studentTotals.size;
  const scopedValues = scoped.map((g) => g.quarterly);

  // ---- per-term rows ------------------------------------------------------
  const termRows: OverviewTermRow[] = terms.map((t) => {
    const status = statusByTermId.get(t.id) ?? 'upcoming';
    const rows = graded.filter((g) => g.termId === t.id);
    const studentsGraded = new Set(rows.map((g) => g.studentId)).size;

    // An upcoming term has nothing to say. An in-progress one says nothing
    // until enough of the school has been marked (see IN_PROGRESS_MIN_COVERAGE).
    let reportable = status === 'completed' && rows.length > 0;
    if (status === 'in_progress' && rows.length > 0) {
      const coverage =
        studentsWithGrades > 0 ? studentsGraded / studentsWithGrades : 0;
      reportable = coverage >= IN_PROGRESS_MIN_COVERAGE;
    }

    const values = rows.map((g) => g.quarterly);
    return {
      termId: t.id,
      termNumber: t.termNumber,
      label: t.label,
      status,
      average: reportable ? round1(mean(values)) : null,
      passingRate: reportable ? passingRateOf(values) : null,
      studentsGraded,
    };
  });

  // ---- attendance --------------------------------------------------------
  //
  // Narrowed by level and class — but NOT by subject, because a school day is
  // not attended per subject.
  //
  // Two sets, for the same reason the grade code keeps `graded` and `scoped`
  // apart: the trend has to plot every term including the one being taught,
  // while the headline figures stay on completed terms so they match the grade
  // figures beside them.
  const attendanceInCohort = input.attendance.filter(
    (a) =>
      (filters.levelId == null || a.levelId === filters.levelId) &&
      (filters.sectionId == null || a.sectionId === filters.sectionId)
  );
  const attendanceRows = attendanceInCohort.filter(
    (a) =>
      completedTermIds.has(a.termId) &&
      (filters.termNumber == null ||
        termNumberByIdAll.get(a.termId) === filters.termNumber)
  );
  const attendanceByLevel = new Map<
    string,
    { days: number; present: number }
  >();
  for (const a of attendanceRows) {
    const slot = attendanceByLevel.get(a.levelId) ?? { days: 0, present: 0 };
    slot.days += a.schoolDays ?? 0;
    slot.present += a.present ?? 0;
    attendanceByLevel.set(a.levelId, slot);
  }

  // Per student, across the reported terms — the basis for both the named
  // at-risk list and the per-level count of who is under the line.
  const attendanceByStudent = new Map<
    string,
    { days: number; present: number; levelId: string; sectionId: string }
  >();
  for (const a of attendanceRows) {
    const slot = attendanceByStudent.get(a.studentId) ?? {
      days: 0,
      present: 0,
      levelId: a.levelId,
      sectionId: a.sectionId,
    };
    slot.days += a.schoolDays ?? 0;
    slot.present += a.present ?? 0;
    // Latest class wins, so a mid-year transfer is listed where they are now.
    slot.levelId = a.levelId;
    slot.sectionId = a.sectionId;
    attendanceByStudent.set(a.studentId, slot);
  }
  const attendanceRateByStudent = new Map<string, number>();
  for (const [studentId, slot] of attendanceByStudent) {
    if (slot.days <= 0) continue;
    attendanceRateByStudent.set(
      studentId,
      Math.round((slot.present / slot.days) * 1000) / 10
    );
  }

  const attendance: AttendanceHealth = {
    ...summariseAttendance(attendanceRows, filters.subjectId != null),
    terms: buildAttendanceTermRows(
      attendanceInCohort,
      terms,
      statusByTermId,
      attendanceRateByStudent.size
    ),
    studentsRecorded: attendanceRateByStudent.size,
    concerns: buildAttendanceConcerns(
      attendanceByStudent,
      attendanceRateByStudent,
      input.students,
      levelById,
      input.sections
    ),
  };

  const belowThresholdByLevel = new Map<string, number>();
  for (const [studentId, slot] of attendanceByStudent) {
    if (slot.days <= 0) continue;
    const prev = belowThresholdByLevel.get(slot.levelId) ?? 0;
    belowThresholdByLevel.set(
      slot.levelId,
      prev +
        (isAttendanceAtRisk(attendanceRateByStudent.get(studentId) ?? null)
          ? 1
          : 0)
    );
  }

  // ---- per-level rows -----------------------------------------------------
  const levelRows = buildLevelRows({
    attendanceByLevel,
    belowThresholdByLevel,
    scoped,
    levelById,
    subjectById,
    studentTotals,
    studentLevel,
    failedSubjectsByStudent,
    completedTermIds,
    termNumberById,
  });

  // ---- per-subject rows ---------------------------------------------------
  const subjectRows = buildSubjectRows({
    scoped,
    levelById,
    subjectById,
    studentSubjectTotals,
    completedTermIds,
    termNumberById,
  });

  // ---- term progress ------------------------------------------------------
  const currentTerm = terms.find(
    (t) => statusByTermId.get(t.id) === 'in_progress'
  );
  const completedNumbers = terms
    .filter((t) => statusByTermId.get(t.id) === 'completed')
    .map((t) => t.termNumber);
  const reportedRangeLabel =
    completedNumbers.length === 0
      ? null
      : completedNumbers.length === 1
        ? `Term ${completedNumbers[0]}`
        : `Term ${completedNumbers[0]} – Term ${completedNumbers[completedNumbers.length - 1]}`;

  const needsSupport = distributionBands.dnm;
  const outstanding = distributionBands.o;
  const enrolledIds = new Set(input.enrolledStudentIds);

  // ---- scope label + filter options -------------------------------------
  const levelLabel = filters.levelId
    ? (levelById.get(filters.levelId)?.label ?? null)
    : null;
  const sectionName = filters.sectionId
    ? (input.sections.find((s) => s.id === filters.sectionId)?.name ?? null)
    : null;
  const subjectName = filters.subjectId
    ? (subjectById.get(filters.subjectId)?.name ?? null)
    : null;
  const termLabel =
    filters.termNumber != null ? `Term ${filters.termNumber}` : null;
  const scopeParts = [levelLabel, sectionName, subjectName, termLabel].filter(
    (p): p is string => !!p
  );
  const scopeLabel = scopeParts.length > 0 ? scopeParts.join(' · ') : null;

  // ---- named students, only for a single class --------------------------
  const studentLists = filters.sectionId
    ? buildStudentLists(
        studentTotals,
        studentSubjectTotals,
        input.students,
        attendanceRateByStudent
      )
    : null;

  return {
    ayCode: input.ayCode,
    filters,
    attendance,
    scopeLabel,
    filterOptions: {
      levels: input.levels.map((l) => ({ id: l.id, label: l.label })),
      sections: input.sections,
      // Only subjects actually taught, so the picker cannot select an empty scope.
      subjects: input.subjects
        .filter(
          (s) =>
            s.isExaminable && input.grades.some((g) => g.subjectId === s.id)
        )
        .map((s) => ({ id: s.id, name: s.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      terms: terms.map((t) => ({ termNumber: t.termNumber, label: t.label })),
    },
    studentLists,
    scale: {
      studentsEnrolled: enrolledIds.size,
      sections: input.sectionCount,
      subjectsTaught: input.subjectsTaught,
      subjectsConfigured: input.subjectsConfigured,
      levels: input.levels.length,
    },
    sheets: input.sheets,
    termProgress: {
      current: currentTerm
        ? {
            termNumber: currentTerm.termNumber,
            label: currentTerm.label,
            startDate: currentTerm.startDate,
            endDate: currentTerm.endDate,
            elapsedPct: termElapsedPct(currentTerm, input.today),
          }
        : null,
      completedCount: completedNumbers.length,
      totalCount: terms.length,
      reportedRangeLabel,
    },
    kpis: {
      average: round1(mean(scopedValues)),
      passingRate: passingRateOf(scopedValues),
      needsSupport,
      needsSupportPct: pctOf(needsSupport, studentsWithGrades),
      outstanding,
      outstandingPct: pctOf(outstanding, studentsWithGrades),
    },
    terms: termRows,
    levels: levelRows,
    subjects: subjectRows,
    distribution: { bands: distributionBands, total: studentsWithGrades },
    coverage: {
      studentsEnrolled: enrolledIds.size,
      studentsWithGrades,
      enrolledWithoutGrades: [...enrolledIds].filter(
        (id) => !studentTotals.has(id)
      ).length,
    },
    anomalies: {
      impossibleLowGrades: scoped.filter(
        (g) => g.quarterly < IMPOSSIBLE_GRADE_FLOOR
      ).length,
    },
  };
}

/** Top and bottom of one class, by each student's average across their subjects. */
function buildStudentLists(
  studentTotals: Map<string, { sum: number; n: number }>,
  studentSubjectTotals: Map<
    string,
    { sum: number; n: number; studentId: string; subjectId: string }
  >,
  students: OverviewStudentInput[],
  attendanceRateByStudent: Map<string, number>
): { top: OverviewStudentRow[]; needsImprovement: OverviewStudentRow[] } {
  const byId = new Map(students.map((s) => [s.id, s]));
  const subjectCount = new Map<string, number>();
  const belowPass = new Map<string, number>();
  for (const [, ss] of studentSubjectTotals) {
    subjectCount.set(ss.studentId, (subjectCount.get(ss.studentId) ?? 0) + 1);
    if (ss.sum / ss.n < PASS_MARK) {
      belowPass.set(ss.studentId, (belowPass.get(ss.studentId) ?? 0) + 1);
    }
  }

  const rows: OverviewStudentRow[] = [];
  for (const [studentId, totals] of studentTotals) {
    const student = byId.get(studentId);
    if (!student) continue;
    rows.push({
      studentId,
      studentNumber: student.studentNumber,
      fullName: student.fullName,
      average: Math.round((totals.sum / totals.n) * 10) / 10,
      subjectsTaken: subjectCount.get(studentId) ?? 0,
      subjectsBelowPass: belowPass.get(studentId) ?? 0,
      attendanceRate: attendanceRateByStudent.get(studentId) ?? null,
    });
  }

  const byAverageDesc = [...rows].sort((a, b) => b.average - a.average);
  return {
    top: byAverageDesc.slice(0, 5),
    // Everyone averaging under the pass mark — not a fixed-size "bottom N",
    // which would name students who are doing fine whenever nobody is failing.
    needsImprovement: byAverageDesc
      .filter((r) => r.average < PASS_MARK)
      .reverse(),
  };
}

// ---------------------------------------------------------------------------
// Row builders.

type ScopedGrade = OverviewGradeInput & { quarterly: number };

/**
 * First-to-last movement across completed terms. Returns null unless at least
 * two completed terms actually carry marks for this group — a level that only
 * started being marked in Term 2 has no trend, and inventing one from a single
 * point would read as "flat" rather than "unknown".
 */
function deltaAcrossTerms(
  rowsByTermId: Map<string, number[]>,
  orderedCompletedTermIds: string[]
): number | null {
  const present = orderedCompletedTermIds
    .map((id) => rowsByTermId.get(id))
    .filter((v): v is number[] => !!v && v.length > 0);
  if (present.length < 2) return null;
  const first = mean(present[0]);
  const last = mean(present[present.length - 1]);
  if (first == null || last == null) return null;
  return round1(last - first);
}

function orderedCompleted(
  completedTermIds: Set<string>,
  termNumberById: Map<string, number>
): string[] {
  return [...completedTermIds].sort(
    (a, b) => (termNumberById.get(a) ?? 0) - (termNumberById.get(b) ?? 0)
  );
}

function buildLevelRows(args: {
  attendanceByLevel: Map<string, { days: number; present: number }>;
  belowThresholdByLevel: Map<string, number>;
  scoped: ScopedGrade[];
  levelById: Map<string, OverviewLevelInput>;
  subjectById: Map<string, OverviewSubjectInput>;
  studentTotals: Map<string, { sum: number; n: number }>;
  studentLevel: Map<string, { levelId: string; termNumber: number }>;
  failedSubjectsByStudent: Map<string, number>;
  completedTermIds: Set<string>;
  termNumberById: Map<string, number>;
}): OverviewLevelRow[] {
  const {
    attendanceByLevel,
    belowThresholdByLevel,
    scoped,
    levelById,
    subjectById,
    studentTotals,
    studentLevel,
    failedSubjectsByStudent,
    completedTermIds,
    termNumberById,
  } = args;

  const order = orderedCompleted(completedTermIds, termNumberById);

  type Acc = {
    values: number[];
    bySubject: Map<string, number[]>;
    byTerm: Map<string, number[]>;
  };
  const acc = new Map<string, Acc>();
  for (const g of scoped) {
    if (!levelById.has(g.levelId)) continue;
    const a =
      acc.get(g.levelId) ??
      ({ values: [], bySubject: new Map(), byTerm: new Map() } as Acc);
    a.values.push(g.quarterly);
    const sv = a.bySubject.get(g.subjectId) ?? [];
    sv.push(g.quarterly);
    a.bySubject.set(g.subjectId, sv);
    const tv = a.byTerm.get(g.termId) ?? [];
    tv.push(g.quarterly);
    a.byTerm.set(g.termId, tv);
    acc.set(g.levelId, a);
  }

  // Students assigned to each level — exactly one level each, so the bars sum.
  const studentsByLevel = new Map<string, string[]>();
  for (const [studentId, held] of studentLevel) {
    const list = studentsByLevel.get(held.levelId) ?? [];
    list.push(studentId);
    studentsByLevel.set(held.levelId, list);
  }

  const rows: OverviewLevelRow[] = [];
  for (const [levelId, a] of acc) {
    const level = levelById.get(levelId)!;
    const students = studentsByLevel.get(levelId) ?? [];

    const bands = emptyBands();
    for (const studentId of students) {
      const totals = studentTotals.get(studentId);
      if (totals) addToBands(bands, totals.sum / totals.n);
    }

    const subjectAverages = [...a.bySubject.entries()]
      .map(([subjectId, values]) => ({
        name: subjectById.get(subjectId)?.name ?? subjectId,
        average: round1(mean(values))!,
      }))
      .sort((x, y) => y.average - x.average);

    const failCounts = students.map(
      (id) => failedSubjectsByStudent.get(id) ?? 0
    );

    rows.push({
      levelId,
      levelCode: level.code,
      levelLabel: level.label,
      sortOrder: level.sortOrder,
      students: students.length,
      average: round1(mean(a.values)),
      passingRate: passingRateOf(a.values),
      failedSubjectsAvg: round1(mean(failCounts)),
      strongestSubject: subjectAverages[0] ?? null,
      // Only meaningful when more than one subject is taught at this level.
      weakestSubject:
        subjectAverages.length > 1
          ? subjectAverages[subjectAverages.length - 1]
          : null,
      bands,
      delta: deltaAcrossTerms(a.byTerm, order),
      attendanceRate: (() => {
        const att = attendanceByLevel.get(levelId);
        if (!att || att.days === 0) return null;
        return Math.round((att.present / att.days) * 1000) / 10;
      })(),
      // Keyed on the same map as the rate, so a level with a rate always has
      // a count and a level with neither shows a dash in both columns.
      attendanceBelowThreshold: attendanceByLevel.get(levelId)
        ? (belowThresholdByLevel.get(levelId) ?? 0)
        : null,
    });
  }

  // The school ladder, not a ranking — order carries progression.
  return rows.sort((a, b) => a.sortOrder - b.sortOrder);
}

function buildSubjectRows(args: {
  scoped: ScopedGrade[];
  levelById: Map<string, OverviewLevelInput>;
  subjectById: Map<string, OverviewSubjectInput>;
  studentSubjectTotals: Map<
    string,
    { sum: number; n: number; studentId: string; subjectId: string }
  >;
  completedTermIds: Set<string>;
  termNumberById: Map<string, number>;
}): OverviewSubjectRow[] {
  const {
    scoped,
    levelById,
    subjectById,
    studentSubjectTotals,
    completedTermIds,
    termNumberById,
  } = args;

  const order = orderedCompleted(completedTermIds, termNumberById);

  type Acc = {
    values: number[];
    byLevel: Map<string, number[]>;
    byTerm: Map<string, number[]>;
  };
  const acc = new Map<string, Acc>();
  for (const g of scoped) {
    const a =
      acc.get(g.subjectId) ??
      ({ values: [], byLevel: new Map(), byTerm: new Map() } as Acc);
    a.values.push(g.quarterly);
    const lv = a.byLevel.get(g.levelId) ?? [];
    lv.push(g.quarterly);
    a.byLevel.set(g.levelId, lv);
    const tv = a.byTerm.get(g.termId) ?? [];
    tv.push(g.quarterly);
    a.byTerm.set(g.termId, tv);
    acc.set(g.subjectId, a);
  }

  const bandsBySubject = new Map<string, BandCounts>();
  const studentsBySubject = new Map<string, Set<string>>();
  for (const [, ss] of studentSubjectTotals) {
    const bands = bandsBySubject.get(ss.subjectId) ?? emptyBands();
    addToBands(bands, ss.sum / ss.n);
    bandsBySubject.set(ss.subjectId, bands);
    const set = studentsBySubject.get(ss.subjectId) ?? new Set<string>();
    set.add(ss.studentId);
    studentsBySubject.set(ss.subjectId, set);
  }

  const rows: OverviewSubjectRow[] = [];
  for (const [subjectId, a] of acc) {
    const levelAverages = [...a.byLevel.entries()]
      .filter(([levelId]) => levelById.has(levelId))
      .map(([levelId, values]) => ({
        label: levelById.get(levelId)!.label,
        average: round1(mean(values))!,
      }))
      .sort((x, y) => y.average - x.average);

    rows.push({
      subjectId,
      subjectName: subjectById.get(subjectId)?.name ?? subjectId,
      students: studentsBySubject.get(subjectId)?.size ?? 0,
      average: round1(mean(a.values)),
      passingRate: passingRateOf(a.values),
      strongestLevel: levelAverages[0] ?? null,
      // A subject taught at one level only has no weakest level to name.
      weakestLevel:
        levelAverages.length > 1
          ? levelAverages[levelAverages.length - 1]
          : null,
      bands: bandsBySubject.get(subjectId) ?? emptyBands(),
      delta: deltaAcrossTerms(a.byTerm, order),
    });
  }

  // Widest reach first — the subjects most of the school sits.
  return rows.sort((a, b) => b.students - a.students);
}

// ---------------------------------------------------------------------------
// Presentation helpers shared by the page and its export.

/** Band metadata in display order (best first), for legends and spread bars. */
export const BAND_DISPLAY_ORDER: {
  key: GradeBand;
  label: string;
  range: string;
}[] = [
  { key: 'o', label: 'Outstanding', range: '90 – 100' },
  { key: 'vs', label: 'Very satisfactory', range: '85 – 89' },
  { key: 's', label: 'Satisfactory', range: '80 – 84' },
  { key: 'fs', label: 'Fairly satisfactory', range: '75 – 79' },
  { key: 'dnm', label: 'Needs support', range: 'Below 75' },
];

/** Trend direction for a term-over-term move. Under half a point reads as flat. */
export function trendDirection(
  delta: number | null
): 'up' | 'down' | 'flat' | null {
  if (delta == null) return null;
  if (delta >= 0.5) return 'up';
  if (delta <= -0.5) return 'down';
  return 'flat';
}

/** Total students behind a band set — the denominator for a spread bar. */
export function bandTotal(bands: BandCounts): number {
  return GRADE_BANDS.reduce((sum, b) => sum + bands[b.key], 0);
}

// ---------------------------------------------------------------------------
// "Worth a look"
//
// ⚠ THE SYSTEM DECIDES NOTHING HERE. Every line below restates a figure
// already visible on the page — the lowest average, the largest tail, the
// biggest fall — in a sentence. Nothing is scored, ranked against a policy, or
// compared to a threshold the school did not set: the only number used is the
// pass mark, which is the report card's own band boundary. If HFSE later wants
// "at risk" to mean something specific, that is theirs to define, not ours to
// infer from a dashboard.

export type OverviewHighlight = {
  key: string;
  severity: 'bad' | 'warn' | 'info';
  title: string;
  detail: string;
};

/**
 * Roll attendance days into rates.
 *
 * ⚠ LATE IS A SUBSET OF PRESENT in this schema: `days_present` already counts
 * the day and `days_late` only flags it as late. So absent is
 * `schoolDays - present`, and the three rates deliberately do not sum to 100.
 */
function summariseAttendance(
  rows: OverviewAttendanceInput[],
  ignoresSubjectFilter: boolean
): Omit<AttendanceHealth, 'terms' | 'studentsRecorded' | 'concerns'> {
  let schoolDays = 0;
  let present = 0;
  let late = 0;
  for (const r of rows) {
    schoolDays += r.schoolDays ?? 0;
    present += r.present ?? 0;
    late += r.late ?? 0;
  }
  const absent = Math.max(0, schoolDays - present);
  const rate = (part: number) =>
    schoolDays > 0 ? Math.round((part / schoolDays) * 1000) / 10 : null;
  return {
    schoolDays,
    present,
    late,
    absent,
    presentRate: rate(present),
    lateRate: rate(late),
    absentRate: rate(absent),
    ignoresSubjectFilter,
  };
}

/**
 * One row per term for the attendance trend.
 *
 * `school_days` on the rollup counts only days that have actually been MARKED
 * (migration 014 excludes `NC`), so a term still being taught reports a true
 * running rate rather than one diluted by days nobody has reached yet. It is
 * still withheld until enough of the cohort has been marked, on the same
 * reasoning as the grade trend: one class's register is not the school's.
 */
function buildAttendanceTermRows(
  rows: OverviewAttendanceInput[],
  terms: OverviewTermInput[],
  statusByTermId: Map<string, TermStatus>,
  studentsRecordedInScope: number
): OverviewAttendanceTermRow[] {
  return terms.map((term) => {
    const forTerm = rows.filter((r) => r.termId === term.id);
    const studentsRecorded = new Set(
      forTerm.filter((r) => (r.schoolDays ?? 0) > 0).map((r) => r.studentId)
    ).size;
    let schoolDays = 0;
    let present = 0;
    for (const r of forTerm) {
      schoolDays += r.schoolDays ?? 0;
      present += r.present ?? 0;
    }

    const status = statusByTermId.get(term.id) ?? 'upcoming';
    let reportable = status === 'completed' && schoolDays > 0;
    if (status === 'in_progress' && schoolDays > 0) {
      const coverage =
        studentsRecordedInScope > 0
          ? studentsRecorded / studentsRecordedInScope
          : 0;
      reportable = coverage >= IN_PROGRESS_MIN_COVERAGE;
    }

    return {
      termId: term.id,
      termNumber: term.termNumber,
      label: term.label,
      status,
      rate: reportable ? Math.round((present / schoolDays) * 1000) / 10 : null,
      schoolDays,
      studentsRecorded,
    };
  });
}

/** Everyone under the at-risk line, worst first. */
function buildAttendanceConcerns(
  attendanceByStudent: Map<
    string,
    { days: number; present: number; levelId: string; sectionId: string }
  >,
  rateByStudent: Map<string, number>,
  students: OverviewStudentInput[],
  levelById: Map<string, OverviewLevelInput>,
  sections: OverviewSectionInput[]
): AttendanceConcernRow[] {
  const studentById = new Map(students.map((s) => [s.id, s]));
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const out: AttendanceConcernRow[] = [];

  for (const [studentId, slot] of attendanceByStudent) {
    const rate = rateByStudent.get(studentId) ?? null;
    if (!isAttendanceAtRisk(rate)) continue;
    const student = studentById.get(studentId);
    if (!student) continue;
    out.push({
      studentId,
      studentNumber: student.studentNumber,
      fullName: student.fullName,
      levelLabel: levelById.get(slot.levelId)?.label ?? '',
      sectionName: sectionById.get(slot.sectionId)?.name ?? '',
      rate: rate as number,
      schoolDays: slot.days,
      daysMissed: Math.max(0, slot.days - slot.present),
    });
  }

  return out.sort(
    (a, b) => a.rate - b.rate || a.fullName.localeCompare(b.fullName)
  );
}

/** Students in a group sitting at 79 or below — the "tail". */
function tailOf(bands: BandCounts): number {
  return bands.fs + bands.dnm;
}

export function buildOverviewHighlights(
  overview: AcademicOverview
): OverviewHighlight[] {
  const out: OverviewHighlight[] = [];
  const levels = overview.levels.filter((l) => l.average != null);
  const subjects = overview.subjects.filter((s) => s.average != null);

  // Lowest-averaging grade level.
  const weakest = [...levels].sort(
    (a, b) => (a.average ?? 0) - (b.average ?? 0)
  )[0];
  if (weakest) {
    out.push({
      key: `level:${weakest.levelId}`,
      severity: 'bad',
      title: `${weakest.levelLabel} is the weakest year group`,
      detail: `${weakest.average?.toFixed(1)} average, the lowest in the school, with ${weakest.passingRate?.toFixed(0)}% of marks passing.`,
    });
  }

  // Largest tail by SHARE, so a big year group doesn't win on size alone.
  const byTail = [...levels]
    .map((l) => ({
      level: l,
      share: l.students > 0 ? tailOf(l.bands) / l.students : 0,
    }))
    .sort((a, b) => b.share - a.share)[0];
  if (byTail && byTail.share > 0 && byTail.level.levelId !== weakest?.levelId) {
    out.push({
      key: `tail:${byTail.level.levelId}`,
      severity: 'bad',
      title: `${byTail.level.levelLabel} has the biggest group falling behind`,
      detail: `${tailOf(byTail.level.bands)} of its ${byTail.level.students} students are averaging 79 or below.`,
    });
  }

  // Steepest fall since the first completed term.
  const falling = [...subjects]
    .filter((s) => s.delta != null && s.delta <= -0.5)
    .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))[0];
  if (falling) {
    out.push({
      key: `falling:${falling.subjectId}`,
      severity: 'warn',
      title: `${falling.subjectName} has slipped since the first term`,
      detail: `Down ${Math.abs(falling.delta ?? 0).toFixed(1)} points, now averaging ${falling.average?.toFixed(1)}.`,
    });
  }

  // Subject carrying the most students below the pass mark.
  const mostBehind = [...subjects].sort((a, b) => b.bands.dnm - a.bands.dnm)[0];
  if (mostBehind && mostBehind.bands.dnm > 0) {
    out.push({
      key: `behind:${mostBehind.subjectId}`,
      severity: 'warn',
      title: `${mostBehind.subjectName} has the most students below ${PASS_MARK}`,
      detail: `${mostBehind.bands.dnm} of its ${mostBehind.students} students are averaging under ${PASS_MARK}.`,
    });
  }

  // A coverage gap is a data fact, not a performance one — marked differently.
  if (overview.coverage.enrolledWithoutGrades > 0) {
    out.push({
      key: 'coverage',
      severity: 'info',
      title: `${overview.coverage.enrolledWithoutGrades} enrolled students have no grades yet`,
      detail: `Every figure on this page is worked out from the ${overview.coverage.studentsWithGrades} students who do.`,
    });
  }

  return out;
}
