import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import {
  loadDepositChoices,
  loadPaymentMethods,
  type DepositChoice,
  type PaymentMethodChoice,
} from '@/lib/billing/deposit-accounts.server';
import {
  buildPurchaseBody,
  PURCHASE_NAME,
  type RefundExpenseInput,
} from '@/lib/billing/refund-expense-body';
import {
  linkedCustomer,
  type LinkedCustomer,
} from '@/lib/billing/sales-doc-create.server';
import {
  qboErrorMessage,
  qboQuery,
  qboRequest,
  WRITE_OUTCOME_UNKNOWN,
  writeOutcomeUnknown,
} from '@/lib/qbo/client';

export type RefundExpenseResult =
  | {
      ok: true;
      id: string;
      kind: RefundExpenseInput['kind'];
      docNumber: string | null;
      amount: number;
      warnings: string[];
    }
  | {
      ok: false;
      status: number;
      error: string;
      keepRequestId?: true;
    };

/** QuickBooks' Accounts Receivable account (the A/R category line). */
async function arAccountId(service: SupabaseClient): Promise<string | null> {
  const ar = await qboQuery<{ Id: string; Name: string }>(
    service,
    'Account',
    "AccountType = 'Accounts Receivable' AND Active = true"
  );
  ar.sort((a, b) => Number(a.Id) - Number(b.Id));
  return ar[0]?.Id ?? null;
}

/**
 * Step 1 of paying a credit back: an Expense or Cheque to the student's
 * QuickBooks customer from a bank account, on Accounts Receivable. QuickBooks
 * FIRST; idempotent on the requestid; the SIS keeps no copy, only the audit
 * row. Step 2 is Receive payment (the expense / cheque and the credit, net 0).
 */
export async function createRefundExpense(
  service: SupabaseClient,
  args: {
    studentNumber: string;
    actor: { id: string; email: string | null; role: string };
    input: RefundExpenseInput;
  }
): Promise<RefundExpenseResult> {
  const { studentNumber, actor, input } = args;
  let customer: LinkedCustomer;
  let account: DepositChoice | null;
  let method: PaymentMethodChoice | null = null;
  let created: { Id: string; DocNumber?: string; TotalAmt: number };
  let writing = false;
  try {
    const c = await linkedCustomer(service, studentNumber);
    if (!c.ok) return c;
    customer = c.customer;
    account =
      (await loadDepositChoices(service)).find(
        (d) => d.id === input.accountId
      ) ?? null;
    if (!account)
      return {
        ok: false,
        status: 422,
        error:
          'That bank account is no longer in QuickBooks. Reload the page and choose again.',
      };
    if (input.kind === 'expense' && input.paymentMethodId) {
      method =
        (await loadPaymentMethods(service)).find(
          (m) => m.id === input.paymentMethodId
        ) ?? null;
      if (!method)
        return {
          ok: false,
          status: 422,
          error:
            'That payment method is no longer in QuickBooks. Reload the page and choose again.',
        };
    }
    const ar = await arAccountId(service);
    if (!ar)
      return {
        ok: false,
        status: 422,
        error:
          'QuickBooks has no Accounts Receivable account to put this on. Nothing was saved.',
      };
    writing = true;
    created = (
      await qboRequest<{
        Purchase: { Id: string; DocNumber?: string; TotalAmt: number };
      }>(
        service,
        'POST',
        '/purchase',
        buildPurchaseBody({
          kind: input.kind,
          customerId: customer.id,
          arAccountId: ar,
          accountId: account.id,
          txnDate: input.txnDate,
          amount: input.amount,
          paymentMethodId: method?.id ?? null,
          refNo: input.refNo,
          description: input.description,
          memo: input.memo,
        }),
        { requestId: input.requestId }
      )
    ).Purchase;
  } catch (e) {
    if (writing && writeOutcomeUnknown(e))
      return {
        ok: false,
        status: 502,
        error: WRITE_OUTCOME_UNKNOWN,
        keepRequestId: true,
      };
    return { ok: false, status: 502, error: qboErrorMessage(e) };
  }
  try {
    await logAction({
      service,
      actor,
      action:
        input.kind === 'check' ? 'qbo.check.create' : 'qbo.expense.create',
      entityType: 'qbo_purchase',
      entityId: created.Id,
      context: {
        studentNumber,
        doc_number: created.DocNumber ?? null,
        total: Number(created.TotalAmt),
        customer: customer.name,
        account: account.label,
        ...(method ? { payment_method: method.label } : {}),
        kind: PURCHASE_NAME[input.kind],
      },
    });
  } catch (e) {
    console.error('[billing] audit row for refund expense:', e);
  }
  return {
    ok: true,
    id: created.Id,
    kind: input.kind,
    docNumber: created.DocNumber ?? null,
    amount: Number(created.TotalAmt),
    warnings: [],
  };
}
