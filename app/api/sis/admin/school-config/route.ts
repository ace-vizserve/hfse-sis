import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { SchoolConfigUpdateSchema } from '@/lib/schemas/school-config';

// PATCH /api/sis/admin/school-config
//
// Partial update of the singleton school-wide settings row (id=1 — seeded
// by migration 022). Superadmin only. Each field is optional in the
// payload; only fields present in the body are touched. Audit action:
// `school_config.update`; fires once per request with the full diff.
export async function PATCH(request: NextRequest) {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = SchoolConfigUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const service = createServiceClient();

  const { data: before, error: loadErr } = await service
    .from('school_config')
    .select(
      'principal_name, ceo_name, pei_registration_number, default_publish_window_days',
    )
    .eq('id', 1)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!before) {
    return NextResponse.json(
      { error: 'school_config singleton row missing — re-run migration 022' },
      { status: 500 },
    );
  }

  // Build a sparse update object that only touches provided fields.
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: auth.user.id,
  };
  const keys: Array<[keyof typeof parsed.data, string]> = [
    ['principalName', 'principal_name'],
    ['ceoName', 'ceo_name'],
    ['peiRegistrationNumber', 'pei_registration_number'],
    ['defaultPublishWindowDays', 'default_publish_window_days'],
  ];
  for (const [k, col] of keys) {
    if (k in parsed.data && parsed.data[k] !== undefined) {
      updates[col] = parsed.data[k];
    }
  }

  const { error: updateErr } = await service
    .from('school_config')
    .update(updates)
    .eq('id', 1);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Audit: record only the fields that actually changed to keep context tight.
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const [k, col] of keys) {
    if (k in parsed.data && parsed.data[k] !== undefined) {
      const b = (before as Record<string, unknown>)[col];
      const a = parsed.data[k];
      if (b !== a) diff[col] = { before: b, after: a };
    }
  }
  if (Object.keys(diff).length > 0) {
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'school_config.update',
      entityType: 'school_config',
      entityId: '1',
      context: { diff },
    });
  }

  return NextResponse.json({ ok: true });
}
