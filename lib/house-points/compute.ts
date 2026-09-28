/**
 * Pure house-points placement and scoring.
 *
 * Three rules, always:
 *  1. Dense ranking: distinct scores rank consecutively (46, 46, 44 -> 1, 1, 2)
 *     within an event's `group` — never skip-ranking, and each group ranks
 *     independently.
 *  2. Blank != zero: a `null` score is never ranked and is never placed
 *     (`place: null, points: 0`); a `0` score is a real, ranked score.
 *  3. A team/house entry earns its place's points ONCE per DISTINCT house
 *     among its members — `houseIds` on a `SheetEntry` must already be
 *     deduplicated by the caller.
 *
 * No `server-only` import: this module is shared by a server loader and the
 * client score sheet.
 */

export type EventType = 'internal' | 'external' | 'major' | 'attendance';
export type EntrantKind = 'student' | 'team' | 'house';
export type PlacementMode = 'score' | 'pick';
export type RankWithin = 'section' | 'level' | 'event';

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
  /** Ranking group key: section id, level id, or 'event'. Teams and houses always use 'event'. */
  group: string;
  score: number | null;
  placeId: string | null;
  /** Distinct house ids this entry credits: [] if a student has no house; a team's DISTINCT member houses. */
  houseIds: string[];
};

export type ResolvedEntry = SheetEntry & {
  place: Place | null;
  points: number;
};

/** Score mode: dense rank within `group` (desc; null never ranked) → place with that rank, else the rank-null place, else null.
 *  Pick mode: place = places.find(p => p.id === entry.placeId) ?? null. points = place?.points ?? 0. */
export function resolveEntries(
  entries: SheetEntry[],
  places: Place[],
  mode: PlacementMode
): ResolvedEntry[] {
  if (mode === 'pick') {
    return entries.map((entry) => {
      const place = places.find((p) => p.id === entry.placeId) ?? null;
      return { ...entry, place, points: place?.points ?? 0 };
    });
  }

  const placeByRank = new Map<number, Place>();
  let catchAll: Place | null = null;
  for (const place of places) {
    if (place.rank === null) {
      catchAll = place;
    } else {
      placeByRank.set(place.rank, place);
    }
  }

  // Distinct, descending non-null scores per group — index+1 is the dense rank.
  const scoresByGroup = new Map<string, number[]>();
  for (const entry of entries) {
    if (entry.score === null) continue;
    const list = scoresByGroup.get(entry.group);
    if (list) list.push(entry.score);
    else scoresByGroup.set(entry.group, [entry.score]);
  }
  const rankedScoresByGroup = new Map<string, number[]>();
  for (const [group, scores] of scoresByGroup) {
    rankedScoresByGroup.set(
      group,
      Array.from(new Set(scores)).sort((a, b) => b - a)
    );
  }

  return entries.map((entry) => {
    if (entry.score === null) {
      return { ...entry, place: null, points: 0 };
    }
    const ranked = rankedScoresByGroup.get(entry.group) ?? [];
    const rank = ranked.indexOf(entry.score) + 1;
    const place = placeByRank.get(rank) ?? catchAll ?? null;
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

/** Group key helper for a student row. */
export function groupKey(
  rankWithin: RankWithin,
  sectionId: string,
  levelId: string
): string {
  if (rankWithin === 'section') return sectionId;
  if (rankWithin === 'level') return levelId;
  return 'event';
}
