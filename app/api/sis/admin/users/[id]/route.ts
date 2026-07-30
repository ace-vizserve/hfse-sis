import { NextResponse, type NextRequest } from 'next/server';

import { requireCapability } from '@/lib/auth/require-capability';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { listAllAuthUsers } from '@/lib/supabase/paginate';
import { UpdateUserSchema } from '@/lib/schemas/user-admin';
import { getUserFootprint, isLastSuperadmin } from '@/lib/sis/user-deletion';
import type { Role } from '@/lib/auth/roles';

// PATCH /api/sis/admin/users/[id] — update role, enabled state, and/or
// identity fields.
//
// Superadmin-only (requireRole below) — the staff directory renders these
// actions disabled for school_admin (read-only accounts view, KD #154).
//
// `role` writes to `app_metadata.role` (KD #2). `disabled: true` bans the
// user for 100 years (effectively indefinite); `disabled: false` clears the
// ban. Hard delete lives in the `DELETE` handler below it, scoped to
// zero-activity accounts only — see that handler's doc comment.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCapability('staff.manage_accounts');
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

  // Pre-check for an existing user on the target email to give a clean 409
  // instead of a 500 from the Auth layer's unique-email constraint (mirrors
  // the same check in POST /api/sis/admin/users). Paginates through every
  // user, not just the first 1000 — this project's user count has crossed
  // that threshold (staff + parent-portal accounts share the project).
  if (
    email !== undefined &&
    email.toLowerCase() !== before.email?.toLowerCase()
  ) {
    const allUsers = await listAllAuthUsers(service);
    const claimedBy = allUsers.find(
      (u) => u.id !== id && u.email?.toLowerCase() === email.toLowerCase()
    );
    if (claimedBy) {
      return NextResponse.json(
        {
          error: `The email ${email} is already in use by another account.`,
        },
        { status: 409 }
      );
    }
  }
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

// DELETE /api/sis/admin/users/[id] — permanently remove a user account.
//
// Only succeeds when the account has zero recorded activity anywhere the
// system tracks (lib/sis/user-deletion.ts::getUserFootprint, scoped to the
// account's current role — see the design spec's known limitation on role
// changes over time). Historied accounts stay on Disable (the PATCH route
// above) — this is deliberately not a general-purpose delete.
//
// Superadmin only. Always blocks self-delete and deleting the last
// remaining superadmin, independent of the footprint check.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCapability('staff.manage_accounts');
  if ('error' in auth) return auth.error;

  const { id } = await params;
  if (id === auth.user.id) {
    return NextResponse.json(
      { error: 'You cannot delete your own account.' },
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
  const role: Role | null =
    (before.app_metadata as { role?: Role } | null)?.role ??
    (before.user_metadata as { role?: Role } | null)?.role ??
    null;

  if (role === 'superadmin') {
    let allUsers: Awaited<ReturnType<typeof listAllAuthUsers>>;
    try {
      allUsers = await listAllAuthUsers(service);
    } catch {
      return NextResponse.json(
        { error: 'Could not verify the superadmin count — try again.' },
        { status: 500 }
      );
    }
    const usersForCheck = allUsers.map((u) => ({
      id: u.id,
      role:
        (u.app_metadata as { role?: string } | null)?.role ??
        (u.user_metadata as { role?: string } | null)?.role ??
        null,
    }));
    if (isLastSuperadmin(usersForCheck, id)) {
      return NextResponse.json(
        {
          error:
            'This is the last superadmin account — promote another account first.',
        },
        { status: 409 }
      );
    }
  }

  const footprint = await getUserFootprint(service, id, role);
  if (footprint.length > 0) {
    return NextResponse.json(
      {
        error: `Can't delete — this account has activity in: ${footprint.join(', ')}. Use Disable instead.`,
        tables: footprint,
      },
      { status: 409 }
    );
  }

  const { error: deleteErr } = await service.auth.admin.deleteUser(id);
  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'user.delete',
    entityType: 'user_account',
    entityId: id,
    context: { email: before.email, role },
  });

  return NextResponse.json({ ok: true });
}
