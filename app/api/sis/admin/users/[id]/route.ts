import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { UpdateUserSchema } from '@/lib/schemas/user-admin';

// PATCH /api/sis/admin/users/[id] — update role, enabled state, and/or
// identity fields.
//
// Superadmin-only (requireRole below) — the staff directory renders these
// actions disabled for school_admin (read-only accounts view, KD #154).
//
// `role` writes to `app_metadata.role` (KD #2). `disabled: true` bans the
// user for 100 years (effectively indefinite); `disabled: false` clears the
// ban. No hard-delete path — that would orphan `created_by` audit rows and
// the existing FKs are `references auth.users(id)` without CASCADE.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  if (id === auth.user.id) {
    return NextResponse.json(
      { error: 'You cannot edit your own account here — use /account.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = UpdateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { role, disabled, displayName, email, password } = parsed.data;

  // Identity edits (name / email / password) are superadmin-only.
  if (
    (displayName !== undefined ||
      email !== undefined ||
      password !== undefined) &&
    auth.role !== 'superadmin'
  ) {
    return NextResponse.json(
      { error: 'Only superadmins can update name, email, or password.' },
      { status: 403 }
    );
  }

  const service = createServiceClient();

  const { data: beforeRes, error: beforeErr } =
    await service.auth.admin.getUserById(id);
  if (beforeErr || !beforeRes?.user) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 });
  }
  const before = beforeRes.user;
  const beforeRole =
    (before.app_metadata as { role?: string } | null)?.role ??
    (before.user_metadata as { role?: string } | null)?.role ??
    null;
  const beforeDisabled = Boolean(
    before.banned_until && new Date(before.banned_until).getTime() > Date.now()
  );
  const beforeDisplayName =
    (before.user_metadata as { display_name?: string } | null)?.display_name ??
    null;

  const updates: Parameters<typeof service.auth.admin.updateUserById>[1] = {};
  if (role !== undefined) {
    updates.app_metadata = { ...(before.app_metadata ?? {}), role };
  }
  if (disabled !== undefined) {
    updates.ban_duration = disabled ? '876000h' : 'none';
  }
  if (displayName !== undefined) {
    updates.user_metadata = {
      ...((before.user_metadata as Record<string, unknown>) ?? {}),
      display_name: displayName || null,
    };
  }
  if (email !== undefined) {
    updates.email = email;
  }
  if (password !== undefined) {
    updates.password = password;
  }

  const { error: updateErr } = await service.auth.admin.updateUserById(
    id,
    updates
  );
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
      context: {
        email: before.email,
        before: { role: beforeRole },
        after: { role },
      },
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

  if (displayName !== undefined || email !== undefined) {
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'user.info.update',
      entityType: 'user_account',
      entityId: id,
      context: {
        email: before.email,
        ...(displayName !== undefined
          ? {
              before: { displayName: beforeDisplayName },
              after: { displayName },
            }
          : {}),
        ...(email !== undefined ? { emailChanged: true } : {}),
        ...(password !== undefined ? { passwordReset: true } : {}),
      },
    });
  } else if (password !== undefined) {
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'user.info.update',
      entityType: 'user_account',
      entityId: id,
      context: { email: before.email, passwordReset: true },
    });
  }

  return NextResponse.json({ ok: true });
}
