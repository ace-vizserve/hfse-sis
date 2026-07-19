// __tests__/sis/backfill/grading/grading-workbook-secondary-t2.test.ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseGradingWorkbookSecondaryT2 } from '@/lib/sis/backfill/grading/grading-workbook-secondary-t2';

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

// Real row shape from Literature's "Literature - Sec 1 Discipline 2" tab.
const LIT_SEC1_ROWS: (string | number)[][] = [
  ['Term 2 - 2026'],
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

// Real row shape from Math's "Math - P1 Patience" tab — used here to prove
// a Primary tab riding along in the same file is skipped, never processed.
const MATH_P1_ROWS: (string | number)[][] = [
  ['Term 2 - 2026'],
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
    30,
    '100%',
    '40%',
    30,
    '100%',
    '20%',
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
    9,
    6,
    10,
    25,
    '83.33',
    '33.33',
    22,
    '73.33',
    '14.67',
    88.0,
    92,
  ],
];

describe('parseGradingWorkbookSecondaryT2', () => {
  it('parses a real Secondary tab correctly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-sec-t2-'));
    const path = join(dir, 'lit.xlsx');
    writeWorkbook(path, { 'Literature - Sec 1 Discipline 2': LIT_SEC1_ROWS });

    const result = parseGradingWorkbookSecondaryT2(path, 'LIT');

    expect(result.sheets).toHaveLength(1);
    const sheet = result.sheets[0];
    expect(sheet.subjectCode).toBe('LIT');
    expect(sheet.levelCode).toBe('S1');
    expect(sheet.sectionName).toBe('Discipline 2');
    expect(sheet.teacherName).toBe('Ms. Carl');
    expect(sheet.wwWeight).toBeCloseTo(0.3);
    expect(sheet.ptWeight).toBeCloseTo(0.5);
    expect(sheet.qaWeight).toBeCloseTo(0.2);
    const bagang = sheet.students[0];
    expect(bagang.printedInitialGrade).toBeCloseTo(92.15);
    expect(bagang.printedQuarterlyGrade).toBe(95);
  });

  it('recognizes a Primary tab riding along in the same file and skips it, never processing it as Secondary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-sec-t2-'));
    const path = join(dir, 'math.xlsx');
    writeWorkbook(path, { 'Math - P1 Patience': MATH_P1_ROWS });

    const result = parseGradingWorkbookSecondaryT2(path, 'MATH');

    expect(result.sheets).toHaveLength(0);
    expect(result.skippedPrimary).toEqual(['Math - P1 Patience']);
    expect(result.skippedUnrecognized).toEqual([]);
  });

  it('reports a blank/Reserved tab as unrecognized, not an error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-sec-t2-'));
    const path = join(dir, 'reserved.xlsx');
    writeWorkbook(path, { 'Reserved 1': [[''], [''], ['']] });

    const result = parseGradingWorkbookSecondaryT2(path, 'LIT');

    expect(result.sheets).toHaveLength(0);
    expect(result.skippedUnrecognized).toEqual(['Reserved 1']);
    expect(result.skippedPrimary).toEqual([]);
  });

  it('resolves a truncated SS & Geo tab name via row 2, recording a truncation note (real case)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-sec-t2-'));
    const path = join(dir, 'ssgeo.xlsx');
    const rows = LIT_SEC1_ROWS.map((r) => [...r]);
    rows[2] = ['Secondary 3 CONSISTENCY - SOCIAL STUDIES & GEOGRAPHY'];
    writeWorkbook(path, {
      'Social Studies&Geography - S3 C': rows,
    });

    const result = parseGradingWorkbookSecondaryT2(path, 'SS');

    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].levelCode).toBe('S3');
    expect(result.sheets[0].sectionName).toBe('Consistency');
    expect(result.truncationNotes).toHaveLength(1);
    expect(result.identityCorrections).toEqual([]);
  });

  it('dedupes the real Reserved-4/English-S1-Discipline-2 identity collision, keeping only the scored sheet (real fixture, Task 6 amendment)', () => {
    const path = join(
      'AY2026',
      'T2',
      'Term 2 Grades',
      'GRADES',
      'English Grading AY2026 T2.xlsx'
    );

    const result = parseGradingWorkbookSecondaryT2(path, 'ENG');

    const s1Discipline2Sheets = result.sheets.filter(
      (s) => s.levelCode === 'S1' && s.sectionName === 'Discipline 2'
    );
    expect(s1Discipline2Sheets).toHaveLength(1);
    expect(
      s1Discipline2Sheets[0].students.some(
        (s) =>
          s.wwScores.some((v) => v != null) ||
          s.ptScores.some((v) => v != null) ||
          s.examScore != null
      )
    ).toBe(true);

    expect(result.duplicateIdentityNotes).toHaveLength(1);
    expect(result.duplicateIdentityNotes[0]).toContain('Reserved 4');
    expect(result.duplicateIdentityNotes[0]).toContain(
      'English - S1 Discipline 2'
    );
  });
});
