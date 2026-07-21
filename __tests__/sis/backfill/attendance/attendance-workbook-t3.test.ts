// __tests__/sis/backfill/attendance/attendance-workbook-t3.test.ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
  extractDateTags,
  extractIdentityFields,
  extractLegendGroups,
  parseSheetT3,
  type ParsedSectionT3,
} from '@/lib/sis/backfill/attendance/attendance-workbook-t3';

const WIDTH = 40;

function row(overrides: Record<number, string>): string[] {
  const r = new Array(WIDTH).fill('');
  for (const [idx, value] of Object.entries(overrides)) {
    r[Number(idx)] = value;
  }
  return r;
}

// Mirrors the real T3 masthead shape (confirmed by direct inspection of
// the source file — see design doc §1): identity fields at col0/col2
// across rows 4-7; 4 legend groups headed at row 3 (cols 13/20/27/34),
// each group's (date-text, label) pairs at (headerCol, headerCol+2) — all
// 4 land on row 4 in this fixture (4 date-shaped cells total); row 11
// carries the roster's identity-column labels (cols 0-4) AND the row-11
// date-column tags (col5 onward); row 12 is the real date-header row.
// Row 4 ALSO contains scattered single dates in the exact same "D-Mon"
// shape as row 12's — this is the collision that makes Phase 1's
// parseSheet unusable for T3 (see Global Constraints): parseSheet's "first
// row with any date-shaped cell" rule would lock onto row 4. This fixture
// proves the fix works by giving row 12 MORE date-shaped cells (5) than
// row 4's legend dates (4) — the same "most cells wins" property the real
// file has (68 vs <=4), just scaled down to a fixture-sized gap.
function buildFixtureRows(): string[][] {
  const rows: string[][] = [];
  rows[0] = row({});
  rows[1] = row({});
  rows[2] = row({});
  rows[3] = row({
    0: 'CLASS INFORMATION',
    6: 'LEGEND',
    13: 'SCHOOL EVENTS',
    20: 'SCHOOL HOLIDAY',
    27: 'PUBLIC HOLIDAY',
    34: 'EXAMINATION',
  });
  rows[4] = row({
    0: 'Term',
    2: '3',
    6: 'P',
    7: 'Present',
    13: '21-Jul',
    15: 'Racial Harmony Celebration',
    20: '6-Jul',
    22: 'In Lieu of Youth Day',
    27: '9-Aug',
    29: 'National Day',
    34: '26-Aug',
    36: 'Term 3 Exam (Math)',
  });
  rows[5] = row({ 0: 'Course', 2: 'Primary One', 6: 'A', 7: 'Absent' });
  rows[6] = row({
    0: 'Section',
    2: 'Patience (Global)',
    6: 'EX',
    7: 'Excused (MC or Excuse Leave)',
  });
  rows[7] = row({
    0: 'Form Class Adviser',
    2: 'Ms. Kristel',
    6: 'L',
    7: 'Late',
  });
  rows[8] = row({});
  rows[9] = row({});
  rows[10] = row({});
  // 5 date columns (col5-9) — one more than row 4's 4 legend dates, so
  // findHeaderRowIdx's "most date-shaped cells" rule picks row 12, not
  // row 4, exactly the property that breaks on a plain "first row with
  // any match" scan.
  rows[11] = row({
    0: 'Index \r\nNo',
    1: 'Bus No. / Student Care',
    2: 'Academics',
    3: 'Admin',
    4: 'Full Name',
    5: 'SE',
  });
  rows[12] = row({
    5: '21-Jul',
    6: '22-Jul',
    7: '23-Jul',
    8: '24-Jul',
    9: '25-Jul',
  });
  rows[13] = row({
    0: '1',
    4: 'ALVAREZ, Jaime III D.',
    5: 'P',
    6: 'P',
    7: 'P',
    8: 'P',
    9: 'P',
  });
  rows[14] = row({
    0: '2',
    4: 'AMATE, Jaiden Matthew A.',
    5: 'P',
    6: '',
    7: '',
    8: '',
    9: '',
  });
  return rows;
}

