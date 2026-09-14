/**
 * Rules for exchanging two students' section index numbers.
 *
 * Pure TS mirror of the guards inside `swap_section_index_numbers`
 * (migration 147) — the same shape as `lib/sis/index-ordering.ts` mirrors the
 * generate RPC, and for the same reason: the rules are testable without a
 * Postgres instance, and the route can reject a bad pair with a sentence a
 * school admin can act on instead of surfacing a raw database error.
 *
 * The RPC keeps its own copy of every check below. That is deliberate, not
 * duplication for its own sake: this module gives the friendly message, the
 * RPC's copy runs under `SELECT ... FOR UPDATE` and is what actually makes the
 * check atomic against a concurrent transfer or withdrawal. Neither is
 * redundant. When a rule changes here, change it there too.
 *
 * Why a swap is the safe primitive: it is a PERMUTATION. The set of numbers
 * held by the section is identical before and after, so it cannot open a gap,
 * cannot create a duplicate, and cannot bring a retired number back into
 * circulation. Setting one student's number to an arbitrary value can do all
 * three, which is why that is not what this does.
 *
 * Cross-reference: supabase/migrations/147_section_index_swap_and_preview.sql
 */

export type SwapCandidate = {
  /** section_students.id */
  enrolmentId: string;
  sectionId: string;
  indexNumber: number | null;
  enrollmentStatus: 'active' | 'late_enrollee' | 'withdrawn';
  /** For the rejection message — "Last, First". */
  studentName: string;
};

export type SwapRejection =
  | 'same_student'
  | 'not_found'
  | 'wrong_section'
  | 'withdrawn'
  | 'unnumbered';

export type SwapValidation =
  | { ok: true; a: SwapCandidate; b: SwapCandidate }
  | { ok: false; reason: SwapRejection; message: string };

/**
 * Decide whether two roster rows may exchange index numbers.
 *
 * @param sectionId The section the swap was requested on.
 * @param a         The first enrolment, or null/undefined when the id matched
 *                  no row at all.
 * @param b         The second enrolment, same.
 */
export function validateSwap(
  sectionId: string,
  a: SwapCandidate | null | undefined,
  b: SwapCandidate | null | undefined
): SwapValidation {
  if (!a || !b) {
    return {
      ok: false,
      reason: 'not_found',
      message:
        'That student is no longer on this roster. Refresh and try again.',
    };
  }

  if (a.enrolmentId === b.enrolmentId) {
    return {
      ok: false,
      reason: 'same_student',
      message: 'Pick two different students.',
    };
  }

  // Checked before the withdrawn/unnumbered rules: a row from another section
  // is the more fundamental mismatch, and naming it is more useful than
  // telling someone their number is retired in a class they are not in.
  const stray = [a, b].find((r) => r.sectionId !== sectionId);
  if (stray) {
    return {
      ok: false,
      reason: 'wrong_section',
      message: `${stray.studentName} is not in this class.`,
    };
  }

  // A withdrawn student's number is retired and never reused (HFSE rule).
  // Swapping would put it back in circulation.
  const withdrawn = [a, b].find((r) => r.enrollmentStatus === 'withdrawn');
  if (withdrawn) {
    return {
      ok: false,
      reason: 'withdrawn',
      message: `${withdrawn.studentName} has left the class, and their number is kept aside permanently. It can't be swapped.`,
    };
  }

  // Unreachable against today's schema — `section_students.index_number` is
  // `smallint not null` (migration 001, never altered). Kept because the rest
  // of the codebase already models the value as nullable (lib/sis/
  // index-ordering.ts, and the unnumbered-count chip on /sis/sections), so the
  // column going nullable would otherwise land here as a crash rather than a
  // message. Not a state the database currently permits.
  const unnumbered = [a, b].find((r) => r.indexNumber == null);
  if (unnumbered) {
    return {
      ok: false,
      reason: 'unnumbered',
      message: `${unnumbered.studentName} doesn't have a number yet. Use "Generate index" to number the class first.`,
    };
  }

  return { ok: true, a, b };
}

/**
 * Apply a validated swap in memory — the executable statement of what the RPC
 * does, used by the tests to assert the permutation property directly.
 *
 * Returns a new array; the input is not mutated.
 */
export function applySwap<
  T extends { enrolmentId: string; indexNumber: number | null },
>(rows: readonly T[], aId: string, bId: string): T[] {
  const a = rows.find((r) => r.enrolmentId === aId);
  const b = rows.find((r) => r.enrolmentId === bId);
  if (!a || !b) return [...rows];
  return rows.map((r) => {
    if (r.enrolmentId === aId) return { ...r, indexNumber: b.indexNumber };
    if (r.enrolmentId === bId) return { ...r, indexNumber: a.indexNumber };
    return r;
  });
}
