import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildInvoiceActivity,
  type ActivityEvent,
} from '@/lib/billing/activity';
import {
  INVOICE_COLS,
  PAYMENT_COLS,
  toCreditSources,
  toInvoiceRow,
  toPaymentRow,
  type InvRow,
  type InvoiceRowView,
  type PayRow,
  type PaymentRowView,
} from '@/lib/billing/customer-page.server';
import {
  loadDepositChoices,
  loadPaymentMethods,
  type DepositChoice,
  type PaymentMethodChoice,
} from '@/lib/billing/deposit-accounts.server';
import { loadCustomerHistory } from '@/lib/billing/history.server';
import {
  addressLines,
  readCustomerProfile,
  readInvoiceDetail,
  type CustomerProfile,
  type InvoiceDetail,
  type QbAddress,
} from '@/lib/billing/live.server';
import type { CreditSource, OpenCreditNote } from '@/lib/billing/payment-plan';
import { toOpenCreditNotes } from '@/lib/billing/sales-docs';
import { loadOpenItems } from '@/lib/billing/sales-docs.server';
import { loadStudentInfo } from '@/lib/billing/students.server';
import { round2, todaySg } from '@/lib/billing/view';
import {
  connectedRealmId,
  qboErrorMessage,
  qboRequest,
} from '@/lib/qbo/client';
import { qboInvoiceUrl, type QboEnvironment } from '@/lib/qbo/env';

/** The company block QuickBooks prints at the head of an invoice. */
export type CompanyBlock = {
  name: string;
  address: string[];
  email: string | null;
  phone: string | null;
};

export type InvoicePage = {
  environment: QboEnvironment;
  company: CompanyBlock | null;
  studentNumber: string;
  studentName: string;
  customerName: string;
  row: InvoiceRowView;
  detail: InvoiceDetail | null;
  detailError: string | null;
  profile: CustomerProfile | null;
  activity: ActivityEvent[];
  /** Payments applied to THIS invoice, with the amount each put on it. */
  payments: Array<PaymentRowView & { onThisInvoice: number }>;
  qbUrl: string;
  credits: Array<CreditSource & { reference: string | null }>;
  /** Credit notes with unused credit (Receive payment's Credits), live. */
  creditNotes: OpenCreditNote[];
  depositAccounts: Array<{ id: string; label: string }>;
  paymentMethods: PaymentMethodChoice[];
  /** QuickBooks' ‹ › on an invoice: this customer's older and newer invoice. */
  older: { id: string; docNumber: string | null } | null;
  newer: { id: string; docNumber: string | null } | null;
};

