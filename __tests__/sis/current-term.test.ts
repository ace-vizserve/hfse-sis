import { describe, expect, it } from 'vitest';
import {
  hasTermStarted,
  resolveCurrentTerm,
  resolveCurrentTermId,
  type TermLike,
} from '@/lib/sis/current-term';

// AY9999-shaped windows: T1 Jan, T2 ends May 29, T3 starts Jun 29, T4 Sep–Nov.
function terms(
  over: Partial<Record<1 | 2 | 3 | 4, Partial<TermLike>>> = {}
): TermLike[] {
  const base: TermLike[] = [
    {
      id: 't1',
      term_number: 1,
      start_date: '2026-01-08',
      end_date: '2026-03-13',
      is_current: false,
    },
    {
      id: 't2',
      term_number: 2,
      start_date: '2026-03-24',
      end_date: '2026-05-29',
      is_current: false,
    },
    {
      id: 't3',
      term_number: 3,
      start_date: '2026-06-29',
      end_date: '2026-09-06',
      is_current: false,
    },
    {
      id: 't4',
      term_number: 4,
      start_date: '2026-09-14',
      end_date: '2026-11-21',
      is_current: false,
    },
  ];
  return base.map((t) => ({ ...t, ...over[t.term_number as 1 | 2 | 3 | 4] }));
}

describe('resolveCurrentTermId', () => {
  it('returns the term whose window contains today', () => {
    expect(resolveCurrentTermId(terms(), '2026-04-15')).toBe('t2');
    expect(resolveCurrentTermId(terms(), '2026-02-01')).toBe('t1');
    expect(resolveCurrentTermId(terms(), '2026-10-01')).toBe('t4');
  });

  it('returns the most-recently-ended term during a between-terms break', () => {
    // today (Jun 1) is past T2 (ended May 29), before T3 (starts Jun 29).
    expect(resolveCurrentTermId(terms(), '2026-06-01')).toBe('t2');
  });

  it('returns the earliest term when today precedes the whole year', () => {
    expect(resolveCurrentTermId(terms(), '2026-01-01')).toBe('t1');
  });

  it('returns the last (most-recently-ended) term when today is past the year', () => {
    expect(resolveCurrentTermId(terms(), '2026-12-31')).toBe('t4');
  });

  it('date containment wins over a stale is_current flag', () => {
    // today is in T2; T4 is flagged current — date must win.
    expect(
      resolveCurrentTermId(terms({ 4: { is_current: true } }), '2026-04-15')
    ).toBe('t2');
  });

  it('honors is_current only in a between-terms gap', () => {
    // today (Jun 1) is in a break; T3 pinned current → use the pin over most-recent.
    expect(
      resolveCurrentTermId(terms({ 3: { is_current: true } }), '2026-06-01')
    ).toBe('t3');
  });

  it('ignores terms with null dates for containment but still honors their flag', () => {
    const t: TermLike[] = [
      {
        id: 'a',
        term_number: 1,
        start_date: null,
        end_date: null,
        is_current: true,
      },
      {
        id: 'b',
        term_number: 2,
        start_date: null,
        end_date: null,
        is_current: false,
      },
    ];
    expect(resolveCurrentTermId(t, '2026-06-01')).toBe('a');
  });

  it('returns null for an empty term list', () => {
    expect(resolveCurrentTermId([], '2026-06-01')).toBeNull();
  });
});

describe('resolveCurrentTerm', () => {
  it('returns the whole term object (not just the id)', () => {
    const result = resolveCurrentTerm(terms(), '2026-04-15');
    expect(result?.id).toBe('t2');
    expect(result?.term_number).toBe(2);
  });

  it('returns null for an empty list', () => {
    expect(resolveCurrentTerm([], '2026-06-01')).toBeNull();
  });
});

// hasTermStarted — the "is the school year underway" gate (KD #136). Lifted out
// of three inline copies (/sis/sections, /sis/sections/[id], /markbook/sections),
// so these cases pin the behaviour all three used to have.
describe('hasTermStarted', () => {
  it('is false before the first term begins', () => {
    expect(hasTermStarted(terms(), '2026-01-07')).toBe(false);
  });

  it('is true on the very first day of T1', () => {
    expect(hasTermStarted(terms(), '2026-01-08')).toBe(true);
  });

  it('is true mid-term', () => {
    expect(hasTermStarted(terms(), '2026-04-15')).toBe(true);
  });

  it('stays true in the gap between terms — the reshuffle window', () => {
    // 2026-06-01 sits after T2 ended (05-29) and before T3 starts (06-29).
    // A holiday reassignment still needs a reason: marks already exist.
    expect(hasTermStarted(terms(), '2026-06-01')).toBe(true);
  });

  it('stays true after the whole year has ended', () => {
    expect(hasTermStarted(terms(), '2027-01-01')).toBe(true);
  });

  it('is false when no term has a start date — an unconfigured calendar must not block setup', () => {
    const undated = terms().map((t) => ({ ...t, start_date: null }));
    expect(hasTermStarted(undated, '2026-06-01')).toBe(false);
  });

  it('ignores undated terms but still honours a dated one', () => {
    expect(
      hasTermStarted(
        [{ start_date: null }, { start_date: '2026-01-08' }],
        '2026-02-01'
      )
    ).toBe(true);
  });

  it('is false for an empty term list', () => {
    expect(hasTermStarted([], '2026-06-01')).toBe(false);
  });
});
