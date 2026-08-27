import { NextResponse } from 'next/server';

import { requireCapability } from '@/lib/auth/require-capability';
import { logAction } from '@/lib/audit/log-action';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { createServiceClient } from '@/lib/supabase/service';
import { recomputeSyncedSheets } from '@/lib/grading/sync-config-sheets';

// POST /api/sis/admin/subjects/[configId]/resync
//
// Re-runs the grading-sheet sync + recompute for one subject config, without
// changing the config itself. Idempotent and safe to call repeatedly.
//
// This is the repair path for a partly-applied save, and it is not optional
// polish. The PATCH route short-circuits on a no-op
// (`subjectConfigUnchanged` -> `{ ok: true, changed: false }`), which is right
// for its own purpose but becomes a trap the moment the sync carries grade
// consequences: after a sync failure the operator's obvious move is to press
// Save again with the same numbers, and that returns success while doing
// nothing at all. Without this endpoint there is no way back to a correct
// state through the UI.
//
// Same capability as the save it repairs. No body — the config id is the
// whole input.
export const maxDuration = 60;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ configId: string }> }
) {
  const auth = await requireCapability('subjects.edit');
  if ('error' in auth) return auth.error;

  const { configId } = await params;
  const service = createServiceClient();

  // `academic_years!inner(ay_code)` because the cache tags are keyed by CODE,
  // never by uuid — see `lib/cache/invalidate-drill-tags.ts`. Fetching it here
  // costs nothing extra and saves a second round trip below.
  const { data: config, error: loadErr } = await service
    .from('subject_configs')
    .select('id, academic_year_id, subject_id, academic_years!inner(ay_code)')
    .eq('id', configId)
    .maybeSingle();
  if (loadErr)
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!config)
    return NextResponse.json({ error: 'config not found' }, { status: 404 });

  const ayRel = (config as { academic_years?: { ay_code?: string } | null })
    .academic_years;
  const ayCode =
    (Array.isArray(ayRel) ? ayRel[0]?.ay_code : ayRel?.ay_code) ?? '';

  const { data: syncResult, error: syncErr } = await service.rpc(
    'sync_grading_sheets_from_config',
    { p_config_id: configId }
  );
  const sync = await recomputeSyncedSheets(
    service,
    configId,
    syncResult,
    syncErr
  );

  // Audited either way: a resync that failed is exactly the thing someone will
  // want a record of later.
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'subject_config.update',
    entityType: 'subject_config',
    entityId: configId,
    context: {
      academic_year_id: (config as { academic_year_id: string })
        .academic_year_id,
      subject_id: (config as { subject_id: string }).subject_id,
      resync: true,
      sheets_synced: sync.sheetsSynced,
      sheets_skipped_locked: sync.sheetsSkippedLocked,
      entries_scanned: sync.entriesScanned,
      entries_recomputed: sync.entriesRecomputed,
      ...(sync.error ? { sync_error: sync.error } : {}),
    },
  });

  if (sync.error) {
    return NextResponse.json(
      {
        error:
          'The grading sheets still could not be brought up to date. Grades on those sheets may be wrong.',
        detail: sync.error,
      },
      { status: 500 }
    );
  }

  // This route rewrites grading sheets and recomputes grade entries, which is
  // exactly what the markbook dashboards and drills read through
  // `unstable_cache`. The PATCH route next door already busts these; the
  // repair path that does the same work did not, so a resync fixed the data
  // and left every dashboard reporting the figures it had just corrected.
  //
  // ⚠ Placed AFTER the failure branch above on purpose: if the sync errored,
  // the sheets are still wrong and there is nothing correct to publish.
  invalidateDrillTags('markbook', ayCode);

  return NextResponse.json({
    ok: true,
    sheets_synced: sync.sheetsSynced,
    sheets_skipped_locked: sync.sheetsSkippedLocked,
    entries_recomputed: sync.entriesRecomputed,
  });
}
