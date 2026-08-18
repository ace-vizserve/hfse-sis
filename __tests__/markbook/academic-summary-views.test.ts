import { describe, expect, it } from 'vitest';

import {
  buildAwardsRows,
  buildAttendanceRows,
  buildCommentRows,
} from '@/lib/markbook/academic-summary-views';
import type {
  MasterfilePayload,
  MasterfileStudentRow,
  MasterfileSubjectRow,
  MasterfileCell,
} from '@/lib/markbook/masterfile';
import {
  computeAnnualGrade,
  computeGeneralAverage,
} from '@/lib/compute/annual';
import {
  DEFAULT_AWARD_THRESHOLDS,
  overallAcademicAward,
  subjectAward,
  type AwardEligibility,
} from '@/lib/compute/awards';

// -----------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------

const TERMS = [
  { id: 't1', termNumber: 1, label: 'Term 1' },
  { id: 't2', termNumber: 2, label: 'Term 2' },
  { id: 't3', termNumber: 3, label: 'Term 3' },
  { id: 't4', termNumber: 4, label: 'Term 4' },
];

const MATH_ID = 'math';
const MUSIC_ID = 'music';

const MATH = {
  id: MATH_ID,
  code: 'MATH',
  name: 'Mathematics',
  isExaminable: true,
};
const MUSIC = {
  id: MUSIC_ID,
  code: 'MUSIC',
  name: 'Music',
  isExaminable: false,
};

const THRESHOLDS = DEFAULT_AWARD_THRESHOLDS; // bronze 88.5 / silver 91.5 / gold 95.5

function cell(
  quarterly: number | null,
  opts?: Partial<MasterfileCell>
): MasterfileCell {
  return { quarterly, letter: null, isNa: false, ...opts };
}

function examRow(
  subjectId: string,
  quarterlies: (number | null)[],
  enrolled = true
): MasterfileSubjectRow {
  const cells = quarterlies.map((q) => cell(q));
  const overall = computeAnnualGrade(
    cells[0].quarterly,
    cells[1].quarterly,
    cells[2].quarterly,
    cells[3].quarterly
  );
  const eligibility: AwardEligibility = {
    enrolled,
    hasCompleteData: cells.every((c) => c.quarterly != null || c.isNa),
  };
  return {
    subjectId,
    cells,
    overall,
    award: subjectAward(overall, THRESHOLDS, eligibility),
    annualLetter: null,
    derivedAnnualLetter: null,
    annualLetterEntryId: null,
    annualLetterSheetId: null,
  };
}

function nonExamRow(subjectId: string): MasterfileSubjectRow {
  return {
    subjectId,
    cells: TERMS.map(() => ({ quarterly: null, letter: 'A', isNa: false })),
    overall: null,
    award: null,
    annualLetter: null,
    derivedAnnualLetter: null,
    annualLetterEntryId: null,
    annualLetterSheetId: null,
  };
}

type StudentOpts = {
  studentNumber: string;
  sectionName?: string;
  enrollmentStatus?: string;
  lateEnrolleeTermNumber?: number | null;
  indexNumber?: number | null;
  subjectRows: MasterfileSubjectRow[];
  attendanceByTerm?: MasterfileStudentRow['attendanceByTerm'];
  attendanceTotal?: MasterfileStudentRow['attendanceTotal'];
  commentsByTerm?: { termNumber: number; text: string; submitted?: boolean }[];
  enrolledTermNumbers?: number[];
};

