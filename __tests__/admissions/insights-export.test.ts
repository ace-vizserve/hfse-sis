import { describe, expect, it } from 'vitest';

import type { Delta } from '@/lib/dashboard/range';
import type { AyTrendResult } from '@/lib/dashboard/insights-trend';
import {
  buildAdmissionsInsightsExport,
  type BuildAdmissionsInsightsExportInput,
} from '@/lib/admissions/insights-export';

const applicationsDelta: Delta = { abs: 12, pct: 13.6, direction: 'up' };
const conversionDelta: Delta = { abs: 2.3, pct: 5.7, direction: 'up' };

const intakeTrend: AyTrendResult = {
  data: [
    { x: 'Jan', AY2026: 10, AY2025: 8 },
    { x: 'Feb', AY2026: 14, AY2025: null },
  ],
  series: [
    { key: 'AY2026', label: 'AY2026' },
    { key: 'AY2025', label: 'AY2025', muted: true },
  ],
};

const baseInput: BuildAdmissionsInsightsExportInput = {
  ayCode: 'AY2026',
  compareAy: 'AY2025',

  applicationsCount: 120,
  applicationsDelta,
  priorApplications: 108,
  // Deliberately fractional — pins that the export rounds to the card's own
  // 1-decimal `toFixed(1)`, never the raw fraction.
  conversionPct: 42.857142857,
  conversionDelta,
  priorConversionPct: 33.333333,
  timeToEnroll: { sampleSize: 15, avgDays: 9 },

  haveIntakeData: true,
  intakeTrend,

  hasRatingData: true,
  ratingChartData: [
    { category: '1★', current: 0 },
    { category: '2★', current: 1 },
    { category: '3★', current: 2 },
    { category: '4★', current: 5 },
    { category: '5★', current: 12 },
  ],

  withdrawnByLevel: [
    { level: 'P1', count: 3 },
    { level: 'P2', count: 1 },
  ],

  // Deliberately fractional (1-decimal loader values) — pins that the export
  // rounds to the WHOLE numbers this chart's `yFormat="percent"` formatter
  // actually renders (Math.round, zero decimals), not the loader's 1dp value.
  assessmentGroupedData: [
    { x: 'Math', pass: 84.7, fail: 40.2, notAssessed: null },
    { x: 'English', pass: 90, fail: null, notAssessed: 12.4 },
  ],

  hasTerminalData: true,
  reasonBars: [
    { label: 'Chose another school', count: 8 },
    { label: 'Financial reasons', count: 3 },
    { label: 'Other reasons', count: 2 },
  ],
  terminalByLevel: [
    { level: 'P1', count: 6, topReasonLabel: 'Chose another school' },
    { level: 'P2', count: 0, topReasonLabel: null },
  ],

  referralVolume: [
    { name: 'Word of mouth', value: 40 },
    { name: 'Facebook', value: 15 },
  ],

  hasCategoryMixData: true,
  categoryMixData: [
    { x: 'New', current: 80, compare: 70 },
    { x: 'Current', current: 30, compare: 28 },
  ],

  nationalityMix: [
    { nationality: 'Singapore', count: 60 },
    { nationality: 'Philippines', count: 25 },
  ],

  nationalityByLevel: {
    legend: ['Singapore', 'Philippines', 'Other'],
    rows: [
      {
        level: 'P1',
        total: 10,
        segments: [
          { nationality: 'Singapore', count: 6 },
          { nationality: 'Philippines', count: 4 },
        ],
      },
      {
        level: 'P2',
        total: 5,
        segments: [{ nationality: 'Other', count: 5 }],
      },
    ],
  },
};

