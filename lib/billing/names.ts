// Name keys for matching a SIS student to a QuickBooks customer. HFSE names
// customers "SURNAME, Given M." (production export, 2026-10-15); the SIS has
// lastName / firstName. Both reduce to "surname|first given word", letters
// only, accents dropped — the export showed Ñ mangled, and middle initials and
// emails appended to names vary, so only these two parts are compared.

function letters(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

export function nameKey(
  last: string | null,
  first: string | null
): string | null {
  const sur = letters(last ?? '');
  const given = letters((first ?? '').trim().split(/\s+/)[0] ?? '');
  return sur && given ? `${sur}|${given}` : null;
}

export function customerNameKey(displayName: string): string | null {
  if (displayName.includes(':') || !displayName.includes(',')) return null;
  const [sur, given] = displayName.split(',', 2);
  return nameKey(sur, given);
}

export function cleanDocNumber(v: string | null): string | null {
  const t = (v ?? '').replace(/\s+/g, '').toUpperCase();
  return /^HFSE\d{6}$/.test(t) || /^\d+$/.test(t) ? t : null;
}
