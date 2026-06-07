import { describe, expect, it } from 'vitest';

import {
  computeMasterfileDashboard,
  type MasterfileDashboardFilters,
} from '@/lib/markbook/masterfile-dashboard';
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

// Cohort-aggregate unit tests for the Masterfile dashboard (KD #95).
// Builds a tiny but realistic fixture (2 examinable + 1 non-exam subject,
// 4 terms, 3 students of varying completeness) and asserts the readiness
// counts, award buckets, GA bucketing, subject averages, and watchlists.

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

const THRESHOLDS = DEFAULT_AWARD_THRESHOLDS; // bronze 88.5 / silver 91.5 / gold 95.5

function cell(
  quarterly: number | null,
  opts?: Partial<MasterfileCell>
): MasterfileCell {
  return { quarterly, letter: null, isNa: false, ...opts };
}

// Build an examinable subject row from 4 quarterly grades, computing overall +
// award the way the loader does.
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
    sectionName: 'P5 Diamond',
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
  // Student A — complete, high → Gold-ish.
  const a = student({
    studentNumber: 'A001',
    fullName: 'Alpha, Ann',
    subjectRows: [
      examRow(MATH.id, [96, 96, 96, 96]), // overall 96 → Gold
      examRow(SCI.id, [96, 96, 96, 96]),
      nonExamRow(MUSIC.id, ['A', 'A', 'A', 'A']),
    ],
    commentsByTerm: [
      { termNumber: 1, text: 'Great term.' },
      { termNumber: 2, text: 'Keep going.' },
      { termNumber: 3, text: 'Excellent.' },
    ],
  });

  // Student B — complete, middling → Bronze; low Science term to trigger watch.
  const b = student({
    studentNumber: 'B002',
    fullName: 'Beta, Bob',
    subjectRows: [
      examRow(MATH.id, [89, 89, 89, 89]), // overall 89
      examRow(SCI.id, [89, 89, 89, 75]), // a term below 80 → needs-attention
      nonExamRow(MUSIC.id, ['B', 'B', 'B', 'B']),
    ],
    // Low attendance to trigger the attendance flag.
    attendanceByTerm: TERMS.map((t) => ({
      termId: t.id,
      schoolDays: 50,
      present: 40,
      late: 5,
    })),
    attendanceTotal: { present: 160, late: 20, schoolDays: 200 },
    commentsByTerm: [{ termNumber: 1, text: 'Needs focus.' }], // T2,T3 blank
  });

  // Student C — incomplete (T3 math missing) → GA pending, not gradable;
  // contributes a missing grade cell + a missing comment.
  const c = student({
    studentNumber: 'C003',
    fullName: 'Gamma, Gail',
    subjectRows: [
      examRow(MATH.id, [80, 80, null, 80]), // overall null → pending
      examRow(SCI.id, [80, 80, 80, 80]),
      nonExamRow(MUSIC.id, ['C', 'C', null, 'C']), // one blank cell
    ],
    commentsByTerm: [], // all comments blank
  });

  return {
    ayCode: 'AY9999',
    level: { id: 'lvl-p5', code: 'P5', label: 'Primary 5' },
    subjects: [MATH, SCI, MUSIC],
    terms: TERMS,
    sections: [{ id: 'sec-1', name: 'P5 Diamond' }],
    selectedSectionIds: ['sec-1'],
    rows: [a, b, c],
    sheets: [
      // 3 subjects × 4 terms = 12 sheets; lock all of A/B-relevant exam ones,
      // leave one non-exam sheet unlocked to exercise the lock count.
      ...[MATH.id, SCI.id, MUSIC.id].flatMap((subjectId) =>
        TERMS.map((t) => ({
          id: `sh-${subjectId}-${t.id}`,
          subjectId,
          termId: t.id,
          sectionId: 'sec-1',
          isLocked: !(subjectId === MUSIC.id && t.id === 't4'), // one unlocked
        }))
      ),
    ],
    thresholds: THRESHOLDS,
  };
}

