import { describe, expect, it } from 'vitest';

import type { Place, ResolvedEntry } from '@/lib/house-points/compute';
import type { EventRow, RosterStudent } from '@/lib/house-points/queries';
import {
  EMPTY_SHEET_FILTER,
  NO_HOUSE,
  NO_PLACEMENT,
  NO_SCORE_YET,
  eventWinnerIds,
  isSheetFilterActive,
  matchesAny,
  matchesQuery,
  matchesSheetFilter,
  rowHouseKeys,
  rowPlacementKey,
} from '@/lib/house-points/sheet-filters';

const GOLD: Place = {
  id: 'gold',
  label: 'Gold',
  rank: 1,
  points: 5,
  sortOrder: 1,
};

function student(over: Partial<RosterStudent> = {}): RosterStudent {
  return {
    sectionStudentId: 'ss1',
    studentId: 's1',
    studentNumber: 'H250012',
    name: 'TAN, Wei Ming',
    sectionId: 'sec1',
    sectionName: 'P3 Love',
    levelId: 'lvl3',
    levelLabel: 'Primary 3',
    houseId: 'red',
    ...over,
  };
}

function studentRow(over: Partial<EventRow> = {}, s = student()): EventRow {
  return {
    entryId: 'e1',
    kind: 'student',
    score: null,
    placeId: null,
    student: s,
    team: null,
    houseId: null,
    ...over,
  };
}

function resolved(place: Place | null): ResolvedEntry {
  return {
    id: 'e1',
    group: 'g',
    score: 1,
    placeId: null,
    houseIds: [],
    place,
    points: place?.points ?? 0,
  };
}

describe('eventWinnerIds', () => {
  it('returns the house with the most points', () => {
    expect(eventWinnerIds({ a: 3, b: 7, c: 1 }, ['a', 'b', 'c'])).toEqual([
      'b',
    ]);
  });
  it('returns every house on a tie, in house order', () => {
    expect(eventWinnerIds({ a: 5, b: 1, c: 5 }, ['a', 'b', 'c'])).toEqual([
      'a',
      'c',
    ]);
  });
  it('returns nobody when no house has a point', () => {
    expect(eventWinnerIds({}, ['a', 'b'])).toEqual([]);
    expect(eventWinnerIds({ a: 0 }, ['a', 'b'])).toEqual([]);
  });
});

describe('matchesAny', () => {
  it('matches everything with no selection', () => {
    expect(matchesAny(undefined, ['x'])).toBe(true);
    expect(matchesAny([], ['x'])).toBe(true);
  });
  it('matches when any value is selected', () => {
    expect(matchesAny(['x', 'y'], ['y', 'z'])).toBe(true);
    expect(matchesAny(['x'], ['y', 'z'])).toBe(false);
  });
});

describe('rowHouseKeys', () => {
  it("uses a student's house, or No house", () => {
    expect(rowHouseKeys(studentRow())).toEqual(['red']);
    expect(rowHouseKeys(studentRow({}, student({ houseId: null })))).toEqual([
      NO_HOUSE,
    ]);
  });
  it('lists every distinct house a team credits', () => {
    const row = studentRow({
      kind: 'team',
      student: null,
      team: {
        id: 't1',
        name: 'Rockets',
        members: [
          student({ houseId: 'red' }),
          student({ houseId: 'blue' }),
          student({ houseId: 'red' }),
        ],
      },
    });
    expect(rowHouseKeys(row).sort()).toEqual(['blue', 'red']);
  });
  it('gives a team with no housed member No house', () => {
    const row = studentRow({
      kind: 'team',
      student: null,
      team: { id: 't1', name: 'Rockets', members: [] },
    });
    expect(rowHouseKeys(row)).toEqual([NO_HOUSE]);
  });
});

describe('rowPlacementKey', () => {
  it('scored event: blank score is No score yet, not No placement', () => {
    expect(rowPlacementKey(studentRow(), undefined, 'score')).toBe(
      NO_SCORE_YET
    );
  });
  it('scored event: a zero is a real score', () => {
    expect(
      rowPlacementKey(studentRow({ score: 0 }), resolved(null), 'score')
    ).toBe(NO_PLACEMENT);
    expect(
      rowPlacementKey(studentRow({ score: 0 }), resolved(GOLD), 'score')
    ).toBe('gold');
  });
  it('hand-placed event: no place picked is No placement', () => {
    expect(rowPlacementKey(studentRow(), undefined, 'pick')).toBe(NO_PLACEMENT);
    expect(
      rowPlacementKey(studentRow({ placeId: 'gold' }), resolved(GOLD), 'pick')
    ).toBe('gold');
  });
});

describe('matchesQuery', () => {
  it('finds a student by name in either order, or by number', () => {
    expect(matchesQuery(studentRow(), 'wei ming tan')).toBe(true);
    expect(matchesQuery(studentRow(), 'Tan, Wei')).toBe(true);
    expect(matchesQuery(studentRow(), 'h2500')).toBe(true);
    expect(matchesQuery(studentRow(), 'lim')).toBe(false);
  });
  it('finds a team by its name or a member', () => {
    const row = studentRow({
      kind: 'team',
      student: null,
      team: {
        id: 't1',
        name: 'Rockets',
        members: [student({ name: 'LIM, Ann', studentNumber: 'H240099' })],
      },
    });
    expect(matchesQuery(row, 'rock')).toBe(true);
    expect(matchesQuery(row, 'ann')).toBe(true);
    expect(matchesQuery(row, 'h240099')).toBe(true);
    expect(matchesQuery(row, 'tan')).toBe(false);
  });
});

describe('matchesSheetFilter', () => {
  it('passes everything with no filter', () => {
    expect(isSheetFilterActive(EMPTY_SHEET_FILTER)).toBe(false);
    expect(
      matchesSheetFilter(studentRow(), undefined, 'score', EMPTY_SHEET_FILTER)
    ).toBe(true);
  });
  it('needs the search, the house and the placement all to match', () => {
    const row = studentRow({ score: 40 });
    const filter = {
      query: 'tan',
      houses: ['red'],
      placements: ['gold'],
    };
    expect(isSheetFilterActive(filter)).toBe(true);
    expect(matchesSheetFilter(row, resolved(GOLD), 'score', filter)).toBe(true);
    expect(
      matchesSheetFilter(row, resolved(GOLD), 'score', {
        ...filter,
        houses: ['blue'],
      })
    ).toBe(false);
    expect(matchesSheetFilter(row, resolved(null), 'score', filter)).toBe(
      false
    );
  });
});
