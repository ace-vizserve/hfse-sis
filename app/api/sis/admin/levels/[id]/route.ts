import { NextResponse, type NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { LevelAdminUpdateSchema } from '@/lib/schemas/level';
import { getLevelRows, type LevelRow } from '@/lib/sis/levels';
import { createServiceClient } from '@/lib/supabase/service';

// Walks `next_level_id` pointers starting at `startId`, hopping through the
// already-loaded `rows` (as returned by `getLevelRows`). Returns true if the
// walk ever reaches `editedId` — meaning pointing the edited level's
// `nextLevelId` at `startId` would close a progression loop back onto
// itself. Bounded by `rows.length` hops so a dangling/inconsistent chain
// can never spin forever.
export function walksBackTo(
  rows: LevelRow[],
  editedId: string,
  startId: string
): boolean {
  const byId = new Map(rows.map((r) => [r.id, r]));
  let current: string | null = startId;
  for (let hop = 0; hop < rows.length; hop++) {
    if (current === editedId) return true;
    if (current === null) return false;
    const row: LevelRow | undefined = byId.get(current);
    if (!row) return false; // dangling pointer — not our problem to resolve here
    current = row.nextLevelId;
  }
  return false;
}

// PATCH /api/sis/admin/levels/[id]
//
// Partial update of label / sort_order / next_level_id. `code` and
// `levelType` are not editable here. Applies to both core and volatile
// levels — renaming/reordering/re-chaining a core level (e.g. P6 -> S1) is
// a legitimate progression edit, not restricted to volatile levels (only
// DELETE is volatile-only).
//
// `nextLevelId` is guarded against two shapes of self-reference:
//   - direct: nextLevelId === the edited level's own id (422 self_reference)
//   - indirect: walking forward from the proposed nextLevelId eventually
//     loops back to the edited level (422 progression_cycle)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = LevelAdminUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { label, sortOrder, nextLevelId } = parsed.data;

  const service = createServiceClient();

  // getLevelRows is cached 60s under the 'levels' tag. A stale read here is
  // an acceptable tradeoff: this is admin-only config edited by one or two
  // people, and every level write path calls revalidateTag('levels','max')
  // on the same instance — so back-to-back edits in one session always see
  // fresh rows for the cycle walk below.
  const rows = await getLevelRows(service);
  const existing = rows.find((r) => r.id === id);
  if (!existing) {
    return NextResponse.json({ error: 'Level not found' }, { status: 404 });
  }

  if (nextLevelId !== undefined && nextLevelId !== null) {
    if (nextLevelId === id) {
      return NextResponse.json(
        {
          error: 'A level cannot progress to itself',
          code: 'self_reference',
        },
        { status: 422 }
      );
    }
    if (walksBackTo(rows, id, nextLevelId)) {
      return NextResponse.json(
        {
          error:
            'That would create a progression loop — pick a different next level',
          code: 'progression_cycle',
        },
        { status: 422 }
      );
    }
  }

  const updatePayload: Record<string, unknown> = {};
  if (label !== undefined) updatePayload.label = label;
  if (sortOrder !== undefined) updatePayload.sort_order = sortOrder;
  if (nextLevelId !== undefined) updatePayload.next_level_id = nextLevelId;

  const { data: updated, error: updateErr } = await service
    .from('levels')
    .update(updatePayload)
    .eq('id', id)
    .select('id, code, label, level_type, sort_order, next_level_id, is_core')
    .single();
  if (updateErr || !updated) {
    // FK violation on next_level_id — the chosen "next level" doesn't exist.
    if ((updateErr as { code?: string } | null)?.code === '23503') {
      return NextResponse.json(
        { error: 'The selected next level does not exist' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: updateErr?.message ?? 'update failed' },
      { status: 500 }
    );
  }
  const row = updated as {
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
    action: 'level.update',
    entityType: 'level',
    entityId: id,
    context: {
      code: existing.code,
      label: row.label,
      before: {
        label: existing.label,
        sort_order: existing.sortOrder,
        next_level_id: existing.nextLevelId,
      },
      after: {
        label: row.label,
        sort_order: row.sort_order,
        next_level_id: row.next_level_id,
      },
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

// DELETE /api/sis/admin/levels/[id]
//
// Only volatile levels (is_core = false) can be deleted — core levels
// (P1-P6, S1-S4) are permanent (422 core_permanent). A level with sections,
// subject_configs, or other operational data referencing it 409s with a
// plain-English message instead of a raw FK-violation error. Its
// `ay_level_offerings` rows are removed automatically — that table's
// `level_id` FK is `on delete cascade` (migration 078), so no explicit
// cleanup query is needed here.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const service = createServiceClient();

  const { data: existing, error: loadErr } = await service
    .from('levels')
    .select('id, code, label, level_type, is_core')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Level not found' }, { status: 404 });
  }
  const row = existing as {
    id: string;
    code: string;
    label: string;
    level_type: string;
    is_core: boolean;
  };
  if (row.is_core) {
    return NextResponse.json(
      {
        error: "Core grade levels are permanent and can't be deleted",
        code: 'core_permanent',
      },
      { status: 422 }
    );
  }

  const { error: deleteErr } = await service
    .from('levels')
    .delete()
    .eq('id', id);
  if (deleteErr) {
    if ((deleteErr as { code?: string }).code === '23503') {
      return NextResponse.json(
        {
          error:
            "This level has classes or subject settings on record — it can't be deleted.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'level.delete',
    entityType: 'level',
    entityId: id,
    context: {
      code: row.code,
      label: row.label,
      levelType: row.level_type,
    },
  });

  revalidateTag('levels', 'max');

  return NextResponse.json({ ok: true });
}
