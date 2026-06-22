import { describe, expect, it } from 'vitest';

import {
  STALENESS_FOLLOW_UP_VALUES,
  STALENESS_LABELS,
  daysSinceUpdate,
  stalenessLabel,
  stalenessRank,
} from '@/lib/admissions/staleness';

describe('stalenessLabel — tier boundaries', () => {
  it('null day-count → Never updated', () => {
    expect(stalenessLabel(null)).toBe(STALENESS_LABELS.unknown);
  });

  it('< 7 days → Fresh (incl. the 6-day edge)', () => {
    expect(stalenessLabel(0)).toBe(STALENESS_LABELS.fresh);
    expect(stalenessLabel(6)).toBe(STALENESS_LABELS.fresh);
  });

  it('7–13 days → Warning (inclusive lower, exclusive upper)', () => {
    expect(stalenessLabel(7)).toBe(STALENESS_LABELS.warning);
    expect(stalenessLabel(13)).toBe(STALENESS_LABELS.warning);
  });

  it('>= 14 days → Critical', () => {
    expect(stalenessLabel(14)).toBe(STALENESS_LABELS.critical);
    expect(stalenessLabel(99)).toBe(STALENESS_LABELS.critical);
  });
});

describe('daysSinceUpdate', () => {
  it('returns null for null/empty/invalid input', () => {
    expect(daysSinceUpdate(null)).toBeNull();
    expect(daysSinceUpdate(undefined)).toBeNull();
    expect(daysSinceUpdate('')).toBeNull();
    expect(daysSinceUpdate('not-a-date')).toBeNull();
  });

  it('counts whole days since the timestamp', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    expect(daysSinceUpdate(tenDaysAgo)).toBe(10);
  });
});

describe('stalenessRank — severity ordering', () => {
  it('orders Critical < Warning < Fresh < Never updated', () => {
    expect(stalenessRank(STALENESS_LABELS.critical)).toBe(0);
    expect(stalenessRank(STALENESS_LABELS.warning)).toBe(1);
    expect(stalenessRank(STALENESS_LABELS.fresh)).toBe(2);
    expect(stalenessRank(STALENESS_LABELS.unknown)).toBe(3);
  });
});

describe('STALENESS_FOLLOW_UP_VALUES — deep-link vocabulary', () => {
  it('is exactly the >= 7-day tiers (Warning + Critical)', () => {
    expect(STALENESS_FOLLOW_UP_VALUES).toEqual([
      STALENESS_LABELS.warning,
      STALENESS_LABELS.critical,
    ]);
  });
});
