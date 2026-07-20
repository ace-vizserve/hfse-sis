// __tests__/sis/backfill/attendance/attendance-workbook-t2.test.ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
  extractDateAlignedLabels,
  parseSheetT2,
  type ParsedSectionWithLabels,
} from '@/lib/sis/backfill/attendance/attendance-workbook-t2';

// Mirrors the real T2 masthead shape: 5 header columns before dates begin
// (Index No | Bus No. | Leave info | Classroom Officers | Full Name),
// confirmed identical across every sampled P1-S4 section (design doc §1,
// point 1) — two more than a hypothetical bare "Index No | Full Name"
// shape, exercising Locked Decision #3 (column layout located by label /
// relative offset, never a fixed index). Row 8 (index 8, directly above
// the date-header row at index 9) carries "Good Friday" aligned under the
// "3-Apr" column and is blank everywhere else (design doc §1, point 2).
function buildFixtureRows(): string[][] {
  const rows: string[][] = [];
  rows[0] = ['', '', '', '', '', '', ''];
  rows[1] = [
    'Legend:',
    '',
    '',
    '',
    'Attendance for the month of',
    'April 2026',
    '',
  ];
  rows[2] = [
    '-',
    'No Class',
    '',
    '',
    'Class Section',
    'P1 Patience (AM Global)',
    '',
  ];
  rows[3] = ['P', 'Present', '', '', 'Form Teacher', 'Ms. Kristel', ''];
  rows[4] = ['A', 'Absent', '', '', '', '', ''];
  rows[5] = ['EX', 'Excused', '', '', '', '', ''];
  rows[6] = ['L', 'Late', '', '', '', '', ''];
  rows[7] = ['', '', '', '', '', '', ''];
  rows[8] = ['', '', '', '', '', 'Good Friday', ''];
  rows[9] = [
    'Index \nNo',
    'Bus No.',
    'Leave info',
    'Classroom Officers',
    'Full Name',
    '3-Apr',
    '6-Apr',
  ];
  rows[10] = ['1', 'HAPI HAUS', '', '', 'ALVAREZ, Jaime III D.', '', 'P'];
  rows[11] = ['2', '', '', '', 'AMATE, Jaiden Matthew A.', '', 'P'];
  return rows;
}

describe('extractDateAlignedLabels', () => {
  it('reads the label aligned to its date column from the row directly above the header row', () => {
    const ws = XLSX.utils.aoa_to_sheet(buildFixtureRows());
    expect(extractDateAlignedLabels(ws)).toEqual({ '3-Apr': 'Good Friday' });
  });

  it('omits a date column whose row-8 cell is blank', () => {
    const ws = XLSX.utils.aoa_to_sheet(buildFixtureRows());
    const labels = extractDateAlignedLabels(ws);
    expect(labels['6-Apr']).toBeUndefined();
  });

  it('returns an empty object when no date-header row is found', () => {
    const rows = buildFixtureRows();
    rows[9] = [
      'Index \nNo',
      'Bus No.',
      'Leave info',
      'Classroom Officers',
      'Full Name',
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    expect(extractDateAlignedLabels(ws)).toEqual({});
  });
});

describe('parseSheetT2', () => {
  it('combines the reused roster parser with the new date-label extraction', () => {
    const ws = XLSX.utils.aoa_to_sheet(buildFixtureRows());
    const result: ParsedSectionWithLabels = parseSheetT2(ws, 'P1 Patience(G)');

    // Roster/date parsing is fully delegated to parseSheet (Phase 2,
    // reused as-is) — proves the 2 extra leading columns (Bus No.,
    // Classroom Officers) don't need any T2-specific handling here.
    expect(result.section.sheetName).toBe('P1 Patience(G)');
    expect(result.section.dateColumns).toEqual(['3-Apr', '6-Apr']);
    expect(result.section.students).toEqual([
      {
        indexNo: '1',
        fullName: 'ALVAREZ, Jaime III D.',
        marks: { '3-Apr': '', '6-Apr': 'P' },
      },
      {
        indexNo: '2',
        fullName: 'AMATE, Jaiden Matthew A.',
        marks: { '3-Apr': '', '6-Apr': 'P' },
      },
    ]);

    expect(result.dateLabels).toEqual({ '3-Apr': 'Good Friday' });
  });

  it('returns an empty roster for a Reserved-tab-shaped empty sheet, independent of dateLabels', () => {
    // dateLabels extraction reads only the masthead row above the header
    // row — it doesn't depend on roster content, so it stays populated
    // even when every roster row is blank (a genuinely empty "Reserved N"
    // tab still has its own masthead).
    const rows = buildFixtureRows();
    rows[10] = ['1', '', '', '', '', '', ''];
    rows[11] = ['2', '', '', '', '', '', ''];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const result = parseSheetT2(ws, 'Reserved 1');

    expect(result.section.students).toEqual([]);
    expect(result.dateLabels).toEqual({ '3-Apr': 'Good Friday' });
  });
});
