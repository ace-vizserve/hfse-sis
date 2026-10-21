// Create invoice: the request the sheet sends, and the Invoice body the SIS
// writes to QuickBooks for it. Pure, so both are tested without QuickBooks.

import { z } from 'zod';

import { isRealDate } from '@/lib/billing/settings-helpers';

/** QuickBooks' limit on an Invoice's PrivateNote ("Memo on statement"). */
export const INVOICE_NOTE_MAX = 4000;

const Date10 = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDate, 'That is not a real date.');

export const CreateInvoiceBody = z.object({
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
  dueDate: Date10.nullable(),
  /** Note to customer — QuickBooks' CustomerMemo, printed on the invoice. */
  memo: z.string().max(1000).optional(),
  /** Memo on statement — QuickBooks' PrivateNote, not printed. */
  statementMemo: z
    .string()
    .trim()
    .max(INVOICE_NOTE_MAX, 'A memo is at most 4000 characters in QuickBooks.')
    .optional()
    .transform((v) => (v ? v : undefined)),
  docNumber: z
    .string()
    .trim()
    .max(21, 'An invoice number is at most 21 characters in QuickBooks.')
    .optional(),
  /** Created from a Registration / Fees stage: the invoice is tied to it. */
  stage: z
    .object({
      stage: z.enum(['registration', 'fees']),
      ayCode: z.string().regex(/^AY\d{4}$/, 'That is not a school year.'),
    })
    .optional(),
  send: z.boolean(),
  requestId: z.string().uuid(),
});

/**
 * The invoice's Memo on statement: exactly what the person typed (within
 * QuickBooks' 4000 characters); blank → undefined, so no PrivateNote is sent.
 */
export function invoiceNote(
  memo: string | null | undefined
): string | undefined {
  const typed = memo?.trim() ?? '';
  return typed ? typed.slice(0, INVOICE_NOTE_MAX) : undefined;
}

/**
 * Who created an invoice the SIS made BEFORE the memo stopped carrying it,
 * from its Memo on statement's last line. Newer invoices keep the creator on
 * the stored row (created_by_email).
 */
export function sisCreator(
  privateNote: string | null | undefined
): string | null {
  return privateNote?.match(/(?:^|\n)Created from SIS by (.+)$/)?.[1] ?? null;
}

/** The Invoice body for QuickBooks' create. */
export function buildInvoiceBody(args: {
  customerId: string;
  customerEmail: string | null;
  txnDate: string;
  dueDate: string | null;
  lines: Array<Record<string, unknown>>;
  memo?: string;
  statementMemo?: string;
  docNumber: string | null;
}): Record<string, unknown> {
  const privateNote = invoiceNote(args.statementMemo);
  return {
    CustomerRef: { value: args.customerId },
    TxnDate: args.txnDate,
    ...(args.dueDate ? { DueDate: args.dueDate } : {}),
    Line: args.lines,
    ...(args.memo?.trim() ? { CustomerMemo: { value: args.memo.trim() } } : {}),
    ...(args.customerEmail
      ? { BillEmail: { Address: args.customerEmail } }
      : {}),
    ...(privateNote ? { PrivateNote: privateNote } : {}),
    ...(args.docNumber
      ? { DocNumber: args.docNumber }
      : { AutoDocNumber: true }),
  };
}
