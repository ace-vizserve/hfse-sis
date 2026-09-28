import { groupKey, type SheetEntry } from '@/lib/house-points/compute';
// Type-only: lib/house-points/queries.ts is `server-only`, and a type import
// is erased before the client bundle sees it.
import type { EventDetail } from '@/lib/house-points/queries';

// The single pure mapper from a resolved EventRow to the SheetEntry shape
// lib/house-points/compute.ts ranks and totals.
//
// Its own client-safe module (no `server-only`) because the score sheet runs
// it IN THE BROWSER after every keystroke-commit, so placements, points and
// the header totals move with the typing rather than waiting for a refetch.
// lib/house-points/queries.ts re-exports it, so the server loaders and the
// client sheet share exactly one copy of the grouping rules.

/**
 * A student row's group is its ranking scope (`groupKey`); a team's or a
 * house's group is always 'event' — a relay or a banner competition is
 * ranked against every other entrant in the event, never bucketed by section
 * or level. A team's houseIds are its members' DISTINCT non-null houses
 * (compute.ts credits a placement once per distinct house); a student's is
 * `[houseId]` or `[]`; a house row's is `[houseId]`.
 */
export function toSheetEntries(
  detail: Pick<EventDetail, 'rankWithin' | 'rows'>
): SheetEntry[] {
  return detail.rows.map((row) => {
    if (row.kind === 'team') {
      const houseIds = Array.from(
        new Set(
          (row.team?.members ?? [])
            .map((m) => m.houseId)
            .filter((id): id is string => id !== null)
        )
      );
      return {
        id: row.entryId,
        group: 'event',
        score: row.score,
        placeId: row.placeId,
        houseIds,
      };
    }
    if (row.kind === 'house') {
      return {
        id: row.entryId,
        group: 'event',
        score: row.score,
        placeId: row.placeId,
        houseIds: row.houseId ? [row.houseId] : [],
      };
    }
    // 'student'
    const s = row.student;
    return {
      id: row.entryId,
      group: s ? groupKey(detail.rankWithin, s.sectionId, s.levelId) : 'event',
      score: row.score,
      placeId: row.placeId,
      houseIds: s?.houseId ? [s.houseId] : [],
    };
  });
}
