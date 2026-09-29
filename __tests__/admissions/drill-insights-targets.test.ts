// __tests__/admissions/drill-insights-targets.test.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
}));
vi.mock('@/lib/supabase/admissions', () => ({
  createAdmissionsClient: vi.fn(),
}));

import {
  applyTargetFilter,
  drillHeaderForTarget,
  parseAssessmentAllSegment,
  type DrillRow,
} from '@/lib/admissions/drill';
import {
  encodePairSegment,
  OVERFLOW_SEGMENT,
} from '@/lib/admissions/insights-predicates';

function makeRow(overrides: Partial<DrillRow>): DrillRow {
  return {
    enroleeNumber: 'ENR-0001',
    studentNumber: null,
    fullName: 'Doe, Jane',
    status: 'Submitted',
    level: 'P1',
    stage: 'Submitted',
    pipelineStage: 'Submitted',
    referralSource: null,
    assessmentMath: null,
    assessmentEnglish: null,
    assessmentMathOutcome: 'unknown',
    assessmentEnglishOutcome: 'unknown',
    assessmentOutcome: 'unknown',
    applicationDate: '2026-01-01T00:00:00.000Z',
    enrollmentDate: null,
    daysToEnroll: null,
    daysSinceUpdate: null,
    rawDaysSinceUpdate: null,
    daysInPipeline: 10,
    hasMissingDocs: true,
    documentsComplete: 0,
    documentsTotal: 5,
    levelAsApplied: 'P1',
    terminalReason: null,
    category: null,
    nationality: null,
    ...overrides,
  };
}

describe('funnel-stage — the card’s predicate', () => {
  it('leaves a blank or unrecognised status out of Submitted', () => {
    const rows = [
      makeRow({ status: 'Processing' }),
      makeRow({ status: 'No status' }),
      makeRow({ status: 'Deferred' }),
      makeRow({ status: 'Cancelled' }),
    ];
    expect(applyTargetFilter(rows, 'funnel-stage', 'Submitted')).toHaveLength(
      1
    );
  });
});

describe('an unreadable segment opens an empty list, never every row', () => {
  it.each([
    'intake-month',
    'assessment-all',
    'terminal-reason',
    'nationality',
  ] as const)('%s', (target) => {
    expect(applyTargetFilter([makeRow({})], target, 'garbage')).toEqual([]);
  });
});

describe('withdrawn-by-level groups by the level as applied', () => {
  it('ignores the class level the status table prefers', () => {
    const rows = [
      makeRow({ status: 'Withdrawn', level: 'P3', levelAsApplied: 'P1' }),
      makeRow({ status: 'Cancelled', levelAsApplied: 'P1' }),
    ];
    expect(applyTargetFilter(rows, 'withdrawn-by-level', 'P1')).toHaveLength(1);
    expect(applyTargetFilter(rows, 'withdrawn-by-level', 'P3')).toHaveLength(0);
  });
});

describe('terminal-reason', () => {
  const rows = [
    makeRow({
      terminalReason: 'financial',
      levelAsApplied: 'Youngstarters | Little Stars',
    }),
    makeRow({ terminalReason: 'visa_denied', levelAsApplied: 'P1' }),
    makeRow({ terminalReason: null }),
  ];
  it('matches a level whose label contains the separator', () => {
    expect(
      applyTargetFilter(
        rows,
        'terminal-reason',
        encodePairSegment('Youngstarters | Little Stars', '')
      )
    ).toHaveLength(1);
  });
  it('lists only applications with a reason when no segment is given', () => {
    expect(applyTargetFilter(rows, 'terminal-reason')).toHaveLength(2);
  });
});

describe('assessment-all keeps cancelled and withdrawn applicants', () => {
  it('matches the chart, unlike the dashboard’s assessment target', () => {
    const rows = [
      makeRow({ status: 'Cancelled', assessmentEnglishOutcome: 'unknown' }),
      makeRow({ status: 'Submitted', assessmentEnglishOutcome: 'unknown' }),
    ];
    expect(
      applyTargetFilter(rows, 'assessment-all', 'eng:notAssessed')
    ).toHaveLength(2);
    expect(parseAssessmentAllSegment('eng:notAssessed')).toEqual({
      subject: 'eng',
      outcome: 'unknown',
    });
    expect(parseAssessmentAllSegment('science:pass')).toBeNull();
  });
});

describe('headers read in plain English', () => {
  it('names the overflow reason bucket', () => {
    expect(
      drillHeaderForTarget(
        'terminal-reason',
        encodePairSegment('', OVERFLOW_SEGMENT)
      ).title
    ).toBe('Cancelled or withdrawn — other reasons');
  });
  it('names the Submitted list after the card', () => {
    expect(drillHeaderForTarget('funnel-stage', 'Submitted').title).toBe(
      'Applications received'
    );
  });
  it('names a failed assessment without jargon', () => {
    expect(drillHeaderForTarget('assessment-all', 'math:fail').title).toBe(
      'Applicants who did not pass the Maths assessment'
    );
  });
});
