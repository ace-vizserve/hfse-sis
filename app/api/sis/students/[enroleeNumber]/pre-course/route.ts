import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/sis/students/[enroleeNumber]/pre-course?ay=AY2026
//
// Records the pre-course counselling SESSION DATE (the ICA/CPE acknowledgement
// proof) on ay{YY}_enrolment_applications. A date ⇒ counselled (answer 'Yes');
// clearing ⇒ not-yet (answer + date null). `preCourseAcknowledgedAt` is the
// parent-portal app-confirmation timestamp — never written here; the DATE is the
// proof. Role: operational writers only (KD #74) — school_admin sees the tracker
// but is read-only oversight. Mirrors the stp-status route.

// Accepts 'YYYY-MM-DD' or null; '' → null.
const PreCourseBodySchema = z.object({
  sessionDate: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(''), z.null()])
    .transform((v) => (v ? v : null)),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string }> }
) {
  const auth = await requireRole(['admissions', 'registrar', 'superadmin']);
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
  const parsed = PreCourseBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'sessionDate must be YYYY-MM-DD or null.',
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }
  const date = parsed.data.sessionDate; // string | null
  const nextAnswer = date ? 'Yes' : null;

  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  const admissions = createAdmissionsClient();

  const { data: beforeRow, error: beforeErr } = await admissions
    .from(`${prefix}_enrolment_applications`)
    .select('enroleeNumber, preCourseAnswer, preCourseDate')
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (beforeErr) {
    return NextResponse.json({ error: beforeErr.message }, { status: 500 });
  }
  if (!beforeRow) {
    return NextResponse.json(
      { error: 'No application row for this enrolee in this AY' },
      { status: 404 }
    );
  }
  const before = beforeRow as {
    preCourseAnswer: string | null;
    preCourseDate: string | null;
  };

  if (
    (before.preCourseDate ?? null) === date &&
    (before.preCourseAnswer ?? null) === nextAnswer
  ) {
    return NextResponse.json({ ok: true, changed: false });
  }

  const { error: updateErr } = await admissions
    .from(`${prefix}_enrolment_applications`)
    .update({ preCourseAnswer: nextAnswer, preCourseDate: date })
    .eq('enroleeNumber', enroleeNumber);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const service = createServiceClient();
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'sis.precourse.update',
    entityType: 'enrolment_application',
    entityId: enroleeNumber,
    context: {
      ay_code: ayCode,
      changes: [
        { field: 'preCourseDate', from: before.preCourseDate, to: date },
        {
          field: 'preCourseAnswer',
          from: before.preCourseAnswer,
          to: nextAnswer,
        },
      ],
    },
  });

  revalidateTag(`sis:${ayCode}`, 'max');
  invalidateDrillTags('admissions', ayCode);

  return NextResponse.json({ ok: true, changed: true });
}
