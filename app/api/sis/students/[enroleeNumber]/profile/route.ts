import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { ProfileUpdateSchema, type ProfileUpdateInput } from '@/lib/schemas/sis';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/sis/students/[enroleeNumber]/profile?ay=AY2026
//
// Updates demographic / preference fields on ay{YY}_enrolment_applications.
// Stable IDs (enroleeNumber, studentNumber) are not in the schema and would
// be rejected if sent. Audit-logged with a per-field diff.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string }> },
) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { enroleeNumber } = await params;
  if (!enroleeNumber.trim()) {
    return NextResponse.json({ error: 'Missing enroleeNumber' }, { status: 400 });
  }

  const url = new URL(request.url);
  const ayCode = (url.searchParams.get('ay') ?? '').trim();
  if (!/^AY\d{4}$/i.test(ayCode)) {
    return NextResponse.json({ error: 'Invalid or missing ay query param' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = ProfileUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const update = parsed.data as ProfileUpdateInput;

  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  const appsTable = `${prefix}_enrolment_applications`;
  const supabase = createServiceClient();

  // Pre-fetch only the columns we're about to write so we can diff for audit.
  const cols = Object.keys(update);
  if (cols.length === 0) {
    return NextResponse.json({ ok: true, changed: 0 });
  }
  const { data: before, error: beforeErr } = await supabase
    .from(appsTable)
    .select(cols.join(', '))
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (beforeErr) {
    console.error('[sis profile PATCH] pre-fetch failed:', beforeErr.message);
    return NextResponse.json({ error: 'Application lookup failed' }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: 'No application row for this enrolee in this AY' }, { status: 404 });
  }

  const { error: upErr } = await supabase
    .from(appsTable)
    .update(update)
    .eq('enroleeNumber', enroleeNumber);
  if (upErr) {
    console.error('[sis profile PATCH] update failed:', upErr.message);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const beforeRow = before as unknown as Record<string, unknown>;
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
    action: 'sis.profile.update',
    entityType: 'enrolment_application',
    entityId: enroleeNumber,
    context: { ay_code: ayCode, changes },
  });

  revalidateTag(`sis:${ayCode}`, 'max');
  return NextResponse.json({ ok: true, changed: changes.length });
}
