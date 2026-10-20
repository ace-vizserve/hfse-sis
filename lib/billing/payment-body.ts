import { z } from 'zod';

import { isRealDate } from '@/lib/billing/settings-helpers';

export const DEPOSIT_REQUIRED = 'Pick the bank account the money went into.';

/** The body of POST /api/billing/students/[studentNumber]/payments. */
export const PaymentBody = z
  .object({
    amount: z.number().min(0).max(1_000_000),
    txnDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(isRealDate, 'That is not a real date.'),
    // Needed whenever money is received. Use credit moves no money, so it
    // sends none.
    depositAccountId: z.string().nullable().optional(),
    reference: z
      .string()
      .trim()
      .max(21, 'A reference is at most 21 characters in QuickBooks.')
      .optional(),
    invoiceIds: z.array(z.string().min(1)).max(100),
    // The Payment cells the person typed; absent = oldest first, as before.
    allocations: z
      .array(
        z.object({
          invoiceId: z.string().min(1),
          amount: z.number().positive().max(1_000_000),
        })
      )
      .max(100)
      .optional(),
    paymentMethodId: z.string().min(1).nullable().optional(),
    memo: z
      .string()
      .trim()
      .max(4000, 'A memo is at most 4000 characters in QuickBooks.')
      .optional(),
    useCredit: z.boolean(),
    requestId: z.string().uuid(),
  })
  .superRefine((b, ctx) => {
    if (b.amount > 0 && !b.depositAccountId?.trim())
      ctx.addIssue({
        code: 'custom',
        path: ['depositAccountId'],
        message: DEPOSIT_REQUIRED,
      });
  });
