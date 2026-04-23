import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { InviteUserSchema } from '@/lib/schemas/user-admin';

// POST /api/sis/admin/users — invite a new staff user with a pre-set role.
// Superadmin only. Sends a magic-link invitation via Supabase Auth; the user
// clicks through, signs in once, and their `app_metadata.role` is set to
// whatever the admin picked. `display_name` lands on `user_metadata` for
// nicer lists.
//
// If the email already exists, the route returns 409 — no silent re-invites.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = InviteUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { email, role, displayName } = parsed.data;

  const service = createServiceClient();

  // Pre-check for an existing user to give a clean 409 instead of a 500 from
  // the Auth layer's unique-email constraint.
  const { data: existing } = await service.auth.admin.listUsers({ perPage: 1000 });
  const alreadyExists = existing?.users.some(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  if (alreadyExists) {
    return NextResponse.json(
      { error: `A user with email ${email} already exists.` },
      { status: 409 },
    );
  }

  const { data: invited, error: inviteErr } = await service.auth.admin.inviteUserByEmail(
    email,
    {
      data: displayName ? { display_name: displayName } : undefined,
    },
  );
  if (inviteErr || !invited?.user) {
    return NextResponse.json(
      { error: inviteErr?.message ?? 'invite failed' },
      { status: 500 },
    );
  }

  // Set the role + display name in app_metadata.role (the canonical location
  // per KD #2). The invite call above can't set app_metadata directly, so
  // we follow up with an update.
  const { error: updateErr } = await service.auth.admin.updateUserById(invited.user.id, {
    app_metadata: { role },
  });
  if (updateErr) {
    return NextResponse.json(
      { error: `invite sent, but role assignment failed: ${updateErr.message}` },
      { status: 500 },
    );
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'user.invite',
    entityType: 'user_account',
    entityId: invited.user.id,
    context: { email, role, display_name: displayName ?? null },
  });

  return NextResponse.json({ ok: true, id: invited.user.id, email, role });
}
