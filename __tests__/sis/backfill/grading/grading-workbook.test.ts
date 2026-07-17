// __tests__/sis/backfill/grading/grading-workbook.test.ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseGradingWorkbook } from '@/lib/sis/backfill/grading/grading-workbook';

// Builds a throwaway .xlsx on disk mirroring the real HFSE grading-sheet
// masthead shape, so the parser can be exercised the same way it will run
// for real — via XLSX.readFile, not against pre-parsed in-memory rows.
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

// Real row shape from the Mathematics workbook's "Math - Sec 1 Discipline 1"
// tab (2 real WW slots of 3 nominal columns, 3 PT slots, 2 trailing printed
// grade columns) — values transcribed verbatim from the source file.
const MATH_SEC1_ROWS: (string | number)[][] = [
  ['Term 1 - 2026'],
  ['GLOBAL CLASS'],
  ['Secondary 1 DISCIPLINE 1 '],
  ['Teacher: Ms.J'],
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
    20,
    20,
    '',
    40,
    '100%',
    '40%',
    30,
    30,
    25,
    85,
    '100%',
    '40%',
    65,
    '100%',
    '20%',
    '',
    '',
  ],
  [
    1,
    'BANTA, Stephanie Louise S',
    19,
    20,
    '',
    39,
    '97.50',
    '39.00',
    30,
    19,
    25,
    74,
    '87.06',
    '34.82',
    33,
    '50.77',
    '10.15',
    '83.98',
    89,
  ],
  [
    2,
    'BARROGA, Ysrael M.',
    17,
    17,
    '',
    34,
    '85.00',
    '34.00',
    28,
    23,
    25,
    76,
    '89.41',
    '35.76',
    54,
    '83.08',
    '16.62',
    '86.38',
    91,
  ],
  // Trailing blank template rows — the real workbook has ~1000 of these;
  // 2 is enough to exercise the row-boundary detection.
  [3, ''],
  [4, ''],
];

// Real row shape from the Art and Design workbook's "Art and Design - Sec 1
// Discipli" tab — 1 real WW slot (of 3 nominal columns), 5 PT slots, and
// only ONE trailing printed-grade column (Initial only, no Quarterly).
const ARTD_SEC1_ROWS: (string | number)[][] = [
  ['Term 1 - 2026'],
  ['GLOBAL CLASS'],
  ['Secondary 1 DISCIPLINE 1 - ART AND DESIGN'],
  ['Teacher:  Ms. Jing'],
  [],
  [
    'Index No.',
    'NAME',
    'WRITTEN WORKS (20%)',
    '',
    '',
    '',
    '',
    '',
    'PERFORMANCE TASKS (60%)',
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
  ],
  [
    '',
    '',
    20,
    '',
    '',
    20,
    '100%',
    '20%',
    20,
    20,
    20,
    20,
    20,
    100,
    '100%',
    '60%',
    20,
    '100%',
    '20%',
    '',
  ],
  [
    1,
    'BANTA, Stephanie Louise S.',
    17,
    '',
    '',
    17,
    '85.00',
    '17.00',
    16,
    18,
    18,
    18,
    15,
    85,
    '85.00',
    '51.00',
    16,
    '80.00',
    '16.00',
    '84.00',
  ],
];

