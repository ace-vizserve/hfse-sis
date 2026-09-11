import { describe, expect, it } from 'vitest';

import type {
  CompassionateUsageRow,
  TermTopAbsent,
  VacationLeaveUsageRow,
} from '@/lib/attendance/drill';
import type { AyTrendResult } from '@/lib/dashboard/insights-trend';
import {
  buildAttendanceInsightsExport,
  type BuildAttendanceInsightsExportInput,
} from '@/lib/attendance/insights-export';
import { roundTo } from '@/lib/export/dashboard-export';

const compassionateOver: CompassionateUsageRow[] = [
  {
    studentSectionId: 'ss1',
    studentName: 'Alice Tan',
    studentNumber: 'S001',
    sectionId: 'sec1',
    sectionName: 'P1-A',
    level: 'P1',
    allowance: 5,
    used: 6,
    remaining: -1,
    isOverQuota: true,
  },
  {
    studentSectionId: 'ss2',
    studentName: 'Ben Lee',
    studentNumber: 'S002',
    sectionId: 'sec1',
    sectionName: 'P1-A',
    level: 'P1',
    allowance: 5,
    used: 7,
    remaining: -2,
    isOverQuota: true,
  },
];

const vacationOver: VacationLeaveUsageRow[] = [
  {
    studentSectionId: 'ss3',
    studentName: 'Cara Ong',
    studentNumber: 'S003',
    sectionId: 'sec1',
    sectionName: 'P1-A',
    level: 'P1',
    termId: 'term1',
    termNumber: 1,
    allowance: 1,
    usedThisTerm: 2,
    remainingThisTerm: 0,
    isOverTermQuota: true,
  },
];

