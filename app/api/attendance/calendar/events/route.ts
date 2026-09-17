import { NextResponse, type NextRequest } from 'next/server';

import { requireCapability } from '@/lib/auth/require-capability';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import {
  CalendarEventCreateSchema,
  CalendarEventUpdateSchema,
} from '@/lib/schemas/attendance';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { requireCurrentAyCode } from '@/lib/academic-year';

// What an audit row says about an event: every field a person can set, read
// back from the database. Shared by PATCH (before and after) and DELETE (what
// was removed) so the two cannot drift.
const EVENT_AUDIT_COLUMNS =
  'term_id, start_date, end_date, label, category, audience, levels, section_ids, tentative';

type EventAuditRow = {
  term_id: string | null;
  start_date: string | null;
  end_date: string | null;
  label: string | null;
  category: string | null;
  audience: string | null;
  levels: string[] | null;
  section_ids: string[] | null;
  tentative: boolean | null;
};

/** The create route's key names, so every event row in the log reads alike. */
function eventAuditShape(row: EventAuditRow) {
  return {
    termId: row.term_id,
    startDate: row.start_date,
    endDate: row.end_date,
    label: row.label,
    category: row.category,
    audience: row.audience,
    levels: row.levels,
    sectionIds: row.section_ids,
    tentative: row.tentative,
  };
}

// POST /api/attendance/calendar/events
// Body: { termId, startDate, endDate, label, category?, audience?, tentative? }
// Creates a calendar_events row (informational overlay; doesn't block attendance).
// `category`, `audience`, `tentative` default to 'other' / 'all' / false
// (migration 037).
export async function POST(request: NextRequest) {
  const auth = await requireCapability('school_calendar.edit');
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = CalendarEventCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const {
    termId,
    startDate,
    endDate,
    label,
    category,
    audience,
    tentative,
    levels,
    sectionIds,
  } = parsed.data;
  // Accountability flag from the client warning (a passed date was changed).
  // Read from the raw body — it's not part of the row schema.
  const pastDateOverride =
    (body as { pastDateOverride?: unknown })?.pastDateOverride === true;

  const service = createServiceClient();
  const { data, error } = await service
    .from('calendar_events')
    .insert({
      term_id: termId,
      start_date: startDate,
      end_date: endDate,
      label,
      category,
      // `audience` is derived from `levels` by a trigger (migration 158) when
      // a scope is given, so what we send here only stands for a whole-school
      // event. Sending it regardless keeps the pre-158 callers working.
      audience,
      levels: levels ?? null,
      section_ids: sectionIds ?? null,
      tentative,
      created_by: auth.user.id,
    })
    .select('id')
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'insert failed' },
      { status: 500 }
    );
  }

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'attendance.event.create',
    entityType: 'calendar_event',
    entityId: data.id,
    context: {
      termId,
      startDate,
      endDate,
      label,
      category,
      audience,
      levels: levels ?? null,
      sectionIds: sectionIds ?? null,
      tentative,
      ...(pastDateOverride ? { pastDateOverride: true } : {}),
    },
  });

  // Calendar events are shared infrastructure: attendance reads day-type
  // overlays + term_exam/term_break/etc. for grid annotations; evaluation
  // reads PTC events (KD #76 + the PTC resolver) for adviser/registrar
  // deadline awareness. Bust both module caches on every mutation so the
  // 60s priority panel TTL doesn't strand stale dates after the registrar
  // moves an event.
  {
    const ayCode = await requireCurrentAyCode(service);
    invalidateDrillTags('attendance', ayCode);
    invalidateDrillTags('evaluation', ayCode);
  }

  return NextResponse.json({ ok: true, id: data.id });
}

