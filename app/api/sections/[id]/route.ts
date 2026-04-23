import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { SectionUpdateSchema } from '@/lib/schemas/section';

// PATCH /api/sections/[id] — rename a section in-place.
// Only the name is mutable via this route. Level / AY are structural joins;
// class_type is fixed at creation. Audit action: `section.rename`.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(['registrar', 'school_admin', 'admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'section id required' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = SectionUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { name } = parsed.data;

  const service = createServiceClient();

  const { data: before, error: beforeErr } = await service
    .from('sections')
    .select('id, name, academic_year_id, level_id')
    .eq('id', id)
    .maybeSingle();
  if (beforeErr) {
    return NextResponse.json({ error: beforeErr.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: 'section not found' }, { status: 404 });
  }
  if (before.name === name) {
    // No-op: return the current row instead of writing a duplicate audit.
    return NextResponse.json({ ok: true, id: before.id, name: before.name, unchanged: true });
  }

  const { data: updated, error: updateErr } = await service
    .from('sections')
    .update({ name })
    .eq('id', id)
    .select('id, name')
    .single();

  if (updateErr) {
    // 23505 = unique_violation (academic_year_id, level_id, name)
    if ((updateErr as { code?: string }).code === '23505') {
      return NextResponse.json(
        { error: `A section named "${name}" already exists in this level for the current AY.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'section.rename',
    entityType: 'section',
    entityId: id,
    context: {
      academic_year_id: before.academic_year_id,
      level_id: before.level_id,
      from: before.name,
      to: name,
    },
  });

  return NextResponse.json({ ok: true, id: updated.id, name: updated.name });
}
