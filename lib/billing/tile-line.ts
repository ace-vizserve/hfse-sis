// The one read-only line on the Registration and Fees tiles (spec "Screens"):
// "Paid · HFSE062240 · 12 Oct". Worked out from the invoices the mapping puts
// on the tile; the stage itself is filled by the sync. Pure.

import {
  tileNeedsStartDate,
  type TileInvoice,
} from '@/lib/billing/stage-from-invoices';
import { formatShortDay } from '@/lib/billing/view';
import { formatSgd } from '@/lib/qbo/format';

export type TileLine = {
  text: string;
  tone: 'paid' | 'open' | 'attention' | 'none';
};

export function tileInvoiceState(
  invoices: Array<{ state: 'open' | 'paid' | 'voided' }>
): 'open' | 'paid' | null {
  const live = invoices.filter((i) => i.state !== 'voided');
  if (live.length === 0) return null;
  return live.every((i) => i.state === 'paid') ? 'paid' : 'open';
}

export function tileLine(
  stage: 'registration' | 'fees',
  invoices: Array<TileInvoice & { balance: number }>,
  current: { status: string | null; startDate: string | null }
): TileLine {
  const live = invoices
    .filter((i) => i.state !== 'voided')
    .sort(
      (a, b) =>
        (b.txnDate ?? '').localeCompare(a.txnDate ?? '') ||
        (b.docNumber ?? '').localeCompare(a.docNumber ?? '', undefined, {
          numeric: true,
        })
    );
  if (live.length === 0)
    return { text: 'Not billed in QuickBooks yet', tone: 'none' };
  const latest = live[0].docNumber ?? 'Invoice';
  if (live.every((i) => i.state === 'paid')) {
    if (
      tileNeedsStartDate(stage, live, {
        status: current.status,
        invoice: latest,
        paymentDate: null,
        startDate: current.startDate,
      })
    )
      return {
        text: 'Paid in QuickBooks — add the start date',
        tone: 'attention',
      };
    const paidOn =
      live
        .map((i) => i.paymentDate)
        .filter((d): d is string => !!d)
        .sort()
        .at(-1) ?? null;
    return {
      text: ['Paid', latest, formatShortDay(paidOn)]
        .filter(Boolean)
        .join(' · '),
      tone: 'paid',
    };
  }
  const owed = live.reduce((s, i) => s + Math.max(0, i.balance), 0);
  const label =
    stage === 'registration'
      ? 'Unpaid'
      : live.length > 1
        ? 'Re-invoiced'
        : 'Invoiced';
  return {
    text: `${label} · ${latest} · ${formatSgd(owed)} owed`,
    tone: 'open',
  };
}