function makeStudent(opts: StudentOpts): MasterfileStudentRow {
  const examOveralls = opts.subjectRows
    .filter((sr) => sr.subjectId === MATH_ID)
    .map((sr) => sr.overall);
  const generalAverage =
    examOveralls.length > 0 ? computeGeneralAverage(examOveralls) : null;
  const enrolled = (opts.enrollmentStatus ?? 'active') !== 'withdrawn';
  const hasComplete = examOveralls.every((v) => v != null);
  const overallAward = overallAcademicAward(generalAverage, THRESHOLDS, {
    enrolled,
    hasCompleteData: hasComplete,
  });

  const defaultAttByTerm = TERMS.map((t) => ({
    termId: t.id,
    schoolDays: 40 as number | null,
    present: 38 as number | null,
    late: 1 as number | null,
    excused: 1 as number | null,
  }));
  const defaultAttTotal = {
    present: 152,
    late: 4,
    excused: 4,
    schoolDays: 160,
  };

  return {
    studentId: `id-${opts.studentNumber}`,
    studentNumber: opts.studentNumber,
    fullName: `Student, ${opts.studentNumber}`,
    sectionId: 'sec-1',
    sectionName: opts.sectionName ?? 'P6 Diamond',
    formClassAdviser: 'Mr. Tan',
    enrollmentStatus: opts.enrollmentStatus ?? 'active',
    indexNumber: opts.indexNumber ?? 1,
    subjectRows: opts.subjectRows,
    generalAverage,
    overallAward,
    attendanceByTerm: opts.attendanceByTerm ?? defaultAttByTerm,
    attendanceTotal: opts.attendanceTotal ?? defaultAttTotal,
    commentsByTerm: (opts.commentsByTerm ?? []).map((c) => ({
      submitted: c.submitted ?? false,
      termNumber: c.termNumber,
      text: c.text,
    })),
    lateEnrolleeTermNumber: opts.lateEnrolleeTermNumber ?? null,
    enrolledTermNumbers:
      opts.enrolledTermNumbers ?? TERMS.map((t) => t.termNumber),
  };
}

// Student A — full data, high grades → Gold, submitted T1 comment
const studentA = makeStudent({
  studentNumber: 'A001',
  subjectRows: [examRow(MATH_ID, [96, 96, 96, 96]), nonExamRow(MUSIC_ID)],
  // GA = 96 → Gold
  commentsByTerm: [
    { termNumber: 1, text: 'Excellent progress this term.', submitted: true },
  ],
});

// Student LATE — late enrollee from T2, partial data, draft T1 comment
const studentLate = makeStudent({
  studentNumber: 'LATE',
  enrollmentStatus: 'late_enrollee',
  lateEnrolleeTermNumber: 2,
  subjectRows: [
    // T1 cell is null (not yet enrolled), T2-T4 filled
    examRow(MATH_ID, [null, 90, 90, 90]),
    nonExamRow(MUSIC_ID),
  ],
  commentsByTerm: [{ termNumber: 1, text: 'wip', submitted: false }],
});

// Student MISSING — no comment entries at all, middling grades
const studentMissing = makeStudent({
  studentNumber: 'MISSING',
  subjectRows: [examRow(MATH_ID, [89, 89, 89, 89]), nonExamRow(MUSIC_ID)],
  commentsByTerm: [],
});

function buildPayload(): MasterfilePayload {
  return {
    ayCode: 'AY9999',
    level: { id: 'lv1', code: 'P6', label: 'Primary 6' },
    subjects: [MATH, MUSIC], // examinable first
    terms: TERMS,
    sections: [{ id: 'sec-1', name: 'P6 Diamond' }],
    selectedSectionIds: ['sec-1'],
    rows: [studentA, studentLate, studentMissing],
    sheets: [],
    thresholds: THRESHOLDS,
  };
}

// -----------------------------------------------------------------------
// Awards
// -----------------------------------------------------------------------

