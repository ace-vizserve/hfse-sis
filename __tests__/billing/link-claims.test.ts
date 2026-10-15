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
  it('keeps only students with neither invoices nor payments', () => {
    expect(
      studentsNeedingHistory(
        ['A', 'B', 'C', 'D'],
        new Set(['A']),
        new Set(['B'])
      )
    ).toEqual(['C', 'D']);
  });
});
