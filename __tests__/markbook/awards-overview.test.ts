import { describe, expect, it } from 'vitest';

import { DEFAULT_AWARD_THRESHOLDS } from '@/lib/compute/awards';
import {
  AWARD_PERIOD_TERMS,
  bandFor,
  computeAwardsOverview,
  distanceToNextBand,
  NEAR_BAND_POINTS,
  NO_AWARD_FILTERS,
  OVERALL_CATEGORY,
  tierTotal,
  type AwardsOverviewInput,
} from '@/lib/markbook/awards-overview-compute';
import type { OverviewGradeInput } from '@/lib/markbook/academic-overview-compute';

// School-wide Awards aggregates.
//
// The fixture mirrors production's actual shape (AY2026 as of 2026-08-18):
// FOUR term rows configured but only two of them marked, which is why no award
// can settle and every headline is a standing rather than a tier.

const T = [1, 2, 3, 4].map((n) => ({
  id: `t${n}`,
  termNumber: n,
  label: `Term ${n}`,
  startDate: null,
  endDate: null,
  isCurrent: false,
}));

const P1 = { id: 'p1', code: 'P1', label: 'Primary One', sortOrder: 1 };
const P2 = { id: 'p2', code: 'P2', label: 'Primary Two', sortOrder: 2 };

const MATH = { id: 'math', name: 'Mathematics', isExaminable: true };
const ENG = { id: 'eng', name: 'English', isExaminable: true };
/** Writes a transmuted numeric grade through the same pipeline (KD #104). */
const MUSIC = { id: 'music', name: 'Music', isExaminable: false };

function grade(
  termNumber: number,
  subjectId: string,
  levelId: string,
  studentId: string,
  quarterly: number | null,
  isNa = false
): OverviewGradeInput {
  return {
    termId: `t${termNumber}`,
    subjectId,
    levelId,
    studentId,
    sectionId: `${levelId}-a`,
    quarterly,
    isNa,
  };
}

/** Every term of the year marked for one student in one subject. */
function fullYear(
  subjectId: string,
  levelId: string,
  studentId: string,
  score: number
): OverviewGradeInput[] {
  return [1, 2, 3, 4].map((n) =>
    grade(n, subjectId, levelId, studentId, score)
  );
}

function baseInput(
  overrides: Partial<AwardsOverviewInput> = {}
): AwardsOverviewInput {
  return {
    ayCode: 'AY2026',
    terms: T,
    levels: [P1, P2],
    subjects: [MATH, ENG, MUSIC],
    sections: [
      { id: 'p1-a', name: 'P1 - Rose', levelId: 'p1' },
      { id: 'p2-a', name: 'P2 - Lily', levelId: 'p2' },
    ],
    students: [
      { id: 's1', studentNumber: 'S1', fullName: 'ALPHA, Ana' },
      { id: 's2', studentNumber: 'S2', fullName: 'BRAVO, Ben' },
      { id: 's3', studentNumber: 'S3', fullName: 'CHARLIE, Cara' },
    ],
    grades: [],
    enrolledStudentIds: ['s1', 's2', 's3'],
    thresholds: DEFAULT_AWARD_THRESHOLDS,
    ...overrides,
  };
}

describe('the award ladder', () => {
  const t = DEFAULT_AWARD_THRESHOLDS;

  it('bands a score exactly where lib/compute/awards does', () => {
    expect(bandFor(88.4, t)).toBe('none');
    expect(bandFor(88.5, t)).toBe('bronze');
    expect(bandFor(91.4, t)).toBe('bronze');
    expect(bandFor(91.5, t)).toBe('silver');
    expect(bandFor(95.4, t)).toBe('silver');
    expect(bandFor(95.5, t)).toBe('gold');
    expect(bandFor(100, t)).toBe('gold');
  });

  it('measures the distance to the next rung up, not to the one below', () => {
    expect(distanceToNextBand(88.0, t)).toEqual({
      points: 0.5,
      band: 'bronze',
    });
    expect(distanceToNextBand(91.2, t)).toEqual({
      points: 0.3,
      band: 'silver',
    });
    expect(distanceToNextBand(95.1, t)).toEqual({ points: 0.4, band: 'gold' });
  });

  it('reports no distance at Gold, because there is nothing above it', () => {
    expect(distanceToNextBand(96.0, t)).toBeNull();
  });
});

