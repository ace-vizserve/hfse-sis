// Dates on the scheme-of-work screens, read from ISO `YYYY-MM-DD` strings.
//
// Parsed by hand rather than through `new Date`, so a machine outside
// Singapore cannot shift a date by a day (same reasoning as lib/sow/weeks.ts).

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

function parts(iso: string): { day: number; month: string } {
  return {
    day: Number(iso.slice(8, 10)),
    month: MONTHS[Number(iso.slice(5, 7)) - 1] ?? '',
  };
}

/** "23 Mar". */
export function formatDay(iso: string): string {
  const p = parts(iso);
  return `${p.day} ${p.month}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Wed 8 Apr". The weekday is read in UTC from the date alone. */
export function formatWeekdayDay(iso: string): string {
  const dow = new Date(
    Date.UTC(
      Number(iso.slice(0, 4)),
      Number(iso.slice(5, 7)) - 1,
      Number(iso.slice(8, 10))
    )
  ).getUTCDay();
  return `${WEEKDAYS[dow]} ${formatDay(iso)}`;
}

/** "23 – 27 Mar", or "30 Mar – 3 Apr" across a month end. */
export function formatRange(startIso: string, endIso: string): string {
  const a = parts(startIso);
  const b = parts(endIso);
  if (startIso === endIso) return `${a.day} ${a.month}`;
  if (a.month === b.month) return `${a.day} – ${b.day} ${b.month}`;
  return `${a.day} ${a.month} – ${b.day} ${b.month}`;
}

/**
 * "26 Oct 2026" for a moment something happened (an ISO timestamp, not a
 * date), read on Singapore's calendar so a late-evening decision is not shown
 * as the next or previous day.
 */
export function formatMoment(ts: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Singapore',
  }).format(new Date(ts));
}

/** "23 Mar – 29 May" for a term, always naming both months. */
export function formatTermRange(
  startIso: string | null,
  endIso: string | null
): string | null {
  if (!startIso || !endIso) return null;
  return `${formatDay(startIso)} – ${formatDay(endIso)}`;
}
