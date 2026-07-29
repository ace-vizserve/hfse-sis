import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { LevelRemapSchema } from '@/lib/schemas/level';
import { createServiceClient } from '@/lib/supabase/service';
import { invalidateAllOperationalDrills } from '@/lib/cache/invalidate-drill-tags';
import { getCurrentAcademicYear } from '@/lib/academic-year';

// POST /api/sis/level-aliases
// Body: { fromLabel: string, toLevelId: uuid }
//
// Saves (or corrects, via upsert) a mapping from an observed admissions
// `levelApplied` string to a canonical `public.levels` row. See
// docs/superpowers/specs/2026-07-18-admissions-level-alias-reconciliation-design.md.
// No retry/auto-assignment side effect here — per
// docs/superpowers/specs/2026-07-20-manual-section-assignment-design.md,
// section assignment is always registrar-manual, so this route only needs
// to make the label resolvable. Affected applications simply become
// normal "level known, section not yet assigned" rows in /records/unsynced.
export async function POST(request: Request) {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = LevelRemapSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { fromLabel, toLevelId } = parsed.data;

  const service = createServiceClient();

  const { data: levelRow, error: levelErr } = await service
    .from('levels')
    .select('id, label')
    .eq('id', toLevelId)
    .maybeSingle();
  if (levelErr || !levelRow) {
    return NextResponse.json({ error: 'Level not found' }, { status: 404 });
  }

  // Read the existing mapping first so a re-submission of the SAME mapping
  // doesn't log `level.alias.create` again. The upsert is idempotent on data,
  // but the audit row previously fired every time — and these rows are how you
  // reconstruct when a mis-typed level label was first reconciled.
  const { data: priorAlias } = await service
    .from('level_aliases')
    .select('level_id')
    .eq('raw_label', fromLabel)
    .maybeSingle();
  const unchanged =
    (priorAlias as { level_id?: string } | null)?.level_id === toLevelId;

  const { error: upsertErr } = await service.from('level_aliases').upsert(
    {
      raw_label: fromLabel,
      level_id: toLevelId,
      created_by: auth.user.id,
    },
    { onConflict: 'raw_label' }
  );
  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  const current = await getCurrentAcademicYear();
  if (!unchanged) {
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'level.alias.create',
      entityType: 'level',
      entityId: toLevelId,
      context: {
        raw_label: fromLabel,
        mapped_to_label: (levelRow as { label: string }).label,
        // A re-point of an existing alias is a different event from a first
        // mapping; record which one this was.
        remapped_from_level_id:
          (priorAlias as { level_id?: string } | null)?.level_id ?? null,
      },
    });
  }

  if (current) {
    await invalidateAllOperationalDrills(current.ay_code);
  }

  return NextResponse.json({ ok: true });
}
