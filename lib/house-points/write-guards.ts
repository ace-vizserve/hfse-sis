/**
 * Small pure guards for the entry write routes — no Supabase, so
 * unit-testable directly (the routes themselves aren't unit-tested). Each
 * guard mirrors one refusal from the final whole-branch review:
 *
 *   - `blocksTeamEntryDelete` — DELETE /api/house-points/entries/[entryId]
 *     must refuse a team's own entry (deleting it orphans the team and
 *     permanently locks its members as "on another team" — DELETE
 *     /api/house-points/teams/[teamId] is the route that removes both
 *     together).
 */

export const REMOVE_TEAM_INSTEAD_ERROR = 'Remove the team instead.';

/** True when this entry is a team's own row — its DELETE must be refused. */
export function blocksTeamEntryDelete(entry: {
  team_id: string | null;
}): boolean {
  return entry.team_id !== null;
}
