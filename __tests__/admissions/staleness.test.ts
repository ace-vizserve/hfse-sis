import { describe, expect, it, vi } from 'vitest';

import {
  STALENESS_FOLLOW_UP_VALUES,
  STALENESS_LABELS,
  daysSinceUpdate,
  isFollowUpStaleness,
  stalenessLabel,
  stalenessRank,
} from '@/lib/admissions/staleness';
import {
  ACTIVE_FUNNEL_STAGES,
  STAGE_STATUS_OPTIONS,
  isActiveFunnelStatus,
} from '@/lib/schemas/sis';

// ──────────────────────────────────────────────────────────────────────────
// Mocks for the end-to-end regression test below. `lib/admissions/dashboard.ts`
// funnels every aggregate through the module-private `loadJoinedRowsUncached`
// (KD #46 cache-wrapper pattern: uncached loaders stay unexported; only the
// `unstable_cache`-wrapped aggregators are public). So instead of exporting
// the private loader just to test it, this exercises it indirectly through
// `getOutdatedApplications` — the nearest exported function whose output field
// (`lastUpdated`) is a direct passthrough of `JoinedRow.applicationUpdatedDate`.
//
// `next/cache`'s `unstable_cache` is stubbed to a plain passthrough (mirrors
// __tests__/sis/staff-list.test.ts) so the cache wrapper doesn't need a real
// Next.js request context and every test call re-runs the loader fresh.
// `createAdmissionsClient` is stubbed to a fake PostgREST chain
// (`.from(table).select(...).range(...)`) returning fixed apps/status rows —
// mirrors __tests__/admissions/parent-email-ilike-escape.test.ts's
// `createServiceClient` mock shape.
// ──────────────────────────────────────────────────────────────────────────

vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
}));

const mockAppRow = {
  enroleeNumber: 'ENR-0001',
  enroleeFullName: 'Doe, Jane',
  firstName: 'Jane',
  lastName: 'Doe',
  levelApplied: 'P1',
  // Deliberately old + non-null, so a reintroduced `?? a.created_at`
  // fallback would be trivially observable in the asserted output below.
  created_at: '2020-01-01T00:00:00.000Z',
  howDidYouKnowAboutHFSEIS: null,
  studentNumber: null,
  motherEmail: null,
  fatherEmail: null,
};

const mockStatusRow = {
  enroleeNumber: 'ENR-0001',
  applicationStatus: 'Submitted',
  // The field under test — genuinely never touched since creation.
  applicationUpdatedDate: null as string | null,
  enrolledAt: null,
  classLevel: 'P1',
  levelApplied: 'P1',
  assessmentGradeMath: null,
  assessmentGradeEnglish: null,
};

vi.mock('@/lib/supabase/admissions', () => ({
  createAdmissionsClient: vi.fn(() => ({
    from: (table: string) => ({
      select: () => ({
        range: () => {
          if (table.endsWith('_enrolment_applications')) {
            return Promise.resolve({ data: [mockAppRow], error: null });
          }
          if (table.endsWith('_enrolment_status')) {
            return Promise.resolve({ data: [mockStatusRow], error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
      }),
    }),
  })),
}));

import { getOutdatedApplications } from '@/lib/admissions/dashboard';

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
    // getOutdatedApplications has no created_at fallback for staleness —
    // applicationUpdatedDate is DB-trigger-maintained since migration 087
    // (stamp_enrolment_status_touch), so a genuinely-untouched row reads
    // null all the way through, no substitution. (Prior to that migration,
    // lib/admissions/dashboard.ts silently substituted `a.created_at` for
    // a null applicationUpdatedDate before this predicate ever saw it —
    // this test only covered the pure helpers below in isolation and never
    // caught that. Don't repeat that gap: an end-to-end assertion follows.)
    expect(stalenessLabel(daysSinceUpdate(null))).toBe(
      STALENESS_LABELS.unknown
    );
    expect(stalenessLabel(daysSinceUpdate(undefined))).toBe(
      STALENESS_LABELS.unknown
    );
  });

  it('end-to-end: loadJoinedRowsUncached no longer substitutes created_at for a null applicationUpdatedDate', async () => {
    // Regression guard for the exact gap the comment above describes — runs
    // the REAL lib/admissions/dashboard.ts code path (via the mocked
    // Supabase client above), not a hand-copied expression. If the
    // `?? a.created_at` fallback were reintroduced into
    // loadJoinedRowsUncached, `lastUpdated` below would resolve to
    // '2020-01-01T00:00:00.000Z' (mockAppRow.created_at) instead of null,
    // and this assertion would fail.
    const rows = await getOutdatedApplications('AY2026');

    expect(rows).toHaveLength(1);
    expect(rows[0].enroleeNumber).toBe('ENR-0001');
    expect(rows[0].lastUpdated).toBeNull();
    expect(rows[0].lastUpdated).not.toBe(mockAppRow.created_at);
    expect(stalenessLabel(daysSinceUpdate(rows[0].lastUpdated))).toBe(
      STALENESS_LABELS.unknown
    );
  });
});

describe('isActiveFunnelStatus — the count/deep-link status scope', () => {
  // getOutdatedApplications (the "needs follow-up" count), its 'outdated'
  // drill, and the /admissions/applications list all scope through this one
  // predicate, so the counted population equals the deep-linked list's
  // population (count == drill, KD #124).
  it('keeps exactly the 3 in-flight funnel stages', () => {
    expect(isActiveFunnelStatus('Submitted')).toBe(true);
    expect(isActiveFunnelStatus('Ongoing Verification')).toBe(true);
    expect(isActiveFunnelStatus('Processing')).toBe(true);
  });

  it('excludes post-funnel + terminal statuses the applications list never shows', () => {
    expect(isActiveFunnelStatus('Enrolled')).toBe(false);
    expect(isActiveFunnelStatus('Enrolled (Conditional)')).toBe(false);
    expect(isActiveFunnelStatus('Cancelled')).toBe(false);
    expect(isActiveFunnelStatus('Withdrawn')).toBe(false);
  });

  it('excludes NULL/empty status (mirrors the applications page: NULL rows are not listed)', () => {
    expect(isActiveFunnelStatus(null)).toBe(false);
    expect(isActiveFunnelStatus(undefined)).toBe(false);
    expect(isActiveFunnelStatus('')).toBe(false);
    expect(isActiveFunnelStatus('   ')).toBe(false);
  });

  it('trims before matching (same normalization as the applications page)', () => {
    expect(isActiveFunnelStatus('  Submitted  ')).toBe(true);
  });

  it('is a subset of the canonical application stage vocabulary (KD #59)', () => {
    for (const v of ACTIVE_FUNNEL_STAGES) {
      expect(STAGE_STATUS_OPTIONS.application).toContain(v);
    }
  });
});
