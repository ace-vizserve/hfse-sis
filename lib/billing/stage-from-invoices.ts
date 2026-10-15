// Registration / Fees stage from ALL the invoices the mapping puts on the tile
// (spec "Tile status from invoices"). Stateless: no stored "current invoice",
// so a reopened, voided or late-arriving invoice always lands right. Pure.
//
// Every patch must pass writeStageFromQbo (STAGE_STATUS_REQUIRED_FIELDS):
// Registration Finished needs invoice + paymentDate; Fees Invoiced /
// Re-invoiced need invoice; Fees Paid needs invoice + paymentDate + startDate.

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
  state: 'open' | 'paid' | 'voided';
  paymentDate: string | null;
};

const day = (v: string | null | undefined): string | null =>
  blank(v) ? null : v!.trim().slice(0, 10);

const byNumber = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true });

// Newest first: transaction date, then the invoice number (numeric, so
// HFSE10 sorts after HFSE9).
function latestFirst(a: TileInvoice, b: TileInvoice): number {
  return (
    (day(b.txnDate) ?? '').localeCompare(day(a.txnDate) ?? '') ||
    byNumber(b.docNumber ?? '', a.docNumber ?? '')
  );
}

function target(
  stage: QboStageKey,
  invoices: TileInvoice[],
  current: StageSnapshot
): StagePatch {
  const live = invoices.filter((i) => i.state !== 'voided');
  if (live.length === 0)
    return { status: 'Pending', invoice: null, paymentDate: null };

  // The tile's number is the latest live invoice that carries one. An invoice
  // with no number cannot be written to the stage, so it is skipped.
  const numbered = live.filter((i) => !blank(i.docNumber)).sort(latestFirst);
  if (numbered.length === 0) return {};
  const latest = numbered[0].docNumber!.trim();

  if (live.some((i) => i.state === 'open')) {
    const status =
      stage === 'registration'
        ? 'Unpaid'
        : live.length > 1
          ? 'Re-invoiced'
          : 'Invoiced';
    return { status, invoice: latest, paymentDate: null };
  }

  // Every live invoice is paid. The payment date is the latest one recorded.
  const paidDates = live
    .map((i) => day(i.paymentDate))
    .filter((d): d is string => !!d)
    .sort();
  const paymentDate = paidDates.length ? paidDates[paidDates.length - 1] : null;

  if (stage === 'registration') {
    // Finished needs a payment date. Without one, hold the status and the
    // stored payment date; only the number is set.
    if (paymentDate === null) return { invoice: latest };
    return { status: 'Finished', invoice: latest, paymentDate };
  }
  // Fees: Paid needs a start date and a payment date. Otherwise the status
  // waits; a payment date is only written when there is one.
  if (paymentDate !== null && !blank(current.startDate))
    return { status: 'Paid', invoice: latest, paymentDate };
  return paymentDate === null
    ? { invoice: latest }
    : { invoice: latest, paymentDate };
}

export function stageFromInvoices(
  stage: QboStageKey,
  invoices: TileInvoice[],
  current: StageSnapshot
): StagePatch | null {
  // Nothing on this tile in QuickBooks (not even voided): the stage was set
  // by staff, or predates QuickBooks. Leave it alone.
  if (invoices.length === 0) return null;
  if (current.status === 'Cancelled') return null;
  return onlyChanges(target(stage, invoices, current), current);
}

export function tileNeedsStartDate(
  stage: QboStageKey,
  invoices: TileInvoice[],
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
