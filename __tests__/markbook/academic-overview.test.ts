import { describe, expect, it } from 'vitest';

import {
  bandTotal,
  buildOverviewHighlights,
  computeAcademicOverview,
  NO_FILTERS,
  resolveTermStatus,
  termElapsedPct,
  trendDirection,
  type AcademicOverviewInput,
  type OverviewGradeInput,
} from '@/lib/markbook/academic-overview-compute';
import {
  PASS_MARK,
  classifyGradeBucket,
  isPassingGrade,
} from '@/lib/markbook/drill-filter';

// School-wide Academic Overview aggregates.
//
// The fixture mirrors the shape production is actually in (AY2026 as of
// 2026-08-17): two completed terms, one still being taught, no Term 4 row at
// all, plus a non-examinable subject writing numeric grades and one student who
// transferred class mid-year.

const TODAY = '2026-08-17';

const T1 = {
  id: 't1',
  termNumber: 1,
  label: 'Term 1',
  startDate: '2026-01-08',
  endDate: '2026-03-13',
  isCurrent: false,
};
const T2 = {
  id: 't2',
  termNumber: 2,
  label: 'Term 2',
  startDate: '2026-03-24',
  endDate: '2026-05-28',
  isCurrent: false,
};
const T3 = {
  id: 't3',
  termNumber: 3,
  label: 'Term 3',
  startDate: '2026-06-29',
  endDate: '2026-09-04',
  isCurrent: false,
};

const P1 = { id: 'p1', code: 'P1', label: 'Primary One', sortOrder: 1 };
const P2 = { id: 'p2', code: 'P2', label: 'Primary Two', sortOrder: 2 };

const MATH = { id: 'math', name: 'Mathematics', isExaminable: true };
const ENG = { id: 'eng', name: 'English', isExaminable: true };
/** Writes a transmuted numeric grade through the same pipeline (KD #104). */
const MUSIC = { id: 'music', name: 'Music', isExaminable: false };

function grade(
  termId: string,
  subjectId: string,
  levelId: string,
  studentId: string,
  quarterly: number | null,
  isNa = false,
  sectionId = `${levelId}-a`
): OverviewGradeInput {
  return { termId, subjectId, levelId, studentId, sectionId, quarterly, isNa };
}

function baseInput(
  overrides: Partial<AcademicOverviewInput> = {}
): AcademicOverviewInput {
  return {
    ayCode: 'AY2026',
    today: TODAY,
    terms: [T1, T2, T3],
    levels: [P1, P2],
    subjects: [MATH, ENG, MUSIC],
    attendance: [],
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
    sectionCount: 2,
    subjectsTaught: 3,
    subjectsConfigured: 5,
    sheets: { total: 10, locked: 8 },
    ...overrides,
  };
}

describe('term status', () => {
  it('reads a finished term as completed and a running one as in progress', () => {
    expect(resolveTermStatus(T1, TODAY)).toBe('completed');
    expect(resolveTermStatus(T2, TODAY)).toBe('completed');
    expect(resolveTermStatus(T3, TODAY)).toBe('in_progress');
  });

  it('treats the last day of a term as still in progress', () => {
    expect(resolveTermStatus(T1, '2026-03-13')).toBe('in_progress');
    expect(resolveTermStatus(T1, '2026-03-14')).toBe('completed');
  });

  it('treats the first day of a term as in progress, and the day before as upcoming', () => {
    expect(resolveTermStatus(T3, '2026-06-29')).toBe('in_progress');
    expect(resolveTermStatus(T3, '2026-06-28')).toBe('upcoming');
  });

  it('never reports an undated term as completed', () => {
    const undated = { startDate: null, endDate: null };
    expect(resolveTermStatus(undated, TODAY)).toBe('upcoming');
  });

  it('measures how far through a running term today is', () => {
    expect(termElapsedPct(T3, '2026-06-29')).toBe(0);
    expect(termElapsedPct(T3, '2026-09-04')).toBe(100);
    expect(
      termElapsedPct({ startDate: null, endDate: null }, TODAY)
    ).toBeNull();
  });
});

describe('the pass mark', () => {
  it('is 75, derived from the band table rather than written twice', () => {
    expect(PASS_MARK).toBe(75);
  });

  it('counts exactly 75 as a pass and 74 as a fail', () => {
    expect(isPassingGrade(75)).toBe(true);
    expect(isPassingGrade(74)).toBe(false);
    expect(isPassingGrade(null)).toBe(false);
  });
});

