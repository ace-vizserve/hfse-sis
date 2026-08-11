/**
 * The attendance register must not stop at 1,000 rows.
 *
 * MEASURED, NOT IMAGINED. On 2026-08-10 the worst (section × term) in
 * production held **1,610 rows** in `attendance_daily`, against PostgREST's
 * 1,000-row response cap. `getDailyForSection` fetched them in one unpaginated
 * call, so it was silently returning about two-thirds of a term — and
 * `app/api/attendance/[sectionId]/export/route.ts` prints the official .xlsx
 * register straight from it. The register looked complete and was missing
 * weeks of marks; the way anyone would have found out is a parent disputing an
 * absence count.
 *
 * The function's own header comment estimated "~1,410 rows" and concluded that
 * was fine to dedupe in memory. The estimate was roughly right. The conclusion
 * was wrong, because it sized the dedupe and never mentioned the cap.
 *
 * This test uses the real 1,610 so a future reader sees the number that
 * mattered rather than a round one.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

/** The real worst case measured in production. */
const REAL_WORST_CASE = 1610;
const PAGE_SIZE = 1000;

let served: Array<{ from: number; to: number }> = [];

function dailyRow(i: number) {
  return {
    id: `d${i}`,
    section_student_id: `ss-${i % 35}`,
    term_id: 'term-1',
    // One row per (student, date) — distinct keys, so the dedupe keeps them all
    // and the returned length is a straight count of what the fetch retrieved.
    date: `2026-0${(i % 9) + 1}-${String((i % 28) + 1).padStart(2, '0')}`,
    status: 'present',
    ex_reason: null,
    ex_note: null,
    period_id: `p${i}`,
    recorded_by: 'someone@hfse.test',
    recorded_at: new Date(1700000000000 + i).toISOString(),
  };
}

const ALL_ROWS = Array.from({ length: REAL_WORST_CASE }, (_, i) => dailyRow(i));

vi.mock('@/lib/supabase/service', () => {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'gte', 'lte']) {
      self[m] = () => self;
    }
    self.range = (from: number, to: number) => {
      served.push({ from, to });
      return Promise.resolve({
        data: ALL_ROWS.slice(from, to + 1),
        error: null,
      });
    };
    // The roster step resolves without .range().
    self.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        data:
          table === 'section_students'
            ? Array.from({ length: 35 }, (_, i) => ({ id: `ss-${i}` }))
            : [],
        error: null,
      }).then(resolve);
    return self;
  };
  return { createServiceClient: () => ({ from: (t: string) => chain(t) }) };
});

import { getDailyForSection } from '@/lib/attendance/queries';

beforeEach(() => {
  served = [];
});

describe('getDailyForSection at the real production volume', () => {
  it('returns all 1,610 rows rather than the first page', async () => {
    const rows = await getDailyForSection('section-1', 'term-1');
    expect(rows).toHaveLength(REAL_WORST_CASE);
  });

  it('walks more than one page to get them', async () => {
    await getDailyForSection('section-1', 'term-1');
    expect(served.length).toBeGreaterThan(1);
    expect(served[0]).toEqual({ from: 0, to: PAGE_SIZE - 1 });
  });

  it('stops once a page comes back short, without an extra empty request', async () => {
    await getDailyForSection('section-1', 'term-1');
    // 1,610 rows = one full page + one partial. A third request would mean the
    // walk cannot tell "done" from "maybe more".
    expect(served).toHaveLength(2);
  });
});
