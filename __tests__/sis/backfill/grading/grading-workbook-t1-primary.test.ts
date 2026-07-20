import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseGradingWorkbookT1Primary } from '@/lib/sis/backfill/grading/grading-workbook-t1-primary';

function writeWorkbook(
  path: string,
  sheets: Record<string, (string | number)[][]>
) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, path);
}

// Real row shape from T1's "Math - P1 Patience" tab, transcribed verbatim.
const MATH_P1_ROWS: (string | number)[][] = [
  ['Term 1 - 2026'],
  [],
  ['Primary 1 PATIENCE - MATH'],
  ['Teacher: Mr. Wai Chung'],
  [],
  [
    'Index No.',
    'NAME',
    'WRITTEN WORKS (40%)',
    '',
    '',
    '',
    '',
    '',
    'PERFORMANCE TASKS (40%)',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'QUARTERLY ',
    '',
    '',
    'Initial',
    'Quarterly',
  ],
  [
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'ASSESSMENT (20%)',
    '',
    '',
    'Grade',
    'Grade',
  ],
  [
    '',
    '',
    'W1',
    'W2',
    'W3',
    'Total',
    'PS',
    'WS',
    'PT1',
    'PT2',
    'PT3',
    'PT4',
    'PT5',
    'Total',
    'PS',
    'WS',
    'Exam',
    'PS',
    'WS',
    '',
    '',
  ],
  [
    '',
    '',
    10,
    10,
    '',
    20,
    '100%',
    '40%',
    10,
    10,
    10,
    '',
    '',
    30,
    '100%',
    '40%',
    30,
    '100%',
    '20%',
    '',
    '',
  ],
  [
    1,
    'ALVAREZ, Jaime III D.',
    10,
    10,
    '',
    20,
    '100.00',
    '40.00',
    6,
    10,
    10,
    '',
    '',
    26,
    '86.67',
    '34.67',
    22,
    '73.33',
    '14.67',
    89.33,
    93,
  ],
];

// Real row shape from Literature's "Literature - Sec 1 Discipline 2" tab —
// a Secondary Regular-track section riding along in the same T1 workbook.
const LIT_SEC1_ROWS: (string | number)[][] = [
  ['Term 1 - 2026'],
  [],
  ['Secondary 1 DISCIPLINE 2 - LITERATURE'],
  ['Teacher: Ms. Carl'],
  [],
  [
    'Index No.',
    'NAME',
    'WRITTEN WORKS (30%)',
    '',
    '',
    '',
    '',
    '',
    'PERFORMANCE TASKS (50%)',
    '',
    '',
    '',
    '',
    '',
    'QUARTERLY ',
    '',
    '',
    'Initial',
    'Quarterly',
  ],
  [],
  [
    '',
    '',
    'W1',
    '',
    '',
    'Total',
    'PS',
    'WS',
    'PT1',
    'PT2',
    'PT3',
    'Total',
    'PS',
    'WS',
    'Exam',
    'PS',
    'WS',
  ],
  [
    '',
    '',
    30,
    '',
    '',
    30,
    '100%',
    '30%',
    30,
    20,
    25,
    75,
    '100%',
    '50%',
    65,
    '100%',
    '20%',
  ],
  [
    1,
    'BAGANG, Miguel C.',
    26,
    '',
    '',
    26,
    '86.67',
    '26.00',
    28,
    19,
    25,
    72,
    '96.00',
    '48.00',
    59,
    '90.77',
    '18.15',
    92.15,
    95,
  ],
];

