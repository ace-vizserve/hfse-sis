import { describe, expect, it } from 'vitest';

import {
  houseTotals,
  resolveEntries,
  sumTotals,
  type Place,
} from '@/lib/house-points/compute';
import {
  awardSummary,
  buildHouseBreakdown,
  houseMembers,
  type BreakdownEventInput,
} from '@/lib/house-points/house-breakdown';
import {
  entrantLabel,
  entriesCsv,
  entryRowsFor,
  houseEventRows,
  scoringEvents,
  scoringStudents,
  teamMembersLabel,
  uniqueCategories,
  type HouseEntryDrill,
} from '@/lib/house-points/drill';
import type { EventRow, RosterStudent } from '@/lib/house-points/queries';
import { toSheetEntries } from '@/lib/house-points/sheet-entries';

// The per-house page must show the SAME total the standings page does for
// that house — both go through toSheetEntries → resolveEntries → houseTotals.
// A team with two members of one house credits that house once.

const HOUSES = ['h1', 'h2', 'h3', 'h4'];

function student(
  id: string,
  houseId: string | null,
  section = 'P3 Kind'
): RosterStudent {
  return {
    sectionStudentId: `ss-${id}`,
    studentId: `stu-${id}`,
    studentNumber: `E${id}`,
    name: `STUDENT, ${id}`,
    sectionId: 'sec',
    sectionName: section,
    levelId: 'lvl',
    levelLabel: 'P3',
    houseId,
  };
}

function place(
  id: string,
  label: string,
  points: number,
  rank: number | null,
  sortOrder: number
): Place {
  return { id, label, points, rank, sortOrder };
}

function studentRow(
  entryId: string,
  placeId: string | null,
  s: RosterStudent
): EventRow {
  return {
    entryId,
    kind: 'student',
    placeId,
    student: s,
    team: null,
    houseId: null,
  };
}

const a = student('A', 'h1');
const b = student('B', 'h1', 'P4 Hope');
const c = student('C', 'h2');
const d = student('D', null);

const EVENTS: BreakdownEventInput[] = [
  {
    id: 'ev-sprint',
    name: 'Sprint',
    heldOn: '2026-03-01',
    eventType: 'internal',
    places: [
      place('g1', 'Gold', 10, 1, 0),
      place('s1', 'Silver', 6, 2, 1),
      place('p1', 'Participation', 1, null, 2),
    ],
    rows: [
      studentRow('e1', 'g1', a),
      studentRow('e2', 'p1', b),
      studentRow('e3', 's1', c),
      studentRow('e4', 'g1', d), // no house: nobody is owed these
      studentRow('e5', null, b), // entered, no award yet
    ],
  },
  {
    id: 'ev-relay',
    name: 'Relay',
    heldOn: '2026-04-01',
    eventType: 'major',
    places: [
      place('g2', 'Gold', 20, 1, 0),
      place('p2', 'Participation', 2, null, 1),
    ],
    rows: [
      {
        entryId: 't1',
        kind: 'team',
        placeId: 'g2',
        student: null,
        // Two h1 members + one h2: h1 is credited ONCE, h2 once.
        team: { id: 'team-1', name: 'Team 1', members: [a, b, c] },
        houseId: null,
      },
    ],
  },
  {
    id: 'ev-cheer',
    name: 'Cheer',
    heldOn: null,
    eventType: 'internal',
    places: [place('g3', 'Gold', 5, 1, 0)],
    rows: [
      {
        entryId: 'hh1',
        kind: 'house',
        placeId: 'g3',
        student: null,
        team: null,
        houseId: 'h1',
      },
    ],
  },
];

function standingsTotal(houseId: string): number {
  const perEvent = EVENTS.map((e) =>
    houseTotals(resolveEntries(toSheetEntries(e), e.places), HOUSES)
  );
  return sumTotals(perEvent, HOUSES)[houseId];
}

describe('buildHouseBreakdown', () => {
  it('matches the standings total for every house (team counted once)', () => {
    for (const h of HOUSES) {
      const breakdown = buildHouseBreakdown(EVENTS, h, HOUSES);
      expect(breakdown.total).toBe(standingsTotal(h));
      for (const other of HOUSES) {
        expect(breakdown.yearTotals[other]).toBe(standingsTotal(other));
      }
      const eventSum = breakdown.events.reduce((s, e) => s + e.points, 0);
      expect(eventSum).toBe(breakdown.total);
      const awardSum = breakdown.awards.reduce((s, x) => s + x.points, 0);
      expect(awardSum).toBe(breakdown.total);
    }
    // h1: Gold 10 + Participation 1 + team Gold 20 (once) + house Gold 5.
    expect(standingsTotal('h1')).toBe(36);
  });

  it('lists events by points, with what the house won there', () => {
    const { events } = buildHouseBreakdown(EVENTS, 'h1', HOUSES);
    expect(events.map((e) => [e.name, e.points])).toEqual([
      ['Relay', 20],
      ['Sprint', 11],
      ['Cheer', 5],
    ]);
    expect(awardSummary(events[1].awards)).toBe('Gold ×1 · Participation ×1');
  });

  it('groups awards by label across events', () => {
    const { awards } = buildHouseBreakdown(EVENTS, 'h1', HOUSES);
    expect(awards).toEqual([
      { label: 'Gold', count: 3, points: 35, rank: 1 },
      { label: 'Participation', count: 1, points: 1, rank: null },
    ]);
  });

  it('shows a team result under each member of the house', () => {
    const { students } = buildHouseBreakdown(EVENTS, 'h1', HOUSES);
    const byName = Object.fromEntries(students.map((s) => [s.name, s]));
    expect(byName['STUDENT, A']).toMatchObject({ points: 30, eventCount: 2 });
    // B: Participation 1 + an award-less entry + the team's 20.
    expect(byName['STUDENT, B']).toMatchObject({ points: 21, eventCount: 2 });
    expect(awardSummary(byName['STUDENT, B'].awards)).toBe(
      'Gold ×1 · Participation ×1'
    );
    // Other houses' members are not listed.
    expect(students.map((s) => s.name)).not.toContain('STUDENT, C');
  });

  it('gives every event with every house, oldest first, undated last', () => {
    const { eventTotals } = buildHouseBreakdown(EVENTS, 'h1', HOUSES);
    expect(eventTotals.map((e) => e.name)).toEqual([
      'Sprint',
      'Relay',
      'Cheer',
    ]);
    expect(eventTotals[1].totals).toEqual({ h1: 20, h2: 20, h3: 0, h4: 0 });
  });

  it('lists members once each, current house only', () => {
    const moved = { ...a, sectionStudentId: 'ss-A2', sectionName: 'P3 Joy' };
    const members = houseMembers([a, b, c, d, moved], 'h1');
    expect(members.map((m) => m.name)).toEqual(['STUDENT, A', 'STUDENT, B']);
  });

  it('is empty for a house that entered nothing', () => {
    const breakdown = buildHouseBreakdown(EVENTS, 'h4', HOUSES);
    expect(breakdown).toMatchObject({
      total: 0,
      events: [],
      students: [],
      awards: [],
    });
  });
});