describe('standing versus the settled award', () => {
  it('withholds the award while any term is unmarked, but still reports a standing', () => {
    // Production's shape: two of four terms marked.
    const overview = computeAwardsOverview(
      baseInput({
        grades: [
          grade(1, 'math', 'p1', 's1', 96),
          grade(2, 'math', 'p1', 's1', 96),
        ],
      })
    );
    const row = overview.students[0];
    expect(row.standing).toBe('gold');
    expect(row.official).toBeNull();
    expect(row.termsCounted).toBe(2);
    expect(overview.coverage.complete).toBe(false);
    expect(overview.coverage.termsMarked).toBe(2);
    expect(overview.coverage.termsTotal).toBe(4);
  });

  it('settles the award once every term is marked', () => {
    const overview = computeAwardsOverview(
      baseInput({ grades: fullYear('math', 'p1', 's1', 96) })
    );
    expect(overview.coverage.complete).toBe(true);
    expect(overview.students[0].official).toBe('gold');
    expect(overview.students[0].standing).toBe('gold');
  });

  it('settles a real "not eligible" rather than leaving it blank', () => {
    // 80 is a decided outcome once the year is complete, not missing data.
    const overview = computeAwardsOverview(
      baseInput({ grades: fullYear('math', 'p1', 's1', 80) })
    );
    expect(overview.students[0].official).toBe('none');
  });

  it('does not settle the year early when a term row is missing', () => {
    // ⚠ THE BUG THIS TEST EXISTS FOR. Production AY2026 has only three term
    // rows configured — the Term 4 row was never created. Counting "every
    // term" as `terms.length` made the year look finished after Term 3 and
    // declared 372 official awards in August. A missing row is missing DATA.
    const overview = computeAwardsOverview(
      baseInput({
        terms: T.slice(0, 3),
        grades: [1, 2, 3].map((n) => grade(n, 'math', 'p1', 's1', 96)),
      })
    );
    expect(overview.coverage.termsTotal).toBe(AWARD_PERIOD_TERMS);
    expect(overview.coverage.termsMarked).toBe(3);
    expect(overview.coverage.complete).toBe(false);
    expect(overview.students[0].official).toBeNull();
    expect(overview.students[0].standing).toBe('gold');
  });

  it('never settles an award for a single term, however complete that term is', () => {
    // One term is not an award period, so narrowing to Term 1 must not mint one.
    const overview = computeAwardsOverview(
      baseInput({
        grades: fullYear('math', 'p1', 's1', 96),
        filters: { ...NO_AWARD_FILTERS, termNumber: 1 },
      })
    );
    expect(overview.coverage.complete).toBe(false);
    expect(overview.students[0].official).toBeNull();
    expect(overview.students[0].standing).toBe('gold');
  });

  it('gives a withdrawn student no award even with a full year of marks', () => {
    const overview = computeAwardsOverview(
      baseInput({
        grades: fullYear('math', 'p1', 's1', 96),
        enrolledStudentIds: [],
      })
    );
    expect(overview.students[0].official).toBeNull();
    // Standing is a reading of marks, so it still describes them.
    expect(overview.students[0].standing).toBe('gold');
  });
});

describe('what counts toward a score', () => {
  it('leaves non-examinable subjects out of the overall award', () => {
    // Music at 50 would drag a 96 average to 73 if it counted.
    const overview = computeAwardsOverview(
      baseInput({
        grades: [
          grade(1, 'math', 'p1', 's1', 96),
          grade(1, 'music', 'p1', 's1', 50),
        ],
      })
    );
    expect(overview.students[0].score).toBe(96);
  });

  it('leaves N.A. cells out entirely', () => {
    const overview = computeAwardsOverview(
      baseInput({
        grades: [
          grade(1, 'math', 'p1', 's1', 96),
          grade(1, 'eng', 'p1', 's1', 40, true),
        ],
      })
    );
    expect(overview.students[0].score).toBe(96);
  });

  it('averages subjects evenly, not marks — two terms of one subject is one subject', () => {
    // Maths 90 across two terms, English 80 in one. The subject means are 90
    // and 80, so the overall is 85 — not the 86.7 a straight mark average gives.
    const overview = computeAwardsOverview(
      baseInput({
        grades: [
          grade(1, 'math', 'p1', 's1', 90),
          grade(2, 'math', 'p1', 's1', 90),
          grade(1, 'eng', 'p1', 's1', 80),
        ],
      })
    );
    expect(overview.students[0].score).toBe(85);
  });
});

describe('award category', () => {
  it('reads one subject alone when a subject category is chosen', () => {
    const grades = [
      grade(1, 'math', 'p1', 's1', 96),
      grade(1, 'eng', 'p1', 's1', 80),
    ];
    const overall = computeAwardsOverview(baseInput({ grades }));
    expect(overall.students[0].score).toBe(88);
    expect(overall.categoryLabel).toBe('Overall Academic Award');

    const maths = computeAwardsOverview(
      baseInput({ grades, filters: { ...NO_AWARD_FILTERS, category: 'math' } })
    );
    expect(maths.students[0].score).toBe(96);
    expect(maths.categoryLabel).toBe('Mathematics Award');
  });

  it('offers overall plus every examinable subject actually taught', () => {
    const overview = computeAwardsOverview(
      baseInput({
        grades: [
          grade(1, 'math', 'p1', 's1', 90),
          grade(1, 'music', 'p1', 's1', 90),
        ],
      })
    );
    // English is configured but untaught; Music is taught but not examinable.
    expect(overview.filterOptions.categories.map((c) => c.id)).toEqual([
      OVERALL_CATEGORY,
      'math',
    ]);
  });
});

