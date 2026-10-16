// Which balance figures a page shows. QuickBooks' own (customer Balance, A/R
// aging) when they were just read; otherwise the stored copy's sums, marked
// so the page can say so. Pure.

import type { AgingRow } from '@/lib/billing/aging';
import { round2 } from '@/lib/billing/view';

export type Balances = {
  /** Sum of the open invoices' balances (what is owed before credit). */
  owedOnInvoices: number;
  /** QuickBooks' customer balance: owed minus unused credit. */
  openBalance: number;
  overdue: number;
  credit: number;
  source: 'quickbooks' | 'stored';
};

export function pickBalances(args: {
  stored: { owed: number; overdue: number; credit: number };
  live: { balance: number; agingRow: AgingRow | null } | null;
}): Balances {
  const { stored, live } = args;
  if (live)
    return {
      owedOnInvoices: round2(stored.owed),
      openBalance: round2(live.balance),
      overdue: round2(live.agingRow?.overdue ?? 0),
      credit: round2(stored.credit),
      source: 'quickbooks',
    };
  return {
    owedOnInvoices: round2(stored.owed),
    openBalance: round2(stored.owed - stored.credit),
    overdue: round2(stored.overdue),
    credit: round2(stored.credit),
    source: 'stored',
  };
}
