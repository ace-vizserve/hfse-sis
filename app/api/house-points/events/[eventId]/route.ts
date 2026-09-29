import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { HOUSE_POINTS_WRITERS } from '@/lib/auth/student-record';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import type { EntrantKind, EventType } from '@/lib/house-points/compute';
import {
  diffEventFields,
  placesUnchanged,
  type ExistingPlaceForDiff,
} from '@/lib/house-points/event-patch-diff';
import { loadEvent, toNum, type EventDetail } from '@/lib/house-points/queries';
import { EventPatchSchema } from '@/lib/schemas/house-points';
import { listHouses, type HouseRow } from '@/lib/sis/houses';
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
  academic_year_id: string;
  ayCode: string | null;
};

type EventDbRowRaw = Omit<EventDbRow, 'ayCode'> & {
  academic_years: { ay_code: string } | { ay_code: string }[] | null;
};

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
      'id, name, held_on, event_type, entrant_kind, academic_year_id, academic_years(ay_code)'
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

    // The stored places are needed to compare a SENT `places` array against
    // (did it actually change?) — only fetched when `places` was sent.
    let existingPlaces: ExistingPlaceForDiff[] = [];
    if (placesSent) {
      step = 'load existing places';
      const { data: placeRows, error: placeErr } = await service
        .from('house_point_places')
        .select('id, label, rank, points')
        .eq('event_id', eventId)
        .order('sort_order', { ascending: true });
      if (placeErr) throw new Error(`house_point_places: ${placeErr.message}`);
      // `points` is `numeric(6,2)` (migration 181) — supabase-js can hand
      // this back as a STRING ("5.00"). Coerced here, at the fetch site, so
      // every downstream reader (placesUnchanged's comparison and
      // before.places on the audit row) sees a real
      // number rather than comparing e.g. `5 === "5.00"` and calling an
      // identical resubmission a change.
      existingPlaces = (
        (placeRows ?? []) as {
          id: string;
          label: string;
          rank: number | null;
          points: number | string;
        }[]
      ).map((row) => ({
        id: row.id,
        label: row.label,
        rank: row.rank,
        points: toNum(row.points),
      }));
    }

    const placesActuallyChanged =
      placesSent && !placesUnchanged(existingPlaces, patch.places!);

    // Second no-op guard: every field resubmitted identical AND a sent
    // `places` array that's identical to what's stored — the "save the
    // whole form unchanged" case.
    if (Object.keys(updateData).length === 0 && !placesActuallyChanged) {
      return NextResponse.json({ ok: true, changed: false });
    }

    // Switching entrant_kind is only a problem once the event has
    // participants — an empty event can still be reshaped freely.
    if (before.entrantKind !== undefined) {
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
                'Someone in this event already has that award. Change their award first.',
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

// ─────────────────────────────────────────────────────────────────────────
// DELETE snapshot — Mr Ace, 2026-09-29: "you dont have to be hard on rules
// bro, as long as all is audit logged". An event with results can be deleted
// outright; what makes that safe is that the ONE audit row written below
// carries enough of the event back (every result's entrant, award and
// points, plus the rubric it was scored against) that it could be typed back
// in by hand. `loadEvent` already coerces every `numeric` column via `toNum`
// (see toPlace in lib/house-points/queries.ts), so nothing read from it here
// needs re-coercing.

type ResultSnapshotEntrant =
  | { kind: 'student'; name: string; studentNumber: string; className: string }
  | {
      kind: 'team';
      teamName: string;
      members: { name: string; studentNumber: string }[];
    }
  | { kind: 'house'; houseName: string };

type ResultSnapshot = {
  // null when the underlying student/team/house row no longer resolves
  // (e.g. a since-deleted team) — the award is still worth recording.
  entrant: ResultSnapshotEntrant | null;
  award: { label: string; points: number } | null;
};

function buildResultsSnapshot(
  event: EventDetail,
  houseNameById: Map<string, string>
): ResultSnapshot[] {
  const placesById = new Map(event.places.map((p) => [p.id, p]));
  return event.rows.map((row) => {
    const place = row.placeId ? (placesById.get(row.placeId) ?? null) : null;
    const award = place ? { label: place.label, points: place.points } : null;

    let entrant: ResultSnapshotEntrant | null = null;
    if (row.kind === 'student' && row.student) {
      entrant = {
        kind: 'student',
        name: row.student.name,
        studentNumber: row.student.studentNumber,
        className: row.student.sectionName,
      };
    } else if (row.kind === 'team' && row.team) {
      entrant = {
        kind: 'team',
        teamName: row.team.name,
        members: row.team.members.map((m) => ({
          name: m.name,
          studentNumber: m.studentNumber,
        })),
      };
    } else if (row.kind === 'house' && row.houseId) {
      const houseName = houseNameById.get(row.houseId);
      if (houseName) entrant = { kind: 'house', houseName };
    }

    return { entrant, award };
  });
}

function pointsByHouseName(
  totals: Record<string, number>,
  houses: HouseRow[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of houses) out[h.name] = totals[h.id] ?? 0;
  return out;
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

    // Any event can be deleted, participants or not (KD #228 update, Mr
    // Ace 2026-09-29) — the 409 that used to sit here is gone. What replaces
    // it as the safety net is the snapshot below, taken BEFORE the delete.
    step = 'load snapshot';
    const houses = await listHouses();
    const detail = await loadEvent(eventId, houses);
    const houseNameById = new Map(houses.map((h) => [h.id, h.name]));
    const results = detail ? buildResultsSnapshot(detail, houseNameById) : [];
    const pointsByHouse = detail
      ? pointsByHouseName(detail.totals, houses)
      : {};
    const placesSnapshot = (detail?.places ?? []).map((p) => ({
      label: p.label,
      rank: p.rank,
      points: p.points,
    }));

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
        eventName: existing.name,
        eventType: existing.event_type,
        entrantKind: existing.entrant_kind,
        heldOn: existing.held_on,
        resultCount: results.length,
        pointsByHouse,
        results,
        places: placesSnapshot,
      },
    });

    if (existing.ayCode) invalidateDrillTags('records', existing.ayCode);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(step, e, `DELETE ${eventId}`);
  }
}
