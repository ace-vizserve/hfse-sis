// The grading deadline as an exact instant (migration 186, `terms.grading_lock_at`).
//
// Pure helpers, safe on client and server. Singapore has no daylight saving, so
// Singapore wall time is always UTC+8 and the conversions below are exact.

/** The time a deadline gets when only a day is picked — the whole day, as before. */
export const DEFAULT_LOCK_TIME = '23:59';

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Past the term's lock time and not unlocked since. Mirrors the SQL
 * `public.grading_sheet_past_lock` (migration 186): an unlock AFTER the
 * deadline is a coordinator's deliberate override and reopens the sheet until
 * it is locked again; an unlock from before the deadline does not.
 */
export function isPastGradingLock(
  lockAt: string | null | undefined,
  unlockedAt: string | null | undefined = null,
  now: Date = new Date()
): boolean {
  if (!lockAt) return false;
  const lock = Date.parse(lockAt);
  if (Number.isNaN(lock)) return false;
  if (lock > now.getTime()) return false;
  if (unlockedAt) {
    const unlocked = Date.parse(unlockedAt);
    if (!Number.isNaN(unlocked) && unlocked >= lock) return false;
  }
  return true;
}

/** An ISO instant → Singapore `{ date: 'YYYY-MM-DD', time: 'HH:mm' }`. */
export function sgtPartsFromIso(iso: string | null | undefined): {
  date: string;
  time: string;
} {
  if (!iso) return { date: '', time: '' };
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return { date: '', time: '' };
  const s = new Date(ms + SGT_OFFSET_MS).toISOString(); // shifted, read as UTC
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

/**
 * Singapore date + time → ISO instant. A blank time means the whole day
 * (23:59). Returns null for a blank or malformed date / time.
 */
export function isoFromSgtParts(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = time || DEFAULT_LOCK_TIME;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return null;
  const ms = Date.parse(`${date}T${t}:00+08:00`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** "20 Mar 2026, 11:59 pm" in Singapore time, for chips and messages. */
export function formatSgtLockTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(ms));
}
