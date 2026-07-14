import { describe, expect, it } from 'vitest';
import {
  computeLevelTransitions,
  groupTransitionsByFromLevel,
} from '@/lib/sis/level-transitions';
import type { LevelRow } from '@/lib/sis/levels';

const LEVELS: LevelRow[] = [
  {
    id: 'p6',
    code: 'P6',
    label: 'Primary Six',
    levelType: 'primary',
    sortOrder: 9,
    nextLevelId: 's1',
    isCore: true,
  },
  {
    id: 's1',
    code: 'S1',
    label: 'Secondary One',
    levelType: 'secondary',
    sortOrder: 10,
    nextLevelId: null,
    isCore: true,
  },
  {
    id: 'p5',
    code: 'P5',
    label: 'Primary Five',
    levelType: 'primary',
    sortOrder: 8,
    nextLevelId: 'p6',
    isCore: true,
  },
];

describe('computeLevelTransitions', () => {
  it('reports the real one-to-many split for a level (mainstream + alternate track)', () => {
    const priorEnrollments = [
      { studentNumber: 'S001', levelId: 'p6' },
      { studentNumber: 'S002', levelId: 'p6' },
      { studentNumber: 'S003', levelId: 'p6' },
    ];
    const currentApplications = [
      { studentNumber: 'S001', levelApplied: 'Secondary One' },
      { studentNumber: 'S002', levelApplied: 'Secondary One' },
      // Alternate destination not in the catalog at all — still counted,
      // just with toLevelId: null (unresolved).
      {
        studentNumber: 'S003',
        levelApplied: 'HFSE Global Education Programme – Year 8',
      },
    ];

    const rows = computeLevelTransitions(
      priorEnrollments,
      currentApplications,
      LEVELS
    );

    expect(rows).toHaveLength(2);
    const s1Row = rows.find((r) => r.toLabel === 'Secondary One');
    expect(s1Row).toMatchObject({
      fromLevelId: 'p6',
      toLevelId: 's1',
      count: 2,
    });
    const altRow = rows.find(
      (r) => r.toLabel === 'HFSE Global Education Programme – Year 8'
    );
    expect(altRow).toMatchObject({
      fromLevelId: 'p6',
      toLevelId: null,
      count: 1,
    });
  });

  it('does not correctly split a multi-word label when reconstructing (regression: no space-joined keys)', () => {
    // Two DIFFERENT origin levels both sending students to "Secondary One"
    // must stay attributed to the correct origin, not collide.
    const priorEnrollments = [
      { studentNumber: 'A1', levelId: 'p6' },
      { studentNumber: 'A2', levelId: 'p5' },
    ];
    const currentApplications = [
      { studentNumber: 'A1', levelApplied: 'Secondary One' },
      { studentNumber: 'A2', levelApplied: 'Secondary One' },
    ];

    const rows = computeLevelTransitions(
      priorEnrollments,
      currentApplications,
      LEVELS
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.toLabel === 'Secondary One')).toBe(true);
    expect(rows.map((r) => r.fromLevelId).sort()).toEqual(['p5', 'p6']);
  });

  it('ignores applicants with no student_number (never enrolled here before, or unset)', () => {
    const rows = computeLevelTransitions(
      [{ studentNumber: 'S001', levelId: 'p6' }],
      [{ studentNumber: null, levelApplied: 'Secondary One' }],
      LEVELS
    );
    expect(rows).toHaveLength(0);
  });

  it('ignores applicants whose student_number has no prior-AY placement (new applicants)', () => {
    const rows = computeLevelTransitions(
      [{ studentNumber: 'S001', levelId: 'p6' }],
      [{ studentNumber: 'S999-NEW', levelApplied: 'Secondary One' }],
      LEVELS
    );
    expect(rows).toHaveLength(0);
  });

  it('ignores rows with a blank/null levelApplied', () => {
    const rows = computeLevelTransitions(
      [{ studentNumber: 'S001', levelId: 'p6' }],
      [
        { studentNumber: 'S001', levelApplied: null },
        { studentNumber: 'S001', levelApplied: '   ' },
      ],
      LEVELS
    );
    expect(rows).toHaveLength(0);
  });

  it('sorts by count descending', () => {
    const rows = computeLevelTransitions(
      [
        { studentNumber: 'S1', levelId: 'p6' },
        { studentNumber: 'S2', levelId: 'p6' },
        { studentNumber: 'S3', levelId: 'p6' },
        { studentNumber: 'S4', levelId: 'p6' },
      ],
      [
        { studentNumber: 'S1', levelApplied: 'Alt Track' },
        { studentNumber: 'S2', levelApplied: 'Secondary One' },
        { studentNumber: 'S3', levelApplied: 'Secondary One' },
        { studentNumber: 'S4', levelApplied: 'Secondary One' },
      ],
      LEVELS
    );
    expect(rows[0]).toMatchObject({ toLabel: 'Secondary One', count: 3 });
    expect(rows[1]).toMatchObject({ toLabel: 'Alt Track', count: 1 });
  });
});

describe('groupTransitionsByFromLevel', () => {
  it('groups rows by origin level id', () => {
    const rows = computeLevelTransitions(
      [
        { studentNumber: 'S1', levelId: 'p6' },
        { studentNumber: 'S2', levelId: 'p6' },
        { studentNumber: 'S3', levelId: 'p5' },
      ],
      [
        { studentNumber: 'S1', levelApplied: 'Secondary One' },
        { studentNumber: 'S2', levelApplied: 'Alt Track' },
        { studentNumber: 'S3', levelApplied: 'Primary Six' },
      ],
      LEVELS
    );
    const grouped = groupTransitionsByFromLevel(rows);
    expect(grouped.get('p6')).toHaveLength(2);
    expect(grouped.get('p5')).toHaveLength(1);
  });
});
