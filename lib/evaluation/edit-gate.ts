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
 * ⚠ TAKES THE LENS (`activeRole`), NOT THE ACCOUNT ROLE, and lives out here
 * rather than inline on the page so the direction can be tested. Since the
 * active-role lens landed, a `school_admin` who advises a class can look at the
 * app as a teacher — and in that view she meets the same locked fields her
 * colleagues do. That is the point: an unlensed page renders identically in
 * both views, which is the defect the switcher exists to remove.
 *
 * ⚠ THIS IS NOT THE AUTHORIZATION GATE. The server counterpart is
 * `app/api/evaluation/writeups/route.ts`, which admits four roles and then —
 * for a REAL `teacher` only — requires a form-adviser row on the section. It
 * has no virtue-theme condition at all, so this predicate has always been the
 * stricter of the two, and lensing it makes it stricter again rather than
 * looser. That asymmetry is the safe one: a page more permissive than its route
 * means editable inputs and a 403 on save.
 * `__tests__/evaluation/writeup-edit-gate-lens.test.ts` pins the direction over
 * every role × view pair.
 */
export function canEditWriteups(
  viewRole: Role | null,
  hasVirtueTheme: boolean
): boolean {
  return viewRole !== 'teacher' || hasVirtueTheme;
}
