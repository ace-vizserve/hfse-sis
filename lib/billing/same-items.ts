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

export type SameItems = {
  from: string | null;
  lines: SameItemLine[];
  /** Some lines of that invoice were left out (a line with no product). */
  skipped: boolean;
};

/**
 * One stored line as Create invoice's form takes it; null without a product.
 * A negative amount is a discount product (Sibling Discount…) and comes too.
 */
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
    .map((r) => {
      const all = r.lines ?? [];
      const lines = all.map(formLine).filter((l): l is SameItemLine => !!l);
      return { r, lines, skipped: lines.length < all.length };
    })
    .filter((x) => x.lines.length > 0)
    .sort((a, b) =>
      latestFirst(
        { txnDate: a.r.txn_date, docNumber: a.r.doc_number },
        { txnDate: b.r.txn_date, docNumber: b.r.doc_number }
      )
    );
  const top = tied[0];
  return top
    ? { from: top.r.doc_number, lines: top.lines, skipped: top.skipped }
    : null;
}
