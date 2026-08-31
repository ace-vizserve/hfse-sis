import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { createServiceClient } from '@/lib/supabase/service';
import { subjectDisplayName } from '@/lib/sis/subjects/display-name';

// DELETE /api/sections/[id]/subjects/[subjectConfigId]
//
// Removes ONE subject from this section only — never touches subject_configs
// or any other section at the same level (migration 079, section_subjects).
// Idempotent: deleting a pair that isn't assigned matches zero rows and
// still returns 200.
//
// Registrar+ only.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; subjectConfigId: string }> }
) {
  const auth = await requireCapability('sections.edit');
  if ('error' in auth) return auth.error;

  const { id: sectionId, subjectConfigId } = await params;
  const service = createServiceClient();

  const { data: section } = await service
    .from('sections')
    .select('id, name, academic_years!inner(ay_code)')
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
    .select('display_name, subject:subjects(code, name)')
    .eq('id', subjectConfigId)
    .maybeSingle();
  const subj = config
    ? Array.isArray(config.subject)
      ? config.subject[0]
      : config.subject
    : null;

  const { error: delErr, count } = await service
    .from('section_subjects')
    .delete({ count: 'exact' })
    .eq('section_id', sectionId)
    .eq('subject_config_id', subjectConfigId);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  if ((count ?? 0) > 0) {
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'section.subject.remove',
      entityType: 'section',
      entityId: sectionId,
      context: {
        sectionName: section.name,
        subjectCode: subj?.code ?? null,
        // Resolved to what the year calls it, ON PURPOSE. An audit row should
        // record the words the operator saw when they acted — their screen
        // said STAR, so the row says STAR, permanently. (Resolving on READ
        // would be the opposite mistake: it would rewrite the row every time
        // the school renames something.)
        subjectName: subj ? subjectDisplayName(subj, config) : null,
        subjectConfigId,
      },
    });
    if (ayCode) invalidateDrillTags('markbook', ayCode);
  }

  return NextResponse.json({ ok: true });
}
