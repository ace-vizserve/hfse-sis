// Record payment: which invoices a payment (and any unused credit) pays.
// Pure, so the sheet shows exactly what the route will send to QuickBooks.
//
// Credit is used first when asked, oldest credit first; then the new money,
// oldest invoice first. Anything the ticked invoices don't need stays on the
// payment unapplied — QuickBooks keeps it as credit on the customer.
// When the person types the Payment cells, planAllocatedPayment pays exactly
// those amounts instead of oldest-first.

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
  return fill(owed, args.credits, args.useCredit, args.amount);
}

export type Allocation = { invoiceId: string; amount: number };

/**
 * Record payment with the Payment cells typed in (QuickBooks' Receive
 * Payment): each allocation is what that invoice receives in total. Credit
 * (when asked) goes to the allocated invoices first, oldest credit first;
 * the new money covers the rest of each allocation. Whatever the money
 * doesn't need stays unapplied — credit on the customer, as planPayment.
 *
 * Refused (with the sentence to show) when an allocation names an invoice
 * not in `invoices`, repeats one, is not more than 0, is more than that
 * invoice's open balance, or when the allocations add up to more than the
 * amount plus the credit used.
 */
export function planAllocatedPayment(args: {
  invoices: OpenInvoice[];
  credits: CreditSource[];
  useCredit: boolean;
  amount: number;
  allocations: Allocation[];
}): { ok: true; plan: PaymentPlan } | { ok: false; error: string } {
  const byId = new Map(args.invoices.map((i) => [i.id, i]));
  const want = new Map<string, number>();
  for (const a of args.allocations) {
    const i = byId.get(a.invoiceId);
    const name = i?.docNumber ?? 'One of the invoices';
    if (!i)
      return { ok: false, error: `${name} is not open on this customer.` };
    if (want.has(a.invoiceId))
      return { ok: false, error: `${name} is listed twice.` };
    const c = cents(a.amount);
    if (!Number.isFinite(a.amount) || c <= 0)
      return { ok: false, error: `Enter a payment above 0 for ${name}.` };
    if (c > cents(i.balance))
      return {
        ok: false,
        error: `The payment for ${name} is more than its open balance.`,
      };
    want.set(a.invoiceId, c);
  }
  // Oldest invoice first, so credit lands where planPayment would put it.
  const owed = new Map(
    oldestFirst(args.invoices)
      .filter((i) => want.has(i.id))
      .map((i) => [i.id, want.get(i.id)!] as [string, number])
  );
  const plan = fill(owed, args.credits, args.useCredit, args.amount);
  const allocated = [...want.values()].reduce((s, c) => s + c, 0);
  if (allocated > cents(plan.creditUsed) + cents(Math.max(0, args.amount)))
    return {
      ok: false,
      error:
        'The payments add up to more than the amount received and the credit used.',
    };
  return { ok: true, plan };
}

/** Credit first, then the money, into `owed` (cents, in paying order). */
function fill(
  owed: Map<string, number>,
  credits: CreditSource[],
  useCredit: boolean,
  amount: number
): PaymentPlan {
  const creditUse: PaymentPlan['creditUse'] = [];
  if (useCredit) {
    for (const c of oldestFirst(
      credits.map((c) => ({ ...c, docNumber: c.paymentId }))
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
  let cash = cents(Math.max(0, amount));
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

/** QuickBooks' limit on a Payment's PrivateNote (Memo). */
export const PAYMENT_NOTE_MAX = 4000;

/**
 * The Payment's Memo: exactly what the person typed (within QuickBooks' 4000
 * characters); blank → undefined, so no PrivateNote is sent.
 */
export function paymentNote(
  memo: string | null | undefined
): string | undefined {
  const typed = memo?.trim() ?? '';
  return typed ? typed.slice(0, PAYMENT_NOTE_MAX) : undefined;
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
