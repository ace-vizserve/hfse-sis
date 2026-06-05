import { describe, expect, it } from 'vitest';

import { termIdsForRange, type TermWindow } from '@/lib/markbook/term-range';

// AY2026-style term windows (Jan–Nov per calendar year, KD #13).
const TERMS: TermWindow[] = [
  { id: 't1', start_date: '2026-01-06', end_date: '2026-03-20' },
  { id: 't2', start_date: '2026-04-06', end_date: '2026-06-19' },
  { id: 't3', start_date: '2026-07-06', end_date: '2026-09-18' },
  { id: 't4', start_date: '2026-10-05', end_date: '2026-11-20' },
];

describe('termIdsForRange', () => {
  it('returns only the single term whose window contains the range', () => {
    // A range fully inside T2.
    expect(termIdsForRange(TERMS, '2026-05-01', '2026-05-31')).toEqual(['t2']);
  });

  it('returns multiple terms for a whole-AY range', () => {
    expect(termIdsForRange(TERMS, '2026-01-01', '2026-12-31')).toEqual([
      't1',
      't2',
      't3',
      't4',
    ]);
  });

  it('returns ALL terms when no range is given (AY-wide fallback)', () => {
    expect(termIdsForRange(TERMS)).toEqual(['t1', 't2', 't3', 't4']);
    expect(termIdsForRange(TERMS, null, null)).toEqual([
      't1',
      't2',
      't3',
      't4',
    ]);
    // One side missing still falls back (need BOTH to scope).
    expect(termIdsForRange(TERMS, '2026-05-01', null)).toEqual([
      't1',
      't2',
      't3',
      't4',
    ]);
    expect(termIdsForRange(TERMS, null, '2026-05-31')).toEqual([
      't1',
      't2',
      't3',
      't4',
    ]);
  });

  it('includes a term when the range touches its boundary date (inclusive)', () => {
    // Range ends exactly on T1's last day → T1 in scope.
    expect(termIdsForRange(TERMS, '2026-03-20', '2026-03-25')).toEqual(['t1']);
    // Range starts exactly on T2's first day → T2 in scope.
    expect(termIdsForRange(TERMS, '2026-04-06', '2026-04-10')).toEqual(['t2']);
    // A range spanning the T1→T2 gap and touching both boundaries.
    expect(termIdsForRange(TERMS, '2026-03-20', '2026-04-06')).toEqual([
      't1',
      't2',
    ]);
  });

  it('excludes a term with null dates when a range is given', () => {
    const withNull: TermWindow[] = [
      ...TERMS,
      { id: 'tx', start_date: null, end_date: null },
    ];
    expect(termIdsForRange(withNull, '2026-05-01', '2026-05-31')).toEqual([
      't2',
    ]);
    // But the AY-wide fallback still lists it (no range to intersect against).
    expect(termIdsForRange(withNull)).toEqual(['t1', 't2', 't3', 't4', 'tx']);
  });

  it('returns empty when the range falls in a gap between terms', () => {
    // Between T1 end (03-20) and T2 start (04-06).
    expect(termIdsForRange(TERMS, '2026-03-25', '2026-03-30')).toEqual([]);
  });
});