describe('banding a fractional average', () => {
  // A stored mark is an integer, but a student's AVERAGE is not. The band
  // table's upper bounds are 74/79/84/89, so boundary averages used to fall
  // through into no band at all and the student disappeared from the spread.
  it('places an average that sits between two bands', () => {
    expect(classifyGradeBucket(89.5)).toBe('vs');
    expect(classifyGradeBucket(84.5)).toBe('s');
    expect(classifyGradeBucket(79.5)).toBe('fs');
    expect(classifyGradeBucket(74.5)).toBe('dnm');
  });

  it('still places whole marks exactly as before', () => {
    expect(classifyGradeBucket(90)).toBe('o');
    expect(classifyGradeBucket(89)).toBe('vs');
    expect(classifyGradeBucket(75)).toBe('fs');
    expect(classifyGradeBucket(74)).toBe('dnm');
    expect(classifyGradeBucket(0)).toBe('dnm');
    expect(classifyGradeBucket(null)).toBeNull();
  });

  it('never loses a student from the school-wide spread', () => {
    // Averages of 89.5 and 84.5 — both between bands under the old rule.
    const overview = computeAcademicOverview(
      baseInput({
        grades: [
          grade('t1', 'math', 'p1', 's1', 90),
          grade('t2', 'math', 'p1', 's1', 89),
          grade('t1', 'math', 'p1', 's2', 85),
          grade('t2', 'math', 'p1', 's2', 84),
        ],
      })
    );
    expect(overview.distribution.total).toBe(2);
    expect(bandTotal(overview.distribution.bands)).toBe(2);
    expect(overview.levels[0].students).toBe(
      bandTotal(overview.levels[0].bands)
    );
  });
});

describe('what counts as a grade', () => {
  it('leaves non-examinable subjects out of the average', () => {
    // Music would drag the average to 70 if it were counted.
    const overview = computeAcademicOverview(
      baseInput({
        grades: [
          grade('t1', 'math', 'p1', 's1', 90),
          grade('t1', 'music', 'p1', 's1', 50),
        ],
      })
    );
    expect(overview.kpis.average).toBe(90);
    expect(overview.subjects.map((s) => s.subjectName)).not.toContain('Music');
  });

  it('leaves N.A. cells out entirely', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: [
          grade('t1', 'math', 'p1', 's1', 90),
          grade('t1', 'eng', 'p1', 's1', 40, true),
        ],
      })
    );
    expect(overview.kpis.average).toBe(90);
  });

  it('leaves a term still being taught out of the school average', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: [
          grade('t1', 'math', 'p1', 's1', 90),
          // Term 3 is in progress; a lone 40 must not move the headline.
          grade('t3', 'math', 'p1', 's1', 40),
        ],
      })
    );
    expect(overview.kpis.average).toBe(90);
  });
});

describe('per-term rows', () => {
  it('withholds an average for a term barely marked, but still reports the count', () => {
    // 10 students have grades; 1 has anything in the in-progress term (10%).
    // This is the production shape: 1 of 371 marked while Term 3 is running.
    const cohort = Array.from({ length: 10 }, (_, i) => `s${i + 1}`);
    const grades = cohort.map((s) => grade('t1', 'math', 'p1', s, 80));
    grades.push(grade('t3', 'math', 'p1', 's1', 81));

    const overview = computeAcademicOverview(baseInput({ grades }));
    const t3 = overview.terms.find((t) => t.termNumber === 3)!;
    expect(t3.status).toBe('in_progress');
    expect(t3.average).toBeNull();
    expect(t3.passingRate).toBeNull();
    // The count is never hidden — the dash is about the summary, not the fact.
    expect(t3.studentsGraded).toBe(1);
  });

  it('reports a running term once a fifth of the school has been marked', () => {
    // Exactly at the threshold: 2 of 10 graded students. "At least a fifth"
    // includes the fifth itself, so this reports rather than dashes.
    const cohort = Array.from({ length: 10 }, (_, i) => `s${i + 1}`);
    const grades = cohort.map((s) => grade('t1', 'math', 'p1', s, 80));
    grades.push(grade('t3', 'math', 'p1', 's1', 90));
    grades.push(grade('t3', 'math', 'p1', 's2', 90));

    const overview = computeAcademicOverview(baseInput({ grades }));
    const t3 = overview.terms.find((t) => t.termNumber === 3)!;
    expect(t3.average).toBe(90);
    expect(t3.studentsGraded).toBe(2);
  });

  it('reports a term with no grades as null, never zero', () => {
    const overview = computeAcademicOverview(
      baseInput({ grades: [grade('t1', 'math', 'p1', 's1', 88)] })
    );
    const t2 = overview.terms.find((t) => t.termNumber === 2)!;
    expect(t2.average).toBeNull();
    expect(t2.passingRate).toBeNull();
    expect(t2.studentsGraded).toBe(0);
  });

  it('lists only the terms that exist — a missing Term 4 is not invented', () => {
    const overview = computeAcademicOverview(baseInput());
    expect(overview.terms.map((t) => t.termNumber)).toEqual([1, 2, 3]);
    expect(overview.termProgress.totalCount).toBe(3);
    expect(overview.termProgress.completedCount).toBe(2);
    expect(overview.termProgress.reportedRangeLabel).toBe('Term 1 – Term 2');
    expect(overview.termProgress.current?.termNumber).toBe(3);
  });
});

