// Refund receipts, credit memos, and the expenses / checks that pay a
// customer back: how the SIS reads them from QuickBooks (pure, so tested
// without QuickBooks). The SIS keeps no copy; every page reads them live.
//
// QuickBooks can't query a Purchase by its payee, so a customer's expenses
// and checks come from its Transaction List report (customer filter), and
// what is still open on them — and on credit memos — from its Customer
// Balance Detail report, the same open list QuickBooks' Receive payment shows.

import type {
  OpenCreditNote,
  PayableInvoice,
} from '@/lib/billing/payment-plan';
import { round2 } from '@/lib/billing/view';

/** The four kinds, by QuickBooks' transaction-list names. */
export type DocKind = 'refund' | 'credit' | 'expense' | 'check';

export const DOC_TYPE_LABEL: Record<DocKind, string> = {
  refund: 'Refund',
  credit: 'Credit Note',
  expense: 'Expense',
  check: 'Cheque',
};

export type SalesDocRow = {
  kind: DocKind;
  id: string;
  docNumber: string | null;
  txnDate: string | null;
  /** Always positive; lists print refunds and credits as minus. */
  total: number;
  /** What QuickBooks still has open on it: a credit memo's unused credit, or
   *  the part of an expense / check no payment has netted yet. */
  open: number;
  /** Memo (PrivateNote / "Message displayed on statement"). */
  memo: string | null;
};

type Cell = { value?: string; id?: string };
type ReportRow = {
  type?: string;
  ColData?: Cell[];
  Rows?: { Row?: ReportRow[] };
};
export type QbReport = {
  Columns?: {
    Column?: Array<{ MetaData?: Array<{ Name: string; Value: string }> }>;
  };
  Rows?: { Row?: ReportRow[] };
};

/** Every data row of a QuickBooks report, keyed by its column keys. */
export function reportRecords(report: QbReport): Array<Record<string, Cell>> {
  const keys = (report.Columns?.Column ?? []).map(
    (c) => c.MetaData?.find((m) => m.Name === 'ColKey')?.Value ?? ''
  );
  const out: Array<Record<string, Cell>> = [];
  const walk = (rows: ReportRow[] | undefined) => {
    for (const r of rows ?? []) {
      if (r.Rows?.Row) walk(r.Rows.Row);
      if (r.type === 'Data' && r.ColData) {
        const rec: Record<string, Cell> = {};
        r.ColData.forEach((c, i) => {
          if (keys[i]) rec[keys[i]] = c;
        });
        out.push(rec);
      }
    }
  };
  walk(report.Rows?.Row);
  return out;
}

