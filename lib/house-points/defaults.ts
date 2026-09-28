import type { Scale } from '@/lib/house-points/queries';
import type { PlaceInput } from '@/lib/schemas/house-points';

// Pure helpers behind the event setup form (components/house-points/
// event-setup-fields.tsx). Kept out of the component so they can be tested
// without React, and so the edit sheet (Task 9) shares the exact same rules.
//
// `Scale` is imported as a TYPE only — lib/house-points/queries.ts is
// `server-only`, and a type import is erased before the client bundle sees it.

/**
 * A new event's rubric, copied from the standing point scale for its type.
 *
 * Fresh objects every call, in the scale's own order, with no `id`: an id
 * tells the event routes "update this existing place", and a rubric seeded
 * from a scale has never been saved. The event keeps its own copy from then
 * on, which is why changing a scale never reaches an event already created.
 */
export function placesFromScale(scale: Scale | undefined): PlaceInput[] {
  if (!scale) return [];
  return [...scale.rows]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => ({ label: row.label, rank: row.rank, points: row.points }));
}

/**
 * Whether two rubrics say the same thing — same rows, same order, same
 * label, rank and points. Used to decide whether switching an event's type
 * may refill the rubric silently (it still matches the old defaults) or has
 * to ask first (somebody changed it).
 */
export function sameRubric(a: PlaceInput[], b: PlaceInput[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (place, i) =>
      place.label.trim() === b[i].label.trim() &&
      place.rank === b[i].rank &&
      place.points === b[i].points
  );
}

/** The rank a newly added place takes: one past the highest in use. */
export function nextRank(places: PlaceInput[]): number {
  return (
    places.reduce(
      (max, p) => (p.rank !== null && p.rank > max ? p.rank : max),
      0
    ) + 1
  );
}

/** 1 → "1st", 2 → "2nd", 11 → "11th", 22 → "22nd". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