describe('extractIdentityFields', () => {
  it('reads Term/Course/Section/Form Class Adviser from two columns after each label', () => {
    const result = extractIdentityFields(buildFixtureRows().slice(0, 8));
    expect(result).toEqual({
      term: '3',
      course: 'Primary One',
      sectionLabel: 'Patience (Global)',
      formAdviser: 'Ms. Kristel',
    });
  });

  it('returns nulls when no identity rows are present', () => {
    expect(extractIdentityFields([])).toEqual({
      term: null,
      course: null,
      sectionLabel: null,
      formAdviser: null,
    });
  });
});

describe('extractLegendGroups', () => {
  it("reads each of the 4 groups' (date-text, label) pairs from their own header column", () => {
    const result = extractLegendGroups(buildFixtureRows());
    expect(result.schoolEvents).toEqual([
      { dateText: '21-Jul', label: 'Racial Harmony Celebration' },
    ]);
    expect(result.schoolHoliday).toEqual([
      { dateText: '6-Jul', label: 'In Lieu of Youth Day' },
    ]);
    expect(result.publicHoliday).toEqual([
      { dateText: '9-Aug', label: 'National Day' },
    ]);
    expect(result.examination).toEqual([
      { dateText: '26-Aug', label: 'Term 3 Exam (Math)' },
    ]);
  });
});

describe('extractDateTags', () => {
  it("reads the row-11 tag aligned to the real date-header row, ignoring the legend rows' own scattered dates", () => {
    const ws = XLSX.utils.aoa_to_sheet(buildFixtureRows());
    // Row 12 is the real header (5 date-shaped cells) — more than row 4's
    // 4 legend dates, so findHeaderRowIdx picks row 12, and the tag comes
    // from row 11 (directly above it), not row 3 (directly above row 4,
    // which would give the wrong answer if the header-row rule regressed
    // to "first row with any match").
    expect(extractDateTags(ws)).toEqual({ '21-Jul': 'SE' });
  });
});

describe('parseSheetT3', () => {
  it('composes identity + legend groups + date tags + roster/marks extraction', () => {
    const ws = XLSX.utils.aoa_to_sheet(buildFixtureRows());
    const result: ParsedSectionT3 = parseSheetT3(ws, 'P1 Patience (Global)');
    expect(result.term).toBe('3');
    expect(result.sectionLabel).toBe('Patience (Global)');
    expect(result.dateTags).toEqual({ '21-Jul': 'SE' });
    expect(result.legendGroups.publicHoliday).toEqual([
      { dateText: '9-Aug', label: 'National Day' },
    ]);
    expect(result.section.dateColumns).toEqual([
      '21-Jul',
      '22-Jul',
      '23-Jul',
      '24-Jul',
      '25-Jul',
    ]);
    expect(result.section.students).toHaveLength(2);
    expect(result.section.students[0]).toEqual({
      indexNo: '1',
      fullName: 'ALVAREZ, Jaime III D.',
      marks: {
        '21-Jul': 'P',
        '22-Jul': 'P',
        '23-Jul': 'P',
        '24-Jul': 'P',
        '25-Jul': 'P',
      },
    });
    expect(result.section.students[1].marks).toEqual({
      '21-Jul': 'P',
      '22-Jul': '',
      '23-Jul': '',
      '24-Jul': '',
      '25-Jul': '',
    });
  });

  it('rejects a non-comma "name" (e.g. a stray label artifact) the same way Phase 1 does', () => {
    const rows = buildFixtureRows();
    rows[15] = row({ 0: '3', 4: 'NOT A REAL NAME', 5: 'P', 6: '' });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const result = parseSheetT3(ws, 'P1 Patience (Global)');
    expect(result.section.students).toHaveLength(2);
    expect(
      result.section.students.some((s) => s.fullName === 'NOT A REAL NAME')
    ).toBe(false);
  });
});
