import { describe, expect, it } from 'vitest';
import {
  groupKey,
  houseTotals,
  resolveEntries,
  sumTotals,
  teamHouses,
  type Place,
  type SheetEntry,
} from '@/lib/house-points/compute';

const RANK_PLACES: Place[] = [
  { id: 'gold', label: 'Gold', rank: 1, points: 5, sortOrder: 1 },
  { id: 'silver', label: 'Silver', rank: 2, points: 4, sortOrder: 2 },
  { id: 'bronze', label: 'Bronze', rank: 3, points: 3, sortOrder: 3 },
  {
    id: 'participation',
    label: 'Participation',
    rank: null,
    points: 1,
    sortOrder: 4,
  },
];

function scoreEntries(scores: (number | null)[], group = 'g1'): SheetEntry[] {
  return scores.map((score, i) => ({
    id: `e${i}`,
    group,
    score,
    placeId: null,
    houseIds: [],
  }));
}

describe('resolveEntries — score mode', () => {
  it('dense-ranks ties and falls back to the rank-null place', () => {
    const scores = [46, 46, 44, 44, 39, 35, 31, null, 28];
    const resolved = resolveEntries(scoreEntries(scores), RANK_PLACES, 'score');

    expect(resolved.map((r) => r.place?.label ?? null)).toEqual([
      'Gold',
      'Gold',
      'Silver',
      'Silver',
      'Bronze',
      'Participation',
      'Participation',
      null,
      'Participation',
    ]);
    expect(resolved.map((r) => r.points)).toEqual([5, 5, 4, 4, 3, 1, 1, 0, 1]);
  });

  it('treats a 0 score as ranked and a null score as unranked (blank != zero)', () => {
    const resolved = resolveEntries(
      scoreEntries([0, null]),
      RANK_PLACES,
      'score'
    );
    expect(resolved[0].place?.label).toBe('Gold');
    expect(resolved[0].points).toBe(5);
    expect(resolved[1].place).toBeNull();
    expect(resolved[1].points).toBe(0);
  });

  it('ranks each group independently', () => {
    const entries: SheetEntry[] = [
      { id: 'a', group: 's1', score: 10, placeId: null, houseIds: [] },
      { id: 'b', group: 's1', score: 8, placeId: null, houseIds: [] },
      { id: 'c', group: 's2', score: 5, placeId: null, houseIds: [] },
    ];
    const resolved = resolveEntries(entries, RANK_PLACES, 'score');
    const s2 = resolved.find((r) => r.group === 's2');
    expect(s2?.place?.label).toBe('Gold');
  });

  it('places with no rank-null row leave the lowest ranks unplaced', () => {
    const places: Place[] = [
      { id: 'gold', label: 'Gold', rank: 1, points: 5, sortOrder: 1 },
      { id: 'silver', label: 'Silver', rank: 2, points: 4, sortOrder: 2 },
      { id: 'bronze', label: 'Bronze', rank: 3, points: 3, sortOrder: 3 },
    ];
    // 5 distinct scores, descending
    const resolved = resolveEntries(
      scoreEntries([50, 40, 30, 20, 10]),
      places,
      'score'
    );
    expect(resolved.map((r) => r.place?.label ?? null)).toEqual([
      'Gold',
      'Silver',
      'Bronze',
      null,
      null,
    ]);
    expect(resolved.map((r) => r.points)).toEqual([5, 4, 3, 0, 0]);
  });

  it('a rank-null place worth 0 leaves unplaced scorers at 0 points', () => {
    const places: Place[] = [
      { id: 'gold', label: 'Gold', rank: 1, points: 5, sortOrder: 1 },
      {
        id: 'participation',
        label: 'Participation',
        rank: null,
        points: 0,
        sortOrder: 2,
      },
    ];
    const resolved = resolveEntries(scoreEntries([10, 8, 6]), places, 'score');
    expect(resolved[1].place?.label).toBe('Participation');
    expect(resolved[1].points).toBe(0);
    expect(resolved[2].place?.label).toBe('Participation');
    expect(resolved[2].points).toBe(0);
  });

  it('an entry with no house contributes no house total but keeps its own points', () => {
    const entries: SheetEntry[] = [
      { id: 'a', group: 'g1', score: 10, placeId: null, houseIds: ['blue'] },
      { id: 'b', group: 'g1', score: 5, placeId: null, houseIds: [] },
    ];
    const resolved = resolveEntries(entries, RANK_PLACES, 'score');
    const noHouse = resolved.find((r) => r.id === 'b')!;
    expect(noHouse.points).toBeGreaterThan(0);

    const totals = houseTotals(resolved, ['blue', 'orange']);
    expect(totals).toEqual({ blue: 5, orange: 0 });
  });
});

