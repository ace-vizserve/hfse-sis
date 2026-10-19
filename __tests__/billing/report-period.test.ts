import { describe, expect, it } from 'vitest';

import { periodRange, resolveReportPeriod } from '@/lib/billing/report-period';

const today = '2026-10-19';

describe('periodRange', () => {
  it('resolves QuickBooks’ report periods', () => {
    expect(periodRange('today', today)).toEqual({ from: today, to: today });
    expect(periodRange('this-month', today)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(periodRange('last-month', today)).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(periodRange('this-quarter', today)).toEqual({
      from: '2026-10-01',
      to: '2026-12-31',
    });
    expect(periodRange('this-year', today)).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(periodRange('last-year', today)).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });

  it('crosses the year for last month in January, and knows leap Februaries', () => {
    expect(periodRange('last-month', '2026-01-10')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(periodRange('this-month', '2028-02-03').to).toBe('2028-02-29');
  });
});

describe('resolveReportPeriod', () => {
  it('opens on the fallback period, as of its last day', () => {
    expect(resolveReportPeriod({}, today)).toMatchObject({
      period: 'today',
      asOf: today,
    });
    expect(resolveReportPeriod({}, today, 'this-month')).toMatchObject({
      period: 'this-month',
      from: '2026-10-01',
      to: '2026-10-31',
      asOf: '2026-10-31',
    });
  });

  it('reads custom dates, swaps a backwards period, ignores bad dates', () => {
    expect(resolveReportPeriod({ asOf: '2026-03-31' }, today)).toMatchObject({
      period: 'custom',
      asOf: '2026-03-31',
    });
    expect(
      resolveReportPeriod(
        { period: 'custom', from: '2026-05-01', to: '2026-02-01' },
        today
      )
    ).toMatchObject({ from: '2026-02-01', to: '2026-05-01' });
    expect(
      resolveReportPeriod({ period: 'custom', asOf: '2026-02-31' }, today).asOf
    ).toBe(today);
  });

  it('a preset wins over stale dates in the address', () => {
    expect(
      resolveReportPeriod({ period: 'last-year', asOf: '2026-03-31' }, today)
        .asOf
    ).toBe('2025-12-31');
  });
});
