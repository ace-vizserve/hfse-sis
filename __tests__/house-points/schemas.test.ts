import { describe, expect, it } from 'vitest';

import {
  AddEntriesSchema,
  EntryPatchSchema,
  EventInputSchema,
  EventPatchSchema,
  mergedEventIssues,
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
    placementMode: 'score' as const,
    maxScore: 100,
    rankWithin: 'event' as const,
    places: [
      place({ label: 'Gold', rank: 1, points: 5 }),
      place({ label: 'Silver', rank: 2, points: 4 }),
      place({ label: 'Participation', rank: null, points: 1 }),
    ],
    ...overrides,
  };
}

describe('PlaceInputSchema', () => {
  it('accepts a ranked place', () => {
    expect(PlaceInputSchema.safeParse(place()).success).toBe(true);
  });

  it('accepts a null-rank "everyone else" place', () => {
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

describe('EventInputSchema — happy path', () => {
  it('accepts a well-formed score-mode event', () => {
    const result = EventInputSchema.safeParse(baseEvent());
    expect(result.success).toBe(true);
  });

  it('accepts a well-formed pick-mode event with no maxScore', () => {
    const result = EventInputSchema.safeParse(
      baseEvent({
        placementMode: 'pick',
        maxScore: null,
        places: [
          place({ label: 'Winner', rank: 1, points: 20 }),
          place({ label: 'Participation', rank: null, points: 5 }),
        ],
      })
    );
    expect(result.success).toBe(true);
  });
});

describe('EventInputSchema — score mode needs maxScore', () => {
  it('valid: score mode with a maxScore', () => {
    expect(
      EventInputSchema.safeParse(
        baseEvent({ placementMode: 'score', maxScore: 50 })
      ).success
    ).toBe(true);
  });

  it('invalid: score mode with maxScore null', () => {
    const result = EventInputSchema.safeParse(
      baseEvent({ placementMode: 'score', maxScore: null })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.includes('Enter the highest possible score')
        )
      ).toBe(true);
    }
  });
});

describe('EventInputSchema — house entrants must use pick mode', () => {
  it('valid: house entrant with pick mode', () => {
    expect(
      EventInputSchema.safeParse(
        baseEvent({
          entrantKind: 'house',
          placementMode: 'pick',
          maxScore: null,
          places: [
            place({ label: 'Winner', rank: 1, points: 20 }),
            place({ label: 'Participation', rank: null, points: 5 }),
          ],
        })
      ).success
    ).toBe(true);
  });

  it('invalid: house entrant with score mode', () => {
    const result = EventInputSchema.safeParse(
      baseEvent({ entrantKind: 'house', placementMode: 'score', maxScore: 50 })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.includes('Houses are placed by hand')
        )
      ).toBe(true);
    }
  });
});

describe('EventInputSchema — ranks among places must be unique', () => {
  it('valid: no two places share a rank', () => {
    expect(EventInputSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it('invalid: two places share rank 1', () => {
    const result = EventInputSchema.safeParse(
      baseEvent({
        places: [
          place({ label: 'Gold', rank: 1, points: 5 }),
          place({ label: 'Also Gold', rank: 1, points: 5 }),
        ],
      })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.includes("can't share the same rank")
        )
      ).toBe(true);
    }
  });
});

describe('EventInputSchema — at most one "everyone else" place', () => {
  it('valid: one null-rank place', () => {
    expect(EventInputSchema.safeParse(baseEvent()).success).toBe(true);
  });

  it('invalid: two null-rank places', () => {
    const result = EventInputSchema.safeParse(
      baseEvent({
        places: [
          place({ label: 'Gold', rank: 1, points: 5 }),
          place({ label: 'Participation A', rank: null, points: 1 }),
          place({ label: 'Participation B', rank: null, points: 1 }),
        ],
      })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.includes("Only one row can be 'everyone else'")
        )
      ).toBe(true);
    }
  });
});

describe('EventInputSchema — score-mode ranks must be gapless', () => {
  it('valid: ranks run 1, 2, 3 with no gaps', () => {
    const result = EventInputSchema.safeParse(
      baseEvent({
        places: [
          place({ label: 'Gold', rank: 1, points: 5 }),
          place({ label: 'Silver', rank: 2, points: 4 }),
          place({ label: 'Bronze', rank: 3, points: 3 }),
        ],
      })
    );
    expect(result.success).toBe(true);
  });

  it('invalid: ranks skip from 1 to 3', () => {
    const result = EventInputSchema.safeParse(
      baseEvent({
        places: [
          place({ label: 'Gold', rank: 1, points: 5 }),
          place({ label: 'Bronze', rank: 3, points: 3 }),
        ],
      })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message.includes('without gaps'))
      ).toBe(true);
    }
  });

  it('valid: pick mode may skip ranks (no gapless rule applies)', () => {
    const result = EventInputSchema.safeParse(
      baseEvent({
        placementMode: 'pick',
        maxScore: null,
        places: [
          place({ label: 'Gold', rank: 1, points: 5 }),
          place({ label: 'Bronze', rank: 3, points: 3 }),
        ],
      })
    );
    expect(result.success).toBe(true);
  });
});

describe('EventInputSchema — attendance rejection', () => {
  it('rejects eventType "attendance"', () => {
    const result = EventInputSchema.safeParse(
      baseEvent({
        eventType: 'attendance',
        placementMode: 'pick',
        maxScore: null,
      })
    );
    expect(result.success).toBe(false);
  });
});

