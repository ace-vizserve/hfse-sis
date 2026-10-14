import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  QboError,
  connectedRealmId,
  qboErrorMessage,
  qboRequest,
} from '@/lib/qbo/client';
import {
  invoiceState,
  latestDate,
  linkedPaymentIds,
  type QbInvoice,
} from '@/lib/qbo/invoice-snapshot';
import {
  QBO_SYNC_LABEL,
  QBO_SYSTEM_ACTOR,
  readStageSnapshot,
  writeStageFromQbo,
} from '@/lib/qbo/stage-write';
import { handledFields } from '@/lib/qbo/sync-fields';
import { isQboStageKey, stageOnInvoiceChange } from '@/lib/qbo/stage-state';

type InvoiceRow = {
  id: string;
  ay_code: string;
  enrolee_number: string;
  stage_key: string;
  doc_number: string | null;
  state: string;
  payment_date: string | null;
  is_current: boolean;
  total: number;
  balance: number;
};

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
 * Re-reads one invoice from QuickBooks, stores what it says, and — when it is
 * the stage's current invoice and its state or payment date changed — moves
 * the stage. Invoices the SIS doesn't know are ignored.
 */
export async function refreshInvoice(
  service: SupabaseClient,
  qboInvoiceId: string
): Promise<{ known: boolean; stageChanged: boolean; stageError?: string }> {
  // Only rows from the QuickBooks company connected now: an id means nothing
  // in another company.
  const realmId = await connectedRealmId(service);
  if (!realmId) return { known: false, stageChanged: false };
  const { data, error: lookupErr } = await service
    .from('qbo_invoices')
    .select(
      'id, ay_code, enrolee_number, stage_key, doc_number, state, payment_date, is_current, total, balance'
    )
    .eq('qbo_invoice_id', qboInvoiceId)
    .eq('realm_id', realmId)
    .maybeSingle();
  if (lookupErr)
    throw new Error(
      'QuickBooks invoice record lookup failed: ' + lookupErr.message
    );
  const row = data as InvoiceRow | null;
  if (!row) return { known: false, stageChanged: false };

  const inv = await fetchInvoice(service, qboInvoiceId);
  const state = invoiceState(inv);
  const paymentDate =
    inv && state === 'paid' ? await paymentDateFor(service, inv) : null;
  const docNumber = inv?.DocNumber ?? row.doc_number;

  // Money and housekeeping are saved straight away. A deleted invoice keeps
  // its last known total and balance.
  const { error: moneyErr } = await service
    .from('qbo_invoices')
    .update({
      total: inv ? Number(inv.TotalAmt) : row.total,
      balance: inv ? Number(inv.Balance) : row.balance,
      sync_token: inv?.SyncToken ?? null,
      synced_at: new Date().toISOString(),
    })
    .eq('id', row.id);
  if (moneyErr)
    throw new Error(
      'QuickBooks invoice record update failed: ' + moneyErr.message
    );

  // State / payment date / number are saved only once the stage is in step, so
  // a failed stage write shows up as a change again on the next refresh.
  const saveHandled = async (stageInStep: boolean) => {
    const fields = handledFields({
      state,
      paymentDate,
      docNumber,
      stageInStep,
    });
    if (Object.keys(fields).length === 0) return;
    const { error } = await service
      .from('qbo_invoices')
      .update(fields)
      .eq('id', row.id);
    if (error)
      throw new Error(
        'QuickBooks invoice record update failed: ' + error.message
      );
  };

  const changed =
    row.state !== state ||
    (row.payment_date ?? null) !== (paymentDate ?? null) ||
    (row.doc_number ?? null) !== (docNumber ?? null);
  if (!changed || !row.is_current || !isQboStageKey(row.stage_key)) {
    await saveHandled(true);
    return { known: true, stageChanged: false };
  }

  const stage = row.stage_key;
  const current = await readStageSnapshot(
    service,
    row.ay_code,
    row.enrolee_number,
    stage
  );
  if (!current) {
    await saveHandled(true);
    return { known: true, stageChanged: false };
  }
  const patch = stageOnInvoiceChange(stage, current, {
    docNumber: docNumber ?? '',
    state,
    paymentDate,
  });
  if (!patch) {
    await saveHandled(true);
    return { known: true, stageChanged: false };
  }

  const res = await writeStageFromQbo(service, {
    ayCode: row.ay_code,
    enroleeNumber: row.enrolee_number,
    stage,
    patch,
    actor: QBO_SYSTEM_ACTOR,
    updatedBy: QBO_SYNC_LABEL,
    docNumber,
    trigger: 'sync',
  });
  await saveHandled(res.ok);
  return res.ok
    ? { known: true, stageChanged: res.changed > 0 }
    : { known: true, stageChanged: false, stageError: res.error };
}

/**
 * A payment changed: refresh every invoice the SIS knows that it pays. One
 * failing invoice is recorded in `errors` and the rest still run.
 */
export async function refreshInvoicesForPayment(
  service: SupabaseClient,
  paymentId: string
): Promise<{ updated: number; errors: string[] }> {
  type QbPayment = {
    Line?: Array<{ LinkedTxn?: Array<{ TxnId: string; TxnType: string }> }>;
  };
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
    // A deleted payment can't be read; its invoices change too and arrive as
    // Invoice events / in the hourly check.
    if (e instanceof QboError && e.code === '610')
      return { updated: 0, errors: [] };
    throw e;
  }
  const ids = new Set<string>();
  for (const l of payment?.Line ?? []) {
    for (const t of l.LinkedTxn ?? [])
      if (t.TxnType === 'Invoice') ids.add(t.TxnId);
  }
  let updated = 0;
  const errors: string[] = [];
  for (const id of ids) {
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
