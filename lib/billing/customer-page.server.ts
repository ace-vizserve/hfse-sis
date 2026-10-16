import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { InvoiceLine } from '@/lib/billing/classify';
import { pickBalances, type Balances } from '@/lib/billing/balances';
import { loadCustomerHistory } from '@/lib/billing/history.server';
import {
  readAging,
  readCustomerProfile,
  type CustomerProfile,
} from '@/lib/billing/live.server';
import type { CreditSource, OpenInvoice } from '@/lib/billing/payment-plan';
import { STAGE_NOT_UPDATED } from '@/lib/billing/messages';
import { loadBillingMaps } from '@/lib/billing/settings.server';
import {
  loadStudentInfo,
  type StudentInfo,
} from '@/lib/billing/students.server';
import {
  createdByLabel,
  invoiceStatus,
  itemsSummary,
  mapsToData,
  round2,
  tileTag,
  todaySg,
  type InvoiceStatus,
  type MapsData,
} from '@/lib/billing/view';
import { connectedRealmId, qboReasonOnly } from '@/lib/qbo/client';
import { readStageSnapshot } from '@/lib/qbo/stage-write';

export type InvoiceRowView = {
  id: string;
  docNumber: string | null;
  txnDate: string | null;
  dueDate: string | null;
  total: number;
  balance: number;
  state: 'open' | 'paid' | 'voided';
  status: InvoiceStatus;
  items: string;
  itemNames: string[];
  tile: string | null;
  ayCode: string | null;
  stageKeys: string[];
  memo: string | null;
  createdBy: string;
};

export type PaymentRowView = {
  id: string;
  txnDate: string | null;
  account: string;
  reference: string | null;
  total: number;
  unapplied: number;
  appliedTo: Array<{
    invoiceId: string;
    docNumber: string | null;
    amount: number;
  }>;
  recordedBy: string;
};

export type CustomerPage = {
  studentNumber: string;
  student: StudentInfo | null;
  connected: boolean;
  environment: 'sandbox' | 'production' | null;
  link: { customerId: string; displayName: string } | null;
  /** The read from QuickBooks this page just made failed (shows stored data). */
  refreshError: string | null;
  /** The read worked but a Registration / Fees stage couldn't be updated. */
  stageWarning: string | null;
  profile: CustomerProfile | null;
  balances: Balances;
  invoices: InvoiceRowView[];
  payments: PaymentRowView[];
  openInvoices: Array<OpenInvoice & { items: string }>;
  credits: Array<CreditSource & { reference: string | null }>;
  depositAccounts: Array<{ id: string; label: string }>;
  maps: MapsData;
  stages: {
    ayCode: string;
    registration: string | null;
    fees: string | null;
  } | null;
  overdueOldest: { docNumber: string | null; dueDate: string | null } | null;
};

const zero: Balances = {
  owedOnInvoices: 0,
  openBalance: 0,
  overdue: 0,
  credit: 0,
  source: 'stored',
};

/** The `qbo_invoices` columns the Billing pages read. */
export const INVOICE_COLS =
  'qbo_invoice_id, doc_number, txn_date, due_date, total, balance, state, lines, memo, ay_code, stage_keys, source, created_by_email';
export type InvRow = {
  qbo_invoice_id: string;
  doc_number: string | null;
  txn_date: string | null;
  due_date: string | null;
  total: number;
  balance: number;
  state: 'open' | 'paid' | 'voided';
  lines: InvoiceLine[] | null;
  memo: string | null;
  ay_code: string | null;
  stage_keys: string[] | null;
  source: string | null;
  created_by_email: string | null;
};

export function toInvoiceRow(r: InvRow, today: string): InvoiceRowView {
  const lines = r.lines ?? [];
  const total = Number(r.total);
  const balance = Number(r.balance);
  return {
    id: r.qbo_invoice_id,
    docNumber: r.doc_number,
    txnDate: r.txn_date,
    dueDate: r.due_date,
    total,
    balance,
    state: r.state,
    status: invoiceStatus(
      { state: r.state, total, balance, dueDate: r.due_date },
      today
    ),
    items: itemsSummary(lines),
    itemNames: [
      ...new Set(lines.map((l) => l.itemName).filter((n): n is string => !!n)),
    ],
    tile: tileTag(r.stage_keys ?? [], r.ay_code),
    ayCode: r.ay_code,
    stageKeys: r.stage_keys ?? [],
    memo: r.memo,
    createdBy: createdByLabel({
      source: r.source,
      createdByEmail: r.created_by_email,
      memo: r.memo,
    }),
  };
}

