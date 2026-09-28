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
// is available through supabase-js). Unlike the events routes, there is
// nothing to clean up on a failed insert: the delete already committed, so a
// failed insert leaves that event_type's scale EMPTY until the next
// successful PUT rather than reverting to the old rows. That is an accepted
// trade-off, not an oversight — house_point_scales has no academic_year_id
// (migration 181) and is copied into an event's own house_point_places only
// at creation time (KD-equivalent header note: "changing scales never
// touches existing events"), so a transient empty scale can only ever affect
// the NEXT event created of that type, never anything already run.
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
    if (insertError)
      throw new Error(`house_point_scales insert: ${insertError.message}`);

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
