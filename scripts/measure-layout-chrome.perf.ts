/**
 * What the module chrome makes every page wait for.
 *
 * The sidebar's count chips and the header's notification counts are fetched in
 * the layout BODY, above `{children}` — so no page in a module can render until
 * they all resolve. They were issued as a chain of separate `await`s; this times
 * that chain against the two-wave shape that replaced it.
 *
 * `getCurrentAcademicYear` and the notification counts are excluded: the first
 * reads `cookies()` and the others need a real user id, neither of which exists
 * outside a request. Both shapes therefore measure the SAME subset, so the
 * comparison is fair even though the absolute numbers understate both.
 *
 * NOT A TEST — live database, reachable only via scripts/vitest.perf.config.ts.
 */
import { describe, it, vi } from 'vitest';

// A cache with Next's own key semantics, NOT a passthrough. Most of these
// loaders are `unstable_cache`d (readiness 60s, sidebar counts, staff list,
// permission map), so a passthrough measures the COLD cost and reports it as if
// it were paid on every render. It is not: it is paid once per TTL per server.
const store = new Map<string, unknown>();
vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => unknown, keys: string[] = []) =>
    async (...args: unknown[]) => {
      const k = JSON.stringify(keys) + '|' + JSON.stringify(args);
      if (store.has(k)) return store.get(k);
      const v = await fn(...args);
      store.set(k, v);
      return v;
    },
  revalidateTag: () => {},
  revalidatePath: () => {},
  unstable_noStore: () => {},
}));

const AY = 'AY2026';

describe('module layout chrome', () => {
  it('compares the old serial chain with the two-wave shape', async () => {
    const { getAyReadiness } = await import('@/lib/sis/readiness');
    const { getSectionsCount } = await import('@/lib/sis/sidebar-counts');
    const { getStaffCount } = await import('@/lib/auth/staff-list');
    const { getCapabilitiesForRole } =
      await import('@/lib/auth/permission-map');

    // Warm the connection — the first query of a process pays TLS + pool setup
    // and would otherwise be charged to whichever shape ran first.
    await getCapabilitiesForRole('superadmin');

    async function serial() {
      const t = Date.now();
      await getCapabilitiesForRole('school_admin');
      await getAyReadiness(AY);
      await Promise.all([getSectionsCount(AY), getStaffCount()]);
      return Date.now() - t;
    }

    async function twoWave() {
      const t = Date.now();
      // Wave 1 — everything independent of the current AY.
      await Promise.all([
        getCapabilitiesForRole('school_admin'),
        getStaffCount(),
      ]);
      // Wave 2 — the two reads that need the AY resolved.
      await Promise.all([getAyReadiness(AY), getSectionsCount(AY)]);
      return Date.now() - t;
    }

    // Alternate the order across rounds so neither shape benefits from the
    // other having just warmed the same rows.
    const serialRuns: number[] = [];
    const waveRuns: number[] = [];
    for (let i = 0; i < 3; i++) {
      if (i % 2 === 0) {
        serialRuns.push(await serial());
        waveRuns.push(await twoWave());
      } else {
        waveRuns.push(await twoWave());
        serialRuns.push(await serial());
      }
    }

    const best = (xs: number[]) => Math.min(...xs);
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[1];

    console.log('\n  chrome blocking the page, SIS layout');
    console.log('  shape                        best     median    runs');
    console.log(
      '  old: serial awaits      ' +
        String(best(serialRuns)).padStart(7) +
        'ms' +
        String(median(serialRuns)).padStart(8) +
        'ms    ' +
        serialRuns.join(', ')
    );
    console.log(
      '  new: two waves          ' +
        String(best(waveRuns)).padStart(7) +
        'ms' +
        String(median(waveRuns)).padStart(8) +
        'ms    ' +
        waveRuns.join(', ')
    );
    console.log(
      '\n  saved (median): ' +
        (median(serialRuns) - median(waveRuns)) +
        'ms per page render\n'
    );
  }, 180_000);
});
