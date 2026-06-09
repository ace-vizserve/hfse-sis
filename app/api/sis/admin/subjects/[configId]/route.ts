import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { SubjectConfigUpdateSchema } from '@/lib/schemas/subject-config';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';

// PATCH /api/sis/admin/subjects/[configId]
//
// Updates per (subject × level × AY) weights + max slots. Superadmin only
// — weight changes are high-blast-radius (every grading sheet for that
// (subject × level) inside this AY reads the new weights on render).
//
// Body contract: integer percentages 0–100 that sum to 100. Converted to
// `numeric(4,2)` decimals (0.00–1.00) on write to satisfy the DB check
// constraint `ww_weight + pt_weight + qa_weight = 1.00`.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ configId: string }> }
) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { configId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = SubjectConfigUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const {
    ww_weight,
    pt_weight,
    qa_weight,
    ww_max_slots,
    pt_max_slots,
    qa_max,
  } = parsed.data;

  const service = createServiceClient();

  const { data: before, error: loadErr } = await service
    .from('subject_configs')
    .select(
      'id, academic_year_id, subject_id, level_id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max'
    )
    .eq('id', configId)
    .maybeSingle();
  if (loadErr)
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!before)
    return NextResponse.json({ error: 'config not found' }, { status: 404 });

  const ww_dec = (ww_weight / 100).toFixed(2);
  const pt_dec = (pt_weight / 100).toFixed(2);
  const qa_dec = (qa_weight / 100).toFixed(2);

  const { error: updateErr } = await service
    .from('subject_configs')
    .update({
      ww_weight: ww_dec,
      pt_weight: pt_dec,
      qa_weight: qa_dec,
      ww_max_slots,
      pt_max_slots,
      qa_max,
    })
    .eq('id', configId);
  if (updateErr)
    return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Sync all unlocked grading sheets that reference this config. Weights are
  // read at render time (no sync needed), but ww_max_slots / pt_max_slots /
  // qa_max are denormalized at sheet-creation time and must be propagated.
  // Locked sheets are never touched per Hard Rule #5.
  const { data: syncResult, error: syncErr } = await service.rpc(
    'sync_grading_sheets_from_config',
    { p_config_id: configId }
  );
  if (syncErr) {
    // Log and proceed — the config update succeeded; the sync is best-effort.
    console.error('[subject_config patch] sheet sync failed:', syncErr.message);
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'subject_config.update',
    entityType: 'subject_config',
    entityId: configId,
    context: {
      academic_year_id: before.academic_year_id,
      subject_id: before.subject_id,
      level_id: before.level_id,
      before: {
        ww_weight: Number(before.ww_weight),
        pt_weight: Number(before.pt_weight),
        qa_weight: Number(before.qa_weight),
        ww_max_slots: before.ww_max_slots,
        pt_max_slots: before.pt_max_slots,
        qa_max: before.qa_max,
      },
      after: {
        ww_weight: Number(ww_dec),
        pt_weight: Number(pt_dec),
        qa_weight: Number(qa_dec),
        ww_max_slots,
        pt_max_slots,
        qa_max,
      },
      sheets_synced:
        (syncResult as { updated_sheets?: number } | null)?.updated_sheets ?? 0,
    },
  });

  // Weights + slot maxes feed the cached markbook masterfile/drill, and the
  // RPC just resynced unlocked sheets — bust the markbook tags for this AY so
  // the change shows on the next read (not after the 60s TTL). Best-effort.
  const { data: ay } = await service
    .from('academic_years')
    .select('ay_code')
    .eq('id', before.academic_year_id)
    .maybeSingle();
  const ayCode = (ay as { ay_code: string } | null)?.ay_code ?? null;
  if (ayCode) invalidateDrillTags('markbook', ayCode);

  return NextResponse.json({ ok: true });
}
