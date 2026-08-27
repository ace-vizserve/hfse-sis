// Date formatting for the declarations queue.
//
// ⚠ `YYYY-MM-DD` strings are split by hand rather than fed to `new Date(iso)`.
// A bare date parsed that way is treated as UTC midnight and then rendered in
// the viewer's zone, which moves it a day for anyone west of Greenwich. The
// same class of slip once shifted the relief cover board by a whole month
// (`Date.UTC` takes a zero-indexed month), and every date comparison in the
// declarations schema is deliberately lexicographic for the same reason.

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function parts(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** `16 Sep 2026`. */
export function formatDay(iso: string): string {
  const p = parts(iso);
  if (!p) return iso ?? '—';
  return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

/**
 * `16 Sep 2026` for one day, `16–18 Sep 2026` inside a month,
 * `28 Sep – 2 Oct 2026` across one.
 *
 * A single day is the common case, so it should not read like a range.
 */
export function formatDayRange(startIso: string, endIso: string): string {
  const a = parts(startIso);
  const b = parts(endIso);
  if (!a || !b) return `${formatDay(startIso)} – ${formatDay(endIso)}`;
  if (startIso === endIso) return formatDay(startIso);
  if (a.y === b.y && a.m === b.m) {
    return `${a.d}–${b.d} ${MONTHS[a.m - 1]} ${a.y}`;
  }
  if (a.y === b.y) {
    return `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]} ${a.y}`;
  }
  return `${formatDay(startIso)} – ${formatDay(endIso)}`;
}

/** A timestamp, shown as the day it happened. */
export function formatFiledAt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** A timestamp with the time, for a decision trail where order matters. */
export function formatDecidedAt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
