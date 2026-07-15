import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { TemplateSubjectLevelOfferingToggleSchema } from '@/lib/schemas/template';
import { createServiceClient } from '@/lib/supabase/service';

// PUT /api/sis/admin/template/subject-level-offerings
//
// Attaches/detaches a subject to/from a level in the master template, via
// `template_subject_level_offerings` (migration 080 collapse — the level
// dimension that used to live on `template_subject_configs`). AY-agnostic
// sibling of PUT /api/sis/admin/levels/[id]/offering (which toggles
// `ay_level_offerings`, a different concern — whether a volatile LEVEL
// exists in an AY at all, not which subjects that level teaches).
//
// Idempotent both directions: attaching twice, or detaching when already
// detached, succeeds without error (insert ignores the duplicate via
// ON CONFLICT DO NOTHING; delete simply matches zero rows).
export async function PUT(request: NextRequest) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = TemplateSubjectLevelOfferingToggleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { subject_id, level_id, offered } = parsed.data;

  const service = createServiceClient();

  // Confirm the level exists + is markbook-eligible (preschool levels have
  // no grading sheets and were excluded from this affordance pre-collapse
  // too — see the old POST /subject-configs preschool check).
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
  if (level.level_type === 'preschool') {
    return NextResponse.json(
      {
        error:
          'Preschool levels do not have grading sheets and cannot be assigned subjects',
      },
      { status: 422 }
    );
  }

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

  if (offered) {
    const { error: upsertErr } = await service
      .from('template_subject_level_offerings')
      .upsert(
        { subject_id, level_id },
        { onConflict: 'subject_id,level_id', ignoreDuplicates: true }
      );
    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }
  } else {
    const { error: deleteErr } = await service
      .from('template_subject_level_offerings')
      .delete()
      .eq('subject_id', subject_id)
      .eq('level_id', level_id);
    if (deleteErr) {
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'template.subject_level_offering.toggle',
    entityType: 'template_subject_level_offering',
    entityId: subject_id,
    context: {
      subject_id,
      subject_code: subject.code,
      level_id,
      level_code: level.code,
      offered,
    },
  });

  return NextResponse.json({ ok: true, subject_id, level_id, offered });
}
