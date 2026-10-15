import { describe, expect, it } from 'vitest';

import {
  claimCustomer,
  studentsNeedingHistory,
} from '@/lib/billing/link-claims';

describe('claimCustomer', () => {
  it('lets a free customer be claimed', () => {
    const m = new Map<string, string>();
    expect(claimCustomer(m, 'c1', 'H1')).toBe(true);
    expect(m.get('c1')).toBe('H1');
  });
  it('refuses a customer another student holds', () => {
    const m = new Map([['c1', 'H1']]);
    expect(claimCustomer(m, 'c1', 'H2')).toBe(false);
    expect(m.get('c1')).toBe('H1');
  });
  it('accepts the same student again', () => {
    const m = new Map([['c1', 'H1']]);
    expect(claimCustomer(m, 'c1', 'H1')).toBe(true);
  });
});

describe('studentsNeedingHistory', () => {
  it('keeps stored links whose history never finished, plus new links', () => {
    expect(
      studentsNeedingHistory(
        [
          { studentNumber: 'A', historyLoadedAt: '2026-10-15T00:00:00Z' },
          { studentNumber: 'B', historyLoadedAt: null },
        ],
        ['C', 'B']
      )
    ).toEqual(['B', 'C']);
  });
  it('nothing to do once every marker is set', () => {
    expect(
      studentsNeedingHistory(
        [{ studentNumber: 'A', historyLoadedAt: '2026-10-15T00:00:00Z' }],
        []
      )
    ).toEqual([]);
  });
});
