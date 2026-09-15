/**
 * Server data cost of the FIRST render of every dashboard and Insights page.
 *
 * WHAT THIS IS AND IS NOT. This times the loader fan-out each page performs —
 * the part that blocks the server response. It is NOT a browser page-load
 * number: it excludes the layout's auth/role resolution (see
 * scripts/measure-layout-chrome.perf.ts), RSC serialisation, network transfer
 * and client hydration. It IS the part the app controls, and the part that
 * dominates, so it is the right number to compare across modules.
 *
 * WHY NOT `next dev`. Dev compiles a route on demand, so dev timings say
 * nothing about production.
 *
 * WHY A REAL CACHE MOCK. The loaders are wrapped in `unstable_cache`, which
 * throws outside a Next request. A passthrough mock would re-read the same base
 * tables once per loader and report a number several times too big, so
 * `next/cache` is replaced with an in-memory cache honouring Next's key
 * semantics (the keys array AND the call arguments). "Warm" then means here
 * what it means in production.
 *
 * STREAMED WORK IS SEPARATED. Attendance creates `buildAllRowSets` un-awaited
 * and resolves it behind its own <Suspense>, so the user sees the hero long
 * before it lands. The fold and the deferred scan are timed as two rows.
 *
 * NOT A TEST. Reachable only via scripts/vitest.perf.config.ts — hits the live
 * database, must never run in CI.
 */
import { describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
let cacheHits = 0;
let cacheMisses = 0;

vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => unknown, keys: string[] = []) =>
    async (...args: unknown[]) => {
      const k = JSON.stringify(keys) + '|' + JSON.stringify(args);
      if (store.has(k)) {
        cacheHits++;
        return store.get(k);
      }
      cacheMisses++;
      const v = await fn(...args);
      store.set(k, v);
      return v;
    },
  revalidateTag: () => {},
  revalidatePath: () => {},
  unstable_noStore: () => {},
}));

const AY = 'AY2026';
const RANGE = {
  ayCode: AY,
  from: '2026-08-15',
  to: '2026-09-15',
  cmpFrom: null,
  cmpTo: null,
};

type Probe = { calls: number; totalMs: number };
let probe: Probe = { calls: 0, totalMs: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const started = Date.now();
  const res = await realFetch(input, init);
  probe.calls++;
  probe.totalMs += Date.now() - started;
  return res;
};

type Row = {
  page: string;
  coldMs: number;
  coldQueries: number;
  warmMs: number;
  warmQueries: number;
  note: string;
};
const rows: Row[] = [];

async function time(run: () => Promise<unknown>) {
  probe = { calls: 0, totalMs: 0 };
  cacheHits = 0;
  cacheMisses = 0;
  const t = Date.now();
  await run();
  return { ms: Date.now() - t, calls: probe.calls };
}

async function measure(page: string, run: () => Promise<unknown>, note = '') {
  store.clear();
  const cold = await time(run);
  const warm = await time(run);
  rows.push({
    page,
    coldMs: cold.ms,
    coldQueries: cold.calls,
    warmMs: warm.ms,
    warmQueries: warm.calls,
    note,
  });
}

