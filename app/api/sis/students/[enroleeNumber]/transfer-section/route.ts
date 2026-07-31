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
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string }> }
) {
  // Placement, not the student record — `admissions` is deliberately excluded
  // (KD #51). Same three roles as before; see lib/auth/student-record.ts.
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
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }

  await logAction({
    service: supabase,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'student.section.transfer',
    entityType: 'section_student',
    entityId: enroleeNumber,
    context: {
      ay_code: ayCode,
      enroleeNumber,
      studentNumber: result.studentNumber,
      fromSection: result.fromSection,
      fromLevel: result.fromLevel,
      toSection: result.toSection,
      toLevel: result.toLevel,
      targetSectionId: parsed.data.targetSectionId,
      transferDate: result.transferDate,
      termNumber: result.term?.termNumber ?? null,
      termLabel: result.term?.termLabel ?? null,
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
  });
}
