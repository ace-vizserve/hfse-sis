import { describe, expect, it } from 'vitest';

import {
  STALENESS_FOLLOW_UP_VALUES,
  STALENESS_LABELS,
  daysSinceUpdate,
  isFollowUpStaleness,
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
  // Intentionally updated (Task H-C): the vocabulary now includes
  // 'Never updated' so the dashboard's "needs follow-up" deep-link shows
  // the null-date rows that getOutdatedApplications counts (count == drill,
  // KD #124). In prod applicationUpdatedDate is largely unpopulated, so
  // never-updated is the dominant tier.
  it('is the >= 7-day tiers plus Never updated', () => {
    expect(STALENESS_FOLLOW_UP_VALUES).toEqual([
      STALENESS_LABELS.warning,
      STALENESS_LABELS.critical,
      STALENESS_LABELS.unknown,
    ]);
  });

  it("includes 'Never updated' (null-basis rows stay reachable via the deep-link)", () => {
    expect(STALENESS_FOLLOW_UP_VALUES).toContain(STALENESS_LABELS.unknown);
  });
});

describe('isFollowUpStaleness — the shared count/deep-link predicate', () => {
  it('keeps exactly what getOutdatedApplications keeps: null or >= 7 days', () => {
    // Never updated (null applicationUpdatedDate) → counted AND deep-linked.
    expect(isFollowUpStaleness(stalenessLabel(null))).toBe(true);
    // Warning boundary (7–13d) → in.
    expect(isFollowUpStaleness(stalenessLabel(7))).toBe(true);
    expect(isFollowUpStaleness(stalenessLabel(13))).toBe(true);
    // Critical (>= 14d) → in.
    expect(isFollowUpStaleness(stalenessLabel(14))).toBe(true);
    // Fresh (< 7d) → dropped from both the count and the deep-link.
    expect(isFollowUpStaleness(stalenessLabel(0))).toBe(false);
    expect(isFollowUpStaleness(stalenessLabel(6))).toBe(false);
  });

  it('null applicationUpdatedDate with no other date → Never updated tier', () => {
    // getOutdatedApplications has NO created_at fallback for staleness
    // (verified — created_at only feeds daysInPipeline). A row with no
    // update stamp is simply the 'Never updated' tier, everywhere.
    expect(stalenessLabel(daysSinceUpdate(null))).toBe(
      STALENESS_LABELS.unknown
    );
    expect(stalenessLabel(daysSinceUpdate(undefined))).toBe(
      STALENESS_LABELS.unknown
    );
  });
});
