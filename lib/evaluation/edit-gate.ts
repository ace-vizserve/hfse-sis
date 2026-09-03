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
 */
export function canEditWriteups(
  role: Role | null,
  hasVirtueTheme: boolean
): boolean {
  return role !== 'teacher' || hasVirtueTheme;
}
