import { describe, expect, it } from 'vitest';

import type {
  AttendanceKpis,
  DailyAttendancePoint,
} from '@/lib/attendance/dashboard';
import type { AllRowSets } from '@/lib/attendance/drill';
import type { RangeResult } from '@/lib/dashboard/range';
import {
  buildAttendanceDashboardExport,
  type BuildAttendanceDashboardExportInput,
} from '@/lib/attendance/dashboard-export';
import { roundTo } from '@/lib/export/dashboard-export';

const kpis: RangeResult<AttendanceKpis> = {
  current: {
    attendancePct: 94.2345,
    encodedDays: 100,
    present: 90,
    late: 5,
    excused: 3,
    absent: 2,
    nc: 0,
  },
  comparison: {
    attendancePct: 90.1,
    encodedDays: 95,
    present: 85,
    late: 6,
    excused: 2,
    absent: 2,
    nc: 0,
  },
  delta: { abs: 4.13, pct: 4.6, direction: 'up' },
  range: { from: '2026-08-01', to: '2026-08-31' },
  comparisonRange: { from: '2026-07-01', to: '2026-07-31' },
};

const dailySeries: RangeResult<DailyAttendancePoint[]> = {
  current: [
    { x: '2026-08-01', y: 92.5 },
    { x: '2026-08-02', y: 95.0 },
  ],
  comparison: [
    { x: '2026-07-01', y: 88.0 },
    { x: '2026-07-02', y: 90.0 },
  ],
  delta: null,
  range: { from: '2026-08-01', to: '2026-08-31' },
  comparisonRange: { from: '2026-07-01', to: '2026-07-31' },
};

const exMix = [
  { name: 'MC / Excuse leave', value: 5 },
  { name: 'Compassionate', value: 2 },
];

const dayTypes = [
  { name: 'School day', value: 20 },
  { name: 'Public holiday', value: 3 },
];

const rowSets: AllRowSets = {
  topAbsent: [
    {
      studentSectionId: 'ss1',
      studentName: 'Alice Tan',
      studentNumber: 'S001',
      sectionId: 'sec1',
      sectionName: 'P1-A',
      level: 'P1',
      absences: 5,
      lates: 2,
      excused: 1,
      encodedDays: 20,
      attendancePct: 70,
    },
    {
      studentSectionId: 'ss2',
      studentName: 'Ben Lee',
      studentNumber: 'S002',
      sectionId: 'sec1',
      sectionName: 'P1-A',
      level: 'P1',
      absences: 1,
      lates: 0,
      excused: 0,
      encodedDays: 20,
      attendancePct: 95,
    },
  ],
  sectionAttendance: [
    {
      sectionId: 'sec1',
      sectionName: 'P1-A',
      level: 'P1',
      encodedDays: 20,
      presentCount: 15,
      lateCount: 2,
      excusedCount: 1,
      absentCount: 2,
      attendancePct: 90,
    },
  ],
  calendar: [],
  compassionate: [
    {
      studentSectionId: 'ss1',
      studentName: 'Alice Tan',
      studentNumber: 'S001',
      sectionId: 'sec1',
      sectionName: 'P1-A',
      level: 'P1',
      allowance: 5,
      used: 5,
      remaining: 0,
      isOverQuota: false,
    },
    {
      studentSectionId: 'ss3',
      studentName: 'Cara Ong',
      studentNumber: 'S003',
      sectionId: 'sec1',
      sectionName: 'P1-A',
      level: 'P1',
      allowance: 5,
      used: 6,
      remaining: -1,
      isOverQuota: true,
    },
    {
      studentSectionId: 'ss4',
      studentName: 'Dan Koh',
      studentNumber: 'S004',
      sectionId: 'sec1',
      sectionName: 'P1-A',
      level: 'P1',
      allowance: 5,
      used: 0,
      remaining: 5,
      isOverQuota: false,
    },
  ],
  vacationLeave: [
    {
      studentSectionId: 'ss1',
      studentName: 'Alice Tan',
      studentNumber: 'S001',
      sectionId: 'sec1',
      sectionName: 'P1-A',
      level: 'P1',
      termId: 'term1',
      termNumber: 1,
      allowance: 1,
      usedThisTerm: 1,
      remainingThisTerm: 0,
      isOverTermQuota: false,
    },
  ],
};

