import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  INVOICE_COLS,
  toInvoiceRow,
  type InvRow,
  type InvoiceRowView,
} from '@/lib/billing/customer-page.server';
import { round2, todaySg } from '@/lib/billing/view';
import { connectedRealmId } from '@/lib/qbo/client';
import { fetchAllPages } from '@/lib/supabase/paginate';

// Billing → Invoices: every invoice of every linked student's QuickBooks
// customer, as QuickBooks' Invoices list shows them, with its money bar
// (unpaid in the last 365 days split overdue / not due yet; paid in the
// last 30 days).

export type InvoiceListRow = InvoiceRowView & {
  studentNumber: string;
  customerName: string;
};

export type InvoicesList = {
  connected: boolean;
  rows: InvoiceListRow[];
  // Every linked customer, for Create invoice's picker.
  customers: Array<{ studentNumber: string; name: string }>;
  bar: {
    overdue: number;
    notDueYet: number;
    paidLast30: number;
    paymentsLast30: number;
  };
};

type Page<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

export async function loadInvoicesList(
  service: SupabaseClient
): Promise<InvoicesList> {
  const bar = { overdue: 0, notDueYet: 0, paidLast30: 0, paymentsLast30: 0 };
  const realmId = await connectedRealmId(service);
  if (!realmId) return { connected: false, rows: [], customers: [], bar };

  type Link = {
    student_number: string;
    qbo_customer_id: string;
    display_name: string;
  };
  type Inv = InvRow & { qbo_customer_id: string | null };
  type Pay = {
    qbo_payment_id: string;
    qbo_customer_id: string;
    txn_date: string | null;
    total: number;
  };
  const [links, invoices, payments] = await Promise.all([
    fetchAllPages<Link>(
      (from, to) =>
        service
          .from('qbo_customers')
          .select('student_number, qbo_customer_id, display_name')
          .eq('realm_id', realmId)
          .range(from, to) as unknown as Page<Link>,
      1000,
      { tieBreak: 'student_number' }
    ),
    fetchAllPages<Inv>(
      (from, to) =>
        service
          .from('qbo_invoices')
          .select(`${INVOICE_COLS}, qbo_customer_id`)
          .eq('realm_id', realmId)
          .range(from, to) as unknown as Page<Inv>,
      1000,
      { tieBreak: 'qbo_invoice_id' }
    ),
    fetchAllPages<Pay>(
      (from, to) =>
        service
          .from('qbo_payments')
          .select('qbo_payment_id, qbo_customer_id, txn_date, total')
          .eq('realm_id', realmId)
          .range(from, to) as unknown as Page<Pay>,
      1000,
      { tieBreak: 'qbo_payment_id' }
    ),
  ]);

  // One row per QuickBooks customer: two students on one customer show the
  // invoice once, under the first student number.
  const byCustomer = new Map<string, Link>();
  for (const l of links)
    if (!byCustomer.has(l.qbo_customer_id))
      byCustomer.set(l.qbo_customer_id, l);

  const today = todaySg();
  const dayMs = 86_400_000;
  const back = (days: number) =>
    new Date(Date.parse(`${today}T00:00:00Z`) - days * dayMs)
      .toISOString()
      .slice(0, 10);
  const since365 = back(365);
  const since30 = back(30);

  const rows: InvoiceListRow[] = [];
  for (const r of invoices) {
    const link = r.qbo_customer_id ? byCustomer.get(r.qbo_customer_id) : null;
    if (!link) continue;
    const row = toInvoiceRow(r, today);
    rows.push({
      ...row,
      studentNumber: link.student_number,
      customerName: link.display_name,
    });
    if (row.state !== 'voided' && row.balance > 0) {
      const d = row.txnDate?.slice(0, 10) ?? '';
      if (d >= since365) {
        if (row.status === 'overdue') bar.overdue += row.balance;
        else bar.notDueYet += row.balance;
      }
    }
  }
  for (const p of payments) {
    if (!byCustomer.has(p.qbo_customer_id)) continue;
    const d = p.txn_date?.slice(0, 10) ?? '';
    if (d >= since30) {
      bar.paidLast30 += Number(p.total);
      bar.paymentsLast30 += 1;
    }
  }

  return {
    connected: true,
    rows,
    customers: [...byCustomer.values()]
      .map((l) => ({ studentNumber: l.student_number, name: l.display_name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    bar: {
      overdue: round2(bar.overdue),
      notDueYet: round2(bar.notDueYet),
      paidLast30: round2(bar.paidLast30),
      paymentsLast30: bar.paymentsLast30,
    },
  };
}
