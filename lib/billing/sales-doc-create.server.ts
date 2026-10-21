import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import {
  loadDepositChoices,
  loadPaymentMethods,
  type DepositChoice,
  type PaymentMethodChoice,
} from '@/lib/billing/deposit-accounts.server';
import { SIS_READ_FAILED } from '@/lib/billing/messages';
import {
  buildSalesDocBody,
  SALES_DOC_ENTITY,
  SALES_DOC_NAME,
  type SalesDocInput,
  type SalesDocKind,
} from '@/lib/billing/sales-doc-body';
import {
  connectedRealmId,
  qbEscape,
  QboError,
  qboErrorMessage,
  qboQuery,
  qboRequest,
  QboNotConnectedError,
  WRITE_OUTCOME_UNKNOWN,
  writeOutcomeUnknown,
} from '@/lib/qbo/client';
import { buildInvoiceLines } from '@/lib/qbo/invoice-actions';

export type SalesDocResult =
  | {
      ok: true;
      kind: SalesDocKind;
      id: string;
      docNumber: string | null;
      total: number;
      warnings: string[];
    }
  | {
      ok: false;
      status: number;
      error: string;
      /** QuickBooks may have saved it: the retry must reuse the requestid. */
      keepRequestId?: true;
    };

export type LinkedCustomer = { id: string; name: string; email: string | null };

/**
 * The student's linked QuickBooks customer, read live. `null` with the
 * refusal to show when there is none (or the SIS can't read its link).
 */
export async function linkedCustomer(
  service: SupabaseClient,
  studentNumber: string
): Promise<
  | { ok: true; customer: LinkedCustomer }
  | { ok: false; status: number; error: string }
> {
  const realmId = await connectedRealmId(service);
  if (!realmId) throw new QboNotConnectedError();
  const { data: link, error } = await service
    .from('qbo_customers')
    .select('qbo_customer_id')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId)
    .maybeSingle();
  if (error) {
    console.error('[billing] linked customer lookup:', error.message);
    return { ok: false, status: 500, error: SIS_READ_FAILED };
  }
  if (!link)
    return {
      ok: false,
      status: 422,
      error:
        'This student is not linked to a QuickBooks customer yet. Link them from To review first.',
    };
  const { Customer } = await qboRequest<{
    Customer: {
      Id: string;
      DisplayName: string;
      PrimaryEmailAddr?: { Address?: string };
    };
  }>(service, 'GET', `/customer/${encodeURIComponent(link.qbo_customer_id)}`);
  return {
    ok: true,
    customer: {
      id: Customer.Id,
      name: Customer.DisplayName,
      email: Customer.PrimaryEmailAddr?.Address?.trim() || null,
    },
  };
}

const PATH: Record<SalesDocKind, string> = {
  refund_receipt: '/refundreceipt',
  credit_memo: '/creditmemo',
};
const AUDIT = {
  refund_receipt: 'qbo.refund_receipt.create',
  credit_memo: 'qbo.credit_memo.create',
} as const;
const ENTITY = {
  refund_receipt: 'qbo_refund_receipt',
  credit_memo: 'qbo_credit_memo',
} as const;

type Created = {
  Id: string;
  DocNumber?: string;
  TotalAmt: number;
};

/**
 * Refund receipt or Credit memo for the student's QuickBooks customer, as
 * QuickBooks' own forms make them. QuickBooks FIRST; the SIS keeps no copy
 * (the pages read them live) and logs who made it. Idempotent on the
 * requestid; once QuickBooks accepts, nothing after it reports failure.
 */
export async function createSalesDoc(
  service: SupabaseClient,
  args: {
    studentNumber: string;
    actor: { id: string; email: string | null; role: string };
    input: SalesDocInput;
  }
): Promise<SalesDocResult> {
  const { studentNumber, actor, input } = args;
  const kind = input.kind;
  const name = SALES_DOC_NAME[kind];
  let created: Created;
  let customer: LinkedCustomer;
  let refundFrom: DepositChoice | null = null;
  let method: PaymentMethodChoice | null = null;
  let writing = false;
  try {
    const c = await linkedCustomer(service, studentNumber);
    if (!c.ok) return c;
    customer = c.customer;

    const docNumber = input.docNumber?.trim() || null;
    if (docNumber) {
      const taken = await qboQuery<{ Id: string }>(
        service,
        SALES_DOC_ENTITY[kind],
        `DocNumber = '${qbEscape(docNumber)}'`,
        'maxresults 1'
      );
      if (taken.length > 0)
        return {
          ok: false,
          status: 409,
          error: `${name} ${docNumber} already exists in QuickBooks. Type a different number, or leave it blank.`,
        };
    }
    if (kind === 'refund_receipt') {
      refundFrom =
        (await loadDepositChoices(service)).find(
          (d) => d.id === input.refundFromId
        ) ?? null;
      if (!refundFrom)
        return {
          ok: false,
          status: 422,
          error:
            'That bank account is no longer in QuickBooks. Reload the page and choose again.',
        };
      if (input.paymentMethodId) {
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
    }
    const ids = [...new Set(input.lines.map((l) => l.itemId))];
    const items = await qboQuery<{
      Id: string;
      Name: string;
      SalesTaxCodeRef?: { value: string };
    }>(
      service,
      'Item',
      `Id in (${ids.map((i) => `'${qbEscape(i)}'`).join(', ')})`
    );
    const lines = buildInvoiceLines(
      input.lines,
      new Map(items.map((i) => [i.Id, i]))
    );
    writing = true;
    const res = await qboRequest<Record<string, Created>>(
      service,
      'POST',
      PATH[kind],
      buildSalesDocBody({
        kind,
        customerId: customer.id,
        customerEmail: customer.email,
        txnDate: input.txnDate,
        lines,
        docNumber,
        message: input.message,
        statementMessage: input.statementMessage,
        paymentMethodId: method?.id ?? null,
        refundFromId: refundFrom?.id ?? null,
        checkNo: input.checkNo,
      }),
      // QuickBooks returns the original for a repeated requestid, so a retry
      // of the same submit never creates it twice.
      { requestId: input.requestId }
    );
    created = res[SALES_DOC_ENTITY[kind]];
  } catch (e) {
    if (writing && writeOutcomeUnknown(e))
      return {
        ok: false,
        status: 502,
        error: WRITE_OUTCOME_UNKNOWN,
        keepRequestId: true,
      };
    const message =
      e instanceof Error &&
      !(e instanceof QboError) &&
      !(e instanceof QboNotConnectedError) &&
      e.message.startsWith('One of the items')
        ? e.message
        : qboErrorMessage(e);
    return { ok: false, status: 502, error: message };
  }

  // QuickBooks has it. The audit row is the SIS's only record of who made it.
  try {
    await logAction({
      service,
      actor,
      action: AUDIT[kind],
      entityType: ENTITY[kind],
      entityId: created.Id,
      context: {
        studentNumber,
        doc_number: created.DocNumber ?? null,
        total: Number(created.TotalAmt),
        customer: customer.name,
        ...(refundFrom ? { refund_from: refundFrom.label } : {}),
        ...(method ? { payment_method: method.label } : {}),
      },
    });
  } catch (e) {
    console.error(`[billing] audit row for ${AUDIT[kind]}:`, e);
  }
  return {
    ok: true,
    kind,
    id: created.Id,
    docNumber: created.DocNumber ?? null,
    total: Number(created.TotalAmt),
    warnings: [],
  };
}
