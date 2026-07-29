// Turns a raw DB column name into a readable label for the export sheet's
// raw-column preset path — e.g. `preferredPaymentScheme` →
// "Preferred Payment Scheme". Deliberately separate from
// lib/audit/humanize.ts's private humanizeKey, which carries audit-specific
// label overrides (e.g. renaming identifier columns) that would be
// misleading as a raw CSV column header here.
export function humanizeFieldName(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return spaced
    .split(' ')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}