const num = (s: string | undefined) => {
  const n = Number((s ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const text = (s: string | undefined) => (s && s.trim() ? s.trim() : null);

// Report type names: the US sandbox's and the Singapore edition's.
const PURCHASE_KIND: Record<string, 'expense' | 'check'> = {
  Expense: 'expense',
  Check: 'check',
  Cheque: 'check',
};

/** The customer's expenses and checks from its Transaction List report. */
export function purchasesFromTransactionList(
  report: QbReport
): Array<Omit<SalesDocRow, 'open'>> {
  const out: Array<Omit<SalesDocRow, 'open'>> = [];
  for (const r of reportRecords(report)) {
    const kind = PURCHASE_KIND[r.txn_type?.value ?? ''];
    const id = r.txn_type?.id;
    if (!kind || !id) continue;
    out.push({
      kind,
      id,
      docNumber: text(r.doc_num?.value),
      txnDate: text(r.tx_date?.value),
      total: Math.abs(num(r.subt_nat_amount?.value)),
      memo: text(r.memo?.value),
    });
  }
  return out;
}

export type OpenItem = {
  type: 'invoice' | 'credit' | 'expense' | 'check' | 'payment' | 'other';
  id: string;
  docNumber: string | null;
  txnDate: string | null;
  dueDate: string | null;
  /** Original amount, positive. */
  amount: number;
  /** Open balance, positive (a credit's unused part, a charge's owing part). */
  open: number;
};

const OPEN_TYPE: Record<string, OpenItem['type']> = {
  Invoice: 'invoice',
  'Credit Memo': 'credit',
  'Credit Note': 'credit',
  Expense: 'expense',
  Check: 'check',
  Cheque: 'check',
  Payment: 'payment',
};

/** What is open on the customer, from its Customer Balance Detail report. */
export function openItemsFromBalanceDetail(report: QbReport): OpenItem[] {
  const out: OpenItem[] = [];
  for (const r of reportRecords(report)) {
    const id = r.txn_type?.id;
    if (!id) continue;
    const open = Math.abs(num(r.subt_open_bal?.value));
    if (open <= 0) continue;
    out.push({
      type: OPEN_TYPE[r.txn_type?.value ?? ''] ?? 'other',
      id,
      docNumber: text(r.doc_num?.value),
      txnDate: text(r.tx_date?.value),
      dueDate: text(r.due_date?.value),
      amount: Math.abs(num(r.subt_amount?.value)),
      open: round2(open),
    });
  }
  return out;
}

/** Open expenses / cheques as Receive payment's Outstanding rows. */
export function toPayableCharges(items: OpenItem[]): PayableInvoice[] {
  return items
    .filter((o) => o.type === 'expense' || o.type === 'check')
    .map((o) => ({
      id: o.id,
      docNumber: o.docNumber,
      txnDate: o.txnDate,
      dueDate: o.dueDate,
      balance: o.open,
      total: o.amount,
      items: '',
      txnType: o.type === 'check' ? ('Check' as const) : ('Expense' as const),
    }));
}

/** Credit notes with unused credit, as Receive payment's Credits. */
export function toOpenCreditNotes(items: OpenItem[]): OpenCreditNote[] {
  return items
    .filter((o) => o.type === 'credit' && o.open > 0)
    .map((o) => ({
      id: o.id,
      docNumber: o.docNumber,
      txnDate: o.txnDate,
      total: o.amount,
      open: o.open,
    }));
}

export type DocStatus = {
  status: string;
  statusKey: 'paid' | 'closed' | 'unapplied';
  tone: 'good' | 'warn';
};

/** The Status QuickBooks' transaction list prints for each kind. */
export function docStatus(
  r: Pick<SalesDocRow, 'kind' | 'open' | 'total'>
): DocStatus {
  if (r.kind === 'credit') {
    if (r.open <= 0)
      return { status: 'Applied', statusKey: 'closed', tone: 'good' };
    return r.open < r.total
      ? { status: 'Partially applied', statusKey: 'unapplied', tone: 'warn' }
      : { status: 'Unapplied', statusKey: 'unapplied', tone: 'warn' };
  }
  // Refund receipts, expenses and checks: QuickBooks prints Paid.
  return { status: 'Paid', statusKey: 'paid', tone: 'good' };
}

/** The SIS page of a refund receipt or credit memo; expenses and checks
 *  open in QuickBooks (null here). */
export function docPageHref(
  studentNumber: string,
  kind: DocKind,
  id: string
): string | null {
  const seg =
    kind === 'refund'
      ? 'refund-receipts'
      : kind === 'credit'
        ? 'credit-notes'
        : null;
  return seg
    ? `/billing/${encodeURIComponent(studentNumber)}/${seg}/${encodeURIComponent(id)}`
    : null;
}

/** QuickBooks' own page for an expense or check (or any of the four). */
export function docQbPath(kind: DocKind, id: string): string {
  const page = {
    refund: 'refundreceipt',
    credit: 'creditmemo',
    expense: 'expense',
    check: 'check',
  }[kind];
  return `/app/${page}?txnId=${encodeURIComponent(id)}`;
}

/** "Expense", "Cheque SPK2", "Credit Note # HFSE069014" — the Description
 *  QuickBooks' Receive payment prints for a row (Singapore names). */
export function openItemLabel(
  kind: 'expense' | 'check' | 'credit',
  docNumber: string | null
): string {
  if (kind === 'credit')
    return docNumber ? `Credit Note # ${docNumber}` : 'Credit Note';
  const name = DOC_TYPE_LABEL[kind];
  return docNumber ? `${name} ${docNumber}` : name;
}
