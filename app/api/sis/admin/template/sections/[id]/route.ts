import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { TemplateSectionUpdateSchema } from '@/lib/schemas/template';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/sis/admin/template/sections/[id] — update name / class_type.
// `level_id` is the natural-key partner with `name`, intentionally
// non-editable here; if a section moved to a different level, recreate it.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = TemplateSectionUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { name, class_type, schedule } = parsed.data;

  const service = createServiceClient();

  const { data: before, error: loadErr } = await service
    .from('template_sections')
    .select(
      'id, level_id, name, class_type, schedule, level:levels(level_type)'
    )
    .eq('id', id)
    .maybeSingle();
  if (loadErr)
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!before)
    return NextResponse.json(
      { error: 'template section not found' },
      { status: 404 }
    );

  // level_id is immutable here (see the comment above), so the existing
  // row's own level tells us whether `class_type` (doubling as the
  // Secondary "track" picker) is required/forbidden — same enforcement as
  // create.
  const beforeLevel = before.level as
    | { level_type: string }
    | { level_type: string }[]
    | null;
  const levelType = Array.isArray(beforeLevel)
    ? beforeLevel[0]?.level_type
    : beforeLevel?.level_type;
  if (levelType === 'secondary' && !class_type) {
    return NextResponse.json(
      {
        error: 'Track (Global or Standard) is required for Secondary sections',
      },
      { status: 422 }
    );
  }
  if (levelType !== 'secondary' && class_type) {
    return NextResponse.json(
      { error: 'Track only applies to Secondary sections' },
      { status: 422 }
    );
  }

  const { error: updateErr } = await service
    .from('template_sections')
    .update({
      name,
      class_type: class_type ?? null,
      schedule: schedule ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (updateErr) {
    if ((updateErr as { code?: string }).code === '23505') {
      return NextResponse.json(
        {
          error: `A template section named "${name}" already exists for this level.`,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'template.section.update',
    entityType: 'template_section',
    entityId: id,
    context: {
      level_id: before.level_id,
      before: {
        name: before.name,
        class_type: before.class_type,
        schedule: before.schedule,
      },
      after: {
        name,
        class_type: class_type ?? null,
        schedule: schedule ?? null,
      },
    },
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/sis/admin/template/sections/[id] — remove from template.
// Existing AYs keep their per-AY copy (apply RPC never deletes); admin
// must clean up per AY via /sis/sections/[id] if desired.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const service = createServiceClient();

  const { data: before, error: loadErr } = await service
    .from('template_sections')
    .select('id, level_id, name, class_type, schedule')
    .eq('id', id)
    .maybeSingle();
  if (loadErr)
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!before)
    return NextResponse.json(
      { error: 'template section not found' },
      { status: 404 }
    );

  const { error: deleteErr } = await service
    .from('template_sections')
    .delete()
    .eq('id', id);
  if (deleteErr)
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'template.section.delete',
    entityType: 'template_section',
    entityId: id,
    context: {
      level_id: before.level_id,
      name: before.name,
      class_type: before.class_type,
      schedule: before.schedule,
    },
  });

  return NextResponse.json({ ok: true });
}
