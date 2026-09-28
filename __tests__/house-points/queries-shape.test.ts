import { readFileSync } from 'node:fs';
import path from 'node:path';

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

// Fix round 1 — regression guard, source-reading rather than a live Supabase
// call: `house_point_team_members` (migration 181) has NO `id` column, its PK
// is the composite (team_id, section_student_id). `fetchAllPages` defaults to
// tie-breaking pagination on `.order('id')`, which PostgREST rejects outright
// on a table with no such column — crashing every team event's
// loadAyEvents/loadEvent. The fix is `{ tieBreak: null }` on that call (see
// lib/attendance/dashboard.ts:188 for the same no-`id` pattern); this test
// fails loudly if that option is ever dropped or moved out of the same call.
describe('loadTeamMembers — tieBreak regression guard', () => {
  it('passes { tieBreak: null } on the house_point_team_members fetchAllPages call', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'lib/house-points/queries.ts'),
      'utf8'
    );
    const tableIdx = source.indexOf("from('house_point_team_members')");
    expect(tableIdx).toBeGreaterThan(-1);

    // The call's closing `);` for the fetchAllPages(...) invocation — find
    // the next occurrence of the tieBreak option after the table name and
    // require it to land within the same (short) call, not somewhere else
    // in the file.
    const tieBreakIdx = source.indexOf('{ tieBreak: null }', tableIdx);
    expect(tieBreakIdx).toBeGreaterThan(-1);
    expect(tieBreakIdx - tableIdx).toBeLessThan(1000);

    // And it must not have a competing `.order('id')`-tie-break table
    // elsewhere in the file without its own guard — every other
    // fetchAllPages call site in this file reads from a table that DOES
    // have an `id` column (section_students, house_point_places,
    // house_point_entries, house_point_teams), so this is the only one that
    // needs it.
    expect(source.match(/\{ tieBreak: null \}/g)?.length).toBe(1);
  });
});

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
