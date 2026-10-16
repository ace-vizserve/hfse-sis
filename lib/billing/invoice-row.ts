import type { InvoiceLine } from '@/lib/billing/classify';
import type { QbInvoice } from '@/lib/qbo/invoice-snapshot';

export type QbInvoiceFull = QbInvoice & {
  Line?: Array<{
    Amount?: number;
    Description?: string;
    DetailType?: string;
    SalesItemLineDetail?: {
      ItemRef?: { value: string; name?: string };
      Qty?: number;
    };
  }>;
  CustomerMemo?: { value?: string };
};

export type QbPayment = {
  Id: string;
  TxnDate?: string;
  TotalAmt: number;
  UnappliedAmt?: number;
  PrivateNote?: string;
  CustomerRef: { value: string };
  DepositToAccountRef?: { value: string; name?: string };
  PaymentMethodRef?: { value: string; name?: string };
  PaymentRefNum?: string;
  Line?: Array<{
    Amount?: number;
    LinkedTxn?: Array<{ TxnId: string; TxnType: string }>;
  }>;
};

export function invoiceLines(
  inv: QbInvoiceFull,
  itemAccounts: Map<string, string | null>
): InvoiceLine[] {
  return (inv.Line ?? [])
    .filter((l) => l.DetailType === 'SalesItemLineDetail')
    .map((l) => {
      const itemId = l.SalesItemLineDetail?.ItemRef?.value ?? null;
      return {
        itemId,
        itemName: l.SalesItemLineDetail?.ItemRef?.name ?? null,
        accountId: itemId ? (itemAccounts.get(itemId) ?? null) : null,
        description: l.Description ?? null,
        qty: l.SalesItemLineDetail?.Qty ?? null,
        amount: Number(l.Amount ?? 0),
      };
    });
}

export function paymentApplied(
  p: QbPayment
): Array<{ invoiceId: string; amount: number }> {
  const out: Array<{ invoiceId: string; amount: number }> = [];
  for (const l of p.Line ?? []) {
    for (const t of l.LinkedTxn ?? [])
      if (t.TxnType === 'Invoice')
        out.push({ invoiceId: t.TxnId, amount: Number(l.Amount ?? 0) });
  }
  return out;
}

/** Latest payment date (YYYY-MM-DD) per invoice id; payments with no date are ignored. */
export function latestPaymentDates(
  payments: Array<{
    txnDate: string | null;
    applied: Array<{ invoiceId: string; amount: number }>;
  }>
): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of payments) {
    if (!p.txnDate) continue;
    const d = p.txnDate.slice(0, 10);
    for (const a of p.applied) {
      const cur = out.get(a.invoiceId);
      if (!cur || d > cur) out.set(a.invoiceId, d);
    }
  }
  return out;
}
