import { describe, expect, it } from 'vitest';

import {
  computeFeedbackStats,
  isRatingInScale,
  type FeedbackRow,
} from '@/lib/admissions/feedback';

/**
 * Two defects, both found 2026-09-23 and both in the arithmetic rather than
 * the query:
 *
 *   1. The average filtered on `!== null`, so any number in `feedbackRating`
 *      counted as a real score. The column is a bare `smallint null` with no
 *      CHECK, so the 1-5 scale was a convention the parent portal's
 *      five-option control happened to keep. These tests are what enforces it
 *      now — the reader excludes an off-scale value instead of averaging it.
 *   2. The consent rate divided a numerator counted over ALL feedback rows by
 *      a denominator counted over RATED rows only. AY2027 showed 46% beside
 *      its own "32 parents consented" and "76 responses" — which is 42%.
 */

function row(over: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    enroleeNumber: 'E-0001',
    enroleeFullName: 'Test Child',
    studentNumber: null,
    levelApplied: 'Primary One',
    applicationStatus: 'Submitted',
    feedbackRating: null,
    feedbackComments: null,
    feedbackConsent: null,
    feedbackSubmittedAt: '2026-09-01T00:00:00.000Z',
    motherEmail: null,
    fatherEmail: null,
    ...over,
  };
}

describe('isRatingInScale', () => {
  it('accepts every point on the scale and nothing else', () => {
    for (const v of [1, 2, 3, 4, 5]) expect(isRatingInScale(v)).toBe(true);
    for (const v of [0, 6, -1, 99, 2.5]) expect(isRatingInScale(v)).toBe(false);
    expect(isRatingInScale(null)).toBe(false);
    expect(isRatingInScale(undefined)).toBe(false);
  });
});

describe('computeFeedbackStats — the average', () => {
  it('averages the ratings on the scale', () => {
    const stats = computeFeedbackStats([
      row({ feedbackRating: 3 }),
      row({ feedbackRating: 4 }),
      row({ feedbackRating: 5 }),
    ]);
    expect(stats.avgRating).toBe(4);
    expect(stats.ratingCount).toBe(3);
  });

  it('leaves an off-scale value out of the average and the count', () => {
    // Without the range check the 0 drags a clean 4.0 down to 2.7, and a 6
    // pushes it above the top of the scale.
    const stats = computeFeedbackStats([
      row({ feedbackRating: 4 }),
      row({ feedbackRating: 4 }),
      row({ feedbackRating: 0 }),
      row({ feedbackRating: 6 }),
      row({ feedbackRating: -1 }),
    ]);
    expect(stats.avgRating).toBe(4);
    expect(stats.ratingCount).toBe(2);
  });

  it('still lists the off-scale row, it just does not score it', () => {
    // Bad data stays visible to whoever can fix it.
    const rows = [row({ feedbackRating: 4 }), row({ feedbackRating: 9 })];
    const stats = computeFeedbackStats(rows);
    expect(stats.total).toBe(2);
    expect(stats.ratingCount).toBe(1);
  });

  it('never averages a non-integer', () => {
    const stats = computeFeedbackStats([row({ feedbackRating: 2.5 })]);
    expect(stats.avgRating).toBeNull();
    expect(stats.ratingCount).toBe(0);
  });

  it('reports no average when nothing is rated', () => {
    const stats = computeFeedbackStats([row(), row()]);
    expect(stats.avgRating).toBeNull();
    expect(stats.ratingCount).toBe(0);
    expect(stats.total).toBe(2);
  });

  it('rounds to one decimal place', () => {
    const stats = computeFeedbackStats([
      row({ feedbackRating: 4 }),
      row({ feedbackRating: 5 }),
      row({ feedbackRating: 5 }),
    ]);
    expect(stats.avgRating).toBe(4.7);
  });
});

describe('computeFeedbackStats — the consent rate', () => {
  it('divides by every response, not just the rated ones', () => {
    // The shape of the AY2027 reading, in miniature: 1 of 3 consented, and
    // one respondent skipped the rating. Rated-only would have said 50%.
    const stats = computeFeedbackStats([
      row({ feedbackRating: 4, feedbackConsent: true }),
      row({ feedbackRating: 3, feedbackConsent: false }),
      row({ feedbackRating: null, feedbackConsent: false }),
    ]);
    expect(stats.total).toBe(3);
    expect(stats.ratingCount).toBe(2);
    expect(stats.consentCount).toBe(1);
    expect(stats.consentRate).toBe(33);
  });

  it('agrees with the two numbers shown beside it', () => {
    // The card renders consentCount and total as well, so the percentage has
    // to be the one a reader gets by dividing them.
    const rows = [
      ...Array.from({ length: 32 }, () => row({ feedbackConsent: true })),
      ...Array.from({ length: 44 }, () => row({ feedbackConsent: false })),
    ];
    const stats = computeFeedbackStats(rows);
    expect(stats.consentCount).toBe(32);
    expect(stats.total).toBe(76);
    expect(stats.consentRate).toBe(Math.round((32 / 76) * 100));
  });

  it('cannot exceed 100% even when no one rated', () => {
    // The old denominator would have divided by zero here and, with any rated
    // row present, could have run past 100 on the same data.
    const stats = computeFeedbackStats([
      row({ feedbackRating: null, feedbackConsent: true }),
      row({ feedbackRating: null, feedbackConsent: true }),
    ]);
    expect(stats.consentRate).toBe(100);
  });

  it('treats a null consent as not consented', () => {
    const stats = computeFeedbackStats([
      row({ feedbackConsent: null }),
      row({ feedbackConsent: true }),
    ]);
    expect(stats.consentCount).toBe(1);
    expect(stats.consentRate).toBe(50);
  });

  it('reports no rate when there is no feedback at all', () => {
    expect(computeFeedbackStats([]).consentRate).toBeNull();
    expect(computeFeedbackStats([]).avgRating).toBeNull();
    expect(computeFeedbackStats([]).total).toBe(0);
  });
});
