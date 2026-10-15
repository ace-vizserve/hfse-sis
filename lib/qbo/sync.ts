import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  latestPaymentDates,
  type QbInvoiceFull,
  type QbPayment,
} from '@/lib/billing/invoice-row';
import {
  QboError,
  connectedRealmId,
  qboErrorMessage,
  qboRequest,
} from '@/lib/qbo/client';
import {
  latestDate,
  linkedPaymentIds,
  type QbInvoice,
} from '@/lib/qbo/invoice-snapshot';

/** Date of the payment that cleared it: the newest linked payment's date. */
export async function paymentDateFor(
  service: SupabaseClient,
  inv: QbInvoice
): Promise<string | null> {
  const dates = await Promise.all(
    linkedPaymentIds(inv).map((id) =>
      qboRequest<{ Payment?: { TxnDate?: string } }>(
        service,
        'GET',
        `/payment/${id}`
      )
        .then((r) => r.Payment?.TxnDate ?? null)
        .catch((e) => {
          // 610 = the payment was deleted: skip it. Anything else must fail
          // loudly so the next refresh retries.
          if (e instanceof QboError && e.code === '610') return null;
          throw e;
        })
    )
  );
  return latestDate(dates);
}

async function fetchInvoice(
  service: SupabaseClient,
  id: string
): Promise<QbInvoice | null> {
  try {
    const r = await qboRequest<{ Invoice: QbInvoice }>(
      service,
      'GET',
      `/invoice/${id}`
    );
    return r.Invoice;
  } catch (e) {
    // 610 = Object Not Found: the invoice was deleted in QuickBooks.
    if (e instanceof QboError && e.code === '610') return null;
    throw e;
  }
}

/**
 * Re-reads one invoice from QuickBooks into the Billing store and recomputes
 * the student's tiles for the year(s) it was and is on. Invoices of customers
 * not linked to a student are ignored (linking loads their history).
 */
export async function refreshInvoice(
  service: SupabaseClient,
  qboInvoiceId: string
): Promise<{ known: boolean; stageChanged: boolean; stageError?: string }> {
  const { loadBillingMaps } = await import('@/lib/billing/settings.server');
  const { studentForCustomer } = await import('@/lib/billing/history.server');
  const { upsertInvoice } = await import('@/lib/billing/store.server');
  const { syncTilesForStudent } = await import('@/lib/billing/tiles.server');

  const realmId = await connectedRealmId(service);
  if (!realmId) return { known: false, stageChanged: false };
  const inv = (await fetchInvoice(
    service,
    qboInvoiceId
  )) as QbInvoiceFull | null;
  let studentNumber: string | null = null;
  if (inv) {
    studentNumber = await studentForCustomer(
      service,
      inv.CustomerRef.value,
      realmId
    );
  } else {
    // Deleted: find the student from the stored row.
    const { data, error: lookupErr } = await service
      .from('qbo_invoices')
      .select('student_number')
      .eq('qbo_invoice_id', qboInvoiceId)
      .eq('realm_id', realmId)
      .maybeSingle();
    if (lookupErr)
      throw new Error(`Stored invoice lookup failed: ${lookupErr.message}`);
    studentNumber =
      (data as { student_number: string } | null)?.student_number ?? null;
  }
  if (!studentNumber) return { known: false, stageChanged: false };

  // Payment dates come from the student's stored payments, so a paid invoice
  // costs no extra QuickBooks calls.
  const { data: paid, error: paidErr } = await service
    .from('qbo_payments')
    .select('txn_date, applied')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId);
  if (paidErr)
    throw new Error(`Stored payments lookup failed: ${paidErr.message}`);
  const paymentDates = latestPaymentDates(
    (
      (paid ?? []) as Array<{
        txn_date: string | null;
        applied: Array<{ invoiceId: string; amount: number }> | null;
      }>
    ).map((p) => ({ txnDate: p.txn_date, applied: p.applied ?? [] }))
  );

  const r = await upsertInvoice(service, {
    inv,
    qboInvoiceId,
    studentNumber,
    realmId,
    maps: await loadBillingMaps(service),
    paymentDates,
  });
  const years = [r.before?.ayCode, r.after.ayCode].filter(
    (y): y is string => !!y
  );
  const tiles = await syncTilesForStudent(service, studentNumber, [
    ...new Set(years),
  ]);
  return {
    known: true,
    stageChanged: tiles.changed > 0,
    ...(tiles.errors.length ? { stageError: tiles.errors.join(' · ') } : {}),
  };
}

/** A payment changed: store it, then refresh every invoice it pays. */
export async function refreshInvoicesForPayment(
  service: SupabaseClient,
  paymentId: string
): Promise<{ updated: number; errors: string[] }> {
  const { studentForCustomer } = await import('@/lib/billing/history.server');
  const { upsertPayment } = await import('@/lib/billing/store.server');
  const realmId = await connectedRealmId(service);
  if (!realmId) return { updated: 0, errors: [] };
  let payment: QbPayment | null = null;
  try {
    payment = (
      await qboRequest<{ Payment: QbPayment }>(
        service,
        'GET',
        `/payment/${paymentId}`
      )
    ).Payment;
  } catch (e) {
    if (e instanceof QboError && e.code === '610') {
      // Deleted: drop our copy; its invoices arrive as Invoice changes.
      const del = await service
        .from('qbo_payments')
        .delete()
        .eq('qbo_payment_id', paymentId)
        .eq('realm_id', realmId);
      if (del.error)
        throw new Error(`Deleting stored payment failed: ${del.error.message}`);
      return { updated: 0, errors: [] };
    }
    throw e;
  }
  const studentNumber = await studentForCustomer(
    service,
    payment.CustomerRef.value,
    realmId
  );
  if (!studentNumber) return { updated: 0, errors: [] };
  const ids = await upsertPayment(service, {
    p: payment,
    studentNumber,
    realmId,
  });
  let updated = 0;
  const errors: string[] = [];
  for (const id of new Set(ids)) {
    try {
      const r = await refreshInvoice(service, id);
      if (r.known) updated++;
      if (r.stageError) errors.push(`Invoice ${id}: ${r.stageError}`);
    } catch (e) {
      errors.push(`Invoice ${id}: ${qboErrorMessage(e)}`);
    }
  }
  return { updated, errors };
}
