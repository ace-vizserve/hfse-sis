import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { CopyFromPriorAyPayloadSchema } from '@/lib/schemas/attendance';

// POST /api/attendance/calendar/copy-from-prior-ay
//
// Bulk copy of school_calendar overrides + calendar_events from a prior
// AY's term to the target term, with year-shifted dates already applied
// client-side (the dialog computes target dates so the registrar reviews
// them before submit).
//
// Default `markTentative=true` flips every copied row to tentative=true so
// the registrar reviews each before locking. Both target tables' upserts
// are idempotent â€” re-running on the same term is safe.
//
// Replaces the legacy single-purpose copy that only handled holidays
// (KD #50). New scope per migration 037: school_calendar overrides AND
// calendar_events with category + audience + tentative.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = CopyFromPriorAyPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { targetTermId, dayTypeRows, events, markTentative } = parsed.data;

  if (dayTypeRows.length === 0 && events.length === 0) {
    return NextResponse.json({ ok: true, dayTypeRowsCopied: 0, eventsCopied: 0 });
  }

  const service = createServiceClient();

  // Verify the term exists. Cheap guard so a bad targetTermId returns 400
  // rather than silently failing the upsert.
  const { data: term, error: termErr } = await service
    .from('terms')
    .select('id')
    .eq('id', targetTermId)
    .maybeSingle();
  if (termErr || !term) {
    return NextResponse.json({ error: 'unknown targetTermId' }, { status: 400 });
  }

  let dayTypeRowsCopied = 0;
  let eventsCopied = 0;

  // 1. school_calendar overrides â€” upsert with onConflict on the widened
  // unique key. Idempotent re-run.
  if (dayTypeRows.length > 0) {
    const rows = dayTypeRows.map((r) => ({
      term_id: targetTermId,
      date: r.date,
      day_type: r.dayType,
      audience: r.audience,
      is_holiday: r.dayType !== 'school_day' && r.dayType !== 'hbl',
      label: r.label ?? null,
      created_by: auth.user.id,
    }));
    const { error: upsertErr, count } = await service
      .from('school_calendar')
      .upsert(rows, { onConflict: 'term_id,audience,date', count: 'exact' });
    if (upsertErr) {
      return NextResponse.json(
        { error: `school_calendar upsert failed: ${upsertErr.message}` },
        { status: 500 },
      );
    }
    dayTypeRowsCopied = count ?? rows.length;
  }

  // 2. calendar_events â€” INSERT (no natural key; multiple events on the
  // same date are valid). The registrar can de-dupe via the admin UI if a
  // re-run is performed.
  if (events.length > 0) {
    const rows = events.map((e) => ({
      term_id: targetTermId,
      start_date: e.startDate,
      end_date: e.endDate,
      label: e.label,
      category: e.category,
      audience: e.audience,
      tentative: markTentative,
      created_by: auth.user.id,
    }));
    const { error: insertErr, count } = await service
      .from('calendar_events')
      .insert(rows, { count: 'exact' });
    if (insertErr) {
      return NextResponse.json(
        { error: `calendar_events insert failed: ${insertErr.message}` },
        { status: 500 },
      );
    }
    eventsCopied = count ?? rows.length;
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'attendance.calendar.copy_from_prior_ay',
    entityType: 'school_calendar',
    entityId: targetTermId,
    context: {
      dayTypeRowsCopied,
      eventsCopied,
      markTentative,
    },
  });

  return NextResponse.json({ ok: true, dayTypeRowsCopied, eventsCopied });
}