describe('students', () => {
  it('counts a student who changed class once, not twice', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: [
          // Same student, two enrolments' worth of marks across two levels.
          grade('t1', 'math', 'p1', 's1', 80),
          grade('t2', 'math', 'p2', 's1', 90),
        ],
      })
    );
    expect(overview.distribution.total).toBe(1);
    expect(bandTotal(overview.distribution.bands)).toBe(1);
    // Assigned to the level of their most recent term, so the bars still sum.
    const withStudents = overview.levels.filter((l) => l.students > 0);
    expect(withStudents).toHaveLength(1);
    expect(withStudents[0].levelLabel).toBe('Primary Two');
  });

  it('makes the grade-level bars add up to the school circle', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: [
          grade('t1', 'math', 'p1', 's1', 95),
          grade('t1', 'math', 'p1', 's2', 82),
          grade('t1', 'math', 'p2', 's3', 70),
        ],
      })
    );
    const summed = overview.levels.reduce((n, l) => n + bandTotal(l.bands), 0);
    expect(summed).toBe(overview.distribution.total);
    expect(summed).toBe(3);
  });

  it('reports how many enrolled students have no grades at all', () => {
    const overview = computeAcademicOverview(
      baseInput({
        enrolledStudentIds: ['s1', 's2', 's3'],
        grades: [grade('t1', 'math', 'p1', 's1', 88)],
      })
    );
    expect(overview.coverage.studentsEnrolled).toBe(3);
    expect(overview.coverage.studentsWithGrades).toBe(1);
    expect(overview.coverage.enrolledWithoutGrades).toBe(2);
  });

  it('keeps the marks of a student who has since withdrawn', () => {
    // s9 left mid-year, so is not in enrolledStudentIds — but the marks they
    // earned are still real (Hard Rule #6), so they stay in the spread. That
    // makes "students with grades" legitimately EXCEED "enrolled", which is
    // why the page never phrases coverage as "X of Y enrolled".
    const overview = computeAcademicOverview(
      baseInput({
        enrolledStudentIds: ['s1'],
        grades: [
          grade('t1', 'math', 'p1', 's1', 88),
          grade('t1', 'math', 'p1', 's9', 88),
        ],
      })
    );
    expect(overview.coverage.studentsEnrolled).toBe(1);
    expect(overview.coverage.studentsWithGrades).toBe(2);
    expect(overview.coverage.enrolledWithoutGrades).toBe(0);
    expect(overview.distribution.total).toBe(2);
  });
});

describe('bands and rates', () => {
  it('bands a student on their average, not on single marks', () => {
    // 100 and 80 average to 90 — Outstanding, though one mark is not.
    const overview = computeAcademicOverview(
      baseInput({
        grades: [
          grade('t1', 'math', 'p1', 's1', 100),
          grade('t2', 'math', 'p1', 's1', 80),
        ],
      })
    );
    expect(overview.distribution.bands.o).toBe(1);
    expect(overview.kpis.outstanding).toBe(1);
    expect(overview.kpis.outstandingPct).toBe(100);
  });

  it('computes the passing rate over marks, at the 75 boundary', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: [
          grade('t1', 'math', 'p1', 's1', 75),
          grade('t1', 'eng', 'p1', 's1', 74),
        ],
      })
    );
    expect(overview.kpis.passingRate).toBe(50);
  });

  it('counts a student averaging below 75 as needing support', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: [
          grade('t1', 'math', 'p1', 's1', 70),
          grade('t1', 'math', 'p1', 's2', 90),
        ],
      })
    );
    expect(overview.kpis.needsSupport).toBe(1);
    expect(overview.kpis.needsSupportPct).toBe(50);
  });
});