describe('buildAwardsRows', () => {
  const payload = buildPayload();

  it('full year overall: returns best-first rows with tier from overallAward', () => {
    const rows = buildAwardsRows(payload, {
      subjectId: 'overall',
      termNumber: null,
    });
    // A001 has GA=96 → Gold at the top
    expect(rows[0].tier).toBe('gold');
    expect(rows[0].studentNumber).toBe('A001');
    expect(rows[0].score).toBe(96);
  });

  it('full year overall: every row has a tier', () => {
    const rows = buildAwardsRows(payload, {
      subjectId: 'overall',
      termNumber: null,
    });
    expect(rows.every((r) => r.tier !== null)).toBe(true);
  });

  it('full year subject: tier from subject award label', () => {
    const rows = buildAwardsRows(payload, {
      subjectId: MATH_ID,
      termNumber: null,
    });
    const aRow = rows.find((r) => r.studentNumber === 'A001')!;
    expect(aRow.tier).toBe('gold');
  });

  it('per-term: tier is always null (provisional)', () => {
    const rows = buildAwardsRows(payload, {
      subjectId: 'overall',
      termNumber: 2,
    });
    expect(rows.every((r) => r.tier === null)).toBe(true);
  });

  it('per-term subject: score equals that cell quarterly', () => {
    const rows = buildAwardsRows(payload, {
      subjectId: MATH_ID,
      termNumber: 1,
    });
    const aRow = rows.find((r) => r.studentNumber === 'A001')!;
    // A001 MATH T1 = 96
    expect(aRow.score).toBe(96);
  });

  it('per-term subject: null cell becomes null score (late enrollee T1)', () => {
    const rows = buildAwardsRows(payload, {
      subjectId: MATH_ID,
      termNumber: 1,
    });
    const lateRow = rows.find((r) => r.studentNumber === 'LATE')!;
    expect(lateRow.score).toBeNull();
  });

  it('tier filter on full year keeps only matching tier', () => {
    const rows = buildAwardsRows(payload, {
      subjectId: 'overall',
      termNumber: null,
      tier: 'gold',
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tier === 'gold')).toBe(true);
  });

  it('tier filter: "all" returns all rows', () => {
    const all = buildAwardsRows(payload, {
      subjectId: 'overall',
      termNumber: null,
    });
    const filtered = buildAwardsRows(payload, {
      subjectId: 'overall',
      termNumber: null,
      tier: 'all',
    });
    expect(filtered.length).toBe(all.length);
  });

  it('rows are sorted best-first (descending score)', () => {
    const rows = buildAwardsRows(payload, {
      subjectId: MATH_ID,
      termNumber: null,
    });
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1].score ?? -Infinity;
      const curr = rows[i].score ?? -Infinity;
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it('lateTermNumber surfaced on award rows', () => {
    const rows = buildAwardsRows(payload, {
      subjectId: 'overall',
      termNumber: null,
    });
    const lateRow = rows.find((r) => r.studentNumber === 'LATE')!;
    expect(lateRow.lateTermNumber).toBe(2);
  });

  it('status label is set correctly', () => {
    const rows = buildAwardsRows(payload, {
      subjectId: 'overall',
      termNumber: null,
    });
    expect(rows.find((r) => r.studentNumber === 'A001')!.status).toBe('Active');
    expect(rows.find((r) => r.studentNumber === 'LATE')!.status).toBe(
      'Late enrollee'
    );
  });
});

// -----------------------------------------------------------------------
// Attendance
// -----------------------------------------------------------------------

describe('buildAttendanceRows', () => {
  const payload = buildPayload();

  // A LATE DAY IS A PRESENT DAY. `days_present` counts P, L and EX alike
  // (migration 068, `recompute_attendance_rollup`); `days_late` is a flag on
  // top of it, not a separate bucket. So absent = schoolDays − present, and
  // subtracting `late` a second time under-reports absences by exactly the
  // number of lates — reporting zero whenever a student was late at least as
  // often as they were away.
  //
  // These two assertions used to read `schoolDays - present - late`, which is
  // the implementation restated rather than the rule, so they passed against
  // the wrong arithmetic for as long as it existed. Concrete numbers now.
  it('total: a late day counts as present, not as an absence', () => {
    const rows = buildAttendanceRows(payload, { termNumber: null });
    const r = rows.find((r) => r.studentNumber === 'A001')!;
    // schoolDays 160, present 152 (4 of them late) → 8 days away, not 4.
    expect(r.absent).toBe(8);
    expect(r.absent).toBe(r.schoolDays - r.present);
  });

  it('total: rate = present / schoolDays * 100 (1dp)', () => {
    const rows = buildAttendanceRows(payload, { termNumber: null });
    const r = rows.find((r) => r.studentNumber === 'A001')!;
    const expected = (r.present / r.schoolDays) * 100;
    expect(r.rate).toBeCloseTo(expected, 1);
  });

  it('total: uses attendanceTotal values', () => {
    const rows = buildAttendanceRows(payload, { termNumber: null });
    const r = rows.find((r) => r.studentNumber === 'A001')!;
    // A001 attendanceTotal = { present: 152, late: 4, excused: 0, schoolDays: 160 }
    expect(r.schoolDays).toBe(160);
    expect(r.present).toBe(152);
    expect(r.late).toBe(4);
  });

  it('per-term: uses attendanceByTerm values for that term', () => {
    const rows = buildAttendanceRows(payload, { termNumber: 1 });
    const r = rows.find((r) => r.studentNumber === 'A001')!;
    // T1 cell: schoolDays=40, present=38, late=1
    expect(r.schoolDays).toBe(40);
    expect(r.present).toBe(38);
    expect(r.late).toBe(1);
  });

  it('per-term: a late day counts as present there too', () => {
    const rows = buildAttendanceRows(payload, { termNumber: 1 });
    const r = rows.find((r) => r.studentNumber === 'A001')!;
    // T1: schoolDays 40, present 38 (1 late) → 2 days away, not 1.
    expect(r.absent).toBe(2);
    expect(r.absent).toBe(r.schoolDays - r.present);
  });

  it('agrees with the dashboard, which had it right all along', () => {
    // `lib/markbook/masterfile-dashboard.ts` computes the same figure as
    // `schoolDays - present` and says why in a comment. Two files in one
    // module disagreed; this pins them together.
    const rows = buildAttendanceRows(payload, { termNumber: null });
    for (const r of rows) {
      expect(r.absent).toBe(Math.max(0, r.schoolDays - r.present));
    }
  });

  it('rate is null when schoolDays is 0', () => {
    const payloadCopy = {
      ...buildPayload(),
      rows: [
        makeStudent({
          studentNumber: 'ZERO',
          subjectRows: [
            examRow(MATH_ID, [90, 90, 90, 90]),
            nonExamRow(MUSIC_ID),
          ],
          attendanceTotal: { present: 0, late: 0, excused: 0, schoolDays: 0 },
          attendanceByTerm: TERMS.map((t) => ({
            termId: t.id,
            schoolDays: 0 as number | null,
            present: 0 as number | null,
            late: 0 as number | null,
            excused: 0 as number | null,
          })),
        }),
      ],
    };
    const rows = buildAttendanceRows(payloadCopy, { termNumber: null });
    expect(rows[0].rate).toBeNull();
  });

  it('lateTermNumber surfaced on attendance rows', () => {
    const rows = buildAttendanceRows(payload, { termNumber: null });
    const lateRow = rows.find((r) => r.studentNumber === 'LATE')!;
    expect(lateRow.lateTermNumber).toBe(2);
  });

  it('rows sorted best-first by rate (descending)', () => {
    const rows = buildAttendanceRows(payload, { termNumber: null });
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1].rate ?? -Infinity;
      const curr = rows[i].rate ?? -Infinity;
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });
});

