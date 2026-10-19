import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  PAYMENT_COLS,
  toPaymentRow,
  type PayRow,
  type PaymentRowView,
} from '@/lib/billing/customer-page.server';
import { connectedRealmId } from '@/lib/qbo/client';
import { fetchAllPages } from '@/lib/supabase/paginate';

// Billing → Payments: every payment received from a linked student's
// QuickBooks customer, as QuickBooks' Sales transactions list shows its
// Payment rows.

export type PaymentListRow = PaymentRowView & {
  studentNumber: string;
  customerName: string;
};

type Page<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

export async function loadPaymentsList(
  service: SupabaseClient
): Promise<{ connected: boolean; rows: PaymentListRow[] }> {
  const realmId = await connectedRealmId(service);
  if (!realmId) return { connected: false, rows: [] };

  type Link = {
    student_number: string;
    qbo_customer_id: string;
    display_name: string;
  };
  type Pay = PayRow & { qbo_customer_id: string };
  type Doc = { qbo_invoice_id: string; doc_number: string | null };
  const [links, payments, docs] = await Promise.all([
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
    fetchAllPages<Pay>(
      (from, to) =>
        service
          .from('qbo_payments')
          .select(`${PAYMENT_COLS}, qbo_customer_id`)
          .eq('realm_id', realmId)
          .range(from, to) as unknown as Page<Pay>,
      1000,
      { tieBreak: 'qbo_payment_id' }
    ),
    fetchAllPages<Doc>(
      (from, to) =>
        service
          .from('qbo_invoices')
          .select('qbo_invoice_id, doc_number')
          .eq('realm_id', realmId)
          .range(from, to) as unknown as Page<Doc>,
      1000,
      { tieBreak: 'qbo_invoice_id' }
    ),
  ]);

  const byCustomer = new Map<string, Link>();
  for (const l of links)
    if (!byCustomer.has(l.qbo_customer_id))
      byCustomer.set(l.qbo_customer_id, l);
  const docOf = new Map(docs.map((d) => [d.qbo_invoice_id, d.doc_number]));
  const noLabels = new Map<string, string>();

  const rows: PaymentListRow[] = [];
  for (const p of payments) {
    const link = byCustomer.get(p.qbo_customer_id);
    if (!link) continue;
    rows.push({
      ...toPaymentRow(p, docOf, noLabels),
      studentNumber: link.student_number,
      customerName: link.display_name,
    });
  }
  return { connected: true, rows };
}
