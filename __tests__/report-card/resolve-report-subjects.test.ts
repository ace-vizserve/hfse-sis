import { describe, it, expect } from 'vitest';
import {
  resolveReportSubjects,
  type ReportMapEntry,
  type ReportTargetMeta,
} from '@/lib/report-card/resolve-report-subjects';
import type { SubjectRow } from '@/lib/report-card/build-report-card';

const emptyCell = { quarterly: null, letter: null, is_na: false };

function makeRow(overrides: Partial<SubjectRow> = {}): SubjectRow {
  return {
    subject: {
      id: 'sub-1',
      code: 'SUB1',
      name: 'Subject One',
      is_examinable: true,
    },
    t1: emptyCell,
    t2: emptyCell,
    t3: emptyCell,
    t4: emptyCell,
    annual: null,
    annual_letter: null,
    annual_letter_override: null,
    annual_letter_derived: null,
    t4_entry_id: null,
    t4_sheet_id: null,
    ...overrides,
  };
}

describe('resolveReportSubjects', () => {
  it('1. empty reportMap → output equals input, unchanged, same order', () => {
    const rows: SubjectRow[] = [
      makeRow({
        subject: { id: 'a', code: 'A', name: 'Alpha', is_examinable: true },
      }),
      makeRow({
        subject: { id: 'b', code: 'B', name: 'Bravo', is_examinable: false },
      }),
    ];
    const result = resolveReportSubjects(rows, [], new Map());
    expect(result).toEqual(rows);
  });

  it('2. all-self-maps → unchanged, no parentheticals, including a row with no grade data', () => {
    const rowA = makeRow({
      subject: { id: 'a', code: 'A', name: 'Alpha', is_examinable: true },
      t1: { quarterly: 93, letter: null, is_na: false },
    });
    // No grade data at all — must still pass through (single-mapper groups
    // never data-gate).
    const rowB = makeRow({
      subject: { id: 'b', code: 'B', name: 'Bravo', is_examinable: true },
    });
    const rows = [rowA, rowB];
    const reportMap: ReportMapEntry[] = [
      { subject_id: 'a', report_subject_id: 'a' },
      { subject_id: 'b', report_subject_id: 'b' },
    ];
    const reportTargets = new Map<string, ReportTargetMeta>([
      ['a', { id: 'a', code: 'A', name: 'Alpha', is_examinable: true }],
      ['b', { id: 'b', code: 'B', name: 'Bravo', is_examinable: true }],
    ]);
    const result = resolveReportSubjects(rows, reportMap, reportTargets);
    expect(result).toEqual(rows);
  });

  it('3. fan-in, source A has data, source B is all-N.A. → one merged row labelled "{Target} (A)"', () => {
    const rowA = makeRow({
      subject: { id: 'a', code: 'FIL', name: 'Filipino', is_examinable: false },
      t1: { quarterly: null, letter: 'A', is_na: false },
    });
    const rowB = makeRow({
      subject: { id: 'b', code: 'MAN', name: 'Mandarin', is_examinable: false },
      t1: { quarterly: null, letter: 'NA', is_na: true },
      t2: { quarterly: null, letter: 'NA', is_na: true },
      t3: { quarterly: null, letter: 'NA', is_na: true },
      t4: { quarterly: null, letter: 'NA', is_na: true },
    });
    const reportMap: ReportMapEntry[] = [
      { subject_id: 'a', report_subject_id: 'mt' },
      { subject_id: 'b', report_subject_id: 'mt' },
    ];
    const reportTargets = new Map<string, ReportTargetMeta>([
      [
        'mt',
        { id: 'mt', code: 'MT', name: 'Mother Tongue', is_examinable: false },
      ],
    ]);
    const result = resolveReportSubjects(
      [rowA, rowB],
      reportMap,
      reportTargets
    );
    expect(result).toHaveLength(1);
    expect(result[0].subject).toEqual({
      id: 'mt',
      code: 'MT',
      name: 'Mother Tongue (Filipino)',
      is_examinable: false,
    });
    expect(result[0].t1).toEqual(rowA.t1);
  });

  it('4. fan-in, the other direction (source B has data instead) → "{Target} (B)"', () => {
    const rowA = makeRow({
      subject: { id: 'a', code: 'FIL', name: 'Filipino', is_examinable: false },
    });
    const rowB = makeRow({
      subject: { id: 'b', code: 'MAN', name: 'Mandarin', is_examinable: false },
      t1: { quarterly: null, letter: 'B', is_na: false },
    });
    const reportMap: ReportMapEntry[] = [
      { subject_id: 'a', report_subject_id: 'mt' },
      { subject_id: 'b', report_subject_id: 'mt' },
    ];
    const reportTargets = new Map<string, ReportTargetMeta>([
      [
        'mt',
        { id: 'mt', code: 'MT', name: 'Mother Tongue', is_examinable: false },
      ],
    ]);
    const result = resolveReportSubjects(
      [rowA, rowB],
      reportMap,
      reportTargets
    );
    expect(result).toHaveLength(1);
    expect(result[0].subject.name).toBe('Mother Tongue (Mandarin)');
    expect(result[0].t1).toEqual(rowB.t1);
  });

  it('5. fan-in, neither source has data → row dropped entirely', () => {
    const rowA = makeRow({
      subject: { id: 'a', code: 'FIL', name: 'Filipino', is_examinable: false },
    });
    const rowB = makeRow({
      subject: { id: 'b', code: 'MAN', name: 'Mandarin', is_examinable: false },
    });
    const otherRow = makeRow({
      subject: {
        id: 'z',
        code: 'MATH',
        name: 'Mathematics',
        is_examinable: true,
      },
      t1: { quarterly: 90, letter: null, is_na: false },
    });
    const reportMap: ReportMapEntry[] = [
      { subject_id: 'a', report_subject_id: 'mt' },
      { subject_id: 'b', report_subject_id: 'mt' },
      { subject_id: 'z', report_subject_id: 'z' },
    ];
    const reportTargets = new Map<string, ReportTargetMeta>([
      [
        'mt',
        { id: 'mt', code: 'MT', name: 'Mother Tongue', is_examinable: false },
      ],
      [
        'z',
        { id: 'z', code: 'MATH', name: 'Mathematics', is_examinable: true },
      ],
    ]);
    const result = resolveReportSubjects(
      [rowA, rowB, otherRow],
      reportMap,
      reportTargets
    );
    // The fan-in row (Mother Tongue) is dropped entirely; the unrelated
    // single-mapper row survives unaffected.
    expect(result).toHaveLength(1);
    expect(result[0].subject.name).toBe('Mathematics');
  });

  it("6. single-mapper target that ISN'T a self-map → target's name, no parenthetical", () => {
    const rowA = makeRow({
      subject: { id: 'a', code: 'A', name: 'Alpha', is_examinable: true },
      t1: { quarterly: 85, letter: null, is_na: false },
    });
    const reportMap: ReportMapEntry[] = [
      { subject_id: 'a', report_subject_id: 't' },
    ];
    const reportTargets = new Map<string, ReportTargetMeta>([
      [
        't',
        { id: 't', code: 'T', name: 'Target Subject', is_examinable: true },
      ],
    ]);
    const result = resolveReportSubjects([rowA], reportMap, reportTargets);
    expect(result).toHaveLength(1);
    expect(result[0].subject).toEqual({
      id: 't',
      code: 'T',
      name: 'Target Subject',
      is_examinable: true,
    });
    // Cell data passes through unchanged (single-mapper groups never
    // data-gate, no matter what — this row happens to have data too, but
    // the point is it's not filtered).
    expect(result[0].t1).toEqual(rowA.t1);
  });

  it('7. invariant-guard case: two sources in the same fan-in group both have real data → deterministic pick, does not throw', () => {
    const rowA = makeRow({
      subject: {
        id: 'a',
        code: 'ZED',
        name: 'Zed Subject',
        is_examinable: false,
      },
      t1: { quarterly: null, letter: 'A', is_na: false },
    });
    const rowB = makeRow({
      subject: {
        id: 'b',
        code: 'ALP',
        name: 'Alpha Subject',
        is_examinable: false,
      },
      t1: { quarterly: null, letter: 'B', is_na: false },
    });
    const reportMap: ReportMapEntry[] = [
      { subject_id: 'a', report_subject_id: 'mt' },
      { subject_id: 'b', report_subject_id: 'mt' },
    ];
    const reportTargets = new Map<string, ReportTargetMeta>([
      [
        'mt',
        { id: 'mt', code: 'MT', name: 'Mother Tongue', is_examinable: false },
      ],
    ]);
    expect(() =>
      resolveReportSubjects([rowA, rowB], reportMap, reportTargets)
    ).not.toThrow();
    const result = resolveReportSubjects(
      [rowA, rowB],
      reportMap,
      reportTargets
    );
    expect(result).toHaveLength(1);
    // Deterministic pick: 'Alpha Subject' sorts before 'Zed Subject'.
    expect(result[0].subject.name).toBe('Mother Tongue (Alpha Subject)');
    expect(result[0].t1).toEqual(rowB.t1);
  });

  it('8. sort-position check — a merged row sorts into the correct alphabetical position', () => {
    // Fan-in target "Mother Tongue" merges from Filipino/Mandarin. Its
    // merged label "Mother Tongue (Filipino)" should sort alphabetically by
    // "Mother Tongue…", landing between "Homeroom" and "Science".
    const homeroom = makeRow({
      subject: { id: 'hr', code: 'HR', name: 'Homeroom', is_examinable: true },
      t1: { quarterly: 88, letter: null, is_na: false },
    });
    const filipino = makeRow({
      subject: {
        id: 'fil',
        code: 'FIL',
        name: 'Filipino',
        is_examinable: false,
      },
      t1: { quarterly: null, letter: 'A', is_na: false },
    });
    const mandarin = makeRow({
      subject: {
        id: 'man',
        code: 'MAN',
        name: 'Mandarin',
        is_examinable: false,
      },
    });
    const science = makeRow({
      subject: { id: 'sci', code: 'SCI', name: 'Science', is_examinable: true },
      t1: { quarterly: 91, letter: null, is_na: false },
    });
    // Deliberately pass rows pre-sorted by their OWN (unmerged) names so the
    // input order ("Filipino, Homeroom, Mandarin, Science") differs from
    // the expected output order once "Filipino"/"Mandarin" fold into
    // "Mother Tongue (Filipino)".
    const rows = [filipino, homeroom, mandarin, science];
    const reportMap: ReportMapEntry[] = [
      { subject_id: 'fil', report_subject_id: 'mt' },
      { subject_id: 'man', report_subject_id: 'mt' },
      { subject_id: 'hr', report_subject_id: 'hr' },
      { subject_id: 'sci', report_subject_id: 'sci' },
    ];
    const reportTargets = new Map<string, ReportTargetMeta>([
      [
        'mt',
        { id: 'mt', code: 'MT', name: 'Mother Tongue', is_examinable: false },
      ],
      ['hr', { id: 'hr', code: 'HR', name: 'Homeroom', is_examinable: true }],
      ['sci', { id: 'sci', code: 'SCI', name: 'Science', is_examinable: true }],
    ]);
    const result = resolveReportSubjects(rows, reportMap, reportTargets);
    expect(result.map((r) => r.subject.name)).toEqual([
      'Homeroom',
      'Mother Tongue (Filipino)',
      'Science',
    ]);
  });
});
