import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { AllowanceSchema } from '@/lib/schemas/sis';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';

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
  { params }: { params: Promise<{ enroleeNumber: string }> }
) {
  // Placement and allowances, not the student record — that used to mean
  // `admissions` was deliberately excluded here (KD #51). As of 2026-09-10
  // admissions absorbed the retired p_file_officer role along with Records,
  // and placement came with it, so ENROLMENT_PLACEMENT_WRITERS now equals
  // STUDENT_RECORD_WRITERS (four roles, not three) — see
  // lib/auth/student-record.ts. KD #51 itself (Admissions as its own module)
  // is unaffected; only the "who may place" rule once derived from it
  // changed.
  const auth = await requireRole([...ENROLMENT_PLACEMENT_WRITERS]);
  if ('error' in auth) return auth.error;

  const { enroleeNumber } = await params;

  const body = await request.json().catch(() => null);
  const parsed = AllowanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
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
  if (appErr)
    return NextResponse.json({ error: appErr.message }, { status: 500 });
  if (!app)
    return NextResponse.json({ error: 'enrolee not found' }, { status: 404 });

  type AppRow = { studentNumber: string | null };
  const studentNumber = (app as AppRow).studentNumber;
  if (!studentNumber) {
    return NextResponse.json(
      {
        error:
          'This student has no student ID yet — assign one before setting an allowance.',
      },
      { status: 409 }
    );
  }

  // studentNumber → students.id (grading schema).
  const { data: studentRow, error: studentErr } = await service
    .from('students')
    .select('id, urgent_compassionate_allowance')
    .eq('student_number', studentNumber)
    .maybeSingle();
  if (studentErr)
    return NextResponse.json({ error: studentErr.message }, { status: 500 });
  if (!studentRow) {
    return NextResponse.json(
      {
        error:
          "This student hasn't been synced to the grading roster yet. Run a student sync from the Markbook module first.",
      },
      { status: 404 }
    );
  }

  const before =
    (
      studentRow as {
        id: string;
        urgent_compassionate_allowance: number | null;
      }
    ).urgent_compassionate_allowance ?? 5;
  const studentId = (studentRow as { id: string }).id;

  if (before === allowance) {
    return NextResponse.json({ ok: true, changed: false });
  }

  const { error: updateErr } = await service
    .from('students')
    .update({ urgent_compassionate_allowance: allowance })
    .eq('id', studentId);
  if (updateErr)
    return NextResponse.json({ error: updateErr.message }, { status: 500 });

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
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

  revalidateTag(`sis:${ayCode}`, 'max');
  invalidateDrillTags('records', ayCode);

  return NextResponse.json({ ok: true, changed: true, allowance });
}
