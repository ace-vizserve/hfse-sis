/**
 * Small pure guards for the entry and event write routes — no Supabase, so
 * unit-testable directly (the routes themselves aren't unit-tested). Each
 * guard mirrors one refusal from the final whole-branch review:
 *
 *   - `blocksTeamEntryDelete` — DELETE /api/house-points/entries/[entryId]
 *     must refuse a team's own entry (deleting it orphans the team and
 *     permanently locks its members as "on another team" — DELETE
 *     /api/house-points/teams/[teamId] is the route that removes both
 *     together).
 *   - `maxScoreLoweredBelowStoredScore` — PATCH
 *     /api/house-points/events/[eventId] must refuse lowering `maxScore`
 *     below a score already entered, rather than leaving a stored score that
 *     reads higher than the sheet now allows.
 */

export const REMOVE_TEAM_INSTEAD_ERROR = 'Remove the team instead.';

/** True when this entry is a team's own row — its DELETE must be refused. */
export function blocksTeamEntryDelete(entry: {
  team_id: string | null;
}): boolean {
  return entry.team_id !== null;
}

export const SCORES_TOO_HIGH_ERROR =
  'Some scores are higher than that. Change those scores first.';

/**
 * True when a PATCH is lowering `maxScore` (from `existingMax`, non-null, to
 * `newMax`) past a score already on the sheet. Raising `maxScore`, or a
 * patch that doesn't touch it at all, is never a problem — only a LOWER
 * value can strand a stored score above what the sheet now allows.
 */
export function maxScoreLoweredBelowStoredScore(
  newMax: number,
  existingMax: number | null,
  highestStoredScore: number | null
): boolean {
  if (existingMax === null) return false;
  if (newMax >= existingMax) return false;
  if (highestStoredScore === null) return false;
  return highestStoredScore > newMax;
}