describe('computeMasterfileDashboard — defensive / empty payload', () => {
  it('does not throw on a fully-empty payload and returns zeroed aggregates', () => {
    const empty: MasterfilePayload = {
      ayCode: 'AY9999',
      level: { id: 'lvl', code: 'P5', label: 'Primary 5' },
      subjects: [],
      terms: [],
      sections: [],
      selectedSectionIds: [],
      rows: [],
      sheets: [],
      thresholds: THRESHOLDS,
    };
    const d = computeMasterfileDashboard(empty);
    expect(d.readiness.gradesEntered.done).toBe(0);
    expect(d.readiness.gradesEntered.expected).toBe(0);
    expect(d.readiness.gradesEntered.pct).toBeNull();
    expect(d.readiness.sheetsLocked.expected).toBe(0);
    expect(d.readiness.commentsWritten.expected).toBe(0);
    expect(d.readiness.attendanceRecorded.expected).toBe(0);
    expect(d.readiness.gradableCount).toBe(0);
    expect(d.readiness.rosterCount).toBe(0);
    expect(d.outcomes.awardTierCounts.gold).toBe(0);
    expect(d.outcomes.subjectAverages).toHaveLength(0);
    expect(d.outcomes.attendance.schoolDays).toBe(0);
    expect(d.watchlists.needsData).toHaveLength(0);
    expect(d.watchlists.needsAttention).toHaveLength(0);
  });

  it('does not throw when payload arrays are missing entirely (partial shape)', () => {
    // Simulate a stale cached / partial payload that omits arrays — must not
    // crash with "Cannot read properties of undefined (reading 'filter')".
    const partial = {
      ayCode: 'AY9999',
      level: { id: 'lvl', code: 'P5', label: 'Primary 5' },
      thresholds: THRESHOLDS,
    } as unknown as MasterfilePayload;
    expect(() => computeMasterfileDashboard(partial)).not.toThrow();
    const d = computeMasterfileDashboard(partial);
    expect(d.readiness.rosterCount).toBe(0);
    expect(d.outcomes.subjectAverages).toHaveLength(0);
  });

  it('marks gradable as not-applicable when the Subject filter is non-examinable', () => {
    const d = computeMasterfileDashboard(buildPayload(), {
      termNumber: null,
      status: 'all',
      subjectId: MUSIC.id,
    });
    // No examinable subject in scope → not a "0 / N" deficit, but pending.
    expect(d.readiness.gradableApplicable).toBe(false);
    expect(d.readiness.gradableCount).toBe(0);
    expect(d.readiness.rosterCount).toBe(0);
  });
});

describe('computeMasterfileDashboard — readiness', () => {
  it('counts filled grade cells vs roster × subjects × terms', () => {
    const d = computeMasterfileDashboard(buildPayload());
    // 3 students × 3 subjects × 4 terms = 36 expected cells.
    expect(d.readiness.gradesEntered.expected).toBe(36);
    // Only C is missing two cells (math T3 + music T3) → 34 filled.
    expect(d.readiness.gradesEntered.done).toBe(34);
  });

  it('counts locked grading sheets', () => {
    const d = computeMasterfileDashboard(buildPayload());
    // 12 sheets, 1 unlocked (Music T4).
    expect(d.readiness.sheetsLocked.expected).toBe(12);
    expect(d.readiness.sheetsLocked.done).toBe(11);
  });

  it('counts FCA comments T1–T3 vs roster', () => {
    const d = computeMasterfileDashboard(buildPayload());
    // 3 students × 3 comment terms = 9 expected.
    expect(d.readiness.commentsWritten.expected).toBe(9);
    // A has 3, B has 1, C has 0 → 4 written.
    expect(d.readiness.commentsWritten.done).toBe(4);
  });

  it('counts gradable students (complete examinable data)', () => {
    const d = computeMasterfileDashboard(buildPayload());
    // A + B complete; C has a null math overall → 2 gradable.
    expect(d.readiness.gradableCount).toBe(2);
    expect(d.readiness.rosterCount).toBe(3);
  });
});

describe('computeMasterfileDashboard — outcomes', () => {
  it('buckets award tiers including not-eligible', () => {
    const d = computeMasterfileDashboard(buildPayload());
    const t = d.outcomes.awardTierCounts;
    // A → Gold (GA 96). B → not eligible (Sci T4=75 drags Sci overall to 83.4,
    // GA 86.2 < 88.5). C → pending = not eligible. So gold 1, notEligible 2.
    expect(t.gold).toBe(1);
    expect(t.notEligible).toBe(2);
    expect(t.bronze).toBe(0);
    expect(t.silver).toBe(0);
  });

  it('buckets General Average against the award bands', () => {
    const d = computeMasterfileDashboard(buildPayload());
    const byTier = Object.fromEntries(
      d.outcomes.gaBuckets.map((b) => [b.tier, b.count])
    );
    // A GA 96 → gold; B GA 88 → below (88 < 88.5); C GA null → unbucketed.
    expect(byTier.gold).toBe(1);
    expect(byTier.below).toBe(1);
    expect(byTier.silver).toBe(0);
    expect(byTier.bronze).toBe(0);
  });

  it('computes examinable subject class averages, non-exam as null', () => {
    const d = computeMasterfileDashboard(buildPayload());
    const math = d.outcomes.subjectAverages.find(
      (s) => s.subjectId === MATH.id
    );
    const music = d.outcomes.subjectAverages.find(
      (s) => s.subjectId === MUSIC.id
    );
    // Math cells across all terms: A 96×4, B 89×4, C 80,80,(null),80 →
    // sum = 384 + 356 + 240 = 980 over 11 graded cells = 89.09 → 89.1.
    expect(math?.avg).toBeCloseTo(89.1, 1);
    expect(math?.sampleSize).toBe(11);
    expect(music?.avg).toBeNull();
  });

  it('computes attendance rates from term rollups', () => {
    const d = computeMasterfileDashboard(buildPayload());
    const a = d.outcomes.attendance;
    // A 200/200 present, B 160/200, C 200/200 → 560 present / 600 days.
    expect(a.schoolDays).toBe(600);
    expect(a.present).toBe(560);
    expect(a.presentRate).toBeCloseTo(93.3, 1);
  });
});

