import { NextResponse, type NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';

import { requireCapability } from '@/lib/auth/require-capability';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { listAllAuthUsers } from '@/lib/supabase/paginate';
import { UpdateUserSchema } from '@/lib/schemas/user-admin';
import { getUserFootprint, isLastSuperadmin } from '@/lib/sis/user-deletion';
import { getUserRole, getUserRoleSet, type Role } from '@/lib/auth/roles';

// PATCH /api/sis/admin/users/[id] — update roles, enabled state, and/or
// identity fields.
//
// Superadmin-only (requireRole below) — the staff directory renders these
// actions disabled for school_admin (read-only accounts view, KD #154).
//
// `role` — one role or a list of them — replaces `app_metadata.role`, the set
// of roles the account may hold (KD #2), and `app_metadata.active_role` is kept
// pointing at one the account still holds. `disabled: true` bans the
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
  const { role: roles, disabled, displayName, email, password } = parsed.data;

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
  const beforeRoles = getUserRoleSet(before);
  const beforeActiveRole = getUserRole(before);
  const beforeDisabled = Boolean(
    before.banned_until && new Date(before.banned_until).getTime() > Date.now()
  );
  const beforeDisplayName =
    (before.user_metadata as { display_name?: string } | null)?.display_name ??
    null;

  const updates: Parameters<typeof service.auth.admin.updateUserById>[1] = {};
  // The role this account will be working under once the edit lands. Keeping
  // the one it is already using is the quiet answer — but if that role is being
  // taken away, it has to move to one the account still holds, or the person is
  // left working as something the account no longer is. Falls to the first
  // granted role, which is also what a fresh account gets.
  const nextActiveRole =
    roles === undefined
      ? beforeActiveRole
      : beforeActiveRole && roles.includes(beforeActiveRole)
        ? beforeActiveRole
        : roles[0];
  if (roles !== undefined) {
    updates.app_metadata = {
      ...(before.app_metadata ?? {}),
      role: roles,
      active_role: nextActiveRole,
    };
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

  // Every staff lookup in the app reads one cached list (lib/auth/staff-list.ts,
  // `unstable_cache` on the `teacher-emails` tag, 5-minute window, shared by
  // every user), and this route can change every field that list holds: the
  // roles, the email, the display name and the enabled state. Nothing busted
  // it, so an edit here took up to five minutes to reach the teacher pickers,
  // the "N teaching" headcount, the form-adviser names on report cards and the
  // approver notification lists — and no amount of refreshing helped, because
  // the staleness is on the server.
  //
  // POST /api/sis/admin/users has busted the same tag for the same reason since
  // it was written; this is the asymmetry that left behind, closed. Granting
  // somebody the teacher role has exactly the failure that route's comment
  // describes: the obvious next click, "Manage teaching assignments", answered
  // "that person does not have a teacher account" about a role granted seconds
  // earlier.
  //
  // Unconditional on a successful update rather than per-field: the fields are
  // ALL cached, so a condition could only ever be a way to get it wrong later.
  revalidateTag('teacher-emails', 'max');

  // Compared as a joined string so re-saving the same roles in a different
  // order is not logged as a change — the set is what was granted, the order is
  // just how the form happened to send it.
  const beforeRoleLabel = beforeRoles.join(', ');
  const afterRoleLabel =
    roles === undefined ? beforeRoleLabel : roles.join(', ');
  if (roles !== undefined && afterRoleLabel !== beforeRoleLabel) {
    await logAction({
      service,
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
      action: 'user.role.update',
      entityType: 'user_account',
      entityId: id,
      context: {
        email: before.email,
        before: { role: beforeRoleLabel || null },
        after: { role: afterRoleLabel },
        ...(nextActiveRole !== beforeActiveRole
          ? { active_role: nextActiveRole }
          : {}),
      },
    });
  }

  if (disabled !== undefined && disabled !== beforeDisabled) {
    await logAction({
      service,
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
      action: disabled ? 'user.disable' : 'user.enable',
      entityType: 'user_account',
      entityId: id,
      context: { email: before.email, role: afterRoleLabel || null },
    });
  }

  if (displayName !== undefined || email !== undefined) {
    await logAction({
      service,
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
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
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
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
  // Every role the account holds. The last-superadmin check below has to see a
  // superadmin who also teaches as a superadmin — reading only the role they
  // happen to be using would let the last one be deleted while they were
  // looking at a class.
  const roles = getUserRoleSet(before);
  const role: Role | null = getUserRole(before);

  if (roles.includes('superadmin')) {
    let allUsers: Awaited<ReturnType<typeof listAllAuthUsers>>;
    try {
      allUsers = await listAllAuthUsers(service);
    } catch {
      return NextResponse.json(
        { error: 'Could not verify the superadmin count — try again.' },
        { status: 500 }
      );
    }
    // ⚠ "HOLDS superadmin", NOT "IS CURRENTLY WORKING AS superadmin".
    // `isLastSuperadmin` is a pure one-role-per-row check with its own unit
    // test — the guard that, gotten backwards, makes every superadmin account
    // deletable and locks the school out of /sis/admin permanently. Rather than
    // change it, each row is reduced to the only role it asks about: an account
    // that holds superadmin alongside another role counts as a superadmin here
    // even while its holder is looking at the app as a teacher.
    const usersForCheck = allUsers.map((u) => {
      const held = getUserRoleSet(u);
      return {
        id: u.id,
        role: held.includes('superadmin') ? 'superadmin' : (held[0] ?? null),
      };
    });
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

  // ⚠ AN ACCOUNT WITH TWO ROLES IS CHECKED AGAINST EVERY TABLE.
  // The footprint list is scoped per role, so checking a two-role account
  // against one of them would miss the work it did in the other and report an
  // account with activity as safe to delete. `null` is the existing
  // "unknown → check everything" path, which is exactly the right answer here.
  const footprintRole = roles.length === 1 ? roles[0] : null;
  const footprint = await getUserFootprint(service, id, footprintRole);
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

  // Same cached staff list as the PATCH above. A deleted account that stayed in
  // it would keep appearing in teacher pickers and name lookups for up to five
  // minutes after it stopped existing.
  revalidateTag('teacher-emails', 'max');

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'user.delete',
    entityType: 'user_account',
    entityId: id,
    context: { email: before.email, role },
  });

  return NextResponse.json({ ok: true });
}