describe('parseGradingWorkbookT1Primary', () => {
  it('parses a real Primary tab correctly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t1-primary-'));
    const path = join(dir, 'math.xlsx');
    writeWorkbook(path, { 'Math - P1 Patience': MATH_P1_ROWS });

    const result = parseGradingWorkbookT1Primary(path, 'MATH');

    expect(result.sheets).toHaveLength(1);
    const sheet = result.sheets[0];
    expect(sheet.subjectCode).toBe('MATH');
    expect(sheet.levelCode).toBe('P1');
    expect(sheet.sectionName).toBe('Patience');
    expect(sheet.teacherName).toBe('Mr. Wai Chung');
    expect(sheet.wwWeight).toBeCloseTo(0.4);
    expect(sheet.ptWeight).toBeCloseTo(0.4);
    expect(sheet.qaWeight).toBeCloseTo(0.2);

    const alvarez = sheet.students[0];
    expect(alvarez.indexNo).toBe('1');
    expect(alvarez.fullName).toBe('ALVAREZ, Jaime III D.');
    expect(alvarez.printedInitialGrade).toBeCloseTo(89.33);
    expect(alvarez.printedQuarterlyGrade).toBe(93);
    expect(result.identityCorrections).toEqual([]);
  });

  it('recognizes a Secondary tab and reports it as skipped, never processing it as Primary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t1-primary-'));
    const path = join(dir, 'lit.xlsx');
    writeWorkbook(path, { 'Literature - Sec 1 Discipline 2': LIT_SEC1_ROWS });

    const result = parseGradingWorkbookT1Primary(path, 'LIT');

    expect(result.sheets).toHaveLength(0);
    expect(result.skippedSecondary).toEqual([
      'Literature - Sec 1 Discipline 2',
    ]);
    expect(result.skippedUnrecognized).toEqual([]);
  });

  it('falls back to row 2 to correctly identify a Reserved-tab section, then excludes it — Respect/Gentleness/Compassion stay out of scope (same decision as T2)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t1-primary-'));
    const path = join(dir, 'reserved-respect.xlsx');
    const rows = MATH_P1_ROWS.map((r) => [...r]);
    rows[2] = ['Primary 1 RESPECT - MATH'];
    writeWorkbook(path, { 'Reserved 1': rows });

    const result = parseGradingWorkbookT1Primary(path, 'MATH');

    expect(result.sheets).toHaveLength(0);
    expect(result.skippedExcludedSection).toEqual(['Reserved 1']);
    expect(result.identityCorrections).toEqual([]);
  });

  it('uses the TAB NAME over a wrong row-2 label, and records the mismatch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t1-primary-'));
    const path = join(dir, 'eng.xlsx');
    const rows = MATH_P1_ROWS.map((r) => [...r]);
    rows[2] = ['Primary 5 COMMITMENT - ENGLISH'];
    writeWorkbook(path, { 'English - P5 Perseverance': rows });

    const result = parseGradingWorkbookT1Primary(path, 'ENG');

    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].levelCode).toBe('P5');
    expect(result.sheets[0].sectionName).toBe('Perseverance');
    expect(result.identityCorrections).toHaveLength(1);
    expect(result.identityCorrections[0]).toContain(
      'English - P5 Perseverance'
    );
  });
});

// The AY2026/ source folder holds real student PII and is gitignored — it
// exists locally but not in CI. Skip (not fail) this suite when it's absent,
// matching the established pattern in masterfile-grades.test.ts.
const DIR = 'AY2026/T1/Term 1 Grades/Grades';
const d = existsSync(DIR) ? describe : describe.skip;

d(
  'parseGradingWorkbookT1Primary (real fixture files — full 6-subject sweep)',
  () => {
    const FILES: { file: string; code: string }[] = [
      { file: 'English Grading AY2026 T1.xlsx', code: 'ENG' },
      { file: 'Math Grading AY2026 T1.xlsx', code: 'MATH' },
      { file: 'Science Grading AY2026 T1.xlsx', code: 'SCI' },
      { file: 'Filipino Grading AY2026 T1.xlsx', code: 'FIL' },
      { file: 'Mandarin Grading AY2026 T1.xlsx', code: 'MANDARIN' },
      { file: 'STAR MAPEH (PrI) Grading AY2026 T1.xlsx', code: 'MAPEH' },
    ];

    it(
      'parses all 6 real files into exactly 71 sheets / 1279 students total, with the exact per-subject counts confirmed during design',
      { timeout: 30000 },
      () => {
        let totalSheets = 0;
        let totalStudents = 0;
        let totalIdentityCorrections = 0;
        let totalTruncationNotes = 0;
        for (const f of FILES) {
          const result = parseGradingWorkbookT1Primary(
            `${DIR}/${f.file}`,
            f.code
          );
          totalSheets += result.sheets.length;
          totalStudents += result.sheets.reduce(
            (sum, s) => sum + s.students.length,
            0
          );
          totalIdentityCorrections += result.identityCorrections.length;
          totalTruncationNotes += result.truncationNotes.length;
        }
        expect(totalSheets).toBe(71);
        expect(totalStudents).toBe(1279);
        expect(totalIdentityCorrections).toBe(1);
        expect(totalTruncationNotes).toBe(3);
      }
    );

    it(
      'excludes Respect/Gentleness/Compassion consistently across every file that has them',
      { timeout: 30000 },
      () => {
        for (const f of FILES) {
          const result = parseGradingWorkbookT1Primary(
            `${DIR}/${f.file}`,
            f.code
          );
          if (f.code === 'MANDARIN') {
            expect(result.skippedExcludedSection).toHaveLength(0);
          } else {
            expect(result.skippedExcludedSection).toHaveLength(3);
          }
        }
      }
    );

    it(
      'records exactly the one known MAPEH identity correction by name',
      { timeout: 30000 },
      () => {
        const result = parseGradingWorkbookT1Primary(
          `${DIR}/STAR MAPEH (PrI) Grading AY2026 T1.xlsx`,
          'MAPEH'
        );
        expect(result.identityCorrections).toHaveLength(1);
        expect(result.identityCorrections[0]).toContain(
          'MAPEH - P5 Perseverance'
        );
      }
    );
  }
);
