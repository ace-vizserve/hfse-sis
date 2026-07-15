import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { TemplateSubjectConfigCreateSchema } from '@/lib/schemas/template';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/admin/template/subject-configs
//
// Creates the master weight config for a subject — one row per subject
// (migration 080 collapsed `template_subject_configs` from (subject ×
// level) to subject alone). The "Set weights" affordance on a subject card
// with no config yet POSTs here. Which levels the subject is taught at is a
// separate concern, tracked on `template_subject_level_offerings` via
// PUT /api/sis/admin/template/subject-level-offerings.
//   - 409 when a config for this subject already exists (use PATCH instead)
// Same percent → numeric(4,2) conversion as the existing PATCH route.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = TemplateSubjectConfigCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const {
    subject_id,
    ww_weight,
    pt_weight,
    qa_weight,
    ww_max_slots,
    pt_max_slots,
    qa_max,
  } = parsed.data;

  const service = createServiceClient();

  // 1. Confirm the subject exists (and capture its code for the audit).
  const { data: subjectRow, error: subjErr } = await service
    .from('subjects')
    .select('id, code, name')
    .eq('id', subject_id)
    .maybeSingle();
  if (subjErr)
    return NextResponse.json({ error: subjErr.message }, { status: 500 });
  if (!subjectRow)
    return NextResponse.json({ error: 'subject not found' }, { status: 404 });
  const subject = subjectRow as { id: string; code: string; name: string };

  // 2. Uniqueness check on subject_id (one config per subject).
  const { data: existing } = await service
    .from('template_subject_configs')
    .select('id')
    .eq('subject_id', subject_id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      {
        error: `${subject.code} already has a template weight config`,
        existingId: (existing as { id: string }).id,
      },
      { status: 409 }
    );
  }

  // 3. Insert with numeric(4,2) conversion.
  const ww_dec = (ww_weight / 100).toFixed(2);
  const pt_dec = (pt_weight / 100).toFixed(2);
  const qa_dec = (qa_weight / 100).toFixed(2);

  const { data: inserted, error: insertErr } = await service
    .from('template_subject_configs')
    .insert({
      subject_id,
      ww_weight: ww_dec,
      pt_weight: pt_dec,
      qa_weight: qa_dec,
      ww_max_slots,
      pt_max_slots,
      qa_max,
    })
    .select('id')
    .single();
  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'insert failed' },
      { status: 500 }
    );
  }
  const newId = (inserted as { id: string }).id;

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'template.subject_config.create',
    entityType: 'template_subject_config',
    entityId: newId,
    context: {
      subject_id,
      subject_code: subject.code,
      weights: {
        ww_weight: Number(ww_dec),
        pt_weight: Number(pt_dec),
        qa_weight: Number(qa_dec),
      },
      max_slots: { ww_max_slots, pt_max_slots, qa_max },
    },
  });

  return NextResponse.json({ ok: true, id: newId });
}
