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
import { EventPatchSchema } from '@/lib/schemas/house-points';
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

// The one-of-seven patchable event columns, paired with the camelCase key
// EventPatchSchema validates it under. Walked once to build both the SQL
// update payload and the before/after audit diff, so the two cannot drift —
// a field added to one without the other would either silently not persist
// or silently not audit.
const PATCHABLE_FIELDS = [
  ['name', 'name'],
  ['heldOn', 'held_on'],
  ['eventType', 'event_type'],
  ['entrantKind', 'entrant_kind'],
  ['placementMode', 'placement_mode'],
  ['maxScore', 'max_score'],
  ['rankWithin', 'rank_within'],
] as const;

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

    // Build the update payload and the before/after diff in one pass — see
    // PATCHABLE_FIELDS's comment above.
    const updateData: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const [patchKey, dbKey] of PATCHABLE_FIELDS) {
      const value = patch[patchKey];
      if (value === undefined) continue;
      updateData[dbKey] = value;
      if (value !== existing[dbKey as keyof EventDbRow]) {
        before[patchKey] = existing[dbKey as keyof EventDbRow];
        after[patchKey] = value;
      }
    }

    const hasFieldChanges = Object.keys(updateData).length > 0;
    const hasPlacesChange = patch.places !== undefined;
    if (!hasFieldChanges && !hasPlacesChange) {
      return NextResponse.json({ ok: true, changed: false });
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

    let existingPlaces: {
      id: string;
      label: string;
      rank: number | null;
      points: number;
    }[] = [];
    let omittedIds: string[] = [];
    if (hasPlacesChange) {
      step = 'load existing places';
      const { data: placeRows, error: placeErr } = await service
        .from('house_point_places')
        .select('id, label, rank, points')
        .eq('event_id', eventId);
      if (placeErr) throw new Error(`house_point_places: ${placeErr.message}`);
      existingPlaces = (placeRows ?? []) as typeof existingPlaces;
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

    if (hasFieldChanges) {
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

    if (hasPlacesChange) {
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