/** The `qbo_payments` columns the Billing pages read. */
export const PAYMENT_COLS =
  'qbo_payment_id, txn_date, total, unapplied, deposit_account_id, deposit_account_name, reference, applied, created_by_email';
export type PayRow = {
  qbo_payment_id: string;
  txn_date: string | null;
  total: number;
  unapplied: number;
  deposit_account_id: string | null;
  deposit_account_name: string | null;
  reference: string | null;
  applied: Array<{ invoiceId: string; amount: number }> | null;
  created_by_email: string | null;
};

export function toPaymentRow(
  p: PayRow,
  docOf: Map<string, string | null>,
  accountLabel: Map<string, string>
): PaymentRowView {
  return {
    id: p.qbo_payment_id,
    txnDate: p.txn_date,
    account:
      (p.deposit_account_id && accountLabel.get(p.deposit_account_id)) ||
      p.deposit_account_name ||
      'Other account',
    reference: p.reference,
    total: Number(p.total),
    unapplied: Number(p.unapplied ?? 0),
    appliedTo: (p.applied ?? []).map((a) => ({
      invoiceId: a.invoiceId,
      docNumber: docOf.get(a.invoiceId) ?? null,
      amount: Number(a.amount),
    })),
    recordedBy: p.created_by_email ?? 'QuickBooks',
  };
}

/** Payments with unused credit, as Record payment / Use credit take them. */
export function toCreditSources(
  payments: PaymentRowView[]
): Array<CreditSource & { reference: string | null }> {
  return payments
    .filter((p) => p.unapplied > 0)
    .map((p) => ({
      paymentId: p.id,
      txnDate: p.txnDate,
      unapplied: p.unapplied,
      reference: p.reference,
    }));
}

/** The `billing_deposit_accounts` rows as the payment sheet's choices. */
export function toDepositAccounts(
  rows: unknown[] | null | undefined
): Array<{ id: string; label: string }> {
  return ((rows ?? []) as Array<{ qbo_account_id: string; label: string }>).map(
    (d) => ({ id: d.qbo_account_id, label: d.label })
  );
}

