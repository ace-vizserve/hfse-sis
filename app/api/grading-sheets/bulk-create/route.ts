import { NextResponse, type NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';

import { requireRole } from '@/lib/auth/require-role';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { logAction } from '@/lib/audit/log-action';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/grading-sheets/bulk-create
// Body: either { ay_id: uuid } or { section_id: uuid } (exactly one).
//
// Creates grading sheets for all (section × subject × term) scopes.
//
// Registrar+ only.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as {
    ay_id?: string;
    section_id?: string;
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

    const levelIds = [
      ...new Set(
        (sections as { id: string; level_id: string }[]).map((s) => s.level_id)
      ),
    ];

    // 2. Load subject configs + terms in parallel
    const [{ data: configs }, { data: terms }] = await Promise.all([
      service
        .from('subject_configs')
        .select('subject_id, level_id')
        .eq('academic_year_id', resolvedAyId)
        .in('level_id', levelIds),
      service.from('terms').select('id').eq('academic_year_id', resolvedAyId),
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

    // 3. Build flat scope list: one entry per (section × subject × term)
    const allScopes: {
      section_id: string;
      subject_id: string;
      term_id: string;
    }[] = [];
    for (const sec of sections as { id: string; level_id: string }[]) {
      const secSubjects = (
        configs as { subject_id: string; level_id: string }[]
      ).filter((c) => c.level_id === sec.level_id);
      for (const term of terms as { id: string }[]) {
        for (const cfg of secSubjects) {
          allScopes.push({
            section_id: sec.id,
            subject_id: cfg.subject_id,
            term_id: term.id,
          });
        }
      }
    }

    // 4. Create sheets for ALL scopes (no gate)
    if (allScopes.length > 0) {
      const { data: rpcResult } = await service.rpc(
        'create_grading_sheets_for_scopes',
        {
          p_scopes: allScopes,
        }
      );
      inserted = (rpcResult as { inserted?: number } | null)?.inserted ?? 0;
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'internal error' },
      { status: 500 }
    );
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
