import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sections/[id]/subjects/load-defaults
//
// Assigns every subject offered at this section's level (per
// subject_level_offerings — migration 080 moved level-applicability off
// subject_configs, which now carries no level_id) that isn't already
// assigned — additive only, never removes an existing per-section
// customization. This is the same effect as the migration-079 backfill,
// scoped to one section, for a freshly created section (or one where a
// subject was added to the level after the section existed) that hasn't
// been synced yet.
//
// Registrar+ only.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
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

  const [{ data: offerings }, { data: existing }] = await Promise.all([
    service
      .from('subject_level_offerings')
      .select('subject_id')
      .eq('level_id', section.level_id)
      .eq('academic_year_id', section.academic_year_id),
    service
      .from('section_subjects')
      .select('subject_config_id')
      .eq('section_id', sectionId),
  ]);

  const offeredSubjectIds = (
    (offerings ?? []) as Array<{ subject_id: string }>
  ).map((o) => o.subject_id);

  // subject_configs no longer carries a level_id (migration 080) — resolve
  // the level's offered subjects' config rows by subject_id + AY instead.
  let configs: Array<{ id: string }> = [];
  if (offeredSubjectIds.length > 0) {
    const { data: configRows } = await service
      .from('subject_configs')
      .select('id')
      .eq('academic_year_id', section.academic_year_id)
      .in('subject_id', offeredSubjectIds);
    configs = (configRows ?? []) as Array<{ id: string }>;
  }

  const existingIds = new Set(
    ((existing ?? []) as Array<{ subject_config_id: string }>).map(
      (r) => r.subject_config_id
    )
  );
  const missing = configs.filter((c) => !existingIds.has(c.id));

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

  // Same "no separate generate step" guarantee as the single-subject attach
  // route (POST /api/sections/[id]/subjects) — the bulk-load path must not
  // leave freshly-inserted section_subjects rows without their grading
  // sheets. Non-fatal: a sheet-generation hiccup doesn't undo the
  // already-committed section_subjects insert. grading_method='no_sheet'
  // subjects are skipped by the RPC itself (migration 083).
  let sheetsInserted = 0;
  if (inserted > 0) {
    const { data: bulkResult, error: bulkErr } = await service.rpc(
      'create_grading_sheets_for_section',
      { p_section_id: sectionId }
    );
    if (bulkErr) {
      console.error(
        '[sections/[id]/subjects/load-defaults POST] bulk-sheet RPC failed:',
        bulkErr.message
      );
    } else if (
      bulkResult &&
      typeof bulkResult === 'object' &&
      'inserted' in bulkResult
    ) {
      sheetsInserted = Number(
        (bulkResult as { inserted: unknown }).inserted ?? 0
      );
    }

    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'section.subjects.load_defaults',
      entityType: 'section',
      entityId: sectionId,
      context: { sectionName: section.name, inserted, sheetsInserted },
    });
    if (ayCode) invalidateDrillTags('markbook', ayCode);
  }

  return NextResponse.json({ ok: true, inserted, sheetsInserted });
}