export async function loadCustomerPage(
  service: SupabaseClient,
  studentNumber: string
): Promise<CustomerPage | null> {
  const student =
    (await loadStudentInfo(service, [studentNumber])).get(studentNumber) ??
    null;
  const realmId = await connectedRealmId(service).catch(() => null);
  const { data: conn } = await service
    .from('qbo_connection')
    .select('environment')
    .eq('id', 1)
    .maybeSingle();
  const base: CustomerPage = {
    studentNumber,
    student,
    connected: !!realmId,
    environment: (conn?.environment as CustomerPage['environment']) ?? null,
    link: null,
    refreshError: null,
    stageWarning: null,
    profile: null,
    balances: zero,
    invoices: [],
    payments: [],
    openInvoices: [],
    credits: [],
    depositAccounts: [],
    maps: { accounts: [], items: [], ranges: [] },
    stages: null,
    overdueOldest: null,
  };
  if (!realmId) return student ? base : null;
  const { data: link } = await service
    .from('qbo_customers')
    .select('qbo_customer_id, display_name')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId)
    .maybeSingle();
  if (!link) return student ? base : null;
  const customerId = link.qbo_customer_id as string;

  // Every open of this page reads the customer from QuickBooks first (Mr Ace,
  // 2026-10-16), so the page is QuickBooks' data at this moment. A failed
  // read never breaks the page: it shows the stored copy and says so.
  // `refreshError` is only a failed read (QuickBooks unreachable); a tile
  // write problem is a separate, fixed `stageWarning` (raw text logged).
  const [refresh, live] = await Promise.all([
    loadCustomerHistory(service, studentNumber).then(
      (r) => {
        if (r.tileProblem)
          console.error('[billing] customer page, tiles:', r.errors);
        return {
          error: null as string | null,
          stageWarning: r.tileProblem ? STAGE_NOT_UPDATED : null,
        };
      },
      (e) => {
        console.error('[billing] customer page, QuickBooks read:', e);
        // A page load saves nothing, so the reason only (no "Nothing was saved").
        return {
          error: `${qboReasonOnly(e).replace(/\.$/, '')}.`,
          stageWarning: null,
        };
      }
    ),
    Promise.all([
      readCustomerProfile(service, customerId),
      readAging(service, { customerId }),
    ])
      .then(([profile, aging]) => ({
        profile,
        agingRow:
          aging.find((a) => a.customerId === customerId) ??
          aging.find(
            (a) => a.name.toUpperCase() === profile.displayName.toUpperCase()
          ) ??
          null,
      }))
      .catch(() => null),
  ]);

  const [inv, pay, dep, maps] = await Promise.all([
    service
      .from('qbo_invoices')
      .select(INVOICE_COLS)
      .eq('student_number', studentNumber)
      .eq('qbo_customer_id', customerId)
      .eq('realm_id', realmId)
      .order('txn_date', { ascending: false }),
    service
      .from('qbo_payments')
      .select(PAYMENT_COLS)
      .eq('student_number', studentNumber)
      .eq('qbo_customer_id', customerId)
      .eq('realm_id', realmId)
      .order('txn_date', { ascending: false }),
    service
      .from('billing_deposit_accounts')
      .select('qbo_account_id, label, sort')
      .order('sort'),
    loadBillingMaps(service),
  ]);
  for (const r of [inv, pay, dep])
    if (r.error) throw new Error(`Billing lookup failed: ${r.error.message}`);

  const today = todaySg();
  const invoices: InvoiceRowView[] = ((inv.data ?? []) as InvRow[]).map((r) =>
    toInvoiceRow(r, today)
  );
  const docOf = new Map(invoices.map((i) => [i.id, i.docNumber]));
  const label = new Map(
    ((dep.data ?? []) as Array<{ qbo_account_id: string; label: string }>).map(
      (d) => [d.qbo_account_id, d.label]
    )
  );
  const payments: PaymentRowView[] = ((pay.data ?? []) as PayRow[]).map((p) =>
    toPaymentRow(p, docOf, label)
  );

  const live_ = invoices.filter((i) => i.state !== 'voided' && i.balance > 0);
  const overdueRows = live_.filter((i) => i.status === 'overdue');
  const stored = {
    owed: live_.reduce((s, i) => s + i.balance, 0),
    overdue: overdueRows.reduce((s, i) => s + i.balance, 0),
    credit: payments.reduce((s, p) => s + p.unapplied, 0),
  };
  const oldest = [...overdueRows].sort((a, b) =>
    (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
  )[0];

  let stages: CustomerPage['stages'] = null;
  if (student?.enroleeNumber) {
    const [reg, fees] = await Promise.all(
      (['registration', 'fees'] as const).map((s) =>
        readStageSnapshot(
          service,
          student.ayCode,
          student.enroleeNumber,
          s
        ).catch(() => null)
      )
    );
    stages = {
      ayCode: student.ayCode,
      registration: reg?.status ?? null,
      fees: fees?.status ?? null,
    };
  }

  return {
    ...base,
    link: { customerId, displayName: link.display_name as string },
    refreshError: refresh.error,
    stageWarning: refresh.stageWarning,
    profile: live?.profile ?? null,
    balances: pickBalances({
      stored,
      live: live
        ? { balance: live.profile.balance, agingRow: live.agingRow }
        : null,
    }),
    invoices,
    payments,
    openInvoices: live_.map((i) => ({
      id: i.id,
      docNumber: i.docNumber,
      txnDate: i.txnDate,
      balance: round2(i.balance),
      items: i.items,
    })),
    credits: toCreditSources(payments),
    depositAccounts: toDepositAccounts(dep.data),
    maps: mapsToData(maps),
    stages,
    overdueOldest: oldest
      ? { docNumber: oldest.docNumber, dueDate: oldest.dueDate }
      : null,
  };
}
