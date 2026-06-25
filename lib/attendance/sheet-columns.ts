export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** 'YYYY-MM' bucket key for an ISO date. */
export function monthKeyOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** 'June 2026' display label for a 'YYYY-MM' key. */
export function monthLabelOf(monthKey: string): string {
  const [y, m] = monthKey.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}
