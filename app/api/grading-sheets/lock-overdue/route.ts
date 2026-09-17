import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { loadSheetAuditLabels } from '@/lib/grading/sheet-audit-labels';

// GET|POST /api/grading-sheets/lock-overdue — Vercel Cron only.
//
// Runs daily at 06:00 SGT (22:00 UTC). Locks every unlocked grading sheet
// whose term's grading_lock_date < today (Singapore local date). Sheets are
// therefore locked the morning AFTER the deadline day, giving teachers the
// full deadline day to submit.
//
// Auth: Vercel sets `Authorization: Bearer ${CRON_SECRET}` automatically.
// The CRON_SECRET env var must be configured in the Vercel project settings.
//
// ⚠ GET IS THE ONE THAT MATTERS. Vercel Cron calls its path with GET. This
// route used to export POST alone, so every scheduled run since vercel.json
// named it was answered 405 before any of this code ran — the job had never
// locked a sheet, and `audit_log` holds no `sheet.lock_overdue_batch` row to
// say otherwise. POST is kept for anyone triggering it by hand; both share one
// handler and one secret check.
export async function GET(request: NextRequest) {
  return lockOverdue(request);
}

export async function POST(request: NextRequest) {
  return lockOverdue(request);
}

async function lockOverdue(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (
    !cronSecret ||
    request.headers.get('authorization') !== `Bearer ${cronSecret}`
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const service = createServiceClient();
  const todaySgt = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Singapore',
  });

  // Terms whose deadline has already passed as of today SGT.
  const { data: terms, error: termsErr } = await service
    .from('terms')
    .select('id, label, academic_year_id, grading_lock_date')
    .lt('grading_lock_date', todaySgt);
  if (termsErr) {
    console.error('[lock-overdue] terms fetch failed:', termsErr.message);
    return NextResponse.json({ error: termsErr.message }, { status: 500 });
  }
  if (!terms || terms.length === 0) {
    return NextResponse.json({ locked_count: 0, run_date: todaySgt });
  }

  const termIds = terms.map((t) => t.id);

  // Unlocked sheets in those terms.
  const { data: sheets, error: sheetsErr } = await service
    .from('grading_sheets')
    .select('id, term_id')
    .in('term_id', termIds)
    .eq('is_locked', false);
  if (sheetsErr) {
    console.error('[lock-overdue] sheets fetch failed:', sheetsErr.message);
    return NextResponse.json({ error: sheetsErr.message }, { status: 500 });
  }
  if (!sheets || sheets.length === 0) {
    return NextResponse.json({ locked_count: 0, run_date: todaySgt });
  }

  const sheetIds = sheets.map((s) => s.id);
  const now = new Date().toISOString();

  // Chunked: the overdue-sheet scan spans every academic year, so this is not
  // bounded by one AY's sheet count. PostgREST serializes `.in()` into the URL
  // and fails past ~14.3KB / 396 uuids (see lib/supabase/paginate.ts). The
  // realistic way to exceed that here is a historical-AY backfill — sheets bulk
  // created for an already-past year, so every term's grading_lock_date is
  // already behind us and the whole year lands in one batch (an AY is ~400-750
  // sheets). That is not hypothetical for this project.
  //
  // ⚠ A FAILED CHUNK STILL GETS ITS BATCH ROW. Earlier chunks are already
  // locked by then, and returning straight away used to leave those locks with
  // no audit row at all. The loop stops, the row below records exactly the
  // sheets that were locked with `partial: true`, and then the 500 goes back.
  const LOCK_CHUNK = 200;
  const lockedIds: string[] = [];
  let lockError: string | null = null;
  for (let i = 0; i < sheetIds.length; i += LOCK_CHUNK) {
    const slice = sheetIds.slice(i, i + LOCK_CHUNK);
    const { error: lockErr } = await service
      .from('grading_sheets')
      .update({
        is_locked: true,
        locked_at: now,
        locked_by: 'system:grading-deadline',
        updated_at: now,
      })
      .in('id', slice);
    if (lockErr) {
      // Locking is idempotent (the scan only selects still-unlocked sheets),
      // so the next cron run picks up the rest.
      console.error('[lock-overdue] bulk lock failed:', lockErr.message);
      lockError = lockErr.message;
      break;
    }
    lockedIds.push(...slice);
  }

  if (lockedIds.length > 0) {
    // Which classes, not just how many — "Overdue sheets auto-locked" with a
    // count is not something a coordinator can check against a complaint.
    const labels = await loadSheetAuditLabels(service, lockedIds);
    const termById = new Map(terms.map((t) => [t.id, t]));
    const termOfSheet = new Map(sheets.map((s) => [s.id, s.term_id]));
    await logAction({
      service,
      // No person, so no role — the cron sweep already writes `actor_id: null`
      // and `actor_role` follows it. Naming a role here would invent one.
      actor: { id: null, email: 'system:grading-deadline', role: null },
      action: 'sheet.lock_overdue_batch',
      entityType: 'grading_sheet',
      entityId: null,
      context: {
        locked_count: lockedIds.length,
        run_date: todaySgt,
        locked_at: now,
        sheet_ids: lockedIds,
        sheets: lockedIds.map((id) => {
          const l = labels.get(id);
          const term = termById.get(termOfSheet.get(id) ?? '');
          return {
            grading_sheet_id: id,
            subject_name: l?.subject_name ?? null,
            section_name: l?.section_name ?? null,
            level_label: l?.level_label ?? null,
            term_label: l?.term_label ?? term?.label ?? null,
            grading_lock_date: term?.grading_lock_date ?? null,
          };
        }),
        ...(lockError
          ? {
              partial: true,
              failed_step: 'lock',
              error: lockError,
              not_locked_count: sheetIds.length - lockedIds.length,
            }
          : {}),
      },
    });

    // Invalidate markbook caches for every AY that had sheets locked.
    const termAyMap = new Map(terms.map((t) => [t.id, t.academic_year_id]));
    const lockedSet = new Set(lockedIds);
    const affectedAyIds = new Set(
      sheets
        .filter((s) => lockedSet.has(s.id))
        .map((s) => termAyMap.get(s.term_id))
        .filter(Boolean) as string[]
    );

    if (affectedAyIds.size > 0) {
      const { data: ayRows } = await service
        .from('academic_years')
        .select('id, ay_code')
        .in('id', Array.from(affectedAyIds));
      for (const ay of ayRows ?? []) {
        invalidateDrillTags('markbook', ay.ay_code);
      }
    }
  }

  if (lockError) {
    return NextResponse.json(
      {
        error: lockError,
        locked_count: lockedIds.length,
        run_date: todaySgt,
      },
      { status: 500 }
    );
  }

  console.info(
    `[lock-overdue] locked ${lockedIds.length} sheet(s) on ${todaySgt}`
  );
  return NextResponse.json({
    locked_count: lockedIds.length,
    run_date: todaySgt,
  });
}
