/**
 * Pure helpers for PATCH /api/house-points/events/[eventId] — no Supabase,
 * so unit-testable directly (the route itself isn't unit-tested).
 *
 * WHY THIS EXISTS. A first pass wrote/audited on key PRESENCE rather than
 * VALUE CHANGE: resubmitting a whole form unchanged (Task 8's edit sheet
 * does exactly this) still ran an UPDATE, stamped updated_by/updated_at, and
 * appended an empty `house_points.event.update` audit row; an identical
 * `places` array triggered a full delete/upsert/insert cycle and its own
 * audit entry. Both helpers below compare against what's actually stored so
 * a no-op PATCH does no write and leaves no audit row — see their call site
 * in app/api/house-points/events/[eventId]/route.ts.
 */

import type {
  EntrantKind,
  EventType,
  PlacementMode,
  RankWithin,
} from '@/lib/house-points/compute';
import type { EventPatch, PlaceInput } from '@/lib/schemas/house-points';

/** The stored event columns `diffEventFields` compares a patch against. */
export type EventFieldsForDiff = {
  name: string;
  held_on: string | null;
  event_type: EventType;
  entrant_kind: EntrantKind;
  placement_mode: PlacementMode;
  max_score: number | null;
  rank_within: RankWithin;
};

// Pairs a patch's camelCase key with the stored row's db column — walked
// once to build both the SQL update payload and the before/after audit diff
// so the two can't drift (a field added to one without the other would
// either silently not persist or silently not audit).
const PATCHABLE_FIELDS = [
  ['name', 'name'],
  ['heldOn', 'held_on'],
  ['eventType', 'event_type'],
  ['entrantKind', 'entrant_kind'],
  ['placementMode', 'placement_mode'],
  ['maxScore', 'max_score'],
  ['rankWithin', 'rank_within'],
] as const satisfies readonly (readonly [
  keyof EventPatch,
  keyof EventFieldsForDiff,
])[];

export type EventFieldDiff = {
  /** Only the db columns whose SENT value actually differs from what's stored. */
  updateData: Record<string, unknown>;
  /** Only the patch keys that actually changed, old value. */
  before: Record<string, unknown>;
  /** Only the patch keys that actually changed, new value. */
  after: Record<string, unknown>;
};

/**
 * Diffs a PATCH body against the stored event row, field by field. A field
 * lands in `updateData`/`before`/`after` ONLY when the sent value differs
 * from what's stored — not merely because the caller included the key.
 */
export function diffEventFields(
  existing: EventFieldsForDiff,
  patch: EventPatch
): EventFieldDiff {
  const updateData: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [patchKey, dbKey] of PATCHABLE_FIELDS) {
    const value = patch[patchKey];
    if (value === undefined) continue;
    if (value !== existing[dbKey]) {
      updateData[dbKey] = value;
      before[patchKey] = existing[dbKey];
      after[patchKey] = value;
    }
  }
  return { updateData, before, after };
}

/** One stored place, as read back for comparison against a submitted `PlaceInput`. */
export type ExistingPlaceForDiff = {
  id: string;
  label: string;
  rank: number | null;
  points: number;
};

/**
 * True when the submitted places array is IDENTICAL to what's stored — same
 * places, same id/label/rank/points, in the same order (order carries
 * `sort_order`, so a pure reorder of otherwise-identical rows still counts
 * as changed). `existingPlaces` must already be ordered by `sort_order`
 * ascending — the caller's fetch is what guarantees that, not this function.
 */
export function placesUnchanged(
  existingPlaces: readonly ExistingPlaceForDiff[],
  patchPlaces: readonly PlaceInput[]
): boolean {
  if (existingPlaces.length !== patchPlaces.length) return false;
  return existingPlaces.every((existing, index) => {
    const incoming = patchPlaces[index];
    return (
      incoming.id === existing.id &&
      incoming.label === existing.label &&
      incoming.rank === existing.rank &&
      incoming.points === existing.points
    );
  });
}
