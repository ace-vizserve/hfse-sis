import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { SubjectLevelOfferingToggleSchema } from '@/lib/schemas/subject-config';
import { createServiceClient } from '@/lib/supabase/service';

// PUT /api/sis/admin/subjects/level-offerings
//
// Attaches/detaches a subject to/from a level for a specific academic
// year, via `subject_level_offerings` (migration 080 collapse — the level
// dimension that used to live on `subject_configs`). AY-scoped sibling of
// PUT /api/sis/admin/template/subject-level-offerings (the template's
// AY-agnostic equivalent) — mirrors that route's shape exactly, plus the
// `academic_year_id` the per-AY table needs. This is the write path behind
// the /sis/admin/subjects tree's drag-a-subject-onto-a-level gesture.
//
// Idempotent both directions: attaching twice, or detaching when already
// detached, succeeds without error.
export async function PUT(request: NextRequest) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = SubjectLevelOfferingToggleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { subject_id, level_id, academic_year_id, offered } = parsed.data;

  const service = createServiceClient();

  // Confirm the level exists.
  const { data: levelRow, error: levelErr } = await service
    .from('levels')
    .select('id, code, label, level_type')
    .eq('id', level_id)
    .maybeSingle();
  if (levelErr)
    return NextResponse.json({ error: levelErr.message }, { status: 500 });
  if (!levelRow)
    return NextResponse.json({ error: 'level not found' }, { status: 404 });
  const level = levelRow as {
    id: string;
    code: string;
    label: string;
    level_type: string;
  };

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

  if (offered) {
    const { error: upsertErr } = await service
      .from('subject_level_offerings')
      .upsert(
        { subject_id, level_id, academic_year_id },
        {
          onConflict: 'subject_id,level_id,academic_year_id',
          ignoreDuplicates: true,
        }
      );
    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }
  } else {
    const { error: deleteErr } = await service
      .from('subject_level_offerings')
      .delete()
      .eq('subject_id', subject_id)
      .eq('level_id', level_id)
      .eq('academic_year_id', academic_year_id);
    if (deleteErr) {
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'subject_level_offering.toggle',
    entityType: 'subject_level_offering',
    entityId: subject_id,
    context: {
      subject_id,
      subject_code: subject.code,
      level_id,
      level_code: level.code,
      academic_year_id,
      ay_code: ay.ay_code,
      offered,
    },
  });

  return NextResponse.json({
    ok: true,
    subject_id,
    level_id,
    academic_year_id,
    offered,
  });
}
