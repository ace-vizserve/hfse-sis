import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { TemplateSectionCreateSchema } from '@/lib/schemas/template';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/admin/template/sections — create a new template section.
// Superadmin only. Template edits do NOT propagate to existing AYs until
// the admin clicks "Propagate to AYs" on /sis/admin/template (which calls
// /api/sis/admin/template/apply).
export async function POST(request: NextRequest) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = TemplateSectionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { name, level_id, class_type, schedule } = parsed.data;

  const service = createServiceClient();

  const { data: inserted, error } = await service
    .from('template_sections')
    .insert({
      level_id,
      name,
      class_type: class_type ?? null,
      schedule: schedule ?? null,
    })
    .select('id, level_id, name, class_type, schedule')
    .single();

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json(
        {
          error: `A template section named "${name}" already exists for this level.`,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'template.section.create',
    entityType: 'template_section',
    entityId: inserted.id,
    context: {
      name,
      level_id,
      class_type: class_type ?? null,
      schedule: schedule ?? null,
    },
  });

  return NextResponse.json({ ok: true, id: inserted.id });
}
