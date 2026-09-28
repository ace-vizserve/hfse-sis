import { describe, expect, it } from 'vitest';

import {
  diffTeamPatch,
  membersUnchanged,
  type TeamFieldsForDiff,
} from '@/lib/house-points/team-patch-diff';

// PATCH /api/house-points/teams/[teamId] used to write/audit on key
// PRESENCE rather than VALUE CHANGE: resubmitting a team's own name renamed
// it to itself, and resubmitting its own member list — even reordered —
// deleted and reinserted every house_point_team_members row and appended an
// empty `house_points.team.update` audit row. These are the pure functions
// the route now uses to tell "sent" from "changed" — tested directly since
// the route itself isn't unit-tested.

function storedTeam(
  overrides: Partial<TeamFieldsForDiff> = {}
): TeamFieldsForDiff {
  return {
    name: 'The Comets',
    memberIds: ['s1', 's2', 's3'],
    ...overrides,
  };
}

describe('membersUnchanged', () => {
  it('true for the same set in a different order', () => {
    expect(membersUnchanged(['s1', 's2', 's3'], ['s3', 's1', 's2'])).toBe(true);
  });

  it('true for two empty lists', () => {
    expect(membersUnchanged([], [])).toBe(true);
  });

  it('false when a member was added', () => {
    expect(membersUnchanged(['s1', 's2'], ['s1', 's2', 's3'])).toBe(false);
  });

  it('false when a member was removed', () => {
    expect(membersUnchanged(['s1', 's2', 's3'], ['s1', 's2'])).toBe(false);
  });

  it('false when the set is the same size but a different student', () => {
    expect(membersUnchanged(['s1', 's2'], ['s1', 's3'])).toBe(false);
  });

  it('ignores duplicates on either side', () => {
    expect(membersUnchanged(['s1', 's1', 's2'], ['s2', 's1'])).toBe(true);
  });
});

describe('diffTeamPatch', () => {
  it('is empty when nothing was sent at all', () => {
    const diff = diffTeamPatch(storedTeam(), {});
    expect(diff).toEqual({});
  });

  it('same name + same members in a different order → unchanged', () => {
    const existing = storedTeam();
    const diff = diffTeamPatch(existing, {
      name: existing.name,
      sectionStudentIds: ['s3', 's1', 's2'],
    });
    expect(diff).toEqual({});
  });

  it('same name + same members, duplicated in the patch → unchanged', () => {
    const existing = storedTeam();
    const diff = diffTeamPatch(existing, {
      name: existing.name,
      sectionStudentIds: ['s1', 's1', 's2', 's3'],
    });
    expect(diff).toEqual({});
  });

  it('renamed only → name in the diff, memberIds absent', () => {
    const existing = storedTeam();
    const diff = diffTeamPatch(existing, {
      name: 'The Meteors',
      sectionStudentIds: existing.memberIds,
    });
    expect(diff).toEqual({ name: 'The Meteors' });
  });

  it('members changed only → memberIds in the diff, name absent', () => {
    const existing = storedTeam();
    const diff = diffTeamPatch(existing, {
      name: existing.name,
      sectionStudentIds: ['s1', 's2', 's4'],
    });
    expect(diff).toEqual({ memberIds: ['s1', 's2', 's4'] });
  });

  it('both changed → both in the diff', () => {
    const existing = storedTeam();
    const diff = diffTeamPatch(existing, {
      name: 'The Meteors',
      sectionStudentIds: ['s1', 's4'],
    });
    expect(diff).toEqual({ name: 'The Meteors', memberIds: ['s1', 's4'] });
  });

  it('trims whitespace-only name changes to nothing', () => {
    const existing = storedTeam({ name: 'The Comets' });
    const diff = diffTeamPatch(existing, { name: '  The Comets  ' });
    expect(diff).toEqual({});
  });

  it('ignores a key the patch never sent at all', () => {
    const existing = storedTeam();
    const diff = diffTeamPatch(existing, { name: 'The Meteors' });
    expect(diff).toEqual({ name: 'The Meteors' });
    expect('memberIds' in diff).toBe(false);
  });
});
