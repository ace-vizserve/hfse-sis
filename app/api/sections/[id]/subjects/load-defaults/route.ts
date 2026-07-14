import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sections/[id]/subjects/load-defaults
//
// Assigns every subject currently configured (subject_configs) at this
// section's level that isn't already assigned — additive only, never
// removes an existing per-section customization. This is the same effect
// as the migration-079 backfill, scoped to one section, for a freshly
// created section (or one where a subject was added to the level after the
// section existed) that hasn't been synced yet.
//
// Registrar+ only.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id: sectionId } = await params;
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

  const [{ data: configs }, { data: existing }] = await Promise.all([
    service
      .from('subject_configs')
      .select('id')
      .eq('level_id', section.level_id)
      .eq('academic_year_id', section.academic_year_id),
    service
      .from('section_subjects')
      .select('subject_config_id')
      .eq('section_id', sectionId),
  ]);

  const existingIds = new Set(
    ((existing ?? []) as Array<{ subject_config_id: string }>).map(
      (r) => r.subject_config_id
    )
  );
  const missing = ((configs ?? []) as Array<{ id: string }>).filter(
    (c) => !existingIds.has(c.id)
  );

  let inserted = 0;
  if (missing.length > 0) {
    const { error: insertErr } = await service.from('section_subjects').insert(
      missing.map((c) => ({
        section_id: sectionId,
        subject_config_id: c.id,
      }))
    );
    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
    inserted = missing.length;
  }

  if (inserted > 0) {
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'section.subjects.load_defaults',
      entityType: 'section',
      entityId: sectionId,
      context: { sectionName: section.name, inserted },
    });
    if (ayCode) invalidateDrillTags('markbook', ayCode);
  }

  return NextResponse.json({ ok: true, inserted });
}
