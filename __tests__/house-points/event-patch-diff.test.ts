import { describe, expect, it } from 'vitest';

import {
  diffEventFields,
  placesUnchanged,
  type EventFieldsForDiff,
  type ExistingPlaceForDiff,
} from '@/lib/house-points/event-patch-diff';
import { toNum } from '@/lib/house-points/queries';
import type { EventPatch, PlaceInput } from '@/lib/schemas/house-points';

// PATCH /api/house-points/events/[eventId] used to write/audit on key
// PRESENCE rather than VALUE CHANGE: resubmitting a whole form unchanged
// (Task 8's edit sheet does exactly this) still ran an UPDATE, stamped
// updated_by/updated_at, and appended an empty `house_points.event.update`
// audit row; an identical `places` array triggered a full
// delete/upsert/insert cycle and its own audit entry. These are the pure
// functions the route now uses to tell "sent" from "changed" — tested
// directly since the route itself isn't unit-tested.

function storedEvent(
  overrides: Partial<EventFieldsForDiff> = {}
): EventFieldsForDiff {
  return {
    name: 'Spelling Bee',
    held_on: '2026-10-01',
    event_type: 'internal',
    entrant_kind: 'student',
    ...overrides,
  };
}

describe('diffEventFields', () => {
  it('produces an empty diff when the patch resubmits every field unchanged', () => {
    const existing = storedEvent();
    const patch: EventPatch = {
      name: existing.name,
      heldOn: existing.held_on,
      // storedEvent()'s default event_type is 'internal' — a creatable
      // type, so this literal (not `existing.event_type`, typed as the
      // wider EventType including 'attendance') stays assignable to
      // EventPatch's narrower CREATABLE_EVENT_TYPE_VALUES.
      eventType: 'internal',
      entrantKind: existing.entrant_kind,
    };
    const { updateData, before, after } = diffEventFields(existing, patch);
    expect(updateData).toEqual({});
    expect(before).toEqual({});
    expect(after).toEqual({});
  });

  it('includes only the fields that actually changed', () => {
    const existing = storedEvent();
    const patch: EventPatch = {
      name: existing.name, // unchanged — must NOT appear
      heldOn: '2026-11-01', // changed
    };
    const { updateData, before, after } = diffEventFields(existing, patch);
    expect(updateData).toEqual({ held_on: '2026-11-01' });
    expect(before).toEqual({ heldOn: '2026-10-01' });
    expect(after).toEqual({ heldOn: '2026-11-01' });
  });

  it('ignores a key the patch never sent at all', () => {
    const existing = storedEvent();
    const { updateData, before, after } = diffEventFields(existing, {});
    expect(updateData).toEqual({});
    expect(before).toEqual({});
    expect(after).toEqual({});
  });

  it('treats an explicit heldOn: null as a real value, not "not sent"', () => {
    const existing = storedEvent({ held_on: null });
    const patch: EventPatch = { heldOn: null };
    const { updateData, before, after } = diffEventFields(existing, patch);
    // Same as stored (null === null) — no change, nothing in the diff.
    expect(updateData).toEqual({});
    expect(before).toEqual({});
    expect(after).toEqual({});
  });

  it('detects clearing heldOn from a date to null', () => {
    const existing = storedEvent({ held_on: '2026-10-01' });
    const patch: EventPatch = { heldOn: null };
    const { updateData, before, after } = diffEventFields(existing, patch);
    expect(updateData).toEqual({ held_on: null });
    expect(before).toEqual({ heldOn: '2026-10-01' });
    expect(after).toEqual({ heldOn: null });
  });
});

function existingPlace(
  overrides: Partial<ExistingPlaceForDiff> = {}
): ExistingPlaceForDiff {
  return { id: 'p1', label: 'Gold', rank: 1, points: 5, ...overrides };
}

function placeInput(overrides: Partial<PlaceInput> = {}): PlaceInput {
  return { id: 'p1', label: 'Gold', rank: 1, points: 5, ...overrides };
}

describe('placesUnchanged', () => {
  it('true for an identical, same-order places array', () => {
    const existing = [
      existingPlace({ id: 'p1', label: 'Gold', rank: 1, points: 5 }),
      existingPlace({ id: 'p2', label: 'Silver', rank: 2, points: 4 }),
    ];
    const patch = [
      placeInput({ id: 'p1', label: 'Gold', rank: 1, points: 5 }),
      placeInput({ id: 'p2', label: 'Silver', rank: 2, points: 4 }),
    ];
    expect(placesUnchanged(existing, patch)).toBe(true);
  });

  it('false when a label differs', () => {
    const existing = [existingPlace()];
    const patch = [placeInput({ label: 'Golden' })];
    expect(placesUnchanged(existing, patch)).toBe(false);
  });

  it('false when the count differs (a place was added or removed)', () => {
    const existing = [existingPlace({ id: 'p1' })];
    const patch = [
      placeInput({ id: 'p1' }),
      placeInput({ id: undefined, label: 'New', rank: 2, points: 3 }),
    ];
    expect(placesUnchanged(existing, patch)).toBe(false);
  });

  it('false when the same rows are merely reordered', () => {
    // Order carries sort_order — a pure reorder of otherwise-identical rows
    // still counts as a change.
    const existing = [
      existingPlace({ id: 'p1', label: 'Gold', rank: 1, points: 5 }),
      existingPlace({ id: 'p2', label: 'Silver', rank: 2, points: 4 }),
    ];
    const patch = [
      placeInput({ id: 'p2', label: 'Silver', rank: 2, points: 4 }),
      placeInput({ id: 'p1', label: 'Gold', rank: 1, points: 5 }),
    ];
    expect(placesUnchanged(existing, patch)).toBe(false);
  });

  it('false when a rank or points value differs', () => {
    const existing = [existingPlace({ points: 5 })];
    expect(placesUnchanged(existing, [placeInput({ points: 6 })])).toBe(false);
    expect(placesUnchanged(existing, [placeInput({ rank: 2 })])).toBe(false);
  });

  it('true for two empty arrays', () => {
    expect(placesUnchanged([], [])).toBe(true);
  });

  // Fix round 2 — `points` is `numeric(6,2)` (migration 181) and
  // supabase-js can hand it back as a STRING ("5.00"), not a number. The
  // route's fetch site normalises through `toNum` (lib/house-points/
  // queries.ts, exported and reused rather than re-implemented) before
  // building `ExistingPlaceForDiff` — these two cases are that contract:
  // normalised input compares correctly, and the shape the bug actually
  // produced (a raw string left in) does not.
  it('true when a stored points value arrives as "5.00" and is normalised via the same toNum the route uses', () => {
    const existing = [existingPlace({ points: toNum('5.00') })];
    const patch = [placeInput({ points: 5 })];
    expect(placesUnchanged(existing, patch)).toBe(true);
  });

  it('regression: an UN-normalised raw string ("5.00") left in existingPlaces breaks the comparison — this is the bug the toNum fetch-site fix closes', () => {
    const existing = [existingPlace({ points: '5.00' as unknown as number })];
    const patch = [placeInput({ points: 5 })];
    expect(placesUnchanged(existing, patch)).toBe(false);
  });
});
