import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  loadInvoicesList,
  type InvoiceListRow,
} from '@/lib/billing/invoices-list.server';
import {
  loadPaymentsList,
  type PaymentListRow,
} from '@/lib/billing/payments-list.server';
import { round2, todaySg } from '@/lib/billing/view';

// Billing → Sales transactions, as QuickBooks' Sales transactions: every
// invoice and payment of the linked students' customers, with its money bar
// (overdue invoices, open invoices and credits, recently paid).

export type SalesList = {
  connected: boolean;
  invoices: InvoiceListRow[];
  payments: PaymentListRow[];
  customers: Array<{ studentNumber: string; name: string }>;
  bar: {
    overdue: number;
    overdueCount: number;
    open: number;
    openCount: number;
    paid: number;
    paidCount: number;
  };
};

export async function loadSalesList(
  service: SupabaseClient
): Promise<SalesList> {
  const [inv, pay] = await Promise.all([
    loadInvoicesList(service),
    loadPaymentsList(service),
  ]);
  const bar = {
    overdue: 0,
    overdueCount: 0,
    open: 0,
    openCount: 0,
    paid: 0,
    paidCount: 0,
  };
  for (const r of inv.rows) {
    if (r.state === 'voided' || r.balance <= 0) continue;
    bar.open += r.balance;
    bar.openCount += 1;
    if (r.status === 'overdue') {
      bar.overdue += r.balance;
      bar.overdueCount += 1;
    }
  }
  // "Open invoices and credits": unused credit counts against it, as in
  // QuickBooks.
  for (const p of pay.rows)
    if (p.unapplied > 0) {
      bar.open -= p.unapplied;
      bar.openCount += 1;
    }
  const since = new Date(Date.parse(`${todaySg()}T00:00:00Z`) - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  for (const p of pay.rows)
    if ((p.txnDate ?? '') >= since) {
      bar.paid += p.total;
      bar.paidCount += 1;
    }
  return {
    connected: inv.connected,
    invoices: inv.rows,
    payments: pay.rows,
    customers: inv.customers,
    bar: {
      ...bar,
      overdue: round2(bar.overdue),
      open: round2(bar.open),
      paid: round2(bar.paid),
    },
  };
}
