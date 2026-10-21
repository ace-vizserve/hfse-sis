// The Edit dialog of the Registration and Fees stages while QuickBooks is
// connected (spec 2026-10-21, mockup boards "Edit" and "Edit, invoiced"). Two
// shapes, picked by whether a LIVE invoice is tied to the stage:
//   choose   — no live invoice: pick Ready for invoicing, Not required or
//              Cancelled, plus remarks.
//   invoiced — a live invoice: the status follows QuickBooks; staff save
//              remarks, or cancel the stage.
// Pure and client-safe, so the dialog and its tests read the same rules. The
// server's rules (lib/qbo/stage-lock.ts) are unchanged; nothing here offers
// what they refuse: Ready for invoicing and Not required are offered only
// while no live invoice is tied.

import type { StageBilling } from '@/lib/billing/stage-card';
import { formatDay } from '@/lib/billing/view';
import { formatSgd } from '@/lib/qbo/format';
import { STAFF_STAGE_STATUSES } from '@/lib/qbo/stage-lock';

export type BillingEditShape = 'choose' | 'invoiced';

export function billingEditShape(hasLiveInvoice: boolean): BillingEditShape {
  return hasLiveInvoice ? 'invoiced' : 'choose';
}

export type StaffStageStatus = (typeof STAFF_STAGE_STATUSES)[number];

/** The three cards of the "choose" shape, in order. */
export const BILLING_EDIT_CHOICES: ReadonlyArray<{
  value: StaffStageStatus;
  help: string;
}> = [
  { value: 'Ready for invoicing', help: 'Shows up for whoever invoices.' },
  { value: 'Not required', help: 'No fee for this student.' },
  { value: 'Cancelled', help: 'The application stopped here.' },
];

const norm = (v: string | null | undefined) => (v ?? '').trim();

export function isStaffStageStatus(
  status: string | null | undefined
): status is StaffStageStatus {
  return (STAFF_STAGE_STATUSES as readonly string[]).includes(norm(status));
}

/**
 * The card preselected when the dialog opens: the current status when staff
 * set it, else none (blank, Voided, or a status typed before Billing).
 */
export function initialChoice(status: string | null): StaffStageStatus | '' {
  const s = norm(status);
  return isStaffStageStatus(s) ? s : '';
}

/** The line under the title in the "choose" shape. */
export function chooseSubtitle(
  status: string | null,
  invoiceNumber: string | null
): string {
  const num = norm(invoiceNumber);
  if (norm(status) === 'Voided')
    return num
      ? `The last invoice (${num}) was voided.`
      : 'The last invoice was voided.';
  return 'No invoice yet.';
}

/** Save is open once a card is picked (a staff status starts picked). */
export function canSaveChoice(choice: StaffStageStatus | ''): boolean {
  return choice !== '';
}

export type StagePayload = {
  status: string | null;
  remarks: string | null;
  extras?: Record<string, string | null>;
};

/** The Fees start date, before and as typed; absent on Registration. */
export type StartDateEdit = { before: string | null; now: string | null };

/** `extras` carries the start date only when it was changed. */
function withStartDate(
  out: StagePayload,
  startDate: StartDateEdit | undefined
): StagePayload {
  if (!startDate) return out;
  const before = norm(startDate.before).slice(0, 10);
  const now = norm(startDate.now).slice(0, 10);
  return before === now ? out : { ...out, extras: { startDate: now || null } };
}

/**
 * The "choose" save. The stage route needs a status on every save, so an
 * unchanged pick sends the current status back as it stands.
 */
export function choosePayload(a: {
  choice: StaffStageStatus;
  remarks: string | null;
  startDate?: StartDateEdit;
}): StagePayload {
  return withStartDate({ status: a.choice, remarks: a.remarks }, a.startDate);
}

/**
 * Save remarks on an invoiced stage: the status goes back exactly as it
 * stands (the route treats an unchanged status as no change), and the Fees
 * start date only when it was changed. Never the invoice number or payment
 * date — QuickBooks fills those.
 */
export function remarksPayload(a: {
  initialStatus: string | null;
  remarks: string | null;
  startDate?: StartDateEdit;
}): StagePayload {
  return withStartDate(
    { status: a.initialStatus, remarks: a.remarks },
    a.startDate
  );
}

/** Cancel this stage, from the invoiced shape. */
export function cancelPayload(remarks: string | null): StagePayload {
  return { status: 'Cancelled', remarks };
}

/**
 * The invoice Cancel this stage may void too: the lead invoice, while nothing
 * has been paid on the stage (Billing's void refuses an invoice with a
 * payment — that one is voided or refunded in QuickBooks).
 */
export function voidableOnCancel(
  billing: StageBilling | null
): { qboInvoiceId: string } | null {
  if (!billing?.lead || billing.owed <= 0 || billing.owed !== billing.total)
    return null;
  return { qboInvoiceId: billing.lead.qboInvoiceId };
}

/** Cancel this stage shows unless the stage already reads Cancelled. */
export function canCancelStage(status: string | null): boolean {
  return norm(status) !== 'Cancelled';
}

export type InvoicedSummary = {
  number: string;
  /** "Owed" with the amount, or "Paid on" with the day. */
  money: { label: 'Owed' | 'Paid on'; value: string };
  /** The earliest due date of the open invoices; null once all are paid. */
  due: string | null;
};

/** The summary box of the invoiced shape. */
export function invoicedSummary(
  billing: StageBilling,
  fallbackNumber: string | null
): InvoicedSummary {
  const number =
    norm(billing.lead?.docNumber) || norm(fallbackNumber) || 'No number';
  if (billing.allPaid) {
    return {
      number,
      money: {
        label: 'Paid on',
        value: billing.paymentDate ? formatDay(billing.paymentDate) : '—',
      },
      due: null,
    };
  }
  const partly = billing.owed < billing.total;
  return {
    number,
    money: {
      label: 'Owed',
      value: partly
        ? `${formatSgd(billing.owed)} of ${formatSgd(billing.total)}`
        : formatSgd(billing.owed),
    },
    due: billing.dueDate ? formatDay(billing.dueDate) : '—',
  };
}
