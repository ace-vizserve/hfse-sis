import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { rowsOfCustomer } from '@/lib/billing/sync-helpers';
import {
  tileInvoiceState,
  tileLine,
  type TileLine,
} from '@/lib/billing/tile-line';
import { connectedRealmId } from '@/lib/qbo/client';
import { qboEnv } from '@/lib/qbo/env';
import type { QboStageKey } from '@/lib/qbo/stage-state';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';

// What the Registration and Fees tiles show now that Billing owns invoicing
// (Phase 5, spec "Screens"): one read-only line each, read from the Billing
// copy of the student's QuickBooks invoices, and a link to Billing. Before
// go-live (no QuickBooks keys on this server) it returns null and the tiles
// show nothing about QuickBooks.

export type QboStageData = {
  connected: boolean;
  studentNumber: string | null;
  linked: boolean;
  registration: TileLine | null;
  fees: TileLine | null;
};

/** Legacy shape, kept only until the old invoice strip is deleted (Task 5.2). */
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

type Row = {
  doc_number: string | null;
  txn_date: string | null;
  state: 'open' | 'paid' | 'voided';
  payment_date: string | null;
  balance: number;
  stage_keys: string[] | null;
  qbo_customer_id: string | null;
};

type Current = Record<
  QboStageKey,
  { status: string | null; startDate: string | null }
>;

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
      'doc_number, txn_date, state, payment_date, balance, stage_keys, qbo_customer_id'
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
      docNumber: r.doc_number,
      txnDate: r.txn_date,
      state: r.state,
      paymentDate: r.payment_date,
      balance: Number(r.balance),
    }));

/**
 * The read-only lines for this enrolee's Registration and Fees tiles. A read
 * failure never breaks the application page: the tiles then show no line.
 */
export async function loadStageInvoices(
  ayCode: string,
  enroleeNumber: string,
  current?: Current
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
    // Without the stage's own status and start date (the application page
    // doesn't pass them), report a paid tile as plainly paid;
    // BillingTileLine adds "add the start date" from the tile itself.
    const cur: Current = current ?? {
      registration: { status: 'Paid', startDate: 'known' },
      fees: { status: 'Paid', startDate: 'known' },
    };
    return {
      connected: true,
      studentNumber: t.studentNumber,
      linked: t.linked,
      registration: t.linked
        ? tileLine(
            'registration',
            onTile(t.rows, 'registration'),
            cur.registration
          )
        : null,
      fees: t.linked
        ? tileLine('fees', onTile(t.rows, 'fees'), cur.fees)
        : null,
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
