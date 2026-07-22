/**
 * Regression tests for the Admissions drill-sheet fixes (`lib/admissions/drill.ts`).
 *
 * The drill re-implements chart classification logic independently instead
 * of calling the chart's actual logic (lib/admissions/dashboard.ts), and
 * several of those independent copies had drifted from what the charts
 * actually compute:
 *
 *   1. `avg-time` / `time-to-enroll-bucket` read `applicationUpdatedDate`
 *      into a variable confusingly NAMED `enrolledAt` — the real write-once
 *      `enrolledAt` column (migration 075) was never selected at all.
 *   2. `assessment` / `referral` didn't exclude Cancelled/Withdrawn rows,
 *      while their chart counterparts (getAssessmentOutcomes /
 *      getReferralSourceBreakdown) do.
 *   3. `doc-completion` narrowed to the active-funnel-only status set, while
 *      its chart (getDocumentCompletionByLevel) intentionally includes
 *      Enrolled / Enrolled (Conditional) — a deliberate scope widening.
 *   4. `outdated` computed staleness off a `?? created_at`-substituted value
 *      with a hardcoded `>= 7` threshold, instead of the shared
 *      lib/admissions/staleness.ts helpers getOutdatedApplications uses —
 *      so a genuinely never-updated recent application (the "most urgent"
 *      tier) could be silently excluded.
 *
 * Mocking shape mirrors __tests__/admissions/staleness.test.ts: `next/cache`
 * stubbed to a passthrough, `@/lib/supabase/admissions` stubbed to a fake
 * PostgREST chain returning fixed apps/status rows.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
}));

// Mutable so each end-to-end test can point the mock at its own fixture rows
// without re-mocking the module.
let mockAppRows: Array<Record<string, unknown>> = [];
let mockStatusRows: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase/admissions', () => ({
  createAdmissionsClient: vi.fn(() => ({
    from: (table: string) => ({
      select: () => ({
        range: () => {
          if (table.endsWith('_enrolment_applications')) {
            return Promise.resolve({ data: mockAppRows, error: null });
          }
          if (table.endsWith('_enrolment_status')) {
            return Promise.resolve({ data: mockStatusRows, error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
      }),
    }),
  })),
}));

import {
  applyTargetFilter,
  buildDrillRows,
  type DrillRow,
} from '@/lib/admissions/drill';

// ─────────────────────────────────────────────────────────────────────────
// Helper — a fully-populated baseline DrillRow, overridable per test so
// each case only states the fields it cares about.
// ─────────────────────────────────────────────────────────────────────────

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
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 2a — enrolledAt sourced from the real column, not applicationUpdatedDate
// ─────────────────────────────────────────────────────────────────────────

describe('buildDrillRows — enrolledAt discipline (2a)', () => {
  it('a row with applicationUpdatedDate set but enrolledAt null does NOT produce a daysToEnroll value', async () => {
    mockAppRows = [
      {
        enroleeNumber: 'ENR-0001',
        studentNumber: null,
        enroleeFullName: 'Doe, Jane',
        firstName: 'Jane',
        lastName: 'Doe',
        levelApplied: 'P1',
        created_at: '2026-01-01T00:00:00.000Z',
        howDidYouKnowAboutHFSEIS: null,
      },
    ];
    mockStatusRows = [
      {
        enroleeNumber: 'ENR-0001',
        applicationStatus: 'Enrolled',
        // Touched recently (would produce a spurious ~0-day duration if the
        // old code mistakenly read this into the `enrolledAt` variable) —
        // but the REAL enrolledAt column was never stamped.
        applicationUpdatedDate: '2026-06-30T00:00:00.000Z',
        enrolledAt: null,
        classLevel: 'P1',
        levelApplied: 'P1',
        assessmentGradeMath: null,
        assessmentGradeEnglish: null,
      },
    ];

    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    expect(rows).toHaveLength(1);
    expect(rows[0].daysToEnroll).toBeNull();
    expect(rows[0].enrollmentDate).toBeNull();
  });

  it('a row with a real enrolledAt produces the correct daysToEnroll from created_at', async () => {
    mockAppRows = [
      {
        enroleeNumber: 'ENR-0002',
        studentNumber: null,
        enroleeFullName: 'Roe, John',
        firstName: 'John',
        lastName: 'Roe',
        levelApplied: 'P2',
        created_at: '2026-01-01T00:00:00.000Z',
        howDidYouKnowAboutHFSEIS: null,
      },
    ];
    mockStatusRows = [
      {
        enroleeNumber: 'ENR-0002',
        applicationStatus: 'Enrolled',
        // A stale/never-touched applicationUpdatedDate must NOT feed
        // daysToEnroll — only the real enrolledAt column may.
        applicationUpdatedDate: null,
        enrolledAt: '2026-01-31T00:00:00.000Z', // 30 days after created_at
        classLevel: 'P2',
        levelApplied: 'P2',
        assessmentGradeMath: null,
        assessmentGradeEnglish: null,
      },
    ];

    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    expect(rows).toHaveLength(1);
    expect(rows[0].daysToEnroll).toBe(30);
    expect(rows[0].enrollmentDate).toBe('2026-01-31T00:00:00.000Z');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2b — assessment / referral exclude Cancelled + Withdrawn
// ─────────────────────────────────────────────────────────────────────────

describe('applyTargetFilter — assessment/referral terminal-status exclusion (2b)', () => {
  it('assessment: a Cancelled-status row is excluded from every segment, and from the unsegmented view', () => {
    const rows = [
      makeRow({
        enroleeNumber: 'CANCELLED-1',
        status: 'Cancelled',
        assessmentOutcome: 'pass',
        assessmentMathOutcome: 'pass',
        assessmentEnglishOutcome: 'pass',
      }),
      makeRow({
        enroleeNumber: 'ACTIVE-1',
        status: 'Submitted',
        assessmentOutcome: 'pass',
        assessmentMathOutcome: 'pass',
        assessmentEnglishOutcome: 'pass',
      }),
    ];

    // Unsegmented — whole-target view.
    const all = applyTargetFilter(rows, 'assessment', null);
    expect(all.map((r) => r.enroleeNumber)).toEqual(['ACTIVE-1']);

    // Combined-outcome segment.
    const passSegment = applyTargetFilter(rows, 'assessment', 'pass');
    expect(passSegment.map((r) => r.enroleeNumber)).toEqual(['ACTIVE-1']);

    // Per-subject segment.
    const mathPassSegment = applyTargetFilter(rows, 'assessment', 'math:pass');
    expect(mathPassSegment.map((r) => r.enroleeNumber)).toEqual(['ACTIVE-1']);
  });

  it('assessment: a Withdrawn-status row is also excluded', () => {
    const rows = [
      makeRow({
        enroleeNumber: 'WITHDRAWN-1',
        status: 'Withdrawn',
        assessmentOutcome: 'fail',
      }),
    ];
    expect(applyTargetFilter(rows, 'assessment', null)).toHaveLength(0);
    expect(applyTargetFilter(rows, 'assessment', 'fail')).toHaveLength(0);
  });

  it('referral: a Cancelled-status row is excluded from every segment, and from the unsegmented view', () => {
    const rows = [
      makeRow({
        enroleeNumber: 'CANCELLED-1',
        status: 'Cancelled',
        referralSource: 'Website',
      }),
      makeRow({
        enroleeNumber: 'ACTIVE-1',
        status: 'Ongoing Verification',
        referralSource: 'Website',
      }),
    ];

    const all = applyTargetFilter(rows, 'referral', null);
    expect(all.map((r) => r.enroleeNumber)).toEqual(['ACTIVE-1']);

    const segmented = applyTargetFilter(rows, 'referral', 'Website');
    expect(segmented.map((r) => r.enroleeNumber)).toEqual(['ACTIVE-1']);
  });

  it('referral: "Not specified" segment also excludes terminal-status rows', () => {
    const rows = [
      makeRow({
        enroleeNumber: 'CANCELLED-1',
        status: 'Cancelled',
        referralSource: null,
      }),
      makeRow({
        enroleeNumber: 'ACTIVE-1',
        status: 'Processing',
        referralSource: null,
      }),
    ];
    const segmented = applyTargetFilter(rows, 'referral', 'Not specified');
    expect(segmented.map((r) => r.enroleeNumber)).toEqual(['ACTIVE-1']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2c — doc-completion widened to include Enrolled applicants
// ─────────────────────────────────────────────────────────────────────────

describe('applyTargetFilter — doc-completion widened scope (2c)', () => {
  it('an Enrolled-status row is now included (matches getDocumentCompletionByLevel)', () => {
    const rows = [
      makeRow({
        enroleeNumber: 'ENROLLED-1',
        status: 'Enrolled',
        hasMissingDocs: true,
        level: 'P3',
      }),
      makeRow({
        enroleeNumber: 'CONDITIONAL-1',
        status: 'Enrolled (Conditional)',
        hasMissingDocs: false,
        level: 'P3',
      }),
    ];
    const missing = applyTargetFilter(rows, 'doc-completion', 'missing');
    expect(missing.map((r) => r.enroleeNumber)).toEqual(['ENROLLED-1']);

    const complete = applyTargetFilter(rows, 'doc-completion', 'complete');
    expect(complete.map((r) => r.enroleeNumber)).toEqual(['CONDITIONAL-1']);

    const byLevel = applyTargetFilter(rows, 'doc-completion', 'P3');
    expect(byLevel.map((r) => r.enroleeNumber).sort()).toEqual([
      'CONDITIONAL-1',
      'ENROLLED-1',
    ]);
  });

  it('Cancelled/Withdrawn rows are still excluded (unchanged behaviour)', () => {
    const rows = [
      makeRow({ enroleeNumber: 'CANCELLED-1', status: 'Cancelled' }),
      makeRow({ enroleeNumber: 'WITHDRAWN-1', status: 'Withdrawn' }),
      makeRow({ enroleeNumber: 'ACTIVE-1', status: 'Submitted' }),
    ];
    const all = applyTargetFilter(rows, 'doc-completion', null);
    expect(all.map((r) => r.enroleeNumber)).toEqual(['ACTIVE-1']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2d — outdated routes through the shared staleness helpers
// ─────────────────────────────────────────────────────────────────────────

describe('applyTargetFilter — outdated staleness (2d)', () => {
  it('a row with rawDaysSinceUpdate=null (never updated) is included even though the displayed daysSinceUpdate is fresh', () => {
    const rows = [
      makeRow({
        enroleeNumber: 'NEVER-UPDATED-1',
        status: 'Submitted',
        // Displayed column keeps the fallback — reads "fresh" (2 days).
        daysSinceUpdate: 2,
        // Raw applicationUpdatedDate was never stamped — the OLD inline
        // `>= 7` check against the fallback-inclusive daysSinceUpdate would
        // have wrongly excluded this row.
        rawDaysSinceUpdate: null,
      }),
    ];
    const outdated = applyTargetFilter(rows, 'outdated', null);
    expect(outdated.map((r) => r.enroleeNumber)).toEqual(['NEVER-UPDATED-1']);
  });

  it('a fresh row (rawDaysSinceUpdate < 7) is excluded', () => {
    const rows = [
      makeRow({
        enroleeNumber: 'FRESH-1',
        status: 'Submitted',
        rawDaysSinceUpdate: 3,
      }),
    ];
    expect(applyTargetFilter(rows, 'outdated', null)).toHaveLength(0);
  });

  it('warning (>=7d) and critical (>=14d) tiers are both included', () => {
    const rows = [
      makeRow({
        enroleeNumber: 'WARN-1',
        status: 'Processing',
        rawDaysSinceUpdate: 7,
      }),
      makeRow({
        enroleeNumber: 'CRIT-1',
        status: 'Processing',
        rawDaysSinceUpdate: 20,
      }),
    ];
    const outdated = applyTargetFilter(rows, 'outdated', null);
    expect(outdated.map((r) => r.enroleeNumber).sort()).toEqual([
      'CRIT-1',
      'WARN-1',
    ]);
  });

  it('non-active-funnel statuses are excluded regardless of staleness (unchanged scope)', () => {
    const rows = [
      makeRow({
        enroleeNumber: 'ENROLLED-STALE-1',
        status: 'Enrolled',
        rawDaysSinceUpdate: null,
      }),
    ];
    expect(applyTargetFilter(rows, 'outdated', null)).toHaveLength(0);
  });

  it('end-to-end: a row with applicationUpdatedDate=null and a recent created_at is included (previously excluded by the created_at fallback)', async () => {
    mockAppRows = [
      {
        enroleeNumber: 'ENR-0003',
        studentNumber: null,
        enroleeFullName: 'Cruz, Ana',
        firstName: 'Ana',
        lastName: 'Cruz',
        levelApplied: 'S1',
        // Recent — under the OLD `updated ?? a.created_at` fallback this
        // would have masqueraded as a "just touched" (fresh, excluded) row.
        created_at: new Date().toISOString(),
        howDidYouKnowAboutHFSEIS: null,
      },
    ];
    mockStatusRows = [
      {
        enroleeNumber: 'ENR-0003',
        applicationStatus: 'Submitted',
        applicationUpdatedDate: null,
        enrolledAt: null,
        classLevel: 'S1',
        levelApplied: 'S1',
        assessmentGradeMath: null,
        assessmentGradeEnglish: null,
      },
    ];

    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    expect(rows).toHaveLength(1);
    expect(rows[0].rawDaysSinceUpdate).toBeNull();

    const outdated = applyTargetFilter(rows, 'outdated', null);
    expect(outdated.map((r) => r.enroleeNumber)).toEqual(['ENR-0003']);
  });
});
