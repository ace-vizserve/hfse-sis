import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { BillingMaps } from '@/lib/billing/tie';
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

/** What the caller already knows, so a refresh can skip QuickBooks calls. */
export type RefreshHint = {
  /** The QuickBooks customer of the changed invoice / payment, when known. */
  customerId?: string;
  /** The typed-number ties' data for EVERY student, loaded once per run. */
  maps?: BillingMaps;
};

/** True when a stored row with this id exists in the given table. */
async function storedRowExists(
  service: SupabaseClient,
  table: 'qbo_invoices' | 'qbo_payments',
  idColumn: 'qbo_invoice_id' | 'qbo_payment_id',
  id: string,
  realmId: string
): Promise<boolean> {
  const { data, error } = await service
    .from(table)
    .select(idColumn)
    .eq(idColumn, id)
    .eq('realm_id', realmId)
    .limit(1);
  if (error) throw new Error(`Stored record lookup failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Re-reads one invoice from QuickBooks into the Billing store and recomputes
 * the student's tiles for the year(s) it was and is on. Invoices of customers
 * not linked to a student are ignored (linking loads their history). With a
 * customer hint for an unlinked customer whose invoice the SIS never stored,
 * QuickBooks is not asked at all.
 */
export async function refreshInvoice(
  service: SupabaseClient,
  qboInvoiceId: string,
  hint?: RefreshHint
): Promise<{ known: boolean; stageChanged: boolean; stageError?: string }> {
  const { loadBillingMaps } = await import('@/lib/billing/maps.server');
  const { studentForCustomer } = await import('@/lib/billing/history.server');
  const { upsertInvoice } = await import('@/lib/billing/store.server');
  const { syncTilesForStudent } = await import('@/lib/billing/tiles.server');

  const realmId = await connectedRealmId(service);
  if (!realmId) return { known: false, stageChanged: false };
  if (
    hint?.customerId &&
    !(await studentForCustomer(service, hint.customerId, realmId)) &&
    !(await storedRowExists(
      service,
      'qbo_invoices',
      'qbo_invoice_id',
      qboInvoiceId,
      realmId
    ))
  )
    return { known: false, stageChanged: false };
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
    maps:
      hint?.maps ??
      (await loadBillingMaps(service, { studentNumbers: [studentNumber] })),
    paymentDates,
  });
  const years = [r.before?.ayCode, r.after.ayCode].filter(
    (y): y is string => !!y
  );
  const tiles = await syncTilesForStudent(
    service,
    studentNumber,
    [...new Set(years)],
    { realmId }
  );
  const errors = [...tiles.errors];
  let changed = tiles.changed;
  // The invoice moved from another student (their customer was relinked):
  // recompute that student's tiles too, for the year it was on.
  if (r.previousStudent && r.before?.ayCode) {
    const prev = await syncTilesForStudent(
      service,
      r.previousStudent,
      [r.before.ayCode],
      { realmId }
    );
    changed += prev.changed;
    errors.push(...prev.errors.map((e) => `${r.previousStudent}: ${e}`));
  }
  return {
    known: true,
    stageChanged: changed > 0,
    ...(errors.length ? { stageError: errors.join(' · ') } : {}),
  };
}

/**
 * A payment changed: store it, then refresh every invoice it pays.
 * `refreshedIds` lists those invoices, so a caller can skip refreshing them
 * again in the same run. With a customer hint for an unlinked customer whose
 * payment the SIS never stored, QuickBooks is not asked at all.
 */
export async function refreshInvoicesForPayment(
  service: SupabaseClient,
  paymentId: string,
  hint?: RefreshHint
): Promise<{ updated: number; errors: string[]; refreshedIds: string[] }> {
  const { studentForCustomer } = await import('@/lib/billing/history.server');
  const { upsertPayment } = await import('@/lib/billing/store.server');
  const realmId = await connectedRealmId(service);
  if (!realmId) return { updated: 0, errors: [], refreshedIds: [] };
  if (
    hint?.customerId &&
    !(await studentForCustomer(service, hint.customerId, realmId)) &&
    !(await storedRowExists(
      service,
      'qbo_payments',
      'qbo_payment_id',
      paymentId,
      realmId
    ))
  )
    return { updated: 0, errors: [], refreshedIds: [] };
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
      return { updated: 0, errors: [], refreshedIds: [] };
    }
    throw e;
  }
  const studentNumber = await studentForCustomer(
    service,
    payment.CustomerRef.value,
    realmId
  );
  if (!studentNumber) return { updated: 0, errors: [], refreshedIds: [] };
  const ids = await upsertPayment(service, {
    p: payment,
    studentNumber,
    realmId,
  });
  let updated = 0;
  const errors: string[] = [];
  const refreshedIds = [...new Set(ids)];
  for (const id of refreshedIds) {
    try {
      const r = await refreshInvoice(service, id, { maps: hint?.maps });
      if (r.known) updated++;
      if (r.stageError) errors.push(`Invoice ${id}: ${r.stageError}`);
    } catch (e) {
      errors.push(`Invoice ${id}: ${qboErrorMessage(e)}`);
    }
  }
  return { updated, errors, refreshedIds };
}
