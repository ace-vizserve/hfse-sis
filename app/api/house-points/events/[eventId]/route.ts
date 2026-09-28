import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { HOUSE_POINTS_WRITERS } from '@/lib/auth/student-record';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import type {
  EntrantKind,
  EventType,
  PlacementMode,
  RankWithin,
} from '@/lib/house-points/compute';
import {
  diffEventFields,
  placesUnchanged,
  type ExistingPlaceForDiff,
} from '@/lib/house-points/event-patch-diff';
import {
  EventPatchSchema,
  mergedEventIssues,
  type PlaceInput,
} from '@/lib/schemas/house-points';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH  /api/house-points/events/[eventId]
// DELETE /api/house-points/events/[eventId]
//
// Filed under `records` for cache invalidation and the audit log — same
// reasoning as the sibling POST /events route.

type Ctx = { params: Promise<{ eventId: string }> };

type EventDbRow = {
  id: string;
  name: string;
  held_on: string | null;
  event_type: EventType;
  entrant_kind: EntrantKind;
  placement_mode: PlacementMode;
  max_score: number | null;
  rank_within: RankWithin;
  academic_year_id: string;
  ayCode: string | null;
};

type EventDbRowRaw = Omit<EventDbRow, 'max_score' | 'ayCode'> & {
  max_score: number | string | null;
  academic_years: { ay_code: string } | { ay_code: string }[] | null;
};

function toNumOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  return typeof value === 'string' ? Number(value) : value;
}

function toAyCode(rel: EventDbRowRaw['academic_years']): string | null {
  const one = Array.isArray(rel) ? (rel[0] ?? null) : rel;
  return one?.ay_code ?? null;
}

async function loadEventRow(
  service: ReturnType<typeof createServiceClient>,
  eventId: string
): Promise<EventDbRow | null> {
  const { data, error } = await service
    .from('house_point_events')
    .select(
      'id, name, held_on, event_type, entrant_kind, placement_mode, max_score, rank_within, academic_year_id, academic_years(ay_code)'
    )
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw new Error(`house_point_events: ${error.message}`);
  if (!data) return null;
  const raw = data as EventDbRowRaw;
  return {
    id: raw.id,
    name: raw.name,
    held_on: raw.held_on,
    event_type: raw.event_type,
    entrant_kind: raw.entrant_kind,
    placement_mode: raw.placement_mode,
    max_score: toNumOrNull(raw.max_score),
    rank_within: raw.rank_within,
    academic_year_id: raw.academic_year_id,
    ayCode: toAyCode(raw.academic_years),
  };
}