// PATCH /api/attendance/calendar/events
// Body: { id, ...partial fields }
// Updates an existing calendar_events row. Used by the "Confirm dates"
// affordance (flips tentative=false) and for editing other fields.
export async function PATCH(request: NextRequest) {
  const auth = await requireCapability('school_calendar.edit');
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = CalendarEventUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { id, ...fields } = parsed.data;
  // Accountability flag from the client warning (a passed date was changed).
  const pastDateOverride =
    (body as { pastDateOverride?: unknown })?.pastDateOverride === true;

  // Build the patch payload from only the fields the caller provided.
  const patch: Record<string, unknown> = {};
  if (fields.startDate !== undefined) patch.start_date = fields.startDate;
  if (fields.endDate !== undefined) patch.end_date = fields.endDate;
  if (fields.label !== undefined) patch.label = fields.label;
  if (fields.category !== undefined) patch.category = fields.category;
  if (fields.audience !== undefined) patch.audience = fields.audience;
  if (fields.tentative !== undefined) patch.tentative = fields.tentative;
  // An explicit null CLEARS the scope back to whole-school; omitting the key
  // leaves it alone. The two are not interchangeable, so both are forwarded
  // only when the caller actually sent them. `audience` is re-derived by the
  // migration-158 trigger whenever a scope is present.
  if (fields.levels !== undefined) patch.levels = fields.levels;
  if (fields.sectionIds !== undefined) patch.section_ids = fields.sectionIds;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
  }

  const service = createServiceClient();

  // The event as it stood, for the audit row's before values. Read first and
  // separately because PostgREST's update returns only the row AFTER. A failed
  // read does not block the edit — the row is then logged without `before`.
  const { data: beforeRow } = await service
    .from('calendar_events')
    .select(EVENT_AUDIT_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  const { data: afterRows, error } = await service
    .from('calendar_events')
    .update(patch)
    .eq('id', id)
    .select(EVENT_AUDIT_COLUMNS);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const afterRow = ((afterRows ?? []) as EventAuditRow[])[0] ?? null;

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'attendance.event.update',
    entityType: 'calendar_event',
    entityId: id,
    context: {
      id,
      ...fields,
      // The whole event before and after, in the same shape as each other.
      // `after` is what the database holds once the audience trigger
      // (migration 158) has re-derived it, which the request alone cannot say.
      // `updated: false` means no row matched the id — nothing changed.
      updated: afterRow != null,
      before: beforeRow ? eventAuditShape(beforeRow as EventAuditRow) : null,
      after: afterRow ? eventAuditShape(afterRow) : null,
      ...(pastDateOverride ? { pastDateOverride: true } : {}),
    },
  });

  // Calendar events are shared infrastructure: attendance reads day-type
  // overlays + term_exam/term_break/etc. for grid annotations; evaluation
  // reads PTC events (KD #76 + the PTC resolver) for adviser/registrar
  // deadline awareness. Bust both module caches on every mutation so the
  // 60s priority panel TTL doesn't strand stale dates after the registrar
  // moves an event.
  {
    const ayCode = await requireCurrentAyCode(service);
    invalidateDrillTags('attendance', ayCode);
    invalidateDrillTags('evaluation', ayCode);
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/attendance/calendar/events?id=...
export async function DELETE(request: NextRequest) {
  const auth = await requireCapability('school_calendar.edit');
  if ('error' in auth) return auth.error;

  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const service = createServiceClient();
  // `.select()` on the delete returns the removed row from the same statement,
  // so the audit row says what was deleted rather than only its id — which,
  // once the row is gone, points at nothing.
  const { data: deletedRows, error } = await service
    .from('calendar_events')
    .delete()
    .eq('id', id)
    .select(EVENT_AUDIT_COLUMNS);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const deleted = ((deletedRows ?? []) as EventAuditRow[])[0] ?? null;

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'attendance.event.delete',
    entityType: 'calendar_event',
    entityId: id,
    // Flat, with the create route's key names, so a delete reads like the
    // create it undoes. `removed: false` when no row matched the id.
    context: deleted
      ? { removed: true, ...eventAuditShape(deleted) }
      : { removed: false },
  });

  // Calendar events are shared infrastructure: attendance reads day-type
  // overlays + term_exam/term_break/etc. for grid annotations; evaluation
  // reads PTC events (KD #76 + the PTC resolver) for adviser/registrar
  // deadline awareness. Bust both module caches on every mutation so the
  // 60s priority panel TTL doesn't strand stale dates after the registrar
  // moves an event.
  {
    const ayCode = await requireCurrentAyCode(service);
    invalidateDrillTags('attendance', ayCode);
    invalidateDrillTags('evaluation', ayCode);
  }

  return NextResponse.json({ ok: true });
}
