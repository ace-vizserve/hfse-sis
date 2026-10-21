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

/** Stored ids QuickBooks no longer returned. */
export function missingIds(stored: string[], returned: string[]): string[] {
  const back = new Set(returned);
  return stored.filter((id) => !back.has(id));
}
