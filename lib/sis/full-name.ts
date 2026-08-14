/**
 * `Last, First Middle` — the shape the admissions rows already hold
 * ("Cruz, Ana", "TEST, TESTING TWO", "LORENZO, Nathaniel Inigo M.").
 *
 * WHY COMPOSE RATHER THAN SPLIT. The full-name columns used to be typed by
 * hand alongside the three parts, which let the two drift. The fix could go
 * either way — derive the parts from the full name, or the full name from the
 * parts — and only one of them works here.
 *
 * For a STUDENT, the name on class lists, mark sheets and report cards
 * (`public.students`) syncs only from firstName/middleName/lastName, so those
 * have to stay the source of truth or every roster keeps the old name.
 *
 * And splitting is unsafe regardless of that: this school's roll carries
 * DELA CRUZ, SAN JOSE and SANTHOSH KUMAR. A splitter puts the wrong half in the
 * wrong column on every one of them. Composing never has to guess.
 *
 * Case is taken from what the user typed rather than forced — the stored data
 * is inconsistent about it, and imposing a transformation here would fight
 * whatever they meant.
 *
 * Used by the student profile sheet and by all three family panels.
 */
export function composeFullName(values: {
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
}): string {
  const last = values.lastName?.trim() ?? '';
  const rest = [values.firstName, values.middleName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' ');
  if (!last) return rest;
  if (!rest) return last;
  return `${last}, ${rest}`;
}
