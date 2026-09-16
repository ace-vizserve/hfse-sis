// SERVER-ONLY. Creates a service-role client, so this must never be imported
// from a client component — that is why it is its own module rather than
// living in `_shared.ts`, which client bundles do pull in (`resolveModule`,
// `MODULE_VALUES`). Same reason `resolveBacklogBucket` was moved out of
// `dashboard.ts`.
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Every enrolee number in this AY belonging to a child who joined after the
 * year started.
 *
 * The one gate fact that does NOT live in admissions: it is
 * `section_students.enrollment_status = 'late_enrollee'`, and it decides
 * whether the Late Enrolment Form applies. Loaders used to leave it
 * undefined, which `isSlotApplicable` reads as "cannot tell" and hides — so
 * the form was invisible to everyone, everywhere, since it shipped
 * (2026-08-31), while 21 AY2026 children are marked late (measured
 * 2026-09-16).
 *
 * ⚠ THIS EXISTS SO EVERY P-FILES SURFACE ANSWERS THE QUESTION THE SAME WAY.
 * The student page joining the roster while the list did not would mean one
 * child's file reads "x of 22" on their own page and "x of 21" in the list
 * beside it — the count-vs-drill divergence of KD #216, reintroduced through
 * a gate instead of a predicate.
 *
 * ⚠ A mid-year transfer (KD #67) KEEPS the old row as `withdrawn` and inserts
 * a new one with the same `enrolee_number` in the same AY — `E260532` has
 * exactly two AY2026 rows today. So `withdrawn` rows are dropped rather than
 * assuming one row per child, and an earlier version of this using
 * `.maybeSingle()` would have answered two rows with PGRST116 in `error` and
 * `null` in `data`, reading as "not late" for precisely the transferred
 * children the transfer RPC takes care to keep late-enrollee status for.
 *
 * ⚠ Matched on `section_students.enrolee_number`, scoped through
 * sections → academic_years because that column is re-issued each year
 * (Hard Rule #4) and matching on it alone could pick up another year's child.
 * Migration 041 left it nullable and unbackfilled: 3 of 410 AY2026 roster rows
 * carry NULL, none of them late enrollees, so nothing is missed today — but a
 * NULL row can never appear in this set.
 */
export async function loadLateEnrolleeNumbers(
  ayCode: string
): Promise<string[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('section_students')
    .select(
      'enrolee_number, enrollment_status, sections!inner(academic_years!inner(ay_code))'
    )
    .eq('sections.academic_years.ay_code', ayCode);
  if (error) {
    console.error('[p-files] late-enrollee fetch failed:', error.message);
    return [];
  }
  const out = new Set<string>();
  for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
    if (r.enrollment_status !== 'late_enrollee') continue;
    const en = r.enrolee_number;
    if (typeof en === 'string' && en.trim()) out.add(en);
  }
  // An array, not a Set: this crosses `unstable_cache`, which round-trips its
  // payload as JSON and would hand back an empty object for a Set.
  return [...out];
}
