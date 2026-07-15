import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { TemplateSubjectConfigUpdateSchema } from '@/lib/schemas/template';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/sis/admin/template/subject-configs/[id]
//
// Updates the master template's per (subject × level) weights + max slots.
// Same wire shape as `/api/sis/admin/subjects/[configId]` — integer
// percentages summing to 100, converted to numeric(4,2) on write so the
// DB sum constraint (`ww_weight + pt_weight + qa_weight = 1.00`) holds.
//
// Edits stay in the template until the admin clicks "Propagate to AYs"
// on the template page. New AYs created after this point copy the
// updated values automatically.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = TemplateSubjectConfigUpdateSchema.safeParse(body);
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
    .from('template_subject_configs')
    .select(
      'id, subject_id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max'
    )
    .eq('id', id)
    .maybeSingle();
  if (loadErr)
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!before) {
    return NextResponse.json(
      { error: 'template config not found' },
      { status: 404 }
    );
  }

  const ww_dec = (ww_weight / 100).toFixed(2);
  const pt_dec = (pt_weight / 100).toFixed(2);
  const qa_dec = (qa_weight / 100).toFixed(2);

  const { error: updateErr } = await service
    .from('template_subject_configs')
    .update({
      ww_weight: ww_dec,
      pt_weight: pt_dec,
      qa_weight: qa_dec,
      ww_max_slots,
      pt_max_slots,
      qa_max,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (updateErr)
    return NextResponse.json({ error: updateErr.message }, { status: 500 });

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'template.subject_config.update',
    entityType: 'template_subject_config',
    entityId: id,
    context: {
      subject_id: before.subject_id,
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
    },
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/sis/admin/template/subject-configs/[id]
//
// Clears a subject's master weight config entirely — used by the "Clear
// weight config" action in the edit dialog. Since migration 080 collapsed
// this table to one row per subject, this removes the subject's ONLY
// template config (not "from this level" — level attachment is a separate
// concern on `template_subject_level_offerings`, untouched by this route).
// Existing AYs are unaffected (template propagation is UPSERT-only per
// KD #66); only NEW AYs created after this point will skip this subject's
// weights.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const service = createServiceClient();

  // Pre-fetch the row joined to subjects so the audit context captures the
  // human-readable subject code, not just its UUID.
  const { data: before, error: loadErr } = await service
    .from('template_subject_configs')
    .select(
      'id, subject_id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max, subject:subjects(code, name)'
    )
    .eq('id', id)
    .maybeSingle();
  if (loadErr)
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!before) {
    return NextResponse.json(
      { error: 'template config not found' },
      { status: 404 }
    );
  }

  const { error: deleteErr } = await service
    .from('template_subject_configs')
    .delete()
    .eq('id', id);
  if (deleteErr)
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });

  type Joined = { code: string; name?: string };
  const subj = (
    Array.isArray(before.subject) ? before.subject[0] : before.subject
  ) as Joined | null;

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'template.subject_config.delete',
    entityType: 'template_subject_config',
    entityId: id,
    context: {
      subject_id: before.subject_id,
      subject_code: subj?.code ?? null,
      removed: {
        ww_weight: Number(before.ww_weight),
        pt_weight: Number(before.pt_weight),
        qa_weight: Number(before.qa_weight),
        ww_max_slots: before.ww_max_slots,
        pt_max_slots: before.pt_max_slots,
        qa_max: before.qa_max,
      },
    },
  });

  return NextResponse.json({ ok: true });
}
