import { describe, expect, it } from 'vitest';

import {
  computeAverageTimeToEnrollment,
  computeConversionFunnel,
} from '@/lib/admissions/dashboard';
import {
  intakeRowsFromApps,
  shapeIntakeTrendPoints,
} from '@/lib/admissions/insights-compare';

describe('computeConversionFunnel', () => {
  it('counts a blank or unrecognised status in no stage, and trims', () => {
    const funnel = computeConversionFunnel([
      { applicationStatus: 'Submitted' },
      { applicationStatus: ' Processing ' },
      { applicationStatus: 'Enrolled (Conditional)' },
      { applicationStatus: '' },
      { applicationStatus: null },
      { applicationStatus: 'Deferred' },
      { applicationStatus: 'Cancelled' },
    ]);
    expect(funnel.map((s) => [s.stage, s.count])).toEqual([
      ['Submitted', 3],
      ['Ongoing Verification', 2],
      ['Processing', 2],
      ['Enrolled', 1],
    ]);
    expect(funnel.map((s) => s.dropOffPct)).toEqual([0, 33, 0, 50]);
  });
});

describe('computeAverageTimeToEnrollment — the drill’s rule', () => {
  it('leaves out an enrolment stamped hours before its application', () => {
    expect(
      computeAverageTimeToEnrollment([
        {
          applicationStatus: 'Enrolled',
          created_at: '2026-03-01T12:00:00Z',
          enrolledAt: '2026-03-01T06:00:00Z',
        },
      ]).sampleSize
    ).toBe(0);
  });

  it('reads a status with stray spaces as enrolled', () => {
    expect(
      computeAverageTimeToEnrollment([
        {
          applicationStatus: 'Enrolled ',
          created_at: '2026-03-01T00:00:00Z',
          enrolledAt: '2026-03-11T00:00:00Z',
        },
      ])
    ).toEqual({ avgDays: 10, sampleSize: 1 });
  });
});

describe('intake trend rows', () => {
  it('drops an application with no applicant number', () => {
    expect(
      intakeRowsFromApps('AY2026', [
        { enroleeNumber: 'E1', created_at: '2026-01-05T00:00:00Z' },
        { enroleeNumber: null, created_at: '2026-01-06T00:00:00Z' },
        { enroleeNumber: '', created_at: '2026-01-07T00:00:00Z' },
      ])
    ).toEqual([{ ayCode: 'AY2026', createdAt: '2026-01-05T00:00:00Z' }]);
  });

  it('ignores an unreadable date', () => {
    const points = shapeIntakeTrendPoints(
      [
        { ayCode: 'AY2026', createdAt: 'not a date' },
        { ayCode: 'AY2026', createdAt: '2026-02-01T00:00:00Z' },
      ],
      new Map([['AY2026', 10]])
    );
    expect(points.find((p) => p.periodLabel === 'Feb')?.value).toBe(1);
    expect(points.reduce((s, p) => s + (p.value ?? 0), 0)).toBe(1);
  });
});
