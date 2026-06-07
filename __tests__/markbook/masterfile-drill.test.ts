import { describe, expect, it } from 'vitest';

import {
  computeMasterfileDashboard,
  enrolledScopeRows,
  studentHasMissingGradeInScope,
  studentMissingCommentTerms,
  subjectsInScope,
  termIndicesInScope,
  commentTermsInScope,
  type MasterfileDashboardFilters,
} from '@/lib/markbook/masterfile-dashboard';
import { buildMasterfileDrillRows } from '@/lib/markbook/masterfile-drill';
import type {
  MasterfileCell,
  MasterfilePayload,
  MasterfileStudentRow,
  MasterfileSubjectRow,
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

// Drill parity guard for the Academic Summary dashboard (KD #124 lesson).
// For every drillable target, the drill's row count (or the relevant invariant)
// MUST equal the aggregate it drills from — they share predicates via
// masterfile-dashboard.ts. Fixture mirrors the dashboard test.

const TERMS = [
  { id: 't1', termNumber: 1, label: 'Term 1' },
  { id: 't2', termNumber: 2, label: 'Term 2' },
  { id: 't3', termNumber: 3, label: 'Term 3' },
  { id: 't4', termNumber: 4, label: 'Term 4' },
];

const MATH = {
  id: 'math',
  code: 'MATH',
  name: 'Mathematics',
  isExaminable: true,
};
const SCI = { id: 'sci', code: 'SCI', name: 'Science', isExaminable: true };
const MUSIC = {
  id: 'music',
  code: 'MUSIC',
  name: 'Music',
  isExaminable: false,
};

const THRESHOLDS = DEFAULT_AWARD_THRESHOLDS;

const ALL_FILTERS: MasterfileDashboardFilters = {
  termNumber: null,
  status: 'all',
  subjectId: null,
};

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

function nonExamRow(
  subjectId: string,
  letters: (string | null)[]
): MasterfileSubjectRow {
  return {
    subjectId,
    cells: letters.map((l) => ({ quarterly: null, letter: l, isNa: false })),
    overall: null,
    award: null,
    annualLetter: null,
    derivedAnnualLetter: null,
    annualLetterEntryId: null,
    annualLetterSheetId: null,
  };
}

function student(
  partial: Partial<Omit<MasterfileStudentRow, 'commentsByTerm'>> & {
    studentNumber: string;
    subjectRows: MasterfileSubjectRow[];
    commentsByTerm?: {
      termNumber: number;
      text: string;
      submitted?: boolean;
    }[];
  }
): MasterfileStudentRow {
  const examOveralls = partial.subjectRows
    .filter((sr) => sr.subjectId === MATH.id || sr.subjectId === SCI.id)
    .map((sr) => sr.overall);
  const generalAverage =
    partial.generalAverage !== undefined
      ? partial.generalAverage
      : computeGeneralAverage(examOveralls);
  const enrolled = (partial.enrollmentStatus ?? 'active') !== 'withdrawn';
  const overallAward = overallAcademicAward(generalAverage, THRESHOLDS, {
    enrolled,
    hasCompleteData: examOveralls.every((v) => v != null),
  });
  return {
    studentId: `id-${partial.studentNumber}`,
    studentNumber: partial.studentNumber,
    fullName: partial.fullName ?? `Student ${partial.studentNumber}`,
    sectionId: 'sec-1',
    sectionName: partial.sectionName ?? 'P5 Diamond',
    formClassAdviser: 'Ms. Tan',
    enrollmentStatus: partial.enrollmentStatus ?? 'active',
    indexNumber: partial.indexNumber ?? 1,
    subjectRows: partial.subjectRows,
    generalAverage,
    overallAward,
    attendanceByTerm:
      partial.attendanceByTerm ??
      TERMS.map((t) => ({
        termId: t.id,
        schoolDays: 50,
        present: 50,
        late: 0,
      })),
    attendanceTotal: partial.attendanceTotal ?? {
      present: 200,
      late: 0,
      schoolDays: 200,
    },
    commentsByTerm: (partial.commentsByTerm ?? []).map((c) => ({
      submitted: true,
      ...c,
    })),
    lateEnrolleeTermNumber: partial.lateEnrolleeTermNumber ?? null,
  };
}

function buildPayload(): MasterfilePayload {
  const a = student({
    studentNumber: 'A001',
    fullName: 'Alpha, Ann',
    subjectRows: [
      examRow(MATH.id, [96, 96, 96, 96]),
      examRow(SCI.id, [96, 96, 96, 96]),
      nonExamRow(MUSIC.id, ['A', 'A', 'A', 'A']),
    ],
    commentsByTerm: [
      { termNumber: 1, text: 'Great term.' },
      { termNumber: 2, text: 'Keep going.' },
      { termNumber: 3, text: 'Excellent.' },
    ],
  });

  const b = student({
    studentNumber: 'B002',
    fullName: 'Beta, Bob',
    subjectRows: [
      examRow(MATH.id, [89, 89, 89, 89]),
      examRow(SCI.id, [89, 89, 89, 75]),
      nonExamRow(MUSIC.id, ['B', 'B', 'B', 'B']),
    ],
    commentsByTerm: [{ termNumber: 1, text: 'Needs focus.' }], // T2,T3 blank
  });

  // C — incomplete (T3 math + music missing), no number to exercise null path,
  // no comments → 3 missing comment terms.
  const c = student({
    studentNumber: 'C003',
    fullName: 'Gamma, Gail',
    subjectRows: [
      examRow(MATH.id, [80, 80, null, 80]),
      examRow(SCI.id, [80, 80, 80, 80]),
      nonExamRow(MUSIC.id, ['C', 'C', null, 'C']),
    ],
    commentsByTerm: [],
  });

  // D — all-null quarterly grades across both examinable subjects → null GA
  // (unbucketed in the GA spread) AND examinable overalls are null → not
  // gradable → part of the Full-results gap. Has examinable rows (exercises the
  // "incomplete-but-has-rows" branch with every cell blank).
  const d = student({
    studentNumber: 'D004',
    fullName: 'Delta, Dan',
    subjectRows: [
      examRow(MATH.id, [null, null, null, null]),
      examRow(SCI.id, [null, null, null, null]),
      nonExamRow(MUSIC.id, [null, null, null, null]),
    ],
    commentsByTerm: [],
  });

  // E — NO examinable subject rows at all (e.g. a late enrollee with only a
  // non-examinable subject so far). null GA, not gradable → part of the
  // Full-results gap; exercises the zero-exam-row branch (Fix 2).
  const e = student({
    studentNumber: 'E005',
    fullName: 'Epsilon, Eve',
    enrollmentStatus: 'late_enrollee',
    subjectRows: [nonExamRow(MUSIC.id, [null, null, null, null])],
    commentsByTerm: [],
  });

  return {
    ayCode: 'AY9999',
    level: { id: 'lvl-p5', code: 'P5', label: 'Primary 5' },
    subjects: [MATH, SCI, MUSIC],
    terms: TERMS,
    sections: [{ id: 'sec-1', name: 'P5 Diamond' }],
    selectedSectionIds: ['sec-1'],
    rows: [a, b, c, d, e],
    sheets: [
      ...[MATH.id, SCI.id, MUSIC.id].flatMap((subjectId) =>
        TERMS.map((t) => ({
          id: `sh-${subjectId}-${t.id}`,
          subjectId,
          termId: t.id,
          sectionId: 'sec-1',
          isLocked: !(subjectId === MUSIC.id && t.id === 't4'),
        }))
      ),
    ],
    thresholds: THRESHOLDS,
  };
}

describe('buildMasterfileDrillRows — count == drill parity', () => {
  it('award drill row count equals each donut tier count', () => {
    const payload = buildPayload();
    const d = computeMasterfileDashboard(payload, ALL_FILTERS);
    const t = d.outcomes.awardTierCounts;
    const tiers = [
      ['gold', t.gold],
      ['silver', t.silver],
      ['bronze', t.bronze],
      ['notEligible', t.notEligible],
    ] as const;
    for (const [tier, count] of tiers) {
      const r = buildMasterfileDrillRows(payload, ALL_FILTERS, {
        kind: 'award',
        tier,
      });
      expect(r.rows.length).toBe(count);
    }
    // Total covers the whole roster.
    expect(t.gold + t.silver + t.bronze + t.notEligible).toBe(
      payload.rows.length
    );
  });

  it('ga-band drill row count equals each GA bucket count', () => {
    const payload = buildPayload();
    const d = computeMasterfileDashboard(payload, ALL_FILTERS);
    for (const b of d.outcomes.gaBuckets) {
      const r = buildMasterfileDrillRows(payload, ALL_FILTERS, {
        kind: 'ga-band',
        tier: b.tier,
      });
      expect(r.rows.length).toBe(b.count);
    }
  });

  it('null-GA students are in NO GA band (sum of buckets < roster)', () => {
    const payload = buildPayload();
    const d = computeMasterfileDashboard(payload, ALL_FILTERS);
    const bandTotal = d.outcomes.gaBuckets.reduce((s, b) => s + b.count, 0);
    // C (null math overall), D (all-null), E (no exam rows) all have a null GA →
    // unbucketed. Only A + B are bucketed.
    expect(bandTotal).toBe(2);
    expect(bandTotal).toBeLessThan(payload.rows.length);
  });

  it('needs-data unlocked-sheets drill row count equals the group count (1 row per sheet)', () => {
    const payload = buildPayload();
    const d = computeMasterfileDashboard(payload, ALL_FILTERS);
    const groups = d.watchlists.needsData.filter((i) =>
      i.groupKey.startsWith('unlocked-sheets:')
    );
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      const r = buildMasterfileDrillRows(payload, ALL_FILTERS, {
        kind: 'needs-data',
        groupKey: g.groupKey,
      });
      expect(r.rows.length).toBe(g.count);
    }
  });

  it('needs-data missing-grades drill: sum of per-student cell counts equals the group count', () => {
    const payload = buildPayload();
    const d = computeMasterfileDashboard(payload, ALL_FILTERS);
    const groups = d.watchlists.needsData.filter((i) =>
      i.groupKey.startsWith('missing-grades:')
    );
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      const subjectId = g.groupKey.slice('missing-grades:'.length);
      const subjects = subjectsInScope(payload, ALL_FILTERS).filter(
        (s) => s.id === subjectId
      );
      const termIdx = termIndicesInScope(payload, null);
      // The drill produces 1 row per student; the group count is cells. The
      // invariant: summing each row's missing-cell count == group cell count.
      const sumCells = enrolledScopeRows(payload, ALL_FILTERS).reduce(
        (acc, r) =>
          acc + studentHasMissingGradeInScope(r, subjects, termIdx).count,
        0
      );
      expect(sumCells).toBe(g.count);
      // And the drill returns one row per student that has any missing cell.
      const r = buildMasterfileDrillRows(payload, ALL_FILTERS, {
        kind: 'needs-data',
        groupKey: g.groupKey,
      });
      const studentsShort = enrolledScopeRows(payload, ALL_FILTERS).filter(
        (row) =>
          studentHasMissingGradeInScope(row, subjects, termIdx).hasMissing
      ).length;
      expect(r.rows.length).toBe(studentsShort);
    }
  });

  it('needs-data missing-comments drill: sum of blank-term counts equals the group count', () => {
    const payload = buildPayload();
    const d = computeMasterfileDashboard(payload, ALL_FILTERS);
    const group = d.watchlists.needsData.find(
      (i) => i.groupKey === 'missing-comments'
    );
    expect(group).toBeDefined();
    const commentTerms = commentTermsInScope(payload, null);
    const sumBlank = enrolledScopeRows(payload, ALL_FILTERS).reduce(
      (acc, r) => acc + studentMissingCommentTerms(r, commentTerms).length,
      0
    );
    expect(sumBlank).toBe(group!.count);
    const r = buildMasterfileDrillRows(payload, ALL_FILTERS, {
      kind: 'needs-data',
      groupKey: 'missing-comments',
    });
    // B (2 blank) + C (3 blank) + D (3 blank) + E (3 blank) → 4 students.
    expect(r.rows.length).toBe(4);
  });
});

