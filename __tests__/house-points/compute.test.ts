import { describe, expect, it } from 'vitest';
import {
  houseTotals,
  resolveEntries,
  sumTotals,
  teamHouses,
  type Place,
  type SheetEntry,
} from '@/lib/house-points/compute';

const RUBRIC: Place[] = [
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

function entry(
  id: string,
  placeId: string | null,
  houseIds: string[] = []
): SheetEntry {
  return { id, placeId, houseIds };
}

describe('resolveEntries — the award picked earns its points', () => {
  it("gives each entry its picked award's points", () => {
    const resolved = resolveEntries(
      [
        entry('a', 'gold'),
        entry('b', 'participation'),
        entry('c', 'silver'),
        entry('d', 'gold'),
      ],
      RUBRIC
    );
    expect(resolved.map((r) => r.place?.label)).toEqual([
      'Gold',
      'Participation',
      'Silver',
      'Gold',
    ]);
    expect(resolved.map((r) => r.points)).toEqual([5, 1, 4, 5]);
  });

  it('no award picked means no award and no points', () => {
    const [r] = resolveEntries([entry('a', null)], RUBRIC);
    expect(r.place).toBeNull();
    expect(r.points).toBe(0);
  });

  it('a pick that is no longer on the rubric earns nothing', () => {
    const [r] = resolveEntries([entry('a', 'removed-award')], RUBRIC);
    expect(r.place).toBeNull();
    expect(r.points).toBe(0);
  });

  it('never ranks: rank on the rubric decides nothing', () => {
    // Everyone picked Participation — nobody is promoted to Gold.
    const resolved = resolveEntries(
      [entry('a', 'participation'), entry('b', 'participation')],
      RUBRIC
    );
    expect(resolved.map((r) => r.place?.id)).toEqual([
      'participation',
      'participation',
    ]);
  });

  it('an entry with no house contributes no house total but keeps its own points', () => {
    const resolved = resolveEntries(
      [entry('a', 'gold', ['blue']), entry('b', 'silver', [])],
      RUBRIC
    );
    expect(resolved.find((r) => r.id === 'b')!.points).toBe(4);
    expect(houseTotals(resolved, ['blue', 'orange'])).toEqual({
      blue: 5,
      orange: 0,
    });
  });
});

describe('resolveEntries — workbook totals', () => {
  const GOT_TALENT: Place[] = [
    { id: 'p1', label: '1st', rank: null, points: 5, sortOrder: 1 },
    { id: 'p2', label: '2nd', rank: null, points: 4, sortOrder: 2 },
    { id: 'p3', label: '3rd', rank: null, points: 3, sortOrder: 3 },
    { id: 'p4', label: '4th', rank: null, points: 2, sortOrder: 4 },
    { id: 'p5', label: '5th', rank: null, points: 1, sortOrder: 5 },
  ];

  it('totals a Got Talent-style sheet, a team counting once per house', () => {
    const entries: SheetEntry[] = [
      entry('e1', 'p1', ['yellow']),
      entry('e2', 'p2', ['orange']),
      entry('e3', 'p3', ['orange']),
      entry('e4', 'p1', ['blue']),
      entry('e5', 'p2', ['blue', 'green', 'orange', 'yellow']),
      entry('e6', 'p3', ['yellow']),
      entry('e7', 'p5', ['orange', 'green']),
      entry('e8', 'p1', ['green']),
      entry('e9', 'p2', ['orange', 'green', 'yellow']),
      entry('e10', 'p3', ['green']),
      entry('e11', 'p4', ['green', 'orange']),
      entry('e12', 'p5', ['blue', 'yellow']),
    ];
    const resolved = resolveEntries(entries, GOT_TALENT);
    const totals = houseTotals(resolved, ['blue', 'orange', 'yellow', 'green']);
    expect(totals).toEqual({ blue: 10, orange: 18, yellow: 17, green: 19 });
  });

  it('sums a VANDA-style totals sheet to 441', () => {
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
        entries.push(entry(`e${i++}`, placeId, [houses[i % houses.length]]));
      }
    }
    const totals = houseTotals(resolveEntries(entries, places), houses);
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

  it('credits an award once per distinct house, not once per member', () => {
    const houseIds = teamHouses([
      { houseId: 'blue' },
      { houseId: 'blue' },
      { houseId: 'green' },
    ]).map((h) => h.houseId);
    const resolved = resolveEntries([entry('t1', 'gold', houseIds)], RUBRIC);
    expect(houseTotals(resolved, ['blue', 'green'])).toEqual({
      blue: 5,
      green: 5,
    });
  });
});
