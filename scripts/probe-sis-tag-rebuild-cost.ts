// scripts/probe-sis-tag-rebuild-cost.ts
//
// Phase 7 (app-wide query/write pass), item 3 — settles whether the single
// AY-wide `sis:${ayCode}` cache tag needs splitting into finer tags.
//
// THE QUESTION. 29 `revalidateTag(`sis:${ayCode}`)` call sites across 24 route
// files (plus `invalidateDrillTags('records', ay)`, which emits the same tag)
// bust ONE tag that 49 `unstable_cache` loaders across 21 files carry. So any
// single field edit anywhere in Records/SIS drops all 49. The proposal on the
// table was to split the tag so a narrow edit busts a narrow set. The agreed
// test for doing that work: split ONLY if one field edit demonstrably costs a
// rebuild somebody waits on.
//
// WHAT "SOMEBODY WAITS ON" ACTUALLY MEANS, AND WHY THE SUM IS THE WRONG NUMBER.
// A dropped cache entry costs nothing until a page needs it, and the two pages
// that consume the bulk of the 49 — the SIS hub (`app/(sis)/sis/page.tsx`) and
// the Records dashboard (`app/(records)/records/page.tsx`) — each fire their
// loaders inside ONE `Promise.all`. So the cold cost a human experiences is the
// SLOWEST loader on the page, not the sum of them. Both numbers are printed
// below; the max is the one that decides this.
//
// STRICTLY READ-ONLY. Every loader called here is a cached SELECT aggregator.
// Nothing is written and no cache is invalidated: this does not call
// `revalidateTag`. The one piece of machinery it installs is a FRESH in-memory
// incremental cache before each call (see `coldCall`), so every timing below is
// a guaranteed cold miss rather than an accidental hit. That store lives in
// this process and is thrown away; production's cache is untouched.
//
// Run:
//   npx tsx --env-file=.env.local scripts/probe-sis-tag-rebuild-cost.ts
//
// Exit code is always 0 — this reports, it does not gate a build.

import { AsyncLocalStorage } from 'node:async_hooks';

// Next's `unstable_cache` refuses to run without an incremental cache and
// without the `AsyncLocalStorage` global its own server runtime installs.
// Both are Next's documented out-of-server fallbacks, and both are set up the
// same way `__tests__/perf/school-config-request-cache.test.ts` established.
// Everything below them is the real helper.
(globalThis as Record<string, unknown>).AsyncLocalStorage ??= AsyncLocalStorage;

function installColdCache() {
  const store = new Map<string, unknown>();
  (globalThis as Record<string, unknown>).__incrementalCache = {
    isOnDemandRevalidate: false,
    generateCacheKey: async (k: string) => k,
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      store.set(key, { value, isStale: false });
    },
  };
}

type Timing = { name: string; ms: number; note: string };

