import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import type { Role } from '@/lib/auth/roles';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { loadClassroomAccess } from '@/lib/classroom/queries';
import {
  canManageAnyDisciplineRecord,
  canReadRoster,
} from '@/lib/classroom/scope';
import { updateDisciplineRecord } from '@/lib/discipline/mutations';
import { getDisciplineRecord } from '@/lib/discipline/queries';
import { DisciplineRecordSchema } from '@/lib/schemas/discipline';
import { findStudentByNumber } from '@/lib/sis/records-history';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/classroom/[sectionId]/students/[studentNumber]/discipline/[recordId]
//
// Correcting a filing. Things come out after a record is written — a student's
// account changes, an outcome gets decided — so records are editable rather
// than frozen. Mr Ace, 2026-08-17, on who: "filed it + leadership."
//
// NO SEPARATE HISTORY TABLE. `audit_log` already records who changed what and
// when, and building a second one is the exact mistake the relief-teacher work
// made and then reversed across migrations 112-117.
//
// FOUR CHECKS, in order, and every failure is a 404 except the last:
//
//   1. The caller holds a classroom capability over the section in the URL.
//   2. The student is on THAT section's roster.
//   3. The record actually belongs to that student AND that section — a
//      record id alone must never be enough to reach a record, or the two
//      checks above are decoration.
//   4. The caller filed it, or holds oversight.
//
// Only the fourth answers 403. By that point the caller has proved they may
// see this student and this record, so "you may not edit this" tells them
// nothing they could not already read — and telling them plainly is better
// than a 404 that reads as data loss.

type Ctx = {
  params: Promise<{
    sectionId: string;
    studentNumber: string;
    recordId: string;
  }>;
};

export async function PATCH(
  request: NextRequest,
  { params }: Ctx
): Promise<NextResponse> {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  // `&& auth.error` is not belt-and-braces — see the sibling student-details
  // route for why the bare `'error' in auth` fails to narrow here.
  if ('error' in auth && auth.error) return auth.error;

  const { sectionId, studentNumber, recordId } = await params;
  const { user, role } = auth as {
    user: { id: string; email: string | null };
    role: Role;
  };

  const notFound = () =>
    NextResponse.json({ error: 'not found' }, { status: 404 });

  let step = 'capability';
  try {
    const { capability } = await loadClassroomAccess(role, user.id, sectionId);
    if (!canReadRoster(capability)) return notFound();

    step = 'student lookup';
    const student = await findStudentByNumber(studentNumber);
    if (!student) return notFound();

    step = 'roster check';
    const service = createServiceClient();
    const { data: enrolment, error: rosterError } = await service
      .from('section_students')
      .select('id')
      .eq('section_id', sectionId)
      .eq('student_id', student.studentId)
      .neq('enrollment_status', 'withdrawn')
      .maybeSingle();
    // A FAILED lookup is not an absent student — `maybeSingle()` errors on
    // more than one match, and reading that as "not on this roster" would tell
    // a teacher the child does not exist.
    if (rosterError)
      throw new Error(`section_students: ${rosterError.message}`);
    if (!enrolment) return notFound();

    step = 'record lookup';
    const existing = await getDisciplineRecord(recordId);
    if (!existing) return notFound();
    // The record must belong to the student AND the section in the path.
    // Without this, a teacher could edit any record in the school by pairing
    // its id with their own section and one of their own students.
    if (
      existing.studentId !== student.studentId ||
      existing.sectionId !== sectionId
    ) {
      return notFound();
    }

    step = 'authorise';
    const mayEdit =
      existing.filedBy === user.id || canManageAnyDisciplineRecord(capability);
    if (!mayEdit) {
      return NextResponse.json(
        {
          error:
            'Only the person who filed this record, or a school leader, can change it.',
        },
        { status: 403 }
      );
    }

    step = 'validate';
    const parsed = DisciplineRecordSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            parsed.error.issues[0]?.message ?? 'Check the form and try again.',
        },
        { status: 400 }
      );
    }

    step = 'update';
    const result = await updateDisciplineRecord(
      service,
      recordId,
      user.id,
      parsed.data
    );
    if (!result.ok) {
      console.error('[discipline] update failed:', result.error);
      return NextResponse.json(
        { error: "Couldn't save your changes. Try again." },
        { status: 500 }
      );
    }

    step = 'audit';
    await logAction({
      service,
      actor: { id: user.id, email: user.email ?? null },
      action: 'discipline.record.update',
      entityType: 'student_discipline_record',
      entityId: recordId,
      context: {
        studentNumber,
        student_id: student.studentId,
        section_id: sectionId,
        // Before/after on the fields that classify the record. The narrative
        // (`details`, `remarks`) is deliberately absent on BOTH sides — a
        // diff of it would put the very text migration 120 keeps out of
        // audit_log straight back into audit_log, twice over.
        before: {
          record_type: existing.recordType,
          occurred_on: existing.occurredOn,
          nature: existing.nature,
          // Worth a diff of its own: "a parent acknowledged this letter" is
          // the kind of fact somebody may later need to show they recorded,
          // and when.
          acknowledged_on: existing.acknowledgedOn,
        },
        after: {
          record_type: parsed.data.record_type,
          occurred_on: parsed.data.occurred_on,
          nature: parsed.data.nature,
          acknowledged_on:
            parsed.data.record_type === 'letter'
              ? (parsed.data.acknowledged_on ?? null)
              : null,
        },
        edited_by_filer: existing.filedBy === user.id,
      },
    });

    // Best-effort, and never a reason to fail a write that already landed.
    if (existing.ayCode) invalidateDrillTags('records', existing.ayCode);

    return NextResponse.json({ ok: true, id: recordId });
  } catch (e) {
    console.error(
      `[discipline] edit failed at "${step}" for record ${recordId}:`,
      e instanceof Error ? (e.stack ?? e.message) : e
    );
    return NextResponse.json(
      {
        error: 'lookup failed',
        step,
        // OUTSIDE PRODUCTION ONLY — an exception message can name a table, a
        // column or a constraint.
        ...(process.env.NODE_ENV === 'production'
          ? {}
          : { detail: e instanceof Error ? e.message : String(e) }),
      },
      { status: 500 }
    );
  }
}
