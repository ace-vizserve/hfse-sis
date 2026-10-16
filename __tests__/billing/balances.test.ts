import { describe, expect, it } from 'vitest';

import { pickBalances } from '@/lib/billing/balances';

const stored = { owed: 1000, overdue: 80, credit: 30 };

describe('pickBalances', () => {
  it("uses QuickBooks' own balance and aging when they were read", () => {
    expect(
      pickBalances({
        stored,
        live: {
          balance: 970,
          agingRow: {
            customerId: '58',
            name: 'M',
            current: 890,
            overdue: 80,
            total: 970,
          },
        },
      })
    ).toEqual({
      owedOnInvoices: 1000,
      openBalance: 970,
      overdue: 80,
      credit: 30,
      source: 'quickbooks',
    });
  });
  it('a customer missing from the aging report owes nothing overdue', () => {
    expect(
      pickBalances({ stored, live: { balance: 0, agingRow: null } }).overdue
    ).toBe(0);
  });
  it('QuickBooks unreachable: falls back to the stored sums', () => {
    expect(pickBalances({ stored, live: null })).toEqual({
      owedOnInvoices: 1000,
      openBalance: 970,
      overdue: 80,
      credit: 30,
      source: 'stored',
    });
  });
});
