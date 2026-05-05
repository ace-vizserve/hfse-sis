import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { weekdaysBetween } from '@/lib/attendance/calendar';
import {
  AUDIENCE_VALUES,
  resolveDayType,
  SchoolCalendarUpsertSchema,
  type Audience,
} from '@/lib/schemas/attendance';

// POST /api/attendance/calendar
// Body â€” either:
//   { termId, audience?, entries: [{ date, dayType|isHoliday, label? }, ...] }
//   { termId, audience?, action: 'autofill_weekdays', start?, end? }
//
// `audience` (default 'all') tags every row so primary/secondary overrides
// can coexist with the global 'all' baseline (migration 037, KD audience-
// precedence rule).
//
// Registrar+ only. Audit action: `attendance.calendar.upsert`.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const service = createServiceClient();

  // Autofill branch.
  if (body.action === 'autofill_weekdays') {
    const termId = typeof body.termId === 'string' ? body.termId : null;
    if (!termId) {
      return NextResponse.json({ error: 'termId required' }, { status: 400 });
    }
    const audience: Audience = AUDIENCE_VALUES.includes(body.audience)
      ? (body.audience as Audience)
      : 'all';
    const { data: term, error: termErr } = await service
      .from('terms')
      .select('id, start_date, end_date')
      .eq('id', termId)
      .maybeSingle();
    if (termErr || !term) {
      return NextResponse.json({ error: 'unknown termId' }, { status: 400 });
    }
    const start = typeof body.start === 'string' ? body.start : term.start_date;
    const end = typeof body.end === 'string' ? body.end : term.end_date;
    const dates = weekdaysBetween(start, end);

    const rows = dates.map((date) => ({
      term_id: termId,
      date,
      day_type: 'school_day' as const,
      audience,
      is_holiday: false,
      label: null,
      created_by: auth.user.id,
    }));
    const { error: upsertErr, count } = await service
      .from('school_calendar')
      .upsert(rows, {
        onConflict: 'term_id,audience,date',
        ignoreDuplicates: true,
        count: 'exact',
      });
    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'attendance.calendar.upsert',
      entityType: 'school_calendar',
      entityId: termId,
      context: { action: 'autofill_weekdays', audience, start, end, inserted: count ?? rows.length },
    });
    return NextResponse.json({ ok: true, seeded: rows.length, inserted: count });
  }

  // Bulk upsert branch.
  const parsed = SchoolCalendarUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { termId, entries } = parsed.data;
  const audience: Audience = parsed.data.audience;

  // Load previous day_types for these (term, date, audience) tuples so the
  // audit diff captures what changed. Cheap â€” HFSE volumes are small and
  // entries max 200.
  const dates = entries.map((e) => e.date);
  const { data: beforeRows } = await service
    .from('school_calendar')
    .select('date, day_type, audience')
    .eq('term_id', termId)
    .eq('audience', audience)
    .in('date', dates);
  const beforeByDate = new Map<string, string>(
    ((beforeRows ?? []) as Array<{ date: string; day_type: string }>).map((r) => [
      r.date,
      r.day_type,
    ]),
  );

  const rows = entries.map((e) => {
    const dayType = resolveDayType(e);
    return {
      term_id: termId,
      date: e.date,
      day_type: dayType,
      audience,
      // is_holiday is derived by the migration-019 trigger; we still pass a
      // value here for rows that existed pre-migration and haven't been
      // re-written yet. Trigger will overwrite anyway.
      is_holiday: dayType !== 'school_day' && dayType !== 'hbl',
      label: e.label ?? null,
      created_by: auth.user.id,
    };
  });

  const { error: upsertErr } = await service
    .from('school_calendar')
    .upsert(rows, { onConflict: 'term_id,audience,date' });
  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  const diffs = rows.map((r) => ({
    date: r.date,
    audience: r.audience,
    before_day_type: beforeByDate.get(r.date) ?? null,
    after_day_type: r.day_type,
    label: r.label,
  }));

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'attendance.calendar.upsert',
    entityType: 'school_calendar',
    entityId: termId,
    context: { action: 'upsert', audience, rows: rows.length, diffs },
  });

  return NextResponse.json({ ok: true, upserted: rows.length });
}

// DELETE /api/attendance/calendar?termId=...&date=YYYY-MM-DD&audience=all|primary|secondary
// Removes the calendar entry for a specific (term, date, audience).
// Default audience='all' â€” matches the legacy single-row-per-date behavior.
export async function DELETE(request: NextRequest) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const termId = request.nextUrl.searchParams.get('termId');
  const date = request.nextUrl.searchParams.get('date');
  const rawAudience = request.nextUrl.searchParams.get('audience') ?? 'all';
  const audience: Audience = AUDIENCE_VALUES.includes(rawAudience as Audience)
    ? (rawAudience as Audience)
    : 'all';
  if (!termId || !date) {
    return NextResponse.json({ error: 'termId and date are required' }, { status: 400 });
  }

  const service = createServiceClient();
  const { error } = await service
    .from('school_calendar')
    .delete()
    .eq('term_id', termId)
    .eq('audience', audience)
    .eq('date', date);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'attendance.calendar.delete',
    entityType: 'school_calendar',
    entityId: termId,
    context: { date, audience },
  });

  return NextResponse.json({ ok: true });
}