export async function loadInvoicePage(
  service: SupabaseClient,
  studentNumber: string,
  qboInvoiceId: string
): Promise<InvoicePage | null> {
  const realmId = await connectedRealmId(service).catch(() => null);
  if (!realmId) return null;
  const { data: link } = await service
    .from('qbo_customers')
    .select('qbo_customer_id, display_name')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId)
    .maybeSingle();
  if (!link) return null;

  // Read live, like the customer page: the invoice in full, the customer's
  // contact details, and a refresh of the stored copy for the payments.
  // The third entry is effect-only: it refreshes the stored copy, so its
  // result is not destructured; the payments below are read from the store.
  const [detail, profile, company /* , refreshed (effect only) */] =
    await Promise.all([
      readInvoiceDetail(service, qboInvoiceId).then(
        (d) => ({ d, e: null as string | null }),
        (e) => ({ d: null, e: qboErrorMessage(e) })
      ),
      readCustomerProfile(service, link.qbo_customer_id as string).catch(
        () => null
      ),
      readCompany(service, realmId),
      loadCustomerHistory(service, studentNumber).catch(() => null),
    ]);
  if (detail.d && detail.d.customerId !== link.qbo_customer_id) return null;

  const [inv, pays, sends, dep, conn, info, siblings, methods, openNow] =
    await Promise.all([
      service
        .from('qbo_invoices')
        .select(INVOICE_COLS)
        .eq('qbo_invoice_id', qboInvoiceId)
        .eq('student_number', studentNumber)
        .eq('realm_id', realmId)
        .maybeSingle(),
      service
        .from('qbo_payments')
        .select(PAYMENT_COLS)
        .eq('qbo_customer_id', link.qbo_customer_id)
        .eq('realm_id', realmId),
      service
        .from('audit_log')
        .select('created_at, actor_email, context')
        .eq('action', 'qbo.invoice.send')
        .eq('entity_id', qboInvoiceId)
        .order('created_at', { ascending: true }),
      // Record payment's banks, live; unreadable → no choices, page renders.
      loadDepositChoices(service).catch((e: unknown) => {
        console.error('[billing] invoice page, bank accounts:', e);
        return [] as DepositChoice[];
      }),
      service
        .from('qbo_connection')
        .select('environment')
        .eq('id', 1)
        .maybeSingle(),
      loadStudentInfo(service, [studentNumber]),
      service
        .from('qbo_invoices')
        .select('qbo_invoice_id, doc_number, txn_date')
        .eq('qbo_customer_id', link.qbo_customer_id)
        .eq('realm_id', realmId)
        .order('txn_date', { ascending: true })
        .order('qbo_invoice_id', { ascending: true }),
      // Receive Payment's methods, live; unreadable → no choices (optional).
      loadPaymentMethods(service).catch((e: unknown) => {
        console.error('[billing] invoice page, payment methods:', e);
        return [] as PaymentMethodChoice[];
      }),
      // Credit notes to use on it, live; unreadable → none offered.
      loadOpenItems(service, link.qbo_customer_id as string).catch(
        (e: unknown) => {
          console.error('[billing] invoice page, credit notes:', e);
          return { charges: [], credits: [] };
        }
      ),
    ]);
  if (!inv.data) return null;
  const row = toInvoiceRow(inv.data as InvRow, todaySg());
  const label = new Map(dep.map((d) => [d.id, d.label]));
  const allPayments = ((pays.data ?? []) as PayRow[]).map((p) =>
    toPaymentRow(p, new Map([[row.id, row.docNumber]]), label)
  );
  const payments = allPayments
    .map((p) => ({
      ...p,
      onThisInvoice: round2(
        p.appliedTo
          .filter((a) => a.invoiceId === row.id)
          .reduce((s, a) => s + a.amount, 0)
      ),
    }))
    .filter((p) => p.onThisInvoice > 0);

  const activity = buildInvoiceActivity({
    createdAt: detail.d?.createdAt ?? row.txnDate,
    createdBy: row.createdBy,
    sends: (
      (sends.data ?? []) as Array<{
        created_at: string;
        actor_email: string;
        context: { sent_to?: string | null };
      }>
    ).map((s) => ({
      at: s.created_at,
      to: s.context?.sent_to ?? null,
      by: s.actor_email,
    })),
    qbDelivery: detail.d?.delivery ?? null,
    payments: payments.map((p) => ({
      id: p.id,
      txnDate: p.txnDate,
      account: p.account,
      reference: p.reference,
      amount: p.onThisInvoice,
    })),
    state: detail.d?.state ?? row.state,
    balance: detail.d?.balance ?? row.balance,
    voidedAt:
      (detail.d?.state ?? row.state) === 'voided'
        ? (detail.d?.updatedAt ?? null)
        : null,
  });

  const environment =
    (conn.data?.environment as QboEnvironment | undefined) ?? 'sandbox';
  return {
    environment,
    company,
    studentNumber,
    studentName: info.get(studentNumber)?.name ?? (link.display_name as string),
    customerName: link.display_name as string,
    row,
    detail: detail.d,
    detailError: detail.e,
    profile,
    activity,
    payments,
    qbUrl: qboInvoiceUrl(environment, qboInvoiceId),
    credits: toCreditSources(allPayments),
    creditNotes: toOpenCreditNotes(openNow.credits),
    depositAccounts: dep,
    paymentMethods: methods,
    ...neighbours(
      (siblings.data ?? []) as Array<{
        qbo_invoice_id: string;
        doc_number: string | null;
      }>,
      qboInvoiceId
    ),
  };
}

/** QuickBooks' company name, address, email and phone, read live; null when
 *  QuickBooks can't be read (the invoice still shows). */
async function readCompany(
  service: SupabaseClient,
  realmId: string
): Promise<CompanyBlock | null> {
  try {
    const { CompanyInfo: c } = await qboRequest<{
      CompanyInfo?: {
        CompanyName?: string;
        CompanyAddr?: QbAddress;
        Email?: { Address?: string };
        PrimaryPhone?: { FreeFormNumber?: string };
      };
    }>(service, 'GET', `/companyinfo/${encodeURIComponent(realmId)}`);
    if (!c?.CompanyName) return null;
    return {
      name: c.CompanyName,
      address: addressLines(c.CompanyAddr),
      email: c.Email?.Address?.trim() || null,
      phone: c.PrimaryPhone?.FreeFormNumber?.trim() || null,
    };
  } catch {
    return null;
  }
}

/** The invoices either side of this one, oldest first. */
function neighbours(
  list: Array<{ qbo_invoice_id: string; doc_number: string | null }>,
  id: string
): Pick<InvoicePage, 'older' | 'newer'> {
  const i = list.findIndex((x) => x.qbo_invoice_id === id);
  const at = (k: number) =>
    i >= 0 && list[k]
      ? { id: list[k].qbo_invoice_id, docNumber: list[k].doc_number }
      : null;
  return { older: at(i - 1), newer: at(i + 1) };
}
