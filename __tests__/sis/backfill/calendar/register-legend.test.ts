import { describe, expect, it } from 'vitest';

import {
  alignedLabelsAt,
  extractLegendGroupsWide,
  levelOfSheet,
  parseLooseLegendCell,
} from '@/lib/sis/backfill/calendar/register-legend';

describe('parseLooseLegendCell', () => {
  it('rejects the month banner every T1/T2 sheet prints above the grid', () => {
    // "January 2026" read as "Jan 20" + label "26" before the (?!\d) guard,
    // inventing a holiday on the 20th of each month.
    expect(parseLooseLegendCell('January 2026', 2026)).toBeNull();
    expect(parseLooseLegendCell('March 2026', 2026)).toBeNull();
    expect(
      parseLooseLegendCell('Attendance for the month of', 2026)
    ).toBeNull();
  });

  it('rejects a cell whose label is only digits', () => {
    expect(parseLooseLegendCell('Feb 17 26', 2026)).toBeNull();
  });

  it('reads a single date with a separator dash', () => {
    expect(parseLooseLegendCell('Mar 6 - Marking Day', 2026)).toEqual({
      startDate: '2026-03-06',
      endDate: '2026-03-06',
      label: 'Marking Day',
    });
  });

  it('reads a tight range', () => {
    expect(parseLooseLegendCell('Feb 17-18  CNY', 2026)).toEqual({
      startDate: '2026-02-17',
      endDate: '2026-02-18',
      label: 'CNY',
    });
  });

  it('reads a range that also carries a separator dash', () => {
    expect(parseLooseLegendCell('Feb 2-6  - Mathematics Week', 2026)).toEqual({
      startDate: '2026-02-02',
      endDate: '2026-02-06',
      label: 'Mathematics Week',
    });
  });

  it("reads the school's typo'd month and spaced range dash", () => {
    // Real cell from the AY2026 T2 workbook: "Apri 8 - 9 General PTC".
    expect(parseLooseLegendCell('Apri 8 - 9 General PTC', 2026)).toEqual({
      startDate: '2026-04-08',
      endDate: '2026-04-09',
      label: 'General PTC',
    });
  });

  it('collapses the newline inside a wrapped label', () => {
    expect(
      parseLooseLegendCell('Mar 11-13 - Eye & Dental\nFirst Vaccination', 2026)
    ).toEqual({
      startDate: '2026-03-11',
      endDate: '2026-03-13',
      label: 'Eye & Dental First Vaccination',
    });
  });

  it('rejects an end date before the start date', () => {
    expect(parseLooseLegendCell('Mar 11-3 Something', 2026)).toBeNull();
  });

  it('rejects a day the month does not have', () => {
    // resolveDate pads without validating, so "Feb 30" produced 2026-02-30 and
    // silently became 2 March once expanded.
    expect(parseLooseLegendCell('Feb 30 Something', 2026)).toBeNull();
    expect(parseLooseLegendCell('Apr 31 Something', 2026)).toBeNull();
  });

  it('accepts the last real day of a short month', () => {
    expect(parseLooseLegendCell('Feb 28 Something', 2026)?.startDate).toBe(
      '2026-02-28'
    );
  });
});

describe('levelOfSheet', () => {
  it('reads the level off a section tab', () => {
    expect(levelOfSheet('P6 Grit')).toBe('P6');
    expect(levelOfSheet('S1 Discipline - 1')).toBe('S1');
    expect(levelOfSheet('P1 Patience (Global)')).toBe('P1');
  });

  it('returns null for the non-section tabs', () => {
    expect(levelOfSheet('YS')).toBeNull();
    expect(levelOfSheet('For ADMIN_Bus Summary')).toBeNull();
    expect(levelOfSheet('Reference - Dropdown')).toBeNull();
  });
});

describe('alignedLabelsAt', () => {
  const rows = [
    [],
    [],
    [],
    ['', '', 'SCHOOL EVENTS', '', 'SCHOOL HOLIDAY'],
    ['', 'Marking Day', 'SE', 'Good Friday', 'SH'],
    ['', '5-Mar', '6-Mar', '3-Apr', '4-Apr'],
  ];

  it('reads the row directly above the given header row', () => {
    expect(alignedLabelsAt(rows, 5)).toEqual({
      '5-Mar': 'Marking Day',
      '3-Apr': 'Good Friday',
    });
  });

  it('skips day tags, which are codes and not event names', () => {
    expect(alignedLabelsAt(rows, 5)['6-Mar']).toBeUndefined();
    expect(alignedLabelsAt(rows, 5)['4-Apr']).toBeUndefined();
  });

  it('skips the masthead group headings', () => {
    // The T3 trap: locking onto the legend row makes the four group headings
    // look like event labels.
    const t3ish = [
      [],
      [],
      [],
      ['SCHOOL EVENTS', 'PUBLIC HOLIDAY'],
      ['6-Jul', '9-Aug'],
    ];
    expect(alignedLabelsAt(t3ish, 4)).toEqual({});
  });

  it('returns nothing when the header row is the first row', () => {
    expect(alignedLabelsAt(rows, 0)).toEqual({});
  });
});

describe('extractLegendGroupsWide', () => {
  // Mirrors the real P6 Grit / S4 Excellence shape: heading on row index 3,
  // pairs two columns apart, running PAST row 7.
  const rows = [
    [],
    [],
    [],
    ['CLASS INFORMATION', '', '', '', '', '', 'EXAMINATION'],
    ['Term', '', '', '', '', '', '20-Aug', '', 'Term 3 Exam (Science Paper 1)'],
    ['Course', '', '', '', '', '', '21-Aug', '', 'Term 3 Exam (English)'],
    ['Section', '', '', '', '', '', '24-Aug', '', 'Term 3 Exam (Chemistry)'],
    [
      'Adviser',
      '',
      '',
      '',
      '',
      '',
      '25-Aug',
      '',
      'Term 3 Exam (Social Studies)',
    ],
    ['', '', '', '', '', '', '26-Aug', '', 'Term 3 Exam (Biology)'],
    ['', '', '', '', '', '', '27-Aug', '', 'Term 3 Exam (Geography)'],
  ];

  it('reads entries past row 7, which the shipped T3 parser truncates', () => {
    const groups = extractLegendGroupsWide(rows);
    expect(groups.examination).toHaveLength(6);
    expect(groups.examination.at(-1)).toEqual({
      dateText: '27-Aug',
      label: 'Term 3 Exam (Geography)',
    });
  });

  it('yields empty groups on a sheet with no heading row', () => {
    expect(extractLegendGroupsWide([[], [], [], ['Name', 'Index']])).toEqual({
      schoolEvents: [],
      schoolHoliday: [],
      publicHoliday: [],
      examination: [],
    });
  });
});
