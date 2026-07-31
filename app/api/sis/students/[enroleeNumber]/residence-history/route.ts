import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { STUDENT_RECORD_WRITERS } from '@/lib/auth/student-record';
import { ResidenceHistorySchema } from '@/lib/schemas/sis';
import { createServiceClient } from '@/lib/supabase/service';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';

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
  { params }: { params: Promise<{ enroleeNumber: string }> }
) {
  // Who may write the shared student record — see lib/auth/student-record.ts.
  // school_admin was added 2026-07-31 (KD #173): both pages that render these
  // editors already admitted her, so every save 403'd against a form that had
  // opened for her.
  const auth = await requireRole([...STUDENT_RECORD_WRITERS]);
  if ('error' in auth) return auth.error;

  const { enroleeNumber } = await params;
  if (!enroleeNumber.trim()) {
    return NextResponse.json(
      { error: 'Missing enroleeNumber' },
      { status: 400 }
    );
  }

  const url = new URL(request.url);
  const ayCode = (url.searchParams.get('ay') ?? '').trim();
  if (!/^AY\d{4}$/i.test(ayCode)) {
    return NextResponse.json(
      { error: 'Invalid or missing ay query param' },
      { status: 400 }
    );
  }

  const rawBody = await request.json().catch(() => null);
  if (
    !rawBody ||
    typeof rawBody !== 'object' ||
    !('residenceHistory' in rawBody)
  ) {
    return NextResponse.json(
      { error: 'Missing residenceHistory in body' },
      { status: 400 }
    );
  }
  const parsed = ResidenceHistorySchema.safeParse(
    (rawBody as Record<string, unknown>).residenceHistory
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid residenceHistory', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const next = parsed.data;

  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  const appsTable = `${prefix}_enrolment_applications`;
  const supabase = createServiceClient();

  const { data: before, error: beforeErr } = await supabase
    .from(appsTable)
    .select('residenceHistory')
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (beforeErr) {
    console.error(
      '[sis residence-history PATCH] pre-fetch failed:',
      beforeErr.message
    );
    return NextResponse.json(
      { error: 'Application lookup failed' },
      { status: 500 }
    );
  }
  if (!before) {
    return NextResponse.json(
      { error: 'No application row for this enrolee in this AY' },
      { status: 404 }
    );
  }

  const { error: upErr } = await supabase
    .from(appsTable)
    .update({ residenceHistory: next })
    .eq('enroleeNumber', enroleeNumber);
  if (upErr) {
    console.error(
      '[sis residence-history PATCH] update failed:',
      upErr.message
    );
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
          from:
            (before as { residenceHistory?: unknown }).residenceHistory ?? null,
          to: next,
        },
      ],
    },
  });

  revalidateTag(`sis:${ayCode}`, 'max');
  invalidateDrillTags('admissions', ayCode);
  return NextResponse.json({ ok: true });
}
