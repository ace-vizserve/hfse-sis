import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';

import { requireCurrentAyCode } from '@/lib/academic-year';
import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { VlAllowanceSchema } from '@/lib/schemas/sis';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/sis/students/[enroleeNumber]/vl-allowance  (KD #94)
//
// Body: { vlAllowance: number | null }   (0–10, or null to clear override)
//
// Updates `students.vacation_leave_allowance_per_term`. NULL means "use the
// school-wide default" from `school_config.default_vl_allowance_per_term`.
// Cross-schema (mirrors /allowance) — resolves enroleeNumber → studentNumber
// → students.id then updates the grading-schema column.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ enroleeNumber: string }> }
) {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { enroleeNumber } = await params;

  const body = await request.json().catch(() => null);
  const parsed = VlAllowanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { vlAllowance } = parsed.data;

  const service = createServiceClient();
  const admissions = createAdmissionsClient();
  const ayCode = await requireCurrentAyCode(service);
  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;

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

  const { data: studentRow, error: studentErr } = await service
    .from('students')
    .select('id, vacation_leave_allowance_per_term')
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

  const row = studentRow as {
    id: string;
    vacation_leave_allowance_per_term: number | null;
  };
  const before = row.vacation_leave_allowance_per_term;
  const studentId = row.id;

  if (before === vlAllowance) {
    return NextResponse.json({ ok: true, changed: false });
  }

  const { error: updateErr } = await service
    .from('students')
    .update({ vacation_leave_allowance_per_term: vlAllowance })
    .eq('id', studentId);
  if (updateErr)
    return NextResponse.json({ error: updateErr.message }, { status: 500 });

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'sis.vl_allowance.update',
    entityType: 'enrolment_application',
    entityId: enroleeNumber,
    context: {
      enroleeNumber,
      studentNumber,
      student_id: studentId,
      before,
      after: vlAllowance,
    },
  });

  revalidateTag(`sis:${ayCode}`, 'max');
  invalidateDrillTags('attendance', ayCode);

  return NextResponse.json({ ok: true, changed: true, vlAllowance });
}
