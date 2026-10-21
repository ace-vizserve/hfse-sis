// Create invoice from a stage → "Same items as last time" (spec 2026-10-21):
// the product lines of the most recent invoice tied to the same stage, any
// student, for staff to adjust. Pure; the route reads the rows.

import { latestFirst } from '@/lib/billing/stage-from-invoices';
import type { BillingStage, InvoiceLine } from '@/lib/billing/tie';

export type SameItemsRow = {
  doc_number: string | null;
  txn_date: string | null;
  state: 'open' | 'paid' | 'voided';
  stage_keys: string[] | null;
  lines: InvoiceLine[] | null;
};

export type SameItemLine = {
  itemId: string;
  description: string;
  qty: number;
  unitPrice: number;
};

export type SameItems = { from: string | null; lines: SameItemLine[] };

/** One stored line as Create invoice's form takes it; null without a product. */
function formLine(l: InvoiceLine): SameItemLine | null {
  if (!l.itemId) return null;
  const qty = l.qty && l.qty > 0 ? l.qty : 1;
  return {
    itemId: l.itemId,
    description: l.description ?? '',
    qty,
    unitPrice: Math.round((Number(l.amount) / qty) * 100) / 100,
  };
}

/**
 * The newest live invoice tied to `stage` that has product lines, as form
 * lines. Null when there is none.
 */
export function sameItemsFrom(
  rows: SameItemsRow[],
  stage: BillingStage
): SameItems | null {
  const tied = rows
    .filter((r) => r.state !== 'voided' && (r.stage_keys ?? []).includes(stage))
    .map((r) => ({
      r,
      lines: (r.lines ?? [])
        .map(formLine)
        .filter((l): l is SameItemLine => !!l),
    }))
    .filter((x) => x.lines.length > 0)
    .sort((a, b) =>
      latestFirst(
        { txnDate: a.r.txn_date, docNumber: a.r.doc_number },
        { txnDate: b.r.txn_date, docNumber: b.r.doc_number }
      )
    );
  const top = tied[0];
  return top ? { from: top.r.doc_number, lines: top.lines } : null;
}
