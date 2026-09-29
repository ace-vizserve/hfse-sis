/**
 * Pure house-points points and totals.
 *
 * Every event has a rubric: a list of awards, each worth some points. The
 * organiser picks each entrant's award by hand; the entrant earns that award's
 * points. Nothing is ranked automatically and no scores are typed (Mr Ace,
 * 2026-09-29 — the workbook records awards, never scores; KD #228).
 *
 * Two rules, always:
 *  1. No award picked = no points (`place: null, points: 0`).
 *  2. A team/house entry earns its award's points ONCE per DISTINCT house
 *     among its members — `houseIds` on a `SheetEntry` must already be
 *     deduplicated by the caller.
 *
 * No `server-only` import: this module is shared by a server loader and the
 * client score sheet.
 */

export type EventType = 'internal' | 'external' | 'major' | 'attendance';
export type EntrantKind = 'student' | 'team' | 'house';

/**
 * One award on an event's rubric. `rank` is not used to decide anything — it
 * only tells the badge whether to wear a medal colour (1st/2nd/3rd); the
 * award order is `sortOrder`.
 */
export type Place = {
  id: string;
  label: string;
  rank: number | null;
  points: number;
  sortOrder: number;
};

/** One row of a score sheet, already resolved to the houses it credits. */
export type SheetEntry = {
  id: string;
  placeId: string | null;
  /** Distinct house ids this entry credits: [] if a student has no house; a team's DISTINCT member houses. */
  houseIds: string[];
};

export type ResolvedEntry = SheetEntry & {
  place: Place | null;
  points: number;
};

/** place = the award picked for the entry (null when none); points = that award's points, else 0. */
export function resolveEntries(
  entries: SheetEntry[],
  places: Place[]
): ResolvedEntry[] {
  return entries.map((entry) => {
    const place = places.find((p) => p.id === entry.placeId) ?? null;
    return { ...entry, place, points: place?.points ?? 0 };
  });
}

/** Sum each resolved entry's points once into every id in its houseIds. Returns an entry for every id in `houseIds` (0 if nothing). */
export function houseTotals(
  resolved: ResolvedEntry[],
  houseIds: string[]
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const id of houseIds) totals[id] = 0;
  for (const entry of resolved) {
    for (const houseId of entry.houseIds) {
      totals[houseId] = (totals[houseId] ?? 0) + entry.points;
    }
  }
  return totals;
}

/** Adds several event totals together (standings). */
export function sumTotals(
  totals: Record<string, number>[],
  houseIds: string[]
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const id of houseIds) result[id] = 0;
  for (const total of totals) {
    for (const id of houseIds) {
      result[id] += total[id] ?? 0;
    }
  }
  return result;
}

export type TeamHouse = { houseId: string; memberCount: number };

/**
 * A team's DISTINCT houses, in the order its members first name them, with
 * how many members share each. The houses are what a team's award is
 * credited to — once each, never once per member; the counts let the sheet
 * say "Counted once per house" when two members share one. Members with no
 * house are skipped: they take part, but no house is owed their points.
 */
export function teamHouses(
  members: readonly { houseId: string | null }[]
): TeamHouse[] {
  const counts = new Map<string, number>();
  for (const m of members) {
    if (m.houseId === null) continue;
    counts.set(m.houseId, (counts.get(m.houseId) ?? 0) + 1);
  }
  return Array.from(counts, ([houseId, memberCount]) => ({
    houseId,
    memberCount,
  }));
}
