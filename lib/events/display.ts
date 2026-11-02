// Plain-text formatting for the staff events pages. Pure — no I/O.

const FALLBACK_ORIGIN = 'https://enrol.hfse.edu.sg';

/** The parent-facing short link for an event: `<origin>/events/<slug>`. */
export function eventShortLink(
  slug: string,
  origin: string | undefined | null
): string {
  const base = (origin?.trim() || FALLBACK_ORIGIN).replace(/\/+$/, '');
  return `${base}/events/${slug}`;
}

/** The same link without `https://`, for showing on screen. */
export function eventShortLinkLabel(link: string): string {
  return link.replace(/^https?:\/\//, '');
}

/** describeLevelScope-style labels may end in a full stop; a table cell should not. */
export function stripTrailingStop(s: string): string {
  return s.replace(/\.+$/, '');
}

const DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const SHORT_DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
});
const WHEN = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Singapore',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const STAMP = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Singapore',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function utcDay(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** "Sat 14 Nov 2026", or "Mon 2 Nov – Fri 6 Nov 2026" for a range. */
export function formatEventDate(
  startsOn: string,
  endsOn: string | null
): string {
  if (!endsOn || endsOn === startsOn) return DAY.format(utcDay(startsOn));
  return `${SHORT_DAY.format(utcDay(startsOn))} – ${DAY.format(utcDay(endsOn))}`;
}

/** "Thu 5 Nov, 5:00 pm" in Singapore time. */
export function formatClosesAt(iso: string): string {
  return WHEN.format(new Date(iso))
    .replace(/\bam\b/i, 'am')
    .replace(/\bpm\b/i, 'pm');
}

/** "27 Oct 2026, 8:14 pm" in Singapore time. */
export function formatStamp(iso: string): string {
  return STAMP.format(new Date(iso));
}

/** Where an event is built and edited. */
export function builderHref(id: string): string {
  return `/sis/admin/events/${id}/build`;
}
