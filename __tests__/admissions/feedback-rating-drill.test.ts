import { describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({
  apps: [] as Array<Record<string, unknown>>,
  statuses: [] as Array<Record<string, unknown>>,
  // The level catalog + one enrolment-form alias, so the loader's resolver
  // has something to map ("Year 10" counts as Secondary Three).
  levels: [
    {
      id: 'lv-s3',
      code: 'S3',
      label: 'Secondary Three',
      level_type: 'secondary',
      sort_order: 30,
      next_level_id: null,
      is_core: true,
    },
  ],
  aliases: [{ raw_label: 'Year 10', level_id: 'lv-s3' }],
}));

vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => {
        if (table === 'levels') {
          return {
            order: () => ({
              order: () => Promise.resolve({ data: fx.levels, error: null }),
            }),
          };
        }
        if (table === 'level_aliases') {
          return Promise.resolve({ data: fx.aliases, error: null });
        }
        return {
          range: () =>
            Promise.resolve({
              data: table.endsWith('_enrolment_applications')
                ? fx.apps
                : fx.statuses,
              error: null,
            }),
        };
      },
    }),
  }),
}));

import { getAdmissionsFeedback } from '@/lib/admissions/feedback';
import {
  FEEDBACK_DRILL_CSV_HEADERS,
  feedbackDrillCsvRow,
  feedbackRatingBuckets,
  filterFeedbackByRating,
} from '@/lib/admissions/feedback-drill';

const RATINGS: Array<number | null> = [5, 5, 4, 3, 1, 0, 6, null, 2, null];
fx.apps = RATINGS.map((feedbackRating, i) => ({
  enroleeNumber: `E${i}`,
  studentNumber: null,
  enroleeFullName: `Child ${i}`,
  levelApplied: i === 0 ? 'Year 10' : 'P1',
  feedbackRating,
  feedbackComments: i === 0 ? '  Easy form  ' : null,
  feedbackConsent: i === 0 ? true : null,
  // Row 7 (null rating) has a submission date so it is kept; row 9 is not.
  feedbackSubmittedAt: i === 9 ? null : `2026-02-0${(i % 9) + 1}T00:00:00Z`,
  motherEmail: null,
  fatherEmail: null,
}));
fx.statuses = RATINGS.map((_, i) => ({
  enroleeNumber: `E${i}`,
  applicationStatus: i === 0 ? 'Enrolled' : 'Submitted',
}));

describe('feedback-rating drill', () => {
  it('each ★ bar opens exactly the parents who gave that rating', async () => {
    const { rows } = await getAdmissionsFeedback('AY2026');
    const buckets = feedbackRatingBuckets(rows);
    expect(buckets).toEqual([
      { stars: 1, count: 1 },
      { stars: 2, count: 1 },
      { stars: 3, count: 1 },
      { stars: 4, count: 1 },
      { stars: 5, count: 2 },
    ]);
    for (const b of buckets) {
      expect(filterFeedbackByRating(rows, String(b.stars))).toHaveLength(
        b.count
      );
    }
  });

  it('no segment opens every in-scale rating — the response count on the card', async () => {
    const { rows, stats } = await getAdmissionsFeedback('AY2026');
    expect(filterFeedbackByRating(rows, null)).toHaveLength(stats.ratingCount);
  });

  it('an off-scale or unreadable segment opens an empty list', async () => {
    const { rows } = await getAdmissionsFeedback('AY2026');
    for (const seg of ['0', '6', 'abc', '4.5']) {
      expect(filterFeedbackByRating(rows, seg)).toEqual([]);
    }
  });

  it('resolves the applied-for name to the SIS level it counts as', async () => {
    const { rows } = await getAdmissionsFeedback('AY2026');
    const e0 = rows.find((r) => r.enroleeNumber === 'E0')!;
    expect(e0.levelApplied).toBe('Year 10');
    expect(e0.level).toBe('Secondary Three');
    // An unmapped name stays as stored.
    expect(rows.find((r) => r.enroleeNumber === 'E1')!.level).toBe('P1');
  });

  it('writes one CSV cell per header', async () => {
    const { rows } = await getAdmissionsFeedback('AY2026');
    const row = rows.find((r) => r.enroleeNumber === 'E0')!;
    const cells = feedbackDrillCsvRow(row);
    expect(cells).toHaveLength(FEEDBACK_DRILL_CSV_HEADERS.length);
    expect(cells).toEqual([
      'Child 0',
      'E0',
      '',
      'Secondary Three',
      'Year 10',
      'Enrolled',
      5,
      'Easy form',
      'Yes',
      '2026-02-01T00:00:00Z',
    ]);
  });
});