describe('grade-level rows', () => {
  it('follows the school ladder rather than ranking by score', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: [
          // Primary Two outscores Primary One, but must still come second.
          grade('t1', 'math', 'p1', 's1', 70),
          grade('t1', 'math', 'p2', 's2', 95),
        ],
      })
    );
    expect(overview.levels.map((l) => l.levelLabel)).toEqual([
      'Primary One',
      'Primary Two',
    ]);
  });

  it('names the strongest and weakest subject in the level', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: [
          grade('t1', 'math', 'p1', 's1', 95),
          grade('t1', 'eng', 'p1', 's1', 70),
        ],
      })
    );
    const p1 = overview.levels[0];
    expect(p1.strongestSubject).toEqual({ name: 'Mathematics', average: 95 });
    expect(p1.weakestSubject).toEqual({ name: 'English', average: 70 });
  });

  it('names no weakest subject when only one is taught', () => {
    const overview = computeAcademicOverview(
      baseInput({ grades: [grade('t1', 'math', 'p1', 's1', 95)] })
    );
    expect(overview.levels[0].strongestSubject?.name).toBe('Mathematics');
    expect(overview.levels[0].weakestSubject).toBeNull();
  });

  it('averages how many subjects a student is failing', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: [
          // s1 fails English only; s2 fails nothing.
          grade('t1', 'math', 'p1', 's1', 90),
          grade('t1', 'eng', 'p1', 's1', 60),
          grade('t1', 'math', 'p1', 's2', 90),
          grade('t1', 'eng', 'p1', 's2', 90),
        ],
      })
    );
    expect(overview.levels[0].failedSubjectsAvg).toBe(0.5);
  });
});

describe('trend', () => {
  it('measures first completed term to last', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: [
          grade('t1', 'math', 'p1', 's1', 80),
          grade('t2', 'math', 'p1', 's1', 84),
        ],
      })
    );
    expect(overview.levels[0].delta).toBe(4);
  });

  it('reports no trend when only one term carries marks', () => {
    const overview = computeAcademicOverview(
      baseInput({ grades: [grade('t2', 'math', 'p1', 's1', 84)] })
    );
    expect(overview.levels[0].delta).toBeNull();
  });

  it('ignores the in-progress term when measuring movement', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: [
          grade('t1', 'math', 'p1', 's1', 80),
          grade('t2', 'math', 'p1', 's1', 84),
          grade('t3', 'math', 'p1', 's1', 10),
        ],
      })
    );
    expect(overview.levels[0].delta).toBe(4);
  });

  it('reads a move under half a point as flat', () => {
    expect(trendDirection(0.4)).toBe('flat');
    expect(trendDirection(-0.4)).toBe('flat');
    expect(trendDirection(0.5)).toBe('up');
    expect(trendDirection(-0.5)).toBe('down');
    expect(trendDirection(null)).toBeNull();
  });
});

describe('subject rows', () => {
  it('orders by how many students take the subject', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: [
          grade('t1', 'eng', 'p1', 's1', 80),
          grade('t1', 'eng', 'p1', 's2', 80),
          grade('t1', 'math', 'p1', 's1', 80),
        ],
      })
    );
    expect(overview.subjects.map((s) => s.subjectName)).toEqual([
      'English',
      'Mathematics',
    ]);
    expect(overview.subjects[0].students).toBe(2);
  });

  it('names the strongest and weakest level for the subject', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: [
          grade('t1', 'math', 'p1', 's1', 95),
          grade('t1', 'math', 'p2', 's2', 75),
        ],
      })
    );
    const math = overview.subjects[0];
    expect(math.strongestLevel).toEqual({ label: 'Primary One', average: 95 });
    expect(math.weakestLevel).toEqual({ label: 'Primary Two', average: 75 });
  });

  it('names no weakest level when the subject runs at one level only', () => {
    const overview = computeAcademicOverview(
      baseInput({ grades: [grade('t1', 'math', 'p1', 's1', 95)] })
    );
    expect(overview.subjects[0].weakestLevel).toBeNull();
  });
});

