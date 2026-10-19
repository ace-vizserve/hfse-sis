// Record payment: which invoices a payment (and any unused credit) pays.
// Pure, so the sheet shows exactly what the route will send to QuickBooks.
//
// Credit is used first when asked, oldest credit first; then the new money,
// oldest invoice first. Anything the ticked invoices don't need stays on the
// payment unapplied — QuickBooks keeps it as credit on the customer.

import { round2 } from '@/lib/billing/view';

export type OpenInvoice = {
  id: string;
  docNumber: string | null;
  txnDate: string | null;
  balance: number;
};
/** An open invoice as the payment form lists it. */
export type PayableInvoice = OpenInvoice & {
  items: string;
  dueDate?: string | null;
  total?: number;
};
export type CreditSource = {
  paymentId: string;
  txnDate: string | null;
  unapplied: number;
};
export type PaymentPlan = {
  creditUse: Array<{ paymentId: string; invoiceId: string; amount: number }>;
  cashApply: Array<{ invoiceId: string; amount: number }>;
  creditUsed: number;
  cashApplied: number;
  leftover: number;
};

const cents = (n: number) => Math.round(n * 100);

export function oldestFirst<
  T extends { txnDate: string | null; docNumber?: string | null },
>(xs: T[]): T[] {
  return [...xs].sort(
    (a, b) =>
      (a.txnDate ?? '').localeCompare(b.txnDate ?? '') ||
      (a.docNumber ?? '').localeCompare(b.docNumber ?? '', undefined, {
        numeric: true,
      })
  );
}

export function planPayment(args: {
  invoices: OpenInvoice[];
  credits: CreditSource[];
  useCredit: boolean;
  amount: number;
}): PaymentPlan {
  // Work in whole cents so 0.1 + 0.2 pays a 0.30 invoice exactly.
  const owed = new Map(
    oldestFirst(args.invoices)
      .filter((i) => i.balance > 0)
      .map((i) => [i.id, cents(i.balance)] as [string, number])
  );
  const creditUse: PaymentPlan['creditUse'] = [];
  if (args.useCredit) {
    for (const c of oldestFirst(
      args.credits.map((c) => ({ ...c, docNumber: c.paymentId }))
    )) {
      let left = cents(c.unapplied);
      for (const [id, due] of owed) {
        if (left <= 0) break;
        if (due <= 0) continue;
        const take = Math.min(left, due);
        creditUse.push({
          paymentId: c.paymentId,
          invoiceId: id,
          amount: take / 100,
        });
        owed.set(id, due - take);
        left -= take;
      }
    }
  }
  const cashApply: PaymentPlan['cashApply'] = [];
  let cash = cents(Math.max(0, args.amount));
  for (const [id, due] of owed) {
    if (cash <= 0) break;
    if (due <= 0) continue;
    const take = Math.min(cash, due);
    cashApply.push({ invoiceId: id, amount: take / 100 });
    cash -= take;
  }
  const creditUsed = round2(creditUse.reduce((s, x) => s + x.amount, 0));
  const cashApplied = round2(cashApply.reduce((s, x) => s + x.amount, 0));
  return {
    creditUse,
    cashApply,
    creditUsed,
    cashApplied,
    leftover: cash / 100,
  };
}

/**
 * The credit payment's new `Line` list. QuickBooks REPLACES the whole list on
 * an update, so every line it already has is kept; a second application to
 * the same invoice adds to that invoice's line.
 */
export function mergeCreditLines(
  existing: Array<{
    Amount?: number;
    LinkedTxn?: Array<{ TxnId: string; TxnType: string }>;
  }>,
  add: Array<{ invoiceId: string; amount: number }>
): Array<{
  Amount: number;
  LinkedTxn: Array<{ TxnId: string; TxnType: string }>;
}> {
  const out = existing.map((l) => ({
    Amount: Number(l.Amount ?? 0),
    LinkedTxn: [...(l.LinkedTxn ?? [])],
  }));
  for (const a of add) {
    const same = out.find(
      (l) =>
        l.LinkedTxn.length === 1 &&
        l.LinkedTxn[0].TxnType === 'Invoice' &&
        l.LinkedTxn[0].TxnId === a.invoiceId
    );
    if (same) same.Amount = round2(same.Amount + a.amount);
    else
      out.push({
        Amount: a.amount,
        LinkedTxn: [{ TxnId: a.invoiceId, TxnType: 'Invoice' }],
      });
  }
  return out;
}
