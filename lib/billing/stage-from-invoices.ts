// Registration / Fees stage from ALL the invoices the mapping puts on the tile
// (spec "Tile status from invoices"). Stateless: no stored "current invoice",
// so a reopened, voided or late-arriving invoice always lands right. Pure.

import {
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

const blank = (v: string | null | undefined) => !v || !v.trim();

function latestFirst(a: TileInvoice, b: TileInvoice): number {
  return (
    (b.txnDate ?? '').localeCompare(a.txnDate ?? '') ||
    (b.docNumber ?? '').localeCompare(a.docNumber ?? '')
  );
}

function target(
  stage: QboStageKey,
  invoices: TileInvoice[],
  current: StageSnapshot
): StagePatch {
  const live = invoices.filter((i) => i.state !== 'voided').sort(latestFirst);
  if (live.length === 0)
    return { status: 'Pending', invoice: null, paymentDate: null };
  const latest = live[0].docNumber;
  if (live.some((i) => i.state === 'open')) {
    const status =
      stage === 'registration'
        ? 'Unpaid'
        : live.length > 1
          ? 'Re-invoiced'
          : 'Invoiced';
    return { status, invoice: latest, paymentDate: null };
  }
  const paid = live
    .map((i) => i.paymentDate)
    .filter((d): d is string => !!d)
    .sort();
  const paymentDate = paid.length ? paid[paid.length - 1] : null;
  if (stage === 'registration')
    return { status: 'Finished', invoice: latest, paymentDate };
  if (!blank(current.startDate))
    return { status: 'Paid', invoice: latest, paymentDate };
  return { invoice: latest, paymentDate };
}

export function stageFromInvoices(
  stage: QboStageKey,
  invoices: TileInvoice[],
  current: StageSnapshot
): StagePatch | null {
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
