import { NextResponse, type NextRequest } from 'next/server';

import { requireCapability } from '@/lib/auth/require-capability';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { subjectConfigUnchanged } from '@/lib/sis/subject-config-unchanged';
import { SubjectConfigUpdateSchema } from '@/lib/schemas/subject-config';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';

// PATCH /api/sis/admin/subjects/[configId]
//
// Updates per (subject × AY) weights + max slots (migration 080 collapsed
// the level dimension off `subject_configs` — a config now applies to
// every level the subject is attached to, see `subject_level_offerings`).
// school_admin + superadmin — weight changes are high-blast-radius (every
// grading sheet for this subject inside this AY reads the new weights on
// render).
//
// Body contract: integer percentages 0–100 that sum to 100. Converted to
// `numeric(4,2)` decimals (0.00–1.00) on write to satisfy the DB check
// constraint `ww_weight + pt_weight + qa_weight = 1.00`.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ configId: string }> }
) {
  const auth = await requireCapability('subjects.edit');
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
      'id, academic_year_id, subject_id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max, weights_confirmed'
    )
    .eq('id', configId)
    .maybeSingle();
  if (loadErr)
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!before)
    return NextResponse.json({ error: 'config not found' }, { status: 404 });

  // No-op guard, same shape as the canonical one in
  // app/api/sections/[id]/students/[enrolmentId]/route.ts:292-307.
  //
  // Re-saving identical weights previously ran the UPDATE, re-ran
  // sync_grading_sheets_from_config (which re-stamps updated_at on EVERY
  // unlocked grading sheet tied to this config), and wrote a
  // `subject_config.update` audit row whose before/after blocks were
  // identical. audit_log is append-only and is the evidence trail for how a
  // sheet's weights came to be what they are — a row asserting a change that
  // did not happen defeats the only job that table has.
  //
  // `weights_confirmed` is part of the comparison ON PURPOSE. It is set true
  // unconditionally below (see the comment there) to clear migration 082's
  // "needs attention" flag on the GP/COMP/ARTD/PESTD stand-in rows. Diffing
  // only the six numeric fields would make that flag-clearing save look like a
  // no-op and silently drop it — so a false -> true transition still counts as
  // a real change and proceeds.
  const unchanged = subjectConfigUnchanged(before, {
    ww_weight,
    pt_weight,
    qa_weight,
    ww_max_slots,
    pt_max_slots,
    qa_max,
  });
  if (unchanged) {
    return NextResponse.json({ ok: true, changed: false, sheets_synced: 0 });
  }

  const ww_dec = (ww_weight / 100).toFixed(2);
  const pt_dec = (pt_weight / 100).toFixed(2);
  const qa_dec = (qa_weight / 100).toFixed(2);

  // Task 2 (migration 085) — an explicit save via this route means an
  // admin reviewed these numbers, so weights_confirmed flips true
  // unconditionally, regardless of whether the row started false
  // (migration 082's GP/COMP/ARTD/PESTD stand-in rows). Closes the "needs
  // attention" loop: fix the flagged row's weights via this route → the
  // flag clears.
  const { error: updateErr } = await service
    .from('subject_configs')
    .update({
      ww_weight: ww_dec,
      pt_weight: pt_dec,
      qa_weight: qa_dec,
      ww_max_slots,
      pt_max_slots,
      qa_max,
      weights_confirmed: true,
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
      before: {
        ww_weight: Number(before.ww_weight),
        pt_weight: Number(before.pt_weight),
        qa_weight: Number(before.qa_weight),
        ww_max_slots: before.ww_max_slots,
        pt_max_slots: before.pt_max_slots,
        qa_max: before.qa_max,
        weights_confirmed: before.weights_confirmed,
      },
      after: {
        ww_weight: Number(ww_dec),
        pt_weight: Number(pt_dec),
        qa_weight: Number(qa_dec),
        ww_max_slots,
        pt_max_slots,
        qa_max,
        weights_confirmed: true,
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
