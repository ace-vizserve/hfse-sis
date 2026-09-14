/**
 * Proves migration 148's RPCs return exactly what the row scan they replace did.
 *
 * The attendance dashboard's reduction moved from Node into Postgres: instead of
 * reading the year's ~48,000 `attendance_daily` rows and counting them here, it
 * asks for per-(date, status, ex_reason) buckets and the A/L marks. That is a
 * big change to numbers people act on, so this checks the two against each
 * other on live data rather than trusting that the SQL says the same thing as
 * the TypeScript.
 *
 * The oracle is `countsFromRows(loadDailyRows(ay))` — the same function the
 * fallback uses and the unit tests pin, applied to the deduped row scan.
 *
 * ⚠ REQUIRES MIGRATION 148. Without it `loadMarkCounts` falls back to the row
 * scan, and this would be comparing the oracle against itself — which passes
 * and proves nothing. The first check below fails loudly in that case instead.
 *
 * Run:
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run \
 *     --config scripts/vitest.perf.config.ts \
 *     scripts/verify-attendance-aggregates.perf.ts --pool=threads
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
  unstable_noStore: () => {},
}));

const AY = 'AY2026';

describe('attendance aggregates vs the row scan', () => {
  it('is actually calling the RPC, not the fallback', async () => {
    const { createServiceClient } = await import('@/lib/supabase/service');
    const { getAyIdByCode } = await import('@/lib/dashboard/ay-id');
    const svc = createServiceClient();
    const ayId = await getAyIdByCode(AY);
    const { error } = await svc.rpc('attendance_mark_counts_by_date', {
      p_academic_year_id: ayId,
    });
    expect(
      error,
      'Migration 148 is not applied — loadMarkCounts is falling back to the row ' +
        'scan, so every comparison below would be the oracle against itself. ' +
        'Apply 148 and re-run.'
    ).toBeNull();
  }, 120_000);

  it('returns the same buckets the row scan would produce', async () => {
    const { loadDailyRows, loadMarkCounts, countsFromRows, kpisFromCounts } =
      await import('@/lib/attendance/dashboard');

    const [fromRpc, rows] = await Promise.all([
      loadMarkCounts(AY),
      loadDailyRows(AY),
    ]);
    const oracle = countsFromRows(rows);

    const key = (c: {
      date: string;
      status: string;
      ex_reason: string | null;
    }) => `${c.date}|${c.status}|${c.ex_reason ?? ''}`;
    const rpcMap = new Map(fromRpc.map((c) => [key(c), c.count]));
    const oracleMap = new Map(oracle.map((c) => [key(c), c.count]));

    const mismatches: string[] = [];
    for (const [k, n] of oracleMap) {
      const got = rpcMap.get(k);
      if (got !== n)
        mismatches.push(`${k}: rpc ${got ?? 'missing'} vs rows ${n}`);
    }
    for (const k of rpcMap.keys()) {
      if (!oracleMap.has(k)) mismatches.push(`${k}: in rpc only`);
    }

    const rpcTotal = fromRpc.reduce((s, c) => s + c.count, 0);
    const oracleTotal = oracle.reduce((s, c) => s + c.count, 0);

    console.log('\n  buckets from RPC       : ' + fromRpc.length);
    console.log('  buckets from row scan  : ' + oracle.length);
    console.log('  marks counted, RPC     : ' + rpcTotal);
    console.log('  marks counted, rows    : ' + oracleTotal);
    console.log('  rows the scan fetched  : ' + rows.length);
    console.log(
      '  reduction              : ' +
        rows.length +
        ' rows -> ' +
        fromRpc.length +
        ' buckets (' +
        (rows.length / Math.max(1, fromRpc.length)).toFixed(1) +
        'x)'
    );
    console.log(
      '  KPIs identical         : ' +
        (JSON.stringify(kpisFromCounts(fromRpc)) ===
        JSON.stringify(kpisFromCounts(oracle))
          ? 'yes'
          : 'NO')
    );

    expect(mismatches.slice(0, 20)).toEqual([]);
    expect(rpcTotal).toBe(oracleTotal);
    expect(kpisFromCounts(fromRpc)).toEqual(kpisFromCounts(oracle));
  }, 300_000);

  it('returns the same A/L marks the row scan would, after dedupe', async () => {
    const { loadDailyRows, loadAbsenceMarks } =
      await import('@/lib/attendance/dashboard');
    const [fromRpc, rows] = await Promise.all([
      loadAbsenceMarks(AY),
      loadDailyRows(AY),
    ]);
    // The row scan is already deduped, so filtering it here is safe — this is
    // the ONLY order in which filtering to A/L gives the right answer.
    const oracle = rows.filter((r) => r.status === 'A' || r.status === 'L');

    console.log('\n  A/L marks from RPC     : ' + fromRpc.length);
    console.log('  A/L marks from rows    : ' + oracle.length);

    const k = (m: {
      section_student_id: string;
      date: string;
      status: string;
    }) => `${m.section_student_id}|${m.date}|${m.status}`;
    const rpcSet = new Set(fromRpc.map(k));
    const missing = oracle
      .filter((m) => !rpcSet.has(k(m)))
      .slice(0, 10)
      .map(k);

    expect(missing).toEqual([]);
    expect(fromRpc.length).toBe(oracle.length);
  }, 300_000);
});
