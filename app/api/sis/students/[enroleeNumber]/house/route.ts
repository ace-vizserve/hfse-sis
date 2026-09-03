import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';

import { requireCurrentAyCode } from '@/lib/academic-year';
import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { HouseAssignmentSchema } from '@/lib/schemas/sis';
import { listHouses } from '@/lib/sis/houses';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/sis/students/[enroleeNumber]/house  (migration 110)
//
// Body: { houseId: string | null }   (null clears the assignment)
//
// Sets `students.house_id`. Deliberately the same cross-schema shape as
// /vl-allowance and /allowance: resolve enroleeNumber -> studentNumber ->
// students.id, then write the grading-schema column.
//
// Gated on ENROLMENT_PLACEMENT_WRITERS rather than STUDENT_RECORD_WRITERS: a
// house is a placement decision the school makes, not an application field, so
// `admissions` is excluded (KD #51) exactly as it is for section transfers.
//
// The house lives on the cross-AY `students` row on purpose — see migration
// 110's header. A student keeps their house for their whole time at school.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ enroleeNumber: string }> }
) {
  const auth = await requireRole([...ENROLMENT_PLACEMENT_WRITERS]);
  if ('error' in auth) return auth.error;

  const { enroleeNumber } = await params;

  const body = await request.json().catch(() => null);
  const parsed = HouseAssignmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { houseId } = parsed.data;

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
          'This student has no student ID yet — assign one before setting a house.',
      },
      { status: 409 }
    );
  }

  const { data: studentRow, error: studentErr } = await service
    .from('students')
    .select('id, house_id')
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

  const row = studentRow as { id: string; house_id: string | null };
  const before = row.house_id;
  const studentId = row.id;

  if (before === houseId) {
    return NextResponse.json({ ok: true, changed: false });
  }

  // One read serves two purposes: reject an unknown id with a readable message
  // rather than letting the FK raise, and resolve both sides to NAMES for the
  // audit row. A trail reading "House 2 -> House 3" is worth a query; one
  // reading "8f3a... -> c91b..." is not.
  const houses = await listHouses();
  const nameById = new Map(houses.map((h) => [h.id, h.name]));
  if (houseId != null && !nameById.has(houseId)) {
    return NextResponse.json({ error: 'house not found' }, { status: 404 });
  }

  const { error: updateErr } = await service
    .from('students')
    .update({ house_id: houseId })
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
    action: 'sis.house.update',
    entityType: 'enrolment_application',
    entityId: enroleeNumber,
    context: {
      enroleeNumber,
      studentNumber,
      student_id: studentId,
      before,
      after: houseId,
      // Names, not just ids — the audit log is read by people.
      before_name: before == null ? null : (nameById.get(before) ?? null),
      after_name: houseId == null ? null : (nameById.get(houseId) ?? null),
    },
  });

  // Without these the students list serves a stale house for up to 10 minutes
  // (the sis tag's TTL) — the same pairing every sibling route uses.
  revalidateTag(`sis:${ayCode}`, 'max');
  invalidateDrillTags('records', ayCode);

  return NextResponse.json({ ok: true, changed: true, houseId });
}
