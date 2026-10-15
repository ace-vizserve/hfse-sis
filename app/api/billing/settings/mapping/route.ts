import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { firstDuplicate } from '@/lib/billing/settings-helpers';
import { reclassifyAll, replaceRows } from '@/lib/billing/settings.server';
import { syncTilesForStudent } from '@/lib/billing/tiles.server';
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
  const { accounts, items } = parsed.data;
  const dup =
    firstDuplicate(accounts.map((r) => r.id)) ??
    firstDuplicate(items.map((r) => r.id));
  if (dup) {
    const name = [...accounts, ...items].find((r) => r.id === dup)?.name;
    return NextResponse.json(
      { error: `${name ?? dup} is listed twice.` },
      { status: 400 }
    );
  }
  const service = createServiceClient();
  try {
    await replaceRows(
      service,
      'billing_account_map',
      'qbo_account_id',
      accounts.map((r) => ({
        qbo_account_id: r.id,
        account_name: r.name,
        stage: r.stage,
      }))
    );
    await replaceRows(
      service,
      'billing_item_map',
      'qbo_item_id',
      items.map((r) => ({
        qbo_item_id: r.id,
        item_name: r.name,
        stage: r.stage,
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
    action: 'billing.mapping.update',
    entityType: 'billing_setting',
    entityId: 'mapping',
    context: { accounts: accounts.length, items: items.length },
  });
  try {
    const { changed } = await reclassifyAll(service);
    const years =
      (await service.from('billing_year_ranges').select('ay_code')).data?.map(
        (r) => r.ay_code as string
      ) ?? [];
    for (const sn of changed) await syncTilesForStudent(service, sn, years);
    return NextResponse.json({ ok: true, studentsAffected: changed.length });
  } catch {
    return NextResponse.json(
      {
        error:
          'The settings were saved, but re-checking the invoices failed. Save again to retry.',
      },
      { status: 500 }
    );
  }
}
