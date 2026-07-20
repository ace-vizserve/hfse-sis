// __tests__/sis/backfill/grading/build-t1-secondary-grading-import.test.ts
import { describe, expect, it } from 'vitest';

import { buildT1SecondaryGradingImport } from '@/lib/sis/backfill/grading/build-t1-secondary-grading-import';
import type {
  GradingStudentRow,
  ParsedSubjectSheet,
} from '@/lib/sis/backfill/grading/grading-workbook';
import type {
  RosterLookupEntry,
  SubjectConfigWeight,
} from '@/lib/sis/backfill/grading/build-t1-secondary-grading-import';

const BASE_INPUT = { ayCode: 'AY2026', termNumber: 1 };

const ROSTER: RosterLookupEntry[] = [
  {
    levelCode: 'S1',
    sectionName: 'Discipline 2',
    indexNumber: 1,
    sectionStudentId: 'ss-bagang-uuid',
  },
];

function student(overrides: Partial<GradingStudentRow>): GradingStudentRow {
  return {
    indexNo: '1',
    fullName: 'BAGANG, Miguel C.',
    wwScores: [26],
    ptScores: [28, 19, 25],
    examScore: 59,
    printedInitialGrade: 92.15,
    printedQuarterlyGrade: 95,
    ...overrides,
  };
}

function litSheet(
  overrides: Partial<ParsedSubjectSheet> = {}
): ParsedSubjectSheet {
  return {
    subjectCode: 'LIT',
    levelCode: 'S1',
    sectionName: 'Discipline 2',
    teacherName: 'Ms. Carl',
    wwWeight: 0.3,
    ptWeight: 0.5,
    qaWeight: 0.2,
    wwTotals: [30],
    ptTotals: [30, 20, 25],
    qaTotal: 65,
    students: [student({})],
    ...overrides,
  };
}

describe('buildT1SecondaryGradingImport', () => {
  it('resolves roster, computes grades via the real formula, and writes grading_sheets/grade_entries', () => {
    const result = buildT1SecondaryGradingImport({
      ...BASE_INPUT,
      sheets: [litSheet()],
      rosterLookup: ROSTER,
      subjectConfigWeights: [],
    });

    expect(result.stats.gradingSheetsWritten).toBe(1);
    expect(result.stats.gradeEntriesWritten).toBe(1);
    expect(result.stats.needsReview).toBe(0);
    expect(result.stats.quarterlyMismatches).toBe(0);
    expect(result.apply).toContain("'LIT'");
    expect(result.apply).toContain("'S1'");
    expect(result.apply).toContain("'ss-bagang-uuid'");
    expect(result.apply).toContain("'backfill-import'");
  });

  it('renders "(none)" and emits no subject_configs block at all when subjectConfigWeights is empty — the real behavior this phase needs (T1 Secondary needs zero corrections)', () => {
    const result = buildT1SecondaryGradingImport({
      ...BASE_INPUT,
      sheets: [litSheet()],
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
      litSheet(),
      litSheet({
        subjectCode: 'HIST',
        wwWeight: 0.3,
        ptWeight: 0.5,
        qaWeight: 0.2,
      }),
    ];
    const weights: SubjectConfigWeight[] = [
      { subjectCode: 'HIST', wwWeight: 0.3, ptWeight: 0.5, qaWeight: 0.2 },
    ];
    const result = buildT1SecondaryGradingImport({
      ...BASE_INPUT,
      sheets,
      rosterLookup: ROSTER,
      subjectConfigWeights: weights,
    });

    expect(result.stats.subjectConfigsWritten).toBe(1);
    expect(result.apply).toContain("'HIST'");
    expect(result.apply).toContain('weights_confirmed');
    expect(result.apply).toMatch(
      /on conflict \(academic_year_id, subject_id\) do update/i
    );
  });

  it('flags an unresolved (level, section, index) as needs-review and excludes it from apply.sql', () => {
    const sheet = litSheet({
      students: [student({ indexNo: '99', fullName: 'NOBODY, Unresolved' })],
    });
    const result = buildT1SecondaryGradingImport({
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
    const sheet = litSheet({
      students: [student({ printedQuarterlyGrade: 999 })],
    });
    const result = buildT1SecondaryGradingImport({
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
    const result = buildT1SecondaryGradingImport({
      ...BASE_INPUT,
      sheets: [litSheet()],
      rosterLookup: ROSTER,
      subjectConfigWeights: [],
    });

    expect(typeof result.apply).toBe('string');
    expect(result.apply).toContain('begin;');
    expect(result.apply).toContain('commit;');
  });
});
