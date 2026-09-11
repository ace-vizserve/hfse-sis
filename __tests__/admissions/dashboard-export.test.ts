import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  AdmissionsRangeKpis,
  ApplicationsByLevelResult,
  AssessmentOutcomes,
  DocCompletionResult,
  ReferralSource,
  TimeToEnrollBucket,
} from '@/lib/admissions/dashboard';
import type { FeedbackStats, PreCourseStats } from '@/lib/admissions/feedback';
import type { PipelineStage } from '@/lib/sis/dashboard';
import type { DocumentChaseQueueCounts } from '@/lib/sis/document-chase-queue';
import type { RangeInput, RangeResult } from '@/lib/dashboard/range';
import type { VelocityPoint } from '@/lib/dashboard/velocity';
import {
  buildAdmissionsDashboardExport,
  type BuildAdmissionsDashboardExportInput,
} from '@/lib/admissions/dashboard-export';
import { roundTo } from '@/lib/export/dashboard-export';

const kpis: RangeResult<AdmissionsRangeKpis> = {
  current: {
    applicationsInRange: 42,
    enrolledInRange: 18,
    // Deliberately fractional — pins that the card's own toFixed(1) rounding
    // is applied (42.857...% would leak a false extra decimal if unrounded).
    conversionPct: 42.857142857,
    avgDaysToEnroll: 9,
    sampleSize: 15,
  },
  comparison: {
    applicationsInRange: 30,
    enrolledInRange: 10,
    conversionPct: 33.333333,
    avgDaysToEnroll: 12,
    sampleSize: 8,
  },
  // Deliberately NOT current−previous ((42-30)/30*100 = 40) — pins that
  // Change carries the chip's own delta.pct, not a re-derived one.
  delta: { abs: 12, pct: 55.5, direction: 'up' },
  range: { from: '2026-08-01', to: '2026-08-31' },
  comparisonRange: { from: '2026-07-01', to: '2026-07-31' },
};

const velocity: RangeResult<VelocityPoint[]> = {
  current: [
    { x: '2026-08-01', y: 3 },
    { x: '2026-08-02', y: 5 },
  ],
  comparison: [
    { x: '2026-07-01', y: 1 },
    { x: '2026-07-02', y: 2 },
  ],
  delta: { abs: 4, pct: 100, direction: 'up' },
  range: { from: '2026-08-01', to: '2026-08-31' },
  comparisonRange: { from: '2026-07-01', to: '2026-07-31' },
};

const pipelineStages: PipelineStage[] = [
  { key: 'Submitted', label: 'Submitted', count: 10 },
  { key: 'Ongoing Verification', label: 'Ongoing Verification', count: 6 },
  { key: 'Processing', label: 'Processing', count: 4 },
  { key: 'Enrolled', label: 'Enrolled', count: 18 },
  { key: 'Enrolled (Conditional)', label: 'Enrolled (Conditional)', count: 2 },
  { key: 'Withdrawn', label: 'Withdrawn', count: 1 },
  { key: 'Cancelled', label: 'Cancelled', count: 1 },
];

const timeToEnroll: TimeToEnrollBucket[] = [
  { label: '0-7d', loDays: 0, hiDays: 7, count: 2 },
  { label: '8-14d', loDays: 8, hiDays: 14, count: 5 },
  { label: '15-30d', loDays: 15, hiDays: 30, count: 1 },
];

const assessment: AssessmentOutcomes = {
  mathPass: 20,
  mathFail: 5,
  mathUnknown: 17,
  engPass: 18,
  engFail: 7,
  engUnknown: 17,
};

const appsByLevel: ApplicationsByLevelResult = {
  current: [
    { level: 'P1', count: 10 },
    { level: 'P2', count: 8 },
  ],
  comparison: [{ level: 'P1', count: 6 }],
  delta: { abs: 12, pct: 66.6, direction: 'up' },
  range: { from: '2026-08-01', to: '2026-08-31' },
  comparisonRange: { from: '2026-07-01', to: '2026-07-31' },
};

const docCompletion: DocCompletionResult = [
  {
    level: 'P1',
    total: 10,
    complete: 6,
    partial: 3,
    missing: 1,
    percentComplete: 60,
  },
  {
    level: 'P2',
    total: 8,
    complete: 8,
    partial: 0,
    missing: 0,
    percentComplete: 100,
  },
];

const referral: ReferralSource[] = [
  { source: 'Word of mouth', count: 20 },
  { source: 'Facebook', count: 12 },
  { source: 'Other', count: 5 },
];

