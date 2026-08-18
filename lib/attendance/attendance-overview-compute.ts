// School-wide Attendance Summary — pure aggregation.
//
// The per-level view (lib/markbook/academic-summary-views.ts,
// `buildAttendanceRows`) answers "how did Primary Six attend". This answers
// "how is the school attending, which year group is worst, and who is below the
// line" — across every level at once.
//
// Runtime-pure: no Supabase client, no `server-only`, no `next/cache`. The sweep
// lives in lib/markbook/overview-data.ts and is shared with Academic Summary and
// Awards, so all three read one set of rows.
//
// ─────────────────────────────────────────────────────────────────────────
// ⚠ THE FOUR NUMBERS OVERLAP, AND THAT IS THE TRAP.
//
// `days_present` counts P, L AND EX alike (migration 014), so present, late and
// excused are not separate quantities — late and excused are both INSIDE
// present. The only split of school days that actually partitions is
//
//     onTime + late + excused + absent === schoolDays
//
// Measured on production 2026-08-18: 824 excused days against 822 absent. HALF
// of all non-attendance is authorised, and until `days_excused` was plumbed
// through no masterfile-fed surface could tell the two apart — which is exactly
// what the attendance warning-letter process needs to know.
// ─────────────────────────────────────────────────────────────────────────
//
// ONE THRESHOLD. `AT_RISK_ATTENDANCE_THRESHOLD_PCT` (90) is the only cut-off
// used here. The retired per-level view banded at 95 and 85, giving the app
// three different attendance cut-offs; at 164 of 405 students sitting at exactly
// 100%, the old "≥ 95%" band held 85% of the school and told you nothing.

import { AT_RISK_ATTENDANCE_THRESHOLD_PCT } from '@/lib/attendance/risk';
import type {
  OverviewAttendanceInput,
  OverviewLevelInput,
  OverviewSectionInput,
  OverviewStudentInput,
  OverviewTermInput,
  TermStatus,
} from '@/lib/markbook/academic-overview-compute';
import { resolveTermStatus } from '@/lib/markbook/academic-overview-compute';

// ---------------------------------------------------------------------------
// Inputs.

export type AttendanceOverviewFilters = {
  levelId: string | null;
  sectionId: string | null;
  termNumber: number | null;
};

export const NO_ATTENDANCE_FILTERS: AttendanceOverviewFilters = {
  levelId: null,
  sectionId: null,
  termNumber: null,
};

export type AttendanceOverviewInput = {
  ayCode: string;
  filters?: AttendanceOverviewFilters;
  /** SGT date, yyyy-MM-dd (KD #32). Injected so term status is testable. */
  today: string;
  terms: OverviewTermInput[];
  levels: OverviewLevelInput[];
  sections: OverviewSectionInput[];
  students: OverviewStudentInput[];
  attendance: OverviewAttendanceInput[];
  enrolledStudentIds: string[];
};

// ---------------------------------------------------------------------------
// Outputs.

/** The four-way split of school days, plus the rates read off it. */
export type DaySplit = {
  schoolDays: number;
  onTime: number;
  late: number;
  excused: number;
  absent: number;
  /** Share of school days attended — on time plus late plus excused. */
  presentRate: number | null;
  lateRate: number | null;
  excusedRate: number | null;
  absentRate: number | null;
};

export type AttendanceStudentRow = {
  studentId: string;
  studentNumber: string;
  fullName: string;
  levelId: string;
  levelLabel: string;
  sectionId: string;
  sectionName: string;
  schoolDays: number;
  onTime: number;
  late: number;
  excused: number;
  absent: number;
  /** present / schoolDays × 100, 1dp. null when no day is recorded. */
  rate: number | null;
  /** Below the at-risk line. Never true on a missing measurement. */
  atRisk: boolean;
};

export type AttendanceLevelRow = {
  levelId: string;
  levelLabel: string;
  levelCode: string;
  sortOrder: number;
  students: number;
  split: DaySplit;
  /** Students under the at-risk line. null when nothing is recorded. */
  belowThreshold: number | null;
  /**
   * Absent days ÷ students. The rate cannot be compared across levels — every
   * level sits between 97% and 99%, so a bar chart of it is ten identical bars.
   * The same fact in days spreads three- to fourfold.
   */
  daysMissedPerStudent: number | null;
};

export type AttendanceTermRow = {
  termId: string;
  termNumber: number;
  label: string;
  status: TermStatus;
  /** null when the term has nothing recorded — never 0 standing in for it. */
  rate: number | null;
  schoolDays: number;
  studentsRecorded: number;
};

