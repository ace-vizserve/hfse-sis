// The ★ histogram on /admissions/insights and the list each bar opens, from
// one rule (KD #229): a rating bucket is `feedbackRating === stars` over the
// in-scale values. Server-side only in practice — it imports the feedback
// loader's module; the client sheet imports just the FeedbackRow type.

import {
  FEEDBACK_RATING_MAX,
  FEEDBACK_RATING_MIN,
  isRatingInScale,
  type FeedbackRow,
} from '@/lib/admissions/feedback';

export type RatingBucket = { stars: number; count: number };

/** No segment = every in-scale rating (the card's response count); a star
 *  value = that rating; anything else = an empty list. */
export function filterFeedbackByRating(
  rows: readonly FeedbackRow[],
  segment: string | null | undefined
): FeedbackRow[] {
  if (segment === null || segment === undefined || segment === '') {
    return rows.filter((r) => isRatingInScale(r.feedbackRating));
  }
  const stars = Number(segment);
  if (!isRatingInScale(stars)) return [];
  return rows.filter((r) => r.feedbackRating === stars);
}

/** One bucket per star on the scale, zero-count ones included. */
export function feedbackRatingBuckets(
  rows: readonly FeedbackRow[]
): RatingBucket[] {
  return Array.from(
    { length: FEEDBACK_RATING_MAX - FEEDBACK_RATING_MIN + 1 },
    (_, i) => FEEDBACK_RATING_MIN + i
  ).map((stars) => ({
    stars,
    count: filterFeedbackByRating(rows, String(stars)).length,
  }));
}

export const FEEDBACK_DRILL_CSV_HEADERS = [
  'Applicant',
  'Applicant Number',
  'Student ID',
  'Level applied for',
  'Status',
  'Rating',
  'Comment',
  'Open to follow-up',
  'Submitted on',
];

export function feedbackDrillCsvRow(r: FeedbackRow): (string | number)[] {
  return [
    r.enroleeFullName ?? '',
    r.enroleeNumber,
    r.studentNumber ?? '',
    r.levelApplied ?? '',
    (r.applicationStatus ?? '').trim() || 'No status',
    r.feedbackRating ?? '',
    r.feedbackComments ?? '',
    r.feedbackConsent === true
      ? 'Yes'
      : r.feedbackConsent === false
        ? 'No'
        : '',
    r.feedbackSubmittedAt ?? '',
  ];
}
