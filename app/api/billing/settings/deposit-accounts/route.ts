import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
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
  const service = createServiceClient();
  const del = await service
    .from('billing_deposit_accounts')
    .delete()
    .neq('qbo_account_id', '');
  if (del.error)
    return NextResponse.json({ error: del.error.message }, { status: 500 });
  const ins = await service.from('billing_deposit_accounts').insert(
    parsed.data.accounts.map((a) => ({
      qbo_account_id: a.id,
      label: a.label,
      sort: a.sort,
    }))
  );
  if (ins.error)
    return NextResponse.json({ error: ins.error.message }, { status: 500 });
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
