import { NextResponse, type NextRequest } from 'next/server';

import { requireCapability } from '@/lib/auth/require-capability';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { weekdaysBetween } from '@/lib/attendance/calendar';
import {
  DAY_AUDIENCE_VALUES,
  resolveDayType,
  schoolCalendarAudiences,
  SchoolCalendarUpsertSchema,
  type DayAudience,
} from '@/lib/schemas/attendance';

const isDayAudience = (v: unknown): v is DayAudience =>
  typeof v === 'string' &&
  (DAY_AUDIENCE_VALUES as readonly string[]).includes(v);
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { ayCodeForTerm } from '@/lib/cache/ay-code-for-row';

// POST /api/attendance/calendar
// Body â€” either:
//   { termId, audience?, audiences?, entries: [{ date, dayType|isHoliday, label? }, ...] }
//   { termId, audience?, action: 'autofill_weekdays', start?, end? }
//
// `audience` (default 'all') tags every row so primary/secondary overrides
// can coexist with the global 'all' baseline (migration 037, KD audience-
// precedence rule). Since migration 196 it may also be a level code (P1–S4).
// `audiences` writes the same entries once per audience in one upsert; when
// both are sent `audiences` wins (see SchoolCalendarUpsertSchema).
//
// Registrar+ only. Audit action: `attendance.calendar.upsert`.
export async function POST(request: NextRequest) {
  const auth = await requireCapability('school_calendar.edit');
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
    const audience: DayAudience = isDayAudience(body.audience)
      ? body.audience
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
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
      action: 'attendance.calendar.upsert',
      entityType: 'school_calendar',
      entityId: termId,
      context: {
        action: 'autofill_weekdays',
        audience,
        start,
        end,
        inserted: count ?? rows.length,
      },
    });
    invalidateDrillTags('attendance', await ayCodeForTerm(service, termId));
    return NextResponse.json({
      ok: true,
      seeded: rows.length,
      inserted: count,
    });
  }

  // Bulk upsert branch.
  const parsed = SchoolCalendarUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { termId, entries } = parsed.data;
  const audiences = schoolCalendarAudiences(parsed.data);

  // Load previous day_types for these (term, date, audience) tuples so the
  // audit diff captures what changed. Cheap — HFSE volumes are small and the
  // schema caps entries × audiences.
  const dates = entries.map((e) => e.date);
  const { data: beforeRows } = await service
    .from('school_calendar')
    .select('date, day_type, audience, hbl_overlay, label')
    .eq('term_id', termId)
    .in('audience', audiences)
    .in('date', dates);
  type BeforeRow = {
    date: string;
    audience: string;
    day_type: string;
    hbl_overlay: boolean | null;
    label: string | null;
  };
  // Keyed by date AND audience: one save can now touch several audiences on
  // the same date, each with its own before value.
  const keyOf = (date: string, aud: string) => `${date}|${aud}`;
  const beforeByKey = new Map<string, BeforeRow>(
    ((beforeRows ?? []) as BeforeRow[]).map((r) => [
      keyOf(r.date, r.audience),
      r,
    ])
  );

  const rows = audiences.flatMap((audience) =>
    entries.map((e) => {
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
        // hbl_overlay: only meaningful on school_holiday rows; ignored otherwise.
        hbl_overlay: e.hblOverlay ?? false,
        created_by: auth.user.id,
      };
    })
  );

  const { error: upsertErr } = await service
    .from('school_calendar')
    .upsert(rows, { onConflict: 'term_id,audience,date' });
  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  const diffs = rows.map((r) => {
    const before = beforeByKey.get(keyOf(r.date, r.audience));
    return {
      date: r.date,
      audience: r.audience,
      before_day_type: before?.day_type ?? null,
      after_day_type: r.day_type,
      // hbl_overlay too, so toggling the school-holiday HBL overlay (day_type
      // unchanged) still shows a recorded change in the audit trail.
      before_hbl_overlay: before?.hbl_overlay ?? false,
      after_hbl_overlay: r.hbl_overlay,
      // `label` is the value after, kept under its old name so older rows and
      // new ones read alike; `before_label` is null for a day that had no row.
      // The label matters: renaming "Deepavali" to "Deepavali (observed)"
      // leaves the day type alone.
      label: r.label,
      before_label: before?.label ?? null,
      after_label: r.label,
    };
  });

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'attendance.calendar.upsert',
    entityType: 'school_calendar',
    entityId: termId,
    // `audience` keeps its old meaning for a one-audience save (every save
    // before migration 196); a multi-level save lists them in `audiences`
    // and each diff carries its own audience.
    context: {
      action: 'upsert',
      ...(audiences.length === 1 ? { audience: audiences[0] } : { audiences }),
      rows: rows.length,
      diffs,
    },
  });

  invalidateDrillTags('attendance', await ayCodeForTerm(service, termId));

  return NextResponse.json({ ok: true, upserted: rows.length });
}

// DELETE /api/attendance/calendar?termId=...&date=YYYY-MM-DD&audience=all|primary|secondary|P1…S4
// Removes the calendar entry for a specific (term, date, audience).
// Default audience='all' (no param) — matches the legacy single-row-per-date
// behavior. An audience it does not know is a 400, never a fallback to 'all':
// falling back would remove the whole-school row instead of the one asked for.
export async function DELETE(request: NextRequest) {
  const auth = await requireCapability('school_calendar.edit');
  if ('error' in auth) return auth.error;

  const termId = request.nextUrl.searchParams.get('termId');
  const date = request.nextUrl.searchParams.get('date');
  const rawAudience = request.nextUrl.searchParams.get('audience') ?? 'all';
  if (!termId || !date) {
    return NextResponse.json(
      { error: 'termId and date are required' },
      { status: 400 }
    );
  }
  if (!isDayAudience(rawAudience)) {
    return NextResponse.json(
      {
        error:
          'That calendar entry is for a group the calendar does not recognise, so nothing was removed.',
      },
      { status: 400 }
    );
  }
  const audience: DayAudience = rawAudience;

  const service = createServiceClient();
  // `.select()` on the delete hands back the rows it removed, in the same
  // statement — so the audit row records what the day WAS without a separate
  // read that could disagree with what was actually deleted.
  const { data: deletedRows, error } = await service
    .from('school_calendar')
    .delete()
    .eq('term_id', termId)
    .eq('audience', audience)
    .eq('date', date)
    .select('day_type, label, hbl_overlay');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const deleted = (
    (deletedRows ?? []) as Array<{
      day_type: string | null;
      label: string | null;
      hbl_overlay: boolean | null;
    }>
  )[0];

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'attendance.calendar.delete',
    entityType: 'school_calendar',
    entityId: termId,
    context: {
      date,
      audience,
      // What the day was before it was removed. `removed: false` when there
      // was no row to remove — the request succeeded and changed nothing.
      removed: deleted != null,
      before_day_type: deleted?.day_type ?? null,
      before_label: deleted?.label ?? null,
      before_hbl_overlay: deleted?.hbl_overlay ?? false,
    },
  });

  invalidateDrillTags('attendance', await ayCodeForTerm(service, termId));

  return NextResponse.json({ ok: true });
}
