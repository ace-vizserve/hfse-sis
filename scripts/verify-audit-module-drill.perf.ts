/**
 * Proves count-equals-drill for "Audit activity by module", against live data.
 *
 * KD #82/#124 says a chart segment and the drill it opens must agree. The unit
 * test (`__tests__/audit/module-coverage.test.ts`) proves the module list is
 * complete and non-overlapping, but it cannot prove the two QUERIES agree —
 * they are built by different code, in different files, and the last time they
 * disagreed the chart counted 51% of rows and every drill returned zero.
 *
 * This runs both for real and compares:
 *   - each bar's count vs the number of rows its drill returns;
 *   - the sum of all bars vs the total rows in range. A shortfall means actions
 *     filed under no module; an excess means overlapping prefixes counting a
 *     row twice (which is exactly what a catch-all `sis.` prefix did — 67 rows
 *     double-counted, bars summing to 1721 over a range holding 1654).
 *
 * NOT A TEST. Named `.perf.ts` and reachable only via
 * `scripts/vitest.perf.config.ts` — it hits the live database, so CI never
 * touches it.
 *
 * Run:
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run \
 *     --config scripts/vitest.perf.config.ts scripts/verify-audit-module-drill.perf.ts \
 *     --pool=threads
 */
import { describe, expect, it, vi } from 'vitest';

// Passthrough: measure the real queries, not a cached answer.
vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
  unstable_noStore: () => {},
}));

const AY = 'AY2026';
const RANGE = { from: '2026-01-01', to: '2026-12-31' };

describe('audit by module — chart and drill agree', () => {
  it('every bar opens a drill holding exactly the rows it counted', async () => {
    const { getAuditActivityByModule } = await import('@/lib/sis/dashboard');
    const { loadAuditEventsUncached } = await import('@/lib/sis/drill');

    const chart = (await getAuditActivityByModule({
      ayCode: AY,
      from: RANGE.from,
      to: RANGE.to,
      cmpFrom: null,
      cmpTo: null,
    } as never)) as {
      current: Array<{ moduleKey: string; module: string; count: number }>;
    };

    let barTotal = 0;
    const mismatches: string[] = [];
    console.log('\n  module                bar   drill   match');
    for (const bar of chart.current) {
      const rows = await loadAuditEventsUncached(bar.moduleKey, RANGE);
      barTotal += bar.count;
      if (rows.length !== bar.count) {
        mismatches.push(
          `${bar.module}: bar ${bar.count} vs drill ${rows.length}`
        );
      }
      console.log(
        '  ' +
          bar.module.padEnd(22) +
          String(bar.count).padStart(5) +
          String(rows.length).padStart(8) +
          (rows.length === bar.count ? '   YES' : '   NO')
      );
    }

    const all = await loadAuditEventsUncached(null, RANGE);
    console.log('\n  sum of bars : ' + barTotal);
    console.log('  rows in range: ' + all.length);
    console.log(
      '  difference   : ' +
        (barTotal - all.length) +
        '  (0 = every row counted once)'
    );

    expect(mismatches, mismatches.join('; ')).toEqual([]);
    expect(
      barTotal,
      barTotal > all.length
        ? 'Bars sum to MORE than the range holds — two modules share a prefix ' +
            'and are counting the same rows twice.'
        : 'Bars sum to LESS than the range holds — some actions are filed ' +
            'under no module and are invisible on the chart.'
    ).toBe(all.length);
  }, 180_000);

  it('a display label is not accepted where a module key belongs', async () => {
    // The original bug in one line: the chart passed "Markbook — sheet" as the
    // segment, it was used verbatim as a LIKE pattern, and matched nothing.
    const { loadAuditEventsUncached } = await import('@/lib/sis/drill');
    const rows = await loadAuditEventsUncached('Markbook — sheet', RANGE);
    expect(rows).toEqual([]);
  }, 60_000);
});
