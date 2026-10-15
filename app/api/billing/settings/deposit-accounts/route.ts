import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { firstDuplicate } from '@/lib/billing/settings-helpers';
import { replaceRows } from '@/lib/billing/settings.server';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Body = z.object({
  accounts: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().trim().min(1).max(60),
        sort: z.number().int().min(0).max(99),
      })
    )
    .min(1)
    .max(10),
});

// PUT /api/billing/settings/deposit-accounts — the accounts Record payment
// offers (HFSE: UOB, PayNow, Credit/Debit Card).
export async function PUT(request: Request) {
  const auth = await requireRole([...QBO_ADMIN_ROLES]);
  if ('error' in auth) return auth.error;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  const dup = firstDuplicate(parsed.data.accounts.map((a) => a.id));
  if (dup) {
    const label = parsed.data.accounts.find((a) => a.id === dup)?.label;
    return NextResponse.json(
      { error: `${label ?? dup} is listed twice.` },
      { status: 400 }
    );
  }
  const service = createServiceClient();
  try {
    await replaceRows(
      service,
      'billing_deposit_accounts',
      'qbo_account_id',
      parsed.data.accounts.map((a) => ({
        qbo_account_id: a.id,
        label: a.label,
        sort: a.sort,
      }))
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Saving failed.' },
      { status: 500 }
    );
  }
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    action: 'billing.deposit_accounts.update',
    entityType: 'billing_setting',
    entityId: 'deposit_accounts',
    context: { labels: parsed.data.accounts.map((a) => a.label) },
  });
  return NextResponse.json({ ok: true });
}
