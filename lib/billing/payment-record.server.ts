import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
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
  planPayment,
  type PaymentPlan,
} from '@/lib/billing/payment-plan';
import { staffDisplayName } from '@/lib/billing/staff-name.server';
import { upsertPayment } from '@/lib/billing/store.server';
import { round2 } from '@/lib/billing/view';
import {
  connectedRealmId,
  qboErrorMessage,
  qboReasonOnly,
  qboRequest,
  QboNotConnectedError,
} from '@/lib/qbo/client';

export type RecordPaymentInput = {
  amount: number;
  txnDate: string;
  depositAccountId: string | null;
  reference?: string;
  invoiceIds: string[];
  useCredit: boolean;
  /** One id per submit; QuickBooks de-duplicates retries on it. */
  requestId: string;
};

export type RecordPaymentResult =
  | {
      ok: true;
      paymentId: string | null;
      plan: PaymentPlan;
      warnings: string[];
    }
  | { ok: false; status: number; error: string };

/**
 * Record payment (spec "Drawers") and Use credit. QuickBooks first:
 * 1. the customer's invoices and payments are re-read, so balances and credit
 *    are QuickBooks' own at this moment;
 * 2. credit (when asked) is applied by adding lines to the credit payments;
 * 3. the new money becomes one QuickBooks Payment applied oldest invoice
 *    first; whatever the ticked invoices don't need stays as credit;
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
  const [inv, pay, dep] = await Promise.all([
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
    input.depositAccountId
      ? service
          .from('billing_deposit_accounts')
          .select('qbo_account_id, label')
          .eq('qbo_account_id', input.depositAccountId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (inv.error || pay.error || dep.error) {
    console.error(
      '[billing] record payment, stored lookup:',
      (inv.error ?? pay.error ?? dep.error)!.message
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
  for (const id of input.invoiceIds) {
    const r = byId.get(id);
    if (!r || r.state !== 'open' || Number(r.balance) <= 0)
      return {
        ok: false,
        status: 409,
        error: `${r?.doc_number ?? 'One of the ticked invoices'} no longer has anything owing in QuickBooks. Reload the page and try again.`,
      };
  }
  if (input.amount > 0 && !dep.data)
    return {
      ok: false,
      status: 422,
      error: 'Choose the account the money was paid into.',
    };
  const plan = planPayment({
    invoices: input.invoiceIds.map((id) => {
      const r = byId.get(id)!;
      return {
        id,
        docNumber: r.doc_number,
        txnDate: r.txn_date,
        balance: Number(r.balance),
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
  });
  if (input.amount <= 0 && plan.creditUsed <= 0)
    return {
      ok: false,
      status: 422,
      error: 'Enter the amount received, or use credit on a ticked invoice.',
    };

  const doc = (id: string) => byId.get(id)?.doc_number ?? id;
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
  // retry of the same submit never records twice.
  let creditIndex = 0;
  for (const [paymentId, entries] of byPayment) {
    const requestId = `${input.requestId}-c${creditIndex++}`;
    try {
      const { Payment } = await qboRequest<{
        Payment: QbPayment & { SyncToken: string };
      }>(service, 'GET', `/payment/${encodeURIComponent(paymentId)}`);
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
          Line: mergeCreditLines(Payment.Line ?? [], entries),
        },
        { requestId }
      );
      creditApplied = true;
    } catch (e) {
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

  // 3) The new money.
  let paymentId: string | null = null;
  if (input.amount > 0) {
    const staffName = await staffDisplayName(service, actor);
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
          DepositToAccountRef: { value: input.depositAccountId },
          ...(input.reference?.trim()
            ? { PaymentRefNum: input.reference.trim() }
            : {}),
          PrivateNote: `Recorded from SIS by ${staffName}`,
          Line: plan.cashApply.map((a) => ({
            Amount: a.amount,
            LinkedTxn: [{ TxnId: a.invoiceId, TxnType: 'Invoice' }],
          })),
        },
        { requestId: input.requestId }
      );
      paymentId = Payment.Id;
      created = Payment;
    } catch (e) {
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
          deposit_account:
            (dep.data as { label: string } | null)?.label ?? null,
          invoices: plan.cashApply.map((a) => doc(a.invoiceId)),
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
