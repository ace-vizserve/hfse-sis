// Who owns which field on the Registration and Fees stages once QuickBooks is
// connected (Mr Ace, 2026-10-14: "one interface"). QuickBooks owns the invoice
// number, the payment date and the money statuses — they change only through
// Billing (the tile's QuickBooks actions were removed in Billing Phase 5) and
// the sync. Staff own the start date, the remarks, and the statuses
// QuickBooks cannot know: Ready for invoicing (only while no live invoice is
// tied to the stage), Not required (likewise) and Cancelled (spec 2026-10-21). Before QuickBooks is
// connected, or after it is disconnected, none of this applies and the stage
// is edited by hand as before.
//
// Pure, so the stage route (which enforces it) and the edit dialog (which
// shows it) read the same rules.

import type { InvoiceState, QboStageKey } from '@/lib/qbo/stage-state';

/** Stage extras QuickBooks fills; staff can't type them while connected. */
export const QBO_OWNED_FIELD_KEYS = ['invoice', 'paymentDate'] as const;

const norm = (v: string | null | undefined) => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/** The statuses staff set on Registration / Fees (spec 2026-10-21). */
export const STAFF_STAGE_STATUSES = [
  'Ready for invoicing',
  'Not required',
  'Cancelled',
] as const;

/**
 * The statuses staff may pick by hand while QuickBooks owns the stage: the
 * current one (no change), then Ready for invoicing, Not required and
 * Cancelled. Everything else (Unpaid … Voided) follows QuickBooks.
 */
export function staffStatusOptions(current: string | null): string[] {
  const out: string[] = [];
  const now = norm(current);
  if (now && !(STAFF_STAGE_STATUSES as readonly string[]).includes(now))
    out.push(now);
  out.push(...STAFF_STAGE_STATUSES);
  return out;
}

/** The invoices tied to the stage, as the lock reads them. */
export type TiedInvoiceFacts = {
  /** A live (not voided) invoice is tied to this stage. */
  hasLiveInvoice?: boolean;
  /** Every live tied invoice is paid. */
  allPaid?: boolean;
};

/**
 * Why Not required can't be set, or null. While a tied invoice is open (or
 * paid), the next sync would write its status straight back over it.
 */
export function notRequiredBlock(opts?: TiedInvoiceFacts): string | null {
  if (!opts?.hasLiveInvoice) return null;
  return opts.allPaid
    ? 'This stage is already paid.'
    : 'Void the open invoice in Billing first, then set Not required.';
}

/** Why this hand edit is refused while QuickBooks owns the stage, or null. */
export function qboLockViolation(
  before: {
    status: string | null;
    invoice: string | null;
    paymentDate: string | null;
  },
  payload: {
    status: string | null | undefined;
    extras?: Record<string, string | null | undefined>;
  },
  opts?: TiedInvoiceFacts
): string | null {
  const ex = payload.extras ?? {};
  for (const key of QBO_OWNED_FIELD_KEYS) {
    if (ex[key] === undefined) continue;
    const prev = norm(before[key]);
    const next = norm(ex[key]);
    const same =
      key === 'paymentDate'
        ? (prev?.slice(0, 10) ?? null) === (next?.slice(0, 10) ?? null)
        : prev === next;
    if (!same) {
      return 'The invoice number and payment date come from QuickBooks. Open the student’s Billing page to invoice or record a payment.';
    }
  }
  const next = norm(payload.status);
  if (payload.status === undefined || next === norm(before.status)) return null;
  if (!staffStatusOptions(before.status).includes(next ?? '')) {
    return 'This status follows QuickBooks. Here you can only set Ready for invoicing, Not required or Cancelled.';
  }
  if (next === 'Ready for invoicing' && opts?.hasLiveInvoice) {
    return 'This stage already has an invoice in QuickBooks, so it can’t go back to Ready for invoicing. Open the student’s Billing page to see it.';
  }
  if (next === 'Not required') return notRequiredBlock(opts);
  return null;
}

/**
 * Fees paid in QuickBooks waits for a start date before Paid. When staff save
 * that start date, the stage becomes Paid in the same save — the sync won't,
 * because nothing changed in QuickBooks.
 */
export function paidOnStartDate(
  stage: QboStageKey,
  invoiceState: InvoiceState | null,
  after: { status: string | null; startDate: string | null }
): boolean {
  return (
    stage === 'fees' &&
    invoiceState === 'paid' &&
    !!norm(after.startDate) &&
    norm(after.status) !== 'Paid' &&
    norm(after.status) !== 'Cancelled'
  );
}
