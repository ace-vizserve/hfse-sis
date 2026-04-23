import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { UpdateUserSchema } from '@/lib/schemas/user-admin';

// PATCH /api/sis/admin/users/[id] — update role and/or enabled state.
// Superadmin only.
//
// `role` writes to `app_metadata.role` (KD #2). `disabled: true` bans the
// user for 100 years (effectively indefinite); `disabled: false` clears the
// ban. No hard-delete path — that would orphan `created_by` audit rows and
// the existing FKs are `references auth.users(id)` without CASCADE.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  if (id === auth.user.id) {
    return NextResponse.json(
      { error: 'You cannot edit your own account here — use /account.' },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = UpdateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { role, disabled } = parsed.data;

  const service = createServiceClient();

  const { data: beforeRes, error: beforeErr } = await service.auth.admin.getUserById(id);
  if (beforeErr || !beforeRes?.user) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 });
  }
  const before = beforeRes.user;
  const beforeRole =
    (before.app_metadata as { role?: string } | null)?.role ??
    (before.user_metadata as { role?: string } | null)?.role ??
    null;
  const beforeDisabled = Boolean(
    before.banned_until && new Date(before.banned_until).getTime() > Date.now(),
  );

  const updates: Parameters<typeof service.auth.admin.updateUserById>[1] = {};
  if (role !== undefined) {
    updates.app_metadata = { ...(before.app_metadata ?? {}), role };
  }
  if (disabled !== undefined) {
    // `none` clears the ban; a long string bans indefinitely. Supabase JS
    // doesn't expose a "forever" helper, so we use ~100 years.
    updates.ban_duration = disabled ? '876000h' : 'none';
  }

  const { error: updateErr } = await service.auth.admin.updateUserById(id, updates);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  if (role !== undefined && role !== beforeRole) {
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'user.role.update',
      entityType: 'user_account',
      entityId: id,
      context: { email: before.email, before: { role: beforeRole }, after: { role } },
    });
  }

  if (disabled !== undefined && disabled !== beforeDisabled) {
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: disabled ? 'user.disable' : 'user.enable',
      entityType: 'user_account',
      entityId: id,
      context: { email: before.email, role: role ?? beforeRole },
    });
  }

  return NextResponse.json({ ok: true });
}
