import { NextResponse, type NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';

import { requireRole } from '@/lib/auth/require-role';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { logAction } from '@/lib/audit/log-action';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { buildGradingSheetScopes } from '@/lib/markbook/grading-sheet-scope';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/grading-sheets/bulk-create
// Body: either { ay_id: uuid } or { section_id: uuid } (exactly one) — the
// original single-scope shape, still used by the AY-Setup checklist row and
// the section-detail header button.
//
// Optionally narrow that scope further: `section_ids: uuid[]` restricts to
// a specific subset of sections within the ay_id scope (used by the
// rebuilt Generate Sheets dialog's multi-select), and `term_ids: uuid[]`
// restricts to specific terms instead of every term in the AY.
//
// Creates grading sheets for all (section × subject × term) scopes, where a
// (section, subject) pair is only in scope when a section_subjects row
// exists for it (migration 079) — see lib/markbook/grading-sheet-scope.ts.
//
// Registrar+ only.
export async function POST(request: NextRequest) {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as {
    ay_id?: string;
    section_id?: string;
    section_ids?: string[];
    term_ids?: string[];
  } | null;

  const ayId = body?.ay_id ?? null;
  const sectionId = body?.section_id ?? null;
  const hasAy = typeof ayId === 'string' && ayId.length > 0;
  const hasSection = typeof sectionId === 'string' && sectionId.length > 0;

  if (hasAy === hasSection) {
    return NextResponse.json(
      { error: 'Provide exactly one of ay_id or section_id' },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  // Resolve target sections + ayId
  let targetSectionIds: string[] = [];
  let resolvedAyId: string;

  if (hasAy) {
    resolvedAyId = ayId!;
    const { data: aySections } = await service
      .from('sections')
      .select('id')
      .eq('academic_year_id', ayId);
    targetSectionIds = ((aySections ?? []) as { id: string }[]).map(
      (s) => s.id
    );
  } else {
    const { data: sec } = await service
      .from('sections')
      .select('id, academic_year_id')
      .eq('id', sectionId)
      .single();
    if (!sec)
      return NextResponse.json({ error: 'section not found' }, { status: 404 });
    targetSectionIds = [sectionId!];
    resolvedAyId = (sec as { academic_year_id: string }).academic_year_id;
  }

  // Narrow to an explicit section subset when provided (the rebuilt dialog's
  // multi-select) — intersect, don't trust the client's list wholesale.
  if (Array.isArray(body?.section_ids) && body.section_ids.length > 0) {
    const requested = new Set(body.section_ids);
    targetSectionIds = targetSectionIds.filter((id) => requested.has(id));
  }

  if (!targetSectionIds.length) {
    return NextResponse.json({ ok: true, inserted: 0, reason: 'no_sections' });
  }

  let inserted = 0;

  try {
    // 1. Load sections with their levels
    const { data: sections } = await service
      .from('sections')
      .select('id, level_id')
      .in('id', targetSectionIds);
    if (!sections?.length)
      return NextResponse.json({
        ok: true,
        inserted: 0,
        reason: 'no_sections',
      });

    // 2. Load subject configs + terms + this section's subject overrides in
    //    parallel. section_subjects (migration 079) decides WHICH subjects
    //    apply to a given section — a (section, subject) pair only gets a
    //    sheet when a section_subjects row exists for it. Every section was
    //    backfilled with its level's full subject list at migration time,
    //    so existing sections behave identically unless someone has since
    //    customized them. subject_configs no longer carries a level_id
    //    (migration 080 subject-weights collapse — one row per subject per
    //    AY), so configs resolve by academic_year_id alone; level-scoping
    //    already happened upstream when the section_subjects rows were
    //    assigned (app/api/sections/[id]/subjects/route.ts validates
    //    against subject_level_offerings at that point).
    let termsQuery = service
      .from('terms')
      .select('id')
      .eq('academic_year_id', resolvedAyId);
    if (Array.isArray(body?.term_ids) && body.term_ids.length > 0) {
      termsQuery = termsQuery.in('id', body.term_ids);
    }

    const [{ data: configs }, { data: terms }, { data: sectionSubjectRows }] =
      await Promise.all([
        service
          .from('subject_configs')
          .select('id, subject_id')
          .eq('academic_year_id', resolvedAyId),
        termsQuery,
        service
          .from('section_subjects')
          .select('section_id, subject_config_id')
          .in('section_id', targetSectionIds),
      ]);

    if (!configs?.length) {
      return NextResponse.json({
        ok: true,
        inserted: 0,
        reason: 'no_subjects',
      });
    }
    if (!terms?.length) {
      return NextResponse.json({ ok: true, inserted: 0, reason: 'no_terms' });
    }

    const allScopes = buildGradingSheetScopes(
      sections as { id: string; level_id: string }[],
      configs as { id: string; subject_id: string }[],
      (sectionSubjectRows ?? []) as {
        section_id: string;
        subject_config_id: string;
      }[],
      terms as { id: string }[]
    );

    if (allScopes.length === 0) {
      return NextResponse.json({
        ok: true,
        inserted: 0,
        reason: 'no_subjects_assigned',
      });
    }

    // 4. Create sheets for ALL scopes (no gate) — the RPC only wants
    //    section_id/subject_id/term_id, so drop the extra subject_config_id
    //    the pure builder carries for the preview route's benefit.
    const { data: rpcResult } = await service.rpc(
      'create_grading_sheets_for_scopes',
      {
        p_scopes: allScopes.map(({ section_id, subject_id, term_id }) => ({
          section_id,
          subject_id,
          term_id,
        })),
      }
    );
    inserted = (rpcResult as { inserted?: number } | null)?.inserted ?? 0;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'internal error' },
      { status: 500 }
    );
  }

  // Skip the audit when the RPC created nothing. Sheet generation is
  // ON CONFLICT DO NOTHING throughout, so re-running "Create all sheets" after
  // everything already exists is a legitimate, common no-op — and logging it
  // made the audit trail imply a second bulk creation.
  if (inserted === 0) {
    return NextResponse.json({ ok: true, changed: false, inserted: 0 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'sheet.bulk_create',
    entityType: 'grading_sheet',
    entityId: hasAy ? ayId : sectionId,
    context: {
      scope: hasAy ? 'ay' : 'section',
      ay_id: ayId,
      section_id: sectionId,
      section_ids: body?.section_ids ?? null,
      term_ids: body?.term_ids ?? null,
      inserted,
    },
  });

  const { data: ayRow } = await service
    .from('academic_years')
    .select('ay_code')
    .eq('id', resolvedAyId)
    .maybeSingle();
  const ayCodeForInvalidation =
    (ayRow as { ay_code: string } | null)?.ay_code ??
    (await requireCurrentAyCode(service));
  invalidateDrillTags('markbook', ayCodeForInvalidation);
  revalidateTag(`sis:${ayCodeForInvalidation}`, 'max');

  return NextResponse.json({
    ok: true,
    inserted,
    reason: inserted === 0 ? 'already_covered' : 'created',
  });
}
