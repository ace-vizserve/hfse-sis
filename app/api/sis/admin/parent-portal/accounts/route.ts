import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import {
  findAccountByEmail,
  toExistingAccount,
} from '@/lib/parent-portal/accounts';
import { CreateParentAccountSchema } from '@/lib/schemas/parent-portal';
import { listAllAuthUsers } from '@/lib/supabase/paginate';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/admin/parent-portal/accounts — a superadmin creates a parent's
// account. Port of the portal's `create-account` action.
//
// No `app_metadata.role`: an account with no role is what makes it a parent.
// The role is checked directly, not through a capability, so ticking a box on
// /sis/admin/roles cannot widen who may do this.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = CreateParentAccountSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? 'Check the details entered.',
      },
      { status: 400 }
    );
  }
  const { firstName, lastName, relationship, email, password } = parsed.data;

  try {
    const service = createServiceClient();
    const users = await listAllAuthUsers(service);
    const existingUser = findAccountByEmail(users, email);
    if (existingUser) {
      const existing = toExistingAccount(existingUser);
      return NextResponse.json(
        {
          error: existing.isStaff
            ? 'This email belongs to a staff account.'
            : 'An account with this email already exists.',
          existing,
        },
        { status: 409 }
      );
    }

    const fullName = `${lastName}, ${firstName}`;
    const { data: created, error: createError } =
      await service.auth.admin.createUser({
        email,
        password,
        // Created by the school, so usable straight away.
        email_confirm: true,
        user_metadata: {
          fullName,
          relationship,
          // Same keys as a reset: the portal asks the parent to change it.
          password_changed: false,
          temporary_password: password,
        },
      });
    if (createError || !created?.user) {
      return NextResponse.json(
        { error: createError?.message ?? 'Could not create the account.' },
        { status: 500 }
      );
    }

    await logAction({
      service,
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
      action: 'parent_portal.account_create',
      entityType: 'parent_portal',
      entityId: created.user.id,
      context: { email, display_name: fullName, relationship },
    });

    return NextResponse.json({
      ok: true,
      account: { email, fullName, relationship },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'Could not create the account.',
      },
      { status: 500 }
    );
  }
}