const preCourseStats: PreCourseStats = {
  total: 40,
  complete: 30,
  notYet: 10,
  completionPct: 75,
};

const feedbackStats: FeedbackStats = {
  total: 25,
  avgRating: 4.2,
  ratingCount: 20,
  consentCount: 15,
  consentRate: 75,
};

const chaseQueueCounts: DocumentChaseQueueCounts = {
  promised: 3,
  validation: 2,
  revalidation: 1,
  expiringSoon: 9, // must not surface for admissions — hidden per the module split
};

const baseInput: BuildAdmissionsDashboardExportInput = {
  ayCode: 'AY2026',
  rangeInput: {
    ayCode: 'AY2026',
    from: '2026-08-01',
    to: '2026-08-31',
    cmpFrom: '2026-07-01',
    cmpTo: '2026-07-31',
  },
  isOperational: true,
  kpis,
  velocity,
  pipelineStages,
  timeToEnroll,
  assessment,
  appsByLevel,
  docCompletion,
  referral,
  preCourseStats,
  feedbackStats,
  chaseQueueCounts,
  upcomingAy: {
    ayCode: 'AY2027',
    // Deliberately NOT submitted+ongoingVerification+processing (4+2+1=7) —
    // pins that the exported total is the card's own headline number,
    // carried through as-is, never recomputed from the stage breakdown.
    applicationCount: 8,
    byStage: { submitted: 4, ongoingVerification: 2, processing: 1 },
  },
};