const baseInput: BuildAttendanceDashboardExportInput = {
  ayCode: 'AY2026',
  rangeInput: {
    ayCode: 'AY2026',
    from: '2026-08-01',
    to: '2026-08-31',
    cmpFrom: '2026-07-01',
    cmpTo: '2026-07-31',
  },
  kpis,
  dailySeries,
  exMix,
  dayTypes,
  rowSets,
  vacationTermId: 'term1',
  currentTermLabel: 'Term 1',
};

describe('buildAttendanceDashboardExport', () => {
  it('names the file by module, AY and range', () => {
    const result = buildAttendanceDashboardExport(baseInput);
    expect(result.filename).toBe(
      'attendance-dashboard-AY2026-2026-08-01_to_2026-08-31.csv'
    );
  });

  it('carries scope lines including the comparison range', () => {
    const result = buildAttendanceDashboardExport(baseInput);
    expect(result.scope).toContainEqual(['Page', 'Attendance dashboard']);
    expect(result.scope).toContainEqual(['Academic year', 'AY2026']);
    expect(result.scope).toContainEqual([
      'Date range',
      '2026-08-01 to 2026-08-31',
    ]);
    expect(result.scope).toContainEqual([
      'Compared with',
      '2026-07-01 to 2026-07-31',
    ]);
  });

  it('omits Compared with when there is no comparison range', () => {
    const result = buildAttendanceDashboardExport({
      ...baseInput,
      rangeInput: {
        ayCode: 'AY2026',
        from: '2026-08-01',
        to: '2026-08-31',
        cmpFrom: null,
        cmpTo: null,
      },
    });
    expect(result.scope.some(([label]) => label === 'Compared with')).toBe(
      false
    );
  });

  it('produces one section per widget, in render order', () => {
    const result = buildAttendanceDashboardExport(baseInput);
    expect(result.sections.map((s) => s.title)).toEqual([
      'Key figures',
      'Daily attendance trend',
      'Excused reasons',
      'Day types',
      'Attendance by section',
      'Compassionate leave quota',
      'Vacation leave quota — Term 1',
      'Top-absent students',
      'Top-active students',
    ]);
  });

  it('rounds the Key figures rows as the KPI cards show them', () => {
    const result = buildAttendanceDashboardExport(baseInput);
    const keyFigures = result.sections[0];
    expect(keyFigures.headers).toEqual([
      'Figure',
      'This period',
      'Previous period',
      'Change',
    ]);
    expect(keyFigures.rows).toEqual([
      ['Attendance rate (%)', 94.2, 90.1, 4.6],
      ['Late incidents', 5, 6, null],
      ['Excused', 3, 2, null],
      ['Absences', 2, 2, null],
    ]);
  });

  it('carries the same Change number the delta chip shows, not current−previous', () => {
    // kpis.delta.pct (4.6) is deliberately NOT current−previous (94.2345 −
    // 90.1 = 4.1345, rounds to 4.1) — this fixture would pass a naive
    // current−previous implementation, so it pins the chip's own value.
    // The card only renders a delta chip for Attendance rate (page.tsx
    // passes `delta` to that <MetricCard> only); the other three KPI cards
    // show "N prior" subtext instead of a chip, so their Change is null.
    const result = buildAttendanceDashboardExport(baseInput);
    const keyFigures = result.sections[0];
    const attendanceRateRow = keyFigures.rows[0];
    expect(attendanceRateRow[3]).toBe(roundTo(kpis.delta!.pct, 1));
    expect(attendanceRateRow[3]).toBe(4.6);
    for (const row of keyFigures.rows.slice(1)) {
      expect(row[3]).toBeNull();
    }
  });

  it('aligns the daily trend comparison series by position, like the chart', () => {
    const result = buildAttendanceDashboardExport(baseInput);
    const trend = result.sections[1];
    expect(trend.headers).toEqual(['Date', 'Rate (%)', 'Comparison rate (%)']);
    expect(trend.rows).toEqual([
      ['2026-08-01', 92.5, 88],
      ['2026-08-02', 95, 90],
    ]);
  });

  it('omits the daily-attendance-trend section when the series has 1 or 0 points', () => {
    const result = buildAttendanceDashboardExport({
      ...baseInput,
      dailySeries: {
        ...dailySeries,
        current: [{ x: '2026-08-01', y: 92.5 }],
        comparison: null,
      },
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Daily attendance trend'
    );
  });

  it('omits the vacation-leave section when there is no current term', () => {
    const result = buildAttendanceDashboardExport({
      ...baseInput,
      vacationTermId: null,
      currentTermLabel: null,
    });
    expect(
      result.sections.some((s) => s.title.startsWith('Vacation leave'))
    ).toBe(false);
  });

  it('filters and sorts the compassionate-leave list exactly as the card does', () => {
    const result = buildAttendanceDashboardExport(baseInput);
    const compassionate = result.sections[5];
    expect(compassionate.headers).toEqual([
      'Student',
      'Section',
      'Used',
      'Allowance',
      'Remaining',
      'Over quota?',
    ]);
    // Dan Koh (0 used) is excluded — not at risk. Cara (over quota) sorts
    // before Alice (near quota, not over) — same order the card shows.
    expect(compassionate.rows).toEqual([
      ['Cara Ong', 'P1-A', 6, 5, -1, 'Yes'],
      ['Alice Tan', 'P1-A', 5, 5, 0, 'No'],
    ]);
  });

  it('builds the vacation-leave list scoped to the current term', () => {
    const result = buildAttendanceDashboardExport(baseInput);
    const vl = result.sections[6];
    expect(vl.headers).toEqual([
      'Student',
      'Section',
      'Used this term',
      'Allowance',
      'Remaining',
      'Over quota?',
    ]);
    expect(vl.rows).toEqual([['Alice Tan', 'P1-A', 1, 1, 0, 'No']]);
  });

  it('builds top-absent and top-active tabs from the same row set', () => {
    const result = buildAttendanceDashboardExport(baseInput);
    const topAbsent = result.sections[7];
    const topActive = result.sections[8];
    expect(topAbsent.headers).toEqual([
      'Student',
      'Section',
      'Absences',
      'Lates',
    ]);
    expect(topAbsent.rows).toEqual([
      ['Alice Tan', 'P1-A', 5, 2],
      ['Ben Lee', 'P1-A', 1, 0],
    ]);
    expect(topActive.headers).toEqual([
      'Student',
      'Section',
      'Absences',
      'Attendance %',
    ]);
    // Sorted ascending by absences (fewest first) — the honor-roll cohort.
    expect(topActive.rows).toEqual([
      ['Ben Lee', 'P1-A', 1, 95],
      ['Alice Tan', 'P1-A', 5, 70],
    ]);
  });

  it('renders the attendance-by-section list as the card plots it', () => {
    const result = buildAttendanceDashboardExport(baseInput);
    const section = result.sections[4];
    expect(section.headers).toEqual(['Section', 'Attendance rate (%)']);
    expect(section.rows).toEqual([['P1-A', 90]]);
  });

  it('renders excused reasons and day types straight from the loaders', () => {
    const result = buildAttendanceDashboardExport(baseInput);
    expect(result.sections[2]).toEqual({
      title: 'Excused reasons',
      headers: ['Reason', 'Count'],
      rows: [
        ['MC / Excuse leave', 5],
        ['Compassionate', 2],
      ],
    });
    expect(result.sections[3]).toEqual({
      title: 'Day types',
      headers: ['Day type', 'Days'],
      rows: [
        ['School day', 20],
        ['Public holiday', 3],
      ],
    });
  });
});
