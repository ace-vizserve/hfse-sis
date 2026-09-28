import { describe, expect, it } from 'vitest';

import {
  clashingStudents,
  membershipsOf,
  studentsOnOtherTeams,
} from '@/lib/house-points/team-membership';

// A student can be on only ONE team per event (controller ruling, Task 10
// review). These two pure helpers are shared by the team drawer (which
// students to disable) and the POST/PATCH team routes (which ids to refuse).

const MEMBERSHIPS = [
  { teamId: 'team-a', sectionStudentId: 'ss-1' },
  { teamId: 'team-a', sectionStudentId: 'ss-2' },
  { teamId: 'team-b', sectionStudentId: 'ss-3' },
];

describe('studentsOnOtherTeams', () => {
  it('a new team (no id) is blocked by every existing team member', () => {
    expect(studentsOnOtherTeams(MEMBERSHIPS, null)).toEqual(
      new Set(['ss-1', 'ss-2', 'ss-3'])
    );
  });

  it('editing a team leaves its own members selectable', () => {
    expect(studentsOnOtherTeams(MEMBERSHIPS, 'team-a')).toEqual(
      new Set(['ss-3'])
    );
  });

  it('no teams yet blocks nobody', () => {
    expect(studentsOnOtherTeams([], null)).toEqual(new Set());
  });
});

describe('clashingStudents', () => {
  it('returns the requested ids already on another team, once each', () => {
    const taken = new Set(['ss-3', 'ss-9']);
    expect(clashingStudents(['ss-1', 'ss-3', 'ss-3', 'ss-4'], taken)).toEqual([
      'ss-3',
    ]);
  });

  it('returns nothing when nobody clashes', () => {
    expect(clashingStudents(['ss-1'], new Set(['ss-2']))).toEqual([]);
  });
});

describe('membershipsOf', () => {
  it("flattens team rows' members and skips rows with no team", () => {
    expect(
      membershipsOf([
        {
          team: {
            id: 'team-a',
            members: [
              { sectionStudentId: 'ss-1' },
              { sectionStudentId: 'ss-2' },
            ],
          },
        },
        { team: null },
        { team: { id: 'team-b', members: [] } },
      ])
    ).toEqual([
      { teamId: 'team-a', sectionStudentId: 'ss-1' },
      { teamId: 'team-a', sectionStudentId: 'ss-2' },
    ]);
  });
});
