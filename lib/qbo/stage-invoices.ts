import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { connectedRealmId } from '@/lib/qbo/client';
import { qboEnv, qboInvoiceUrl } from '@/lib/qbo/env';
import type { InvoiceState, QboStageKey } from '@/lib/qbo/stage-state';
import { createServiceClient } from '@/lib/supabase/service';

export type StageInvoiceView = {
  qboInvoiceId: string;
  docNumber: string | null;
  total: number;
  balance: number;
  state: 'open' | 'paid' | 'voided';
  paymentDate: string | null;
  syncedAt: string;
  qbUrl: string;
};

export type QboStageData = {
  connected: boolean;
  registration: StageInvoiceView | null;
  fees: StageInvoiceView | null;
};

/**
 * The current QuickBooks invoice on each of this enrolee's two money stages.
 * `null` before go-live (no QuickBooks app keys on this server): the tiles
 * then show nothing at all about QuickBooks.
 */
export async function loadStageInvoices(
  ayCode: string,
  enroleeNumber: string
): Promise<QboStageData | null> {
  if (!qboEnv()) return null;
  const empty: QboStageData = {
    connected: false,
    registration: null,
    fees: null,
  };
  try {
    return await load(ayCode, enroleeNumber);
  } catch (e) {
    console.warn('[qbo] stage invoices unavailable:', e);
    return empty;
  }
}

/**
 * For the stage save route: does QuickBooks own this stage right now, and what
 * does it say about the stage's current invoice? A failed read counts as not
 * connected — admissions is never locked out of a stage by a lookup error.
 */
export async function loadQboStageLock(
  service: SupabaseClient,
  ayCode: string,
  enroleeNumber: string,
  stage: QboStageKey
): Promise<{ connected: boolean; invoiceState: InvoiceState | null }> {
  const none = { connected: false, invoiceState: null };
  if (!qboEnv()) return none;
  try {
    const realmId = await connectedRealmId(service);
    if (!realmId) return none;
    const { data, error } = await service
      .from('qbo_invoices')
      .select('state')
      .eq('ay_code', ayCode)
      .eq('enrolee_number', enroleeNumber)
      .eq('stage_key', stage)
      .eq('realm_id', realmId)
      .eq('is_current', true)
      .maybeSingle();
    if (error) console.warn('[qbo] stage lock invoice read failed:', error);
    return {
      connected: true,
      invoiceState: (data?.state as InvoiceState | undefined) ?? null,
    };
  } catch (e) {
    console.warn('[qbo] stage lock unavailable:', e);
    return none;
  }
}

async function load(
  ayCode: string,
  enroleeNumber: string
): Promise<QboStageData> {
  const service = createServiceClient();
  const conn = await service
    .from('qbo_connection')
    .select('environment, realm_id')
    .eq('id', 1)
    .maybeSingle();
  if (conn.error) console.warn('[qbo] connection read failed:', conn.error);
  const environment =
    (conn.data?.environment as 'sandbox' | 'production' | undefined) ?? null;
  const realmId = (conn.data?.realm_id as string | undefined) ?? null;
  const out: QboStageData = {
    connected: !!environment,
    registration: null,
    fees: null,
  };
  // Only invoices from the QuickBooks company connected now.
  if (!realmId) return out;
  const rows = await service
    .from('qbo_invoices')
    .select(
      'stage_key, qbo_invoice_id, doc_number, total, balance, state, payment_date, synced_at'
    )
    .eq('ay_code', ayCode)
    .eq('enrolee_number', enroleeNumber)
    .eq('realm_id', realmId)
    .eq('is_current', true);
  if (rows.error) console.warn('[qbo] invoice read failed:', rows.error);
  for (const r of rows.data ?? []) {
    const view: StageInvoiceView = {
      qboInvoiceId: r.qbo_invoice_id,
      docNumber: r.doc_number,
      total: Number(r.total),
      balance: Number(r.balance),
      state: r.state,
      paymentDate: r.payment_date,
      syncedAt: r.synced_at,
      qbUrl: qboInvoiceUrl(environment ?? 'sandbox', r.qbo_invoice_id),
    };
    if (r.stage_key === 'registration') out.registration = view;
    if (r.stage_key === 'fees') out.fees = view;
  }
  return out;
}
