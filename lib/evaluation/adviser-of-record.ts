import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';

// The write scope for write-ups, and the ONLY place in the Evaluation module
// that still names the `form_adviser` role literal.
//
// ── WHY THIS IS ITS OWN FILE ───────────────────────────────────────────────
//
// Everywhere else in the app, a co-adviser is an adviser: migration 124 says a
// co role carries the same access as its primary, `is_adviser_for_section`
// admits them, and Classroom, Attendance and Markbook all resolve them through
// `isAdviserRole`. Evaluation is the one exception, and it is a narrow one —
// the write-up is not class work. It becomes the form class adviser's comment
// on the report card, and that card prints one name (KD #158).
//
// Mr Ace, 2026-09-09, shown that a co-adviser could open the write-up roster
// and then get a 403 on save: "as co teacher the main FCA can only write that
// up."
//
// Sitting beside `listAdvisedSectionIds` in queries.ts, this function read as a
// near-duplicate of it — one `.eq` where the other has an `.in`, four lines
// apart. That is the shape somebody deletes as an oversight during a sweep,
// and deleting it hands one teacher's report card comment to another. Out here
// the difference is the file name.
//
// ⚠ DOES NOT SEE RELIEF COVER, and must not. The regular adviser keeps their
// write-ups while a substitute covers the class (Mr Ace, 2026-08-11), and
// `evaluation_writeups` has no adviser predicate in RLS at all (migration 018)
// — this is the enforcement, not a convenience on top of it.
//
// Classified `of_record` in `__tests__/auth/assignment-read-classification.test.ts`,
// which asserts this file never reaches for `isAdviserRole` / `ADVISER_ROLES`.

/**
 * Is this assignment row the adviser OF RECORD?
 *
 * The pure half, for callers that already hold the rows and should not pay for
 * a second query to ask one question about them. Deliberately lives here rather
 * than beside `isAdviserRole` in `lib/schemas/teacher-assignment.ts`: the guard
 * scans this file and not that one, so keeping the two predicates apart is what
 * makes "which one did this call site mean" answerable by a reader.
 */
export function isAdviserOfRecordRole(role: string): boolean {
  return role === 'form_adviser';
}

/**
 * Sections where this user is the adviser OF RECORD — the one name on the
 * report card, and the only person who may write that section's write-ups.
 *
 * A co-adviser is deliberately absent from the result.
 */
export async function listAdviserOfRecordSectionIds(
  userId: string
): Promise<Set<string>> {
  const service = createServiceClient();
  const { data } = await service
    .from('teacher_assignments')
    .select('section_id')
    .eq('teacher_user_id', userId)
    .eq('role', 'form_adviser');
  return new Set((data ?? []).map((r) => r.section_id as string));
}