describe('buildAdmissionsDashboardExport', () => {
  it('names the file by module, AY and range', () => {
    const result = buildAdmissionsDashboardExport(baseInput);
    expect(result.filename).toBe(
      'admissions-dashboard-AY2026-2026-08-01_to_2026-08-31.csv'
    );
  });

  it('carries scope lines including the comparison range', () => {
    const result = buildAdmissionsDashboardExport(baseInput);
    expect(result.scope).toContainEqual(['Page', 'Admissions dashboard']);
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
    const result = buildAdmissionsDashboardExport({
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

  it('produces one section per widget the operational branch renders, in render order', () => {
    const result = buildAdmissionsDashboardExport(baseInput);
    expect(result.sections.map((s) => s.title)).toEqual([
      'Early-bird applications — AY2027',
      'Documents to chase',
      'Key figures',
      'Applications per day',
      'Pipeline by stage',
      'Time to enrol',
      'Assessment outcomes',
      'Applications by level',
      'Document completion by level',
      'Referral sources',
      'Summary',
    ]);
  });

  it('carries the same Change number the delta chip shows, not current−previous', () => {
    const result = buildAdmissionsDashboardExport(baseInput);
    const keyFigures = result.sections.find((s) => s.title === 'Key figures')!;
    expect(keyFigures.headers).toEqual([
      'Figure',
      'This period',
      'Previous period',
      'Change',
    ]);
    expect(keyFigures.rows).toEqual([
      ['Applications (range)', 42, 30, roundTo(kpis.delta!.pct, 1)],
      ['Enrolled (range)', 18, 10, null],
      ['Conversion rate (%)', 42.9, 33.3, null],
      ['Avg time to enrol (days)', 9, 12, null],
    ]);
    // Pin: NOT (42-30)/30*100 = 40. Must be the chip's own 55.5.
    expect(keyFigures.rows[0][3]).toBe(55.5);
    // Pin: rounded to the card's 1-decimal toFixed(1), never the raw fraction.
    expect(keyFigures.rows[2][1]).toBe(42.9);
    expect(keyFigures.rows[2][1]).not.toBe(42.857142857);
  });

  it('shows the em-dash rule for avg time to enrol: blank current when sampleSize is 0', () => {
    const result = buildAdmissionsDashboardExport({
      ...baseInput,
      kpis: {
        ...kpis,
        current: { ...kpis.current, sampleSize: 0 },
      },
    });
    const keyFigures = result.sections.find((s) => s.title === 'Key figures')!;
    const avgRow = keyFigures.rows.find(
      (r) => r[0] === 'Avg time to enrol (days)'
    )!;
    expect(avgRow[1]).toBeNull();
    // Previous also blank — the card's subtext only shows a prior number when
    // the CURRENT period has samples too.
    expect(avgRow[2]).toBeNull();
  });

  it('renders applications-per-day aligned by position, like the chart', () => {
    const result = buildAdmissionsDashboardExport(baseInput);
    const trend = result.sections.find(
      (s) => s.title === 'Applications per day'
    )!;
    expect(trend.headers).toEqual([
      'Date',
      'Applications',
      'Comparison applications',
    ]);
    expect(trend.rows).toEqual([
      ['2026-08-01', 3, 1],
      ['2026-08-02', 5, 2],
    ]);
  });

  it('omits applications-per-day when there are 0 or 1 points', () => {
    const result = buildAdmissionsDashboardExport({
      ...baseInput,
      velocity: {
        ...velocity,
        current: [{ x: '2026-08-01', y: 3 }],
        comparison: null,
      },
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Applications per day'
    );
  });

  it('lists every pipeline stage straight from the loader', () => {
    const result = buildAdmissionsDashboardExport(baseInput);
    const pipeline = result.sections.find(
      (s) => s.title === 'Pipeline by stage'
    )!;
    expect(pipeline.headers).toEqual(['Stage', 'Applicants']);
    expect(pipeline.rows).toEqual([
      ['Submitted', 10],
      ['Ongoing Verification', 6],
      ['Processing', 4],
      ['Enrolled', 18],
      ['Enrolled (Conditional)', 2],
      ['Withdrawn', 1],
      ['Cancelled', 1],
    ]);
  });

  it('lists every time-to-enrol bucket, even when the card would show the building state', () => {
    const result = buildAdmissionsDashboardExport({
      ...baseInput,
      timeToEnroll: [
        { label: '0-7d', loDays: 0, hiDays: 7, count: 0 },
        { label: '8-14d', loDays: 8, hiDays: 14, count: 0 },
      ],
    });
    const bucket = result.sections.find((s) => s.title === 'Time to enrol')!;
    expect(bucket.headers).toEqual(['Days to close', 'Enrolments']);
    expect(bucket.rows).toEqual([
      ['0-7d', 0],
      ['8-14d', 0],
    ]);
  });

  it('splits assessment outcomes by subject with raw counts, no percent', () => {
    const result = buildAdmissionsDashboardExport(baseInput);
    const outcomes = result.sections.find(
      (s) => s.title === 'Assessment outcomes'
    )!;
    expect(outcomes.headers).toEqual(['Subject', 'Pass', 'Fail', 'Unknown']);
    expect(outcomes.rows).toEqual([
      ['Math', 20, 5, 17],
      ['English', 18, 7, 17],
    ]);
  });

  it('zips applications-by-level comparison by matching level, defaulting missing levels to 0', () => {
    const result = buildAdmissionsDashboardExport(baseInput);
    const byLevel = result.sections.find(
      (s) => s.title === 'Applications by level'
    )!;
    expect(byLevel.headers).toEqual([
      'Level',
      'Applications',
      'Comparison applications',
    ]);
    // P2 has no matching comparison row -> defaults to 0, same as the card's
    // `comparisonByLevel.get(row.level) ?? 0`.
    expect(byLevel.rows).toEqual([
      ['P1', 10, 6],
      ['P2', 8, 0],
    ]);
  });

  it('still emits Applications by level with zero rows when the range is empty', () => {
    const result = buildAdmissionsDashboardExport({
      ...baseInput,
      appsByLevel: {
        current: [],
        comparison: null,
        delta: null,
        range: appsByLevel.range,
        comparisonRange: null,
      },
    });
    const byLevel = result.sections.find(
      (s) => s.title === 'Applications by level'
    )!;
    expect(byLevel.headers).toEqual(['Level', 'Applications']);
    expect(byLevel.rows).toEqual([]);
  });

  it('lists document completion by level straight from the loader', () => {
    const result = buildAdmissionsDashboardExport(baseInput);
    const docs = result.sections.find(
      (s) => s.title === 'Document completion by level'
    )!;
    expect(docs.headers).toEqual(['Level', 'Complete', 'Partial', 'Missing']);
    expect(docs.rows).toEqual([
      ['P1', 6, 3, 1],
      ['P2', 8, 0, 0],
    ]);
  });

  it('still emits Document completion by level with zero rows when there is no data', () => {
    const result = buildAdmissionsDashboardExport({
      ...baseInput,
      docCompletion: [],
    });
    const docs = result.sections.find(
      (s) => s.title === 'Document completion by level'
    )!;
    expect(docs).toBeDefined();
    expect(docs.rows).toEqual([]);
  });

  it('lists referral sources straight from the loader, Other bucket included as-is', () => {
    const result = buildAdmissionsDashboardExport(baseInput);
    const ref = result.sections.find((s) => s.title === 'Referral sources')!;
    expect(ref.headers).toEqual(['Source', 'Applications']);
    expect(ref.rows).toEqual([
      ['Word of mouth', 20],
      ['Facebook', 12],
      ['Other', 5],
    ]);
  });

  it('still emits Referral sources with zero rows when empty', () => {
    const result = buildAdmissionsDashboardExport({
      ...baseInput,
      referral: [],
    });
    const ref = result.sections.find((s) => s.title === 'Referral sources')!;
    expect(ref).toBeDefined();
    expect(ref.rows).toEqual([]);
  });

  it('summarizes the two spotlight stats at the precision the cards already carry', () => {
    const result = buildAdmissionsDashboardExport(baseInput);
    const summary = result.sections.find((s) => s.title === 'Summary')!;
    expect(summary.headers).toEqual(['Metric', 'Value']);
    expect(summary.rows).toEqual([
      ['Pre-course counselling complete (%)', 75],
      ['Avg application rating (out of 5)', 4.2],
    ]);
  });

  it('blanks the spotlight values when the card would show an em-dash', () => {
    const result = buildAdmissionsDashboardExport({
      ...baseInput,
      preCourseStats: { total: 0, complete: 0, notYet: 0, completionPct: null },
      feedbackStats: {
        total: 0,
        avgRating: null,
        ratingCount: 0,
        consentCount: 0,
        consentRate: null,
      },
    });
    const summary = result.sections.find((s) => s.title === 'Summary')!;
    expect(summary.rows).toEqual([
      ['Pre-course counselling complete (%)', null],
      ['Avg application rating (out of 5)', null],
    ]);
  });

  it('emits Documents to chase only for the tiles that would actually show, admissions never shows expiring-soon', () => {
    const result = buildAdmissionsDashboardExport(baseInput);
    const chase = result.sections.find(
      (s) => s.title === 'Documents to chase'
    )!;
    expect(chase.headers).toEqual(['Category', 'Applicants']);
    expect(chase.rows).toEqual([
      ['Awaiting revalidation', 1],
      ['Awaiting validation', 2],
      ['Awaiting promised', 3],
    ]);
  });

  it('omits Documents to chase for an oversight (non-operational) viewer', () => {
    const result = buildAdmissionsDashboardExport({
      ...baseInput,
      isOperational: false,
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Documents to chase'
    );
  });

  it('omits Documents to chase when every count is zero, even for an operational viewer', () => {
    const result = buildAdmissionsDashboardExport({
      ...baseInput,
      chaseQueueCounts: {
        promised: 0,
        validation: 0,
        revalidation: 0,
        expiringSoon: 0,
      },
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Documents to chase'
    );
  });

  it('omits Documents to chase when chaseQueueCounts is null', () => {
    const result = buildAdmissionsDashboardExport({
      ...baseInput,
      chaseQueueCounts: null,
    });
    expect(result.sections.map((s) => s.title)).not.toContain(
      'Documents to chase'
    );
  });

  it('includes the early-bird figures when an upcoming AY is open, renders for every role', () => {
    const result = buildAdmissionsDashboardExport({
      ...baseInput,
      isOperational: false,
    });
    const earlyBird = result.sections.find((s) =>
      s.title.startsWith('Early-bird applications')
    )!;
    expect(earlyBird.headers).toEqual(['Stage', 'Applications']);
    expect(earlyBird.rows).toEqual([
      ['Total applications', 8],
      ['Submitted', 4],
      ['Ongoing Verification', 2],
      ['Processing', 1],
    ]);
    // Pin: NOT the sum of the stage rows (4+2+1=7) — the card's own headline
    // number (applicationCount), carried through as-is.
    expect(earlyBird.rows[0][1]).toBe(8);
  });

  it('omits the early-bird section when there is no upcoming AY', () => {
    const result = buildAdmissionsDashboardExport({
      ...baseInput,
      upcomingAy: null,
    });
    expect(
      result.sections.some((s) => s.title.startsWith('Early-bird applications'))
    ).toBe(false);
  });
});

describe('admissions dashboard page wiring', () => {
  it('renders ExportCsvButton exactly once, only on the main view (not the focused ?status= branch)', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/(admissions)/admissions/page.tsx'),
      'utf8'
    );
    const matches = source.match(/<ExportCsvButton\b/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