describe('buildAdmissionsInsightsExport', () => {
  it('names the file by module, AY and comparison AY', () => {
    const result = buildAdmissionsInsightsExport(baseInput);
    expect(result.filename).toBe('admissions-insights-AY2026-vs-AY2025.csv');
  });

  it('carries scope lines', () => {
    const result = buildAdmissionsInsightsExport(baseInput);
    expect(result.scope).toEqual([
      ['Page', 'Admissions insights'],
      ['Academic year', 'AY2026'],
      ['Compared with', 'AY2025'],
    ]);
  });

  it('omits Compared with when there is no comparison AY', () => {
    const result = buildAdmissionsInsightsExport({
      ...baseInput,
      compareAy: null,
    });
    expect(result.scope.some(([label]) => label === 'Compared with')).toBe(
      false
    );
  });

  it('produces one section per widget the page renders, in render order', () => {
    const result = buildAdmissionsInsightsExport(baseInput);
    expect(result.sections.map((s) => s.title)).toEqual([
      'Key figures',
      'Applications per month',
      'Ratings 1–5',
      'Withdrawn by level',
      'Conversion by assessment outcome',
      'Cancellation reasons',
      'Top reason per level',
      'Referral volume',
      'Category mix',
      'Nationality mix',
      'Nationality by level',
    ]);
  });

  it('carries the same Change number the delta chips show, not current−previous', () => {
    const result = buildAdmissionsInsightsExport(baseInput);
    const keyFigures = result.sections.find((s) => s.title === 'Key figures')!;
    expect(keyFigures.headers).toEqual([
      'Figure',
      'This period',
      'Previous period',
      'Change',
    ]);
    expect(keyFigures.rows).toEqual([
      ['Applications received', 120, 108, 13.6],
      ['Conversion rate (%)', 42.9, 33.3, 2.3],
      ['Avg. days to enrol', 9, null, null],
    ]);
    // Pin: conversion rate is toFixed(1), never the raw fraction.
    expect(keyFigures.rows[1][1]).not.toBe(42.857142857);
  });

  it('omits the Avg. days to enrol row when the card does not render (sampleSize 0)', () => {
    const result = buildAdmissionsInsightsExport({
      ...baseInput,
      timeToEnroll: { sampleSize: 0, avgDays: 0 },
    });
    const keyFigures = result.sections.find((s) => s.title === 'Key figures')!;
    expect(keyFigures.rows.map((r) => r[0])).toEqual([
      'Applications received',
      'Conversion rate (%)',
    ]);
  });

  it('leaves Change blank when the card passes no delta', () => {
    const result = buildAdmissionsInsightsExport({
      ...baseInput,
      applicationsDelta: null,
      conversionDelta: null,
    });
    const keyFigures = result.sections.find((s) => s.title === 'Key figures')!;
    expect(keyFigures.rows[0][3]).toBeNull();
    expect(keyFigures.rows[1][3]).toBeNull();
  });

  it('renders the intake trend by AY code, both AYs, honouring gaps as blank', () => {
    const result = buildAdmissionsInsightsExport(baseInput);
    const trend = result.sections.find(
      (s) => s.title === 'Applications per month'
    )!;
    expect(trend.headers).toEqual([
      'Month',
      'AY2026 applications',
      'AY2025 applications',
    ]);
    expect(trend.rows).toEqual([
      ['Jan', 10, 8],
      ['Feb', 14, null],
    ]);
  });

  it('empties the intake trend section when there is no data at all (not omitted)', () => {
    const result = buildAdmissionsInsightsExport({
      ...baseInput,
      haveIntakeData: false,
    });
    const trend = result.sections.find(
      (s) => s.title === 'Applications per month'
    )!;
    expect(trend.rows).toEqual([]);
  });

  it('empties the ratings section when no one has rated (empty state, not omitted)', () => {
    const result = buildAdmissionsInsightsExport({
      ...baseInput,
      hasRatingData: false,
    });
    const ratings = result.sections.find((s) => s.title === 'Ratings 1–5')!;
    expect(ratings.headers).toEqual(['Rating', 'Responses']);
    expect(ratings.rows).toEqual([]);
  });

  it('rounds assessment conversion to the WHOLE numbers the percent chart renders', () => {
    const result = buildAdmissionsInsightsExport(baseInput);
    const assessment = result.sections.find(
      (s) => s.title === 'Conversion by assessment outcome'
    )!;
    expect(assessment.headers).toEqual([
      'Subject',
      'Pass (%)',
      'Fail (%)',
      'Not assessed (%)',
    ]);
    expect(assessment.rows).toEqual([
      ['Math', 85, 40, null],
      ['English', 90, null, 12],
    ]);
  });

  it('renders cancellation reasons and top-reason-per-level as separate sections', () => {
    const result = buildAdmissionsInsightsExport(baseInput);
    const reasons = result.sections.find(
      (s) => s.title === 'Cancellation reasons'
    )!;
    expect(reasons.rows).toEqual([
      ['Chose another school', 8],
      ['Financial reasons', 3],
      ['Other reasons', 2],
    ]);
    const byLevel = result.sections.find(
      (s) => s.title === 'Top reason per level'
    )!;
    expect(byLevel.headers).toEqual(['Level', 'Top reason', 'Applicants']);
    expect(byLevel.rows).toEqual([
      ['P1', 'Chose another school', 6],
      ['P2', null, 0],
    ]);
  });

  it('omits both cancellation-reason sections entirely when there is no terminal data', () => {
    const result = buildAdmissionsInsightsExport({
      ...baseInput,
      hasTerminalData: false,
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Cancellation reasons'
    );
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Top reason per level'
    );
  });

  it('renders category mix with a comparison column only when compareAy is set', () => {
    const result = buildAdmissionsInsightsExport(baseInput);
    const mix = result.sections.find((s) => s.title === 'Category mix')!;
    expect(mix.headers).toEqual(['Category', 'AY2026', 'AY2025']);
    expect(mix.rows).toEqual([
      ['New', 80, 70],
      ['Current', 30, 28],
    ]);

    const noCompare = buildAdmissionsInsightsExport({
      ...baseInput,
      compareAy: null,
      categoryMixData: [{ x: 'New', current: 80 }],
    });
    const mixNoCompare = noCompare.sections.find(
      (s) => s.title === 'Category mix'
    )!;
    expect(mixNoCompare.headers).toEqual(['Category', 'AY2026']);
    expect(mixNoCompare.rows).toEqual([['New', 80]]);
  });

  it('empties category mix rows when the card shows its empty state', () => {
    const result = buildAdmissionsInsightsExport({
      ...baseInput,
      hasCategoryMixData: false,
    });
    const mix = result.sections.find((s) => s.title === 'Category mix')!;
    expect(mix.rows).toEqual([]);
  });

  it('renders nationality mix as raw counts', () => {
    const result = buildAdmissionsInsightsExport(baseInput);
    const nat = result.sections.find((s) => s.title === 'Nationality mix')!;
    expect(nat.headers).toEqual(['Nationality', 'Applicants']);
    expect(nat.rows).toEqual([
      ['Singapore', 60],
      ['Philippines', 25],
    ]);
  });

  it('renders nationality by level with the shared legend, 0-filling absent segments', () => {
    const result = buildAdmissionsInsightsExport(baseInput);
    const byLevel = result.sections.find(
      (s) => s.title === 'Nationality by level'
    )!;
    expect(byLevel.headers).toEqual([
      'Level',
      'Singapore',
      'Philippines',
      'Other',
      'Total',
    ]);
    expect(byLevel.rows).toEqual([
      ['P1', 6, 4, 0, 10],
      ['P2', 0, 0, 5, 5],
    ]);
  });
});
