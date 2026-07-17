// __tests__/sis/backfill/enrollment/attendance-workbook.test.ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { parseSheet } from '@/lib/sis/backfill/enrollment/attendance-workbook';

// Builds a minimal sheet matching the real HFSE masthead layout: 9 header
// rows (masthead), then a column-header row containing dated columns, then
// roster rows. Mirrors "P1 Patience(G)" from the real workbook, trimmed to
// 2 date columns instead of 47, and with a "School Holiday" / "Important
// dates" legend pair at columns 10/14 (mirroring the real file's Jan block).
function buildFixtureRows(): string[][] {
  const rows: string[][] = [];
  rows[0] = ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
  rows[1] = [
    'Legend:',
    '',
    '',
    '',
    'Attendance for the month of',
    'January 2026',
    '',
    '',
    '',
    '',
    'School Holiday',
    '',
    '',
    '',
    'Important dates',
  ];
  rows[2] = [
    '-',
    'No Class',
    '',
    '',
    'Class Section',
    'P1 Patience (AM Global)',
    '',
    '',
    '',
    '',
    'Feb 17-18 CNY',
    '',
    '',
    '',
    'Feb 2-6 Mathematics Week',
  ];
  rows[3] = [
    'P',
    'Present',
    '',
    '',
    'Form Teacher',
    'Ms. Kristel',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'Feb 20 Staff Development Day',
  ];
  rows[4] = [
    'A',
    'Absent',
    '',
    '',
    'Students - ',
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
  ];
  rows[5] = [
    'EX',
    'Excused',
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
  ];
  rows[6] = ['L', 'Late', '', '', '', '', '', '', '', '', '', '', '', '', ''];
  rows[7] = [
    '',
    '',
    '',
    '',
    'Homeroom ',
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
  ];
  rows[8] = [
    '',
    '',
    '4 Vacation Leaves',
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
  ];
  rows[9] = [
    'Index \nNo',
    'Bus No.',
    '5 days leave',
    'Classroom Officers',
    'Full Name',
    '8-Jan',
    '9-Jan',
    'Days present',
    'Attendance %',
  ];
  rows[10] = [
    '1',
    'HAPI HAUS',
    '',
    '',
    'ALVAREZ, Jaime III D.',
    'P',
    'P',
    '2',
    '100.00',
  ];
  rows[11] = [
    '2',
    '',
    '',
    '',
    'AMATE, Jaiden Matthew A.',
    'P',
    'A',
    '1',
    '50.00',
  ];
  rows[12] = ['', '', '', '', '', '', '', '', ''];
  return rows;
}

describe('parseSheet', () => {
  it('extracts masthead + roster from a well-formed section sheet', () => {
    const ws = XLSX.utils.aoa_to_sheet(buildFixtureRows());
    const result = parseSheet(ws, 'P1 Patience(G)');

    expect(result.sheetName).toBe('P1 Patience(G)');
    expect(result.classSectionLabel).toBe('P1 Patience (AM Global)');
    expect(result.formTeacher).toBe('Ms. Kristel');
    expect(result.firstDate).toBe('8-Jan');
    expect(result.lastDate).toBe('9-Jan');
    expect(result.dateColumns).toEqual(['8-Jan', '9-Jan']);
    expect(result.students).toEqual([
      {
        indexNo: '1',
        fullName: 'ALVAREZ, Jaime III D.',
        marks: { '8-Jan': 'P', '9-Jan': 'P' },
      },
      {
        indexNo: '2',
        fullName: 'AMATE, Jaiden Matthew A.',
        marks: { '8-Jan': 'P', '9-Jan': 'A' },
      },
    ]);
    expect(result.rejectedNames).toEqual([]);
  });

  it('returns an empty roster for a section with no students', () => {
    const rows = buildFixtureRows();
    rows[10] = ['1', '', '', '', '', '', '', '0', '#DIV/0!'];
    rows[11] = ['2', '', '', '', '', '', '', '0', '#DIV/0!'];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const result = parseSheet(ws, 'Reserved 1');

    expect(result.students).toEqual([]);
    expect(result.rejectedNames).toEqual([]);
  });

  it('rejects a stray second-table "Name" header row landing in the name column', () => {
    // Real sheets have an unrelated second mini-table further down (well
    // past the roster) with its own header row that happens to put the
    // literal text "Name" in the same positional column as the roster's
    // "Full Name" — e.g. row content ["", "", "", "Absent PM - Date",
    // "Name", ""]. It must not be mistaken for a real student.
    const rows = buildFixtureRows();
    rows[13] = ['', '', '', 'Absent PM - Date', 'Name', '', '', '', ''];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const result = parseSheet(ws, 'P1 Patience(G)');

    expect(result.students).toEqual([
      {
        indexNo: '1',
        fullName: 'ALVAREZ, Jaime III D.',
        marks: { '8-Jan': 'P', '9-Jan': 'P' },
      },
      {
        indexNo: '2',
        fullName: 'AMATE, Jaiden Matthew A.',
        marks: { '8-Jan': 'P', '9-Jan': 'A' },
      },
    ]);
    expect(result.rejectedNames).toEqual(['Name']);
  });

  it('returns an empty roster when the only non-blank name-column value is the stray "Name" artifact', () => {
    // The Reserved 1 / Reserved 3 real-data failure mode: a genuinely empty
    // section tab whose ONLY non-blank cell in the name column is the stray
    // second-table header, not a real student.
    const rows = buildFixtureRows();
    rows[10] = ['1', '', '', '', '', '', '', '0', '#DIV/0!'];
    rows[11] = ['2', '', '', '', '', '', '', '0', '#DIV/0!'];
    rows[13] = ['', '', '', 'Absent PM - Date', 'Name', '', '', '', ''];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const result = parseSheet(ws, 'Reserved 1');

    expect(result.students).toEqual([]);
    expect(result.rejectedNames).toEqual(['Name']);
  });

  it('finds the Class Section / Form Teacher label even at a different column offset', () => {
    // YS-style masthead has one fewer leading column before the labels.
    const rows = buildFixtureRows();
    rows[2] = [
      '-',
      'No Class',
      '',
      'Class Section',
      'YS Faith - Little&Junior Stars',
      '',
      '',
      '',
      '',
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const result = parseSheet(ws, 'YS');

    expect(result.classSectionLabel).toBe('YS Faith - Little&Junior Stars');
  });

  it('extracts legend entries from both the School Holiday and Important dates columns', () => {
    const ws = XLSX.utils.aoa_to_sheet(buildFixtureRows());
    const result = parseSheet(ws, 'P1 Patience(G)');

    expect(result.legendEntries).toEqual([
      { rawText: 'Feb 17-18 CNY', column: 'schoolHoliday' },
      { rawText: 'Feb 2-6 Mathematics Week', column: 'importantDates' },
      { rawText: 'Feb 20 Staff Development Day', column: 'importantDates' },
    ]);
  });

  it('returns an empty legendEntries array when no legend headers are present', () => {
    const rows = buildFixtureRows();
    rows[1][10] = '';
    rows[1][14] = '';
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const result = parseSheet(ws, 'P1 Patience(G)');

    expect(result.legendEntries).toEqual([]);
  });
});
