// __tests__/sis/backfill/grading/build-grading-import.test.ts
import { describe, expect, it } from 'vitest';

import { buildGradingImport } from '@/lib/sis/backfill/grading/build-grading-import';
import type {
  ParsedSubjectSheet,
  GradingStudentRow,
} from '@/lib/sis/backfill/grading/grading-workbook';
import type { RosterLookupEntry } from '@/lib/sis/backfill/grading/build-grading-import';

const BASE_INPUT = { ayCode: 'AY2026', termNumber: 1 };

const ROSTER: RosterLookupEntry[] = [
  {
    levelCode: 'S1',
    sectionName: 'Discipline 1',
    indexNumber: 1,
    sectionStudentId: 'ss-banta-uuid',
  },
  {
    levelCode: 'S1',
    sectionName: 'Discipline 1',
    indexNumber: 2,
    sectionStudentId: 'ss-barroga-uuid',
  },
];

function student(overrides: Partial<GradingStudentRow>): GradingStudentRow {
  return {
    indexNo: '1',
    fullName: 'BANTA, Stephanie Louise S',
    wwScores: [19, 20],
    ptScores: [30, 19, 25],
    examScore: 33,
    printedInitialGrade: 83.98,
    printedQuarterlyGrade: 89,
    ...overrides,
  };
}

function mathSheet(
  overrides: Partial<ParsedSubjectSheet> = {}
): ParsedSubjectSheet {
  return {
    subjectCode: 'MATH',
    levelCode: 'S1',
    sectionName: 'Discipline 1',
    teacherName: 'Ms.J',
    wwWeight: 0.4,
    ptWeight: 0.4,
    qaWeight: 0.2,
    wwTotals: [20, 20],
    ptTotals: [30, 30, 25],
    qaTotal: 65,
    students: [student({})],
    ...overrides,
  };
}

