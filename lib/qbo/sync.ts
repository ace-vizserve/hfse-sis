import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { QboError, qboRequest } from '@/lib/qbo/client';
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
        .catch(() => null)
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
  const { data } = await service
    .from('qbo_invoices')
    .select(
      'id, ay_code, enrolee_number, stage_key, doc_number, state, payment_date, is_current'
    )
    .eq('qbo_invoice_id', qboInvoiceId)
    .maybeSingle();
  const row = data as InvoiceRow | null;
  if (!row) return { known: false, stageChanged: false };

  const inv = await fetchInvoice(service, qboInvoiceId);
  const state = invoiceState(inv);
  const paymentDate =
    inv && state === 'paid' ? await paymentDateFor(service, inv) : null;
  const docNumber = inv?.DocNumber ?? row.doc_number;

  await service
    .from('qbo_invoices')
    .update({
      doc_number: docNumber,
      total: inv ? Number(inv.TotalAmt) : 0,
      balance: inv ? Number(inv.Balance) : 0,
      state,
      payment_date: paymentDate,
      sync_token: inv?.SyncToken ?? null,
      synced_at: new Date().toISOString(),
    })
    .eq('id', row.id);

  const changed =
    row.state !== state ||
    (row.payment_date ?? null) !== (paymentDate ?? null) ||
    (row.doc_number ?? null) !== (docNumber ?? null);
  if (!changed || !row.is_current || !isQboStageKey(row.stage_key)) {
    return { known: true, stageChanged: false };
  }

  const stage = row.stage_key;
  const current = await readStageSnapshot(
    service,
    row.ay_code,
    row.enrolee_number,
    stage
  );
  if (!current) return { known: true, stageChanged: false };
  const patch = stageOnInvoiceChange(stage, current, {
    docNumber: docNumber ?? '',
    state,
    paymentDate,
  });
  if (!patch) return { known: true, stageChanged: false };

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
  return res.ok
    ? { known: true, stageChanged: res.changed > 0 }
    : { known: true, stageChanged: false, stageError: res.error };
}

/** A payment changed: refresh every invoice the SIS knows that it pays. */
export async function refreshInvoicesForPayment(
  service: SupabaseClient,
  paymentId: string
): Promise<number> {
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
    if (e instanceof QboError && e.code === '610') return 0;
    throw e;
  }
  const ids = new Set<string>();
  for (const l of payment?.Line ?? []) {
    for (const t of l.LinkedTxn ?? [])
      if (t.TxnType === 'Invoice') ids.add(t.TxnId);
  }
  let n = 0;
  for (const id of ids) if ((await refreshInvoice(service, id)).known) n++;
  return n;
}
