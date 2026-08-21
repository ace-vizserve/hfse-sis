import type { DisciplineRecordType } from '@/lib/schemas/discipline';

// How a disciplinary record is spelled on screen — action item #7.
//
// Deliberately NOT `server-only`. All three surfaces render these: the drawer
// (a client component), the class list and the Records tab (both server). One
// module so a chip, a date or a link can never read differently depending on
// which screen you opened it from.

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
] as const;

/**
 * Splits `YYYY-MM-DD` into its parts, or null if it is not that shape.
 *
 * String surgery, never `new Date(iso)`. That constructor reads a bare ISO date
 * as UTC midnight, so in Singapore (UTC+8) it renders as the day before for
 * anyone west of us and — more to the point here — turns a record filed on the
 * 1st into "31" the moment the browser's clock is behind. The stored value is
 * a calendar day, not an instant; treating it as text keeps it one.
 */
function parts(iso: string | null | undefined) {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: match[1], month: MONTHS[month - 1], day: match[3] };
}

/** `"25 May 2026"`, or the raw value back if it is not a date we understand. */
export function formatRecordDate(iso: string | null | undefined): string {
  const p = parts(iso);
  if (!p) return iso ?? '';
  return `${p.day} ${p.month} ${p.year}`;
}

/**
 * `"27 May"` — for a date that sits beside a fuller one and would only repeat
 * its year, e.g. "Slip back 27 May" under a letter dated 25 May 2026.
 */
export function formatShortDate(iso: string | null | undefined): string {
  const p = parts(iso);
  if (!p) return iso ?? '';
  return `${p.day} ${p.month}`;
}

/** `"12 May 2026 · 14:05"`, or just the date when no time was recorded. */
export function formatRecordWhen(
  occurredOn: string,
  occurredAtTime: string | null
): string {
  const date = formatRecordDate(occurredOn);
  return occurredAtTime ? `${date} · ${occurredAtTime}` : date;
}

/**
 * The §9.3 badge recipes, one per record type. The chip, and only the chip,
 * carries the difference between the two kinds of record — a reader scanning a
 * student's year sees three indigo rows and then a red one, and knows a pattern
 * built up and the school eventually wrote home.
 *
 * A letter is the school acting, so it takes the LOCKED/BLOCKED recipe. An
 * incident is a recorded fact, so it takes the informational one.
 */
export const DISCIPLINE_CHIP_CLASS: Record<DisciplineRecordType, string> = {
  letter: 'border-destructive/40 bg-destructive/10 text-destructive',
  incident: 'border-brand-indigo-soft bg-accent text-brand-indigo-deep',
};

/**
 * The host of a pasted document link, for the second line under it.
 *
 * Parsing only — nothing in this feature ever fetches the link. It is rendered
 * for a person to click, and showing where it points is the one honest thing we
 * can say about a URL we have never followed.
 */
export function linkHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/**
 * The last path segment of a document link, as a stand-in for its name.
 *
 * Falls back to the whole URL. A SharePoint link often ends in the filename,
 * which is far more use on screen than 200 characters of query string — but it
 * may not, so this is a display convenience and never a claim about the file.
 */
export function linkLabel(url: string): string {
  try {
    const path = new URL(url).pathname;
    const last = path.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}
