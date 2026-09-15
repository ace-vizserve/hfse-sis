// What the ⌘K palette shows before you type anything.
//
// Client-persisted, no schema — the same "never leaves the browser" shape as
// lib/classroom/student-order.ts. It records where you went, which is a UI
// convenience, not a record: nothing here is read by a route, nothing is
// audited, and losing it costs a user nothing but a second of typing. That is
// why it is localStorage and not a table.
//
// Pure + framework-free so it unit-tests without mounting React. The React
// half is ~15 lines of useState/useEffect in command-palette.tsx.

import type { StudentVerbTarget } from '@/lib/sis/command-palette-nav';

/**
 * Storage key, namespaced per signed-in account.
 *
 * ⚠ NOT a cosmetic detail. Recents hold student names, studentNumbers, levels
 * and enrolment status. School front-desk machines are shared and browser
 * profiles are not: on one unscoped key, the next person to sign in opens ⌘K
 * and reads the previous user's students before typing anything. Scoping by
 * viewer id means a different account simply finds no rows.
 */
export function recentsStorageKey(viewerId: string): string {
  return `sis:palette:recents:${viewerId}`;
}

/** Per kind, not overall — 5 students AND 5 destinations. Raycast-ish recall
 *  without the empty state turning into a second navigation tree. */
export const RECENTS_LIMIT = 5;

export type RecentStudent = StudentVerbTarget & {
  kind: 'student';
  fullName: string;
  /** Denormalised so a recent row renders identically to a search hit
   *  without re-querying — this list is shown before any request fires. */
  level: string | null;
  status: string | null;
};

export type RecentDestination = {
  kind: 'destination';
  href: string;
  label: string;
  /** Module name or route, matching the mono micro-copy of the live rows. */
  hint: string;
};

export type RecentEntry = RecentStudent | RecentDestination;

/** Identity for dedupe. A student is the same student across academic years
 *  when studentNumber matches (Hard Rule #4); an applicant with no
 *  studentNumber falls back to the AY-scoped enrolee number, which is the
 *  only key they have. */
export function recentKey(entry: RecentEntry): string {
  if (entry.kind === 'destination') return `destination:${entry.href}`;
  return entry.studentNumber
    ? `student:${entry.studentNumber}`
    : `student:${entry.ayCode}:${entry.enroleeNumber}`;
}

/**
 * Most-recent-first, deduped, capped per kind. Pure — the caller owns storage.
 *
 * Recency only, deliberately: no frecency, no scoring. A learned ranking that
 * reorders itself is a thing to debug, and five rows do not need one.
 */
export function addRecent(
  existing: readonly RecentEntry[],
  entry: RecentEntry
): RecentEntry[] {
  const key = recentKey(entry);
  const rest = existing.filter((e) => recentKey(e) !== key);
  const next = [entry, ...rest];

  const capped: RecentEntry[] = [];
  let students = 0;
  let destinations = 0;
  for (const e of next) {
    if (e.kind === 'student') {
      if (students >= RECENTS_LIMIT) continue;
      students += 1;
    } else {
      if (destinations >= RECENTS_LIMIT) continue;
      destinations += 1;
    }
    capped.push(e);
  }
  return capped;
}

/** Narrow one unknown parsed value. Storage is user-writable and survives
 *  deploys, so a stored row can be anything — an old shape, hand-edited JSON,
 *  or another tab's bug. Anything that fails these checks is dropped rather
 *  than rendered as a row with `undefined` in it. */
function isRecentEntry(value: unknown): value is RecentEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.kind === 'destination') {
    return typeof v.href === 'string' && typeof v.label === 'string';
  }
  if (v.kind === 'student') {
    return (
      typeof v.fullName === 'string' &&
      typeof v.enroleeNumber === 'string' &&
      typeof v.ayCode === 'string'
    );
  }
  return false;
}

export function parseRecents(raw: string | null): RecentEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentEntry);
  } catch {
    return [];
  }
}

/** Reads storage defensively: a private window, blocked site data or a
 *  disabled-storage browser throws on ACCESS, not just on read, so the whole
 *  thing is wrapped. The palette must still open when this returns []. */
export function readRecents(viewerId: string): RecentEntry[] {
  try {
    return parseRecents(
      window.localStorage.getItem(recentsStorageKey(viewerId))
    );
  } catch {
    return [];
  }
}

/** Best-effort write. A quota error or a blocked store loses the history and
 *  nothing else — never surfaced to the user, because there is no action they
 *  could take and the palette still works without it. */
export function writeRecents(
  viewerId: string,
  entries: readonly RecentEntry[]
): void {
  try {
    window.localStorage.setItem(
      recentsStorageKey(viewerId),
      JSON.stringify(entries)
    );
  } catch {
    // Ignored on purpose — see above.
  }
}
