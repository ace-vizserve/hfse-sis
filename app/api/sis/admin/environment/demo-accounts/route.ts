import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/sis/admin/environment/demo-accounts
// DELETE /api/sis/admin/environment/demo-accounts
//
// Superadmin-only preview + removal of seeded demo/test staff accounts that
// leak into the global /sis/admin/staff directory regardless of which AY
// is current (auth.users is not AY-scoped). Three identification signals,
// all additive (an account matching any one is included):
//   - user_metadata.seeded_teacher === true   (lib/sis/seeder/populated.ts)
//   - user_metadata.seeded_for_enrolee present (lib/sis/seeder/demo-extras.ts)
//   - email ends with @demo.com                (defensive catch-all for any
//     account created before the metadata tagging existed)
//
// Real HFSE staff never have @demo.com addresses or this metadata, so this
// is a precise match, not a heuristic guess.

type DemoAccountReason =
  | 'seeded_teacher'
  | 'seeded_for_enrolee'
  | 'demo_domain';

type DemoAccount = {
  id: string;
  email: string;
  reason: DemoAccountReason;
  createdAt: string;
};

async function findDemoAccounts(
  service: ReturnType<typeof createServiceClient>
): Promise<DemoAccount[]> {
  const { data, error } = await service.auth.admin.listUsers({
    perPage: 1000,
  });
  if (error) {
    throw new Error(`Failed to list users: ${error.message}`);
  }

  const out: DemoAccount[] = [];
  for (const u of data.users) {
    if (!u.email) continue;
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    let reason: DemoAccountReason | null = null;
    if (meta.seeded_teacher === true) reason = 'seeded_teacher';
    else if (meta.seeded_for_enrolee != null) reason = 'seeded_for_enrolee';
    else if (u.email.toLowerCase().endsWith('@demo.com'))
      reason = 'demo_domain';

    if (reason) {
      out.push({
        id: u.id,
        email: u.email,
        reason,
        createdAt: u.created_at,
      });
    }
  }
  return out;
}

export async function GET() {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const service = createServiceClient();
  try {
    const accounts = await findDemoAccounts(service);
    return NextResponse.json({ accounts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Lookup failed' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const service = createServiceClient();

  let accounts: DemoAccount[];
  try {
    accounts = await findDemoAccounts(service);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Lookup failed' },
      { status: 500 }
    );
  }

  if (accounts.length === 0) {
    return NextResponse.json({ removed: 0, emails: [] });
  }

  const removedEmails: string[] = [];
  for (const acct of accounts) {
    const { error } = await service.auth.admin.deleteUser(acct.id);
    if (error) {
      console.error(
        `[demo-accounts] delete failed for ${acct.email}:`,
        error.message
      );
      continue;
    }
    removedEmails.push(acct.email);
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'environment.demo_accounts_removed',
    entityType: 'user_account',
    entityId: 'bulk',
    context: {
      removed_count: removedEmails.length,
      emails: removedEmails,
    },
  });

  return NextResponse.json({
    removed: removedEmails.length,
    emails: removedEmails,
  });
}
