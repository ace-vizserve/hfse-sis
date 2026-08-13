import { NextResponse, type NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';

import { requireCapability } from '@/lib/auth/require-capability';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { listAllAuthUsers } from '@/lib/supabase/paginate';
import { InviteUserSchema } from '@/lib/schemas/user-admin';

// POST /api/sis/admin/users — directly provision a new staff user.
//
// auth.admin.createUser({ ..., email_confirm: true }) bypasses the email-
// verification flow. The superadmin sets the initial password upfront +
// shares it out-of-band (Slack, in-person). Account is active immediately
// — the user can sign in at /login on first attempt with no waiting on
// SMTP delivery or click-through flow.
//
// The legacy magic-link `inviteUserByEmail` path was removed: there's no
// password-setup landing page in this app, which meant invited users
// signed in once via the link but had no way to reauthenticate from
// /login (which is signInWithPassword-only). Direct-create with a known
// password closes that loop.
//
// Superadmin only. If the email already exists, the route returns 409 —
// no silent re-creates or duplicate accounts.
export async function POST(request: NextRequest) {
  const auth = await requireCapability('staff.manage_accounts');
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = InviteUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { email, role, displayName, password } = parsed.data;

  const service = createServiceClient();

  // Pre-check for an existing user to give a clean 409 instead of a 500 from
  // the Auth layer's unique-email constraint. Paginates through every user,
  // not just the first 1000 (this project's user count has crossed that
  // threshold — staff + parent-portal accounts share the project).
  const existing = await listAllAuthUsers(service);
  const alreadyExists = existing.some(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );
  if (alreadyExists) {
    return NextResponse.json(
      { error: `A user with email ${email} already exists.` },
      { status: 409 }
    );
  }

  // Single createUser call sets email + password + role (app_metadata) +
  // display_name (user_metadata) atomically. email_confirm: true marks
  // the email as already-verified so the user can sign in on first attempt.
  const { data: created, error: createErr } =
    await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role },
      user_metadata: displayName ? { display_name: displayName } : undefined,
    });
  if (createErr || !created?.user) {
    return NextResponse.json(
      { error: createErr?.message ?? 'user create failed' },
      { status: 500 }
    );
  }

  // Every staff lookup in the app reads one cached list (lib/auth/staff-list.ts,
  // `unstable_cache` on the `teacher-emails` tag, 5-minute window, shared by
  // every user). Nothing busted it, so a brand-new account was in the Accounts
  // table — which reads live — but missing from that list for up to five
  // minutes. The Accounts row for a teacher offers "Manage teaching
  // assignments" straight away, and POST /api/teacher-assignments validates
  // against the cached list, so the obvious next click answered "that person
  // does not have a teacher account" about an account created seconds earlier,
  // and no amount of refreshing helped: the staleness is on the server.
  revalidateTag('teacher-emails', 'max');

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'user.create',
    entityType: 'user_account',
    entityId: created.user.id,
    context: { email, role, display_name: displayName ?? null },
  });

  return NextResponse.json({ ok: true, id: created.user.id, email, role });
}