describe('house page drill rows', () => {
  const h1 = buildHouseBreakdown(EVENTS, 'h1', HOUSES);

  it('lists every award the house earned, a team once, no award-less entries', () => {
    expect(h1.entries.map((e) => [e.id, e.kind, e.award, e.points])).toEqual([
      ['e1', 'student', 'Gold', 10],
      ['e2', 'student', 'Participation', 1],
      ['t1', 'team', 'Gold', 20],
      ['hh1', 'house', 'Gold', 5],
    ]);
    // The entries add up to the house total — the team is not repeated.
    expect(h1.entries.reduce((s, e) => s + e.points, 0)).toBe(h1.total);
    const team = h1.entries.find((e) => e.kind === 'team')!;
    expect(team.entrant).toBe('Team 1');
    expect(team.studentIds).toEqual(['stu-A', 'stu-B']);
    expect(team.members.map((m) => [m.name, m.inHouse])).toEqual([
      ['STUDENT, A', true],
      ['STUDENT, B', true],
      ['STUDENT, C', false],
    ]);
    expect(teamMembersLabel(team)).toBe(
      'STUDENT, A (P3 Kind); STUDENT, B (P4 Hope); STUDENT, C (P3 Kind) — another house'
    );
    expect(entrantLabel(team, 'Red House')).toBe('Team 1 (team)');
    expect(entrantLabel(h1.entries[3], 'Red House')).toBe(
      'Red House (whole house)'
    );
  });

  it('narrows entries to what was clicked', () => {
    const ids = (drill: HouseEntryDrill) =>
      entryRowsFor(h1.entries, drill).map((e) => e.id);
    expect(ids({ target: 'entries' })).toEqual(['e1', 'e2', 't1', 'hh1']);
    expect(
      ids({ target: 'award', label: 'Gold ×3', awards: ['Gold'] })
    ).toEqual(['e1', 't1', 'hh1']);
    expect(
      ids({
        target: 'award',
        label: 'Other',
        awards: ['Participation', 'Gold'],
      })
    ).toEqual(['e1', 'e2', 't1', 'hh1']);
    expect(ids({ target: 'event', eventId: 'ev-sprint' })).toEqual([
      'e1',
      'e2',
    ]);
    // A student's drill includes their team's award.
    expect(ids({ target: 'student', studentId: 'stu-B' })).toEqual([
      'e2',
      't1',
    ]);
  });

  it('matches the KPI counts', () => {
    expect(scoringEvents(h1.events).map((e) => e.name)).toEqual([
      'Relay',
      'Sprint',
      'Cheer',
    ]);
    expect(scoringStudents(h1.students).map((s) => s.name)).toEqual([
      'STUDENT, A',
      'STUDENT, B',
    ]);
  });

  it("gives another house's events with its place, ties sharing", () => {
    expect(houseEventRows(h1.eventTotals, 'h2')).toEqual([
      {
        eventId: 'ev-sprint',
        name: 'Sprint',
        heldOn: '2026-03-01',
        points: 6,
        place: 2,
        houseCount: 4,
      },
      {
        eventId: 'ev-relay',
        name: 'Relay',
        heldOn: '2026-04-01',
        points: 20,
        place: 1,
        houseCount: 4,
      },
    ]);
  });

  it('writes the CSV with only the visible columns, in order', () => {
    const csv = entriesCsv(
      entryRowsFor(h1.entries, { target: 'event', eventId: 'ev-relay' }),
      ['points', 'entrant', 'award'],
      'Red House'
    );
    expect(csv.replace('﻿', '').split('\n')).toEqual([
      'Student or team,Award,Points',
      '"Team 1 (team): STUDENT, A (P3 Kind); STUDENT, B (P4 Hope); STUDENT, C (P3 Kind) — another house",Gold,20',
    ]);
  });

  it('numbers colliding chart labels so each bar maps to one row', () => {
    expect(uniqueCategories(['Relay…', 'Sprint', 'Relay…'])).toEqual([
      'Relay…',
      'Sprint',
      'Relay… (2)',
    ]);
  });
});