describe('worth a look', () => {
  function overviewWith(grades: OverviewGradeInput[]) {
    return computeAcademicOverview(baseInput({ grades }));
  }

  it('names the lowest-averaging grade level', () => {
    const highlights = buildOverviewHighlights(
      overviewWith([
        grade('t1', 'math', 'p1', 's1', 95),
        grade('t1', 'math', 'p2', 's2', 70),
      ])
    );
    expect(highlights[0].title).toContain('Primary Two');
    expect(highlights[0].severity).toBe('bad');
  });

  it('measures the tail by share, not by headcount', () => {
    // Primary One: 1 of 3 behind. Primary Two: 1 of 1 behind — a smaller
    // number but the whole level, which is the one worth naming.
    const highlights = buildOverviewHighlights(
      overviewWith([
        grade('t1', 'math', 'p1', 's1', 95),
        grade('t1', 'math', 'p1', 's2', 95),
        grade('t1', 'math', 'p1', 's3', 78),
        grade('t1', 'math', 'p2', 's4', 79),
        grade('t1', 'eng', 'p2', 's4', 79),
      ])
    );
    const tail = highlights.find((h) => h.key.startsWith('tail:'));
    // Primary Two is already the weakest level, so it is not repeated as the
    // tail item — the guard against saying the same thing twice.
    expect(tail).toBeUndefined();
    expect(highlights[0].title).toContain('Primary Two');
  });

  it('says nothing at all when there is nothing to say', () => {
    expect(
      buildOverviewHighlights(
        computeAcademicOverview(
          baseInput({ grades: [], enrolledStudentIds: [] })
        )
      )
    ).toEqual([]);
  });

  it('flags students with no grades as information, not as a performance problem', () => {
    const highlights = buildOverviewHighlights(
      computeAcademicOverview(
        baseInput({
          enrolledStudentIds: ['s1', 's2'],
          grades: [grade('t1', 'math', 'p1', 's1', 90)],
        })
      )
    );
    const coverage = highlights.find((h) => h.key === 'coverage');
    expect(coverage?.severity).toBe('info');
    expect(coverage?.title).toContain('1 enrolled students have no grades yet');
  });

  it('never invents a threshold — the only cutoff used is the pass mark', () => {
    const highlights = buildOverviewHighlights(
      overviewWith([
        grade('t1', 'math', 'p1', 's1', 70),
        grade('t2', 'math', 'p1', 's1', 60),
      ])
    );
    const behind = highlights.find((h) => h.key.startsWith('behind:'));
    expect(behind?.title).toContain(String(PASS_MARK));
  });
});

describe('filters narrow the page in place', () => {
  const GRADES = [
    grade('t1', 'math', 'p1', 's1', 90),
    grade('t1', 'eng', 'p1', 's1', 60),
    grade('t2', 'math', 'p1', 's1', 90),
    grade('t1', 'math', 'p2', 's2', 80),
  ];

  it('narrows to one grade level', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: GRADES,
        filters: { ...NO_FILTERS, levelId: 'p2' },
      })
    );
    expect(overview.levels).toHaveLength(1);
    expect(overview.levels[0].levelLabel).toBe('Primary Two');
    expect(overview.kpis.average).toBe(80);
    expect(overview.scopeLabel).toBe('Primary Two');
  });

  it('narrows to one subject', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: GRADES,
        filters: { ...NO_FILTERS, subjectId: 'eng' },
      })
    );
    expect(overview.subjects).toHaveLength(1);
    expect(overview.kpis.average).toBe(60);
    expect(overview.scopeLabel).toBe('English');
  });

  it('narrows to one term', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: GRADES,
        filters: { ...NO_FILTERS, termNumber: 2 },
      })
    );
    expect(overview.kpis.average).toBe(90);
    expect(overview.scopeLabel).toBe('Term 2');
  });

  it('still lists every term, whatever is filtered', () => {
    // The per-term table is how you see which terms exist and where you are in
    // the year — narrowing to one term must not erase the other rows.
    const overview = computeAcademicOverview(
      baseInput({ grades: GRADES, filters: { ...NO_FILTERS, termNumber: 2 } })
    );
    expect(overview.terms.map((t) => t.termNumber)).toEqual([1, 2, 3]);
  });

  it('combines filters into one scope label', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: GRADES,
        filters: {
          levelId: 'p1',
          sectionId: 'p1-a',
          subjectId: 'math',
          termNumber: 1,
        },
      })
    );
    expect(overview.scopeLabel).toBe(
      'Primary One · P1 - Rose · Mathematics · Term 1'
    );
  });

  it('names students only when a single class is in scope', () => {
    const unfiltered = computeAcademicOverview(baseInput({ grades: GRADES }));
    expect(unfiltered.studentLists).toBeNull();

    const byClass = computeAcademicOverview(
      baseInput({
        grades: GRADES,
        filters: { ...NO_FILTERS, sectionId: 'p1-a' },
      })
    );
    expect(byClass.studentLists).not.toBeNull();
    expect(byClass.studentLists?.top[0].fullName).toBe('ALPHA, Ana');
  });

  it('lists everyone below the pass mark, not a fixed bottom few', () => {
    // s1 averages 75 across 90/60/90 — exactly the pass mark, so not listed.
    const byClass = computeAcademicOverview(
      baseInput({
        grades: GRADES,
        filters: { ...NO_FILTERS, sectionId: 'p1-a' },
      })
    );
    expect(byClass.studentLists?.needsImprovement).toEqual([]);

    const failing = computeAcademicOverview(
      baseInput({
        grades: [grade('t1', 'math', 'p1', 's1', 70)],
        filters: { ...NO_FILTERS, sectionId: 'p1-a' },
      })
    );
    expect(
      failing.studentLists?.needsImprovement.map((s) => s.fullName)
    ).toEqual(['ALPHA, Ana']);
  });

  it('offers only subjects that are actually taught', () => {
    const overview = computeAcademicOverview(baseInput({ grades: GRADES }));
    expect(overview.filterOptions.subjects.map((s) => s.name)).toEqual([
      'English',
      'Mathematics',
    ]);
  });
});

