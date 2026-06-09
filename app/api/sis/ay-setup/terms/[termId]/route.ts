import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { TermDatesSchema } from '@/lib/schemas/ay-setup';
import { resyncTermCalendarWindow } from '@/lib/attendance/calendar';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';

// PATCH /api/sis/ay-setup/terms/[termId]
//
// Body: { startDate, endDate, virtueTheme? } — all nullable.
// Updates `terms.start_date` / `terms.end_date` / `terms.virtue_theme`.
// Date pair validated server-side (end >= start via schema refine).
// `virtueTheme` is optional for backward compatibility with pre-Evaluation
// callers that only send the date pair.
//
// Audit: emits `ay.term_dates.update` when start/end changed, and
// `ay.term_virtue.update` when virtue_theme changed. Both may fire on
// one request. No-op saves emit no audit rows.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ termId: string }> }
) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { termId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = TermDatesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { startDate, endDate } = parsed.data;
  // `virtueTheme` and `gradingLockDate` are undefined when the client didn't
  // send them (dates-only call site — don't touch those columns). Empty
  // string / explicit null clears.
  const virtueThemeUpdated = 'virtueTheme' in parsed.data;
  const virtueTheme = parsed.data.virtueTheme ?? null;
  const gradingLockUpdated = 'gradingLockDate' in parsed.data;
  const gradingLockDate = parsed.data.gradingLockDate ?? null;

  const service = createServiceClient();

  // Load before state for the audit diff.
  const { data: before, error: loadErr } = await service
    .from('terms')
    .select(
      'id, academic_year_id, term_number, label, start_date, end_date, virtue_theme, grading_lock_date'
    )
    .eq('id', termId)
    .maybeSingle();
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: 'term not found' }, { status: 404 });
  }

  // Cross-term overlap/order is validated client-side in <TermDatesEditor>
  // against the full would-be set of windows before saving. It is NOT
  // re-checked per-term here on purpose: the editor saves dirty terms in
  // parallel, so validating one term against its *persisted* siblings would
  // race and falsely reject legitimate batch reorders (e.g. shifting T1's end
  // and T2's start together). A correct server guard would need an atomic
  // whole-AY batch endpoint — out of scope for the sole, validated caller.

  const updates: Record<string, unknown> = {
    start_date: startDate,
    end_date: endDate,
  };
  if (virtueThemeUpdated) updates.virtue_theme = virtueTheme;
  if (gradingLockUpdated) updates.grading_lock_date = gradingLockDate;

  const { error: updateErr } = await service
    .from('terms')
    .update(updates)
    .eq('id', termId);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const datesChanged =
    (before.start_date ?? null) !== startDate ||
    (before.end_date ?? null) !== endDate;

  // When the term window moves, bring its school_calendar into line: prune
  // school days that fell outside the new window and backfill weekdays now
  // inside it (in-range overrides preserved). Only runs with a complete window.
  let calendarSync: { deleted: number; inserted: number } | null = null;
  if (datesChanged && startDate && endDate) {
    try {
      calendarSync = await resyncTermCalendarWindow(
        termId,
        startDate,
        endDate,
        auth.user.id
      );
    } catch (e) {
      // Term dates are saved, but the school-day resync failed — report it so
      // the registrar retries rather than believing the calendar is in sync.
      return NextResponse.json(
        {
          error:
            e instanceof Error
              ? e.message
              : 'Term dates saved, but updating school days failed. Please retry.',
        },
        { status: 500 }
      );
    }
  }

  const virtueChanged =
    virtueThemeUpdated && (before.virtue_theme ?? null) !== virtueTheme;
  const gradingLockChanged =
    gradingLockUpdated &&
    (before.grading_lock_date ?? null) !== gradingLockDate;

  if (datesChanged) {
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'ay.term_dates.update',
      entityType: 'term',
      entityId: termId,
      context: {
        academic_year_id: before.academic_year_id,
        term_number: before.term_number,
        label: before.label,
        before: {
          start_date: before.start_date ?? null,
          end_date: before.end_date ?? null,
        },
        after: { start_date: startDate, end_date: endDate },
        calendar_sync: calendarSync,
      },
    });
  }

  if (virtueChanged) {
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'ay.term_virtue.update',
      entityType: 'term',
      entityId: termId,
      context: {
        academic_year_id: before.academic_year_id,
        term_number: before.term_number,
        label: before.label,
        before: { virtue_theme: before.virtue_theme ?? null },
        after: { virtue_theme: virtueTheme },
      },
    });
  }

  if (gradingLockChanged) {
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'ay.term_grading_lock.update',
      entityType: 'term',
      entityId: termId,
      context: {
        academic_year_id: before.academic_year_id,
        term_number: before.term_number,
        label: before.label,
        before: { grading_lock_date: before.grading_lock_date ?? null },
        after: { grading_lock_date: gradingLockDate },
      },
    });
  }

  // Term windows feed the attendance + markbook dashboards/drills (`unstable_cache`d).
  // Only the dates are a cached input — virtue theme / grading-lock are read by
  // dynamic (uncached) routes — so bust those two modules only when the dates
  // actually moved (a virtue-only / lock-only save shouldn't churn the cache).
  if (datesChanged) {
    const { data: ay } = await service
      .from('academic_years')
      .select('ay_code')
      .eq('id', before.academic_year_id)
      .maybeSingle();
    const ayCode = (ay as { ay_code: string } | null)?.ay_code ?? null;
    if (ayCode) {
      invalidateDrillTags('attendance', ayCode);
      invalidateDrillTags('markbook', ayCode);
    }
  }

  return NextResponse.json({ ok: true });
}
