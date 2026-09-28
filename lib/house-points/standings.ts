import type { EventType } from '@/lib/house-points/compute';
import type { HouseRow } from '@/lib/sis/houses';

// Client-safe display helpers shared by the year standings page and an event's
// own header totals, so the two rank houses and word the gap identically.

/** The event-type name as the list and an event's eyebrow both print it. */
export const EVENT_TYPE_SHORT_LABELS: Record<EventType, string> = {
  internal: 'Internal',
  external: 'External',
  major: 'Major event',
  attendance: 'Attendance',
};

/** Points are numeric(6,2) — show up to two decimals, never trailing zeros. */
export function formatPoints(value: number): string {
  return value.toLocaleString('en-SG', { maximumFractionDigits: 2 });
}

/** "12 Mar 2026" from a `date` column's yyyy-mm-dd. */
export function formatEventDate(iso: string): string {
  // Slash form parses as local time; a bare yyyy-mm-dd is UTC midnight and
  // can shift a day outside SGT.
  return new Date(iso.replace(/-/g, '/')).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export type Standing = {
  house: HouseRow;
  total: number;
  place: number;
  gapLabel: string;
};

/**
 * Houses sorted by total, highest first. Ties share a place, and the ranking
 * is DENSE (46, 46, 44 → 1st, 1st, 2nd) — the same rule every event uses.
 *
 * The leader's gap is measured to the next house down; everyone else's to
 * the leader. A house level with the one it is measured against says so.
 */
export function rankStandings(
  houses: HouseRow[],
  totals: Record<string, number>
): Standing[] {
  const sorted = houses
    .map((house) => ({ house, total: totals[house.id] ?? 0 }))
    .sort((a, b) => b.total - a.total || a.house.sortOrder - b.house.sortOrder);
  if (sorted.length === 0) return [];

  const leader = sorted[0];
  let place = 0;
  let previous: number | null = null;
  return sorted.map((row, index) => {
    if (previous === null || row.total !== previous) place += 1;
    previous = row.total;

    let gapLabel: string;
    if (index === 0) {
      const next = sorted[1];
      if (!next) gapLabel = 'The only house';
      else if (next.total === row.total)
        gapLabel = `Level with ${next.house.name}`;
      else
        gapLabel = `${formatPoints(row.total - next.total)} ahead of ${next.house.name}`;
    } else if (row.total === leader.total) {
      gapLabel = `Level with ${leader.house.name}`;
    } else {
      gapLabel = `${formatPoints(leader.total - row.total)} behind ${leader.house.name}`;
    }
    return { ...row, place, gapLabel };
  });
}
