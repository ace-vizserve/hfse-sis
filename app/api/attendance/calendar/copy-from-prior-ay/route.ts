import { NextResponse, type NextRequest } from 'next/server';

import { requireCapability } from '@/lib/auth/require-capability';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { CopyFromPriorAyPayloadSchema } from '@/lib/schemas/attendance';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { requireCurrentAyCode } from '@/lib/academic-year';

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
  const auth = await requireCapability('school_calendar.edit');
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = CopyFromPriorAyPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { targetTermId, dayTypeRows, events, markTentative } = parsed.data;

  if (dayTypeRows.length === 0 && events.length === 0) {
    return NextResponse.json({
      ok: true,
      dayTypeRowsCopied: 0,
      eventsCopied: 0,
    });
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
    return NextResponse.json(
      { error: 'unknown targetTermId' },
      { status: 400 }
    );
  }

  let dayTypeRowsCopied = 0;
  let eventsCopied = 0;

  // ── What the audit row carries ──────────────────────────────────────────
  //
  // ⚠ AN UPSERT OVERWRITES, and the copy is exactly where a registrar's own
  // edits to this term get replaced by last year's. Without the before values
  // the trail says "62 days copied" and nothing about the eleven that already
  // said something else. So each day this copy REPLACED is listed with what it
  // was; days that had no row are only counted.
  const overwrittenDays: Array<{
    date: string;
    audience: string;
    before_day_type: string | null;
    before_label: string | null;
    after_day_type: string;
    after_label: string | null;
  }> = [];
  let copiedEvents: Array<{
    id: string;
    startDate: string;
    endDate: string;
    label: string;
  }> = [];
  const actor = {
    id: auth.user.id,
    email: auth.user.email ?? null,
    role: auth.role,
  };
  const auditContext = (extra: Record<string, unknown> = {}) => ({
    dayTypeRowsCopied,
    eventsCopied,
    markTentative,
    overwrittenDays,
    copiedEvents,
    ...extra,
  });

  // 1. school_calendar overrides â€” upsert with onConflict on the widened
  // unique key. Idempotent re-run.
  if (dayTypeRows.length > 0) {
    // The rows this upsert will replace. A failed read does not block the copy
    // — the row is then logged without the before values it could not see.
    const { data: existingRows } = await service
      .from('school_calendar')
      .select('date, audience, day_type, label')
      .eq('term_id', targetTermId)
      .in('date', Array.from(new Set(dayTypeRows.map((r) => r.date))));
    const existingByKey = new Map(
      (
        (existingRows ?? []) as Array<{
          date: string;
          audience: string;
          day_type: string | null;
          label: string | null;
        }>
      ).map((r) => [`${r.date}|${r.audience}`, r])
    );
    for (const r of dayTypeRows) {
      const before = existingByKey.get(`${r.date}|${r.audience}`);
      if (!before) continue;
      overwrittenDays.push({
        date: r.date,
        audience: r.audience,
        before_day_type: before.day_type,
        before_label: before.label,
        after_day_type: r.dayType,
        after_label: r.label ?? null,
      });
    }

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
        { status: 500 }
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
    const { data: insertedEvents, error: insertErr } = await service
      .from('calendar_events')
      .insert(rows)
      .select('id, start_date, end_date, label');
    if (insertErr) {
      // ⚠ THE DAYS ABOVE ARE ALREADY COPIED. The upsert committed on its own;
      // only the events failed. A 500 with no audit row would leave a term's
      // calendar overwritten with nobody's name against it — so what landed is
      // logged, with the step that failed, before the error is returned.
      if (dayTypeRowsCopied > 0) {
        await logAction({
          service,
          actor,
          action: 'attendance.calendar.copy_from_prior_ay',
          entityType: 'school_calendar',
          entityId: targetTermId,
          context: auditContext({
            partial: true,
            failed_step: 'events_insert',
            eventsRequested: events.length,
          }),
        });
        invalidateDrillTags('attendance', await requireCurrentAyCode(service));
      }
      return NextResponse.json(
        { error: `calendar_events insert failed: ${insertErr.message}` },
        { status: 500 }
      );
    }
    copiedEvents = (
      (insertedEvents ?? []) as Array<{
        id: string;
        start_date: string;
        end_date: string;
        label: string;
      }>
    ).map((e) => ({
      id: e.id,
      startDate: e.start_date,
      endDate: e.end_date,
      label: e.label,
    }));
    eventsCopied = copiedEvents.length || rows.length;
  }

  await logAction({
    service,
    actor,
    action: 'attendance.calendar.copy_from_prior_ay',
    entityType: 'school_calendar',
    entityId: targetTermId,
    context: auditContext(),
  });

  // Cross-cutting: copy-from-prior-AY may bring PTC events with it, so bust
  // the evaluation cache too. Same rationale as the events route.
  {
    const ayCode = await requireCurrentAyCode(service);
    invalidateDrillTags('attendance', ayCode);
    invalidateDrillTags('evaluation', ayCode);
  }

  return NextResponse.json({ ok: true, dayTypeRowsCopied, eventsCopied });
}
