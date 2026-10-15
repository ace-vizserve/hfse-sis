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

/**
 * Linked students whose history load never finished (no `history_loaded_at`),
 * plus this run's new links. A load that timed out part-way is resumed.
 */
export function studentsNeedingHistory(
  stored: Array<{ studentNumber: string; historyLoadedAt: string | null }>,
  newlyLinked: string[]
): string[] {
  return [
    ...new Set([
      ...stored.filter((r) => !r.historyLoadedAt).map((r) => r.studentNumber),
      ...newlyLinked,
    ]),
  ];
}
