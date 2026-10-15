// Matching a student to their QuickBooks customer. QuickBooks identifies
// customers by the student's full name only (Mr Ace, 2026-10-09), so the match
// is an exact full-name match — case and spacing aside — and anything else is
// the person's to pick. No fuzzy matching: a near miss is a different child as
// often as it is a typo.

export function normalizeName(s: string): string {
  return s.toUpperCase().replace(/\s+/g, ' ').trim();
}

export function studentNameForms(n: {
  enroleeFullName: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
}): string[] {
  const first = (n.firstName ?? '').trim();
  const middle = (n.middleName ?? '').trim();
  const last = (n.lastName ?? '').trim();
  const forms = [
    n.enroleeFullName ?? '',
    last && first
      ? `${last}, ${[first, middle].filter(Boolean).join(' ')}`
      : '',
    last && first ? [first, middle, last].filter(Boolean).join(' ') : '',
  ]
    .map(normalizeName)
    .filter(Boolean);
  return Array.from(new Set(forms));
}

/**
 * The name a new QuickBooks customer gets: the student's full name as the SIS
 * shows it, else "LAST, FIRST MIDDLE". Null when the record has no name.
 */
export function newCustomerName(n: {
  enroleeFullName: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
}): string | null {
  const full = (n.enroleeFullName ?? '').replace(/\s+/g, ' ').trim();
  if (full) return full;
  const first = (n.firstName ?? '').trim();
  const middle = (n.middleName ?? '').trim();
  const last = (n.lastName ?? '').trim();
  if (!last || !first) return null;
  return `${last}, ${[first, middle].filter(Boolean).join(' ')}`;
}

export function exactMatches<T extends { DisplayName: string }>(
  customers: T[],
  forms: string[]
): T[] {
  const wanted = new Set(forms.map(normalizeName));
  return customers.filter((c) => wanted.has(normalizeName(c.DisplayName)));
}
