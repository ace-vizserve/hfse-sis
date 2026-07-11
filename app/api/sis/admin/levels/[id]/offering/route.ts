import { NextResponse, type NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { LevelOfferingSchema } from '@/lib/schemas/level';
import { createServiceClient } from '@/lib/supabase/service';

// PUT /api/sis/admin/levels/[id]/offering
//
// Toggles whether a VOLATILE level is offered in a given academic year, via
// `ay_level_offerings` (migration 078). Core levels (P1-P6, S1-S4) are
// always offered and have no offering rows at all — this route 422s
// core_always_offered rather than silently no-opping, so the client can
// disable the toggle with a clear reason instead of guessing.
//
// Idempotent both directions: turning "on" twice, or "off" when already
// off, succeeds without error (insert ignores the duplicate; delete simply
// matches zero rows).
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = LevelOfferingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { academicYearId, offered } = parsed.data;

  const service = createServiceClient();

  const { data: existing, error: loadErr } = await service
    .from('levels')
    .select('id, code, label, is_core')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Level not found' }, { status: 404 });
  }
  const level = existing as {
    id: string;
    code: string;
    label: string;
    is_core: boolean;
  };
  if (level.is_core) {
    return NextResponse.json(
      {
        error: "This level is permanent — it's always offered",
        code: 'core_always_offered',
      },
      { status: 422 }
    );
  }

  if (offered) {
    const { error: upsertErr } = await service
      .from('ay_level_offerings')
      .upsert(
        { academic_year_id: academicYearId, level_id: id },
        { onConflict: 'academic_year_id,level_id', ignoreDuplicates: true }
      );
    if (upsertErr) {
      // FK violation — the given academic year doesn't exist.
      if ((upsertErr as { code?: string }).code === '23503') {
        return NextResponse.json(
          { error: 'Academic year not found' },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }
  } else {
    const { error: deleteErr } = await service
      .from('ay_level_offerings')
      .delete()
      .eq('academic_year_id', academicYearId)
      .eq('level_id', id);
    if (deleteErr) {
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'level.offering.toggle',
    entityType: 'level',
    entityId: id,
    context: {
      code: level.code,
      label: level.label,
      academicYearId,
      offered,
    },
  });

  revalidateTag('levels', 'max');

  return NextResponse.json({ ok: true, id, academicYearId, offered });
}
