/**
 * Aggregating in Postgres must not change a single number on the dashboard.
 *
 * The attendance dashboard used to pull the whole year's `attendance_daily`
 * into Node and reduce it there — 48,589 rows on AY2026, 95% of them plain
 * `P`, to produce a few KPIs and a donut. Migration 148 moves that reduction
 * into SQL, so the loaders now receive per-(date, status, ex_reason) buckets
 * instead of one row per mark.
 *
 * The risk in that swap is arithmetic drift: a bucket path that counts subtly
 * differently from the row path it replaced. These tests pin the two together —
 * `kpisFromCounts(countsFromRows(rows))` must equal `kpisFor(rows)` for every
 * shape of input, including the awkward ones (NC, null ex_reason, a day with
 * nothing recorded).
 *
 * `countsFromRows` is also the fallback used when migration 148 has not been
 * applied yet, and the oracle
 * `scripts/verify-attendance-aggregates.perf.ts` compares the real RPC against
 * — so these tests cover all three uses at once.
 */
import { describe, expect, it } from 'vitest';

import {
  countsFromRows,
  kpisFor,
  kpisFromCounts,
  sliceDailyRows,
  sliceMarkCounts,
  type DailyRow,
} from '@/lib/attendance/dashboard';

function row(over: Partial<DailyRow> = {}): DailyRow {
  return {
    date: '2026-08-03',
    status: 'P',
    ex_reason: null,
    section_student_id: 'ss-1',
    ...over,
  };
}

/** A roster-shaped mixture: mostly present, a few of everything else. */
const MIXED: DailyRow[] = [
  ...Array.from({ length: 20 }, (_, i) =>
    row({ section_student_id: `ss-${i}` })
  ),
  row({ section_student_id: 'ss-20', status: 'A' }),
  row({ section_student_id: 'ss-21', status: 'A' }),
  row({ section_student_id: 'ss-22', status: 'L' }),
  row({ section_student_id: 'ss-23', status: 'EX', ex_reason: 'mc' }),
  row({ section_student_id: 'ss-24', status: 'EX', ex_reason: 'vacation' }),
  row({ section_student_id: 'ss-25', status: 'EX', ex_reason: null }),
  row({ section_student_id: 'ss-26', status: 'NC' }),
  // A second date, so slicing has something to cut.
  row({ date: '2026-08-04', section_student_id: 'ss-0', status: 'A' }),
  row({ date: '2026-08-04', section_student_id: 'ss-1' }),
];

describe('countsFromRows / kpisFromCounts', () => {
  it('produces the same KPIs as reducing the rows directly', () => {
    expect(kpisFromCounts(countsFromRows(MIXED))).toEqual(kpisFor(MIXED));
  });

  it('agrees with the row path after slicing to a range', () => {
    const from = '2026-08-03';
    const to = '2026-08-03';
    expect(
      kpisFromCounts(sliceMarkCounts(countsFromRows(MIXED), from, to))
    ).toEqual(kpisFor(sliceDailyRows(MIXED, from, to)));
  });

  it('keeps NC out of the encoded total, exactly as the row path does', () => {
    const rows = [row({ status: 'P' }), row({ status: 'NC' })];
    const viaCounts = kpisFromCounts(countsFromRows(rows));
    expect(viaCounts).toEqual(kpisFor(rows));
    expect(viaCounts.encodedDays).toBe(1);
    expect(viaCounts.nc).toBe(1);
  });

  it('collapses identical marks into one bucket with a count', () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      row({ section_student_id: `ss-${i}` })
    );
    const counts = countsFromRows(rows);
    expect(counts).toHaveLength(1);
    expect(counts[0]).toMatchObject({ status: 'P', count: 40 });
  });

  it('separates EX by reason but never splits other statuses on it', () => {
    // Only EX carries a reason. Folding the rest onto null is what keeps the
    // bucket count small and matches the RPC's GROUP BY.
    const rows = [
      row({ status: 'EX', ex_reason: 'mc' }),
      row({ status: 'EX', ex_reason: 'compassionate' }),
      row({ status: 'A', ex_reason: 'mc' }), // nonsense in practice; must fold
      row({ status: 'A', ex_reason: null }),
    ];
    const counts = countsFromRows(rows);
    const ex = counts.filter((c) => c.status === 'EX');
    const absent = counts.filter((c) => c.status === 'A');
    expect(ex).toHaveLength(2);
    expect(absent).toHaveLength(1);
    expect(absent[0].count).toBe(2);
  });

  it('drops nothing when every mark is distinct', () => {
    const rows = [
      row({ date: '2026-08-03', status: 'P' }),
      row({ date: '2026-08-04', status: 'A' }),
      row({ date: '2026-08-05', status: 'L' }),
    ];
    expect(countsFromRows(rows)).toHaveLength(3);
    expect(kpisFromCounts(countsFromRows(rows))).toEqual(kpisFor(rows));
  });

  it('handles an empty year without dividing by zero', () => {
    const k = kpisFromCounts([]);
    expect(k.attendancePct).toBe(0);
    expect(k.encodedDays).toBe(0);
    expect(k).toEqual(kpisFor([]));
  });

  it('slices on the same inclusive bounds as the row helper', () => {
    const counts = countsFromRows(MIXED);
    expect(sliceMarkCounts(counts, '2026-08-04', '2026-08-04')).toHaveLength(2);
    expect(sliceMarkCounts(counts, '2026-08-01', '2026-08-02')).toHaveLength(0);
    // Inclusive at both ends, matching sliceDailyRows.
    expect(sliceMarkCounts(counts, '2026-08-03', '2026-08-04').length).toBe(
      counts.length
    );
  });
});
