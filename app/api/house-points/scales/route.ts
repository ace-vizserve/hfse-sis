import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { HOUSE_POINTS_WRITERS } from '@/lib/auth/student-record';
import { ScalesPutSchema } from '@/lib/schemas/house-points';
import { createServiceClient } from '@/lib/supabase/service';

// PUT /api/house-points/scales
//
// Replaces the whole point ladder for one event_type — delete then insert,
// in two statements with a clear error step (no multi-statement transaction
// is available through supabase-js). A failed insert restores the rows the
// delete just removed, same "compensating cleanup" pattern as the team PATCH
// member rollback in app/api/house-points/teams/[teamId]/route.ts — without
// it, this event_type's scale would sit EMPTY until the next successful PUT.
// The restore itself can still fail (logged, never thrown, so the caller
// always sees the original insert error) — house_point_scales has no
// academic_year_id (migration 181) and is copied into an event's own
// house_point_places only at creation time ("changing scales never touches
// existing events"), so even that worst case can only ever affect the NEXT
// event created of that type, never anything already run.
//
// No cache invalidation here: house_point_scales isn't read behind
// `unstable_cache`/`revalidateTag` anywhere (lib/house-points/queries.ts's
// loadScales() is a plain, uncached server loader) and the table isn't
// AY-scoped, so there is no `invalidateDrillTags('records', ayCode)` call to
// make — unlike the events routes, which do invalidate the records tags.

function toNum(value: number | string): number {
  return typeof value === 'string' ? Number(value) : value;
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const auth = await requireRole([...HOUSE_POINTS_WRITERS]);
  if ('error' in auth && auth.error) return auth.error;

  const parsed = ScalesPutSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { eventType, rows } = parsed.data;

  let step = 'load existing rows';
  try {
    const service = createServiceClient();

    const { data: oldRows, error: loadError } = await service
      .from('house_point_scales')
      .select('label, rank, points, sort_order')
      .eq('event_type', eventType)
      .order('sort_order', { ascending: true });
    if (loadError)
      throw new Error(`house_point_scales load: ${loadError.message}`);

    step = 'delete existing rows';
    const { error: deleteError } = await service
      .from('house_point_scales')
      .delete()
      .eq('event_type', eventType);
    if (deleteError)
      throw new Error(`house_point_scales delete: ${deleteError.message}`);

    step = 'insert new rows';
    const { error: insertError } = await service
      .from('house_point_scales')
      .insert(
        rows.map((row, index) => ({
          event_type: eventType,
          label: row.label,
          rank: row.rank,
          points: row.points,
          sort_order: index,
        }))
      );
    if (insertError) {
      // Compensating cleanup: no multi-statement transaction in
      // supabase-js. The old ladder was already deleted above, so a failed
      // insert of the new one would otherwise leave this event_type with NO
      // scale at all — put the old rows back rather than shipping that
      // half-done state (same pattern as the team PATCH member rollback in
      // app/api/house-points/teams/[teamId]/route.ts).
      step = 'restore rows after failed insert';
      if ((oldRows ?? []).length > 0) {
        const { error: restoreError } = await service
          .from('house_point_scales')
          .insert(
            (oldRows ?? []).map((row) => ({
              event_type: eventType,
              label: row.label,
              rank: row.rank,
              points: row.points,
              sort_order: row.sort_order,
            }))
          );
        if (restoreError) {
          console.error('[house-points] scales PUT: rollback also failed', {
            eventType,
            restoreError: restoreError.message,
          });
        }
      }
      throw new Error(insertError.message);
    }

    step = 'audit';
    const before = (oldRows ?? []).map((row) => ({
      label: row.label,
      rank: row.rank,
      points: toNum(row.points as number | string),
    }));
    const after = rows.map((row) => ({
      label: row.label,
      rank: row.rank,
      points: row.points,
    }));
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      action: 'house_points.scales.update',
      entityType: 'house_point_scale',
      entityId: eventType,
      context: { eventType, rows: after, before, after },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(
      `[house-points] scales PUT failed at "${step}":`,
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
}