describe('resolveEntries — pick mode', () => {
  const PICK_PLACES: Place[] = [
    { id: 'p1', label: '1st', rank: null, points: 5, sortOrder: 1 },
    { id: 'p2', label: '2nd', rank: null, points: 4, sortOrder: 2 },
    { id: 'p3', label: '3rd', rank: null, points: 3, sortOrder: 3 },
    { id: 'p4', label: '4th', rank: null, points: 2, sortOrder: 4 },
    { id: 'p5', label: '5th', rank: null, points: 1, sortOrder: 5 },
  ];

  it('ignores rank and totals a Got Talent-style sheet, a team counting once per house', () => {
    const entries: SheetEntry[] = [
      {
        id: 'e1',
        group: 'event',
        score: null,
        placeId: 'p1',
        houseIds: ['yellow'],
      },
      {
        id: 'e2',
        group: 'event',
        score: null,
        placeId: 'p2',
        houseIds: ['orange'],
      },
      {
        id: 'e3',
        group: 'event',
        score: null,
        placeId: 'p3',
        houseIds: ['orange'],
      },
      {
        id: 'e4',
        group: 'event',
        score: null,
        placeId: 'p1',
        houseIds: ['blue'],
      },
      {
        id: 'e5',
        group: 'event',
        score: null,
        placeId: 'p2',
        houseIds: ['blue', 'green', 'orange', 'yellow'],
      },
      {
        id: 'e6',
        group: 'event',
        score: null,
        placeId: 'p3',
        houseIds: ['yellow'],
      },
      {
        id: 'e7',
        group: 'event',
        score: null,
        placeId: 'p5',
        houseIds: ['orange', 'green'],
      },
      {
        id: 'e8',
        group: 'event',
        score: null,
        placeId: 'p1',
        houseIds: ['green'],
      },
      {
        id: 'e9',
        group: 'event',
        score: null,
        placeId: 'p2',
        houseIds: ['orange', 'green', 'yellow'],
      },
      {
        id: 'e10',
        group: 'event',
        score: null,
        placeId: 'p3',
        houseIds: ['green'],
      },
      {
        id: 'e11',
        group: 'event',
        score: null,
        placeId: 'p4',
        houseIds: ['green', 'orange'],
      },
      {
        id: 'e12',
        group: 'event',
        score: null,
        placeId: 'p5',
        houseIds: ['blue', 'yellow'],
      },
    ];
    const resolved = resolveEntries(entries, PICK_PLACES, 'pick');
    const totals = houseTotals(resolved, ['blue', 'orange', 'yellow', 'green']);
    expect(totals).toEqual({ blue: 10, orange: 18, yellow: 17, green: 19 });
  });

  it('sums a VANDA-style totals sheet to 441 regardless of score', () => {
    const places: Place[] = [
      { id: 'gold', label: 'Gold', rank: null, points: 20, sortOrder: 1 },
      { id: 'silver', label: 'Silver', rank: null, points: 15, sortOrder: 2 },
      { id: 'bronze', label: 'Bronze', rank: null, points: 10, sortOrder: 3 },
      {
        id: 'hm',
        label: 'Honourable Mention',
        rank: null,
        points: 17,
        sortOrder: 4,
      },
      {
        id: 'participation',
        label: 'Participation',
        rank: null,
        points: 5,
        sortOrder: 5,
      },
    ];
    const houses = ['blue', 'orange', 'yellow', 'green'];
    const counts: [string, number][] = [
      ['gold', 1],
      ['silver', 5],
      ['bronze', 11],
      ['hm', 8],
      ['participation', 20],
    ];
    const entries: SheetEntry[] = [];
    let i = 0;
    for (const [placeId, count] of counts) {
      for (let n = 0; n < count; n++) {
        entries.push({
          id: `e${i++}`,
          group: 'event',
          score: null,
          placeId,
          houseIds: [houses[i % houses.length]],
        });
      }
    }
    const resolved = resolveEntries(entries, places, 'pick');
    const totals = houseTotals(resolved, houses);
    const sum = Object.values(totals).reduce((a, b) => a + b, 0);
    expect(sum).toBe(441);
  });
});

describe('sumTotals', () => {
  it('adds several events together, defaulting a missing house to 0', () => {
    const houses = ['blue', 'orange', 'yellow', 'green'];
    const t1 = { blue: 5, orange: 3 };
    const t2 = { blue: 2, green: 4 };
    expect(sumTotals([t1, t2], houses)).toEqual({
      blue: 7,
      orange: 3,
      yellow: 0,
      green: 4,
    });
  });
});

describe('groupKey', () => {
  it('resolves the ranking group for each rankWithin mode', () => {
    expect(groupKey('section', 'sec-1', 'lvl-1')).toBe('sec-1');
    expect(groupKey('level', 'sec-1', 'lvl-1')).toBe('lvl-1');
    expect(groupKey('event', 'sec-1', 'lvl-1')).toBe('event');
  });
});

describe('teamHouses', () => {
  it('lists each distinct house once, in first-seen order, with how many members share it', () => {
    expect(
      teamHouses([
        { houseId: 'blue' },
        { houseId: 'green' },
        { houseId: 'green' },
        { houseId: null },
        { houseId: 'blue' },
        { houseId: 'green' },
      ])
    ).toEqual([
      { houseId: 'blue', memberCount: 2 },
      { houseId: 'green', memberCount: 3 },
    ]);
  });

  it('skips members with no house, and a team of nobody housed has none', () => {
    expect(teamHouses([{ houseId: null }, { houseId: null }])).toEqual([]);
    expect(teamHouses([])).toEqual([]);
  });

  it('credits a placement once per distinct house, not once per member', () => {
    const houseIds = teamHouses([
      { houseId: 'blue' },
      { houseId: 'blue' },
      { houseId: 'green' },
    ]).map((h) => h.houseId);
    const resolved = resolveEntries(
      [{ id: 't1', group: 'event', score: null, placeId: 'gold', houseIds }],
      RANK_PLACES,
      'pick'
    );
    expect(houseTotals(resolved, ['blue', 'green'])).toEqual({
      blue: 5,
      green: 5,
    });
  });
});
