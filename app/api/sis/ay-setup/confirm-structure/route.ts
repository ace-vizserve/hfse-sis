import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/ay-setup/confirm-structure
// Body: { ay_code: string }
//
// Registrar-facing confirmation that a new AY's carried-forward starting
// sections/subjects/weights (auto-copied from the most recent prior AY by
// create_academic_year, migration 089) have been reviewed. Idempotent —
// re-confirming after making adjustments just updates the timestamp/actor
// and logs again; not an error. See
// docs/superpowers/specs/2026-07-20-remove-structure-defaults-template-design.md.
export async function POST(request: Request) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const ayCode = (body?.ay_code ?? '').trim();
  if (!/^AY\d{4}$/i.test(ayCode)) {
    return NextResponse.json(
      { error: 'Invalid or missing ay_code' },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: ayRow, error: ayErr } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode.toUpperCase())
    .maybeSingle();
  if (ayErr || !ayRow) {
    return NextResponse.json(
      { error: 'Academic year not found' },
      { status: 404 }
    );
  }
  const ayId = (ayRow as { id: string }).id;

  const [{ count: sectionsCount }, { count: configsCount }] = await Promise.all(
    [
      service
        .from('sections')
        .select('*', { count: 'exact', head: true })
        .eq('academic_year_id', ayId),
      service
        .from('subject_configs')
        .select('*', { count: 'exact', head: true })
        .eq('academic_year_id', ayId),
    ]
  );

  const { error: updateErr } = await service
    .from('academic_years')
    .update({
      structure_confirmed_at: nowIso,
      structure_confirmed_by: auth.user.id,
    })
    .eq('id', ayId);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'ay.structure.confirm',
    entityType: 'academic_year',
    entityId: ayId,
    context: {
      ay_code: ayCode.toUpperCase(),
      sections_count: sectionsCount ?? 0,
      subject_configs_count: configsCount ?? 0,
    },
  });

  return NextResponse.json({ ok: true, confirmedAt: nowIso });
}
