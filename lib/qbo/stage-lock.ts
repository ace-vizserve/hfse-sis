// Who owns which field on the Registration and Fees stages once QuickBooks is
// connected (Mr Ace, 2026-10-14: "one interface"). QuickBooks owns the invoice
// number, the payment date and the money statuses — they change only through
// Billing (the tile's QuickBooks actions were removed in Billing Phase 5) and
// the sync. Staff own the start date, the
// remarks and Cancelled, which QuickBooks cannot know. Before QuickBooks is
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

/**
 * The statuses staff may pick by hand while QuickBooks owns the stage: the
 * current one (no change), Cancelled, and — to reopen a Cancelled stage —
 * Pending.
 */
export function staffStatusOptions(current: string | null): string[] {
  const out: string[] = [];
  if (norm(current)) out.push(current!.trim());
  if (!out.includes('Cancelled')) out.push('Cancelled');
  if (norm(current) === 'Cancelled') out.push('Pending');
  return out;
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
  }
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
  if (
    payload.status !== undefined &&
    norm(payload.status) !== norm(before.status) &&
    !staffStatusOptions(before.status).includes(norm(payload.status) ?? '')
  ) {
    return 'This status follows QuickBooks. Here you can only set Cancelled, or reopen a Cancelled stage as Pending.';
  }
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
