import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { HOUSE_POINTS_WRITERS } from '@/lib/auth/student-record';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { getAyIdByCode } from '@/lib/dashboard/ay-id';
import { EventInputSchema } from '@/lib/schemas/house-points';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/house-points/events
//
// Creates one house-points event and its place ladder in two statements —
// there is no multi-statement transaction available through supabase-js. If
// the event insert lands but the places insert fails, the half-created event
// is deleted before returning 500 so a caller never sees an event with no
// places (and a retry can't collide with it).
//
// Filed under `records` for cache invalidation (invalidateDrillTags) and the
// audit log (lib/audit/modules.ts's `house_points.` prefix), matching the
// migration 181 header: this is a records-owned scoring exercise, not a
// teaching-subject concern.

function failure(step: string, e: unknown): NextResponse {
  console.error(
    `[house-points] events POST failed at "${step}":`,
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireRole([...HOUSE_POINTS_WRITERS]);
  if ('error' in auth && auth.error) return auth.error;

  const parsed = EventInputSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;

  let step = 'resolve academic year';
  try {
    const academicYearId = await getAyIdByCode(input.ayCode);
    if (!academicYearId) {
      return NextResponse.json(
        { error: "That academic year doesn't exist" },
        { status: 404 }
      );
    }

    const service = createServiceClient();

    step = 'insert event';
    const { data: eventRow, error: eventError } = await service
      .from('house_point_events')
      .insert({
        academic_year_id: academicYearId,
        name: input.name,
        held_on: input.heldOn,
        event_type: input.eventType,
        entrant_kind: input.entrantKind,
        placement_mode: input.placementMode,
        max_score: input.maxScore,
        rank_within: input.rankWithin,
        created_by: auth.user.id,
      })
      .select('id')
      .single();
    if (eventError || !eventRow) {
      throw new Error(eventError?.message ?? 'insert returned no row');
    }
    const eventId = (eventRow as { id: string }).id;

    step = 'insert places';
    const { error: placesError } = await service
      .from('house_point_places')
      .insert(
        input.places.map((place, index) => ({
          event_id: eventId,
          label: place.label,
          rank: place.rank,
          points: place.points,
          sort_order: index,
        }))
      );
    if (placesError) {
      // Cleanup: the event was already inserted above. Without this, a
      // failed places insert would leave an event with no place ladder —
      // silently un-usable and blocking a retry under the same name.
      step = 'cleanup after failed places insert';
      const { error: cleanupError } = await service
        .from('house_point_events')
        .delete()
        .eq('id', eventId);
      if (cleanupError) {
        console.error(
          '[house-points] events POST: cleanup delete also failed',
          { eventId, cleanupError: cleanupError.message }
        );
      }
      throw new Error(placesError.message);
    }

    step = 'audit';
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      action: 'house_points.event.create',
      entityType: 'house_point_event',
      entityId: eventId,
      context: {
        name: input.name,
        eventType: input.eventType,
        entrantKind: input.entrantKind,
        placementMode: input.placementMode,
        heldOn: input.heldOn,
        places: input.places.map((p) => ({
          label: p.label,
          rank: p.rank,
          points: p.points,
        })),
      },
    });

    invalidateDrillTags('records', input.ayCode);

    return NextResponse.json({ ok: true, id: eventId }, { status: 201 });
  } catch (e) {
    return failure(step, e);
  }
}
