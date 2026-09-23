import { unstable_cache } from 'next/cache';

import { createServiceClient } from '@/lib/supabase/service';
import { fetchAllPages } from '@/lib/supabase/paginate';

// ──────────────────────────────────────────────────────────────────────────
// Application experience feedback.
//
// Parents optionally rate their online application form experience on a 1–5
// scale after submitting. This loader surfaces those responses alongside the
// aggregate stats (avg rating, consent rate) for the dedicated
// /admissions/feedback analytics page and the admissions dashboard cards.
//
// The four feedback columns live on ay{YYYY}_enrolment_applications:
//   feedbackRating        smallint null   (1 = Very Difficult … 5 = Excellent)
//   feedbackComments      text null
//   feedbackConsent       boolean null    (parent allows follow-up contact)
//   feedbackSubmittedAt   timestamp null
//
// Scope: all applicants with at least one feedback field populated — no
// status filter, since feedback is about the form UX, not the pipeline stage.
// ──────────────────────────────────────────────────────────────────────────

export type FeedbackRow = {
  enroleeNumber: string;
  enroleeFullName: string | null;
  studentNumber: string | null;
  levelApplied: string | null;
  applicationStatus: string | null;
  feedbackRating: number | null;
  feedbackComments: string | null;
  feedbackConsent: boolean | null;
  feedbackSubmittedAt: string | null;
  motherEmail: string | null;
  fatherEmail: string | null;
};

export type FeedbackStats = {
  total: number;
  avgRating: number | null;
  ratingCount: number;
  consentCount: number;
  consentRate: number | null;
};

export type FeedbackResult = {
  rows: FeedbackRow[];
  stats: FeedbackStats;
};

/** The scale, stated once. 1 = Very Difficult … 5 = Excellent. */
export const FEEDBACK_RATING_MIN = 1;
export const FEEDBACK_RATING_MAX = 5;

/**
 * Is this a rating the app is willing to average?
 *
 * ⚠ THIS IS WHERE THE SCALE IS ENFORCED, AND THE ONLY PLACE IT HAS TEETH FOR
 * DATA THAT IS ALREADY STORED. The column is a bare `smallint null` in every
 * copy of the admissions DDL — no CHECK — so the database will accept any
 * smallint. The two writers happen to behave (the parent portal renders five
 * options and sends null, never 0, when a parent skips; `ProfileUpdateSchema`
 * carries `z.number().int().min(1).max(5)` on the one SIS write path), but
 * neither is durable: the portal's `feedbackRating: number | null` is a
 * TypeScript type that erases at runtime, and a Directus import or a hand-run
 * UPDATE answers to neither.
 *
 * So the reader does not assume. An off-scale value is excluded from the
 * numbers rather than averaged into them, which is what the caller below is
 * protecting.
 */
export function isRatingInScale(value: number | null | undefined): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= FEEDBACK_RATING_MIN &&
    value <= FEEDBACK_RATING_MAX
  );
}

/**
 * The three headline numbers on /admissions/feedback, from the rows it lists.
 *
 * Pure — no DB access, unit-tested directly. Split out of the loader for the
 * same reason `lib/sis/level-review.ts` splits its diff: the arithmetic is
 * where the bugs were, and it should be testable without a database.
 */
