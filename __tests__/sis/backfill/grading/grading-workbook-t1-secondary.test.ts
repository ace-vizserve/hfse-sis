// __tests__/sis/backfill/grading/grading-workbook-t1-secondary.test.ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseGradingWorkbookT1Secondary } from '@/lib/sis/backfill/grading/grading-workbook-t1-secondary';

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

// Real row shape from Literature's "Literature - Sec 1 Discipline 2" tab in
// T1's Grades folder.
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

// Real row shape from Math's "Math - P1 Patience" tab — used here to prove
// a Primary tab riding along in the same file is skipped, never processed
// as Secondary.
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

describe('parseGradingWorkbookT1Secondary', () => {
  it('parses a real Secondary tab correctly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t1-sec-'));
    const path = join(dir, 'lit.xlsx');
    writeWorkbook(path, { 'Literature - Sec 1 Discipline 2': LIT_SEC1_ROWS });

    const result = parseGradingWorkbookT1Secondary(path, 'LIT');

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
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t1-sec-'));
    const path = join(dir, 'math.xlsx');
    writeWorkbook(path, { 'Math - P1 Patience': MATH_P1_ROWS });

    const result = parseGradingWorkbookT1Secondary(path, 'MATH');

    expect(result.sheets).toHaveLength(0);
    expect(result.skippedPrimary).toEqual(['Math - P1 Patience']);
    expect(result.skippedUnrecognized).toEqual([]);
    expect(result.skippedDoNotUse).toEqual([]);
  });

  it('skips a "DO NOT USE" tab entirely — never in sheets, never leaking a duplicate identity', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t1-sec-'));
    const path = join(dir, 'math-donotuse.xlsx');
    writeWorkbook(path, {
      'DO NOT USE Math - S4 Excellence': [['Term 1 - 2026'], ['irrelevant']],
      'Literature - Sec 1 Discipline 2': LIT_SEC1_ROWS,
    });

    const result = parseGradingWorkbookT1Secondary(path, 'LIT');

    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].sectionName).toBe('Discipline 2');
    expect(result.skippedDoNotUse).toEqual(['DO NOT USE Math - S4 Excellence']);
    expect(result.sheets.some((s) => s.sectionName === 'Excellence')).toBe(
      false
    );
  });

  it('resolves a truncated SS & Geo tab name via row 2, recording a truncation note (real case)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grading-wb-t1-sec-'));
    const path = join(dir, 'ssgeo.xlsx');
    const rows = LIT_SEC1_ROWS.map((r) => [...r]);
    rows[2] = ['Secondary 3 CONSISTENCY - SOCIAL STUDIES & GEOGRAPHY'];
    writeWorkbook(path, {
      'Social Studies&Geography - S3 C': rows,
    });

    const result = parseGradingWorkbookT1Secondary(path, 'SS');

    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].levelCode).toBe('S3');
    expect(result.sheets[0].sectionName).toBe('Consistency');
    expect(result.truncationNotes).toHaveLength(1);
    expect(result.identityCorrections).toEqual([]);
  });
});

describe('parseGradingWorkbookT1Secondary (real fixture files — full 9-file sweep)', () => {
  const DIR = 'AY2026/T1/Term 1 Grades/Grades';
  const FILES: { file: string; code: string }[] = [
    { file: 'English Grading AY2026 T1.xlsx', code: 'ENG' },
    { file: 'Math Grading AY2026 T1.xlsx', code: 'MATH' },
    { file: 'Science Grading AY2026 T1.xlsx', code: 'SCI' },
    { file: 'Filipino Grading AY2026 T1.xlsx', code: 'FIL' },
    { file: 'History Grading AY2026 T1.xlsx', code: 'HIST' },
    { file: 'Literature Grading AY2026 T1.xlsx', code: 'LIT' },
    { file: 'SS & Geo Grading AY2026 T1.xlsx', code: 'SS' },
    { file: 'Contemporary Arts Grading AY2026 T1.xlsx', code: 'CA' },
    { file: 'PE (Sec) Grading AY2026 T1.xlsx', code: 'PEH' },
  ];

  it(
    'parses all 9 real files into exactly 32 sheets / 768 students total, with the exact counts confirmed during design',
    { timeout: 30000 },
    () => {
      let totalSheets = 0;
      let totalStudents = 0;
      let totalDoNotUse = 0;
      let totalPrimarySkipped = 0;
      let totalUnrecognized = 0;
      let totalIdentityCorrections = 0;
      let totalTruncationNotes = 0;
      for (const f of FILES) {
        const result = parseGradingWorkbookT1Secondary(
          `${DIR}/${f.file}`,
          f.code
        );
        totalSheets += result.sheets.length;
        totalStudents += result.sheets.reduce(
          (sum, s) => sum + s.students.length,
          0
        );
        totalDoNotUse += result.skippedDoNotUse.length;
        totalPrimarySkipped += result.skippedPrimary.length;
        totalUnrecognized += result.skippedUnrecognized.length;
        totalIdentityCorrections += result.identityCorrections.length;
        totalTruncationNotes += result.truncationNotes.length;
      }
      expect(totalSheets).toBe(32);
      expect(totalStudents).toBe(768);
      expect(totalDoNotUse).toBe(8);
      expect(totalPrimarySkipped).toBe(64);
      expect(totalUnrecognized).toBe(0);
      expect(totalIdentityCorrections).toBe(0);
      expect(totalTruncationNotes).toBe(6);
    }
  );

  it(
    'History has only Discipline 2 + Integrity 2 — no S3/S4 tabs exist in the real file',
    { timeout: 30000 },
    () => {
      const result = parseGradingWorkbookT1Secondary(
        `${DIR}/History Grading AY2026 T1.xlsx`,
        'HIST'
      );
      expect(result.sheets).toHaveLength(2);
      const sections = result.sheets.map((s) => s.sectionName).sort();
      expect(sections).toEqual(['Discipline 2', 'Integrity 2']);
    }
  );

  it(
    'SS & Geo has only S3 Consistency + S4 Excellence — no S1/S2 tabs exist — and its DO-NOT-USE tab is filtered',
    { timeout: 30000 },
    () => {
      const result = parseGradingWorkbookT1Secondary(
        `${DIR}/SS & Geo Grading AY2026 T1.xlsx`,
        'SS'
      );
      expect(result.sheets).toHaveLength(2);
      const sections = result.sheets.map((s) => s.sectionName).sort();
      expect(sections).toEqual(['Consistency', 'Excellence']);
      expect(result.skippedDoNotUse).toHaveLength(1);
    }
  );
});