describe('buildMasterfileDrillRows — completeness card drills', () => {
  it('missing-grades card drill lists exactly the students with any missing cell', () => {
    const payload = buildPayload();
    const r = buildMasterfileDrillRows(payload, ALL_FILTERS, {
      kind: 'missing-grades',
    });
    // C is missing math T3 (music is non-examinable but still a counted cell in
    // the all-subjects scope) and D has every math+sci cell blank. E has no
    // examinable rows but still has the all-null music row. Sorted by name.
    expect(r.rows.map((row) => row.studentName)).toEqual([
      'Delta, Dan',
      'Epsilon, Eve',
      'Gamma, Gail',
    ]);
    // Gamma is the one with exactly 2 missing cells (math T3 + music T3).
    const gamma = r.rows.find((row) => row.studentName === 'Gamma, Gail');
    expect(gamma?.stat).toContain('2');
  });

  it('missing-comments card drill lists students with a blank T1–T3 write-up', () => {
    const payload = buildPayload();
    const r = buildMasterfileDrillRows(payload, ALL_FILTERS, {
      kind: 'missing-comments',
    });
    // B (T2,T3 blank) + C, D, E (all blank). A has all 3.
    expect(r.rows.map((row) => row.studentNumber).sort()).toEqual([
      'B002',
      'C003',
      'D004',
      'E005',
    ]);
  });

  it('incomplete-results card drill equals the card gap (rosterCount − gradableCount) for both branches', () => {
    const payload = buildPayload();
    const d = computeMasterfileDashboard(payload, ALL_FILTERS);
    const r = buildMasterfileDrillRows(payload, ALL_FILTERS, {
      kind: 'incomplete-results',
    });
    // Roster = A,B,C,D,E. Gradable = A,B (complete examinable overalls).
    // Gap = C (null math overall, has rows), D (all-null overalls, has rows),
    // E (zero examinable rows → not gradable, Fix 2). → 3 incomplete.
    const incomplete = d.readiness.rosterCount - d.readiness.gradableCount;
    expect(incomplete).toBe(3);
    expect(r.rows.length).toBe(incomplete);
    // Both an incomplete-but-has-rows student (C/D) and a no-rows-at-all student
    // (E) reconcile with the card gap.
    expect(r.rows.map((row) => row.studentNumber).sort()).toEqual([
      'C003',
      'D004',
      'E005',
    ]);
    // The zero-exam-row student carries the explicit "no results yet" stat.
    const eve = r.rows.find((row) => row.studentNumber === 'E005');
    expect(eve?.stat).toBe('No examinable results yet');
  });
});