export function computeFeedbackStats(rows: FeedbackRow[]): FeedbackStats {
  // ⚠ IN SCALE, NOT MERELY NON-NULL. This filtered on `!== null` alone, so any
  // number in the column was averaged as a real score — a 0, a 6, a -1.
  //
  // It also disagreed with the insights histogram, which buckets 1..5
  // explicitly and therefore DROPPED an off-scale value while this line
  // COUNTED it — one card showing an average its own bars cannot produce, with
  // nothing to flag it. Both now read the scale from the same constants.
  //
  // The row itself stays listed with its raw value — bad data should be
  // visible to whoever can fix it, not quietly filtered out of the table too.
  const ratingRows = rows.filter((r) => isRatingInScale(r.feedbackRating));
  const avgRating =
    ratingRows.length > 0
      ? Math.round(
          (ratingRows.reduce((s, r) => s + (r.feedbackRating ?? 0), 0) /
            ratingRows.length) *
            10
        ) / 10
      : null;
  const consentCount = rows.filter((r) => r.feedbackConsent === true).length;

  return {
    total: rows.length,
    avgRating,
    ratingCount: ratingRows.length,
    consentCount,
    // ⚠ THE DENOMINATOR IS EVERY FEEDBACK RESPONSE, NOT JUST THE RATED ONES.
    // `consentCount` is counted over all rows, and dividing it by the rated
    // subset mixed two populations: AY2027 showed "46% open to follow-up"
    // beside its own "32 parents consented" and "76 responses", which is 42%.
    // Skipping the rating sets consent false, so the rated-only denominator
    // dropped exactly the rows guaranteed to be non-consenters and inflated
    // the figure every time. It could not exceed 100% by luck, not by design.
    consentRate:
      rows.length > 0 ? Math.round((consentCount / rows.length) * 100) : null,
  };
}

const FEEDBACK_APP_COLUMNS = [
  'enroleeNumber',
  'studentNumber',
  'enroleeFullName',
  'levelApplied',
  'feedbackRating',
  'feedbackComments',
  'feedbackConsent',
  'feedbackSubmittedAt',
  'motherEmail',
  'fatherEmail',
];

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

function tag(ayCode: string): string[] {
  return ['sis', `sis:${ayCode}`];
}

type AppRow = Record<string, unknown> & { enroleeNumber: string | null };
type StatusRow = {
  enroleeNumber: string | null;
  applicationStatus: string | null;
};

async function loadFeedbackUncached(ayCode: string): Promise<FeedbackResult> {
  const prefix = prefixFor(ayCode);
  const supabase = createServiceClient();

  const [apps, statuses] = await Promise.all([
    fetchAllPages<AppRow>(
      (from, to) =>
        supabase
          .from(`${prefix}_enrolment_applications`)
          .select(FEEDBACK_APP_COLUMNS.join(', '))
          .range(from, to) as unknown as PromiseLike<{
          data: AppRow[] | null;
          error: { message: string } | null;
        }>
    ),
    fetchAllPages<StatusRow>(
      (from, to) =>
        supabase
          .from(`${prefix}_enrolment_status`)
          .select('enroleeNumber, applicationStatus')
          .range(from, to) as unknown as PromiseLike<{
          data: StatusRow[] | null;
          error: { message: string } | null;
        }>
    ),
  ]);

  const statusByEnrolee = new Map<string, string | null>();
  for (const s of statuses) {
    if (s.enroleeNumber)
      statusByEnrolee.set(s.enroleeNumber, s.applicationStatus);
  }

  const rows: FeedbackRow[] = [];
  for (const app of apps) {
    if (!app.enroleeNumber) continue;
    const rating =
      typeof app.feedbackRating === 'number' ? app.feedbackRating : null;
    const submittedAt =
      typeof app.feedbackSubmittedAt === 'string'
        ? app.feedbackSubmittedAt.trim() || null
        : null;
    // Only rows where at least one feedback field is set
    if (rating === null && !submittedAt) continue;

    rows.push({
      enroleeNumber: app.enroleeNumber as string,
      enroleeFullName: (app.enroleeFullName as string | null) ?? null,
      studentNumber: (app.studentNumber as string | null) ?? null,
      levelApplied: (app.levelApplied as string | null) ?? null,
      applicationStatus: statusByEnrolee.get(app.enroleeNumber) ?? null,
      feedbackRating: rating,
      feedbackComments: (app.feedbackComments as string | null)?.trim() || null,
      feedbackConsent: (app.feedbackConsent as boolean | null) ?? null,
      feedbackSubmittedAt: submittedAt,
      motherEmail: (app.motherEmail as string | null)?.trim() || null,
      fatherEmail: (app.fatherEmail as string | null)?.trim() || null,
    });
  }

  // Most recent submission first, no-date at end
  rows.sort((a, b) => {
    const aMs = a.feedbackSubmittedAt
      ? Date.parse(a.feedbackSubmittedAt)
      : -Infinity;
    const bMs = b.feedbackSubmittedAt
      ? Date.parse(b.feedbackSubmittedAt)
      : -Infinity;
    return bMs - aMs;
  });

  return { rows, stats: computeFeedbackStats(rows) };
}

