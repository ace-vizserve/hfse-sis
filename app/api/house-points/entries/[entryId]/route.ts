import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { HOUSE_POINTS_WRITERS } from '@/lib/auth/student-record';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { loadEventForWrite, loadRosterByIds } from '@/lib/house-points/queries';
import {
  blocksTeamEntryDelete,
  REMOVE_TEAM_INSTEAD_ERROR,
} from '@/lib/house-points/write-guards';
import { EntryPatchSchema } from '@/lib/schemas/house-points';
import { listHouses } from '@/lib/sis/houses';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH  /api/house-points/entries/[entryId]
// DELETE /api/house-points/entries/[entryId]
//
// One entry on an event's score sheet — a student, a team, or a house. PATCH
// changes the award picked for it (or clears it: `placeId: null`); DELETE removes it outright (a team's own entry can also be removed this
// way, though DELETE /api/house-points/teams/[teamId] is the usual path for
// a team since it also clears the team and its members).
//
// Filed under `records` for cache invalidation and the audit log, matching
// every other House Points write route.

type Ctx = { params: Promise<{ entryId: string }> };

type EntryRow = {
  id: string;
  event_id: string;
  section_student_id: string | null;
  team_id: string | null;
  house_id: string | null;
  place_id: string | null;
};

type ServiceClient = ReturnType<typeof createServiceClient>;

function failure(step: string, e: unknown, what: string): NextResponse {
  console.error(
    `[house-points] entries ${what} failed at "${step}":`,
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

async function loadEntryRow(
  service: ServiceClient,
  entryId: string
): Promise<EntryRow | null> {
  const { data, error } = await service
    .from('house_point_entries')
    .select('id, event_id, section_student_id, team_id, house_id, place_id')
    .eq('id', entryId)
    .maybeSingle();
  if (error) throw new Error(`house_point_entries: ${error.message}`);
  return (data as EntryRow | null) ?? null;
}

/** The student/team/house label the audit log's humanizer reads — one of
 * `studentName`+`studentNumber` (student lead, lib/audit/humanize.ts),
 * `teamName`, or `houseName`. Empty object if none resolve (a dangling
 * reference the row no longer needs to identify). */
async function resolveEntryIdentity(
  service: ServiceClient,
  entry: EntryRow
): Promise<Record<string, string>> {
  if (entry.section_student_id) {
    const roster = await loadRosterByIds(service, [entry.section_student_id]);
    const student = roster.get(entry.section_student_id);
    return student
      ? { studentName: student.name, studentNumber: student.studentNumber }
      : {};
  }
  if (entry.team_id) {
    const { data } = await service
      .from('house_point_teams')
      .select('name')
      .eq('id', entry.team_id)
      .maybeSingle();
    const name = (data as { name: string } | null)?.name;
    return name ? { teamName: name } : {};
  }
  if (entry.house_id) {
    const houses = await listHouses();
    const house = houses.find((h) => h.id === entry.house_id);
    return house ? { houseName: house.name } : {};
  }
  return {};
}

export async function PATCH(
  request: NextRequest,
  { params }: Ctx
): Promise<NextResponse> {
  const auth = await requireRole([...HOUSE_POINTS_WRITERS]);
  if ('error' in auth && auth.error) return auth.error;

  const { entryId } = await params;

  const parsed = EntryPatchSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const patch = parsed.data;

  let step = 'load entry';
  try {
    const service = createServiceClient();
    const entry = await loadEntryRow(service, entryId);
    if (!entry) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    step = 'load event';
    const event = await loadEventForWrite(service, entry.event_id);
    if (!event) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    // Fetched once, for both the placeId check and the audit row's
    // before/after award labels.
    step = 'load places';
    const { data: placeRows, error: placesError } = await service
      .from('house_point_places')
      .select('id, label')
      .eq('event_id', event.id);
    if (placesError) {
      throw new Error(`house_point_places: ${placesError.message}`);
    }
    const places = (placeRows ?? []) as { id: string; label: string }[];
    const labelFor = (id: string | null): string | null =>
      id ? (places.find((p) => p.id === id)?.label ?? null) : null;

    if (patch.placeId !== null && !places.some((p) => p.id === patch.placeId)) {
      return NextResponse.json(
        { error: "That award isn't on this event's rubric." },
        { status: 400 }
      );
    }

    // Resubmitting the award already stored — a no-op, no write and no
    // audit row (Task 5's review required this for the sibling event PATCH;
    // the same non-negotiable applies here so re-saving an unchanged score
    // sheet row doesn't spam the audit log).
    if (patch.placeId === entry.place_id) {
      return NextResponse.json({ ok: true, changed: false });
    }

    step = 'update entry';
    const { error: updateError } = await service
      .from('house_point_entries')
      .update({
        place_id: patch.placeId,
        updated_by: auth.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entryId);
    if (updateError) {
      throw new Error(`house_point_entries update: ${updateError.message}`);
    }

    const finalPlaceId = patch.placeId;

    step = 'resolve identity';
    const identity = await resolveEntryIdentity(service, entry);

    step = 'audit';
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      action: 'house_points.entry.update',
      entityType: 'house_point_entry',
      entityId: entryId,
      context: {
        event_id: event.id,
        eventName: event.name,
        ...identity,
        before: {
          placeId: entry.place_id,
          placeLabel: labelFor(entry.place_id),
        },
        after: {
          placeId: finalPlaceId,
          placeLabel: labelFor(finalPlaceId),
        },
        placeLabel: labelFor(finalPlaceId),
      },
    });

    if (event.ayCode) invalidateDrillTags('records', event.ayCode);

    return NextResponse.json({
      ok: true,
      entry: { id: entryId, placeId: finalPlaceId },
    });
  } catch (e) {
    return failure(step, e, `PATCH ${entryId}`);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: Ctx
): Promise<NextResponse> {
  const auth = await requireRole([...HOUSE_POINTS_WRITERS]);
  if ('error' in auth && auth.error) return auth.error;

  const { entryId } = await params;

  let step = 'load entry';
  try {
    const service = createServiceClient();
    const entry = await loadEntryRow(service, entryId);
    if (!entry) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    step = 'load event';
    const event = await loadEventForWrite(service, entry.event_id);
    if (!event) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    // A team's entry carries the team's award — deleting it here
    // orphans the team (it stays on the roster with members but no sheet
    // row) and permanently locks its members as "on another team" (KD
    // #228's one-team-per-student rule keys off house_point_team_members,
    // which this route never touches). DELETE
    // /api/house-points/teams/[teamId] removes the team, its members and
    // this same entry together — the route that must be used instead.
    if (blocksTeamEntryDelete(entry)) {
      return NextResponse.json(
        { error: REMOVE_TEAM_INSTEAD_ERROR },
        { status: 400 }
      );
    }

    step = 'resolve identity';
    const identity = await resolveEntryIdentity(service, entry);

    step = 'delete entry';
    const { error: deleteError } = await service
      .from('house_point_entries')
      .delete()
      .eq('id', entryId);
    if (deleteError) {
      throw new Error(`house_point_entries delete: ${deleteError.message}`);
    }

    step = 'audit';
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      action: 'house_points.entry.remove',
      entityType: 'house_point_entry',
      entityId: entryId,
      context: {
        event_id: event.id,
        eventName: event.name,
        ...identity,
      },
    });

    if (event.ayCode) invalidateDrillTags('records', event.ayCode);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(step, e, `DELETE ${entryId}`);
  }
}
