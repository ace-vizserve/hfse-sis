/**
 * What one dashboard read actually costs.
 *
 * WHY THIS SHAPE. The loaders are wrapped in `unstable_cache`, which throws
 * "Invariant: incrementalCache missing" outside a Next request — so they cannot
 * be timed from a plain script. Run under vitest, `next/cache` is replaced with
 * a REAL in-memory cache that honours the key array the same way Next does
 * (keys + arguments). That matters: a passthrough mock would re-read the same
 * base tables once per loader and report a number several times too big.
 *
 * THE DISTINCTION THAT MAKES THIS USEFUL. Two kinds of loader live on these
 * pages:
 *   - keyed on ayCode only (`['admissions-joined', ayCode]`) — a date-range
 *     change does NOT invalidate these. They stay warm.
 *   - keyed on ayCode + from + to — every range change misses all of them.
 * So the cost of changing the range is NOT the cost of loading the page. Three
 * passes below separate them.
 *
 * NOT A TEST. Named `.perf.ts` and reachable only via
 * `scripts/vitest.perf.config.ts` — it hits the live database and must never
 * run in CI.
 *
 * Run:
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run \
 *     --config scripts/vitest.perf.config.ts --pool=threads
 */
import { describe, it, vi } from 'vitest';

// ── a cache that behaves like Next's ────────────────────────────────────────
// Next keys an entry on the `keys` array AND the arguments the wrapped function
// is called with. Reproducing both is what makes "warm" mean the same thing
// here as in production.
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
const RANGE_A = {
  ayCode: AY,
  from: '2026-08-15',
  to: '2026-09-14',
  cmpFrom: null,
  cmpTo: null,
};
const RANGE_B = {
  ayCode: AY,
  from: '2026-07-01',
  to: '2026-07-31',
  cmpFrom: null,
  cmpTo: null,
};

// ── fetch instrumentation ───────────────────────────────────────────────────
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

type PassResult = {
  label: string;
  ms: number;
  calls: number;
  dbMs: number;
  hits: number;
  misses: number;
};

async function pass(
  label: string,
  run: () => Promise<unknown>
): Promise<PassResult> {
  probe = { calls: 0, totalMs: 0 };
  cacheHits = 0;
  cacheMisses = 0;
  const t = Date.now();
  await run();
  return {
    label,
    ms: Date.now() - t,
    calls: probe.calls,
    dbMs: probe.totalMs,
    hits: cacheHits,
    misses: cacheMisses,
  };
}

function table(title: string, rows: PassResult[]) {
  console.log('\n### ' + title);
  console.log(
    '    ' +
      'pass'.padEnd(34) +
      'wall'.padStart(8) +
      'db time'.padStart(9) +
      'queries'.padStart(9) +
      'cache hit'.padStart(11) +
      'cache miss'.padStart(12)
  );
  for (const r of rows) {
    console.log(
      '    ' +
        r.label.padEnd(34) +
        (r.ms + 'ms').padStart(8) +
        (r.dbMs + 'ms').padStart(9) +
        String(r.calls).padStart(9) +
        String(r.hits).padStart(11) +
        String(r.misses).padStart(12)
    );
  }
}