describe('attendance', () => {
  const att = (
    termId: string,
    levelId: string,
    studentId: string,
    schoolDays: number,
    present: number,
    late: number
  ) => ({
    studentId,
    levelId,
    sectionId: `${levelId}-a`,
    termId,
    schoolDays,
    present,
    late,
  });

  it('counts late as present, so the rates do not sum to 100', () => {
    const overview = computeAcademicOverview(
      baseInput({ attendance: [att('t1', 'p1', 's1', 100, 90, 10)] })
    );
    expect(overview.attendance.presentRate).toBe(90);
    expect(overview.attendance.lateRate).toBe(10);
    expect(overview.attendance.absentRate).toBe(10);
  });

  it('leaves out a term still being taught, matching the grades beside it', () => {
    const overview = computeAcademicOverview(
      baseInput({
        attendance: [
          att('t1', 'p1', 's1', 100, 90, 0),
          att('t3', 'p1', 's1', 50, 0, 0),
        ],
      })
    );
    expect(overview.attendance.schoolDays).toBe(100);
  });

  it('narrows by grade level and by term', () => {
    const attendance = [
      att('t1', 'p1', 's1', 100, 100, 0),
      att('t1', 'p2', 's2', 100, 50, 0),
      att('t2', 'p1', 's1', 100, 80, 0),
    ];
    expect(
      computeAcademicOverview(
        baseInput({ attendance, filters: { ...NO_FILTERS, levelId: 'p2' } })
      ).attendance.presentRate
    ).toBe(50);
    expect(
      computeAcademicOverview(
        baseInput({ attendance, filters: { ...NO_FILTERS, termNumber: 2 } })
      ).attendance.presentRate
    ).toBe(80);
  });

  it('says so when a subject filter cannot apply to it', () => {
    // Attendance is per day, not per subject — narrowing would be a lie, so
    // the figure stays whole-cohort and the flag tells the page to explain.
    const attendance = [att('t1', 'p1', 's1', 100, 90, 0)];
    const plain = computeAcademicOverview(baseInput({ attendance }));
    expect(plain.attendance.ignoresSubjectFilter).toBe(false);

    const bySubject = computeAcademicOverview(
      baseInput({ attendance, filters: { ...NO_FILTERS, subjectId: 'math' } })
    );
    expect(bySubject.attendance.ignoresSubjectFilter).toBe(true);
    expect(bySubject.attendance.schoolDays).toBe(100);
  });

  it('reports a per-level rate on the ladder', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: [grade('t1', 'math', 'p1', 's1', 90)],
        attendance: [att('t1', 'p1', 's1', 100, 95, 0)],
      })
    );
    expect(overview.levels[0].attendanceRate).toBe(95);
  });

  it('reports nothing rather than zero when no attendance is recorded', () => {
    const overview = computeAcademicOverview(baseInput({ attendance: [] }));
    expect(overview.attendance.presentRate).toBeNull();
    expect(overview.attendance.schoolDays).toBe(0);
  });
});

