// Registration / Fees stage from the invoices TIED to it (spec 2026-10-21
// "Registration and Fees filled from Billing"). Stateless: no stored "current
// invoice", so a reopened, voided or late-arriving invoice always lands
// right. Pure; `today` (Singapore date) is an input so Overdue is testable.
//
// Every patch must pass writeStageFromQbo (STAGE_STATUS_REQUIRED_FIELDS):
// Unpaid / Partially paid / Overdue / Voided need the invoice number; Paid
// needs invoice + payment date, and on Fees also the start date.

import {
  blank,
  onlyChanges,
  type QboStageKey,
  type StagePatch,
  type StageSnapshot,
} from '@/lib/qbo/stage-state';

export type TileInvoice = {
  docNumber: string | null;
  txnDate: string | null;
  dueDate: string | null;
  state: 'open' | 'paid' | 'voided';
  paymentDate: string | null;
  total: number;
  balance: number;
};

/** Statuses staff set that a voided-only stage keeps. */
const KEEP_WHEN_ALL_VOIDED = new Set(['Ready for invoicing', 'Not required']);

const day = (v: string | null | undefined): string | null =>
  blank(v) ? null : v!.trim().slice(0, 10);

const byNumber = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true });

// Newest first: transaction date, then the invoice number (numeric, so
// HFSE10 sorts after HFSE9).
export function latestFirst(
  a: Pick<TileInvoice, 'txnDate' | 'docNumber'>,
  b: Pick<TileInvoice, 'txnDate' | 'docNumber'>
): number {
  return (
    (day(b.txnDate) ?? '').localeCompare(day(a.txnDate) ?? '') ||
    byNumber(b.docNumber ?? '', a.docNumber ?? '')
  );
}

/** An open invoice past its due date (strictly before today). */
export const isOverdue = (i: TileInvoice, today: string) =>
  i.state === 'open' && !!day(i.dueDate) && day(i.dueDate)! < today;

/** Open with some of it paid. */
export const isPartlyPaid = (i: TileInvoice) =>
  i.state === 'open' && i.balance > 0 && i.balance < i.total;

/** The open-invoice status of a set of live invoices with one open. */
export function openStatus(
  live: TileInvoice[],
  today: string
): 'Overdue' | 'Partially paid' | 'Unpaid' {
  const open = live.filter((i) => i.state === 'open');
  if (open.some((i) => isOverdue(i, today))) return 'Overdue';
  if (open.some(isPartlyPaid)) return 'Partially paid';
  return 'Unpaid';
}

function target(
  stage: QboStageKey,
  invoices: TileInvoice[],
  current: StageSnapshot,
  today: string
): StagePatch | null {
  const live = invoices.filter((i) => i.state !== 'voided');
  if (live.length === 0) {
    // Every tied invoice was voided. A stage staff marked Ready for
    // invoicing or Not required stays as it is.
    if (KEEP_WHEN_ALL_VOIDED.has((current.status ?? '').trim())) return null;
    const voided = invoices
      .filter((i) => !blank(i.docNumber))
      .sort(latestFirst);
    if (voided.length === 0) return null;
    return {
      status: 'Voided',
      invoice: voided[0].docNumber!.trim(),
      paymentDate: null,
    };
  }

  // The stage's number is the latest live invoice that carries one. An
  // invoice with no number cannot be written to the stage, so it is skipped.
  const numbered = live.filter((i) => !blank(i.docNumber)).sort(latestFirst);
  if (numbered.length === 0) return null;
  const latest = numbered[0].docNumber!.trim();

  if (live.some((i) => i.state === 'open'))
    return {
      status: openStatus(live, today),
      invoice: latest,
      paymentDate: null,
    };

  // Every live invoice is paid. The payment date is the latest one recorded.
  const paidDates = live
    .map((i) => day(i.paymentDate))
    .filter((d): d is string => !!d)
    .sort();
  const paymentDate = paidDates.length ? paidDates[paidDates.length - 1] : null;

  // Paid needs a payment date (an invoice settled without a Payment has
  // none). Without one, only the number is set.
  if (paymentDate === null) return { invoice: latest };
  if (stage === 'registration')
    return { status: 'Paid', invoice: latest, paymentDate };
  // Fees: Paid also needs a start date (unchanged rule). Without one, the
  // number and payment date are written and the status left alone.
  if (!blank(current.startDate))
    return { status: 'Paid', invoice: latest, paymentDate };
  return { invoice: latest, paymentDate };
}

export function stageFromInvoices(
  stage: QboStageKey,
  invoices: TileInvoice[],
  current: StageSnapshot,
  today: string
): StagePatch | null {
  // No invoice is tied to this stage: it was set by staff, or predates
  // QuickBooks. Leave it alone.
  if (invoices.length === 0) return null;
  if ((current.status ?? '').trim() === 'Cancelled') return null;
  const patch = target(stage, invoices, current, today);
  return patch ? onlyChanges(patch, current) : null;
}

/**
 * A stage with NO tied invoice whose number is a stored QuickBooks invoice
 * that isn't this stage's any more (the student was relinked to another
 * customer, or their customer moved to another student, or the invoice was
 * untied): the number, payment date and money status are cleared, since staff
 * can't clear a QuickBooks-owned number by hand. `numberIsStoredInvoice` says
 * the stage's number matches a stored invoice; a number that matches none
 * (typed before Billing) is left alone. Cancelled is never touched; Ready for
 * invoicing and Not required are staff's and stay.
 */
export function staleStageReset(
  current: StageSnapshot,
  numberIsStoredInvoice: boolean
): StagePatch | null {
  if (!numberIsStoredInvoice || blank(current.invoice)) return null;
  const status = (current.status ?? '').trim();
  if (status === 'Cancelled') return null;
  const patch: StagePatch = KEEP_WHEN_ALL_VOIDED.has(status)
    ? { invoice: null, paymentDate: null }
    : { status: null, invoice: null, paymentDate: null };
  return onlyChanges(patch, current);
}

export function tileNeedsStartDate(
  stage: QboStageKey,
  invoices: Array<Pick<TileInvoice, 'state'>>,
  current: StageSnapshot
): boolean {
  const live = invoices.filter((i) => i.state !== 'voided');
  return (
    stage === 'fees' &&
    live.length > 0 &&
    live.every((i) => i.state === 'paid') &&
    current.status !== 'Paid' &&
    current.status !== 'Cancelled' &&
    blank(current.startDate)
  );
}
