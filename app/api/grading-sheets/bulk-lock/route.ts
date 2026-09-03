import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { requireCurrentAyCode } from '@/lib/academic-year';

// Max ids accepted in one request — a sane ceiling so a malformed/oversized
// payload can't fan out into an unbounded number of updates + audit rows.
const MAX_IDS = 200;

// POST /api/grading-sheets/bulk-lock — registrar+ only.
//
// Locks every selected grading sheet that isn't already locked. Mirrors the
// single-sheet lock route (`[id]/lock`) per sheet: sets is_locked + locked_at,
// writes one `sheet.lock` audit row per newly-locked sheet (identical action,
// entityId, and context shape so the audit log reads the same whether a sheet
// was locked individually or in bulk), then invalidates the markbook drill +
// dashboard caches once for the batch.
//
// Already-locked sheets are skipped (not an error). Hard Rule #5 — locking
// itself needs no approval; it ENABLES the post-lock change-request flow.
export async function POST(request: NextRequest) {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const rawIds = (body as { ids?: unknown })?.ids;
  if (!Array.isArray(rawIds)) {
    return NextResponse.json(
      { error: 'ids must be an array of grading-sheet IDs' },
      { status: 400 }
    );
  }

  // Dedupe + drop non-string / empty entries.
  const ids = Array.from(
    new Set(
      rawIds.filter((v): v is string => typeof v === 'string' && v !== '')
    )
  );
  if (ids.length === 0) {
    return NextResponse.json(
      { error: 'no valid IDs supplied' },
      { status: 400 }
    );
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: `too many IDs — cap is ${MAX_IDS} per request` },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  const lockedBy = auth.user.email ?? auth.user.id;

  // Read current lock state so we can skip already-locked sheets and report
  // an accurate locked/skipped split. Unknown IDs simply don't come back.
  const { data: existing, error: readErr } = await service
    .from('grading_sheets')
    .select('id, is_locked')
    .in('id', ids);
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }

  const found = existing ?? [];
  const toLock = found.filter((s) => !s.is_locked).map((s) => s.id);
  const alreadyLocked = found.length - toLock.length;

  if (toLock.length === 0) {
    return NextResponse.json({ locked: 0, skipped: alreadyLocked });
  }

  const now = new Date().toISOString();
  const { data: updated, error: lockErr } = await service
    .from('grading_sheets')
    .update({
      is_locked: true,
      locked_at: now,
      locked_by: lockedBy,
      updated_at: now,
    })
    .in('id', toLock)
    .select('id, locked_at, locked_by');
  if (lockErr) {
    return NextResponse.json({ error: lockErr.message }, { status: 500 });
  }

  const lockedRows = updated ?? [];

  // One `sheet.lock` audit row per sheet — identical shape to the single-lock
  // route so the audit history is uniform across both entry points.
  await Promise.all(
    lockedRows.map((sheet) =>
      logAction({
        service,
        actor: {
          id: auth.user.id,
          email: auth.user.email ?? null,
          role: auth.role,
        },
        action: 'sheet.lock',
        entityType: 'grading_sheet',
        entityId: sheet.id,
        context: { locked_at: sheet.locked_at, locked_by: sheet.locked_by },
      })
    )
  );

  invalidateDrillTags('markbook', await requireCurrentAyCode(service));

  return NextResponse.json({
    locked: lockedRows.length,
    skipped: alreadyLocked,
  });
}