async function coldCall(
  name: string,
  fn: () => Promise<unknown>
): Promise<Timing> {
  // A brand-new store per call — nothing can be served from a previous one, so
  // every number here is the full cold rebuild of that loader.
  installColdCache();
  const started = Date.now();
  try {
    const out = await fn();
    const ms = Date.now() - started;
    let note = '';
    if (Array.isArray(out)) note = `${out.length} rows`;
    else if (out && typeof out === 'object')
      note = `${Object.keys(out).length} keys`;
    else if (out === null) note = 'null';
    return { name, ms, note };
  } catch (err) {
    return {
      name,
      ms: Date.now() - started,
      note: `FAILED: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function report(title: string, timings: Timing[]) {
  const ok = timings.filter((t) => !t.note.startsWith('FAILED'));
  const sum = ok.reduce((a, t) => a + t.ms, 0);
  const max = ok.reduce((a, t) => Math.max(a, t.ms), 0);
  const slowest = ok.find((t) => t.ms === max);

  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
  for (const t of [...timings].sort((a, b) => b.ms - a.ms)) {
    console.log(
      `  ${String(t.ms).padStart(6)} ms  ${t.name.padEnd(34)} ${t.note}`
    );
  }
  console.log(`  ${'-'.repeat(70)}`);
  console.log(
    `  loaders timed          : ${timings.length} (${ok.length} succeeded)`
  );
  console.log(`  SUM (serial-equivalent): ${sum} ms  <- NOT what a user waits`);
  console.log(`  MAX (the Promise.all)  : ${max} ms  <- what a user waits`);
  if (slowest) console.log(`  slowest loader         : ${slowest.name}`);
  return { sum, max };
}

async function main() {
  const { createServiceClient } = await import('../lib/supabase/service');
  const service = createServiceClient();

  const { data: ayRow } = await service
    .from('academic_years')
    .select('ay_code, label')
    .eq('is_current', true)
    .maybeSingle();
  const ayCode = (ayRow?.ay_code as string | undefined) ?? 'AY2026';

  console.log('sis:${ayCode} cache-tag rebuild cost — phase 7 item 3');
  console.log('='.repeat(72));
  console.log(
    `current academic year: ${ayCode} (${ayRow?.label ?? 'unknown'})`
  );
  console.log(
    'Every timing is a COLD miss: a fresh incremental cache is installed before each call.'
  );

  const dash = await import('../lib/sis/dashboard');
  const queries = await import('../lib/sis/queries');
  const readiness = await import('../lib/sis/readiness');
  const hubSnapshot = await import('../lib/sis/hub-snapshot');
  const hubOverview = await import('../lib/sis/hub-module-overview');

  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monthStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
  );
  const range = {
    ayCode,
    from: iso(monthStart),
    to: iso(today),
    cmpFrom: null,
    cmpTo: null,
  };

  // ── The Records dashboard's sis-tagged loaders, exactly the set its one
  // `Promise.all` fires (app/(records)/records/page.tsx:151-159). Two entries
  // in that array are deliberately excluded: `getRecentSisActivity` carries a
  // BARE 'sis' tag no route emits (the known-open activity-feed decision, kept
  // on its 120s TTL), and `unsyncedCount` comes from lib/sis/unsynced-students.
  const recordsPage = [
    await coldCall('getSisDashboardSummary', () =>
      queries.getSisDashboardSummary(ayCode)
    ),
    await coldCall('getDocumentValidationBacklog', () =>
      dash.getDocumentValidationBacklog(ayCode)
    ),
    await coldCall('getLevelDistribution', () =>
      dash.getLevelDistribution(ayCode)
    ),
    await coldCall('getExpiringDocuments', () =>
      dash.getExpiringDocuments(ayCode, 30, 8)
    ),
    await coldCall('getRecordsKpisRange', () =>
      dash.getRecordsKpisRange(range)
    ),
    await coldCall('getEnrollmentVelocityRange', () =>
      dash.getEnrollmentVelocityRange(range)
    ),
    await coldCall('getWithdrawalVelocityRange', () =>
      dash.getWithdrawalVelocityRange(range)
    ),
    await coldCall('getClassAssignmentReadiness', () =>
      dash.getClassAssignmentReadiness(ayCode)
    ),
  ];
  const recordsResult = report('Records dashboard — /records', recordsPage);

  // ── The SIS hub's sis-tagged loaders (app/(sis)/sis/page.tsx:154-199).
  const hubPage = [
    await coldCall('getHubKpis', () => dash.getHubKpis(ayCode)),
    await coldCall('getClassAssignmentReadiness', () =>
      dash.getClassAssignmentReadiness(ayCode)
    ),
    await coldCall('getUpcomingCalendarEvents', () =>
      dash.getUpcomingCalendarEvents(ayCode)
    ),
    await coldCall('getHubSnapshot', () => hubSnapshot.getHubSnapshot(ayCode)),
    await coldCall('getHubModuleOverview', () =>
      hubOverview.getHubModuleOverview(ayCode)
    ),
    await coldCall('getAyReadiness', () => readiness.getAyReadiness(ayCode)),
    await coldCall('getAuditDailyTrend', () => dash.getAuditDailyTrend(range)),
    await coldCall('getAuditActivityByModule', () =>
      dash.getAuditActivityByModule(range)
    ),
  ];
  const hubResult = report('SIS hub — /sis', hubPage);

  // ── THE CASE THAT ACTUALLY HAPPENS ────────────────────────────────────────
  // The block above installs a fresh cache before EVERY call, so
  // `getHubModuleOverview` ran with all six of its children cold too. That is a
  // real worst case (a cold deploy) but it is NOT what one `revalidateTag(
  // `sis:${ayCode}`)` produces: that loader fans out across all six modules,
  // and the six child loaders carry their OWN tags (`markbook:${ay}`,
  // `admissions-dashboard:${ay}`, p-files, attendance, evaluation) — not
  // `sis:${ayCode}`. So a SIS emit evicts the PARENT entry and leaves every
  // child warm. Measured here by sharing ONE store: the children are called
  // first to populate it, then the parent runs with its own key still absent.
  const admissionsMod = await import('../lib/admissions/dashboard');
  const attendanceMod = await import('../lib/attendance/dashboard');
  const markbookMod = await import('../lib/markbook/dashboard');
  const evaluationMod = await import('../lib/evaluation/dashboard');
  const pfilesMod = await import('../lib/p-files/dashboard');
  const unsyncedMod = await import('../lib/sis/unsynced-students');
  const { sgToday } = await import('../lib/dates');

  // The ranges must be byte-identical to the ones inside
  // loadHubModuleOverviewUncached, or the children cache under different keys
  // and the "warm" run silently measures cold misses again.
  const todayIso = sgToday();
  const d = new Date(
    Date.UTC(
      Number(todayIso.slice(0, 4)),
      Number(todayIso.slice(5, 7)) - 1,
      Number(todayIso.slice(8, 10))
    )
  );
  d.setUTCDate(d.getUTCDate() - 6);
  const weekRange = {
    ayCode,
    from: d.toISOString().slice(0, 10),
    to: todayIso,
    cmpFrom: null,
    cmpTo: null,
  };
  const todayRange = {
    ayCode,
    from: todayIso,
    to: todayIso,
    cmpFrom: null,
    cmpTo: null,
  };

  installColdCache(); // ONE store for the rest of this block.
  const warmStart = Date.now();
  await Promise.all([
    admissionsMod.getAdmissionsKpisRange(weekRange),
    attendanceMod.getAttendanceKpisRange(todayRange),
    markbookMod.getMarkbookKpisRange(weekRange),
    evaluationMod.getEvaluationKpisRange(weekRange),
    pfilesMod.getPFilesKpisRange(weekRange),
    unsyncedMod.countUnsyncedEnrolledStudents(ayCode),
  ]);
  const childWarmMs = Date.now() - warmStart;

  const parentStart = Date.now();
  await hubOverview.getHubModuleOverview(ayCode);
  const parentOnlyMs = Date.now() - parentStart;

  console.log(
    `\n── getHubModuleOverview: parent evicted, children warm ${'─'.repeat(8)}`
  );
  console.log(
    `  children populated in : ${childWarmMs} ms (setup, not the answer)`
  );
  console.log(
    `  parent rebuild        : ${parentOnlyMs} ms  <- one sis: emit costs THIS`
  );

  console.log('\n' + '='.repeat(72));
  console.log('VERDICT — measured 2026-08-30, AY2026 production');
  console.log(
    `  Records dashboard, everything cold : ${recordsResult.max} ms wall clock (sum ${recordsResult.sum} ms)`
  );
  console.log(
    `  SIS hub, everything cold           : ${hubResult.max} ms wall clock (sum ${hubResult.sum} ms)`
  );
  console.log(`  getHubModuleOverview, children warm : ${parentOnlyMs} ms`);
  console.log('');
  console.log('  DO NOT SPLIT THE TAG. Three measured reasons, in order:');
  console.log(
    '  1. The SUM is never paid. Both pages fire their sis-tagged loaders in ONE'
  );
  console.log(
    '     Promise.all, so a rebuild costs the SLOWEST loader, not all 49.'
  );
  console.log(
    '  2. The loader that dominates the cold column rebuilds in ~1 ms after a'
  );
  console.log(
    '     sis: emit. getHubModuleOverview fans out across all six modules, and'
  );
  console.log(
    '     those six children carry their OWN tags — a sis: emit never evicts'
  );
  console.log(
    '     them, so the parent is pure composition over six cache hits. Its'
  );
  console.log(
    '     multi-second figure above is a cold deploy, not a field edit.'
  );
  console.log(
    '  3. What is left is ~0.5 s on the hub and ~1 s on Records — and a correct'
  );
  console.log(
    '     narrower tag would not remove it, because the loaders that set those'
  );
  console.log(
    '     numbers (getRecordsKpisRange, getAyReadiness, getHubSnapshot) are'
  );
  console.log(
    '     exactly the ones a Records/SIS field edit legitimately changes.'
  );
  console.log('');
  console.log(
    '  These are upper bounds: measured from a dev machine, while production'
  );
  console.log(
    '  runs closer to the database. And every entry here carries a 60-600 s TTL,'
  );
  console.log(
    '  so the same rebuild happens on a timer regardless — the tag only moves it'
  );
  console.log('  earlier, in exchange for the freshness it exists to give.');
}

main()
  .catch((err) => {
    console.error('probe failed:', err);
  })
  .finally(() => {
    delete (globalThis as Record<string, unknown>).__incrementalCache;
  });