// -----------------------------------------------------------------------
// Comments
// -----------------------------------------------------------------------

describe('buildCommentRows', () => {
  const payload = buildPayload();

  it('Submitted: non-empty text + submitted=true', () => {
    const rows = buildCommentRows(payload, { termNumber: 1 });
    expect(rows.find((r) => r.studentNumber === 'A001')!.commentStatus).toBe(
      'Submitted'
    );
  });

  it('Draft: non-empty text + submitted=false', () => {
    const rows = buildCommentRows(payload, { termNumber: 1 });
    expect(rows.find((r) => r.studentNumber === 'LATE')!.commentStatus).toBe(
      'Draft'
    );
  });

  it('Missing: no entry for that term', () => {
    const rows = buildCommentRows(payload, { termNumber: 1 });
    expect(rows.find((r) => r.studentNumber === 'MISSING')!.commentStatus).toBe(
      'Missing'
    );
  });

  it('status filter "Missing" keeps only Missing rows', () => {
    const rows = buildCommentRows(payload, {
      termNumber: 1,
      status: 'Missing',
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.commentStatus === 'Missing')).toBe(true);
  });

  it('status filter "Submitted" keeps only Submitted rows', () => {
    const rows = buildCommentRows(payload, {
      termNumber: 1,
      status: 'Submitted',
    });
    expect(rows.every((r) => r.commentStatus === 'Submitted')).toBe(true);
  });

  it('termNumber null returns T1-T3 rows only (KD #49)', () => {
    const rows = buildCommentRows(payload, { termNumber: null });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.termNumber >= 1 && r.termNumber <= 3)).toBe(
      true
    );
  });

  it('termNumber null: T4 is excluded', () => {
    const rows = buildCommentRows(payload, { termNumber: null });
    expect(rows.some((r) => r.termNumber === 4)).toBe(false);
  });

  it('termNumber 2: only T2 rows returned', () => {
    const rows = buildCommentRows(payload, { termNumber: 2 });
    expect(rows.every((r) => r.termNumber === 2)).toBe(true);
  });

  it('per-term returns one row per student (for the given term)', () => {
    const rows = buildCommentRows(payload, { termNumber: 1 });
    const studentNumbers = rows.map((r) => r.studentNumber);
    // 3 students → 3 rows for T1
    expect(studentNumbers).toHaveLength(3);
  });

  it('null → no-termNumber returns 3 terms × 3 students = 9 rows', () => {
    const rows = buildCommentRows(payload, { termNumber: null });
    expect(rows).toHaveLength(9);
  });

  it('comment text is populated for Submitted row', () => {
    const rows = buildCommentRows(payload, { termNumber: 1 });
    const a = rows.find((r) => r.studentNumber === 'A001')!;
    expect(a.text).toBe('Excellent progress this term.');
  });

  it('comment text is null for Missing row', () => {
    const rows = buildCommentRows(payload, { termNumber: 1 });
    const m = rows.find((r) => r.studentNumber === 'MISSING')!;
    expect(m.text).toBeNull();
  });

  it('adviser field is populated from formClassAdviser', () => {
    const rows = buildCommentRows(payload, { termNumber: 1 });
    expect(rows[0].adviser).toBe('Mr. Tan');
  });

  it('rows sorted by sectionName then studentName then termNumber', () => {
    const rows = buildCommentRows(payload, { termNumber: null });
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1];
      const b = rows[i];
      const cmp =
        a.sectionName.localeCompare(b.sectionName) ||
        a.studentName.localeCompare(b.studentName) ||
        a.termNumber - b.termNumber;
      expect(cmp).toBeLessThanOrEqual(0);
    }
  });

  it('"all" status filter returns same set as no filter', () => {
    const noFilter = buildCommentRows(payload, { termNumber: 1 });
    const allFilter = buildCommentRows(payload, {
      termNumber: 1,
      status: 'all',
    });
    expect(allFilter.length).toBe(noFilter.length);
  });

  it('Draft filter only returns Draft rows', () => {
    const rows = buildCommentRows(payload, { termNumber: 1, status: 'Draft' });
    expect(rows.every((r) => r.commentStatus === 'Draft')).toBe(true);
  });
});

