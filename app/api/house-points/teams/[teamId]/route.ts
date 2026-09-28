import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { HOUSE_POINTS_WRITERS } from '@/lib/auth/student-record';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import {
  loadEnrolledRoster,
  loadEventForWrite,
} from '@/lib/house-points/queries';
import { diffTeamPatch } from '@/lib/house-points/team-patch-diff';
import { TeamPatchSchema } from '@/lib/schemas/house-points';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH  /api/house-points/teams/[teamId]
// DELETE /api/house-points/teams/[teamId]
//
// PATCH renames a team and/or replaces its member list wholesale (there is
// no per-member add/remove endpoint — same "replace, don't merge" posture
// as EventPatchSchema's `places`). DELETE removes the team; its members and
// its single sheet entry cascade (migration 181's `on delete cascade` on
// both FKs), so nothing else needs to run first.
//
// Filed under `records` for cache invalidation and the audit log, matching
// every other House Points write route.

type Ctx = { params: Promise<{ teamId: string }> };

type TeamRow = { id: string; event_id: string; name: string };

type ServiceClient = ReturnType<typeof createServiceClient>;

function failure(step: string, e: unknown, what: string): NextResponse {
  console.error(
    `[house-points] teams ${what} failed at "${step}":`,
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

async function loadTeamRow(
  service: ServiceClient,
  teamId: string
): Promise<TeamRow | null> {
  const { data, error } = await service
    .from('house_point_teams')
    .select('id, event_id, name')
    .eq('id', teamId)
    .maybeSingle();
  if (error) throw new Error(`house_point_teams: ${error.message}`);
  return (data as TeamRow | null) ?? null;
}

export async function PATCH(
  request: NextRequest,
  { params }: Ctx
): Promise<NextResponse> {
  const auth = await requireRole([...HOUSE_POINTS_WRITERS]);
  if ('error' in auth && auth.error) return auth.error;

  const { teamId } = await params;

  const parsed = TeamPatchSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const patch = parsed.data;

  let step = 'load team';
  try {
    const service = createServiceClient();
    const team = await loadTeamRow(service, teamId);
    if (!team) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    step = 'load event';
    const event = await loadEventForWrite(service, team.event_id);
    if (!event) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    let validatedIds: string[] | null = null;
    if (patch.sectionStudentIds !== undefined) {
      step = 'check enrolment';
      const roster = await loadEnrolledRoster(event.academicYearId);
      const validIds = new Set(roster.map((r) => r.sectionStudentId));
      const uniqueIds = Array.from(new Set(patch.sectionStudentIds));
      if (!uniqueIds.every((id) => validIds.has(id))) {
        return NextResponse.json(
          { error: "Some of those students aren't enrolled this year" },
          { status: 400 }
        );
      }
      validatedIds = uniqueIds;
    }

    // Existing members are needed both to DIFF a sent `sectionStudentIds`
    // against (did the SET actually change, order aside?) and as the
    // rollback source if a later replace-insert fails below — only fetched
    // when members were actually sent, same "only pay for what changed"
    // posture as PATCH /api/house-points/events/[eventId]'s existingPlaces.
    let existingMemberIds: string[] = [];
    if (validatedIds !== null) {
      step = 'load existing members';
      const { data: existingRows, error: existingError } = await service
        .from('house_point_team_members')
        .select('section_student_id')
        .eq('team_id', teamId);
      if (existingError) {
        throw new Error(`house_point_team_members: ${existingError.message}`);
      }
      existingMemberIds = (existingRows ?? []).map(
        (r) => (r as { section_student_id: string }).section_student_id
      );
    }

    // Field-by-field, VALUE-changed diff — not key presence. Resubmitting a
    // team's own name, and/or its own member set (reordered or not), must
    // not write and must not leave an empty `house_points.team.update`
    // audit row. See lib/house-points/team-patch-diff.ts's header for the
    // bug this fixes.
    const diff = diffTeamPatch(
      { name: team.name, memberIds: existingMemberIds },
      { name: patch.name, sectionStudentIds: validatedIds ?? undefined }
    );

    // Fast no-op: neither field actually changed.
    if (diff.name === undefined && diff.memberIds === undefined) {
      return NextResponse.json({ ok: true, changed: false });
    }

    if (diff.name !== undefined) {
      step = 'rename team';
      const { error } = await service
        .from('house_point_teams')
        .update({ name: diff.name })
        .eq('id', teamId);
      if (error) throw new Error(`house_point_teams update: ${error.message}`);
    }

    if (diff.memberIds !== undefined) {
      step = 'delete existing members';
      const { error: deleteError } = await service
        .from('house_point_team_members')
        .delete()
        .eq('team_id', teamId);
      if (deleteError) {
        throw new Error(
          `house_point_team_members delete: ${deleteError.message}`
        );
      }

      step = 'insert replacement members';
      const { error: insertError } = await service
        .from('house_point_team_members')
        .insert(
          diff.memberIds.map((sectionStudentId) => ({
            team_id: teamId,
            section_student_id: sectionStudentId,
          }))
        );
      if (insertError) {
        // Compensating cleanup: no multi-statement transaction in
        // supabase-js. The old membership was already deleted above, so a
        // failed insert of the new list would otherwise leave the team with
        // NO members at all — put the old list back rather than shipping
        // that half-done state.
        step = 'restore members after failed replace';
        if (existingMemberIds.length > 0) {
          const { error: restoreError } = await service
            .from('house_point_team_members')
            .insert(
              existingMemberIds.map((sectionStudentId) => ({
                team_id: teamId,
                section_student_id: sectionStudentId,
              }))
            );
          if (restoreError) {
            console.error(
              '[house-points] teams PATCH: member rollback also failed',
              { teamId, restoreError: restoreError.message }
            );
          }
        }
        throw new Error(insertError.message);
      }
    }

    step = 'audit';
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      action: 'house_points.team.update',
      entityType: 'house_point_team',
      entityId: teamId,
      context: {
        event_id: team.event_id,
        name: diff.name ?? team.name,
        eventName: event.name,
        ...(diff.memberIds !== undefined
          ? { sectionStudentIds: diff.memberIds }
          : {}),
      },
    });

    if (event.ayCode) invalidateDrillTags('records', event.ayCode);

    return NextResponse.json({ ok: true, changed: true });
  } catch (e) {
    return failure(step, e, `PATCH ${teamId}`);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: Ctx
): Promise<NextResponse> {
  const auth = await requireRole([...HOUSE_POINTS_WRITERS]);
  if ('error' in auth && auth.error) return auth.error;

  const { teamId } = await params;

  let step = 'load team';
  try {
    const service = createServiceClient();
    const team = await loadTeamRow(service, teamId);
    if (!team) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    step = 'load event';
    const event = await loadEventForWrite(service, team.event_id);
    if (!event) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    step = 'count members';
    const { count, error: countError } = await service
      .from('house_point_team_members')
      .select('section_student_id', { count: 'exact', head: true })
      .eq('team_id', teamId);
    if (countError) {
      throw new Error(`house_point_team_members: ${countError.message}`);
    }

    step = 'delete team';
    const { error: deleteError } = await service
      .from('house_point_teams')
      .delete()
      .eq('id', teamId);
    if (deleteError) {
      throw new Error(`house_point_teams delete: ${deleteError.message}`);
    }

    step = 'audit';
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      action: 'house_points.team.delete',
      entityType: 'house_point_team',
      entityId: teamId,
      context: {
        event_id: team.event_id,
        name: team.name,
        eventName: event.name,
        memberCount: count ?? 0,
      },
    });

    if (event.ayCode) invalidateDrillTags('records', event.ayCode);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(step, e, `DELETE ${teamId}`);
  }
}