function failure(step: string, e: unknown, what: string): NextResponse {
  console.error(
    `[house-points] events ${what} failed at "${step}":`,
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

export async function PATCH(
  request: NextRequest,
  { params }: Ctx
): Promise<NextResponse> {
  const auth = await requireRole([...HOUSE_POINTS_WRITERS]);
  if ('error' in auth && auth.error) return auth.error;

  const { eventId } = await params;

  const parsed = EventPatchSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const patch = parsed.data;

  let step = 'load event';
  try {
    const service = createServiceClient();
    const existing = await loadEventRow(service, eventId);
    if (!existing) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    // Field-by-field, VALUE-changed diff — not key presence. Resubmitting a
    // whole form unchanged (Task 8's edit sheet does this) must not write,
    // stamp updated_by/at, or leave an empty audit row. See
    // lib/house-points/event-patch-diff.ts's header for the bug this fixes.
    const { updateData, before, after } = diffEventFields(existing, patch);
    const placesSent = patch.places !== undefined;

    // Fast no-op: nothing was sent at all (EventPatchSchema allows `{}`).
    if (Object.keys(updateData).length === 0 && !placesSent) {
      return NextResponse.json({ ok: true, changed: false });
    }

    // The stored places are needed both to compare a SENT `places` array
    // against (did it actually change?) and to fill in the "places" side of
    // the MERGED event below whenever a places-adjacent field (placement
    // mode, entrant kind, max score) is changing but `places` itself wasn't
    // sent — only fetched when one of those is actually true.
    const needsExistingPlaces =
      placesSent ||
      'placement_mode' in updateData ||
      'entrant_kind' in updateData ||
      'max_score' in updateData;

    let existingPlaces: ExistingPlaceForDiff[] = [];
    if (needsExistingPlaces) {
      step = 'load existing places';
      const { data: placeRows, error: placeErr } = await service
        .from('house_point_places')
        .select('id, label, rank, points')
        .eq('event_id', eventId)
        .order('sort_order', { ascending: true });
      if (placeErr) throw new Error(`house_point_places: ${placeErr.message}`);
      existingPlaces = (placeRows ?? []) as ExistingPlaceForDiff[];
    }

    const placesActuallyChanged =
      placesSent && !placesUnchanged(existingPlaces, patch.places!);

    // Second no-op guard: every field resubmitted identical AND a sent
    // `places` array that's identical to what's stored — the "save the
    // whole form unchanged" case.
    if (Object.keys(updateData).length === 0 && !placesActuallyChanged) {
      return NextResponse.json({ ok: true, changed: false });
    }

    // Validate the MERGED (stored + patched) event against the same
    // cross-field rules EventInputSchema enforces on a full create —
    // EventPatchSchema alone can't see a rule spanning a sent field and an
    // unsent one (mergedEventIssues's own header spells out the two real
    // cases). Runs before any write, and before the DB's own check
    // constraints get a chance to turn the same problem into a 500.
    if (needsExistingPlaces) {
      const mergedPlacementMode: PlacementMode =
        patch.placementMode !== undefined
          ? patch.placementMode
          : existing.placement_mode;
      const mergedEntrantKind: EntrantKind =
        patch.entrantKind !== undefined
          ? patch.entrantKind
          : existing.entrant_kind;
      const mergedMaxScore =
        patch.maxScore !== undefined ? patch.maxScore : existing.max_score;
      const mergedPlaces: PlaceInput[] = placesSent
        ? patch.places!
        : existingPlaces.map((p) => ({
            id: p.id,
            label: p.label,
            rank: p.rank,
            points: p.points,
          }));

      const issues = mergedEventIssues({
        placementMode: mergedPlacementMode,
        entrantKind: mergedEntrantKind,
        maxScore: mergedMaxScore,
        places: mergedPlaces,
      });
      if (issues.length > 0) {
        return NextResponse.json(
          { error: issues[0], details: issues },
          { status: 400 }
        );
      }
    }

    // Switching placement_mode or entrant_kind is only a problem once the
    // event has participants — an empty event can still be reshaped freely.
    if (
      before.placementMode !== undefined ||
      before.entrantKind !== undefined
    ) {
      step = 'check entries for setup change';
      const { count, error } = await service
        .from('house_point_entries')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', eventId);
      if (error) throw new Error(`house_point_entries: ${error.message}`);
      if ((count ?? 0) > 0) {
        return NextResponse.json(
          {
            error:
              "This event already has participants, so its setup can't change.",
          },
          { status: 409 }
        );
      }
    }

    let omittedIds: string[] = [];
    if (placesActuallyChanged) {
      const existingIds = new Set(existingPlaces.map((p) => p.id));

      const incomingWithId = patch.places!.filter((p) => p.id !== undefined);
      const unknownIds = incomingWithId.filter(
        (p) => !existingIds.has(p.id as string)
      );
      if (unknownIds.length > 0) {
        return NextResponse.json(
          { error: 'That place could not be found.' },
          { status: 400 }
        );
      }

      const keepIds = new Set(incomingWithId.map((p) => p.id as string));
      omittedIds = [...existingIds].filter((id) => !keepIds.has(id));

      if (omittedIds.length > 0) {
        step = 'check omitted places for references';
        const { count, error } = await service
          .from('house_point_entries')
          .select('id', { count: 'exact', head: true })
          .in('place_id', omittedIds);
        if (error) throw new Error(`house_point_entries: ${error.message}`);
        if ((count ?? 0) > 0) {
          return NextResponse.json(
            {
              error:
                'A student already has that placement. Change their placement first.',
            },
            { status: 409 }
          );
        }
      }
    }

    // Everything below this line writes. Every validation above ran first,
    // so nothing here should return a 4xx mid-write.

    if (Object.keys(updateData).length > 0) {
      step = 'update event';
      const { error } = await service
        .from('house_point_events')
        .update({
          ...updateData,
          updated_by: auth.user.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', eventId);
      if (error) throw new Error(`house_point_events update: ${error.message}`);
    }

    if (placesActuallyChanged) {
      if (omittedIds.length > 0) {
        step = 'delete omitted places';
        const { error } = await service
          .from('house_point_places')
          .delete()
          .in('id', omittedIds);
        if (error)
          throw new Error(`house_point_places delete: ${error.message}`);
      }

      const toUpdate = patch
        .places!.map((place, index) => ({ place, index }))
        .filter(({ place }) => place.id !== undefined);
      if (toUpdate.length > 0) {
        step = 'upsert existing places';
        const { error } = await service.from('house_point_places').upsert(
          toUpdate.map(({ place, index }) => ({
            id: place.id,
            event_id: eventId,
            label: place.label,
            rank: place.rank,
            points: place.points,
            sort_order: index,
          }))
        );
        if (error)
          throw new Error(`house_point_places upsert: ${error.message}`);
      }

      const toInsert = patch
        .places!.map((place, index) => ({ place, index }))
        .filter(({ place }) => place.id === undefined);
      if (toInsert.length > 0) {
        step = 'insert new places';
        const { error } = await service.from('house_point_places').insert(
          toInsert.map(({ place, index }) => ({
            event_id: eventId,
            label: place.label,
            rank: place.rank,
            points: place.points,
            sort_order: index,
          }))
        );
        if (error)
          throw new Error(`house_point_places insert: ${error.message}`);
      }

      before.places = existingPlaces.map((p) => ({
        label: p.label,
        rank: p.rank,
        points: p.points,
      }));
      after.places = patch.places!.map((p) => ({
        label: p.label,
        rank: p.rank,
        points: p.points,
      }));
    }

    step = 'audit';
    const currentName = patch.name !== undefined ? patch.name : existing.name;
    const currentEventType =
      patch.eventType !== undefined ? patch.eventType : existing.event_type;
    const currentEntrantKind =
      patch.entrantKind !== undefined
        ? patch.entrantKind
        : existing.entrant_kind;
    const currentHeldOn =
      patch.heldOn !== undefined ? patch.heldOn : existing.held_on;
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      action: 'house_points.event.update',
      entityType: 'house_point_event',
      entityId: eventId,
      context: {
        name: currentName,
        eventType: currentEventType,
        entrantKind: currentEntrantKind,
        heldOn: currentHeldOn,
        before,
        after,
      },
    });

    if (existing.ayCode) invalidateDrillTags('records', existing.ayCode);

    return NextResponse.json({ ok: true, changed: true });
  } catch (e) {
    return failure(step, e, `PATCH ${eventId}`);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: Ctx
): Promise<NextResponse> {
  const auth = await requireRole([...HOUSE_POINTS_WRITERS]);
  if ('error' in auth && auth.error) return auth.error;

  const { eventId } = await params;

  let step = 'load event';
  try {
    const service = createServiceClient();
    const existing = await loadEventRow(service, eventId);
    if (!existing) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    step = 'check for participants';
    const { count, error: countError } = await service
      .from('house_point_entries')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId);
    if (countError)
      throw new Error(`house_point_entries: ${countError.message}`);
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: 'Remove every participant first' },
        { status: 409 }
      );
    }

    step = 'delete event';
    const { error: deleteError } = await service
      .from('house_point_events')
      .delete()
      .eq('id', eventId);
    if (deleteError)
      throw new Error(`house_point_events delete: ${deleteError.message}`);

    step = 'audit';
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      action: 'house_points.event.delete',
      entityType: 'house_point_event',
      entityId: eventId,
      context: {
        name: existing.name,
        eventType: existing.event_type,
        entrantKind: existing.entrant_kind,
        heldOn: existing.held_on,
      },
    });

    if (existing.ayCode) invalidateDrillTags('records', existing.ayCode);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(step, e, `DELETE ${eventId}`);
  }
}
