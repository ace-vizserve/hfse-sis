import type { Role } from '@/lib/auth/roles';

/**
 * May the write-up fields on `/evaluation/sections/[sectionId]` be typed in?
 *
 * KD #28: a teacher's textareas stay locked until the academic coordinator sets
 * the term's virtue theme, because the theme is the prompt they are supposed to
 * write against and it is also a hard publish gate. Oversight roles are exempt
 * — they fill gaps and fix typos when an adviser is late, and holding them to a
 * prompt they set themselves would be circular.
 *
 * Lives out here rather than inline on the page so the direction can be tested.
 *
 * ⚠ THIS IS NOT THE AUTHORIZATION GATE. The server counterpart is
 * `app/api/evaluation/writeups/route.ts`, which admits four roles and then —
 * for a `teacher` only — requires a form-adviser row on the section. It has no
 * virtue-theme condition at all, so this predicate is the stricter of the two,
 * and that asymmetry is the safe one: a page more permissive than its route
 * means editable inputs and a 403 on save.
 *
 * 🔴 AND THAT IS EXACTLY WHAT HAPPENED, so `isAdviserOfRecord` is now a
 * parameter rather than something the page assumes. Migration 124 gave HFSE
 * co-advisers; Classroom, Attendance and Markbook all count one as an adviser,
 * so a co-adviser reached the write-up roster with editable fields — and the
 * route, which had never widened, answered 403 on every autosave. The comment
 * above predicted the failure two paragraphs before it shipped. The route is
 * right and stays as it is: the write-up becomes the form class adviser's
 * comment on the report card, and that card prints one name (Mr Ace,
 * 2026-09-09 — "as co teacher the main FCA can only write that up").
 *
 * @param isAdviserOfRecord `teacher` only: is this viewer the section's form
 *   class adviser, rather than a co-adviser? Pass `true` for non-teacher roles
 *   — they are admitted by role and hold no assignment row to check.
 */
export function canEditWriteups(
  role: Role | null,
  hasVirtueTheme: boolean,
  isAdviserOfRecord: boolean
): boolean {
  if (role !== 'teacher') return true;
  return hasVirtueTheme && isAdviserOfRecord;
}