export function getAdmissionsFeedback(ayCode: string): Promise<FeedbackResult> {
  return unstable_cache(
    () => loadFeedbackUncached(ayCode),
    ['sis', 'admissions', 'feedback', ayCode],
    { tags: tag(ayCode), revalidate: 60 }
  )();
}

// ─── Lightweight pre-course stats for the dashboard ──────────────────────────

export type PreCourseStats = {
  total: number;
  complete: number;
  // not-yet-counselled = explicit "No" OR no answer recorded yet — every
  // applicant must be counselled before submitting, so a blank is simply "not
  // done yet" (no separate "pending" bucket).
  notYet: number;
  completionPct: number | null;
};

const PRE_COURSE_STAT_COLUMNS = [
  'enroleeNumber',
  'preCourseAnswer',
  'preCourseDate',
  'preCourseAcknowledgedAt',
];

const FUNNEL_STATUSES = new Set([
  'Submitted',
  'Ongoing Verification',
  'Processing',
]);

async function loadPreCourseStatsUncached(
  ayCode: string
): Promise<PreCourseStats> {
  const prefix = prefixFor(ayCode);
  const supabase = createServiceClient();

  const [apps, statuses] = await Promise.all([
    fetchAllPages<AppRow>(
      (from, to) =>
        supabase
          .from(`${prefix}_enrolment_applications`)
          .select(PRE_COURSE_STAT_COLUMNS.join(', '))
          .range(from, to) as unknown as PromiseLike<{
          data: AppRow[] | null;
          error: { message: string } | null;
        }>
    ),
    fetchAllPages<StatusRow>(
      (from, to) =>
        supabase
          .from(`${prefix}_enrolment_status`)
          .select('enroleeNumber, applicationStatus')
          .range(from, to) as unknown as PromiseLike<{
          data: StatusRow[] | null;
          error: { message: string } | null;
        }>
    ),
  ]);

  const statusByEnrolee = new Map<string, string | null>();
  for (const s of statuses) {
    if (s.enroleeNumber)
      statusByEnrolee.set(s.enroleeNumber, s.applicationStatus);
  }

  let total = 0;
  let complete = 0;
  let notYet = 0;

  for (const app of apps) {
    if (!app.enroleeNumber) continue;
    const appStatus = (statusByEnrolee.get(app.enroleeNumber) ?? '').trim();
    if (!FUNNEL_STATUSES.has(appStatus)) continue;

    const answer =
      typeof app.preCourseAnswer === 'string'
        ? app.preCourseAnswer.trim()
        : null;
    const date =
      typeof app.preCourseDate === 'string'
        ? app.preCourseDate.trim() || null
        : null;

    // Mirror the pre-course cohort table (lib/sis/cohorts.ts): a "Yes" with no
    // signing date is an invalid compliance record — exclude it from the counts
    // entirely so this stat agrees with the table. Completion proof = "Yes"
    // WITH a date (not the app-confirmation timestamp).
    if (answer === 'Yes' && date === null) continue;

    total++;
    // Counselled = "Yes" (date guaranteed present by the guard above). Everything
    // else (explicit "No" OR no answer yet) is not-yet-counselled.
    if (answer === 'Yes') {
      complete++;
    } else {
      notYet++;
    }
  }

  return {
    total,
    complete,
    notYet,
    completionPct: total > 0 ? Math.round((complete / total) * 100) : null,
  };
}

export function getPreCourseStats(ayCode: string): Promise<PreCourseStats> {
  return unstable_cache(
    () => loadPreCourseStatsUncached(ayCode),
    ['sis', 'admissions', 'pre-course-stats', ayCode],
    { tags: tag(ayCode), revalidate: 60 }
  )();
}
