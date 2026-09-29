import { describe, expect, it } from 'vitest';

import type { Place, ResolvedEntry } from '@/lib/house-points/compute';
import type { EventRow, RosterStudent } from '@/lib/house-points/queries';
import {
  EMPTY_SHEET_FILTER,
  NO_AWARD,
  NO_HOUSE,
  eventWinnerIds,
  isSheetFilterActive,
  matchesAny,
  matchesQuery,
  matchesSheetFilter,
  rowAwardKey,
  rowHouseKeys,
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
    placeId: place?.id ?? null,
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

describe('rowAwardKey', () => {
  it('no award picked is No award', () => {
    expect(rowAwardKey(studentRow(), undefined)).toBe(NO_AWARD);
  });
  it('a picked award is its own key', () => {
    expect(rowAwardKey(studentRow({ placeId: 'gold' }), resolved(GOLD))).toBe(
      'gold'
    );
  });
  it('a pick that is no longer on the rubric is No award', () => {
    expect(rowAwardKey(studentRow({ placeId: 'gone' }), resolved(null))).toBe(
      NO_AWARD
    );
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
      matchesSheetFilter(studentRow(), undefined, EMPTY_SHEET_FILTER)
    ).toBe(true);
  });
  it('needs the search, the house and the award all to match', () => {
    const row = studentRow({ placeId: 'gold' });
    const filter = {
      query: 'tan',
      houses: ['red'],
      awards: ['gold'],
    };
    expect(isSheetFilterActive(filter)).toBe(true);
    expect(matchesSheetFilter(row, resolved(GOLD), filter)).toBe(true);
    expect(
      matchesSheetFilter(row, resolved(GOLD), {
        ...filter,
        houses: ['blue'],
      })
    ).toBe(false);
    expect(matchesSheetFilter(studentRow(), resolved(null), filter)).toBe(
      false
    );
  });
});
