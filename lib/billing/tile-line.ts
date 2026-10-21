// The invoice state of a Registration / Fees stage, from the invoices TIED to
// it (spec 2026-10-21): what the stage route's staff lock reads. The card's
// own line is `stageCardLine` (lib/billing/stage-card.ts). Pure.

export function tileInvoiceState(
  invoices: Array<{ state: 'open' | 'paid' | 'voided' }>
): 'open' | 'paid' | null {
  const live = invoices.filter((i) => i.state !== 'voided');
  if (live.length === 0) return null;
  return live.every((i) => i.state === 'paid') ? 'paid' : 'open';
}
