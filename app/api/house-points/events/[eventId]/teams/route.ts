import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { HOUSE_POINTS_WRITERS } from '@/lib/auth/student-record';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import {
  loadEnrolledRoster,
  loadEventForWrite,
  loadEventTeamMemberships,
} from '@/lib/house-points/queries';
import {
  clashingStudents,
  ON_ANOTHER_TEAM_ERROR,
  studentsOnOtherTeams,
} from '@/lib/house-points/team-membership';
import { TeamInputSchema } from '@/lib/schemas/house-points';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/house-points/events/[eventId]/teams
//
// Creates one ad-hoc team on a `team`-entrant event: the team row, its
// members, and its single sheet entry (`house_point_entries.team_id`) —
// three statements, no transaction available through supabase-js. If a
// later statement fails, whatever was already inserted is deleted before
// returning 500 (the same compensating-cleanup shape as the sibling POST
// /api/house-points/events route for the event+places pair).
//
// Filed under `records` for cache invalidation and the audit log, matching
// every other House Points write route.

type Ctx = { params: Promise<{ eventId: string }> };

type ServiceClient = ReturnType<typeof createServiceClient>;

function failure(step: string, e: unknown): NextResponse {
  console.error(
    `[house-points] teams POST failed at "${step}":`,
    e instanceof Error ? (e.stack ?? e.message) : e
  );
  return NextResponse.json(
    {
      error: 'Something went wrong',
      step,
      ...(process.env.NODE_ENV === 'production'
        ? {}
        : { detail: e instanceof Error ? e.message : String(e) }),
    },
    { status: 500 }
  );
}

/** Deletes a team, cascading its members and entry (migration 181's
 * `on delete cascade` on both `house_point_team_members.team_id` and
 * `house_point_entries.team_id`) — used to undo a partially created team
 * when a later insert in the same request fails. */
async function cleanupTeam(
  service: ServiceClient,
  teamId: string
): Promise<void> {
  const { error } = await service
    .from('house_point_teams')
    .delete()
    .eq('id', teamId);
  if (error) {
    console.error('[house-points] teams POST: cleanup delete also failed', {
      teamId,
      cleanupError: error.message,
    });
  }
}

export async function POST(
  request: NextRequest,
  { params }: Ctx
): Promise<NextResponse> {
  const auth = await requireRole([...HOUSE_POINTS_WRITERS]);
  if ('error' in auth && auth.error) return auth.error;

  const { eventId } = await params;

  const parsed = TeamInputSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;

  let step = 'load event';
  try {
    const service = createServiceClient();
    const event = await loadEventForWrite(service, eventId);
    if (!event) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    if (event.entrantKind !== 'team') {
      return NextResponse.json(
        { error: 'This event only takes team entries — check its setup.' },
        { status: 400 }
      );
    }

    step = 'check enrolment';
    const roster = await loadEnrolledRoster(event.academicYearId);
    const validIds = new Set(roster.map((r) => r.sectionStudentId));
    const uniqueIds = Array.from(new Set(input.sectionStudentIds));
    if (!uniqueIds.every((id) => validIds.has(id))) {
      return NextResponse.json(
        { error: "Some of those students aren't enrolled this year" },
        { status: 400 }
      );
    }

    // One team per student per event (lib/house-points/team-membership.ts).
    step = 'check other teams';
    const taken = studentsOnOtherTeams(
      await loadEventTeamMemberships(service, eventId),
      null
    );
    if (clashingStudents(uniqueIds, taken).length > 0) {
      return NextResponse.json(
        { error: ON_ANOTHER_TEAM_ERROR },
        { status: 400 }
      );
    }

    step = 'insert team';
    const { data: teamRow, error: teamError } = await service
      .from('house_point_teams')
      .insert({ event_id: eventId, name: input.name })
      .select('id')
      .single();
    if (teamError || !teamRow) {
      throw new Error(teamError?.message ?? 'insert returned no row');
    }
    const teamId = (teamRow as { id: string }).id;

    step = 'insert team members';
    const { error: membersError } = await service
      .from('house_point_team_members')
      .insert(
        uniqueIds.map((sectionStudentId) => ({
          team_id: teamId,
          section_student_id: sectionStudentId,
        }))
      );
    if (membersError) {
      // Cleanup: the team was already inserted above. Without this, a
      // failed members insert would leave an empty, un-usable team behind.
      step = 'cleanup after failed members insert';
      await cleanupTeam(service, teamId);
      throw new Error(membersError.message);
    }

    step = 'insert team entry';
    const { data: entryRow, error: entryError } = await service
      .from('house_point_entries')
      .insert({
        event_id: eventId,
        team_id: teamId,
        created_by: auth.user.id,
      })
      .select('id')
      .single();
    if (entryError || !entryRow) {
      // Cleanup: the team and its members are already inserted. Without
      // this, a failed entry insert would leave a team that never appears
      // on the score sheet — silently un-usable and blocking a retry under
      // the same name.
      step = 'cleanup after failed entry insert';
      await cleanupTeam(service, teamId);
      throw new Error(entryError?.message ?? 'insert returned no row');
    }
    const entryId = (entryRow as { id: string }).id;

    step = 'audit';
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      action: 'house_points.team.create',
      entityType: 'house_point_team',
      entityId: teamId,
      context: {
        event_id: eventId,
        name: input.name,
        eventName: event.name,
        sectionStudentIds: uniqueIds,
      },
    });

    if (event.ayCode) invalidateDrillTags('records', event.ayCode);

    return NextResponse.json({ ok: true, teamId, entryId }, { status: 201 });
  } catch (e) {
    return failure(step, e);
  }
}
