import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { reclassifyAll } from '@/lib/billing/settings.server';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Stage = z.enum(['registration', 'fees', 'none']);
const Row = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  stage: Stage,
});
const Body = z.object({
  accounts: z.array(Row).max(500),
  items: z.array(Row).max(2000),
});

// PUT /api/billing/settings/mapping — which income accounts and items put an
// invoice on the Registration / Fees tile. Replaces both lists, then
// re-applies them to every stored invoice.
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
  const { accounts, items } = parsed.data;
  for (const [table, key, nameCol, rows] of [
    ['billing_account_map', 'qbo_account_id', 'account_name', accounts],
    ['billing_item_map', 'qbo_item_id', 'item_name', items],
  ] as const) {
    const del = await service.from(table).delete().neq(key, '');
    if (del.error)
      return NextResponse.json({ error: del.error.message }, { status: 500 });
    if (rows.length) {
      const ins = await service
        .from(table)
        .insert(
          rows.map((r) => ({ [key]: r.id, [nameCol]: r.name, stage: r.stage }))
        );
      if (ins.error)
        return NextResponse.json({ error: ins.error.message }, { status: 500 });
    }
  }
  const { changed } = await reclassifyAll(service);
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    action: 'billing.mapping.update',
    entityType: 'billing_setting',
    entityId: 'mapping',
    context: {
      accounts: accounts.length,
      items: items.length,
      students_affected: changed.length,
    },
  });
  return NextResponse.json({ ok: true, studentsAffected: changed.length });
}
