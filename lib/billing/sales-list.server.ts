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
import type { SalesDocRow } from '@/lib/billing/sales-docs';
import { round2, todaySg } from '@/lib/billing/view';
import { connectedRealmId, qboQueryAll } from '@/lib/qbo/client';
import { fetchAllPages } from '@/lib/supabase/paginate';

export type SalesDocListRow = SalesDocRow & {
  studentNumber: string;
  customerName: string;
};

// Billing → Sales transactions, as QuickBooks' Sales transactions: every
// invoice and payment of the linked students' customers, with its money bar
// (overdue invoices, open invoices and credits, recently paid).

export type SalesList = {
  connected: boolean;
  invoices: InvoiceListRow[];
  payments: PaymentListRow[];
  /** Refund receipts and credit memos, read live. */
  docs: SalesDocListRow[];
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

/** Refund receipts and credit memos of the linked students' customers, read
 *  live (the SIS keeps no copy). Unreadable → none, logged; the list still
 *  shows the invoices and payments. */
async function loadSalesDocs(
  service: SupabaseClient
): Promise<SalesDocListRow[]> {
  try {
    const realmId = await connectedRealmId(service);
    if (!realmId) return [];
    const [links, refunds, credits] = await Promise.all([
      fetchAllPages<{
        student_number: string;
        qbo_customer_id: string;
        display_name: string;
      }>(
        (from, to) =>
          service
            .from('qbo_customers')
            .select('student_number, qbo_customer_id, display_name')
            .eq('realm_id', realmId)
            .range(from, to) as unknown as PromiseLike<{
            data: Array<{
              student_number: string;
              qbo_customer_id: string;
              display_name: string;
            }> | null;
            error: { message: string } | null;
          }>,
        1000,
        { tieBreak: 'student_number' }
      ),
      qboQueryAll<QbDoc>(service, 'RefundReceipt'),
      qboQueryAll<QbDoc>(service, 'CreditMemo'),
    ]);
    const byCustomer = new Map(links.map((l) => [l.qbo_customer_id, l]));
    const rows: SalesDocListRow[] = [];
    for (const [kind, list] of [
      ['refund', refunds],
      ['credit', credits],
    ] as const)
      for (const d of list) {
        const l = byCustomer.get(d.CustomerRef.value);
        if (!l) continue;
        rows.push({
          kind,
          id: d.Id,
          docNumber: d.DocNumber ?? null,
          txnDate: d.TxnDate ?? null,
          total: Number(d.TotalAmt),
          open: kind === 'credit' ? round2(Number(d.RemainingCredit ?? 0)) : 0,
          memo: d.PrivateNote?.trim() || null,
          studentNumber: l.student_number,
          customerName: l.display_name,
        });
      }
    return rows;
  } catch (e) {
    console.error('[billing] sales list, refunds and credits:', e);
    return [];
  }
}

type QbDoc = {
  Id: string;
  DocNumber?: string;
  TxnDate?: string;
  TotalAmt: number;
  RemainingCredit?: number;
  PrivateNote?: string;
  CustomerRef: { value: string };
};

export async function loadSalesList(
  service: SupabaseClient
): Promise<SalesList> {
  const [inv, pay, docs] = await Promise.all([
    loadInvoicesList(service),
    loadPaymentsList(service),
    loadSalesDocs(service),
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
  // Credit memos' unused credit is "credits" too.
  for (const d of docs)
    if (d.kind === 'credit' && d.open > 0) {
      bar.open -= d.open;
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
    docs,
    customers: inv.customers,
    bar: {
      ...bar,
      overdue: round2(bar.overdue),
      open: round2(bar.open),
      paid: round2(bar.paid),
    },
  };
}