describe('first-render server cost', () => {
  it('per module, dashboard and insights', async () => {
    const att = await import('@/lib/attendance/dashboard');
    const attDrill = await import('@/lib/attendance/drill');
    const mb = await import('@/lib/markbook/dashboard');
    const ev = await import('@/lib/evaluation/dashboard');
    const evDrill = await import('@/lib/evaluation/drill');
    const pf = await import('@/lib/p-files/dashboard');
    const sis = await import('@/lib/sis/dashboard');
    const adm = await import('@/lib/admissions/dashboard');
    const admPriority = await import('@/lib/admissions/priority');
    const chase = await import('@/lib/sis/document-chase-queue');
    const pfQueries = await import('@/lib/p-files/queries');
    const sisQueries = await import('@/lib/sis/queries');
    const { getAyIdByCode } = await import('@/lib/dashboard/ay-id');
    const ayId = (await getAyIdByCode(AY))!;

    // ── dashboards ────────────────────────────────────────────────────────

    // The fold only: what blocks first paint. The ~180k-row buildAllRowSets
    // scan is created un-awaited and streams in behind its own Suspense.
    await measure(
      '/attendance (fold)',
      () =>
        Promise.all([
          att.getAttendanceKpisRange(RANGE),
          att.getDailyAttendanceRange(RANGE),
          att.getExReasonMixRange(RANGE),
          att.getDayTypeDistributionRange(RANGE),
          attDrill.getCompassionateOverQuota(AY),
        ]).then(([, , , , comp]) =>
          att.getAttendancePriority({
            ayCode: AY,
            compassionate: comp,
          })
        ),
      'hero + priority + 4 KPIs'
    );
    await measure(
      '/attendance (deferred)',
      () =>
        attDrill.buildAllRowSets({
          ayCode: AY,
          from: RANGE.from,
          to: RANGE.to,
          vacationTermId: null,
          defaultVlAllowance: 1,
        }),
      'streams in behind Suspense'
    );

    await measure(
      '/markbook',
      () =>
        Promise.all([
          mb.getMarkbookKpisRange(RANGE),
          mb.getGradeEntryVelocityRange(RANGE),
          mb.getGradeDistribution(ayId, AY),
          mb.getChangeRequestSummary(AY, 30),
          mb.getPublicationCoverage(ayId, AY),
          mb.getRecentMarkbookActivity(8),
          mb.getSheetLockProgressByTerm(ayId, AY),
        ]),
      'registrar view, 7 loaders'
    );

    // Was one row of 4 awaited loaders at 3,012ms cold. The year-wide
    // write-up scan now streams in behind Suspense, so the fold is what
    // blocks and the scan is measured separately — same split as attendance.
    await measure(
      '/evaluation (fold)',
      () =>
        Promise.all([
          ev.getEvaluationKpisRange(RANGE),
          ev.getSubmissionVelocityRange(RANGE),
          ev.getEvaluationChaseKpis(AY),
        ]),
      'hero + KPIs + velocity'
    );
    await measure(
      '/evaluation (deferred)',
      () =>
        evDrill.buildAllRowSets({
          ayCode: AY,
          from: RANGE.from,
          to: RANGE.to,
        }),
      'streams in behind Suspense'
    );

    await measure(
      '/p-files',
      () =>
        Promise.all([
          pfQueries.getDocumentDashboardData(AY),
          pf.getCompletionByLevel(AY),
          sis.getExpiringDocuments(AY, 60, 6),
          pf.getRevisionsOverTime(AY, 12),
          pf.getPFilesKpisRange(RANGE),
          pf.getRevisionVelocityRange(RANGE),
          pf.getSlotStatusMix(AY),
          pf.getPFilesPriority({ ayCode: AY }),
          chase.getDocumentChaseQueueCounts(AY, 'p-files'),
        ]),
      'officer view, 9 loaders'
    );

    await measure(
      '/records',
      () =>
        Promise.all([
          sisQueries.getSisDashboardSummary(AY),
          sis.getDocumentValidationBacklog(AY),
          sis.getLevelDistribution(AY),
          sis.getExpiringDocuments(AY, 60, 8),
          sis.getRecentSisActivity(8),
          sis.getRecordsKpisRange(RANGE),
          sis.getEnrollmentVelocityRange(RANGE),
          sis.getWithdrawalVelocityRange(RANGE),
          sis.getClassAssignmentReadiness(AY),
          chase.getDocumentChaseQueueCounts(AY, 'p-files'),
        ]),
      '10 loaders'
    );

    await measure(
      '/admissions',
      () =>
        Promise.all([
          adm.getAdmissionsKpisRange(RANGE),
          adm.getApplicationsVelocityRange(RANGE),
          adm.getApplicationsByLevelRange(RANGE),
          adm.getConversionFunnel(AY),
          adm.getOutdatedApplications(AY),
          adm.getAssessmentOutcomes(AY),
          adm.getReferralSourceBreakdown(AY),
          adm.getDocumentCompletionByLevel(AY),
          adm.getTimeToEnrollHistogram(AY),
          admPriority.getAdmissionsPriority({ ayCode: AY }),
          sis.getPipelineStageBreakdown(AY),
          chase.getDocumentChaseQueueCounts(AY, 'admissions'),
        ]),
      '12 loaders'
    );

    await measure(
      '/sis (hub)',
      () =>
        Promise.all([
          sis.getHubKpis(AY),
          sis.getClassAssignmentReadiness(AY),
          sis.getAuditActivityByModule(RANGE),
          sis.getAuditDailyTrend(RANGE),
        ]),
      '4 loaders'
    );

    // ── insights ──────────────────────────────────────────────────────────
    const attCompare = await import('@/lib/attendance/insights-compare');
    const admIns = await import('@/lib/admissions/insights');
    const admFun = await import('@/lib/admissions/insights-funnel');
    const recIns = await import('@/lib/sis/records-insights');
    const mbCompare = await import('@/lib/dashboard/compare');

    await measure(
      '/attendance/insights',
      () =>
        Promise.all([
          att.getAttendanceKpisRange(RANGE),
          attDrill.buildAllRowSets({
            ayCode: AY,
            from: RANGE.from,
            to: RANGE.to,
            vacationTermId: null,
            defaultVlAllowance: 1,
          }),
          attCompare.getAttendanceRateTrendByAy([AY]),
          attCompare.getAttendanceMixByTerm(AY),
        ]),
      'the full-year scan is NOT deferred here'
    );

    await measure(
      '/admissions/insights',
      () =>
        Promise.all([
          admIns.getAdmissionsTerminalReasons(AY),
          admFun.getNationalityMix(AY),
          admFun.getCategoryMix(AY),
          admFun.getApplicantNationalityByLevel(AY),
          admFun.getWithdrawnByLevel(AY),
          adm.getAverageTimeToEnrollment(AY),
          adm.getConversionByAssessment(AY),
          admFun.getReferralConversion(AY),
        ]),
      '8 loaders'
    );

    await measure(
      '/records/insights',
      () =>
        Promise.all([
          recIns.getInsightsHeadcount(AY),
          recIns.getEnrolledCategoryMix(AY),
          recIns.getEnrolledNationalityMix(AY),
          recIns.getEnrolledNationalityByLevel(AY),
          recIns.getRecordsRetention(AY, null),
          recIns.getRecordsRetentionByLevel(AY, null),
        ]),
      '6 loaders'
    );

    await measure(
      '/markbook/insights',
      () =>
        mbCompare.buildCompareCells({
          kind: 'term',
          ays: [AY],
          terms: [1, 2, 3, 4],
        }),
      'compare cells for 4 terms — the page dominant cost'
    );

    // ── report ────────────────────────────────────────────────────────────
    const w = [26, 10, 10, 10, 10];
    const line = (c: string[]) =>
      c.map((s, i) => (i === 0 ? s.padEnd(w[i]!) : s.padStart(w[i]!))).join('');
    console.log('\n' + '='.repeat(96));
    console.log('FIRST-RENDER SERVER DATA COST — AY2026, live database');
    console.log('='.repeat(96));
    console.log(line(['page', 'cold', 'queries', 'warm', 'queries']));
    for (const r of rows) {
      console.log(
        line([
          r.page,
          `${r.coldMs}ms`,
          String(r.coldQueries),
          `${r.warmMs}ms`,
          String(r.warmQueries),
        ]) + (r.note ? `   ${r.note}` : '')
      );
    }
    console.log(
      '\ncold = nothing cached (first visit, or after a mutation busts the tag)' +
        '\nwarm = same range inside the TTL' +
        '\nExcludes layout auth/role, RSC transfer and hydration.\n'
    );
    expect(rows.length).toBeGreaterThan(0);
  }, 300_000);
});