describe('attendance over the year', () => {
  const att = (
    termId: string,
    levelId: string,
    studentId: string,
    schoolDays: number,
    present: number,
    late = 0
  ) => ({
    studentId,
    levelId,
    sectionId: `${levelId}-a`,
    termId,
    schoolDays,
    present,
    late,
  });

  it('plots one row per term, in order, including terms with nothing recorded', () => {
    const overview = computeAcademicOverview(
      baseInput({ attendance: [att('t1', 'p1', 's1', 100, 90)] })
    );
    expect(overview.attendance.terms.map((t) => t.termNumber)).toEqual([
      1, 2, 3,
    ]);
    expect(overview.attendance.terms[0].rate).toBe(90);
    expect(overview.attendance.terms[1].rate).toBeNull();
    expect(overview.attendance.terms[1].schoolDays).toBe(0);
  });

  it('keeps every term in the trend even when one term is filtered to', () => {
    // The headline figures narrow; the trend still has to show the year's
    // shape, exactly as the grade trend does.
    const overview = computeAcademicOverview(
      baseInput({
        attendance: [
          att('t1', 'p1', 's1', 100, 90),
          att('t2', 'p1', 's1', 100, 95),
        ],
        filters: { ...NO_FILTERS, termNumber: 2 },
      })
    );
    expect(overview.attendance.presentRate).toBe(95);
    expect(overview.attendance.terms[0].rate).toBe(90);
    expect(overview.attendance.terms[1].rate).toBe(95);
  });

  it('reports a term still being taught once enough of the cohort is marked', () => {
    // school_days counts only days actually marked (migration 014 drops NC),
    // so a running term reports a true running rate rather than one diluted
    // by days nobody has reached yet.
    const overview = computeAcademicOverview(
      baseInput({
        attendance: [
          att('t1', 'p1', 's1', 100, 90),
          att('t1', 'p2', 's2', 100, 90),
          att('t3', 'p1', 's1', 20, 19),
          att('t3', 'p2', 's2', 20, 19),
        ],
      })
    );
    const t3 = overview.attendance.terms[2];
    expect(t3.status).toBe('in_progress');
    expect(t3.rate).toBe(95);
  });

  it('withholds a running term marked for only a sliver of the cohort', () => {
    const attendance = [
      att('t1', 'p1', 's1', 100, 90),
      att('t1', 'p2', 's2', 100, 90),
      att('t1', 'p2', 's3', 100, 90),
      att('t1', 'p1', 's4', 100, 90),
      att('t1', 'p1', 's5', 100, 90),
      att('t1', 'p1', 's6', 100, 90),
      // One student out of six is 16.7% — under the 20% floor.
      att('t3', 'p1', 's1', 10, 4),
    ];
    const overview = computeAcademicOverview(baseInput({ attendance }));
    const t3 = overview.attendance.terms[2];
    expect(t3.rate).toBeNull();
    expect(t3.studentsRecorded).toBe(1);
  });
});

