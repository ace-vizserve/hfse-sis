/**
 * One team per student per event.
 *
 * A student can be on only ONE team in an event (controller ruling, Task 10
 * review). Migration 181 does not enforce it: `house_point_team_members` is
 * keyed by (team_id, section_student_id), with nothing across an event's
 * teams, and the ruling leaves that migration alone. So the rule lives here,
 * pure and client-safe, and is applied twice with the same code:
 *   - the team drawer disables students already on another team, and
 *   - POST /api/house-points/events/[eventId]/teams and
 *     PATCH /api/house-points/teams/[teamId] refuse them with a 400.
 */

export type TeamMembership = { teamId: string; sectionStudentId: string };

/** The memberships behind a score sheet's team rows (EventRow-shaped). */
export function membershipsOf(
  rows: readonly {
    team: {
      id: string;
      members: readonly { sectionStudentId: string }[];
    } | null;
  }[]
): TeamMembership[] {
  return rows.flatMap(({ team }) =>
    team
      ? team.members.map((m) => ({
          teamId: team.id,
          sectionStudentId: m.sectionStudentId,
        }))
      : []
  );
}

/**
 * The section_student ids on an event's teams OTHER than `teamId`. With a
 * null `teamId` (a new team), every existing member counts. When a team is
 * being edited, its own members stay selectable.
 */
export function studentsOnOtherTeams(
  memberships: readonly TeamMembership[],
  teamId: string | null
): Set<string> {
  const taken = new Set<string>();
  for (const m of memberships) {
    if (m.teamId !== teamId) taken.add(m.sectionStudentId);
  }
  return taken;
}

/** The requested ids that are already taken, each listed once. */
export function clashingStudents(
  requested: readonly string[],
  taken: ReadonlySet<string>
): string[] {
  return Array.from(new Set(requested)).filter((id) => taken.has(id));
}

export const ON_ANOTHER_TEAM_ERROR =
  'Some of those students are already on another team in this event.';
