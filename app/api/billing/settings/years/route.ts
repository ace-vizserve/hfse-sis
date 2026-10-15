import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { overlapMessage } from '@/lib/billing/classify';
import { reclassifyAll } from '@/lib/billing/settings.server';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Date10 = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
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
  const service = createServiceClient();
  const del = await service
    .from('billing_year_ranges')
    .delete()
    .neq('ay_code', '');
  if (del.error)
    return NextResponse.json({ error: del.error.message }, { status: 500 });
  if (ranges.length) {
    const ins = await service.from('billing_year_ranges').insert(
      ranges.map((r) => ({
        ay_code: r.ayCode,
        starts_on: r.startsOn,
        ends_on: r.endsOn,
      }))
    );
    if (ins.error)
      return NextResponse.json({ error: ins.error.message }, { status: 500 });
  }
  const { changed } = await reclassifyAll(service);
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    action: 'billing.years.update',
    entityType: 'billing_setting',
    entityId: 'years',
    context: { ranges, students_affected: changed.length },
  });
  return NextResponse.json({ ok: true, studentsAffected: changed.length });
}