describe('attendance concerns', () => {
  const att = (
    termId: string,
    levelId: string,
    studentId: string,
    schoolDays: number,
    present: number
  ) => ({
    studentId,
    levelId,
    sectionId: `${levelId}-a`,
    termId,
    schoolDays,
    present,
    late: 0,
  });

  it('names students under the at-risk line, worst first', () => {
    const overview = computeAcademicOverview(
      baseInput({
        attendance: [
          att('t1', 'p1', 's1', 100, 95),
          att('t1', 'p1', 's2', 100, 85),
          att('t1', 'p2', 's3', 100, 70),
        ],
      })
    );
    expect(overview.attendance.concerns.map((c) => c.fullName)).toEqual([
      'CHARLIE, Cara',
      'BRAVO, Ben',
    ]);
    expect(overview.attendance.concerns[0].rate).toBe(70);
    expect(overview.attendance.concerns[0].daysMissed).toBe(30);
    expect(overview.attendance.concerns[0].levelLabel).toBe('Primary Two');
    expect(overview.attendance.concerns[0].sectionName).toBe('P2 - Lily');
  });

  it('measures a student across all reported terms, not term by term', () => {
    // 45 + 95 of 200 days is 70% overall, so the student is listed once —
    // not once for the term they were away and not at all for the other.
    const overview = computeAcademicOverview(
      baseInput({
        attendance: [
          att('t1', 'p1', 's1', 100, 45),
          att('t2', 'p1', 's1', 100, 95),
        ],
      })
    );
    expect(overview.attendance.concerns).toHaveLength(1);
    expect(overview.attendance.concerns[0].rate).toBe(70);
    expect(overview.attendance.concerns[0].schoolDays).toBe(200);
  });

  it('leaves out a student with no days recorded rather than reading it as zero', () => {
    const overview = computeAcademicOverview(
      baseInput({ attendance: [att('t1', 'p1', 's1', 0, 0)] })
    );
    expect(overview.attendance.concerns).toEqual([]);
    expect(overview.attendance.studentsRecorded).toBe(0);
  });

  it('counts who is under the line on each rung of the ladder', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: [
          grade('t1', 'math', 'p1', 's1', 90),
          grade('t1', 'math', 'p2', 's3', 90),
        ],
        attendance: [
          att('t1', 'p1', 's1', 100, 95),
          att('t1', 'p1', 's2', 100, 80),
          att('t1', 'p2', 's3', 100, 70),
        ],
      })
    );
    expect(overview.levels[0].attendanceBelowThreshold).toBe(1);
    expect(overview.levels[1].attendanceBelowThreshold).toBe(1);
  });

  it('shows nothing rather than zero on a level with no attendance recorded', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: [grade('t1', 'math', 'p1', 's1', 90)],
        attendance: [],
      })
    );
    expect(overview.levels[0].attendanceRate).toBeNull();
    expect(overview.levels[0].attendanceBelowThreshold).toBeNull();
  });

  it('splits school days three ways that actually add up', () => {
    // `present` already contains `late`, so present/late/absent overlap and
    // cannot be drawn as parts of a whole. onTime/late/absent can.
    const overview = computeAcademicOverview(
      baseInput({
        attendance: [
          {
            studentId: 's1',
            levelId: 'p1',
            sectionId: 'p1-a',
            termId: 't1',
            schoolDays: 100,
            present: 96,
            late: 6,
          },
        ],
      })
    );
    const a = overview.attendance;
    expect(a.onTime).toBe(90);
    expect(a.onTime + a.late + a.absent).toBe(a.schoolDays);
  });

  it('never reports negative on-time days when late exceeds present', () => {
    // Defensive: a hand-backfilled rollup could break the subset invariant,
    // and a negative slice would render as a wedge pointing the wrong way.
    const overview = computeAcademicOverview(
      baseInput({
        attendance: [
          {
            studentId: 's1',
            levelId: 'p1',
            sectionId: 'p1-a',
            termId: 't1',
            schoolDays: 100,
            present: 10,
            late: 40,
          },
        ],
      })
    );
    expect(overview.attendance.onTime).toBe(0);
  });

  it('carries a rate onto the class student lists', () => {
    const overview = computeAcademicOverview(
      baseInput({
        grades: [
          grade('t1', 'math', 'p1', 's1', 90),
          grade('t1', 'math', 'p1', 's2', 60),
        ],
        attendance: [att('t1', 'p1', 's1', 100, 96)],
        filters: { ...NO_FILTERS, sectionId: 'p1-a' },
      })
    );
    const top = overview.studentLists!.top;
    expect(top[0].attendanceRate).toBe(96);
    // No rollup for s2 — that is "not recorded", never 0%.
    expect(top[1].attendanceRate).toBeNull();
  });
});

describe('data quality', () => {
  it('reports grades the grading formula could not have produced', () => {
    // transmute() floors at 60, so a 0 is a backfilled value, not a mark.
    const overview = computeAcademicOverview(
      baseInput({
        grades: [
          grade('t1', 'math', 'p1', 's1', 0),
          grade('t1', 'eng', 'p1', 's1', 88),
        ],
      })
    );
    expect(overview.anomalies.impossibleLowGrades).toBe(1);
  });

  it('holds up with nothing recorded at all', () => {
    const overview = computeAcademicOverview(
      baseInput({ grades: [], enrolledStudentIds: [] })
    );
    expect(overview.kpis.average).toBeNull();
    expect(overview.kpis.passingRate).toBeNull();
    expect(overview.kpis.needsSupportPct).toBeNull();
    expect(overview.levels).toEqual([]);
    expect(overview.subjects).toEqual([]);
    expect(overview.distribution.total).toBe(0);
  });
});