describe('EventPatchSchema — cross-field refinements only fire when both relevant keys are in the same patch', () => {
  it('(a) valid: placementMode "score" with no maxScore key at all (single-key patch)', () => {
    // The stored row's maxScore is what decides here — this schema has no
    // way to see it, so a patch that only touches placementMode must not be
    // rejected for a field it never mentioned.
    const result = EventPatchSchema.safeParse({ placementMode: 'score' });
    expect(result.success).toBe(true);
  });

  it('(b) invalid: placementMode "score" + maxScore explicitly null in the same patch', () => {
    const result = EventPatchSchema.safeParse({
      placementMode: 'score',
      maxScore: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.includes('Enter the highest possible score')
        )
      ).toBe(true);
    }
  });

  it('(c) invalid: entrantKind "house" + placementMode "score" in the same patch', () => {
    const result = EventPatchSchema.safeParse({
      entrantKind: 'house',
      placementMode: 'score',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.includes('Houses are placed by hand')
        )
      ).toBe(true);
    }
  });

  it('(c-valid) accepts entrantKind "house" + placementMode "pick" together', () => {
    const result = EventPatchSchema.safeParse({
      entrantKind: 'house',
      placementMode: 'pick',
    });
    expect(result.success).toBe(true);
  });

  it('(c-partial) does not fire on entrantKind "house" alone (placementMode not in this patch)', () => {
    // Mirrors (a): the stored placementMode decides, and this schema cannot
    // read it from a patch that never mentions the field.
    const result = EventPatchSchema.safeParse({ entrantKind: 'house' });
    expect(result.success).toBe(true);
  });

  it('(d) invalid: places sent with duplicate ranks', () => {
    const result = EventPatchSchema.safeParse({
      places: [
        place({ label: 'Gold', rank: 1, points: 5 }),
        place({ label: 'Also Gold', rank: 1, points: 5 }),
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.includes("can't share the same rank")
        )
      ).toBe(true);
    }
  });

  it('(e) {} succeeds — an empty patch is a no-op, not an error', () => {
    // Unlike EntryPatchSchema/TeamPatchSchema, EventPatchSchema carries no
    // "at least one field" refinement: the brief specifies that rule only
    // for the entry and team patches. Documenting the actual, intended
    // behaviour here rather than leaving it unasserted.
    const result = EventPatchSchema.safeParse({});
    expect(result.success).toBe(true);
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

describe('EntryPatchSchema', () => {
  it('valid: score only', () => {
    expect(EntryPatchSchema.safeParse({ score: 10 }).success).toBe(true);
  });

  it('valid: score null (clearing it)', () => {
    expect(EntryPatchSchema.safeParse({ score: null }).success).toBe(true);
  });

  it('valid: placeId only', () => {
    expect(EntryPatchSchema.safeParse({ placeId: HOUSE_A }).success).toBe(true);
  });

  it('rejects an empty object', () => {
    expect(EntryPatchSchema.safeParse({}).success).toBe(false);
  });
});

describe('mergedEventIssues — the same cross-field rules run against a MERGED (stored + patched) event', () => {
  // PATCH /api/house-points/events/[eventId] (app/api/house-points/events/
  // [eventId]/route.ts) calls this on the merged values whenever a
  // places-adjacent field or `places` itself is actually changing.
  // EventPatchSchema alone can't see these rules because it only ever
  // validates the keys a caller happened to send — these tests exercise the
  // two real failures that fix round found: a single-key patch that would
  // otherwise reach the DB's check constraint, and a places-only patch that
  // would otherwise skip the gapless-rank rule entirely.

  const gaplessPlaces: PlaceInput[] = [
    place({ label: 'Gold', rank: 1, points: 5 }),
    place({ label: 'Silver', rank: 2, points: 4 }),
  ];

  it('valid: a well-formed merged event has no issues', () => {
    expect(
      mergedEventIssues({
        placementMode: 'score',
        entrantKind: 'student',
        maxScore: 100,
        places: gaplessPlaces,
      })
    ).toEqual([]);
  });

  it('catches `{ placementMode: "score" }` alone merged against a stored maxScore of null — the DB-check-constraint case', () => {
    const issues = mergedEventIssues({
      placementMode: 'score',
      entrantKind: 'student',
      maxScore: null, // unchanged from storage; the patch never touched it
      places: gaplessPlaces,
    });
    expect(issues).toContain('Enter the highest possible score.');
  });

  it('catches `{ entrantKind: "house" }` alone merged against a stored placementMode of "score"', () => {
    const issues = mergedEventIssues({
      placementMode: 'score', // unchanged from storage
      entrantKind: 'house',
      maxScore: 100,
      places: gaplessPlaces,
    });
    expect(issues).toContain('Houses are placed by hand, not by score.');
  });

  it('catches a places-only patch that breaks gapless ranks on an (unchanged) score-mode event', () => {
    const issues = mergedEventIssues({
      placementMode: 'score', // unchanged from storage; the patch only sent places
      entrantKind: 'student',
      maxScore: 100,
      places: [
        place({ label: 'Gold', rank: 1, points: 5 }),
        place({ label: 'Bronze', rank: 3, points: 3 }), // skips 2nd
      ],
    });
    expect(issues.some((m) => m.includes('without gaps'))).toBe(true);
  });

  it('does not apply the gapless rule when the merged placementMode is "pick"', () => {
    expect(
      mergedEventIssues({
        placementMode: 'pick',
        entrantKind: 'student',
        maxScore: null,
        places: [
          place({ label: 'Gold', rank: 1, points: 5 }),
          place({ label: 'Bronze', rank: 3, points: 3 }),
        ],
      })
    ).toEqual([]);
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
