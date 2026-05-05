import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { AllowanceSchema } from '@/lib/schemas/sis';
import { requireCurrentAyCode } from '@/lib/academic-year';

// PATCH /api/sis/students/[enroleeNumber]/allowance
//
// Body: { allowance: number }  (integer 0–30)
//
// Cross-schema route: resolves the enroleeNumber (admissions) → studentNumber
// → students.id (grading schema) → updates `urgent_compassionate_allowance`.
// This is the only grading-schema write that lives under the SIS API prefix —
// put here because the caller always holds an enroleeNumber (Records context),
// not a studentNumber.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ enroleeNumber: string }> },
) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { enroleeNumber } = await params;

  const body = await request.json().catch(() => null);
  const parsed = AllowanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { allowance } = parsed.data;

  const service = createServiceClient();
  const admissions = createAdmissionsClient();
  const ayCode = await requireCurrentAyCode(service);
  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;

  // enroleeNumber → studentNumber via admissions applications.
  const { data: app, error: appErr } = await admissions
    .from(`${prefix}_enrolment_applications`)
    .select('studentNumber')
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (appErr) return NextResponse.json({ error: appErr.message }, { status: 500 });
  if (!app) return NextResponse.json({ error: 'enrolee not found' }, { status: 404 });

  type AppRow = { studentNumber: string | null };
  const studentNumber = (app as AppRow).studentNumber;
  if (!studentNumber) {
    return NextResponse.json(
      { error: 'enrolee has no studentNumber yet — assign one before setting allowance' },
      { status: 409 },
    );
  }

  // studentNumber → students.id (grading schema).
  const { data: studentRow, error: studentErr } = await service
    .from('students')
    .select('id, urgent_compassionate_allowance')
    .eq('student_number', studentNumber)
    .maybeSingle();
  if (studentErr) return NextResponse.json({ error: studentErr.message }, { status: 500 });
  if (!studentRow) {
    return NextResponse.json(
      { error: 'student not synced to grading schema — run /markbook/sync-students first' },
      { status: 404 },
    );
  }

  const before = (studentRow as { id: string; urgent_compassionate_allowance: number | null })
    .urgent_compassionate_allowance ?? 5;
  const studentId = (studentRow as { id: string }).id;

  if (before === allowance) {
    return NextResponse.json({ ok: true, changed: false });
  }

  const { error: updateErr } = await service
    .from('students')
    .update({ urgent_compassionate_allowance: allowance })
    .eq('id', studentId);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'sis.allowance.update',
    entityType: 'enrolment_application',
    entityId: enroleeNumber,
    context: {
      enroleeNumber,
      studentNumber,
      student_id: studentId,
      before,
      after: allowance,
    },
  });

  return NextResponse.json({ ok: true, changed: true, allowance });
}
