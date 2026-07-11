import { NextResponse, type NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { LevelAdminCreateSchema } from '@/lib/schemas/level';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/admin/levels
//
// Creates a new VOLATILE grade level (Levels & Grade Progression, migration
// 078). Core levels (P1-P6, S1-S4) are seeded once by the migration and are
// permanent — this route always inserts `is_core: false`, never accepts it
// from the client. A freshly-created volatile level starts with no
// `ay_level_offerings` row anywhere, i.e. not offered in any AY, until the
// registrar explicitly turns it on via the offering PUT route.
//
// Mirrors app/api/sis/admin/subjects/catalog/route.ts structurally.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = LevelAdminCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { code, label, levelType, sortOrder, nextLevelId } = parsed.data;

  const service = createServiceClient();

  // Duplicate-code pre-check. The DB has UNIQUE(code) as a backstop; this
  // pre-check just gives us a nicer error + lets us return the existing id.
  const { data: existing } = await service
    .from('levels')
    .select('id')
    .eq('code', code)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      {
        error: `A level with code ${code} already exists`,
        existingId: (existing as { id: string }).id,
      },
      { status: 409 }
    );
  }

  const { data: inserted, error: insertErr } = await service
    .from('levels')
    .insert({
      code,
      label,
      level_type: levelType,
      sort_order: sortOrder,
      next_level_id: nextLevelId,
      is_core: false,
    })
    .select('id, code, label, level_type, sort_order, next_level_id, is_core')
    .single();
  if (insertErr || !inserted) {
    // FK violation on next_level_id — the chosen "next level" doesn't exist.
    if ((insertErr as { code?: string } | null)?.code === '23503') {
      return NextResponse.json(
        { error: 'The selected next level does not exist' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: insertErr?.message ?? 'insert failed' },
      { status: 500 }
    );
  }
  const row = inserted as {
    id: string;
    code: string;
    label: string;
    level_type: string;
    sort_order: number;
    next_level_id: string | null;
    is_core: boolean;
  };

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'level.create',
    entityType: 'level',
    entityId: row.id,
    context: {
      code: row.code,
      label: row.label,
      levelType: row.level_type,
      sortOrder: row.sort_order,
      nextLevelId: row.next_level_id,
    },
  });

  revalidateTag('levels', 'max');

  return NextResponse.json({
    ok: true,
    id: row.id,
    code: row.code,
    label: row.label,
    levelType: row.level_type,
    sortOrder: row.sort_order,
    nextLevelId: row.next_level_id,
    isCore: row.is_core,
  });
}
