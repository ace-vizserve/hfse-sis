// Refund receipt and Credit memo: the request their sheet sends, and the
// QuickBooks body the SIS writes for it. Pure, so both are tested without
// QuickBooks. The fields are QuickBooks' own (sandbox capture 2026-10-21):
// a Refund receipt has Payment method, Refund From (required — QuickBooks
// refuses one without it) and Check no.; both have the product lines,
// "Message displayed on …" (CustomerMemo) and "Message displayed on
// statement" (PrivateNote).

import { z } from 'zod';

import { isRealDate } from '@/lib/billing/settings-helpers';

export type SalesDocKind = 'refund_receipt' | 'credit_memo';

/** QuickBooks' names, as the Singapore edition HFSE uses prints them (the
 *  US sandbox says "Credit memo"; the API entity stays CreditMemo). */
export const SALES_DOC_NAME: Record<SalesDocKind, string> = {
  refund_receipt: 'Refund receipt',
  credit_memo: 'Credit note',
};

/** The QuickBooks entity behind each kind (API path + query name). */
export const SALES_DOC_ENTITY: Record<SalesDocKind, string> = {
  refund_receipt: 'RefundReceipt',
  credit_memo: 'CreditMemo',
};

/** Where each kind's page lives under /billing/<studentNumber>/. */
export const SALES_DOC_SEGMENT: Record<SalesDocKind, string> = {
  refund_receipt: 'refund-receipts',
  credit_memo: 'credit-notes',
};

export const REFUND_FROM_REQUIRED =
  'Pick the bank account the money was refunded from.';
export const SALES_DOC_NOTE_MAX = 4000;

const Date10 = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDate, 'That is not a real date.');

const blankToUndefined = (v: string | undefined) => (v ? v : undefined);

export const SalesDocBody = z
  .object({
    kind: z.enum(['refund_receipt', 'credit_memo']),
    lines: z
      .array(
        z.object({
          itemId: z.string().min(1),
          description: z.string().max(4000).optional(),
          qty: z.number().positive(),
          unitPrice: z.number().nonnegative(),
        })
      )
      .min(1, 'Add at least one line.')
      .max(50),
    txnDate: Date10,
    docNumber: z
      .string()
      .trim()
      .max(21, 'A number is at most 21 characters in QuickBooks.')
      .optional()
      .transform(blankToUndefined),
    /** "Message displayed on refund receipt / credit memo" — CustomerMemo. */
    message: z
      .string()
      .trim()
      .max(1000, 'A message is at most 1000 characters in QuickBooks.')
      .optional()
      .transform(blankToUndefined),
    /** "Message displayed on statement" — PrivateNote, exactly as typed. */
    statementMessage: z
      .string()
      .trim()
      .max(
        SALES_DOC_NOTE_MAX,
        'A message is at most 4000 characters in QuickBooks.'
      )
      .optional()
      .transform(blankToUndefined),
    /** Refund receipt only. */
    paymentMethodId: z.string().min(1).nullable().optional(),
    /** Refund receipt only: Refund From, a QuickBooks Bank account. */
    refundFromId: z.string().min(1).nullable().optional(),
    /** Refund receipt only: Check no. (PaymentRefNum). */
    checkNo: z
      .string()
      .trim()
      .max(21, 'A cheque number is at most 21 characters in QuickBooks.')
      .optional()
      .transform(blankToUndefined),
    requestId: z.string().uuid(),
  })
  .superRefine((b, ctx) => {
    if (b.kind === 'refund_receipt' && !b.refundFromId?.trim())
      ctx.addIssue({
        code: 'custom',
        path: ['refundFromId'],
        message: REFUND_FROM_REQUIRED,
      });
    const total = b.lines.reduce(
      (s, l) => s + Math.round(l.qty * l.unitPrice * 100),
      0
    );
    if (total <= 0)
      ctx.addIssue({
        code: 'custom',
        path: ['lines'],
        message: 'The total must be more than 0.',
      });
  });
export type SalesDocInput = z.infer<typeof SalesDocBody>;

/** The RefundReceipt / CreditMemo body for QuickBooks' create. */
export function buildSalesDocBody(args: {
  kind: SalesDocKind;
  customerId: string;
  customerEmail: string | null;
  txnDate: string;
  lines: Array<Record<string, unknown>>;
  docNumber?: string | null;
  message?: string | null;
  statementMessage?: string | null;
  paymentMethodId?: string | null;
  refundFromId?: string | null;
  checkNo?: string | null;
}): Record<string, unknown> {
  const note = args.statementMessage?.trim().slice(0, SALES_DOC_NOTE_MAX);
  const refund = args.kind === 'refund_receipt';
  return {
    CustomerRef: { value: args.customerId },
    TxnDate: args.txnDate,
    Line: args.lines,
    ...(args.message?.trim()
      ? { CustomerMemo: { value: args.message.trim() } }
      : {}),
    ...(note ? { PrivateNote: note } : {}),
    ...(args.customerEmail
      ? { BillEmail: { Address: args.customerEmail } }
      : {}),
    ...(args.docNumber?.trim()
      ? { DocNumber: args.docNumber.trim() }
      : { AutoDocNumber: true }),
    ...(refund && args.refundFromId
      ? { DepositToAccountRef: { value: args.refundFromId } }
      : {}),
    ...(refund && args.paymentMethodId
      ? { PaymentMethodRef: { value: args.paymentMethodId } }
      : {}),
    ...(refund && args.checkNo?.trim()
      ? { PaymentRefNum: args.checkNo.trim() }
      : {}),
  };
}
