import { describe, expect, it } from 'vitest';

import { buildT1PrimaryGradingImport } from '@/lib/sis/backfill/grading/build-t1-primary-grading-import';
import type {
  GradingStudentRow,
  ParsedSubjectSheet,
} from '@/lib/sis/backfill/grading/grading-workbook';
import type {
  RosterLookupEntry,
  SubjectConfigWeight,
} from '@/lib/sis/backfill/grading/build-t1-primary-grading-import';

const BASE_INPUT = { ayCode: 'AY2026', termNumber: 1 };

const ROSTER: RosterLookupEntry[] = [
  {
    levelCode: 'P1',
    sectionName: 'Patience',
    indexNumber: 1,
    sectionStudentId: 'ss-alvarez-uuid',
  },
  {
    levelCode: 'P1',
    sectionName: 'Patience',
    indexNumber: 2,
    sectionStudentId: 'ss-amate-uuid',
  },
];

function student(overrides: Partial<GradingStudentRow>): GradingStudentRow {
  return {
    indexNo: '1',
    fullName: 'ALVAREZ, Jaime III D.',
    wwScores: [10, 10],
    ptScores: [6, 10, 10],
    examScore: 22,
    printedInitialGrade: 89.33,
    printedQuarterlyGrade: 93,
    ...overrides,
  };
}

function mathSheet(
  overrides: Partial<ParsedSubjectSheet> = {}
): ParsedSubjectSheet {
  return {
    subjectCode: 'MATH',
    levelCode: 'P1',
    sectionName: 'Patience',
    teacherName: 'Mr. Wai Chung',
    wwWeight: 0.4,
    ptWeight: 0.4,
    qaWeight: 0.2,
    wwTotals: [10, 10],
    ptTotals: [10, 10, 10],
    qaTotal: 30,
    students: [student({})],
    ...overrides,
  };
}

describe('buildT1PrimaryGradingImport', () => {
  it('resolves roster, computes grades via the real formula, and writes grading_sheets/grade_entries', () => {
    const result = buildT1PrimaryGradingImport({
      ...BASE_INPUT,
      sheets: [mathSheet()],
      rosterLookup: ROSTER,
      subjectConfigWeights: [],
    });

    expect(result.stats.gradingSheetsWritten).toBe(1);
    expect(result.stats.gradeEntriesWritten).toBe(1);
    expect(result.stats.needsReview).toBe(0);
    expect(result.stats.quarterlyMismatches).toBe(0);

    expect(result.apply).toContain("'MATH'");
    expect(result.apply).toContain("'P1'");
    expect(result.apply).toContain('grading_sheets');
    expect(result.apply).toContain('grade_entries');
    expect(result.apply).toContain("'ss-alvarez-uuid'");
    expect(result.apply).toContain("'backfill-import'");
  });

  it('renders "(none)" and emits no subject_configs block at all when subjectConfigWeights is empty — the real behavior this phase needs (T1 needs zero corrections, unlike T2 Phase 6a)', () => {
    const result = buildT1PrimaryGradingImport({
      ...BASE_INPUT,
      sheets: [mathSheet()],
      rosterLookup: ROSTER,
      subjectConfigWeights: [],
    });

    expect(result.stats.subjectConfigsWritten).toBe(0);
    expect(result.preview).toContain('subject_configs corrections (0)');
    expect(result.preview).toContain('(none)');
    expect(result.apply).not.toContain('insert into subject_configs');
    expect(result.apply).not.toMatch(/create temp table _\w*_subject_configs/);
  });

  it('emits subject_configs writes ONLY for entries explicitly passed in subjectConfigWeights, never derived from the sheets', () => {
    const sheets = [
      mathSheet(),
      mathSheet({
        subjectCode: 'FIL',
        wwWeight: 0.3,
        ptWeight: 0.5,
        qaWeight: 0.2,
      }),
    ];
    const weights: SubjectConfigWeight[] = [
      { subjectCode: 'FIL', wwWeight: 0.3, ptWeight: 0.5, qaWeight: 0.2 },
    ];
    const result = buildT1PrimaryGradingImport({
      ...BASE_INPUT,
      sheets,
      rosterLookup: ROSTER,
      subjectConfigWeights: weights,
    });

    expect(result.stats.subjectConfigsWritten).toBe(1);
    expect(result.apply).toContain("'FIL'");
    expect(result.apply).toContain('weights_confirmed');
    expect(result.apply).toMatch(
      /on conflict \(academic_year_id, subject_id\) do update/i
    );
  });

  it('flags an unresolved (level, section, index) as needs-review and excludes it from apply.sql', () => {
    const sheet = mathSheet({
      students: [student({ indexNo: '99', fullName: 'NOBODY, Unresolved' })],
    });
    const result = buildT1PrimaryGradingImport({
      ...BASE_INPUT,
      sheets: [sheet],
      rosterLookup: ROSTER,
      subjectConfigWeights: [],
    });

    expect(result.stats.needsReview).toBe(1);
    expect(result.stats.gradeEntriesWritten).toBe(0);
    expect(result.apply).not.toContain('NOBODY');
    expect(result.preview).toContain('NOBODY');
  });

  it('flags a quarterly-grade mismatch but still writes the raw scores (they remain the transcribed truth)', () => {
    const sheet = mathSheet({
      students: [student({ printedQuarterlyGrade: 999 })],
    });
    const result = buildT1PrimaryGradingImport({
      ...BASE_INPUT,
      sheets: [sheet],
      rosterLookup: ROSTER,
      subjectConfigWeights: [],
    });

    expect(result.stats.quarterlyMismatches).toBe(1);
    expect(result.stats.gradeEntriesWritten).toBe(1);
    expect(result.preview).toContain('quarterly');
  });

  it('produces a single un-chunked apply.sql string (not multiple files) at this volume', () => {
    const result = buildT1PrimaryGradingImport({
      ...BASE_INPUT,
      sheets: [mathSheet()],
      rosterLookup: ROSTER,
      subjectConfigWeights: [],
    });

    expect(typeof result.apply).toBe('string');
    expect(result.apply).toContain('begin;');
    expect(result.apply).toContain('commit;');
  });
});
