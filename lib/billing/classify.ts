// Which Registration / Fees tile an invoice belongs to, and for which year.
// Spec "Tile mapping and years". Item names change every year at HFSE; their
// income accounts don't — so accounts map by default and an item override
// handles the shared "Advance customers payment" account. Pure.

export type BillingStage = 'registration' | 'fees';
export type StageChoice = BillingStage | 'none';
export type InvoiceLine = {
  itemId: string | null;
  itemName: string | null;
  accountId: string | null;
  description: string | null;
  qty: number | null;
  amount: number;
};
export type BillingMaps = {
  accounts: Map<string, StageChoice>;
  items: Map<string, StageChoice>;
  ranges: Array<{ ayCode: string; startsOn: string; endsOn: string }>;
};

const ORDER: BillingStage[] = ['registration', 'fees'];

export function classifyInvoice(
  lines: InvoiceLine[],
  txnDate: string | null,
  maps: BillingMaps
): { ayCode: string | null; stageKeys: BillingStage[] } {
  const found = new Set<BillingStage>();
  for (const l of lines) {
    const choice =
      (l.itemId ? maps.items.get(l.itemId) : undefined) ??
      (l.accountId ? maps.accounts.get(l.accountId) : undefined);
    if (choice && choice !== 'none') found.add(choice);
  }
  const date = txnDate?.slice(0, 10) ?? null;
  const range = date
    ? [...maps.ranges]
        .sort((a, b) => a.startsOn.localeCompare(b.startsOn))
        .find((r) => r.startsOn <= date && date <= r.endsOn)
    : undefined;
  if (found.size === 0 || !range) return { ayCode: null, stageKeys: [] };
  return { ayCode: range.ayCode, stageKeys: ORDER.filter((s) => found.has(s)) };
}
