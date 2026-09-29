import { describe, expect, it } from 'vitest';

import {
  enrolledStudentDataFrom,
  headcountFromRows,
  nationalityByLevelInputs,
  retentionByLevelFromCohort,
  retentionCohortFrom,
  retentionFromCohort,
  valueByEnroleeNumber,
  type EnrolRow,
  type OnRollRow,
} from '@/lib/sis/records-insights';

const sec = (label: string | null, code: string) => ({
  academic_year_id: 'ay',
  levels: { label, code },
});

describe('headcountFromRows', () => {
  it('counts class rows per level label, code when the label is blank', () => {
    const rows: OnRollRow[] = [
      { section: sec('Primary One', 'P1') },
      { section: [sec('Primary One', 'P1')] },
      { section: sec(null, 'P2') },
      { section: null },
    ];
    const out = headcountFromRows(rows);
    expect(out.total).toBe(3);
    expect(out.byLevel).toEqual([
      { level: 'P2', count: 1 },
      { level: 'Primary One', count: 2 },
    ]);
  });
});

describe('enrolledStudentDataFrom', () => {
  it('is one entry per student number, first level wins, nameless rows skipped', () => {
    const rows: EnrolRow[] = [
      { student: { student_number: 'S1' }, section: sec('Primary One', 'P1') },
      {
        student: [{ student_number: 'S1' }],
        section: sec('Primary Two', 'P2'),
      },
      { student: { student_number: null }, section: sec('Primary One', 'P1') },
      {
        student: { student_number: 'S2' },
        section: sec('Secondary Four', 'S4'),
      },
    ];
    const data = enrolledStudentDataFrom(rows);
    expect([...data.studentNumbers]).toEqual(['S1', 'S2']);
    expect(data.levelByStudentNumber.get('S1')).toBe('Primary One');
    expect(data.levelByStudentNumber.get('S2')).toBe('Secondary Four');
  });
});

describe('retention cohort', () => {
  const prior = {
    studentNumbers: new Set(['S1', 'S2', 'S3', 'S4', 'S5']),
    levelByStudentNumber: new Map([
      ['S1', 'Primary One'],
      ['S2', 'Primary One'],
      ['S3', 'Primary Two'],
      ['S4', 'Secondary Four'],
    ]),
  };
  const current = new Set(['S1', 'S3', 'S4']);

  it('drops the terminal level, keeps a student with no level', () => {
    const cohort = retentionCohortFrom(prior, current);
    expect(cohort.map((m) => m.studentNumber)).toEqual([
      'S1',
      'S2',
      'S3',
      'S5',
    ]);
    expect(retentionFromCohort('AY2025', cohort)).toEqual({
      priorAy: 'AY2025',
      returned: 2,
      didNotReturn: 2,
      priorTotal: 4,
      pct: 50,
    });
  });

  it('by level keeps the terminal level and skips a student with no level', () => {
    const rows = retentionByLevelFromCohort(
      retentionCohortFrom(prior, current, { includeTerminal: true })
    );
    expect(rows).toEqual([
      {
        level: 'Primary One',
        priorTotal: 2,
        returned: 1,
        didNotReturn: 1,
        pct: 50,
      },
      {
        level: 'Primary Two',
        priorTotal: 1,
        returned: 1,
        didNotReturn: 0,
        pct: 100,
      },
      {
        level: 'Secondary Four',
        priorTotal: 1,
        returned: 1,
        didNotReturn: 0,
        pct: 100,
      },
    ]);
  });
});

describe('admissions lookups', () => {
  it('maps enrolee number → value, skipping blanks', () => {
    const map = valueByEnroleeNumber(
      [
        { enroleeNumber: 'E1', category: 'New' },
        { enroleeNumber: null, category: 'Current' },
        { enroleeNumber: 'E2', category: null },
      ],
      'category'
    );
    expect([...map.entries()]).toEqual([['E1', 'New']]);
  });

  it('builds the nationality-by-level inputs from the raw enrolee number', () => {
    const nat = new Map([['E1', 'Philippines']]);
    expect(
      nationalityByLevelInputs(
        [
          { enrolee_number: ' E1 ', section: sec('Primary One', 'P1') },
          { enrolee_number: null, section: null },
        ],
        nat
      )
    ).toEqual([
      { level: 'Primary One', nationality: 'Philippines' },
      { level: 'Unknown', nationality: null },
    ]);
  });
});
