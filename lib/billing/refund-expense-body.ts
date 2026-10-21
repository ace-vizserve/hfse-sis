// Paying a credit back, as QuickBooks' help does it (step 1): an Expense or a
// Cheque to the customer, its one Category line on Accounts Receivable. Step
// 2 is Receive payment, ticking it with the credit so they net to 0.00.
// The request its sheet sends, and the Purchase body. Pure, so tested
// without QuickBooks.

import { z } from 'zod';

import { isRealDate } from '@/lib/billing/settings-helpers';

export type PurchaseKind = 'expense' | 'check';

/** The Singapore edition's names (the API's PaymentType stays Cash / Check). */
export const PURCHASE_NAME: Record<PurchaseKind, string> = {
  expense: 'Expense',
  check: 'Cheque',
};

export const PAY_ACCOUNT_REQUIRED =
  'Pick the bank account the money is paid from.';

const blankToUndefined = (v: string | undefined) => (v ? v : undefined);

export const RefundExpenseBody = z.object({
  kind: z.enum(['expense', 'check']),
  /** Expense: Payment account. Cheque: Bank account. A QuickBooks Bank account. */
  accountId: z.string().trim().min(1, PAY_ACCOUNT_REQUIRED),
  txnDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isRealDate, 'That is not a real date.'),
  /** Expense only. */
  paymentMethodId: z.string().min(1).nullable().optional(),
  /** Expense: Ref no. Cheque: Cheque no. */
  refNo: z
    .string()
    .trim()
    .max(21, 'A number is at most 21 characters in QuickBooks.')
    .optional()
    .transform(blankToUndefined),
  amount: z.number().positive('Enter an amount above 0.').max(1_000_000),
  description: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .transform(blankToUndefined),
  memo: z
    .string()
    .trim()
    .max(4000, 'A memo is at most 4000 characters in QuickBooks.')
    .optional()
    .transform(blankToUndefined),
  requestId: z.string().uuid(),
});
export type RefundExpenseInput = z.infer<typeof RefundExpenseBody>;

/** The Purchase body: Payee = the customer, one A/R category line. */
export function buildPurchaseBody(args: {
  kind: PurchaseKind;
  customerId: string;
  arAccountId: string;
  accountId: string;
  txnDate: string;
  amount: number;
  paymentMethodId?: string | null;
  refNo?: string | null;
  description?: string | null;
  memo?: string | null;
}): Record<string, unknown> {
  const amount = Math.round(args.amount * 100) / 100;
  return {
    PaymentType: args.kind === 'check' ? 'Check' : 'Cash',
    AccountRef: { value: args.accountId },
    TxnDate: args.txnDate,
    EntityRef: { value: args.customerId, type: 'Customer' },
    ...(args.kind === 'expense' && args.paymentMethodId
      ? { PaymentMethodRef: { value: args.paymentMethodId } }
      : {}),
    ...(args.refNo?.trim() ? { DocNumber: args.refNo.trim() } : {}),
    ...(args.memo?.trim() ? { PrivateNote: args.memo.trim() } : {}),
    Line: [
      {
        DetailType: 'AccountBasedExpenseLineDetail',
        Amount: amount,
        ...(args.description?.trim()
          ? { Description: args.description.trim() }
          : {}),
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: args.arAccountId },
          CustomerRef: { value: args.customerId },
        },
      },
    ],
  };
}