describe('within reach', () => {
  it('counts students within a point below a boundary, per band', () => {
    const overview = computeAwardsOverview(
      baseInput({
        grades: [
          grade(1, 'math', 'p1', 's1', 88), // 0.5 off Bronze
          grade(1, 'math', 'p1', 's2', 91), // 0.5 off Silver
          grade(1, 'math', 'p2', 's3', 80), // 8.5 off — not near
        ],
      })
    );
    expect(overview.withinReach).toEqual({
      bronze: 1,
      silver: 1,
      gold: 0,
      total: 2,
    });
  });

  it('excludes a student exactly on a boundary — they are already in the band', () => {
    const overview = computeAwardsOverview(
      baseInput({ grades: [grade(1, 'math', 'p1', 's1', 88.5)] })
    );
    expect(overview.students[0].standing).toBe('bronze');
    expect(overview.withinReach.total).toBe(0);
  });

  it('uses one named cut-off, so the page and the tests cannot drift', () => {
    expect(NEAR_BAND_POINTS).toBe(1.0);
  });

  it('lists the closest to moving up first, and Gold last', () => {
    const overview = computeAwardsOverview(
      baseInput({
        grades: [
          grade(1, 'math', 'p1', 's1', 96), // Gold — nowhere to go
          grade(1, 'math', 'p1', 's2', 88.4), // 0.1 off Bronze
          grade(1, 'math', 'p2', 's3', 91.0), // 0.5 off Silver
        ],
      })
    );
    expect(overview.students.map((r) => r.studentNumber)).toEqual([
      'S2',
      'S3',
      'S1',
    ]);
  });
});

describe('the level ladder', () => {
  it('follows school order, not a ranking', () => {
    const overview = computeAwardsOverview(
      baseInput({
        grades: [
          grade(1, 'math', 'p2', 's3', 96),
          grade(1, 'math', 'p1', 's1', 70),
        ],
      })
    );
    expect(overview.levels.map((l) => l.levelLabel)).toEqual([
      'Primary One',
      'Primary Two',
    ]);
  });

  it('sums to the school totals, counting each student exactly once', () => {
    const overview = computeAwardsOverview(
      baseInput({
        grades: [
          grade(1, 'math', 'p1', 's1', 96),
          grade(1, 'eng', 'p1', 's1', 96),
          grade(1, 'math', 'p1', 's2', 89),
          grade(1, 'math', 'p2', 's3', 70),
        ],
      })
    );
    const summed = overview.levels.reduce((n, l) => n + tierTotal(l.tiers), 0);
    expect(summed).toBe(tierTotal(overview.tiers));
    expect(summed).toBe(overview.coverage.studentsWithMarks);
  });

  it('leaves out a level with nobody marked rather than showing a row of zeros', () => {
    const overview = computeAwardsOverview(
      baseInput({ grades: [grade(1, 'math', 'p1', 's1', 96)] })
    );
    expect(overview.levels).toHaveLength(1);
    expect(overview.levels[0].levelId).toBe('p1');
  });

  it('places a student who transferred level by where they are now', () => {
    const overview = computeAwardsOverview(
      baseInput({
        grades: [
          grade(1, 'math', 'p1', 's1', 96),
          grade(2, 'math', 'p2', 's1', 96),
        ],
      })
    );
    expect(overview.levels).toHaveLength(1);
    expect(overview.levels[0].levelId).toBe('p2');
    expect(overview.coverage.studentsWithMarks).toBe(1);
  });
});

describe('narrowing', () => {
  it('narrows by level and by class, and says what it narrowed to', () => {
    const grades = [
      grade(1, 'math', 'p1', 's1', 96),
      grade(1, 'math', 'p2', 's3', 70),
    ];
    const byLevel = computeAwardsOverview(
      baseInput({ grades, filters: { ...NO_AWARD_FILTERS, levelId: 'p2' } })
    );
    expect(byLevel.coverage.studentsWithMarks).toBe(1);
    expect(byLevel.scopeLabel).toBe('Primary Two');

    const byClass = computeAwardsOverview(
      baseInput({ grades, filters: { ...NO_AWARD_FILTERS, sectionId: 'p1-a' } })
    );
    expect(byClass.students[0].studentNumber).toBe('S1');
    expect(byClass.scopeLabel).toBe('P1 - Rose');
  });

  it('reports nothing rather than zero when the scope is empty', () => {
    const overview = computeAwardsOverview(baseInput({ grades: [] }));
    expect(overview.coverage.studentsWithMarks).toBe(0);
    expect(overview.range).toBeNull();
    expect(overview.levels).toEqual([]);
    expect(tierTotal(overview.tiers)).toBe(0);
  });

  it('reports the score range for the distribution axis', () => {
    const overview = computeAwardsOverview(
      baseInput({
        grades: [
          grade(1, 'math', 'p1', 's1', 96),
          grade(1, 'math', 'p1', 's2', 70),
        ],
      })
    );
    expect(overview.range).toEqual({ min: 70, max: 96 });
  });
});
