import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
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
//
// ⚠ THE ROLE LIST IS THE SHARED CONSTANT, NOT A LITERAL. This route spelled
// its own array and so missed the 2026-09-10 widening that put `admissions`
// into `ENROLMENT_PLACEMENT_WRITERS`; commit 839029ca then opened
// /records/level-mismatches to admissions without touching any route, so the
// page rendered a Save button that answered `forbidden`. Every route that
// derived its list from this constant was carried along automatically —
// which is the argument for reading it rather than restating it.
export async function POST(request: Request) {
  const auth = await requireRole([...ENROLMENT_PLACEMENT_WRITERS]);
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
    .select('id, code, label')
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
    const toLevel = levelRow as { code: string | null; label: string };
    const priorLevelId =
      (priorAlias as { level_id?: string } | null)?.level_id ?? null;

    // A re-point of an existing alias is a different event from a first
    // mapping, and was once logged as `level.alias.create` with the old level
    // as a bare uuid nobody could read. It now has its own action and names
    // both levels. The lookup of the old level runs after the upsert has
    // committed, so a failed read degrades to the id rather than dropping the
    // audit row for a change that already happened.
    let fromLevel: { code: string | null; label: string | null } | null = null;
    if (priorLevelId) {
      const { data: priorLevelRow } = await service
        .from('levels')
        .select('code, label')
        .eq('id', priorLevelId)
        .maybeSingle();
      fromLevel = (priorLevelRow as {
        code: string | null;
        label: string | null;
      } | null) ?? { code: null, label: null };
    }

    await logAction({
      service,
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
      action: priorLevelId ? 'level.alias.remap' : 'level.alias.create',
      entityType: 'level',
      entityId: toLevelId,
      context: {
        raw_label: fromLabel,
        mapped_to_code: toLevel.code ?? null,
        mapped_to_label: toLevel.label,
        ...(priorLevelId
          ? {
              remapped_from_level_id: priorLevelId,
              remapped_from_code: fromLevel?.code ?? null,
              remapped_from_label: fromLevel?.label ?? null,
            }
          : {}),
      },
    });
  }

  if (current) {
    await invalidateAllOperationalDrills(current.ay_code);
  }

  return NextResponse.json({ ok: true });
}
