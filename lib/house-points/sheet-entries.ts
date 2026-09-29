import { teamHouses, type SheetEntry } from '@/lib/house-points/compute';
// Type-only: lib/house-points/queries.ts is `server-only`, and a type import
// is erased before the client bundle sees it.
import type { EventDetail } from '@/lib/house-points/queries';

// The single pure mapper from a resolved EventRow to the SheetEntry shape
// lib/house-points/compute.ts totals.
//
// Its own client-safe module (no `server-only`) because the score sheet runs
// it IN THE BROWSER after every award pick, so points and the header totals
// move straight away rather than waiting for a refetch.
// lib/house-points/queries.ts re-exports it, so the server loaders and the
// client sheet share exactly one copy of the house rules.

/**
 * A team's houseIds are its members' DISTINCT non-null houses (compute.ts
 * credits an award once per distinct house); a student's is `[houseId]` or
 * `[]`; a house row's is `[houseId]`.
 */
export function toSheetEntries(
  detail: Pick<EventDetail, 'rows'>
): SheetEntry[] {
  return detail.rows.map((row) => {
    if (row.kind === 'team') {
      const houseIds = teamHouses(row.team?.members ?? []).map(
        (h) => h.houseId
      );
      return { id: row.entryId, placeId: row.placeId, houseIds };
    }
    if (row.kind === 'house') {
      return {
        id: row.entryId,
        placeId: row.placeId,
        houseIds: row.houseId ? [row.houseId] : [],
      };
    }
    // 'student'
    const s = row.student;
    return {
      id: row.entryId,
      placeId: row.placeId,
      houseIds: s?.houseId ? [s.houseId] : [],
    };
  });
}
