import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { BillingMaps } from '@/lib/billing/classify';
import {
  latestPaymentDates,
  paymentApplied,
  type QbInvoiceFull,
  type QbPayment,
} from '@/lib/billing/invoice-row';
import { loadBillingMaps } from '@/lib/billing/settings.server';
import { upsertInvoice, upsertPayment } from '@/lib/billing/store.server';
import { syncTilesForStudent } from '@/lib/billing/tiles.server';
import {
  connectedRealmId,
  qbEscape,
  qboQueryAll,
  QboNotConnectedError,
} from '@/lib/qbo/client';

export async function studentForCustomer(
  service: SupabaseClient,
  customerId: string,
  realmId: string
): Promise<string | null> {
  const { data, error } = await service
    .from('qbo_customers')
    .select('student_number')
    .eq('qbo_customer_id', customerId)
    .eq('realm_id', realmId)
    .limit(2);
  if (error) throw new Error(`Linked customer lookup failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ student_number: string }>;
  if (rows.length > 1) {
    console.error(
      `[billing] QuickBooks customer ${customerId} is linked to more than one student; ignoring it`
    );
    return null;
  }
  return rows[0]?.student_number ?? null;
}

/**
 * Reads every invoice and payment of the student's linked QuickBooks customer
 * into the Billing store, then recomputes their tiles for every year touched.
 */
export async function loadCustomerHistory(
  service: SupabaseClient,
  studentNumber: string,
  preloaded?: { realmId: string; maps: BillingMaps }
): Promise<{
  invoices: number;
  payments: number;
  tilesChanged: number;
  errors: string[];
}> {
  const realmId = preloaded?.realmId ?? (await connectedRealmId(service));
  if (!realmId) throw new QboNotConnectedError();
  const { data: link, error } = await service
    .from('qbo_customers')
    .select('qbo_customer_id')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId)
    .maybeSingle();
  if (error) throw new Error(`Linked customer lookup failed: ${error.message}`);
  if (!link)
    return {
      invoices: 0,
      payments: 0,
      tilesChanged: 0,
      errors: ['This student is not linked to a QuickBooks customer yet.'],
    };
  const cust = `CustomerRef = '${qbEscape(link.qbo_customer_id as string)}'`;
  const [invoices, payments, maps] = await Promise.all([
    qboQueryAll<QbInvoiceFull>(service, 'Invoice', cust),
    qboQueryAll<QbPayment>(service, 'Payment', cust),
    preloaded?.maps ?? loadBillingMaps(service),
  ]);
  for (const p of payments)
    await upsertPayment(service, { p, studentNumber, realmId });
  const paymentDates = latestPaymentDates(
    payments.map((p) => ({
      txnDate: p.TxnDate ?? null,
      applied: paymentApplied(p),
    }))
  );
  const years = new Set<string>();
  for (const inv of invoices) {
    const r = await upsertInvoice(service, {
      inv,
      qboInvoiceId: inv.Id,
      studentNumber,
      realmId,
      maps,
      paymentDates,
    });
    if (r.before?.ayCode) years.add(r.before.ayCode);
    if (r.after.ayCode) years.add(r.after.ayCode);
  }
  const tiles = await syncTilesForStudent(service, studentNumber, [...years]);
  return {
    invoices: invoices.length,
    payments: payments.length,
    tilesChanged: tiles.changed,
    errors: tiles.errors,
  };
}
