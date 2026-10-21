import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { addressLines, type QbAddress } from '@/lib/billing/live.server';
import {
  SALES_DOC_ENTITY,
  type SalesDocKind,
} from '@/lib/billing/sales-doc-body';
import {
  openItemsFromBalanceDetail,
  purchasesFromTransactionList,
  type OpenItem,
  type QbReport,
  type SalesDocRow,
} from '@/lib/billing/sales-docs';
import { round2 } from '@/lib/billing/view';
import {
  connectedRealmId,
  qbEscape,
  qboErrorMessage,
  qboQuery,
  qboQueryAll,
  qboRequest,
} from '@/lib/qbo/client';

type QbSalesDoc = {
  Id: string;
  SyncToken?: string;
  DocNumber?: string;
  TxnDate?: string;
  TotalAmt: number;
  RemainingCredit?: number;
  PrivateNote?: string;
  CustomerMemo?: { value?: string };
  CustomerRef: { value: string; name?: string };
  BillAddr?: QbAddress;
  BillEmail?: { Address?: string };
  PaymentMethodRef?: { value: string; name?: string };
  DepositToAccountRef?: { value: string; name?: string };
  PaymentRefNum?: string;
  TxnTaxDetail?: { TotalTax?: number };
  MetaData?: { CreateTime?: string; LastUpdatedTime?: string };
  Line?: Array<{
    Amount?: number;
    Description?: string;
    DetailType?: string;
    SalesItemLineDetail?: {
      ItemRef?: { value: string; name?: string };
      Qty?: number;
      UnitPrice?: number;
      TaxCodeRef?: { value: string };
    };
  }>;
};

const note = (s: string | undefined) => s?.trim() || null;

/** A customer's refund receipts, credit memos, expenses and checks, and
 *  what is open on them — all read live from QuickBooks. */
export async function loadCustomerDocs(
  service: SupabaseClient,
  customerId: string
): Promise<{
  rows: SalesDocRow[];
  /** Expenses / checks with something still open (Outstanding Transactions). */
  openCharges: OpenItem[];
  /** Credit memos with unused credit (Credits). */
  openCredits: OpenItem[];
}> {
  const cust = `CustomerRef = '${qbEscape(customerId)}'`;
  const c = encodeURIComponent(customerId);
  const [refunds, credits, list, balance] = await Promise.all([
    qboQueryAll<QbSalesDoc>(service, 'RefundReceipt', cust),
    qboQueryAll<QbSalesDoc>(service, 'CreditMemo', cust),
    qboRequest<QbReport>(
      service,
      'GET',
      `/reports/TransactionList?customer=${c}&start_date=1900-01-01&end_date=2099-12-31`
    ),
    qboRequest<QbReport>(
      service,
      'GET',
      `/reports/CustomerBalanceDetail?customer=${c}&report_date=2099-12-31`
    ),
  ]);
  const open = openItemsFromBalanceDetail(balance);
  const openOf = new Map(open.map((o) => [o.id, o.open]));
  const rows: SalesDocRow[] = [
    ...refunds.map((r) => ({
      kind: 'refund' as const,
      id: r.Id,
      docNumber: r.DocNumber ?? null,
      txnDate: r.TxnDate ?? null,
      total: Number(r.TotalAmt),
      open: 0,
      memo: note(r.PrivateNote),
    })),
    ...credits.map((r) => ({
      kind: 'credit' as const,
      id: r.Id,
      docNumber: r.DocNumber ?? null,
      txnDate: r.TxnDate ?? null,
      total: Number(r.TotalAmt),
      open: round2(Number(r.RemainingCredit ?? 0)),
      memo: note(r.PrivateNote),
    })),
    ...purchasesFromTransactionList(list).map((p) => ({
      ...p,
      open: openOf.get(p.id) ?? 0,
    })),
  ];
  const creditOpen = new Map(
    rows.filter((r) => r.kind === 'credit').map((r) => [r.id, r])
  );
  return {
    rows,
    openCharges: open.filter((o) => o.type === 'expense' || o.type === 'check'),
    // RemainingCredit is the credit memo's own figure; the report's row
    // gives its date and number.
    openCredits: [...creditOpen.values()]
      .filter((r) => r.open > 0)
      .map((r) => ({
        type: 'credit' as const,
        id: r.id,
        docNumber: r.docNumber,
        txnDate: r.txnDate,
        dueDate: null,
        amount: r.total,
        open: r.open,
      })),
  };
}

export type SalesDocDetail = {
  kind: SalesDocKind;
  id: string;
  docNumber: string | null;
  txnDate: string | null;
  total: number;
  /** Credit memo: the credit not used yet. */
  remainingCredit: number | null;
  tax: number;
  customerId: string;
  customerName: string | null;
  billEmail: string | null;
  billAddress: string[];
  lines: Array<{
    itemId: string | null;
    itemName: string | null;
    description: string | null;
    qty: number | null;
    rate: number | null;
    amount: number;
    taxCode: string | null;
  }>;
  message: string | null;
  statementMessage: string | null;
  paymentMethod: string | null;
  refundFrom: string | null;
  checkNo: string | null;
  createdAt: string | null;
};

