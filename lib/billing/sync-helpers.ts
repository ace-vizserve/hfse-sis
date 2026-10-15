// Pure helpers for recomputing a student's tiles from the stored invoices.

/**
 * The stored rows that belong to the student's CURRENTLY linked customer. A
 * row with no customer yet (made by the KD #231 tile routes, never re-read
 * since) is kept: it was made for this student. A relinked student's old
 * customer's rows are dropped.
 */
export function rowsOfCustomer<T extends { qbo_customer_id: string | null }>(
  rows: T[],
  customerId: string
): T[] {
  return rows.filter(
    (r) => r.qbo_customer_id === null || r.qbo_customer_id === customerId
  );
}

/**
 * The stored invoice whose number the stage still shows, when that invoice is
 * actually voided (deleted-in-QuickBooks rows are stored as voided). A live
 * invoice that is simply not on this tile (incomplete mapping, outside every
 * year, mapped to none, typed on the wrong stage) returns undefined, so the
 * stage is left alone.
 */
export function voidedMatch<
  T extends { doc_number: string | null; state: 'open' | 'paid' | 'voided' },
>(rows: T[], stageNumber: string): T | undefined {
  const n = stageNumber.trim();
  const same = rows.filter((r) => r.doc_number?.trim() === n);
  if (same.some((r) => r.state !== 'voided')) return undefined;
  return same[0];
}

/** Stored ids QuickBooks no longer returned. */
export function missingIds(stored: string[], returned: string[]): string[] {
  const back = new Set(returned);
  return stored.filter((id) => !back.has(id));
}
