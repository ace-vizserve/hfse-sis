import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { ENROLMENT_PLACEMENT_WRITERS } from '@/lib/auth/student-record';
import { transferStudentSection } from '@/lib/sis/section-transfer';
import { createServiceClient } from '@/lib/supabase/service';
import { invalidateAllOperationalDrills } from '@/lib/cache/invalidate-drill-tags';

// POST /api/sis/students/[enroleeNumber]/transfer-section?ay=AY2026
//
// Atomic move of an enrolled student from one section to another (Hard
// Rule #6: section_students append-only — withdraw old + insert new).
// Replaces the silent dual-section bug in the stage PATCH path: the
// existing class-stage route now rejects post-Enrolled classSection
// changes and points callers here.
//
// Audit: writes one `student.section.transfer` row with the from/to
// context + term + transfer date so the Records detail page can render
// the section history timeline (KD #9).
const TransferBodySchema = z.object({
  targetSectionId: z.string().uuid(),
  // Opt-in level correction — see `allowLevelChange` in section-transfer.ts.
  allowLevelChange: z.boolean().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string }> }
) {
  // Placement, not the student record — that used to mean `admissions` was
  // deliberately excluded here (KD #51). As of 2026-09-10 admissions
  // absorbed the retired p_file_officer role along with Records, and
  // placement came with it, so ENROLMENT_PLACEMENT_WRITERS now equals
  // STUDENT_RECORD_WRITERS (four roles, not three) — see
  // lib/auth/student-record.ts. KD #51 itself (Admissions as its own module)
  // is unaffected; only the "who may place" rule once derived from it
  // changed.
  const auth = await requireRole([...ENROLMENT_PLACEMENT_WRITERS]);
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
  const parsed = TransferBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const result = await transferStudentSection(supabase, {
    ayCode,
    enroleeNumber,
    targetSectionId: parsed.data.targetSectionId,
    actorEmail: auth.user.email ?? null,
    allowLevelChange: parsed.data.allowLevelChange === true,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }

  await logAction({
    service: supabase,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'student.section.transfer',
    // The id IS an enrolee number, and every reader finds these rows by it
    // (lib/sis/section-history.ts, lib/sis/movements.ts, the classroom
    // timeline). The type used to say `section_student`, which names a uuid
    // this row never carried; `enrolment_status` is what the other
    // enrolee-number-keyed placement row (assign_section) already uses.
    entityType: 'enrolment_status',
    entityId: enroleeNumber,
    context: {
      ay_code: ayCode,
      enroleeNumber,
      studentNumber: result.studentNumber,
      ...(result.studentName ? { studentName: result.studentName } : {}),
      fromSection: result.fromSection,
      fromLevel: result.fromLevel,
      toSection: result.toSection,
      toLevel: result.toLevel,
      targetSectionId: parsed.data.targetSectionId,
      transferDate: result.transferDate,
      termNumber: result.term?.termNumber ?? null,
      termLabel: result.term?.termLabel ?? null,
      from_section_student_id: result.sourceEnrolmentId,
      from_index_number: result.sourceIndexNumber,
      // The source row is left withdrawn, dated the transfer day (migration
      // 168 explains why that date is kept, not blanked).
      from_withdrawal_date: result.sourceWithdrawalDate,
      to_section_student_id: result.targetEnrolmentId,
      to_index_number: result.targetIndexNumber,
      returned_to_previous_section: result.reusedEnrolment,
      // A return reuses the row the student left behind and clears its old
      // withdrawal. Those values exist nowhere else afterwards.
      ...(result.targetPrior
        ? { to_section_prior_withdrawal: result.targetPrior }
        : {}),
      ...(result.admissionsMirrorError
        ? {
            partial: true,
            failed_step: 'admissions_class_mirror',
            admissionsMirrorError: result.admissionsMirrorError,
          }
        : {}),
    },
  });

  revalidateTag(`sis:${ayCode}`, 'max');
  invalidateAllOperationalDrills(ayCode);

  return NextResponse.json({
    ok: true,
    fromSection: result.fromSection,
    toSection: result.toSection,
    toLevel: result.toLevel,
    transferDate: result.transferDate,
    term: result.term,
    // The move committed; only the admissions copy of the class is stale.
    admissionsMirrorFailed: result.admissionsMirrorError !== null,
  });
}