const vacationApproaching: VacationLeaveUsageRow[] = [
  {
    studentSectionId: 'ss4',
    studentName: 'Dan Koh',
    studentNumber: 'S004',
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
];

const attendanceMixPieData = [
  { name: 'Present', value: 80 },
  { name: 'Late', value: 7 },
  { name: 'Excused', value: 5 },
  { name: 'Absent', value: 12 },
];

// Deliberately fractional — the chart these back renders with
// `yFormat="percent"` (zero decimals: ticks/tooltip/value-labels all show
// `Math.round(n)`), so these values must be rounded to WHOLE numbers on
// export, not passed through at 1 decimal. Fixtures are chosen so a
// naive 1-decimal round (or no round at all) would NOT equal the expected
// whole-number cell, exposing a fractional leak.
const rateTrend: AyTrendResult = {
  data: [
    { x: 'T1', AY2026: 90.6, AY2025: 88.4 },
    { x: 'T2', AY2026: 92.3, AY2025: null },
    { x: 'T3', AY2026: null, AY2025: 85.5 },
    { x: 'T4', AY2026: null, AY2025: null },
  ],
  series: [
    { key: 'AY2026', label: 'This year (AY2026)' },
    { key: 'AY2025', label: 'AY2025', muted: true },
  ],
};

// Same "fractional on purpose" reasoning as `rateTrend` above — the
// composition chart also renders `yFormat="percent"` (zero decimals), but
// the page computes these to 1 decimal (`Math.round(... * 1000) / 10`).
// The export must round AGAIN to match what the bars actually show.
const compositionData = [
  { x: 'T1', present: 84.7, late: 5.3, excused: 2.6, absent: 7.4 },
  { x: 'T2', present: 89.6, late: 2.4, excused: 1.1, absent: 6.9 },
  { x: 'T3', present: 0, late: 0, excused: 0, absent: 0 },
  { x: 'T4', present: 0, late: 0, excused: 0, absent: 0 },
];

const term1Absent: TermTopAbsent = {
  termNumber: 1,
  rows: [
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
  ],
};

const term2Absent: TermTopAbsent = {
  termNumber: 2,
  rows: [
    {
      studentSectionId: 'ss2',
      studentName: 'Ben Lee',
      studentNumber: 'S002',
      sectionId: 'sec1',
      sectionName: 'P1-A',
      level: 'P1',
      absences: 3,
      lates: 0,
      excused: 0,
      encodedDays: 20,
      attendancePct: 85,
    },
  ],
};

// Deliberately NOT equal to rate − priorRate (92.3 − 88.5 = 3.8) — pins that
// the builder consumes the given chip value verbatim rather than recomputing
// current−previous.
const rateDelta = { abs: 5, pct: 5.65, direction: 'up' as const };

const baseInput: BuildAttendanceInsightsExportInput = {
  ayCode: 'AY2026',
  compareAy: 'AY2025',
  hasCurrentPeriodData: true,
  rate: 92.3,
  priorRate: 88.5,
  rateDelta,
  absent: 12,
  late: 7,
  attendanceMixPieData,
  haveTrend: true,
  rateTrend,
  hasMixByTerm: true,
  compositionData,
  termsWithAbsences: [term1Absent, term2Absent],
  haveQuotaRisk: true,
  compassionateOver,
  vacationOver,
  vacationApproaching,
};

describe('buildAttendanceInsightsExport', () => {
  it('names the file by module, AY and comparison AY', () => {
    const result = buildAttendanceInsightsExport(baseInput);
    expect(result.filename).toBe('attendance-insights-AY2026-vs-AY2025.csv');
  });

  it('carries scope lines including Compared with', () => {
    const result = buildAttendanceInsightsExport(baseInput);
    expect(result.scope).toEqual([
      ['Page', 'Attendance insights'],
      ['Academic year', 'AY2026'],
      ['Compared with', 'AY2025'],
    ]);
  });

  it('omits Compared with when there is no comparison AY', () => {
    const result = buildAttendanceInsightsExport({
      ...baseInput,
      compareAy: null,
    });
    expect(result.scope).toEqual([
      ['Page', 'Attendance insights'],
      ['Academic year', 'AY2026'],
    ]);
  });

  it('produces one section per widget, in render order', () => {
    const result = buildAttendanceInsightsExport(baseInput);
    expect(result.sections.map((s) => s.title)).toEqual([
      'Key figures',
      'Attendance mix',
      'Term-by-term attendance',
      "What's behind the rate",
      'Term 1',
      'Term 2',
      'Compassionate leave — over quota',
      'Vacation leave — over quota',
    ]);
  });

  it('carries the same Change number the rate chip shows, not current−previous', () => {
    const result = buildAttendanceInsightsExport(baseInput);
    const keyFigures = result.sections[0];
    expect(keyFigures.headers).toEqual([
      'Figure',
      'This period',
      'Previous period',
      'Change',
    ]);
    expect(keyFigures.rows).toEqual([
      ['Attendance rate (%)', 92.3, 88.5, 5],
      ['Days absent', 12, null, null],
      ['Late incidents', 7, null, null],
      ['Over their leave quota', 3, null, null],
    ]);
    expect(keyFigures.rows[0][3]).toBe(roundTo(rateDelta.abs, 1));
  });

  it('blanks Previous/Change on the rate card when the page shows no chip', () => {
    const result = buildAttendanceInsightsExport({
      ...baseInput,
      hasCurrentPeriodData: false,
      rateDelta: undefined,
    });
    const keyFigures = result.sections[0];
    expect(keyFigures.rows[0]).toEqual([
      'Attendance rate (%)',
      null,
      null,
      null,
    ]);
    expect(keyFigures.rows[1]).toEqual(['Days absent', null, null, null]);
    expect(keyFigures.rows[2]).toEqual(['Late incidents', null, null, null]);
  });

  it('names term-rate columns by AY code, not the chart legend label', () => {
    const result = buildAttendanceInsightsExport(baseInput);
    const trend = result.sections[2];
    expect(trend.headers).toEqual([
      'Term',
      'AY2026 rate (%)',
      'AY2025 rate (%)',
    ]);
    expect(trend.rows).toEqual([
      ['T1', 91, 88],
      ['T2', 92, null],
      ['T3', null, 86],
      ['T4', null, null],
    ]);
  });

  it("rounds term-rate cells to whole numbers, like the chart's percent formatter", () => {
    // The chart is rendered with yFormat="percent", whose formatter
    // (Math.round, zero decimals) drives the axis ticks, tooltip and
    // on-bar value labels — a fractional cell here would disagree with
    // what the viewer sees on the bar.
    const result = buildAttendanceInsightsExport(baseInput);
    const trend = result.sections[2];
    for (const row of trend.rows) {
      for (const cell of row.slice(1)) {
        if (cell !== null) expect(Number.isInteger(cell)).toBe(true);
      }
    }
  });

  it('gives the term-rate section zero rows when there is no trend at all', () => {
    const result = buildAttendanceInsightsExport({
      ...baseInput,
      haveTrend: false,
    });
    const trend = result.sections[2];
    expect(trend.headers).toEqual([
      'Term',
      'AY2026 rate (%)',
      'AY2025 rate (%)',
    ]);
    expect(trend.rows).toEqual([]);
  });

  it('renders the composition-per-term rows as the chart plots them', () => {
    const result = buildAttendanceInsightsExport(baseInput);
    const composition = result.sections[3];
    expect(composition.headers).toEqual([
      'Term',
      'Present (%)',
      'Late (%)',
      'Excused (%)',
      'Absent (%)',
    ]);
    expect(composition.rows).toEqual([
      ['T1', 85, 5, 3, 7],
      ['T2', 90, 2, 1, 7],
      ['T3', 0, 0, 0, 0],
      ['T4', 0, 0, 0, 0],
    ]);
  });

  it("rounds composition cells to whole numbers, like the chart's percent formatter", () => {
    // The page computes `compositionData` to 1 decimal, but the composition
    // chart also renders yFormat="percent" (zero-decimal formatter) — the
    // export must round again rather than passing the page's intermediate
    // 1-decimal value straight through.
    const result = buildAttendanceInsightsExport(baseInput);
    const composition = result.sections[3];
    for (const row of composition.rows) {
      for (const cell of row.slice(1)) {
        expect(Number.isInteger(cell)).toBe(true);
      }
    }
  });

  it('gives the composition section zero rows when no term has data', () => {
    const result = buildAttendanceInsightsExport({
      ...baseInput,
      hasMixByTerm: false,
    });
    expect(result.sections[3].rows).toEqual([]);
  });

  it('builds one per-term absence-watchlist section from the top-5 rows', () => {
    const result = buildAttendanceInsightsExport(baseInput);
    const t1 = result.sections[4];
    expect(t1.title).toBe('Term 1');
    expect(t1.headers).toEqual([
      'Student',
      'Section',
      'Absences',
      'Attendance %',
      'Excused',
      'Late',
    ]);
    expect(t1.rows).toEqual([['Alice Tan', 'P1-A', 5, 70, 1, 2]]);
  });

  it('omits every per-term absence section when no term has an absence', () => {
    const result = buildAttendanceInsightsExport({
      ...baseInput,
      termsWithAbsences: [],
    });
    expect(result.sections.some((s) => /^Term \d/.test(s.title))).toBe(false);
  });

  it('lists compassionate and vacation over-quota rows with a status column', () => {
    const result = buildAttendanceInsightsExport(baseInput);
    const compassionate = result.sections[6];
    const vacation = result.sections[7];
    expect(compassionate.headers).toEqual([
      'Student',
      'Section',
      'Used',
      'Allowance',
      'Status',
    ]);
    expect(compassionate.rows).toEqual([
      ['Alice Tan', 'P1-A', 6, 5, 'Over'],
      ['Ben Lee', 'P1-A', 7, 5, 'Over'],
    ]);
    expect(vacation.headers).toEqual([
      'Student',
      'Section',
      'Used this term',
      'Allowance',
      'Status',
    ]);
    expect(vacation.rows).toEqual([
      ['Cara Ong', 'P1-A', 2, 1, 'Over'],
      ['Dan Koh', 'P1-A', 1, 1, 'Approaching'],
    ]);
  });

  it('omits both leave-quota sections when the page shows the all-clear placeholder', () => {
    const result = buildAttendanceInsightsExport({
      ...baseInput,
      haveQuotaRisk: false,
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Compassionate leave — over quota'
    );
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Vacation leave — over quota'
    );
  });
});