const PSEUDO: Record<string, string> = { TAX: 'Taxable', NON: 'No tax' };

export type SalesDocPage = {
  environment: 'sandbox' | 'production';
  studentNumber: string;
  customerName: string;
  doc: SalesDocDetail | null;
  /** QuickBooks couldn't be read just now (the page says so). */
  error: string | null;
  /** Who made it from the SIS (its audit row), else null — made in QuickBooks. */
  createdBy: string | null;
};

/**
 * A refund receipt or credit memo page: the document read live, only when it
 * belongs to the student's linked customer. null → not found.
 */
export async function loadSalesDocPage(
  service: SupabaseClient,
  studentNumber: string,
  kind: SalesDocKind,
  id: string
): Promise<SalesDocPage | null> {
  const [realmId, conn] = await Promise.all([
    connectedRealmId(service).catch(() => null),
    service
      .from('qbo_connection')
      .select('environment')
      .eq('id', 1)
      .maybeSingle(),
  ]);
  if (!realmId) return null;
  const { data: link } = await service
    .from('qbo_customers')
    .select('qbo_customer_id, display_name')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId)
    .maybeSingle();
  if (!link) return null;
  const [doc, audit] = await Promise.all([
    readSalesDoc(service, kind, id).then(
      (d) => ({ d, e: null as string | null }),
      (e) => ({ d: null, e: qboErrorMessage(e) })
    ),
    service
      .from('audit_log')
      .select('actor_email')
      .eq(
        'entity_type',
        kind === 'refund_receipt' ? 'qbo_refund_receipt' : 'qbo_credit_memo'
      )
      .eq('entity_id', id)
      .limit(1)
      .maybeSingle(),
  ]);
  if (doc.d && doc.d.customerId !== link.qbo_customer_id) return null;
  return {
    environment:
      (conn.data?.environment as 'sandbox' | 'production' | undefined) ??
      'sandbox',
    studentNumber,
    customerName: link.display_name as string,
    doc: doc.d,
    error: doc.e,
    createdBy: (audit.data?.actor_email as string | undefined) ?? null,
  };
}

/** One refund receipt or credit memo, read live. */
export async function readSalesDoc(
  service: SupabaseClient,
  kind: SalesDocKind,
  id: string
): Promise<SalesDocDetail> {
  const entity = SALES_DOC_ENTITY[kind];
  const res = await qboRequest<Record<string, QbSalesDoc>>(
    service,
    'GET',
    `/${entity.toLowerCase()}/${encodeURIComponent(id)}`
  );
  const d = res[entity];
  const sales = (d.Line ?? []).filter(
    (l) => l.DetailType === 'SalesItemLineDetail'
  );
  const codeIds = [
    ...new Set(
      sales
        .map((l) => l.SalesItemLineDetail?.TaxCodeRef?.value)
        .filter((v): v is string => !!v && !(v in PSEUDO))
    ),
  ];
  const codeNames = new Map<string, string>();
  if (codeIds.length) {
    try {
      for (const c of await qboQuery<{ Id: string; Name: string }>(
        service,
        'TaxCode',
        `Id IN (${codeIds.map((i) => `'${qbEscape(i)}'`).join(', ')})`
      ))
        codeNames.set(c.Id, c.Name);
    } catch {
      // Shown by id; the document still reads.
    }
  }
  return {
    kind,
    id: d.Id,
    docNumber: d.DocNumber ?? null,
    txnDate: d.TxnDate ?? null,
    total: Number(d.TotalAmt),
    remainingCredit:
      kind === 'credit_memo' ? round2(Number(d.RemainingCredit ?? 0)) : null,
    tax: Number(d.TxnTaxDetail?.TotalTax ?? 0),
    customerId: d.CustomerRef.value,
    customerName: d.CustomerRef.name ?? null,
    billEmail: d.BillEmail?.Address?.trim() || null,
    billAddress: addressLines(d.BillAddr),
    lines: sales.map((l) => {
      const code = l.SalesItemLineDetail?.TaxCodeRef?.value ?? null;
      return {
        itemId: l.SalesItemLineDetail?.ItemRef?.value ?? null,
        itemName: l.SalesItemLineDetail?.ItemRef?.name ?? null,
        description: l.Description?.trim() || null,
        qty: l.SalesItemLineDetail?.Qty ?? null,
        rate: l.SalesItemLineDetail?.UnitPrice ?? null,
        amount: Number(l.Amount ?? 0),
        taxCode: code ? (codeNames.get(code) ?? PSEUDO[code] ?? code) : null,
      };
    }),
    message: d.CustomerMemo?.value?.trim() || null,
    statementMessage: note(d.PrivateNote),
    paymentMethod: d.PaymentMethodRef?.name ?? null,
    refundFrom: d.DepositToAccountRef?.name ?? null,
    checkNo: d.PaymentRefNum?.trim() || null,
    createdAt: d.MetaData?.CreateTime ?? null,
  };
}
