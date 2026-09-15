import { describe, expect, it } from 'vitest';

import { fetchAllPages } from '@/lib/supabase/paginate';

// Regression guard for the PostgREST 1000-row cap (KD-adjacent bug hunt,
// task C3): lib/markbook/masterfile.ts's grade_entries + attendance_records
// reads were unpaginated and would silently truncate at 1000 rows once a
// level's roster x subjects x terms exceeded it. fetchAllPages is the fix
// wired into those two call sites — this test covers the helper itself,
// which previously had no direct test coverage (only fetchInChunks did).
describe('fetchAllPages', () => {
  it('returns everything from a single partial page (no second request)', async () => {
    let calls = 0;
    const rows = await fetchAllPages<{ id: number }>((from, to) => {
      calls += 1;
      expect(from).toBe(0);
      expect(to).toBe(999);
      return Promise.resolve({
        data: Array.from({ length: 42 }, (_, i) => ({ id: i })),
        error: null,
      });
    });
    expect(calls).toBe(1);
    expect(rows).toHaveLength(42);
  });

  it('walks multiple full pages until a short page terminates the loop, preserving every row past the 1000-row cap', async () => {
    // Simulate 2,500 total rows across pages of 1000 — the exact shape of
    // an HFSE level's grade_entries payload (roster x subjects x terms).
    const TOTAL = 2500;
    const requestedRanges: Array<[number, number]> = [];
    const rows = await fetchAllPages<{ id: number }>((from, to) => {
      requestedRanges.push([from, to]);
      const pageIds = [];
      for (let i = from; i <= to && i < TOTAL; i++) pageIds.push({ id: i });
      return Promise.resolve({ data: pageIds, error: null });
    });
    // 1000 + 1000 + 500 = 3 requests, ranges contiguous and non-overlapping.
    expect(requestedRanges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(rows).toHaveLength(TOTAL);
    // Every row present, not just the first 1000 (the bug this guards against).
    expect(rows.map((r) => r.id)).toEqual(
      Array.from({ length: TOTAL }, (_, i) => i)
    );
  });

  it('issues one more (empty) request after a result that exactly fills a page', async () => {
    // TOTAL is an exact multiple of the custom pageSize (10) — the loop
    // can't distinguish "exactly full" from "there might be more" until it
    // sees a short page, so this documents that a trailing empty request
    // is expected (not a bug) while confirming the loop still terminates
    // and every row is still returned.
    const TOTAL = 20;
    let calls = 0;
    const rows = await fetchAllPages<{ id: number }>(
      (from, to) => {
        calls += 1;
        const pageIds = [];
        for (let i = from; i <= to && i < TOTAL; i++) pageIds.push({ id: i });
        return Promise.resolve({ data: pageIds, error: null });
      },
      10
    );
    expect(calls).toBe(3); // [0,9] full, [10,19] full, [20,29] empty -> stop
    expect(rows).toHaveLength(TOTAL);
  });

  it('returns an empty array when the first page is empty', async () => {
    const rows = await fetchAllPages<{ id: number }>(() =>
      Promise.resolve({ data: [], error: null })
    );
    expect(rows).toEqual([]);
  });

  it('treats a null data page as empty and still terminates', async () => {
    const rows = await fetchAllPages<{ id: number }>(() =>
      Promise.resolve({ data: null, error: null })
    );
    expect(rows).toEqual([]);
  });

  it('throws when a page returns an error', async () => {
    await expect(
      fetchAllPages<{ id: number }>(() =>
        Promise.resolve({ data: null, error: { message: 'boom' } })
      )
    ).rejects.toThrow('boom');
  });
});

// `.range()` is OFFSET/LIMIT, and SQL promises nothing about row order without
// an ORDER BY — so an unordered paginated read can hand the same row back on
// two pages and never hand back another. Measured on AY2026 (2026-09-15)
// before this: the markbook grade-entry read returned 3,473 rows holding 2,744
// distinct ids. Sixty-one call sites had no ordering, so the tie-break lives in
// the helper and cannot be forgotten by a new read.
describe('fetchAllPages — total order', () => {
  type Chain = PromiseLike<{
    data: Array<{ id: number }> | null;
    error: null;
  }> & {
    order: (col: string, opts?: { ascending?: boolean }) => Chain;
  };

  function fakeChain(
    rows: Array<{ id: number }>,
    seen: Array<[string, boolean | undefined]>
  ): Chain {
    const chain = {
      order(col: string, opts?: { ascending?: boolean }) {
        seen.push([col, opts?.ascending]);
        return chain as Chain;
      },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return chain as unknown as Chain;
  }

  it('appends id as the last order key on every page request', async () => {
    const seen: Array<[string, boolean | undefined]> = [];
    const rows = await fetchAllPages<{ id: number }>((from) =>
      fakeChain(
        from === 0
          ? Array.from({ length: 1000 }, (_, i) => ({ id: i }))
          : [{ id: 1000 }],
        seen
      )
    );
    expect(rows).toHaveLength(1001);
    // Two page requests, each ordered.
    expect(seen).toEqual([
      ['id', true],
      ['id', true],
    ]);
  });

  it('leaves a caller ordering in front of it, as a tie-break only', async () => {
    const seen: Array<[string, boolean | undefined]> = [];
    await fetchAllPages<{ id: number }>(() =>
      fakeChain([{ id: 1 }], seen).order('recorded_at', { ascending: false })
    );
    expect(seen).toEqual([
      ['recorded_at', false],
      ['id', true],
    ]);
  });

  it('can be opted out for a source with no id — a set-returning RPC', async () => {
    const seen: Array<[string, boolean | undefined]> = [];
    await fetchAllPages<{ id: number }>(
      () => fakeChain([{ id: 1 }], seen),
      undefined,
      { tieBreak: null }
    );
    expect(seen).toEqual([]);
  });

  it('passes through a builder that cannot be ordered', async () => {
    // A plain promise-returning builder (what most tests hand it) has no
    // `.order`, and must keep working untouched.
    const rows = await fetchAllPages<{ id: number }>(() =>
      Promise.resolve({ data: [{ id: 7 }], error: null })
    );
    expect(rows).toEqual([{ id: 7 }]);
  });
});
