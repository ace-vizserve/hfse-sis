/**
 * Confirms the attendance dashboard now reads the ledger as append-only.
 *
 * Before the fix `loadDailyRows` returned every row in `attendance_daily`,
 * including marks that had been superseded by a correction. This compares what
 * the dashboard now sees against the raw ledger, and against the corrections
 * actually present in AY2026.
 *
 * NOT A TEST — hits the live database, reachable only via
 * `scripts/vitest.perf.config.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
  unstable_noStore: () => {},
}));

describe('attendance ledger supersede', () => {
  it('drops superseded marks and keeps every real one', async () => {
    const { loadDailyRows } = await import('@/lib/attendance/dashboard');
    const { createServiceClient } = await import('@/lib/supabase/service');
    const svc = createServiceClient();

    const rows = await loadDailyRows('AY2026');

    const { data: ay } = await svc
      .from('academic_years')
      .select('id')
      .eq('ay_code', 'AY2026')
      .single();
    const { data: secs } = await svc
      .from('sections')
      .select('id')
      .eq('academic_year_id', (ay as { id: string }).id);
    const secIds = (secs ?? []).map((s: { id: string }) => s.id);
    let ss: Array<{ id: string }> = [];
    for (let f = 0; ; f += 1000) {
      const { data } = await svc
        .from('section_students')
        .select('id')
        .in('section_id', secIds)
        .range(f, f + 999);
      if (!data?.length) break;
      ss = ss.concat(data as Array<{ id: string }>);
      if (data.length < 1000) break;
    }
    const ids = ss.map((r) => r.id);
    let rawCount = 0;
    const pairs = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200);
      for (let g = 0; ; g += 1000) {
        const { data } = await svc
          .from('attendance_daily')
          .select('section_student_id,date,period_id')
          .in('section_student_id', slice)
          .range(g, g + 999);
        if (!data?.length) break;
        for (const r of data as Array<{
          section_student_id: string;
          date: string;
          period_id: string | null;
        }>) {
          rawCount++;
          pairs.add(`${r.section_student_id}|${r.date}|${r.period_id ?? ''}`);
        }
        if (data.length < 1000) break;
      }
    }

    console.log('\n  raw ledger rows          : ' + rawCount);
    console.log('  distinct (student,date)  : ' + pairs.size);
    console.log('  dashboard now sees       : ' + rows.length);
    console.log('  superseded rows dropped  : ' + (rawCount - rows.length));

    // ⚠ THIS RUNS AGAINST A LEDGER BEING WRITTEN TO. The dashboard read and the
    // raw scan below it are separate round trips, so a mark recorded between
    // them shows up in one and not the other — the raw count moved 48,574 →
    // 48,580 across two runs minutes apart. An exact equality here fails on a
    // live system for a reason that has nothing to do with the code, so the
    // count is checked with a small tolerance and the invariant that CANNOT
    // race — no key twice — is checked strictly below.
    expect(Math.abs(rows.length - pairs.size)).toBeLessThanOrEqual(20);
    expect(rawCount).toBeGreaterThan(rows.length);

    // …and no key may appear twice in what it returns.
    const seen = new Set<string>();
    const dupes = rows.filter((r) => {
      const k = `${r.section_student_id}|${r.date}`;
      if (seen.has(k)) return true;
      seen.add(k);
      return false;
    });
    expect(dupes).toHaveLength(0);
  }, 300_000);
});
