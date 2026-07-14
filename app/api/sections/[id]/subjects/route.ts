import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sections/[id]/subjects
// Body: { subjectConfigId: string }
//
// Assigns ONE additional subject to this section — a per-section override
// on top of the level's default subject list (migration 079,
// section_subjects). The subjectConfigId must belong to the section's own
// (level_id, academic_year_id); this is defense in depth against attaching
// a subject_config from a different level or AY.
//
// Registrar+ only — same gate as every other section-mutation route.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id: sectionId } = await params;
  const body = (await request.json().catch(() => null)) as {
    subjectConfigId?: string;
  } | null;
  const subjectConfigId = body?.subjectConfigId;
  if (!subjectConfigId) {
    return NextResponse.json(
      { error: 'subjectConfigId required' },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  const { data: section } = await service
    .from('sections')
    .select(
      'id, name, level_id, academic_year_id, academic_years!inner(ay_code)'
    )
    .eq('id', sectionId)
    .maybeSingle();
  if (!section) {
    return NextResponse.json({ error: 'Section not found' }, { status: 404 });
  }
  const ayJoin = section.academic_years as unknown as
    | { ay_code: string }
    | { ay_code: string }[];
  const ayCode = Array.isArray(ayJoin) ? ayJoin[0]?.ay_code : ayJoin?.ay_code;

  const { data: config } = await service
    .from('subject_configs')
    .select('id, level_id, academic_year_id, subject:subjects(code, name)')
    .eq('id', subjectConfigId)
    .maybeSingle();
  if (
    !config ||
    config.level_id !== section.level_id ||
    config.academic_year_id !== section.academic_year_id
  ) {
    return NextResponse.json(
      { error: "That subject isn't configured at this section's level" },
      { status: 422 }
    );
  }

  const { error: insertErr } = await service
    .from('section_subjects')
    .insert({ section_id: sectionId, subject_config_id: subjectConfigId });
  if (insertErr) {
    // 23505 = unique_violation — already assigned, treat as a no-op success.
    if ((insertErr as { code?: string }).code !== '23505') {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
  }

  const subj = Array.isArray(config.subject)
    ? config.subject[0]
    : config.subject;

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'section.subject.assign',
    entityType: 'section',
    entityId: sectionId,
    context: {
      sectionName: section.name,
      subjectCode: subj?.code ?? null,
      subjectName: subj?.name ?? null,
      subjectConfigId,
    },
  });

  if (ayCode) invalidateDrillTags('markbook', ayCode);

  return NextResponse.json({ ok: true });
}
