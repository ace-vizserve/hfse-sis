import { describe, expect, it } from 'vitest';

import { fetchInChunks } from '@/lib/supabase/paginate';

// Regression guard for the Markbook Insights two-AY 400 "Bad Request":
// a grading_sheet_id IN-clause spanning two AYs overflowed PostgREST's URL
// length cap. fetchInChunks bounds each request's id list so this can't recur.
describe('fetchInChunks', () => {
  it('issues no fetch for an empty id list', async () => {
    const slices: string[][] = [];
    const out = await fetchInChunks(
      [],
      async (slice) => {
        slices.push(slice);
        return [];
      },
      200
    );
    expect(slices).toEqual([]);
    expect(out).toEqual([]);
  });

  it('issues a single fetch when ids fit in one chunk', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `id-${i}`);
    const slices: string[][] = [];
    await fetchInChunks(
      ids,
      async (slice) => {
        slices.push(slice);
        return slice.map((id) => ({ id }));
      },
      200
    );
    expect(slices).toHaveLength(1);
    expect(slices[0]).toHaveLength(150);
  });

  it('splits a large id list into bounded chunks that cover every id in order', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `id-${i}`);
    const slices: string[][] = [];
    const rows = await fetchInChunks(
      ids,
      async (slice) => {
        slices.push(slice);
        return slice.map((id) => ({ id }));
      },
      200
    );
    // 450 / 200 -> chunks of 200, 200, 50
    expect(slices.map((s) => s.length)).toEqual([200, 200, 50]);
    // No single request exceeds the chunk size (the URL-overflow invariant).
    for (const s of slices) expect(s.length).toBeLessThanOrEqual(200);
    // All ids covered exactly once, in order, and rows merged in order.
    expect(slices.flat()).toEqual(ids);
    expect(rows.map((r) => r.id)).toEqual(ids);
  });

  it('uses the default chunk size of 200 when none is given', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `id-${i}`);
    const slices: string[][] = [];
    await fetchInChunks(ids, async (slice) => {
      slices.push(slice);
      return [];
    });
    expect(slices.map((s) => s.length)).toEqual([200, 1]);
  });
});
