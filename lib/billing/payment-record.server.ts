import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import { creditRequestId } from '@/lib/billing/credit-request-id';
import {
  loadDepositChoices,
  loadPaymentMethods,
  type DepositChoice,
  type PaymentMethodChoice,
} from '@/lib/billing/deposit-accounts.server';
import { loadCustomerHistory } from '@/lib/billing/history.server';
import type { QbPayment } from '@/lib/billing/invoice-row';
import {
  SIS_CATCH_UP,
  SIS_READ_FAILED,
  STAGE_NOT_UPDATED,
} from '@/lib/billing/messages';
import { prePaymentRefusal } from '@/lib/billing/payment-guard';
import {
  mergeCreditLines,
  newPaymentLines,
  paymentNote,
  planWithCreditNotes,
  type Allocation,
  type CreditNoteUse,
  type OutstandingType,
  type PaymentPlanWithCredits,
} from '@/lib/billing/payment-plan';
import type { OpenItem } from '@/lib/billing/sales-docs';
import { loadOpenItems } from '@/lib/billing/sales-docs.server';
import { upsertPayment } from '@/lib/billing/store.server';
import { round2 } from '@/lib/billing/view';
import {
  connectedRealmId,
  qboErrorMessage,
  qboReasonOnly,
  qboRequest,
  QboNotConnectedError,
  WRITE_OUTCOME_UNKNOWN,
  writeOutcomeUnknown,
} from '@/lib/qbo/client';

export type RecordPaymentInput = {
  amount: number;
  txnDate: string;
  depositAccountId: string | null;
  reference?: string;
  invoiceIds: string[];
  /** The Payment cells typed on the form: each invoice's total (credit +
   *  money). Absent → oldest first, up to the amount, as planPayment. */
  allocations?: Allocation[];
  /** QuickBooks PaymentMethodRef; optional. */
  paymentMethodId?: string | null;
  /** The Memo the person typed. */
  memo?: string;
  useCredit: boolean;
  /** Credit notes ticked under Credits, and how much of each. */
  creditNotes?: CreditNoteUse[];
  /** One id per submit; QuickBooks de-duplicates retries on it. */
  requestId: string;
};

export type RecordPaymentResult =
  | {
      ok: true;
      paymentId: string | null;
      plan: PaymentPlanWithCredits;
      warnings: string[];
    }
  | {
      ok: false;
      status: number;
      error: string;
      /** QuickBooks may have saved it: the retry must reuse the requestid. */
      keepRequestId?: true;
    };

/**
 * Record payment (spec "Drawers") and Use credit. QuickBooks first:
 * 1. the customer's invoices and payments are re-read, so balances and credit
 *    are QuickBooks' own at this moment;
 * 2. credit (when asked) is applied by adding lines to the credit payments;
 * 3. the new money becomes one QuickBooks Payment applied oldest invoice
 *    first — or, when the Payment cells were typed (`allocations`), exactly
 *    those amounts; whatever the invoices don't need stays as credit;
 * 4. the customer is re-read again, which stores the payment and moves the
 *    tiles.
 */
