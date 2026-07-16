import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { SectionTrackAssignSchema } from '@/lib/schemas/section';
import { applyTrackBundle } from '@/lib/sis/section-track';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sections/[id]/track
// Body: { track: 'global' | 'standard' }
//
// One-click "flag this section as Global or Standard" — bulk-assigns the
// track's static subject bundle (`lib/sis/track-bundles.ts`) via
// `section_subjects` (additive only, never removes an existing manual
// customization), then generates any newly-needed grading sheets, same
// pattern as every other section_subjects write path in this codebase
// (POST /api/sections/[id]/subjects, .../load-defaults). Also stamps
// `sections.track` — a bulk-assignment TRIGGER only, never authoritative:
// nothing else in the codebase reads it to gate/filter/restrict a
// section's subjects.
//
// Callable both from an existing section's detail page (this route) and
// from section creation (`POST /api/sections`, which calls
// `applyTrackBundle` directly for the just-inserted section instead of
// round-tripping through this route).
//
// Registrar+ only — same gate as every other section-mutation route.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id: sectionId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = SectionTrackAssignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { track } = parsed.data;

  const service = createServiceClient();

  const { data: section } = await service
    .from('sections')
    .select(
      'id, name, level_id, academic_year_id, level:levels(level_type), academic_years!inner(ay_code)'
    )
    .eq('id', sectionId)
    .maybeSingle();
  if (!section) {
    return NextResponse.json({ error: 'Section not found' }, { status: 404 });
  }

  const levelJoin = section.level as
    | { level_type: string }
    | { level_type: string }[]
    | null;
  const levelType = Array.isArray(levelJoin)
    ? levelJoin[0]?.level_type
    : levelJoin?.level_type;
  if (levelType !== 'secondary') {
    return NextResponse.json(
      { error: 'Track only applies to Secondary sections' },
      { status: 422 }
    );
  }

  const ayJoin = section.academic_years as unknown as
    | { ay_code: string }
    | { ay_code: string }[];
  const ayCode = Array.isArray(ayJoin) ? ayJoin[0]?.ay_code : ayJoin?.ay_code;

  const { error: updateErr } = await service
    .from('sections')
    .update({ track })
    .eq('id', sectionId);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const { inserted, resolvedCodes, missingCodes } = await applyTrackBundle(
    service,
    {
      sectionId,
      academicYearId: section.academic_year_id,
      track,
    }
  );

  // Same "no separate generate step" guarantee as the single-subject
  // attach + load-defaults routes — best-effort, non-fatal (the track +
  // section_subjects work above already committed).
  let sheetsInserted = 0;
  if (inserted > 0) {
    const { data: bulkResult, error: bulkErr } = await service.rpc(
      'create_grading_sheets_for_section',
      { p_section_id: sectionId }
    );
    if (bulkErr) {
      console.error(
        '[sections/[id]/track POST] bulk-sheet RPC failed:',
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
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'section.track.assign',
    entityType: 'section',
    entityId: sectionId,
    context: {
      sectionName: section.name,
      track,
      bundleCodes: resolvedCodes,
      missingCodes,
      inserted,
      sheetsInserted,
    },
  });

  if (ayCode) invalidateDrillTags('markbook', ayCode);

  return NextResponse.json({
    ok: true,
    track,
    inserted,
    sheetsInserted,
    missingCodes,
  });
}
