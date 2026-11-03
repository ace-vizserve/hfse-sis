import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { getUserRole } from '@/lib/auth/roles';
import { requireRole } from '@/lib/auth/require-role';
import {
  findAccountByEmail,
  isPortalAdmin,
} from '@/lib/parent-portal/accounts';
import { ResetParentPasswordSchema } from '@/lib/schemas/parent-portal';
import { listAllAuthUsers } from '@/lib/supabase/paginate';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/admin/parent-portal/accounts/password — a superadmin sets a
// parent's password. Port of the portal's `set-password` action.
//
// ⚠ THE ROLE CHECK ON THE TARGET IS THE PROTECTION. Staff and parents share one
// login system, so without it this route could change a superadmin's password.
// Hiding staff from the page's list does nothing against a crafted request.
//
// The role is checked directly, not through a capability, so ticking a box on
// /sis/admin/roles cannot widen who may do this.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = ResetParentPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? 'Check the details entered.',
      },
      { status: 400 }
    );
  }
  const { email, password } = parsed.data;

  try {
    const service = createServiceClient();
    const users = await listAllAuthUsers(service);
    const target = findAccountByEmail(users, email);
    if (!target) {
      return NextResponse.json(
        { error: 'No account found with that email.' },
        { status: 404 }
      );
    }
    if (getUserRole(target) !== null) {
      return NextResponse.json(
        {
          error:
            'This is a staff account. Change it on the Staff page instead.',
        },
        { status: 403 }
      );
    }
    if (isPortalAdmin(target)) {
      return NextResponse.json(
        { error: "This is the portal's admin login, not a parent account." },
        { status: 403 }
      );
    }

    // The portal reads these two keys to ask the parent to change the password.
    // `temporary_password` keeps it readable on the account: a known weakness
    // (spec, Reset Password), and changing it needs a portal release.
    const { error: updateError } = await service.auth.admin.updateUserById(
      target.id,
      {
        password,
        user_metadata: {
          ...target.user_metadata,
          password_changed: false,
          temporary_password: password,
        },
      }
    );
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    await logAction({
      service,
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
      action: 'parent_portal.password_reset',
      entityType: 'parent_portal',
      entityId: target.id,
      context: {
        email: target.email ?? email,
        display_name:
          (target.user_metadata?.fullName as string | undefined) ?? null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'Could not reset the password.',
      },
      { status: 500 }
    );
  }
}
