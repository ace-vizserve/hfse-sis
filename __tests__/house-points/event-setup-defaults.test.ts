import { describe, expect, it } from 'vitest';

import { placesFromScale } from '@/lib/house-points/defaults';
import type { Scale } from '@/lib/house-points/queries';

// placesFromScale seeds a new event's rubric from the standing point scale for
// its type. The event keeps its OWN copy from then on — editing a scale never
// reaches an event already created — so the rows it returns must be fresh
// objects, and must carry no `id` (an id tells the event routes "update this
// existing place", and a brand-new rubric has none).

const scale: Scale = {
  eventType: 'internal',
  rows: [
    { label: '2nd place', rank: 2, points: 7, sortOrder: 2 },
    { label: '1st place', rank: 1, points: 10, sortOrder: 1 },
    { label: 'Participation', rank: null, points: 1.5, sortOrder: 4 },
    { label: '3rd place', rank: 3, points: 5, sortOrder: 3 },
  ],
};

describe('placesFromScale', () => {
  it('maps the rows in the scale order', () => {
    expect(placesFromScale(scale)).toEqual([
      { label: '1st place', rank: 1, points: 10 },
      { label: '2nd place', rank: 2, points: 7 },
      { label: '3rd place', rank: 3, points: 5 },
      { label: 'Participation', rank: null, points: 1.5 },
    ]);
  });

  it('keeps the unranked "everyone else" row as rank null', () => {
    const catchAll = placesFromScale(scale).filter((p) => p.rank === null);
    expect(catchAll).toHaveLength(1);
    expect(catchAll[0].label).toBe('Participation');
  });

  it('returns new objects with no id', () => {
    const places = placesFromScale(scale);
    for (const place of places) {
      expect(place).not.toHaveProperty('id');
      expect(place).not.toHaveProperty('sortOrder');
      expect(scale.rows).not.toContain(place);
    }
  });

  it('returns an empty rubric when the type has no scale', () => {
    expect(placesFromScale(undefined)).toEqual([]);
  });
});
