import { describe, expect, it } from 'vitest';

import { resolveSelectedTermId } from '@/lib/classroom/terms';

const T1 = {
  id: 't1',
  term_number: 1,
  start_date: '2026-01-05',
  end_date: '2026-03-20',
  is_current: false,
};
const T2 = {
  id: 't2',
  term_number: 2,
  start_date: '2026-04-01',
  end_date: '2026-06-15',
  is_current: true,
};
const TERMS = [T1, T2];

describe('resolveSelectedTermId', () => {
  it('honours a ?term_id= that names a real term in this AY', () => {
    expect(resolveSelectedTermId(TERMS, 't1', '2026-05-01')).toBe('t1');
  });

  it('falls back to the canonical current-term resolver when term_id is absent', () => {
    // 2026-05-01 falls inside T2's window.
    expect(resolveSelectedTermId(TERMS, undefined, '2026-05-01')).toBe('t2');
  });

  it('falls back when term_id names a term from a different AY (not in this list)', () => {
    expect(resolveSelectedTermId(TERMS, 'not-a-real-term', '2026-05-01')).toBe(
      't2'
    );
  });

  it('falls back to the is_current flag during a between-terms gap', () => {
    // 2026-03-25 is after T1 ends and before T2 starts.
    expect(resolveSelectedTermId(TERMS, undefined, '2026-03-25')).toBe('t2');
  });

  it('returns null when there are no terms at all', () => {
    expect(resolveSelectedTermId([], undefined, '2026-05-01')).toBeNull();
  });

  it('defaults `today` to sgToday() when omitted (does not throw)', () => {
    expect(() => resolveSelectedTermId(TERMS, undefined)).not.toThrow();
  });
});
