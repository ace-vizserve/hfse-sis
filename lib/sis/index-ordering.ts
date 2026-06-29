/**
 * Pure TS mirror of `generate_section_index_numbers` (migrations 071→072).
 *
 * This module is the **executable specification** of the SQL RPC's ordering
 * and burned-number rules — it exists specifically so those rules can be
 * unit-tested without a Postgres DB. It is NOT a replacement for the RPC,
 * which is the authoritative runtime implementation.
 *
 * What IS mirrored here (the business rules):
 *   - Bucket by section-tenure date (not enrollment_status enum)
 *   - On-time: enrollment_date IS NULL or <= t1Start → alphabetical (last, first, middle)
 *   - Mid-year: enrollment_date > t1Start → bottom, by (enrollment_date ASC, index_number ASC)
 *   - Withdrawn rows → NEVER touched; their index numbers are burned (skipped on assignment)
 *   - Available numbers = ascending integers with burned set removed
 *
 * What is NOT mirrored (implementation detail, not a business rule):
 *   - The two-phase negative-index staging (required by the non-deferrable
 *     UNIQUE constraint in Postgres; has no analog in in-memory assignment)
 *
 * Cross-reference: supabase/migrations/072_generate_index_section_tenure.sql
 * Drift mitigation: when editing either file, update the other. Both files
 * carry this cross-reference comment.
 */

export type IndexRow = {
  id: string;
  enrollment_status: 'active' | 'late_enrollee' | 'withdrawn';
  /** ISO YYYY-MM-DD, or null when the student enrolled from the start of year */
  enrollment_date: string | null;
  /** Current index number held by this row (may be null if never assigned) */
  index_number: number | null;
  last_name: string;
  first_name: string;
  middle_name: string | null;
};

export type IndexAssignment = {
  id: string;
  index_number: number;
};

/**
 * Compute the new index assignments for a section roster.
 *
 * @param rows      All section_students rows for the section (all statuses).
 * @param t1Start   ISO YYYY-MM-DD of the first day of the school year
 *                  (min term start_date). Pass null when no terms exist —
 *                  all non-withdrawn rows are treated as on-time.
 * @returns         { id, index_number } for every NON-WITHDRAWN row in the
 *                  order they were assigned. Withdrawn rows are excluded from
 *                  the result; their index numbers are burned (skipped).
 */
export function computeIndexAssignments(
  rows: IndexRow[],
  t1Start: string | null
): IndexAssignment[] {
  const withdrawn = rows.filter((r) => r.enrollment_status === 'withdrawn');
  const active = rows.filter((r) => r.enrollment_status !== 'withdrawn');

  // Burned numbers = index numbers held by any withdrawn row.
  const burned = new Set<number>(
    withdrawn.map((r) => r.index_number).filter((n): n is number => n != null)
  );

  // Build the available sequence: 1, 2, 3, ... skipping all burned numbers.
  const needed = active.length;
  const available: number[] = [];
  let i = 1;
  while (available.length < needed) {
    if (!burned.has(i)) available.push(i);
    i++;
  }

  // Determine whether a row is mid-year (joined after T1 started).
  // Null enrollment_date → on-time (enrolled from year start).
  // Null t1Start → no terms defined, treat all as on-time.
  const isMidYear = (r: IndexRow): boolean => {
    if (r.enrollment_date == null || t1Start == null) return false;
    return r.enrollment_date > t1Start;
  };

  // On-time bucket: sort alphabetically by (last_name, first_name, middle_name).
  const onTime = active
    .filter((r) => !isMidYear(r))
    .sort((a, b) => {
      const ln = a.last_name.localeCompare(b.last_name);
      if (ln !== 0) return ln;
      const fn = a.first_name.localeCompare(b.first_name);
      if (fn !== 0) return fn;
      return (a.middle_name ?? '').localeCompare(b.middle_name ?? '');
    });

  // Mid-year bucket: sort by (enrollment_date ASC, existing index_number ASC).
  // Covers both transfers (stored 'active' per KD #67) and late_enrollees.
  const midYear = active
    .filter((r) => isMidYear(r))
    .sort((a, b) => {
      const da = a.enrollment_date ?? '';
      const db = b.enrollment_date ?? '';
      if (da !== db) return da.localeCompare(db);
      return (a.index_number ?? 0) - (b.index_number ?? 0);
    });

  const ordered = [...onTime, ...midYear];

  return ordered.map((row, pos) => ({
    id: row.id,
    index_number: available[pos],
  }));
}

/**
 * "Max + 1" — the index appended for a new late enrollee during a sync run.
 *
 * Mirrors lib/sync/students.ts lines ~102-107 / ~258-259:
 *   const nextIndex = (maxIndexBySection.get(section.id) ?? 0) + 1;
 *
 * A late enrollee who arrives after index numbers are frozen gets appended at
 * the bottom (the highest current number + 1). Withdrawn numbers are NOT
 * excluded here — the sync only knows the currently-enrolled max.
 */
export function nextIndexForSection(existingIndexNumbers: number[]): number {
  if (existingIndexNumbers.length === 0) return 1;
  return Math.max(...existingIndexNumbers) + 1;
}