// -----------------------------------------------------------------------
// buildCommentRows — KD #148 'N.A.' status (plan finding M1/M2)
// -----------------------------------------------------------------------

describe('buildCommentRows — KD #148 enrolment-coverage N.A. status', () => {
  // Late enrollee joining T3 — pre-join terms (T1, T2) must read N.A., not
  // Missing, even though there's no comment on file for them.
  const lateJoiner = makeStudent({
    studentNumber: 'LATE2',
    enrollmentStatus: 'late_enrollee',
    lateEnrolleeTermNumber: 3,
    enrolledTermNumbers: [3, 4],
    subjectRows: [examRow(MATH_ID, [null, null, 90, 90]), nonExamRow(MUSIC_ID)],
    commentsByTerm: [], // T3 (in-scope, enrolled) has no comment — a real gap
  });

  // Withdrew mid-T2 — the symmetric `end`-bound case: post-leave terms (T3)
  // must read N.A., not Missing.
  const earlyLeaver = makeStudent({
    studentNumber: 'LEAVER2',
    enrollmentStatus: 'withdrawn',
    enrolledTermNumbers: [1, 2],
    subjectRows: [examRow(MATH_ID, [85, 85, null, null]), nonExamRow(MUSIC_ID)],
    commentsByTerm: [
      { termNumber: 1, text: 'Good start.', submitted: true },
      // T2 deliberately left blank — a real, in-scope gap (Missing, not N.A.)
    ],
  });

  function buildCoveragePayload(): MasterfilePayload {
    return {
      ayCode: 'AY9999',
      level: { id: 'lv1', code: 'P6', label: 'Primary 6' },
      subjects: [MATH, MUSIC],
      terms: TERMS,
      sections: [{ id: 'sec-1', name: 'P6 Diamond' }],
      selectedSectionIds: ['sec-1'],
      rows: [lateJoiner, earlyLeaver],
      sheets: [],
      thresholds: THRESHOLDS,
    };
  }

  it("a late enrollee's pre-join terms (T1, T2) read N.A., not Missing", () => {
    const payload = buildCoveragePayload();
    const rows = buildCommentRows(payload, { termNumber: null });
    const late = rows.filter((r) => r.studentNumber === 'LATE2');
    const byTerm = new Map(late.map((r) => [r.termNumber, r.commentStatus]));
    expect(byTerm.get(1)).toBe('N.A.');
    expect(byTerm.get(2)).toBe('N.A.');
  });

  it("a late enrollee's in-scope enrolled term (T3) with no comment still reads Missing", () => {
    const payload = buildCoveragePayload();
    const rows = buildCommentRows(payload, { termNumber: 3 });
    const late = rows.find((r) => r.studentNumber === 'LATE2')!;
    expect(late.commentStatus).toBe('Missing');
  });

  it("a withdrawn student's post-leave term (T3, the `end`-bound case) reads N.A., not Missing", () => {
    const payload = buildCoveragePayload();
    const rows = buildCommentRows(payload, { termNumber: 3 });
    const leaver = rows.find((r) => r.studentNumber === 'LEAVER2')!;
    expect(leaver.commentStatus).toBe('N.A.');
  });

  it("a withdrawn student's enrolled-but-blank term (T2) still reads Missing, not N.A.", () => {
    const payload = buildCoveragePayload();
    const rows = buildCommentRows(payload, { termNumber: 2 });
    const leaver = rows.find((r) => r.studentNumber === 'LEAVER2')!;
    expect(leaver.commentStatus).toBe('Missing');
  });

  it("a withdrawn student's enrolled term with a real comment stays Submitted (content is never overridden by coverage)", () => {
    const payload = buildCoveragePayload();
    const rows = buildCommentRows(payload, { termNumber: 1 });
    const leaver = rows.find((r) => r.studentNumber === 'LEAVER2')!;
    expect(leaver.commentStatus).toBe('Submitted');
  });

  it('status filter "N.A." isolates only the not-enrolled rows', () => {
    const payload = buildCoveragePayload();
    const rows = buildCommentRows(payload, {
      termNumber: null,
      status: 'N.A.',
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.commentStatus === 'N.A.')).toBe(true);
  });

  it('a row without enrolledTermNumbers (stale payload shape) falls back to treating every term as enrolled', () => {
    const staleRow = {
      ...lateJoiner,
      enrolledTermNumbers: undefined as unknown as number[],
      commentsByTerm: [],
    };
    const payload: MasterfilePayload = {
      ...buildCoveragePayload(),
      rows: [staleRow],
    };
    const rows = buildCommentRows(payload, { termNumber: 1 });
    // No enrolledTermNumbers → every comment term treated as enrolled → a
    // blank T1 reads Missing (the pre-KD-#148 behaviour), not N.A.
    expect(rows[0].commentStatus).toBe('Missing');
  });
});