export type AttendanceOverview = {
  ayCode: string;
  filters: AttendanceOverviewFilters;
  /** e.g. "Primary Six · Term 2" — null when nothing is narrowed. */
  scopeLabel: string | null;
  filterOptions: {
    levels: { id: string; label: string }[];
    sections: { id: string; name: string; levelId: string }[];
    terms: { termNumber: number; label: string }[];
  };
  split: DaySplit;
  coverage: {
    studentsEnrolled: number;
    studentsRecorded: number;
    /** Enrolled students with no register at all — the actionable gap. */
    enrolledWithoutRegister: number;
  };
  threshold: number;
  belowThreshold: number;
  terms: AttendanceTermRow[];
  levels: AttendanceLevelRow[];
  students: AttendanceStudentRow[];
};

// ---------------------------------------------------------------------------
// Helpers.

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function rateOf(part: number, of: number): number | null {
  return of > 0 ? Math.round((part / of) * 1000) / 10 : null;
}

/** Roll rollup rows into the one split that adds up. */
export function splitOf(rows: OverviewAttendanceInput[]): DaySplit {
  let schoolDays = 0;
  let present = 0;
  let late = 0;
  let excused = 0;
  for (const r of rows) {
    schoolDays += r.schoolDays ?? 0;
    present += r.present ?? 0;
    late += r.late ?? 0;
    excused += r.excused ?? 0;
  }
  const absent = Math.max(0, schoolDays - present);
  return {
    schoolDays,
    // Floored at zero: a hand-backfilled rollup could break the subset
    // invariant, and a negative slice would render as a wedge pointing the
    // wrong way.
    onTime: Math.max(0, present - late - excused),
    late,
    excused,
    absent,
    presentRate: rateOf(present, schoolDays),
    lateRate: rateOf(late, schoolDays),
    excusedRate: rateOf(excused, schoolDays),
    absentRate: rateOf(absent, schoolDays),
  };
}

// ---------------------------------------------------------------------------
// Main entry.

