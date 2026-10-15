// Pure helpers for the bulk link run. One QuickBooks customer belongs to one
// student; and a history load that timed out must be resumable.

export const ALREADY_LINKED_REASON = 'already linked to another student';

/**
 * Tries to claim a customer for a student. `claimed` maps customer id → student
 * number (stored links plus this run's proposals). Returns true and records the
 * claim when the customer is free (or already this student's); false when
 * another student holds it.
 */
export function claimCustomer(
  claimed: Map<string, string>,
  customerId: string,
  studentNumber: string
): boolean {
  const holder = claimed.get(customerId);
  if (holder !== undefined && holder !== studentNumber) return false;
  claimed.set(customerId, studentNumber);
  return true;
}

/** Linked students that have no stored invoice and no stored payment yet. */
export function studentsNeedingHistory(
  linked: string[],
  withInvoices: Set<string>,
  withPayments: Set<string>
): string[] {
  return linked.filter((s) => !withInvoices.has(s) && !withPayments.has(s));
}
