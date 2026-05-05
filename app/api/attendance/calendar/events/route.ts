import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import {
  CalendarEventCreateSchema,
  CalendarEventUpdateSchema,
} from '@/lib/schemas/attendance';

// POST /api/attendance/calendar/events
// Body: { termId, startDate, endDate, label, category?, audience?, tentative? }
// Creates a calendar_events row (informational overlay; doesn't block attendance).
// `category`, `audience`, `tentative` default to 'other' / 'all' / false
// (migration 037).
export async function POST(request: NextRequest) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = CalendarEventCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { termId, startDate, endDate, label, category, audience, tentative } = parsed.data;

  const service = createServiceClient();
  const { data, error } = await service
    .from('calendar_events')
    .insert({
      term_id: termId,
      start_date: startDate,
      end_date: endDate,
      label,
      category,
      audience,
      tentative,
      created_by: auth.user.id,
    })
    .select('id')
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'attendance.event.create',
    entityType: 'calendar_event',
    entityId: data.id,
    context: { termId, startDate, endDate, label, category, audience, tentative },
  });

  return NextResponse.json({ ok: true, id: data.id });
}

// PATCH /api/attendance/calendar/events
// Body: { id, ...partial fields }
// Updates an existing calendar_events row. Used by the "Confirm dates"
// affordance (flips tentative=false) and for editing other fields.
export async function PATCH(request: NextRequest) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = CalendarEventUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { id, ...fields } = parsed.data;

  // Build the patch payload from only the fields the caller provided.
  const patch: Record<string, unknown> = {};
  if (fields.startDate !== undefined) patch.start_date = fields.startDate;
  if (fields.endDate !== undefined) patch.end_date = fields.endDate;
  if (fields.label !== undefined) patch.label = fields.label;
  if (fields.category !== undefined) patch.category = fields.category;
  if (fields.audience !== undefined) patch.audience = fields.audience;
  if (fields.tentative !== undefined) patch.tentative = fields.tentative;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
  }

  const service = createServiceClient();
  const { error } = await service.from('calendar_events').update(patch).eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'attendance.event.update',
    entityType: 'calendar_event',
    entityId: id,
    context: { id, ...fields },
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/attendance/calendar/events?id=...
export async function DELETE(request: NextRequest) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const service = createServiceClient();
  const { error } = await service.from('calendar_events').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'attendance.event.delete',
    entityType: 'calendar_event',
    entityId: id,
    context: {},
  });

  return NextResponse.json({ ok: true });
}
