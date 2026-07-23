import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { STP_APPLICATION_STATUS_OPTIONS } from '@/lib/sis/queries';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/sis/students/[enroleeNumber]/stp-status?ay=AY2026
//
// Updates `stpApplicationStatus` on `ay{YY}_enrolment_applications`.
// Co-located with `stpApplicationType` — type + status are one logical
// pair, per migration 050's locked decision. Parents file ICA requirements
// directly; the school only tracks which phase the application is in via
// the 4-value enum.
//
// Role: registrar, school_admin, superadmin, admissions.
//
// The CHECK constraint on the column is the canonical guard — the Zod
// schema here mirrors the same enum so we surface a friendly error
// before the DB round-trip.

const StpStatusBodySchema = z.object({
  stpApplicationStatus: z.enum(STP_APPLICATION_STATUS_OPTIONS).nullable(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string }> }
) {
  // Per KD #74: admissions is the operational writer; school_admin is read-only oversight.
  const auth = await requireRole([
    'admissions',
    'academic_coordinator',
    'superadmin',
  ]);
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

  const body = await request.json().catch(() => null);
  const parsed = StpStatusBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Pick one of: Pending / Submitted / Approved / Rejected.',
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }
  const next = parsed.data.stpApplicationStatus;

  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  const admissions = createAdmissionsClient();

  // Pre-image for the audit diff.
  const { data: beforeRow, error: beforeErr } = await admissions
    .from(`${prefix}_enrolment_applications`)
    .select('enroleeNumber, stpApplicationStatus')
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (beforeErr) {
    return NextResponse.json({ error: beforeErr.message }, { status: 500 });
  }
  if (!beforeRow) {
    return NextResponse.json(
      { error: 'No status row for this enrolee in this AY' },
      { status: 404 }
    );
  }
  const before = (beforeRow as { stpApplicationStatus: string | null })
    .stpApplicationStatus;

  if ((before ?? null) === (next ?? null)) {
    return NextResponse.json({ ok: true, changed: false });
  }

  const { error: updateErr } = await admissions
    .from(`${prefix}_enrolment_applications`)
    .update({ stpApplicationStatus: next })
    .eq('enroleeNumber', enroleeNumber);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const service = createServiceClient();
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'sis.stp.update',
    entityType: 'enrolment_application',
    entityId: enroleeNumber,
    context: {
      ay_code: ayCode,
      changes: [{ field: 'stpApplicationStatus', from: before, to: next }],
    },
  });

  revalidateTag(`sis:${ayCode}`, 'max');
  invalidateDrillTags('admissions', ayCode);

  return NextResponse.json({ ok: true, changed: true });
}
