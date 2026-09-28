import { describe, expect, it } from 'vitest';

import {
  blocksTeamEntryDelete,
  maxScoreLoweredBelowStoredScore,
} from '@/lib/house-points/write-guards';

describe('blocksTeamEntryDelete — DELETE /api/house-points/entries/[entryId]', () => {
  it('blocks a team entry', () => {
    expect(blocksTeamEntryDelete({ team_id: 'team-1' })).toBe(true);
  });

  it('allows a student/house entry (no team_id)', () => {
    expect(blocksTeamEntryDelete({ team_id: null })).toBe(false);
  });
});

describe('maxScoreLoweredBelowStoredScore — PATCH /api/house-points/events/[eventId]', () => {
  it('blocks lowering below the highest stored score', () => {
    expect(maxScoreLoweredBelowStoredScore(40, 50, 45)).toBe(true);
  });

  it('allows lowering to exactly the highest stored score', () => {
    expect(maxScoreLoweredBelowStoredScore(45, 50, 45)).toBe(false);
  });

  it('allows lowering when nothing scored that high', () => {
    expect(maxScoreLoweredBelowStoredScore(40, 50, 30)).toBe(false);
  });

  it('allows raising max_score', () => {
    expect(maxScoreLoweredBelowStoredScore(60, 50, 45)).toBe(false);
  });

  it('allows an unchanged max_score', () => {
    expect(maxScoreLoweredBelowStoredScore(50, 50, 45)).toBe(false);
  });

  it('allows lowering when no score has been entered yet', () => {
    expect(maxScoreLoweredBelowStoredScore(40, 50, null)).toBe(false);
  });

  it('allows any value when the event had no stored max_score (pick mode)', () => {
    expect(maxScoreLoweredBelowStoredScore(40, null, 45)).toBe(false);
  });
});
