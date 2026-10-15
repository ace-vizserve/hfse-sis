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
import { missingIds } from '@/lib/billing/sync-helpers';
import { syncTilesForStudent } from '@/lib/billing/tiles.server';
import { fetchAllPages } from '@/lib/supabase/paginate';
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
  const customerId = link.qbo_customer_id as string;
  const cust = `CustomerRef = '${qbEscape(customerId)}'`;
  const [invoices, payments, maps] = await Promise.all([
    qboQueryAll<QbInvoiceFull>(service, 'Invoice', cust),
    qboQueryAll<QbPayment>(service, 'Payment', cust),
    preloaded?.maps ?? loadBillingMaps(service),
  ]);
  const years = new Set<string>();

  // What the SIS stored for this customer that QuickBooks no longer returned
  // was deleted there: an invoice is kept and marked voided (so its tile
  // resets), a payment is removed.
  const [storedInvoices, storedPayments] = await Promise.all([
    fetchAllPages<{
      id: string;
      qbo_invoice_id: string;
      ay_code: string | null;
    }>(
      (from, to) =>
        service
          .from('qbo_invoices')
          .select('id, qbo_invoice_id, ay_code')
          .eq('qbo_customer_id', customerId)
          .eq('realm_id', realmId)
          .range(from, to) as unknown as PromiseLike<{
          data: Array<{
            id: string;
            qbo_invoice_id: string;
            ay_code: string | null;
          }> | null;
          error: { message: string } | null;
        }>,
      1000,
      { tieBreak: 'id' }
    ),
    fetchAllPages<{ qbo_payment_id: string }>(
      (from, to) =>
        service
          .from('qbo_payments')
          .select('qbo_payment_id')
          .eq('qbo_customer_id', customerId)
          .eq('realm_id', realmId)
          .range(from, to) as unknown as PromiseLike<{
          data: Array<{ qbo_payment_id: string }> | null;
          error: { message: string } | null;
        }>,
      1000,
      { tieBreak: 'qbo_payment_id' }
    ),
  ]);
  const goneInvoices = new Set(
    missingIds(
      storedInvoices.map((r) => r.qbo_invoice_id),
      invoices.map((i) => i.Id)
    )
  );
  const goneRows = storedInvoices.filter((r) =>
    goneInvoices.has(r.qbo_invoice_id)
  );
  for (let i = 0; i < goneRows.length; i += 200) {
    const up = await service
      .from('qbo_invoices')
      .update({
        state: 'voided',
        balance: 0,
        synced_at: new Date().toISOString(),
      })
      .in(
        'id',
        goneRows.slice(i, i + 200).map((r) => r.id)
      );
    if (up.error) throw new Error(`Invoice update failed: ${up.error.message}`);
  }
  for (const r of goneRows) if (r.ay_code) years.add(r.ay_code);
  const gonePayments = missingIds(
    storedPayments.map((r) => r.qbo_payment_id),
    payments.map((p) => p.Id)
  );
  for (let i = 0; i < gonePayments.length; i += 200) {
    const del = await service
      .from('qbo_payments')
      .delete()
      .eq('realm_id', realmId)
      .in('qbo_payment_id', gonePayments.slice(i, i + 200));
    if (del.error)
      throw new Error(`Deleting stored payment failed: ${del.error.message}`);
  }

  for (const p of payments)
    await upsertPayment(service, { p, studentNumber, realmId });
  const paymentDates = latestPaymentDates(
    payments.map((p) => ({
      txnDate: p.TxnDate ?? null,
      applied: paymentApplied(p),
    }))
  );
  // Students these invoices belonged to before (their customer was relinked)
  // → the years to recompute for them.
  const previous = new Map<string, Set<string>>();
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
    if (r.previousStudent && r.before?.ayCode) {
      const s = previous.get(r.previousStudent) ?? new Set<string>();
      s.add(r.before.ayCode);
      previous.set(r.previousStudent, s);
    }
  }
  const tiles = await syncTilesForStudent(service, studentNumber, [...years], {
    realmId,
  });
  let tilesChanged = tiles.changed;
  const errors = [...tiles.errors];
  for (const [sn, ys] of previous) {
    const t = await syncTilesForStudent(service, sn, [...ys], { realmId });
    tilesChanged += t.changed;
    errors.push(...t.errors.map((e) => `${sn}: ${e}`));
  }
  // Finished: mark it, so the bulk link run does not load it again. A load
  // that stopped part-way (or had tile problems) is left unmarked and resumed.
  if (errors.length === 0) {
    const mark = await service
      .from('qbo_customers')
      .update({ history_loaded_at: new Date().toISOString() })
      .eq('student_number', studentNumber)
      .eq('realm_id', realmId);
    if (mark.error)
      throw new Error(
        `Saving the history marker failed: ${mark.error.message}`
      );
  }
  return {
    invoices: invoices.length,
    payments: payments.length,
    tilesChanged,
    errors,
  };
}