export function computeAttendanceOverview(
  input: AttendanceOverviewInput
): AttendanceOverview {
  const filters = input.filters ?? NO_ATTENDANCE_FILTERS;
  const terms = [...input.terms].sort((a, b) => a.termNumber - b.termNumber);
  const levelById = new Map(input.levels.map((l) => [l.id, l]));
  const sectionById = new Map(input.sections.map((s) => [s.id, s]));
  const studentById = new Map(input.students.map((s) => [s.id, s]));
  const termNumberById = new Map(terms.map((t) => [t.id, t.termNumber]));

  // Narrowed by level and class only — the term filter is applied separately,
  // because the per-term table has to keep reporting every term.
  const inCohort = input.attendance.filter(
    (a) =>
      (filters.levelId == null || a.levelId === filters.levelId) &&
      (filters.sectionId == null || a.sectionId === filters.sectionId)
  );
  const scoped = inCohort.filter(
    (a) =>
      filters.termNumber == null ||
      termNumberById.get(a.termId) === filters.termNumber
  );

  // ---- per student --------------------------------------------------------
  const byStudent = new Map<
    string,
    {
      rows: OverviewAttendanceInput[];
      levelId: string;
      sectionId: string;
      termNumber: number;
    }
  >();
  for (const a of scoped) {
    const held = byStudent.get(a.studentId);
    const tn = termNumberById.get(a.termId) ?? 0;
    if (!held) {
      byStudent.set(a.studentId, {
        rows: [a],
        levelId: a.levelId,
        sectionId: a.sectionId,
        termNumber: tn,
      });
      continue;
    }
    held.rows.push(a);
    // Latest term wins, so a mid-year transfer is listed where they are now.
    if (tn >= held.termNumber) {
      held.levelId = a.levelId;
      held.sectionId = a.sectionId;
      held.termNumber = tn;
    }
  }

  const students: AttendanceStudentRow[] = [];
  for (const [studentId, held] of byStudent) {
    const student = studentById.get(studentId);
    if (!student) continue;
    const split = splitOf(held.rows);
    // A student with no recorded day has no rate — that is "not measured",
    // never 0% (the discipline Hard Rule #3 applies to grade cells).
    const rate = split.schoolDays > 0 ? split.presentRate : null;
    students.push({
      studentId,
      studentNumber: student.studentNumber,
      fullName: student.fullName,
      levelId: held.levelId,
      levelLabel: levelById.get(held.levelId)?.label ?? '',
      sectionId: held.sectionId,
      sectionName: sectionById.get(held.sectionId)?.name ?? '',
      schoolDays: split.schoolDays,
      onTime: split.onTime,
      late: split.late,
      excused: split.excused,
      absent: split.absent,
      rate,
      atRisk: rate != null && rate < AT_RISK_ATTENDANCE_THRESHOLD_PCT,
    });
  }

  // Worst first — the order the page exists to produce.
  students.sort(
    (a, b) =>
      (a.rate ?? Number.POSITIVE_INFINITY) -
        (b.rate ?? Number.POSITIVE_INFINITY) ||
      a.fullName.localeCompare(b.fullName)
  );

  // ---- per level ----------------------------------------------------------
  const levels: AttendanceLevelRow[] = [];
  for (const level of input.levels) {
    const rows = scoped.filter((a) => a.levelId === level.id);
    if (rows.length === 0) continue;
    const split = splitOf(rows);
    const inLevel = students.filter((s) => s.levelId === level.id);
    const measured = inLevel.filter((s) => s.rate != null);
    levels.push({
      levelId: level.id,
      levelLabel: level.label,
      levelCode: level.code,
      sortOrder: level.sortOrder,
      students: inLevel.length,
      split,
      belowThreshold:
        measured.length === 0 ? null : measured.filter((s) => s.atRisk).length,
      daysMissedPerStudent:
        measured.length === 0 ? null : round1(split.absent / measured.length),
    });
  }
  // The school ladder, not a ranking — order carries progression.
  levels.sort((a, b) => a.sortOrder - b.sortOrder);

  // ---- per term -----------------------------------------------------------
  // Built from `inCohort`, NOT `scoped`: narrowing to one term must not reduce
  // the trend to a single point.
  const termRows: AttendanceTermRow[] = terms.map((term) => {
    const rows = inCohort.filter((a) => a.termId === term.id);
    const split = splitOf(rows);
    return {
      termId: term.id,
      termNumber: term.termNumber,
      label: term.label,
      status: resolveTermStatus(term, input.today),
      // `school_days` counts only days actually MARKED (migration 014 excludes
      // NC), so a term still being taught reports a true running rate rather
      // than one diluted by days nobody has reached yet.
      rate: split.schoolDays > 0 ? split.presentRate : null,
      schoolDays: split.schoolDays,
      studentsRecorded: new Set(
        rows.filter((r) => (r.schoolDays ?? 0) > 0).map((r) => r.studentId)
      ).size,
    };
  });

  // ---- scope label + coverage ---------------------------------------------
  const levelLabel = filters.levelId
    ? (levelById.get(filters.levelId)?.label ?? null)
    : null;
  const sectionName = filters.sectionId
    ? (sectionById.get(filters.sectionId)?.name ?? null)
    : null;
  const termLabel =
    filters.termNumber != null ? `Term ${filters.termNumber}` : null;
  const scopeParts = [levelLabel, sectionName, termLabel].filter(
    (p): p is string => !!p
  );

  const enrolled = new Set(input.enrolledStudentIds);
  const measuredIds = new Set(
    students.filter((s) => s.rate != null).map((s) => s.studentId)
  );

  return {
    ayCode: input.ayCode,
    filters,
    scopeLabel: scopeParts.length > 0 ? scopeParts.join(' · ') : null,
    filterOptions: {
      levels: input.levels.map((l) => ({ id: l.id, label: l.label })),
      sections: input.sections,
      terms: terms.map((t) => ({ termNumber: t.termNumber, label: t.label })),
    },
    split: splitOf(scoped),
    coverage: {
      studentsEnrolled: enrolled.size,
      studentsRecorded: measuredIds.size,
      enrolledWithoutRegister: [...enrolled].filter(
        (id) => !measuredIds.has(id)
      ).length,
    },
    threshold: AT_RISK_ATTENDANCE_THRESHOLD_PCT,
    belowThreshold: students.filter((s) => s.atRisk).length,
    terms: termRows,
    levels,
    students,
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers shared by the page and its tests.

export type DaySplitKey = 'onTime' | 'late' | 'excused' | 'absent';

/** The four parts in the order they are always drawn — best to worst. */
export const DAY_SPLIT_ORDER: {
  key: DaySplitKey;
  label: string;
  /** What the mark means in plain words, for a legend or a popover. */
  meaning: string;
}[] = [
  { key: 'onTime', label: 'On time', meaning: 'In class at the bell' },
  {
    key: 'late',
    label: 'Late',
    meaning: 'Arrived late — still counts present',
  },
  {
    key: 'excused',
    label: 'Excused',
    meaning: 'MC or approved absence — still counts present',
  },
  { key: 'absent', label: 'Absent', meaning: 'Away with no reason recorded' },
];