describe('buildMasterfileDrillRows — null student number + filters', () => {
  it('renders a row with null studentNumber as plain text (no link target)', () => {
    const payload = buildPayload();
    // Strip C's number to exercise the null path.
    payload.rows[2].studentNumber = '';
    const r = buildMasterfileDrillRows(payload, ALL_FILTERS, {
      kind: 'incomplete-results',
    });
    const row = r.rows.find((x) => x.studentName === 'Gamma, Gail');
    expect(row).toBeDefined();
    expect(row!.studentNumber).toBeNull();
  });

  it('Term filter narrows the award/incomplete drill to that term', () => {
    const payload = buildPayload();
    const t3: MasterfileDashboardFilters = {
      termNumber: 3,
      status: 'all',
      subjectId: null,
    };
    // In T3, C (math + music blank), D (all blank), and E (music blank) each
    // have at least one blank cell; A + B are fully filled. Sorted by name.
    const r = buildMasterfileDrillRows(payload, t3, { kind: 'missing-grades' });
    expect(r.rows.map((row) => row.studentName)).toEqual([
      'Delta, Dan',
      'Epsilon, Eve',
      'Gamma, Gail',
    ]);
  });

  it('Status filter narrows the cohort (award drill)', () => {
    const payload = buildPayload();
    payload.rows[2].enrollmentStatus = 'withdrawn';
    const active: MasterfileDashboardFilters = {
      termNumber: null,
      status: 'active',
      subjectId: null,
    };
    const d = computeMasterfileDashboard(payload, active);
    const gold = buildMasterfileDrillRows(payload, active, {
      kind: 'award',
      tier: 'gold',
    });
    expect(gold.rows.length).toBe(d.outcomes.awardTierCounts.gold);
    // C (withdrawn) excluded from the active scope.
    const all = buildMasterfileDrillRows(payload, active, {
      kind: 'award',
      tier: 'notEligible',
    });
    expect(all.rows.every((row) => row.status !== 'Withdrawn')).toBe(true);
  });
});
