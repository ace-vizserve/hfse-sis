import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  summarizeStageInvoices,
  type StageBilling,
} from '@/lib/billing/stage-card';
import { rowsOfCustomer } from '@/lib/billing/sync-helpers';
import { tileInvoiceState } from '@/lib/billing/tile-line';
import { connectedRealmId } from '@/lib/qbo/client';
import { qboEnv } from '@/lib/qbo/env';
import type { QboStageKey } from '@/lib/qbo/stage-state';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';

// What the Registration and Fees cards need from Billing (spec 2026-10-21
// "Stage card"): the invoices TIED to each stage, summed up — the number, what
// is owed or when it was paid, the invoice to open — read from the Billing
// copy of the student's QuickBooks invoices. Before go-live (no QuickBooks
// keys on this server) it returns null and the cards show only the stage.

export type QboStageData = {
  connected: boolean;
  studentNumber: string | null;
  linked: boolean;
  /** Null when not linked (no invoices are read). */
  registration: StageBilling | null;
  fees: StageBilling | null;
};

type Row = {
  qbo_invoice_id: string;
  doc_number: string | null;
  txn_date: string | null;
  due_date: string | null;
  state: 'open' | 'paid' | 'voided';
  payment_date: string | null;
  total: number;
  balance: number;
  stage_keys: string[] | null;
  qbo_customer_id: string | null;
};

async function tileRows(
  service: SupabaseClient,
  ayCode: string,
  enroleeNumber: string
): Promise<{
  realmId: string | null;
  studentNumber: string | null;
  linked: boolean;
  rows: Row[];
}> {
  const realmId = await connectedRealmId(service);
  const { data: app } = await createAdmissionsClient()
    .from(`ay${ayCode.slice(2)}_enrolment_applications`)
    .select('studentNumber')
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  const studentNumber =
    (app as { studentNumber: string | null } | null)?.studentNumber ?? null;
  if (!realmId || !studentNumber)
    return { realmId, studentNumber, linked: false, rows: [] };
  const { data: link } = await service
    .from('qbo_customers')
    .select('qbo_customer_id')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId)
    .maybeSingle();
  if (!link) return { realmId, studentNumber, linked: false, rows: [] };
  const { data, error } = await service
    .from('qbo_invoices')
    .select(
      'qbo_invoice_id, doc_number, txn_date, due_date, state, payment_date, total, balance, stage_keys, qbo_customer_id'
    )
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId)
    .eq('ay_code', ayCode);
  if (error) throw new Error(`Invoice lookup failed: ${error.message}`);
  return {
    realmId,
    studentNumber,
    linked: true,
    rows: rowsOfCustomer(
      (data ?? []) as Row[],
      (link as { qbo_customer_id: string }).qbo_customer_id
    ),
  };
}

const onTile = (rows: Row[], stage: QboStageKey) =>
  rows
    .filter((r) => (r.stage_keys ?? []).includes(stage))
    .map((r) => ({
      qboInvoiceId: r.qbo_invoice_id,
      docNumber: r.doc_number,
      txnDate: r.txn_date,
      dueDate: r.due_date,
      state: r.state,
      paymentDate: r.payment_date,
      total: Number(r.total),
      balance: Number(r.balance),
    }));

/**
 * The tied invoices of this enrolee's Registration and Fees stages. A read
 * failure never breaks the application page: the cards then show only the
 * stage.
 */
export async function loadStageInvoices(
  ayCode: string,
  enroleeNumber: string
): Promise<QboStageData | null> {
  if (!qboEnv()) return null;
  try {
    const t = await tileRows(createServiceClient(), ayCode, enroleeNumber);
    if (!t.realmId)
      return {
        connected: false,
        studentNumber: t.studentNumber,
        linked: false,
        registration: null,
        fees: null,
      };
    return {
      connected: true,
      studentNumber: t.studentNumber,
      linked: t.linked,
      registration: t.linked
        ? summarizeStageInvoices(onTile(t.rows, 'registration'))
        : null,
      fees: t.linked ? summarizeStageInvoices(onTile(t.rows, 'fees')) : null,
    };
  } catch (e) {
    console.warn('[billing] tile lines unavailable:', e);
    return {
      connected: false,
      studentNumber: null,
      linked: false,
      registration: null,
      fees: null,
    };
  }
}

/**
 * For the stage save route: does QuickBooks own this stage, and are all the
 * invoices on the tile paid? A failed read counts as not connected —
 * admissions is never locked out of a stage by a lookup error.
 */
export async function loadQboStageLock(
  service: SupabaseClient,
  ayCode: string,
  enroleeNumber: string,
  stage: QboStageKey
): Promise<{ connected: boolean; invoiceState: 'open' | 'paid' | null }> {
  const none = { connected: false, invoiceState: null };
  if (!qboEnv()) return none;
  try {
    const t = await tileRows(service, ayCode, enroleeNumber);
    if (!t.realmId) return none;
    return {
      connected: true,
      invoiceState: tileInvoiceState(onTile(t.rows, stage)),
    };
  } catch (e) {
    console.warn('[billing] stage lock unavailable:', e);
    return none;
  }
}
