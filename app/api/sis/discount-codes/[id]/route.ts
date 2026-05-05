import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { DiscountCodePatchSchema } from '@/lib/schemas/sis';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/sis/discount-codes/[id]?ay=AY2026&op=expire?
//
// Edits a row in ay{YY}_discount_codes. `?op=expire` flips the audit action
// to sis.discount_code.expire so soft-deletes (endDate = today) show up
// distinctly from arbitrary edits in the audit log.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const url = new URL(request.url);
  const ayCode = (url.searchParams.get('ay') ?? '').trim();
  if (!/^AY\d{4}$/i.test(ayCode)) {
    return NextResponse.json({ error: 'Invalid or missing ay query param' }, { status: 400 });
  }
  const op = (url.searchParams.get('op') ?? '').trim();

  const body = await request.json().catch(() => null);
  const parsed = DiscountCodePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const update = parsed.data;
  const cols = Object.keys(update);
  if (cols.length === 0) {
    return NextResponse.json({ ok: true, changed: 0 });
  }

  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  const table = `${prefix}_discount_codes`;
  const supabase = createServiceClient();

  // Pre-fetch — both for diff and to merge-validate the startDate/endDate
  // ordering across the non-updated half of the pair.
  const selectCols = Array.from(new Set([...cols, 'startDate', 'endDate'])).join(', ');
  const { data: before, error: beforeErr } = await supabase
    .from(table)
    .select(selectCols)
    .eq('id', id)
    .maybeSingle();
  if (beforeErr) {
    console.error('[sis discount-codes PATCH] pre-fetch failed:', beforeErr.message);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: 'Discount code not found in this AY' }, { status: 404 });
  }
  const beforeRow = before as unknown as Record<string, unknown>;

  // Merge-validate start/end ordering (partial schema skips the .refine).
  const mergedStart = (update.startDate ?? beforeRow.startDate) as string | null | undefined;
  const mergedEnd = (update.endDate ?? beforeRow.endDate) as string | null | undefined;
  if (mergedStart && mergedEnd && mergedStart > mergedEnd) {
    return NextResponse.json(
      {
        error: 'Invalid payload',
        details: { fieldErrors: { endDate: ['End date must be on or after start date'] }, formErrors: [] },
      },
      { status: 400 },
    );
  }

  const { error: upErr } = await supabase
    .from(table)
    .update(update)
    .eq('id', id);
  if (upErr) {
    console.error('[sis discount-codes PATCH] update failed:', upErr.message);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
  for (const [col, next] of Object.entries(update)) {
    const prev = beforeRow[col] ?? null;
    if ((prev ?? null) !== (next ?? null)) {
      changes.push({ field: col, from: prev, to: next });
    }
  }

  await logAction({
    service: supabase,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: op === 'expire' ? 'sis.discount_code.expire' : 'sis.discount_code.update',
    entityType: 'discount_code',
    entityId: String(id),
    context: { ay_code: ayCode, changes },
  });

  revalidateTag(`sis:${ayCode}`, 'max');
  return NextResponse.json({ ok: true, changed: changes.length });
}
