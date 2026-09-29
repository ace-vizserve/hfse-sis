import { describe, expect, it } from 'vitest';

import { blocksTeamEntryDelete } from '@/lib/house-points/write-guards';

describe('blocksTeamEntryDelete — DELETE /api/house-points/entries/[entryId]', () => {
  it('blocks a team entry', () => {
    expect(blocksTeamEntryDelete({ team_id: 'team-1' })).toBe(true);
  });

  it('allows a student/house entry (no team_id)', () => {
    expect(blocksTeamEntryDelete({ team_id: null })).toBe(false);
  });
});
