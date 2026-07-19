// __tests__/sis/backfill/grading/grading-workbook-global-t2.test.ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseGradingWorkbookGlobalT2 } from '@/lib/sis/backfill/grading/grading-workbook-global-t2';

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

// Real row shape from Mathematics Global Class's "Math - Sec 1 Discipline 1"
// tab, transcribed verbatim — including the spurious second
// "Quarterly"/"Term 1" pair at cols 23/24 that must never be read.
const MATH_GLOBAL_SEC1_ROWS: (string | number)[][] = [
  ['Term 2 - 2026'],
  ['GLOBAL CLASS'],
  ['Secondary 1 DISCIPLINE 1 - MATHEMATICS'],
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
    70,
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
    'BANTA, Stephanie Louise S.',
    10,
    12,
    '',
    22,
    '55.00',
    '22.00',
    26,
    20,
    23,
    69,
    '81.18',
    '32.47',
    48,
    '68.57',
    '13.71',
    68.18,
    80,
    '',
    '',
    80,
    89,
  ],
];

describe('parseGradingWorkbookGlobalT2', () => {
  it('parses a real Global-track Secondary tab, reading only the FIRST Initial/Quarterly pair', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-global-t2-'));
    const path = join(dir, 'math.xlsx');
    writeWorkbook(path, {
      'Math - Sec 1 Discipline 1': MATH_GLOBAL_SEC1_ROWS,
    });

    const result = parseGradingWorkbookGlobalT2(path, 'MATH');

    expect(result.sheets).toHaveLength(1);
    const sheet = result.sheets[0];
    expect(sheet.levelCode).toBe('S1');
    expect(sheet.sectionName).toBe('Discipline 1');
    expect(sheet.wwWeight).toBeCloseTo(0.4);
    const banta = sheet.students[0];
    expect(banta.printedInitialGrade).toBeCloseTo(68.18);
    expect(banta.printedQuarterlyGrade).toBe(80); // NEVER the spurious 89
  });

  it('skips any tab whose name starts with "DO NOT USE"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-global-t2-'));
    const path = join(dir, 'math2.xlsx');
    writeWorkbook(path, {
      'DO NOT USE Literature - Sec 4 E': [['Term 2 - 2026'], ['irrelevant']],
      'Math - Sec 1 Discipline 1': MATH_GLOBAL_SEC1_ROWS,
    });

    const result = parseGradingWorkbookGlobalT2(path, 'MATH');
    expect(result.sheets).toHaveLength(1);
    expect(result.skippedDoNotUse).toEqual(['DO NOT USE Literature - Sec 4 E']);
  });

  it('reports a non-DO-NOT-USE unrecognized tab separately from skippedDoNotUse', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-global-t2-'));
    const path = join(dir, 'blank.xlsx');
    writeWorkbook(path, { Sheet2: [[''], [''], ['']] });

    const result = parseGradingWorkbookGlobalT2(path, 'MANDARIN');
    expect(result.sheets).toHaveLength(0);
    expect(result.skippedUnrecognized).toEqual(['Sheet2']);
    expect(result.skippedDoNotUse).toEqual([]);
  });
});
