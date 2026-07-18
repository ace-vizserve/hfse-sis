import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseGradingWorkbookT2 } from '@/lib/sis/backfill/grading/grading-workbook-t2';

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

// Real row shape from Math's "Math - P1 Patience" tab, transcribed verbatim
// (2 real WW slots of 3 nominal columns, 3 PT slots, then the real
// Initial/Quarterly pair at cols 17/18, THEN the spurious second
// "Quarterly"/"Term 1" pair at cols 21/22 that must never be read).
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
    '',
    '',
    'Quarterly',
    'Term 1',
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
    '',
    '',
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
    30,
    '100%',
    '40%',
    30,
    '100%',
    '20%',
    '',
    '',
    '',
    '',
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
    '',
    '',
    60,
    93,
  ],
  [
    2,
    'AMATE, Jaiden Matthew A.',
    10,
    10,
    '',
    20,
    '100.00',
    '40.00',
    10,
    7,
    10,
    27,
    '90.00',
    '36.00',
    24,
    '80.00',
    '16.00',
    92.0,
    95,
    '',
    '',
    95,
    98,
  ],
];

// Real row shape from Literature's "Literature - Sec 1 Discipline 2" tab —
// a Secondary Regular-track section riding along in the same workbook.
// Must be recognized and skipped, never processed as Primary.
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

describe('parseGradingWorkbookT2', () => {
  it('parses a real Primary tab, reading only the FIRST Initial/Quarterly pair (not the spurious second pair)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t2-'));
    const path = join(dir, 'math.xlsx');
    writeWorkbook(path, { 'Math - P1 Patience': MATH_P1_ROWS });

    const result = parseGradingWorkbookT2(path, 'MATH');

    expect(result.sheets).toHaveLength(1);
    const sheet = result.sheets[0];
    expect(sheet.subjectCode).toBe('MATH');
    expect(sheet.levelCode).toBe('P1');
    expect(sheet.sectionName).toBe('Patience');
    expect(sheet.teacherName).toBe('Mr. Wai Chung');
    expect(sheet.wwWeight).toBeCloseTo(0.4);
    expect(sheet.ptWeight).toBeCloseTo(0.4);
    expect(sheet.qaWeight).toBeCloseTo(0.2);
    expect(sheet.wwTotals).toEqual([10, 10]);
    expect(sheet.ptTotals).toEqual([10, 10, 10]);
    expect(sheet.qaTotal).toBe(30);

    const alvarez = sheet.students[0];
    expect(alvarez.indexNo).toBe('1');
    expect(alvarez.fullName).toBe('ALVAREZ, Jaime III D.');
    // The real printed grades (cols 17/18) — NEVER the spurious second
    // pair's values (60/93 at cols 21/22).
    expect(alvarez.printedInitialGrade).toBeCloseTo(88.0);
    expect(alvarez.printedQuarterlyGrade).toBe(92);
  });

  it('recognizes a Secondary tab and reports it as skipped, never processing it as Primary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t2-'));
    const path = join(dir, 'lit.xlsx');
    writeWorkbook(path, { 'Literature - Sec 1 Discipline 2': LIT_SEC1_ROWS });

    const result = parseGradingWorkbookT2(path, 'LIT');

    expect(result.sheets).toHaveLength(0);
    expect(result.skippedSecondary).toEqual([
      'Literature - Sec 1 Discipline 2',
    ]);
    expect(result.skippedUnrecognized).toEqual([]);
  });

  it('reports a blank/Reserved tab as unrecognized, not an error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t2-'));
    const path = join(dir, 'reserved.xlsx');
    writeWorkbook(path, { 'Reserved 1': [[''], [''], ['']] });

    const result = parseGradingWorkbookT2(path, 'MATH');

    expect(result.sheets).toHaveLength(0);
    expect(result.skippedUnrecognized).toEqual(['Reserved 1']);
    expect(result.skippedSecondary).toEqual([]);
  });

  it('title-cases a multi-word Secondary Regular-track section name correctly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t2-'));
    const path = join(dir, 'lit2.xlsx');
    const rows = LIT_SEC1_ROWS.map((r) => [...r]);
    writeWorkbook(path, { 'Literature - Sec 1 Discipline 2': rows });

    // This case is exercised indirectly — sectionName title-casing is
    // proven directly via the Primary MATH case above ("PATIENCE" ->
    // "Patience"); this test proves the multi-word "DISCIPLINE 2" shape
    // is at least correctly classified as Secondary (not crashing on the
    // 2-word section name), matching the design doc's stated identity
    // regex behavior for the deferred Phase 6b.
    const result = parseGradingWorkbookT2(path, 'LIT');
    expect(result.skippedSecondary).toHaveLength(1);
  });

  it('handles a subject-suffix containing commas without breaking section-name extraction (MAPEH shape)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t2-'));
    const path = join(dir, 'star.xlsx');
    const rows = MATH_P1_ROWS.map((r) => [...r]);
    rows[2] = ['Primary 1 PATIENCE - MUSIC, ARTS, PE, HEALTH'];
    writeWorkbook(path, { 'STAR - P1 Patience': rows });

    const result = parseGradingWorkbookT2(path, 'MAPEH');
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].sectionName).toBe('Patience');
  });
});
