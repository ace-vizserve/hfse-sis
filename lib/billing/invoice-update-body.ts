// Edit invoice: the request the sheet sends, the rules that refuse an edit,
// the sparse Invoice update the SIS writes to QuickBooks, and the sentences
// for QuickBooks' refusals. Pure, so all of it is tested without QuickBooks.

import { z } from 'zod';

import {
  INVOICE_NOTE_MAX,
  invoiceNote,
} from '@/lib/billing/invoice-create-body';
import { isRealDate } from '@/lib/billing/settings-helpers';
import { QboError, qboErrorMessage } from '@/lib/qbo/client';
import { formatSgd } from '@/lib/qbo/format';
import { invoiceState, type QbInvoice } from '@/lib/qbo/invoice-snapshot';

const Date10 = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDate, 'That is not a real date.');

export const UpdateInvoiceBody = z.object({
  lines: z
    .array(
      z.object({
        /** QuickBooks' line Id, for a line the invoice already had. */
        lineId: z.string().min(1).optional(),
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
  /** Note to customer — blank clears it. */
  memo: z.string().max(1000).optional(),
  /** Memo on statement — exactly as typed; blank clears it. */
  statementMemo: z
    .string()
    .max(INVOICE_NOTE_MAX, 'A memo is at most 4000 characters in QuickBooks.')
    .optional(),
  /** The invoice's SyncToken when the sheet opened: a newer one = stale. */
  syncToken: z.string().min(1),
  /** One id per save; QuickBooks replays a repeated update. */
  requestId: z.string().uuid(),
});
export type UpdateInvoiceInput = z.infer<typeof UpdateInvoiceBody>;

export const STALE_EDIT =
  'This invoice was changed in QuickBooks while you were editing. Close and open it again.';

/** What has been paid on the invoice (payments, not a deposit). */
export function amountPaid(inv: {
  TotalAmt: number;
  Balance: number;
  Deposit?: number;
}): number {
  return Math.max(
    0,
    Math.round(
      (Number(inv.TotalAmt) - Number(inv.Balance) - Number(inv.Deposit ?? 0)) *
        100
    ) / 100
  );
}

/**
 * Why this edit can't go to QuickBooks, or null. The invoice as QuickBooks
 * has it now: still the linked customer's, not voided, not fully paid, and
 * not changed since the sheet opened.
 */
export function editRefusal(
  live: QbInvoice,
  args: { customerId: string | null; syncToken: string }
): { status: number; error: string } | null {
  if (
    args.customerId &&
    live.CustomerRef?.value &&
    live.CustomerRef.value !== args.customerId
  )
    return {
      status: 409,
      error:
        'This invoice now belongs to another QuickBooks customer. Refresh the page.',
    };
  const state = invoiceState(live);
  if (state === 'voided')
    return { status: 409, error: 'A voided invoice can’t be edited.' };
  if (state === 'paid')
    return {
      status: 409,
      error:
        'This invoice is fully paid, so it can’t be edited here. Change it in QuickBooks.',
    };
  if (String(live.SyncToken) !== String(args.syncToken))
    return { status: 409, error: STALE_EDIT };
  return null;
}

type LiveLine = {
  Id?: string;
  DetailType?: string;
  SalesItemLineDetail?: {
    ItemRef?: { value: string };
    TaxCodeRef?: { value: string };
  };
} & Record<string, unknown>;

/**
 * The invoice's full Line list for the update (QuickBooks replaces the lines
 * with what is sent). `built` are the product lines as the sheet has them
 * (buildInvoiceLines); a line the invoice already had keeps its Id and, while
 * its product is unchanged, the GST code QuickBooks has on it. The invoice's
 * other lines (a discount, a description-only line) are kept as they are; the
 * subtotal line is left for QuickBooks to work out.
 */
export function mergeInvoiceLines(args: {
  built: Array<Record<string, unknown>>;
  lineIds: Array<string | undefined>;
  live: LiveLine[];
}): Array<Record<string, unknown>> {
  const liveSales = new Map(
    args.live
      .filter((l) => l.DetailType === 'SalesItemLineDetail' && l.Id)
      .map((l) => [String(l.Id), l])
  );
  const product = args.built.map((line, i) => {
    const id = args.lineIds[i];
    const was = id ? liveSales.get(id) : undefined;
    if (!was) return line;
    const detail = line.SalesItemLineDetail as Record<string, unknown> & {
      ItemRef?: { value: string };
    };
    const sameItem =
      was.SalesItemLineDetail?.ItemRef?.value === detail?.ItemRef?.value;
    const code = was.SalesItemLineDetail?.TaxCodeRef;
    return {
      Id: was.Id,
      ...line,
      SalesItemLineDetail:
        sameItem && code
          ? { ...detail, TaxCodeRef: { value: code.value } }
          : detail,
    };
  });
  const others = args.live.filter(
    (l) =>
      l.DetailType !== 'SalesItemLineDetail' &&
      l.DetailType !== 'SubTotalLineDetail'
  );
  return [...product, ...others];
}

/** The sparse Invoice update: the edited fields only, every line. */
export function buildInvoiceUpdateBody(args: {
  id: string;
  syncToken: string;
  txnDate: string;
  dueDate: string | null;
  lines: Array<Record<string, unknown>>;
  memo?: string;
  statementMemo?: string;
}): Record<string, unknown> {
  return {
    Id: args.id,
    SyncToken: args.syncToken,
    sparse: true,
    TxnDate: args.txnDate,
    // Blank keeps the date QuickBooks has (it follows the customer's terms).
    ...(args.dueDate ? { DueDate: args.dueDate } : {}),
    Line: args.lines,
    // Blank clears them, as clearing the box does in QuickBooks.
    CustomerMemo: { value: args.memo?.trim() ?? '' },
    PrivateNote: invoiceNote(args.statementMemo) ?? '',
  };
}

/** The sentence for QuickBooks refusing the update. */
export function updateErrorMessage(e: unknown, paid: number): string {
  if (e instanceof QboError) {
    if (e.code === '5010' || /stale object/i.test(e.detail)) return STALE_EDIT;
    if (paid > 0 && /payment|less than|applied|exceed|negative/i.test(e.detail))
      return `The new total can’t be less than the ${formatSgd(paid)} already paid.`;
  }
  return qboErrorMessage(e);
}