describe('parseGradingWorkbook', () => {
  it('reads level/section identity, weights (from row 8 WS%, not the row 5 label), max-scores, and student rows — Math shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-'));
    const path = join(dir, 'math.xlsx');
    writeWorkbook(path, {
      'Math - Sec 1 Discipline 1': MATH_SEC1_ROWS,
      'DO NOT USE Literature - Sec 4 E': [['Term 1 - 2025'], ['irrelevant']],
    });

    const sheets = parseGradingWorkbook(path, 'MATH');

    // The stale tab must never appear in the output.
    expect(sheets).toHaveLength(1);

    const sheet = sheets[0];
    expect(sheet.subjectCode).toBe('MATH');
    expect(sheet.levelCode).toBe('S1');
    expect(sheet.sectionName).toBe('Discipline 1');
    expect(sheet.teacherName).toBe('Ms.J');
    expect(sheet.wwWeight).toBeCloseTo(0.4);
    expect(sheet.ptWeight).toBeCloseTo(0.4);
    expect(sheet.qaWeight).toBeCloseTo(0.2);
    // Only 2 real WW slots — the blank-max 3rd nominal column is excluded.
    expect(sheet.wwTotals).toEqual([20, 20]);
    expect(sheet.ptTotals).toEqual([30, 30, 25]);
    expect(sheet.qaTotal).toBe(65);

    expect(sheet.students).toHaveLength(2);
    const banta = sheet.students[0];
    expect(banta.indexNo).toBe('1');
    expect(banta.fullName).toBe('BANTA, Stephanie Louise S');
    expect(banta.wwScores).toEqual([19, 20]);
    expect(banta.ptScores).toEqual([30, 19, 25]);
    expect(banta.examScore).toBe(33);
    expect(banta.printedInitialGrade).toBeCloseTo(83.98);
    expect(banta.printedQuarterlyGrade).toBe(89);
  });

  it('reads a subject with only 1 real WW slot, 5 PT slots, and no separate printed Quarterly column — Art & Design shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-'));
    const path = join(dir, 'artd.xlsx');
    writeWorkbook(path, {
      'Art and Design - Sec 1 Discipli': ARTD_SEC1_ROWS,
      'DO NOT USE Literature - Sec 4 E': [['Term 1 - 2025']],
    });

    const sheets = parseGradingWorkbook(path, 'ARTD');
    expect(sheets).toHaveLength(1);

    const sheet = sheets[0];
    expect(sheet.wwWeight).toBeCloseTo(0.2);
    expect(sheet.ptWeight).toBeCloseTo(0.6);
    expect(sheet.qaWeight).toBeCloseTo(0.2);
    expect(sheet.wwTotals).toEqual([20]); // only 1 real slot
    expect(sheet.ptTotals).toEqual([20, 20, 20, 20, 20]);
    expect(sheet.qaTotal).toBe(20);

    const banta = sheet.students[0];
    expect(banta.wwScores).toEqual([17]);
    expect(banta.ptScores).toEqual([16, 18, 18, 18, 15]);
    expect(banta.examScore).toBe(16);
    expect(banta.printedInitialGrade).toBeCloseTo(84.0);
    // No separate "Quarterly" label in this sheet's header — must be null,
    // never guessed or derived.
    expect(banta.printedQuarterlyGrade).toBeNull();
  });

  it('skips any tab whose name starts with "DO NOT USE", regardless of position', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-'));
    const path = join(dir, 'two-real-tabs.xlsx');
    const sec2Rows = MATH_SEC1_ROWS.map((row) => [...row]);
    sec2Rows[2] = ['Secondary 2 INTEGRITY 1 -'];
    writeWorkbook(path, {
      'DO NOT USE Literature - Sec 4 E': [['Term 1 - 2025']],
      'Math - Sec 1 Discipline 1': MATH_SEC1_ROWS,
      'Math - Sec 2 Integrity 1': sec2Rows,
    });

    const sheets = parseGradingWorkbook(path, 'MATH');
    expect(sheets).toHaveLength(2);
    expect(sheets.map((s) => s.sectionName)).toEqual([
      'Discipline 1',
      'Integrity 1',
    ]);
    expect(sheets.map((s) => s.levelCode)).toEqual(['S1', 'S2']);
  });

  it('stops reading student rows at the first blank name (trailing template rows)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-'));
    const path = join(dir, 'bounds.xlsx');
    writeWorkbook(path, { 'Math - Sec 1 Discipline 1': MATH_SEC1_ROWS });

    const sheets = parseGradingWorkbook(path, 'MATH');
    // MATH_SEC1_ROWS has 2 real students (BANTA, BARROGA) then 2 rows with
    // an index number but a blank name — those must not be read as students.
    expect(sheets[0].students).toHaveLength(2);
  });
});