describe('dashboard read cost', () => {
  it('separates first load from a date-range change', async () => {
    const adm = await import('@/lib/admissions/dashboard');
    const sis = await import('@/lib/sis/dashboard');
    const priority = await import('@/lib/admissions/priority');
    const feedback = await import('@/lib/admissions/feedback');
    const chase = await import('@/lib/sis/document-chase-queue');

    // Exactly the fan-out `app/(admissions)/admissions/page.tsx` performs,
    // run the way the page runs it — all at once, not serially.
    const admissionsFanout = (range: typeof RANGE_A) => () =>
      Promise.all([
        adm.getAdmissionsKpisRange(range as never),
        adm.getApplicationsVelocityRange(range as never),
        adm.getApplicationsByLevelRange(range as never),
        adm.getConversionFunnel(AY),
        adm.getOutdatedApplications(AY),
        adm.getAssessmentOutcomes(AY),
        adm.getReferralSourceBreakdown(AY),
        adm.getDocumentCompletionByLevel(AY),
        adm.getTimeToEnrollHistogram(AY),
        adm.getAdmissionsCompletenessForChase(AY, 'all'),
        priority.getAdmissionsPriority({ ayCode: AY }),
        feedback.getAdmissionsFeedback(AY),
        feedback.getPreCourseStats(AY),
        sis.getPipelineStageBreakdown(AY),
        chase.getDocumentChaseQueueCounts(AY),
      ]);

    const sisFanout = (range: typeof RANGE_A) => () =>
      Promise.all([
        sis.getAuditActivityByModule(range as never),
        sis.getAuditDailyTrend(range as never),
        sis.getHubKpis(AY),
        sis.getClassAssignmentReadiness(AY),
      ]);

    console.log('\n' + '='.repeat(94));
    console.log(
      'DASHBOARD READ COST — cache behaves as in production (Next key semantics)'
    );
    console.log('='.repeat(94));

    const a1 = await pass(
      '1. first load, nothing cached',
      admissionsFanout(RANGE_A)
    );
    const a2 = await pass(
      '2. CHANGE RANGE (the complaint)',
      admissionsFanout(RANGE_B)
    );
    const a3 = await pass(
      '3. back to the first range',
      admissionsFanout(RANGE_A)
    );
    const a4 = await pass(
      '4. same range again (all warm)',
      admissionsFanout(RANGE_B)
    );
    table('/admissions — 15 loaders', [a1, a2, a3, a4]);

    const s1 = await pass('1. first load, nothing cached', sisFanout(RANGE_A));
    const s2 = await pass(
      '2. CHANGE RANGE (the complaint)',
      sisFanout(RANGE_B)
    );
    const s3 = await pass('3. back to the first range', sisFanout(RANGE_A));
    table('/sis — 4 loaders', [s1, s2, s3]);

    // ── insights pages ──────────────────────────────────────────────────────
    // Called out separately because their cache TTL is 60s, not the dashboard's
    // 600s — they go cold ten times as often, so "first load" is the pass that
    // matters for them, not the warm one.
    const admIns = await import('@/lib/admissions/insights');
    const admFun = await import('@/lib/admissions/insights-funnel');

    const recIns = await import('@/lib/sis/records-insights');
    const attDash = await import('@/lib/attendance/dashboard');

    const pages: Array<[string, () => Promise<unknown>]> = [
      [
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
            // getIntakeTrendByAy omitted: it takes the AY LIST, not one code,
            // and its cross-year scan is not what this probe is measuring.
          ]),
      ],
      [
        '/records/insights',
        () =>
          Promise.all([
            recIns.getInsightsHeadcount(AY),
            recIns.getEnrolledCategoryMix(AY),
            recIns.getEnrolledNationalityMix(AY),
            recIns.getEnrolledNationalityByLevel(AY),
            // priorAy = null: retention against no prior year still exercises
            // the same query path, which is what is being timed.
            recIns.getRecordsRetention(AY, null),
            recIns.getRecordsRetentionByLevel(AY, null),
          ]),
      ],
      // /markbook/insights is NOT measured. Its loaders key on the academic
      // year's UUID (`getGradeDistribution(academicYearId, ayCode, termId)`),
      // not the AY code, and `getSubjectPerformanceTrend` is a reducer over
      // pre-loaded cells rather than a loader. Passing the code as the id
      // returned instantly with nothing, which would have reported this page
      // as the fastest on the list when it had simply measured an empty query.
      [
        '/attendance/insights',
        () => Promise.all([attDash.getAttendanceKpisRange(RANGE_A as never)]),
      ],
    ];

    for (const [name, fanout] of pages) {
      const cold = await pass('1. first load (cold)', fanout);
      const warm = await pass('2. reload within TTL', fanout);
      table(name, [cold, warm]);
    }

    console.log(
      '\n  Read pass 2 as the real answer: what a date-range change costs once the\n' +
        '  page is already open. Pass 3 shows whether revisiting a range is free —\n' +
        '  in the browser it is NOT, because this cache is server-side and the\n' +
        '  client holds nothing between renders.\n'
    );
  }, 180_000);
});