describe('buildGradingImport', () => {
  it('resolves roster, computes grades via the real formula, and writes subject_configs/grading_sheets/grade_entries', () => {
    const result = buildGradingImport({
      ...BASE_INPUT,
      sheets: [mathSheet()],
      rosterLookup: ROSTER,
    });

    expect(result.stats.subjectConfigsWritten).toBe(1);
    expect(result.stats.subjectLevelOfferingsWritten).toBe(1);
    expect(result.stats.sectionSubjectsWritten).toBe(1);
    expect(result.stats.gradingSheetsWritten).toBe(1);
    expect(result.stats.gradeEntriesWritten).toBe(1);
    expect(result.stats.needsReview).toBe(0);
    expect(result.stats.quarterlyMismatches).toBe(0);

    expect(result.apply).toContain("'MATH'");
    expect(result.apply).toContain("'S1'");
    expect(result.apply).toContain('0.4'); // ww_weight / pt_weight
    expect(result.apply).toContain('subject_configs');
    expect(result.apply).toContain('subject_level_offerings');
    expect(result.apply).toContain('section_subjects');
    expect(result.apply).toContain('grading_sheets');
    expect(result.apply).toContain('grade_entries');
    expect(result.apply).toContain("'ss-banta-uuid'");
    expect(result.apply).toContain('is_locked');
    expect(result.apply).toContain('true');
    expect(result.apply).toContain("'backfill-import'");
    // Verify qa_max is emitted as a raw numeric literal, not a quoted string
    expect(result.apply).toMatch(/,\s*65\)/); // qa_max=65 as raw number, not '65'
    expect(result.apply).not.toMatch(/,\s*'65'\)/); // should NOT be quoted
    // subject_configs no longer has a level_id column (migration 080)
    expect(result.apply).not.toMatch(
      /insert into subject_configs \([^)]*level_id/
    );
    expect(result.apply).toMatch(
      /on conflict \(academic_year_id, subject_id\) do update/
    );
  });

  it('flags an unresolved (level, section, index) as needs-review and excludes it from apply.sql', () => {
    const sheet = mathSheet({
      students: [student({ indexNo: '99', fullName: 'NOBODY, Unresolved' })],
    });
    const result = buildGradingImport({
      ...BASE_INPUT,
      sheets: [sheet],
      rosterLookup: ROSTER,
    });

    expect(result.stats.needsReview).toBe(1);
    expect(result.stats.gradeEntriesWritten).toBe(0);
    expect(result.apply).not.toContain('NOBODY');
    expect(result.preview).toContain('NOBODY');
  });

  it('flags a quarterly-grade mismatch but still writes the raw scores (they remain the transcribed truth)', () => {
    const sheet = mathSheet({
      students: [student({ printedQuarterlyGrade: 999 })], // deliberately wrong
    });
    const result = buildGradingImport({
      ...BASE_INPUT,
      sheets: [sheet],
      rosterLookup: ROSTER,
    });

    expect(result.stats.quarterlyMismatches).toBe(1);
    expect(result.stats.gradeEntriesWritten).toBe(1); // still written
    expect(result.apply).toContain("'ss-banta-uuid'");
    expect(result.preview).toContain('quarterly');
  });

  it('cross-checks initial_grade instead when a subject has no printed Quarterly column (Art & Design shape)', () => {
    const sheet: ParsedSubjectSheet = {
      subjectCode: 'ARTD',
      levelCode: 'S1',
      sectionName: 'Discipline 1',
      teacherName: 'Ms. Jing',
      wwWeight: 0.2,
      ptWeight: 0.6,
      qaWeight: 0.2,
      wwTotals: [20],
      ptTotals: [20, 20, 20, 20, 20],
      qaTotal: 20,
      students: [
        {
          indexNo: '1',
          fullName: 'BANTA, Stephanie Louise S.',
          wwScores: [17],
          ptScores: [16, 18, 18, 18, 15],
          examScore: 16,
          printedInitialGrade: 84.0,
          printedQuarterlyGrade: null,
        },
      ],
    };
    const result = buildGradingImport({
      ...BASE_INPUT,
      sheets: [sheet],
      rosterLookup: ROSTER,
    });

    expect(result.stats.quarterlyMismatches).toBe(0); // matches within tolerance
    expect(result.stats.gradeEntriesWritten).toBe(1);
  });

  it('collapses MATH/S1 + MATH/S2 into ONE subject_configs row (migration 080: one row per subject, not per subject×level), while still writing two subject_level_offerings and two grading_sheets rows', () => {
    const s1 = mathSheet();
    const s2 = mathSheet({
      levelCode: 'S2',
      sectionName: 'Integrity 1',
      students: [student({ fullName: 'DELFIN, Demelly Czarina L.' })],
    });
    const result = buildGradingImport({
      ...BASE_INPUT,
      sheets: [s1, s2],
      rosterLookup: [
        ...ROSTER,
        {
          levelCode: 'S2',
          sectionName: 'Integrity 1',
          indexNumber: 1,
          sectionStudentId: 'ss-delfin-uuid',
        },
      ],
    });

    // subject_configs is now one row per subject for the whole AY — S1 and
    // S2 share the config, they do NOT each get their own row.
    expect(result.stats.subjectConfigsWritten).toBe(1);
    // subject_level_offerings still tracks per-level applicability.
    expect(result.stats.subjectLevelOfferingsWritten).toBe(2); // MATH/S1, MATH/S2
    expect(result.stats.sectionSubjectsWritten).toBe(2); // Discipline 1, Integrity 1
    expect(result.stats.gradingSheetsWritten).toBe(2);
    expect(result.apply).toContain('on conflict');
    expect(result.apply).toMatch(/do update/i); // subject_configs
    expect(result.apply).toMatch(/do nothing/i); // offerings / section_subjects / grading_sheets / grade_entries
    // Exactly one MATH row in the subject_configs VALUES block, not two.
    const subjectConfigsMatch = result.apply.match(
      /create temp table _ay26grd_subject_configs[\s\S]*?;/
    );
    expect(subjectConfigsMatch).not.toBeNull();
    expect(subjectConfigsMatch![0].match(/'MATH'/g)).toHaveLength(1);
  });

  it('throws a clear error if the same subject has divergent weights/max-scores between two sections (cannot be represented — subject_configs is one row per subject now)', () => {
    const s1 = mathSheet(); // ww=0.4, wwTotals=[20,20]
    const s2 = mathSheet({
      levelCode: 'S2',
      sectionName: 'Integrity 1',
      ptWeight: 0.5, // deliberately different from s1's 0.4
      students: [student({ fullName: 'DELFIN, Demelly Czarina L.' })],
    });

    expect(() =>
      buildGradingImport({
        ...BASE_INPUT,
        sheets: [s1, s2],
        rosterLookup: [
          ...ROSTER,
          {
            levelCode: 'S2',
            sectionName: 'Integrity 1',
            indexNumber: 1,
            sectionStudentId: 'ss-delfin-uuid',
          },
        ],
      })
    ).toThrow(/divergent weights\/max-scores/);
  });
});
