import 'server-only';

import { qboEnv, qboInvoiceUrl } from '@/lib/qbo/env';
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

/** The current QuickBooks invoice on each of this enrolee's two money stages. */
export async function loadStageInvoices(
  ayCode: string,
  enroleeNumber: string
): Promise<QboStageData> {
  const empty: QboStageData = {
    connected: false,
    registration: null,
    fees: null,
  };
  if (!qboEnv()) return empty;
  const service = createServiceClient();
  const [conn, rows] = await Promise.all([
    service
      .from('qbo_connection')
      .select('environment')
      .eq('id', 1)
      .maybeSingle(),
    service
      .from('qbo_invoices')
      .select(
        'stage_key, qbo_invoice_id, doc_number, total, balance, state, payment_date, synced_at'
      )
      .eq('ay_code', ayCode)
      .eq('enrolee_number', enroleeNumber)
      .eq('is_current', true),
  ]);
  const environment =
    (conn.data?.environment as 'sandbox' | 'production' | undefined) ?? null;
  const out: QboStageData = {
    connected: !!environment,
    registration: null,
    fees: null,
  };
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