export async function recordPayment(
  service: SupabaseClient,
  args: {
    studentNumber: string;
    actor: { id: string; email: string | null; role: string };
    input: RecordPaymentInput;
  }
): Promise<RecordPaymentResult> {
  const { studentNumber, actor } = args;
  const input = { ...args.input, amount: round2(args.input.amount) };
  const realmId = await connectedRealmId(service).catch(() => null);
  if (!realmId)
    return {
      ok: false,
      status: 502,
      error: qboErrorMessage(new QboNotConnectedError()),
    };
  const { data: link, error: linkErr } = await service
    .from('qbo_customers')
    .select('qbo_customer_id, display_name')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId)
    .maybeSingle();
  if (linkErr) {
    console.error('[billing] record payment, link lookup:', linkErr.message);
    return { ok: false, status: 500, error: SIS_READ_FAILED };
  }
  if (!link)
    return {
      ok: false,
      status: 422,
      error: 'This student is not linked to a QuickBooks customer yet.',
    };
  const customerId = link.qbo_customer_id as string;

  // 1) QuickBooks' figures now. Only a failed read refuses; a tile write
  // problem is logged (the figures were still read) and retried later.
  const fresh = await loadCustomerHistory(service, studentNumber).catch(
    (e: unknown) => (e instanceof Error ? e : new Error(String(e)))
  );
  const refusal = prePaymentRefusal(fresh);
  if (refusal) {
    console.error('[billing] pre-payment read failed:', fresh);
    return { ok: false, status: 502, error: refusal };
  }
  if (!(fresh instanceof Error) && fresh.errors.length > 0)
    console.warn('[billing] pre-payment read, tile problems:', fresh.errors);
  const [inv, pay] = await Promise.all([
    service
      .from('qbo_invoices')
      .select('qbo_invoice_id, doc_number, txn_date, balance, state')
      .eq('qbo_customer_id', customerId)
      .eq('realm_id', realmId),
    service
      .from('qbo_payments')
      .select('qbo_payment_id, txn_date, unapplied')
      .eq('qbo_customer_id', customerId)
      .eq('realm_id', realmId)
      .gt('unapplied', 0),
  ]);
  if (inv.error || pay.error) {
    console.error(
      '[billing] record payment, stored lookup:',
      (inv.error ?? pay.error)!.message
    );
    return { ok: false, status: 500, error: SIS_READ_FAILED };
  }
  const rows = (inv.data ?? []) as Array<{
    qbo_invoice_id: string;
    doc_number: string | null;
    txn_date: string | null;
    balance: number;
    state: string;
  }>;
  const byId = new Map(rows.map((r) => [r.qbo_invoice_id, r]));
  // Typed Payment cells name the transactions they pay; otherwise the ticked
  // ones.
  const payIds = input.allocations
    ? [...new Set(input.allocations.map((a) => a.invoiceId))]
    : input.invoiceIds;
  const creditNotes = input.creditNotes ?? [];
  // Expenses / cheques paying a credit back, and credit notes, are not stored
  // by the SIS: what is open on them is read from QuickBooks now.
  let live: { charges: OpenItem[]; credits: OpenItem[] } = {
    charges: [],
    credits: [],
  };
  if (creditNotes.length > 0 || payIds.some((id) => !byId.has(id))) {
    try {
      live = await loadOpenItems(service, customerId);
    } catch (e) {
      console.error('[billing] record payment, open items:', e);
      return { ok: false, status: 502, error: qboErrorMessage(e) };
    }
  }
  const chargeById = new Map(live.charges.map((c) => [c.id, c]));
  for (const id of payIds) {
    if (!byId.has(id) && chargeById.has(id)) continue;
    const r = byId.get(id);
    if (!r || r.state !== 'open' || Number(r.balance) <= 0)
      return {
        ok: false,
        status: 409,
        error: `${r?.doc_number ?? 'One of the ticked transactions'} no longer has anything owing in QuickBooks. Reload the page and try again.`,
      };
  }
  const typeOf = (id: string): OutstandingType => {
    const c = chargeById.get(id);
    return c ? (c.type === 'check' ? 'Check' : 'Expense') : 'Invoice';
  };
  // The bank must be one of QuickBooks' Bank accounts right now.
  let dep: DepositChoice | null = null;
  if (input.depositAccountId) {
    try {
      dep =
        (await loadDepositChoices(service)).find(
          (d) => d.id === input.depositAccountId
        ) ?? null;
    } catch (e) {
      console.error('[billing] record payment, bank accounts:', e);
      return { ok: false, status: 502, error: qboErrorMessage(e) };
    }
  }
  if (input.amount > 0 && !dep)
    return {
      ok: false,
      status: 422,
      error: 'Choose the account the money was paid into.',
    };
  // The payment method, when chosen, must be one of QuickBooks' own now. It
  // only goes on a new Payment, so credit-only use ignores it.
  let method: PaymentMethodChoice | null = null;
  if (input.amount > 0 && input.paymentMethodId) {
    try {
      method =
        (await loadPaymentMethods(service)).find(
          (m) => m.id === input.paymentMethodId
        ) ?? null;
    } catch (e) {
      console.error('[billing] record payment, payment methods:', e);
      return { ok: false, status: 502, error: qboErrorMessage(e) };
    }
    if (!method)
      return {
        ok: false,
        status: 422,
        error:
          'That payment method is no longer in QuickBooks. Reload the page and choose again.',
      };
  }
  const planArgs = {
    invoices: payIds.map((id) => {
      const r = byId.get(id);
      if (r)
        return {
          id,
          docNumber: r.doc_number,
          txnDate: r.txn_date,
          balance: Number(r.balance),
        };
      const c = chargeById.get(id)!;
      return {
        id,
        docNumber: c.docNumber,
        txnDate: c.txnDate,
        balance: c.open,
        txnType: typeOf(id),
      };
    }),
    credits: (
      (pay.data ?? []) as Array<{
        qbo_payment_id: string;
        txn_date: string | null;
        unapplied: number;
      }>
    ).map((p) => ({
      paymentId: p.qbo_payment_id,
      txnDate: p.txn_date,
      unapplied: Number(p.unapplied),
    })),
    useCredit: input.useCredit,
    amount: input.amount,
  };
  // Each typed amount is checked against QuickBooks' balance just read: this
  // customer's, open, above 0, not over the balance, and all of them within
  // the money plus the credit used. Credit notes: open now, within their
  // unused credit, and not more than what they pay.
  const planned = planWithCreditNotes({
    ...planArgs,
    ...(input.allocations ? { allocations: input.allocations } : {}),
    creditNotes: live.credits.map((c) => ({
      id: c.id,
      docNumber: c.docNumber,
      txnDate: c.txnDate,
      total: c.amount,
      open: c.open,
    })),
    memoUse: creditNotes,
  });
  if (!planned.ok) return { ok: false, status: 422, error: planned.error };
  const plan: PaymentPlanWithCredits = planned.plan;
  if (input.amount <= 0 && plan.creditUsed <= 0 && plan.memoUsed <= 0)
    return {
      ok: false,
      status: 422,
      error: 'Enter the amount received, or use credit on a ticked invoice.',
    };

  const doc = (id: string) =>
    byId.get(id)?.doc_number ??
    (chargeById.has(id)
      ? `${typeOf(id) === 'Check' ? 'Cheque' : 'Expense'}${chargeById.get(id)!.docNumber ? ` ${chargeById.get(id)!.docNumber}` : ''}`
      : id);
  const creditDoc = new Map(live.credits.map((c) => [c.id, c.docNumber]));
  const warnings: string[] = [];

  // 2) Credit first.
  let creditApplied = false;
  const byPayment = new Map<
    string,
    Array<{ invoiceId: string; amount: number }>
  >();
  for (const c of plan.creditUse) {
    const list = byPayment.get(c.paymentId) ?? [];
    list.push({ invoiceId: c.invoiceId, amount: c.amount });
    byPayment.set(c.paymentId, list);
  }
  // QuickBooks returns the original response for a repeated requestid, so a
  // retry of the same submit never records twice. Each update's id is keyed
  // by the credit payment, never its position: a retry re-plans, and a
  // position id could replay another payment's answer (see creditRequestId).
  for (const [paymentId, entries] of byPayment) {
    const requestId = creditRequestId(input.requestId, paymentId);
    let writing = false;
    try {
      const { Payment } = await qboRequest<{
        Payment: QbPayment & { SyncToken: string };
      }>(service, 'GET', `/payment/${encodeURIComponent(paymentId)}`);
      writing = true;
      await qboRequest(
        service,
        'POST',
        '/payment',
        {
          Id: Payment.Id,
          SyncToken: Payment.SyncToken,
          sparse: true,
          CustomerRef: Payment.CustomerRef,
          TotalAmt: Payment.TotalAmt,
          Line: mergeCreditLines(Payment.Line ?? [], entries, typeOf),
        },
        { requestId }
      );
      creditApplied = true;
    } catch (e) {
      // No definite answer to the credit update: QuickBooks may have applied
      // it, so the retry reuses the requestid.
      if (writing && writeOutcomeUnknown(e))
        return {
          ok: false,
          status: 502,
          error: WRITE_OUTCOME_UNKNOWN,
          keepRequestId: true,
        };
      return {
        ok: false,
        status: 502,
        error: creditApplied
          ? `Some of the credit was used, then QuickBooks stopped (${qboReasonOnly(e)}). Reload the page to see where it got to.`
          : qboErrorMessage(e),
      };
    }
    try {
      await logAction({
        service,
        actor,
        action: 'qbo.payment.apply_credit',
        entityType: 'qbo_payment',
        entityId: paymentId,
        context: {
          studentNumber,
          amount: entries.reduce((s, e) => s + e.amount, 0),
          invoices: entries.map((e) => doc(e.invoiceId)),
        },
      });
    } catch (e) {
      console.error('[billing] audit row for payment.apply_credit:', e);
    }
  }

  // 3) The new money, with the credit notes ticked: one Payment whose lines
  // link each transaction it pays and each credit note (TotalAmt is the
  // money alone — 0.00 when a credit note nets an expense / cheque).
  let paymentId: string | null = null;
  if (input.amount > 0 || plan.memoUse.length > 0) {
    let created: QbPayment;
    try {
      const { Payment } = await qboRequest<{ Payment: QbPayment }>(
        service,
        'POST',
        '/payment',
        {
          CustomerRef: { value: customerId },
          TotalAmt: input.amount,
          TxnDate: input.txnDate,
          ...(input.amount > 0
            ? { DepositToAccountRef: { value: input.depositAccountId } }
            : {}),
          ...(input.reference?.trim()
            ? { PaymentRefNum: input.reference.trim() }
            : {}),
          ...(method ? { PaymentMethodRef: { value: method.id } } : {}),
          // Exactly what was typed; no Memo, no PrivateNote.
          ...(paymentNote(input.memo)
            ? { PrivateNote: paymentNote(input.memo) }
            : {}),
          Line: newPaymentLines(plan.cashApply, plan.memoUse, typeOf),
        },
        { requestId: input.requestId }
      );
      paymentId = Payment.Id;
      created = Payment;
    } catch (e) {
      // No definite answer: QuickBooks may have recorded the payment, so the
      // retry reuses the requestid and QuickBooks de-duplicates it.
      if (writeOutcomeUnknown(e))
        return {
          ok: false,
          status: 502,
          error: WRITE_OUTCOME_UNKNOWN,
          keepRequestId: true,
        };
      return {
        ok: false,
        status: 502,
        error: creditApplied
          ? `The credit was used, but the payment wasn't recorded (${qboReasonOnly(e)}). Reload the page, then record the payment again.`
          : qboErrorMessage(e),
      };
    }
    // QuickBooks has the payment. Everything below is SIS catch-up and must
    // never fail the request, or a retry would record it twice.
    try {
      await upsertPayment(service, {
        p: created,
        studentNumber,
        realmId,
        createdBy: { id: actor.id, email: actor.email },
      });
    } catch (e) {
      console.error('[billing] upsertPayment after QuickBooks accepted:', e);
      warnings.push(SIS_CATCH_UP);
    }
    try {
      await logAction({
        service,
        actor,
        action: 'qbo.payment.create',
        entityType: 'qbo_payment',
        entityId: created.Id,
        context: {
          studentNumber,
          total: input.amount,
          deposit_account: dep?.label ?? null,
          payment_method: method?.label ?? null,
          amounts_typed: !!input.allocations,
          invoices: plan.cashApply.map((a) => doc(a.invoiceId)),
          ...(plan.memoUse.length > 0
            ? {
                credit_notes: plan.memoUse.map(
                  (m) => creditDoc.get(m.creditMemoId) ?? m.creditMemoId
                ),
                credit_notes_used: plan.memoUsed,
              }
            : {}),
          left_as_credit: plan.leftover,
        },
      });
    } catch (e) {
      console.error('[billing] audit row for payment.create:', e);
    }
  }

  // 4) Store everything and move the tiles.
  try {
    const after = await loadCustomerHistory(service, studentNumber);
    if (after.tileProblem) {
      console.error('[billing] tiles after payment:', after.errors);
      warnings.push(STAGE_NOT_UPDATED);
    }
  } catch (e) {
    console.error('[billing] re-read after payment:', e);
    warnings.push(`${SIS_CATCH_UP.replace(/\.$/, '')} (${qboReasonOnly(e)}).`);
  }
  // One sentence once, however many steps hit it.
  return { ok: true, paymentId, plan, warnings: [...new Set(warnings)] };
}
