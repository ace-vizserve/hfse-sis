import { describe, expect, it } from 'vitest';

import {
  AddEntriesSchema,
  EntryPatchSchema,
  EventInputSchema,
  EventPatchSchema,
  PlaceInputSchema,
  ScalesPutSchema,
  TeamInputSchema,
  TeamPatchSchema,
  type PlaceInput,
} from '@/lib/schemas/house-points';

const STUDENT_A = '725638d7-dae7-4b9d-ae71-681005f0083a';
const STUDENT_B = '1b2ba08d-5597-404d-806c-5ead6288f460';
const HOUSE_A = 'eef73bee-094b-4904-b875-c5c99229fc5a';

function place(overrides: Partial<PlaceInput> = {}): PlaceInput {
  return { label: 'Gold', rank: 1, points: 5, ...overrides };
}

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    ayCode: 'AY2026',
    name: 'Spelling Bee',
    heldOn: '2026-10-01',
    eventType: 'internal' as const,
    entrantKind: 'student' as const,
    places: [
      place({ label: 'Gold', rank: 1, points: 5 }),
      place({ label: 'Silver', rank: 2, points: 4 }),
      place({ label: 'Participation', rank: null, points: 1 }),
    ],
    ...overrides,
  };
}

describe('PlaceInputSchema', () => {
  it('accepts an award with a medal rank', () => {
    expect(PlaceInputSchema.safeParse(place()).success).toBe(true);
  });

  it('accepts an unranked award such as Participation', () => {
    expect(PlaceInputSchema.safeParse(place({ rank: null })).success).toBe(
      true
    );
  });

  it('rejects an empty label', () => {
    expect(PlaceInputSchema.safeParse(place({ label: ' ' })).success).toBe(
      false
    );
  });

  it('rejects points above 1000', () => {
    expect(PlaceInputSchema.safeParse(place({ points: 1001 })).success).toBe(
      false
    );
  });

  it('rejects a rank below 1', () => {
    expect(PlaceInputSchema.safeParse(place({ rank: 0 })).success).toBe(false);
  });
});

describe('EventInputSchema — a rubric of awards', () => {
  it('accepts a well-formed event', () => {
    expect(EventInputSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it('accepts house, team and student entrants alike', () => {
    for (const entrantKind of ['student', 'team', 'house']) {
      expect(
        EventInputSchema.safeParse(baseEvent({ entrantKind })).success
      ).toBe(true);
    }
  });

  it('places no rule on ranks — duplicates, gaps and several unranked awards are all fine', () => {
    const result = EventInputSchema.safeParse(
      baseEvent({
        places: [
          place({ label: 'Gold', rank: 1, points: 5 }),
          place({ label: 'Also Gold', rank: 1, points: 5 }),
          place({ label: 'Bronze', rank: 3, points: 3 }),
          place({ label: 'Merit', rank: null, points: 2 }),
          place({ label: 'Participation', rank: null, points: 1 }),
        ],
      })
    );
    expect(result.success).toBe(true);
  });

  it('needs at least one award', () => {
    const result = EventInputSchema.safeParse(baseEvent({ places: [] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.includes('Add at least one award')
        )
      ).toBe(true);
    }
  });

  it('ignores the removed score fields — a stale client cannot set them', () => {
    const result = EventInputSchema.safeParse(
      baseEvent({ placementMode: 'score', maxScore: 50, rankWithin: 'level' })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('placementMode');
      expect(result.data).not.toHaveProperty('maxScore');
      expect(result.data).not.toHaveProperty('rankWithin');
    }
  });
});

describe('EventInputSchema — attendance rejection', () => {
  it('rejects eventType "attendance"', () => {
    const result = EventInputSchema.safeParse(
      baseEvent({ eventType: 'attendance' })
    );
    expect(result.success).toBe(false);
  });
});

describe('EventPatchSchema', () => {
  it('{} succeeds — an empty patch is a no-op, not an error', () => {
    // Unlike EntryPatchSchema/TeamPatchSchema, EventPatchSchema carries no
    // "at least one field" rule — the route answers `{ changed: false }`.
    expect(EventPatchSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a places-only patch', () => {
    expect(
      EventPatchSchema.safeParse({
        places: [place({ label: 'Winner', rank: null, points: 20 })],
      }).success
    ).toBe(true);
  });

  it('strips the removed score fields', () => {
    const result = EventPatchSchema.safeParse({
      placementMode: 'score',
      maxScore: 10,
      rankWithin: 'section',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({});
  });
});

describe('ScalesPutSchema — attendance IS accepted here', () => {
  it('accepts eventType "attendance" for the scale (unlike EventInputSchema)', () => {
    const result = ScalesPutSchema.safeParse({
      eventType: 'attendance',
      rows: [
        { label: '100% attendance', rank: null, points: 1 },
        { label: 'No lates', rank: null, points: 2 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown event type', () => {
    const result = ScalesPutSchema.safeParse({
      eventType: 'not-a-type',
      rows: [{ label: 'x', rank: null, points: 1 }],
    });
    expect(result.success).toBe(false);
  });
});

describe('AddEntriesSchema — exactly one of sectionStudentIds / houseIds', () => {
  it('valid: sectionStudentIds only', () => {
    expect(
      AddEntriesSchema.safeParse({ sectionStudentIds: [STUDENT_A, STUDENT_B] })
        .success
    ).toBe(true);
  });

  it('valid: houseIds only', () => {
    expect(AddEntriesSchema.safeParse({ houseIds: [HOUSE_A] }).success).toBe(
      true
    );
  });

  it('invalid: neither present', () => {
    expect(AddEntriesSchema.safeParse({}).success).toBe(false);
  });

  it('invalid: both present', () => {
    expect(
      AddEntriesSchema.safeParse({
        sectionStudentIds: [STUDENT_A],
        houseIds: [HOUSE_A],
      }).success
    ).toBe(false);
  });
});

describe('EntryPatchSchema — an award, or none', () => {
  it('valid: an award id', () => {
    expect(EntryPatchSchema.safeParse({ placeId: HOUSE_A }).success).toBe(true);
  });

  it('valid: null clears the award', () => {
    expect(EntryPatchSchema.safeParse({ placeId: null }).success).toBe(true);
  });

  it('rejects an empty object', () => {
    expect(EntryPatchSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a score — scores are no longer entered', () => {
    expect(EntryPatchSchema.safeParse({ score: 10 }).success).toBe(false);
  });

  it('drops a score sent alongside an award', () => {
    const result = EntryPatchSchema.safeParse({ placeId: HOUSE_A, score: 10 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ placeId: HOUSE_A });
  });
});

describe('TeamInputSchema / TeamPatchSchema', () => {
  it('accepts a well-formed team', () => {
    expect(
      TeamInputSchema.safeParse({
        name: 'Relay Squad',
        sectionStudentIds: [STUDENT_A, STUDENT_B],
      }).success
    ).toBe(true);
  });

  it('rejects a patch with neither key', () => {
    expect(TeamPatchSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a patch with only a name', () => {
    expect(TeamPatchSchema.safeParse({ name: 'Renamed' }).success).toBe(true);
  });
});
