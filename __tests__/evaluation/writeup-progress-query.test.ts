/**
 * Regression tests for lib/evaluation/queries.ts::getWriteupProgressByTerm.
 *
 * The bug these pin (found 2026-07-29 on live production data): the write-up
 * query filtered `.in('student_id', rosterStudentIds)`. PostgREST puts `.in()`
 * values in the URL query string, so a whole-AY roster (405 uuids, ~15KB)
 * made the request fail outright with `TypeError: fetch failed`. The result was
 * destructured as `const { data } = await ...`, discarding `error`, so the
 * failure read as "no rows" and /evaluation/sections rendered 0/N for every
 * section — for months, on data that was completely healthy (367 T1 and 370 T2
 * write-ups, every one of them matching an active roster student).
 *
 * Two properties are pinned here, because either one alone would have let it
 * hide: the query must not put the roster in the URL, and a query error must
 * surface instead of degrading to a plausible-looking zero.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const createServiceClient = vi.fn();
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => createServiceClient(),
}));

const { getWriteupProgressByTerm } = await import('@/lib/evaluation/queries');

type Row = Record<string, unknown>;

/**
 * Minimal PostgREST-shaped stub. Records every `.in()` call so a test can
 * assert what would have been serialized into the request URL.
 */
function mkService(opts: {
  enrolments: Row[];
  writeups?: Row[];
  writeupError?: { message: string };
  enrolmentError?: { message: string };
  onIn?: (column: string, values: string[]) => void;
}) {
  return {
    from(table: string) {
      const isWriteups = table === 'evaluation_writeups';
      const result = isWriteups
        ? { data: opts.writeups ?? [], error: opts.writeupError ?? null }
        : { data: opts.enrolments, error: opts.enrolmentError ?? null };

      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.neq = chain;
      builder.in = (column: string, values: string[]) => {
        opts.onIn?.(column, values);
        return builder;
      };
      // `.range()` terminates the chain — fetchAllPages awaits it.
      builder.range = () => Promise.resolve(result);
      // Also thenable, so a non-paginated chain still resolves.
      builder.then = (res: (v: unknown) => unknown) =>
        Promise.resolve(result).then(res);
      return builder;
    },
  };
}

beforeEach(() => {
  createServiceClient.mockReset();
});

describe('getWriteupProgressByTerm — roster must never go in the URL', () => {
  it('does not pass student ids to .in() even with a whole-AY roster', async () => {
    // 405 students across 21 sections — HFSE's real AY2026 scale, the size
    // that broke the request.
    const enrolments = Array.from({ length: 405 }, (_, i) => ({
      section_id: `sec-${i % 21}`,
      student_id: `stu-${i}`,
      enrollment_status: 'active',
    }));
    const inCalls: Array<{ column: string; count: number }> = [];

    createServiceClient.mockReturnValue(
      mkService({
        enrolments,
        writeups: [],
        onIn: (column, values) =>
          inCalls.push({ column, count: values.length }),
      })
    );

    await getWriteupProgressByTerm(
      'term-1',
      Array.from({ length: 21 }, (_, i) => `sec-${i}`)
    );

    expect(inCalls.some((c) => c.column === 'student_id')).toBe(false);
    // The section-id filter is fine — bounded by section count, not roster.
    for (const call of inCalls) expect(call.count).toBeLessThanOrEqual(100);
  });

  it('counts submitted write-ups for a large roster', async () => {
    const enrolments = Array.from({ length: 405 }, (_, i) => ({
      section_id: `sec-${i % 21}`,
      student_id: `stu-${i}`,
      enrollment_status: 'active',
    }));
    // 367 real write-ups, mirroring live T1.
    const writeups = Array.from({ length: 367 }, (_, i) => ({
      student_id: `stu-${i}`,
      writeup: 'A thoughtful paragraph about the student.',
    }));

    createServiceClient.mockReturnValue(mkService({ enrolments, writeups }));

    const progress = await getWriteupProgressByTerm(
      'term-1',
      Array.from({ length: 21 }, (_, i) => `sec-${i}`)
    );

    const totalSubmitted = Object.values(progress).reduce(
      (n, p) => n + p.submitted_count,
      0
    );
    const totalActive = Object.values(progress).reduce(
      (n, p) => n + p.active_count,
      0
    );
    expect(totalSubmitted).toBe(367);
    expect(totalActive).toBe(405);
  });
});

describe('getWriteupProgressByTerm — a query failure must not read as zero', () => {
  it('throws when the write-up query errors', async () => {
    createServiceClient.mockReturnValue(
      mkService({
        enrolments: [
          {
            section_id: 'sec-1',
            student_id: 'stu-1',
            enrollment_status: 'active',
          },
        ],
        writeupError: { message: 'fetch failed' },
      })
    );

    await expect(getWriteupProgressByTerm('term-1', ['sec-1'])).rejects.toThrow(
      /fetch failed/
    );
  });

  it('throws when the roster query errors', async () => {
    createServiceClient.mockReturnValue(
      mkService({ enrolments: [], enrolmentError: { message: 'fetch failed' } })
    );

    await expect(getWriteupProgressByTerm('term-1', ['sec-1'])).rejects.toThrow(
      /fetch failed/
    );
  });
});

describe('getWriteupProgressByTerm — counting rules still hold', () => {
  it('ignores a submitted-but-empty write-up (KD #120/#126)', async () => {
    createServiceClient.mockReturnValue(
      mkService({
        enrolments: [
          {
            section_id: 'sec-1',
            student_id: 'stu-1',
            enrollment_status: 'active',
          },
          {
            section_id: 'sec-1',
            student_id: 'stu-2',
            enrollment_status: 'active',
          },
        ],
        writeups: [
          { student_id: 'stu-1', writeup: '   ' },
          { student_id: 'stu-2', writeup: 'Real content.' },
        ],
      })
    );

    const progress = await getWriteupProgressByTerm('term-1', ['sec-1']);
    expect(progress['sec-1'].submitted_count).toBe(1);
    expect(progress['sec-1'].active_count).toBe(2);
  });

  it('credits a transferred student to their current section, not the old one', async () => {
    // The student's write-up carries a stale section_id (KD #67); the count
    // must follow the live roster instead. Fetching write-ups unfiltered makes
    // this property structural — there is no student-id filter to get wrong.
    createServiceClient.mockReturnValue(
      mkService({
        enrolments: [
          {
            section_id: 'sec-new',
            student_id: 'stu-1',
            enrollment_status: 'active',
          },
        ],
        writeups: [{ student_id: 'stu-1', writeup: 'Moved mid-year.' }],
      })
    );

    const progress = await getWriteupProgressByTerm('term-1', [
      'sec-old',
      'sec-new',
    ]);
    expect(progress['sec-new'].submitted_count).toBe(1);
    expect(progress['sec-old']).toBeUndefined();
  });

  it('does not credit a write-up whose student is not on any listed roster', async () => {
    // Fetching the term's write-ups unfiltered means rows for other sections'
    // students come back too — they must be discarded, not counted.
    createServiceClient.mockReturnValue(
      mkService({
        enrolments: [
          {
            section_id: 'sec-1',
            student_id: 'stu-1',
            enrollment_status: 'active',
          },
        ],
        writeups: [
          { student_id: 'stu-1', writeup: 'Mine.' },
          { student_id: 'stu-999', writeup: 'Another section entirely.' },
        ],
      })
    );

    const progress = await getWriteupProgressByTerm('term-1', ['sec-1']);
    expect(progress['sec-1'].submitted_count).toBe(1);
  });
});
