import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { overlapMessage } from '@/lib/billing/classify';
import { firstDuplicate, isRealDate } from '@/lib/billing/settings-helpers';
import { reclassifyAll, replaceRows } from '@/lib/billing/settings.server';
import { syncTilesForStudent } from '@/lib/billing/tiles.server';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Date10 = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDate, 'That is not a real date.');
const Body = z.object({
  ranges: z
    .array(
      z.object({
        ayCode: z.string().regex(/^AY\d{4}$/),
        startsOn: Date10,
        endsOn: Date10,
      })
    )
    .max(20),
});

// PUT /api/billing/settings/years — the invoice-date range of each academic
// year. Replaces the list, then re-applies it to every stored invoice.
export async function PUT(request: Request) {
  const auth = await requireRole([...QBO_ADMIN_ROLES]);
  if ('error' in auth) return auth.error;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  const { ranges } = parsed.data;
  const overlap = overlapMessage(ranges);
  if (overlap) return NextResponse.json({ error: overlap }, { status: 400 });
  const dup = firstDuplicate(ranges.map((r) => r.ayCode));
  if (dup)
    return NextResponse.json(
      { error: `${dup} is listed twice.` },
      { status: 400 }
    );
  const service = createServiceClient();
  try {
    await replaceRows(
      service,
      'billing_year_ranges',
      'ay_code',
      ranges.map((r) => ({
        ay_code: r.ayCode,
        starts_on: r.startsOn,
        ends_on: r.endsOn,
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
    action: 'billing.years.update',
    entityType: 'billing_setting',
    entityId: 'years',
    context: { ranges },
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
