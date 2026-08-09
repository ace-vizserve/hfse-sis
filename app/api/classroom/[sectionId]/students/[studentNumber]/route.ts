import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import type { Role } from '@/lib/auth/roles';
import { loadClassroomAccess } from '@/lib/classroom/queries';
import { canReadRoster } from '@/lib/classroom/scope';
import { buildStudentDetails } from '@/lib/classroom/student-details';
import { loadStudentDetailsSource } from '@/lib/classroom/student-details-source';
import { findStudentByNumber } from '@/lib/sis/records-history';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/classroom/[sectionId]/students/[studentNumber]
//
// The medical, learning-needs and home-contact detail behind the Classroom
// roster's "View details" drawer. Asked for at the 2026-07-31 academics
// training by Christina (16:08), Melissa (21:53) and Chandana (22:36) — three
// people, one feature. The data has always existed on the admissions record;
// what did not exist was any way for a teacher to reach it, since /records is
// coordinator-and-above (KD #174).
//
// AUTHORISATION IS THE SECTION, TWICE OVER.
//
//   1. The caller must hold a classroom capability over the section in the URL
//      — the same `loadClassroomAccess` every other Classroom surface uses, so
//      this cannot drift from what the roster itself allows.
//   2. The student must be on THAT section's roster.
//
// The second check is the load-bearing one. Without it a teacher could pair
// their own section id with any student number and read that child's medical
// record, and student numbers are sequential enough to walk. With it, no
// "does this teacher teach this student" resolver is needed at all: the
// section answers both questions.
//
// Every failure is a 404, never a 403. "You may not read this student" and
// "there is no such student here" are the same sentence to a caller who should
// not be asking, and distinguishing them would confirm that a student number
// exists.
//
// `canReadRoster` — not `canReadAttendance` — is the bar on purpose. A subject
// teacher sees this, because Melissa asked for it as a subject teacher: "for us
// teachers, it's very important for us to know if a student has the learning
// difficulties... or allergies."
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sectionId: string; studentNumber: string }> }
): Promise<NextResponse> {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  // `&& auth.error` is not belt-and-braces. `requireRole` returns two object
  // literals, so TypeScript infers ONE type carrying both shapes with the
  // absent halves optional — and `in` cannot narrow a property that exists on
  // both members. Every route in this codebase writes the bare `'error' in
  // auth`, and every one of them is silently typed `NextResponse | undefined`
  // as a result; the only reason it shows up here is the explicit return type
  // above. Checking the value narrows it properly.
  if ('error' in auth && auth.error) return auth.error;

  const { sectionId, studentNumber } = await params;
  const { user, role } = auth as { user: { id: string }; role: Role };

  // NAMED STEPS, because an unhandled throw here is an opaque 500 to the
  // teacher and an anonymous stack in the server log — which is exactly how
  // the first live failure of this route was reported: a screenshot reading
  // "could not be loaded", with nothing on either side saying where it broke.
  let step = 'capability';
  try {
    const { capability } = await loadClassroomAccess(role, user.id, sectionId);
    if (!canReadRoster(capability)) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    step = 'student lookup';
    const student = await findStudentByNumber(studentNumber);
    if (!student) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    // Withdrawn students stay on `section_students` (Hard Rule #6) but are not
    // part of the day-to-day class, and the roster the drawer opens from
    // already excludes them — so the two surfaces agree.
    step = 'roster check';
    const service = createServiceClient();
    const { data: enrolment, error: rosterError } = await service
      .from('section_students')
      .select('id')
      .eq('section_id', sectionId)
      .eq('student_id', student.studentId)
      .neq('enrollment_status', 'withdrawn')
      .maybeSingle();

    // A FAILED lookup is not an absent student. `maybeSingle()` errors when
    // more than one row matches — which happens the moment a student holds two
    // non-withdrawn rows for one section — and reading that as "not on this
    // roster" would send a teacher to the office over a duplicate row.
    if (rosterError)
      throw new Error(`section_students: ${rosterError.message}`);
    if (!enrolment) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    step = 'admissions row';
    const source = await loadStudentDetailsSource(studentNumber);
    return NextResponse.json(buildStudentDetails(source));
  } catch (e) {
    console.error(
      `[classroom] student details failed at "${step}" for ${studentNumber} in section ${sectionId}:`,
      e instanceof Error ? (e.stack ?? e.message) : e
    );
    return NextResponse.json(
      {
        error: 'lookup failed',
        step,
        // OUTSIDE PRODUCTION ONLY. An exception message can name a table, a
        // column or a constraint, and none of that belongs in a response a
        // browser can read on a live system. In development it turns a
        // screenshot of the drawer into the stack's first line, which is the
        // difference between fixing this in one click and asking someone to
        // go and read their terminal.
        ...(process.env.NODE_ENV === 'production'
          ? {}
          : { detail: e instanceof Error ? e.message : String(e) }),
      },
      { status: 500 }
    );
  }
}
