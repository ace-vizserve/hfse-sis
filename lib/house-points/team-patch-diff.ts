/**
 * Pure helpers for PATCH /api/house-points/teams/[teamId] — no Supabase, so
 * unit-testable directly (the route itself isn't unit-tested).
 *
 * WHY THIS EXISTS. Task 6's first pass wrote/audited on key PRESENCE rather
 * than VALUE CHANGE — the same bug `diffEventFields`/`placesUnchanged`
 * (lib/house-points/event-patch-diff.ts) already fixed for the sibling event
 * PATCH. Resubmitting a team's own name renamed it to itself; resubmitting
 * its own member list — even in a different order — deleted every
 * `house_point_team_members` row and reinserted the same ids. Both ran a
 * write and appended an empty `house_points.team.update` audit row.
 * `diffTeamPatch` compares against what's actually stored so a no-op PATCH
 * does neither — see its call site in
 * app/api/house-points/teams/[teamId]/route.ts.
 */

export type TeamFieldsForDiff = {
  name: string;
  memberIds: readonly string[];
};

export type TeamPatchInput = {
  name?: string;
  sectionStudentIds?: readonly string[];
};

export type TeamPatchDiff = {
  /** Trimmed new name — present ONLY when it differs from what's stored. */
  name?: string;
  /**
   * Deduplicated new member list — present ONLY when the SET differs from
   * what's stored. Order-insensitive: `house_point_team_members`' primary
   * key is the unordered pair (team_id, section_student_id) — migration
   * 181 — so a team has no member order to preserve, and resubmitting the
   * same roster reshuffled is not a change.
   */
  memberIds?: string[];
};

/**
 * True when two member-id lists hold the exact same SET, regardless of
 * order or duplicates in either list.
 */
export function membersUnchanged(
  existingIds: readonly string[],
  patchIds: readonly string[]
): boolean {
  const existingSet = new Set(existingIds);
  const patchSet = new Set(patchIds);
  if (existingSet.size !== patchSet.size) return false;
  for (const id of existingSet) {
    if (!patchSet.has(id)) return false;
  }
  return true;
}

/**
 * Diffs a PATCH body against the stored team row, field by field. A field
 * lands in the result ONLY when the sent value actually differs from what's
 * stored — not merely because the caller included the key.
 */
export function diffTeamPatch(
  existing: TeamFieldsForDiff,
  patch: TeamPatchInput
): TeamPatchDiff {
  const diff: TeamPatchDiff = {};

  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (trimmed !== existing.name.trim()) {
      diff.name = trimmed;
    }
  }

  if (patch.sectionStudentIds !== undefined) {
    const uniqueIds = Array.from(new Set(patch.sectionStudentIds));
    if (!membersUnchanged(existing.memberIds, uniqueIds)) {
      diff.memberIds = uniqueIds;
    }
  }

  return diff;
}
