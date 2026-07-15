import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';

// DELETE /api/sis/admin/subjects/catalog/[id]/configs
//
// Bulk-detaches a subject from every level in the master template — used
// by the Subjects-tab "Drop from all levels" action when a school is fully
// retiring a subject from teaching (while keeping it in the catalogue for
// FK integrity to historical grade entries).
//
// Migration 080 collapsed weights to one row per subject
// (`template_subject_configs`) and moved level-applicability to
// `template_subject_level_offerings` — so "drop from all levels" now means
// deleting every offering row for this subject. The subject's weight
// config (if any) is left untouched: it's a separate concern and staying
// in place lets the school re-attach the subject to a level later without
// re-entering its WW/PT/QA split. Existing AYs are unaffected — only NEW
// AYs created after this point will skip the subject (template propagation
// is UPSERT/additive-only per KD #66).
//
// Audit pre-image captures the full list of level codes being detached so
// the action is recoverable if needed.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id: subjectId } = await params;
  const service = createServiceClient();

  const { data: subjectRow, error: subjErr } = await service
    .from('subjects')
    .select('id, code, name')
    .eq('id', subjectId)
    .maybeSingle();
  if (subjErr)
    return NextResponse.json({ error: subjErr.message }, { status: 500 });
  if (!subjectRow)
    return NextResponse.json({ error: 'subject not found' }, { status: 404 });
  const subject = subjectRow as { id: string; code: string; name: string };

  const { data: offerings, error: offErr } = await service
    .from('template_subject_level_offerings')
    .select('level_id, level:levels(code, label)')
    .eq('subject_id', subjectId);
  if (offErr)
    return NextResponse.json({ error: offErr.message }, { status: 500 });
  const offeringList = (offerings ?? []) as Array<{
    level_id: string;
    level:
      | { code: string; label: string }
      | { code: string; label: string }[]
      | null;
  }>;

  if (offeringList.length === 0) {
    return NextResponse.json({ ok: true, detachedCount: 0 });
  }

  const { error: deleteErr } = await service
    .from('template_subject_level_offerings')
    .delete()
    .eq('subject_id', subjectId);
  if (deleteErr)
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });

  const detachedLevels = offeringList.map((o) => {
    const lvl = Array.isArray(o.level) ? o.level[0] : o.level;
    return {
      level_id: o.level_id,
      level_code: lvl?.code ?? null,
      level_label: lvl?.label ?? null,
    };
  });

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'template.subject_level_offering.detach_all',
    entityType: 'subject',
    entityId: subjectId,
    context: {
      subject_id: subject.id,
      subject_code: subject.code,
      subject_name: subject.name,
      detachedLevels,
      detachedCount: detachedLevels.length,
    },
  });

  return NextResponse.json({ ok: true, detachedCount: detachedLevels.length });
}