describe('computeMasterfileDashboard — watchlists', () => {
  it('groups needs-data by subject + workflow with counts', () => {
    const d = computeMasterfileDashboard(buildPayload());
    const byGroup = Object.fromEntries(
      d.watchlists.needsData.map((i) => [i.group, i.count])
    );
    // Missing grades: Math 1 (C T3), Music 1 (C T3).
    expect(byGroup['Mathematics']).toBe(1);
    expect(byGroup['Music']).toBeGreaterThanOrEqual(1);
    // Unlocked sheet: Music has 1 unlocked sheet (T4).
    // Missing comments: B missing 2 (T2,T3) + C missing 3 = 5.
    expect(byGroup['Form class adviser comments']).toBe(5);
  });

  it('flags students needing attention with reasons + studentNumber', () => {
    const d = computeMasterfileDashboard(buildPayload());
    const na = d.watchlists.needsAttention;
    // B has a sub grade < 80 (Sci T4 = 75) and low attendance (80%).
    const b = na.find((x) => x.studentNumber === 'B002');
    expect(b).toBeDefined();
    expect(b!.reason).toContain('Attendance');
    // The low-subject reason names the real subject, not its UUID.
    expect(b!.reason).toContain('Science');
    expect(b!.reason).not.toContain(SCI.id);
    // A is healthy — not flagged.
    expect(na.find((x) => x.studentNumber === 'A001')).toBeUndefined();
  });

  it('includes withdrawn rows in needs-data when Status filter = withdrawn', () => {
    const payload = buildPayload();
    // Make C withdrawn — C carries a missing math + music grade cell (T3).
    payload.rows[2].enrollmentStatus = 'withdrawn';
    const withdrawn = computeMasterfileDashboard(payload, {
      termNumber: null,
      status: 'withdrawn',
      subjectId: null,
    });
    // Readiness expects grades (C is the only withdrawn row), and the chase
    // list must NOT be empty — it should mirror readiness.
    expect(withdrawn.readiness.rosterCount).toBe(1);
    expect(withdrawn.readiness.gradesEntered.expected).toBeGreaterThan(0);
    expect(withdrawn.watchlists.needsData.length).toBeGreaterThan(0);
  });
});

describe('computeMasterfileDashboard — filters', () => {
  it('Term filter scopes readiness + subject averages to one term', () => {
    const filters: MasterfileDashboardFilters = {
      termNumber: 3,
      status: 'all',
      subjectId: null,
    };
    const d = computeMasterfileDashboard(buildPayload(), filters);
    // 3 students × 3 subjects × 1 term = 9 expected; C missing math+music T3 → 7.
    expect(d.readiness.gradesEntered.expected).toBe(9);
    expect(d.readiness.gradesEntered.done).toBe(7);
    // Comments T3 only → 3 expected (A has it, B/C don't) → 1 done.
    expect(d.readiness.commentsWritten.expected).toBe(3);
    expect(d.readiness.commentsWritten.done).toBe(1);
  });

  it('Status filter narrows the cohort', () => {
    const payload = buildPayload();
    payload.rows[2].enrollmentStatus = 'withdrawn';
    const d = computeMasterfileDashboard(payload, {
      termNumber: null,
      status: 'active',
      subjectId: null,
    });
    // Only A + B remain active. A → Gold, B → not eligible (GA 86.2).
    expect(d.readiness.rosterCount).toBe(2);
    expect(d.outcomes.awardTierCounts.gold).toBe(1);
    expect(d.outcomes.awardTierCounts.notEligible).toBe(1);
  });

  it('Subject filter scopes subject averages + grade counts', () => {
    const d = computeMasterfileDashboard(buildPayload(), {
      termNumber: null,
      status: 'all',
      subjectId: MATH.id,
    });
    expect(d.outcomes.subjectAverages).toHaveLength(1);
    expect(d.outcomes.subjectAverages[0].subjectId).toBe(MATH.id);
    // Only Math cells counted: 3 students × 4 terms = 12 expected, C missing 1 → 11.
    expect(d.readiness.gradesEntered.expected).toBe(12);
    expect(d.readiness.gradesEntered.done).toBe(11);
  });
});
