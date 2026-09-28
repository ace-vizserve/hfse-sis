import {
  teamHouses,
  type EntrantKind,
  type PlacementMode,
  type ResolvedEntry,
} from '@/lib/house-points/compute';
import type { EventRow } from '@/lib/house-points/queries';

// Pure filter logic for the two House Points tables — the year's events list
// and an event's score sheet. No React, no Supabase: the components hold the
// state and the rendering, this file decides which rows match.

// ─── Events table ───────────────────────────────────────────────────────────

/** "Entered as" — the facet reads as the plural of who took part. */
export const ENTRANT_KIND_FILTER_LABELS: Record<EntrantKind, string> = {
  student: 'Students',
  team: 'Teams',
  house: 'Houses',
};

/** "Placed by" — how the event's placements were decided. */
export const PLACEMENT_MODE_FILTER_LABELS: Record<PlacementMode, string> = {
  score: 'Scores',
  pick: 'By hand',
};

/** "Won by" for an event where no house has a point yet. */
export const NO_POINTS_YET = 'No points yet';

/**
 * The house ids with the most points from one event — several on a tie, none
 * when nobody has scored. Returned in the order of `houseIds`.
 */
export function eventWinnerIds(
  totals: Record<string, number>,
  houseIds: readonly string[]
): string[] {
  const top = Math.max(0, ...houseIds.map((id) => totals[id] ?? 0));
  if (top <= 0) return [];
  return houseIds.filter((id) => (totals[id] ?? 0) === top);
}

/** A facet's filterFn body: an empty selection matches every row. */
export function matchesAny(
  selected: unknown,
  values: readonly string[]
): boolean {
  if (!Array.isArray(selected) || selected.length === 0) return true;
  return values.some((v) => selected.includes(v));
}

// ─── Score sheet ────────────────────────────────────────────────────────────

/** House facet value for a student (or team) with no house. */
export const NO_HOUSE = 'no-house';
/** Placement facet value for a row with a result but no place. */
export const NO_PLACEMENT = 'no-placement';
/** Placement facet value for a scored event's row with no score typed. */
export const NO_SCORE_YET = 'no-score';

export type SheetFilter = {
  query: string;
  houses: string[];
  placements: string[];
};

export const EMPTY_SHEET_FILTER: SheetFilter = {
  query: '',
  houses: [],
  placements: [],
};

export function isSheetFilterActive(filter: SheetFilter): boolean {
  return (
    filter.query.trim() !== '' ||
    filter.houses.length > 0 ||
    filter.placements.length > 0
  );
}

/** The house facet values a row answers to: its student's house, or every house its team credits. */
export function rowHouseKeys(row: EventRow): string[] {
  if (row.kind === 'team') {
    const ids = teamHouses(row.team?.members ?? []).map((h) => h.houseId);
    return ids.length > 0 ? ids : [NO_HOUSE];
  }
  if (row.kind === 'house') return row.houseId ? [row.houseId] : [NO_HOUSE];
  return row.student?.houseId ? [row.student.houseId] : [NO_HOUSE];
}

/**
 * The placement facet value a row answers to, from its SAVED value: a place
 * id, "no score yet" (scored events only), or "no placement".
 */
export function rowPlacementKey(
  row: EventRow,
  resolved: ResolvedEntry | undefined,
  placementMode: PlacementMode
): string {
  if (placementMode === 'score' && row.score === null) return NO_SCORE_YET;
  if (placementMode === 'pick' && row.placeId === null) return NO_PLACEMENT;
  return resolved?.place?.id ?? NO_PLACEMENT;
}

/** Everything the search box looks through for one row, lower-cased. */
export function rowSearchText(row: EventRow): string {
  const parts: string[] = [];
  if (row.student) parts.push(row.student.name, row.student.studentNumber);
  if (row.team) {
    parts.push(row.team.name);
    for (const m of row.team.members) parts.push(m.name, m.studentNumber);
  }
  return parts.join('\n').toLowerCase();
}

/**
 * Does a row match the search box? Every word must appear somewhere, so
 * "tan 3" finds TAN, Wei Ming in any row whose number has a 3 — and a name
 * stored "LAST, First" is found by "first last" as well.
 */
export function matchesQuery(row: EventRow, query: string): boolean {
  const words = query
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (words.length === 0) return true;
  const text = rowSearchText(row);
  return words.every((w) => text.includes(w));
}

export function matchesSheetFilter(
  row: EventRow,
  resolved: ResolvedEntry | undefined,
  placementMode: PlacementMode,
  filter: SheetFilter
): boolean {
  if (!matchesQuery(row, filter.query)) return false;
  if (!matchesAny(filter.houses, rowHouseKeys(row))) return false;
  if (
    !matchesAny(filter.placements, [
      rowPlacementKey(row, resolved, placementMode),
    ])
  ) {
    return false;
  }
  return true;
}
