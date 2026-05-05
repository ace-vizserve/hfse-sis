import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { DiscountCodeSchema } from '@/lib/schemas/sis';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/discount-codes?ay=AY2026
//
// Creates a row in ay{YY}_discount_codes. The row id is returned so the
// client can invalidate its list query. Per-student grants are NOT written
// here â€” grants are handled by the external enrolment portal.
export async function POST(request: Request) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const url = new URL(request.url);
  const ayCode = (url.searchParams.get('ay') ?? '').trim();
  if (!/^AY\d{4}$/i.test(ayCode)) {
    return NextResponse.json({ error: 'Invalid or missing ay query param' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = DiscountCodeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  const table = `${prefix}_discount_codes`;
  const supabase = createServiceClient();

  const { data: inserted, error: insErr } = await supabase
    .from(table)
    .insert(parsed.data)
    .select('id')
    .single();

  if (insErr) {
    console.error('[sis discount-codes POST] insert failed:', insErr.message);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  const id = (inserted as { id: number | string }).id;

  await logAction({
    service: supabase,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'sis.discount_code.create',
    entityType: 'discount_code',
    entityId: String(id),
    context: { ay_code: ayCode, values: parsed.data },
  });

  revalidateTag(`sis:${ayCode}`, 'max');
  return NextResponse.json({ ok: true, id });
}
