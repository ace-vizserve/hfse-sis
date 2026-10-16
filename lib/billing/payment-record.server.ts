import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import { loadCustomerHistory } from '@/lib/billing/history.server';
import type { QbPayment } from '@/lib/billing/invoice-row';
import {
  mergeCreditLines,
  planPayment,
  type PaymentPlan,
} from '@/lib/billing/payment-plan';
import { upsertPayment } from '@/lib/billing/store.server';
import {
  connectedRealmId,
  qboErrorMessage,
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
  const { studentNumber, actor, input } = args;
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
  if (linkErr) return { ok: false, status: 500, error: linkErr.message };
  if (!link)
    return {
      ok: false,
      status: 422,
      error: 'This student is not linked to a QuickBooks customer yet.',
    };
  const customerId = link.qbo_customer_id as string;

  // 1) QuickBooks' figures now.
  try {
    const fresh = await loadCustomerHistory(service, studentNumber, undefined);
    if (fresh.errors.length)
      console.warn('[billing] pre-payment read:', fresh.errors);
  } catch (e) {
    return { ok: false, status: 502, error: qboErrorMessage(e) };
  }
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
  if (inv.error || pay.error || dep.error)
    return {
      ok: false,
      status: 500,
      error: (inv.error ?? pay.error ?? dep.error)!.message,
    };
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
  for (const [paymentId, entries] of byPayment) {
    try {
      const { Payment } = await qboRequest<{
        Payment: QbPayment & { SyncToken: string };
      }>(service, 'GET', `/payment/${encodeURIComponent(paymentId)}`);
      await qboRequest(service, 'POST', '/payment', {
        Id: Payment.Id,
        SyncToken: Payment.SyncToken,
        sparse: true,
        CustomerRef: Payment.CustomerRef,
        TotalAmt: Payment.TotalAmt,
        Line: mergeCreditLines(Payment.Line ?? [], entries),
      });
      creditApplied = true;
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
      return {
        ok: false,
        status: 502,
        error: creditApplied
          ? `Some of the credit was used, then QuickBooks stopped: ${qboErrorMessage(e)} Reload the page to see where it got to.`
          : qboErrorMessage(e),
      };
    }
  }

  // 3) The new money.
  let paymentId: string | null = null;
  if (input.amount > 0) {
    const { data: who } = await service.auth.admin.getUserById(actor.id);
    const staffName =
      (who?.user?.user_metadata?.full_name as string | undefined) ??
      actor.email ??
      'staff';
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
        }
      );
      paymentId = Payment.Id;
      await upsertPayment(service, {
        p: Payment,
        studentNumber,
        realmId,
        createdBy: { id: actor.id, email: actor.email },
      });
      await logAction({
        service,
        actor,
        action: 'qbo.payment.create',
        entityType: 'qbo_payment',
        entityId: Payment.Id,
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
      return {
        ok: false,
        status: 502,
        error: creditApplied
          ? `The credit was used, but the payment wasn't recorded: ${qboErrorMessage(e)}`
          : qboErrorMessage(e),
      };
    }
  }

  // 4) Store everything and move the tiles.
  try {
    const after = await loadCustomerHistory(service, studentNumber);
    warnings.push(
      ...after.errors.map(
        (e) => `Saved in QuickBooks; the SIS copy will catch up: ${e}`
      )
    );
  } catch (e) {
    warnings.push(
      `Saved in QuickBooks; the SIS copy will catch up within the hour (${qboErrorMessage(e)}).`
    );
  }
  return { ok: true, paymentId, plan, warnings };
}
