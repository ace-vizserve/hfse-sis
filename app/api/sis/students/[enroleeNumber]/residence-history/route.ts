import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/sis/students/[enroleeNumber]/residence-history?ay=AY2026
//
// Replaces the `residenceHistory` jsonb column on
// `ay{YY}_enrolment_applications`. The body is `{ residenceHistory: <array | null> }`.
// Validation is shape-only (must be a JSON array of object entries) — ICA's
// "past 5 years" expectation is not enforced server-side per
// `docs/context/21-stp-application.md` § Open questions / future work.
//
// Sole writer for this column from the SIS surfaces; the parent portal
// writes here too on initial registration. KD #37 audit pattern.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string }> },
) {
  const auth = await requireRole(['registrar', 'school_admin', 'admin', 'superadmin']);
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

  const body = (await request.json().catch(() => null)) as
    | { residenceHistory?: unknown }
    | null;
  if (!body || !('residenceHistory' in body)) {
    return NextResponse.json({ error: 'Missing residenceHistory in body' }, { status: 400 });
  }
  const next = body.residenceHistory;

  // Allow null (clear) or an array of plain objects. Reject scalars / strings.
  if (next !== null && !Array.isArray(next)) {
    return NextResponse.json(
      { error: 'residenceHistory must be a JSON array or null' },
      { status: 400 },
    );
  }
  if (Array.isArray(next)) {
    for (const entry of next) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return NextResponse.json(
          { error: 'Each residenceHistory entry must be an object' },
          { status: 400 },
        );
      }
    }
  }

  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  const appsTable = `${prefix}_enrolment_applications`;
  const supabase = createServiceClient();

  const { data: before, error: beforeErr } = await supabase
    .from(appsTable)
    .select('residenceHistory')
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (beforeErr) {
    console.error('[sis residence-history PATCH] pre-fetch failed:', beforeErr.message);
    return NextResponse.json({ error: 'Application lookup failed' }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json(
      { error: 'No application row for this enrolee in this AY' },
      { status: 404 },
    );
  }

  const { error: upErr } = await supabase
    .from(appsTable)
    .update({ residenceHistory: next })
    .eq('enroleeNumber', enroleeNumber);
  if (upErr) {
    console.error('[sis residence-history PATCH] update failed:', upErr.message);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  await logAction({
    service: supabase,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'sis.profile.update',
    entityType: 'enrolment_application',
    entityId: enroleeNumber,
    context: {
      ay_code: ayCode,
      changes: [
        {
          field: 'residenceHistory',
          from: (before as { residenceHistory?: unknown }).residenceHistory ?? null,
          to: next,
        },
      ],
    },
  });

  revalidateTag(`sis:${ayCode}`, 'max');
  return NextResponse.json({ ok: true });
}
