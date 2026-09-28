import { describe, expect, it } from 'vitest';

import {
  toSheetEntries,
  type EventDetail,
  type EventRow,
  type RosterStudent,
} from '@/lib/house-points/queries';

// toSheetEntries is the pure row -> SheetEntry mapper (Task 4 brief). It is
// the only thing in lib/house-points/queries.ts that doesn't touch Supabase,
// so it's the only thing this file tests directly.

function makeStudent(overrides: Partial<RosterStudent> = {}): RosterStudent {
  return {
    sectionStudentId: 'ss-1',
    studentId: 'stu-1',
    studentNumber: 'E0001',
    name: 'DOE, Jane',
    sectionId: 'sec-1',
    sectionName: 'Grade 3 - Kind',
    levelId: 'lvl-1',
    levelLabel: 'Grade 3',
    houseId: null,
    ...overrides,
  };
}

function detail(
  rankWithin: EventDetail['rankWithin'],
  rows: EventRow[]
): Pick<EventDetail, 'rankWithin' | 'rows'> {
  return { rankWithin, rows };
}

describe('toSheetEntries', () => {
  it('a student row in section mode takes its section as group', () => {
    const rows: EventRow[] = [
      {
        entryId: 'e1',
        kind: 'student',
        score: 10,
        placeId: null,
        student: makeStudent({
          sectionId: 'sec-42',
          levelId: 'lvl-9',
          houseId: 'house-blue',
        }),
        team: null,
        houseId: null,
      },
    ];
    const [entry] = toSheetEntries(detail('section', rows));
    expect(entry.group).toBe('sec-42');
    expect(entry.houseIds).toEqual(['house-blue']);
  });

  it('a student row in level mode takes its level as group', () => {
    const rows: EventRow[] = [
      {
        entryId: 'e1',
        kind: 'student',
        score: 10,
        placeId: null,
        student: makeStudent({ sectionId: 'sec-42', levelId: 'lvl-9' }),
        team: null,
        houseId: null,
      },
    ];
    const [entry] = toSheetEntries(detail('level', rows));
    expect(entry.group).toBe('lvl-9');
  });

  it('a student with no house gets []', () => {
    const rows: EventRow[] = [
      {
        entryId: 'e1',
        kind: 'student',
        score: 10,
        placeId: null,
        student: makeStudent({ houseId: null }),
        team: null,
        houseId: null,
      },
    ];
    const [entry] = toSheetEntries(detail('event', rows));
    expect(entry.houseIds).toEqual([]);
  });

  it("a team with members in houses [B, G, G] gets houseIds [B, G] and group 'event'", () => {
    const rows: EventRow[] = [
      {
        entryId: 'e2',
        kind: 'team',
        score: null,
        placeId: 'place-1',
        student: null,
        team: {
          id: 'team-1',
          name: 'Relay A',
          members: [
            makeStudent({ sectionStudentId: 'ss-a', houseId: 'B' }),
            makeStudent({ sectionStudentId: 'ss-b', houseId: 'G' }),
            makeStudent({ sectionStudentId: 'ss-c', houseId: 'G' }),
          ],
        },
        houseId: null,
      },
    ];
    // rankWithin is 'section' here on purpose: a team's group must stay
    // 'event' regardless of rankWithin, unlike a student row.
    const [entry] = toSheetEntries(detail('section', rows));
    expect(entry.houseIds).toEqual(['B', 'G']);
    expect(entry.group).toBe('event');
  });

  it('a house row', () => {
    const rows: EventRow[] = [
      {
        entryId: 'e3',
        kind: 'house',
        score: null,
        placeId: 'place-1',
        student: null,
        team: null,
        houseId: 'house-orange',
      },
    ];
    const [entry] = toSheetEntries(detail('event', rows));
    expect(entry.houseIds).toEqual(['house-orange']);
    expect(entry.group).toBe('event');
    expect(entry.id).toBe('e3');
    expect(entry.placeId).toBe('place-1');
  });
});
