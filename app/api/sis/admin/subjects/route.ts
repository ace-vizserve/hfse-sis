import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { SubjectConfigCreateSchema } from '@/lib/schemas/subject-config';
import { createServiceClient } from '@/lib/supabase/service';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';

// POST /api/sis/admin/subjects
//
// Creates the per-AY weight config for a subject — one row per (subject,
// academic_year_id) since migration 080 collapsed subject_configs off the
// level dimension. The tree's "Set weights" affordance (a subject chip
// attached to a level with no config yet for this AY) POSTs here. Which
// levels the subject is taught at is tracked separately on
// `subject_level_offerings` via PUT /api/sis/admin/subjects/level-offerings
// — creating a weight config here does not itself attach the subject to
// any level.
export async function POST(request: NextRequest) {
  const auth = await requireCapability('subjects.create');
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = SubjectConfigCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const {
    academic_year_id,
    subject_id,
    ww_weight,
    pt_weight,
    qa_weight,
    ww_max_slots,
    pt_max_slots,
    qa_max,
  } = parsed.data;

  const service = createServiceClient();

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

  const { data: ayRow, error: ayErr } = await service
    .from('academic_years')
    .select('id, ay_code')
    .eq('id', academic_year_id)
    .maybeSingle();
  if (ayErr)
    return NextResponse.json({ error: ayErr.message }, { status: 500 });
  if (!ayRow)
    return NextResponse.json(
      { error: 'academic year not found' },
      { status: 404 }
    );
  const ay = ayRow as { id: string; ay_code: string };

  const { data: existing } = await service
    .from('subject_configs')
    .select('id')
    .eq('academic_year_id', academic_year_id)
    .eq('subject_id', subject_id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      {
        error: `${subject.code} already has weights configured for ${ay.ay_code}`,
        existingId: (existing as { id: string }).id,
      },
      { status: 409 }
    );
  }

  const ww_dec = (ww_weight / 100).toFixed(2);
  const pt_dec = (pt_weight / 100).toFixed(2);
  const qa_dec = (qa_weight / 100).toFixed(2);

  const { data: inserted, error: insertErr } = await service
    .from('subject_configs')
    .insert({
      academic_year_id,
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
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'subject_config.create',
    entityType: 'subject_config',
    entityId: newId,
    context: {
      academic_year_id,
      ay_code: ay.ay_code,
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

  invalidateDrillTags('markbook', ay.ay_code);

  return NextResponse.json({ ok: true, id: newId });
}
