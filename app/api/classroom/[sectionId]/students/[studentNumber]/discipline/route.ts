import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import type { Role } from '@/lib/auth/roles';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { loadClassroomAccess } from '@/lib/classroom/queries';
import { canReadRoster } from '@/lib/classroom/scope';
import { createDisciplineRecord } from '@/lib/discipline/mutations';
import { listDisciplineForStudent } from '@/lib/discipline/queries';
import { DisciplineRecordSchema } from '@/lib/schemas/discipline';
import { findStudentByNumber } from '@/lib/sis/records-history';
import { createServiceClient } from '@/lib/supabase/service';

// GET  /api/classroom/[sectionId]/students/[studentNumber]/discipline
// POST /api/classroom/[sectionId]/students/[studentNumber]/discipline
//
// A student's disciplinary record, and the way a staff member files one.
// Action item #7 from the 2026-07-31 academics training — Christina, 18:20:
// "if we click the name of the student, I was hoping we can also find those
// incidents that the student was involved in for the whole year."
//
// FILING IS OPEN TO ANY STAFF MEMBER, and that is the school's rule, not a
// shortcut. Chandana, 2026-08-14: "Incident reports are filed by the person in
// charge who is present at the venue of incident." Filing is a circumstance,
// not a role — so there is no capability to hold and nothing to grant.
//
// AUTHORISATION IS THE SECTION, TWICE OVER — the same two checks as the
// sibling student-details route, deliberately spelled the same way so the two
// cannot drift:
//
//   1. The caller holds a classroom capability over the section in the URL.
//   2. The student is on THAT section's roster.
//
// The second is load-bearing. Without it a teacher could pair their own
// section id with any student number and read — or write — another child's
// behavioural record, and student numbers are sequential enough to walk.
//
// `canReadRoster`, not `canReadAttendance`, is the bar: a subject teacher who
// was in the room when something happened is exactly the person the school
// says files it.
//
// Every authorisation failure is a 404, never a 403, for the same reason as
// the details route: "you may not read this student" and "there is no such
// student here" are one sentence to a caller who should not be asking.

type Ctx = { params: Promise<{ sectionId: string; studentNumber: string }> };

/**
 * Both halves of this route need the same two answers — may this caller reach
 * this student through this section, and which enrolment is it. Resolved once
 * so GET and POST cannot diverge on who is allowed.
 */
async function resolveAccess(
  sectionId: string,
  studentNumber: string,
  role: Role,
  userId: string
): Promise<
  | { ok: true; studentId: string; studentName: string | null }
  | { ok: false; response: NextResponse; step: string }
> {
  const notFound = (step: string) => ({
    ok: false as const,
    response: NextResponse.json({ error: 'not found' }, { status: 404 }),
    step,
  });

  const { capability } = await loadClassroomAccess(role, userId, sectionId);
  if (!canReadRoster(capability)) return notFound('capability');

  const student = await findStudentByNumber(studentNumber);
  if (!student) return notFound('student lookup');

  // Withdrawn students stay on `section_students` (Hard Rule #6) but are not
  // part of the day-to-day class, and the roster this opens from already
  // excludes them — so the two surfaces agree.
  const service = createServiceClient();
  const { data: enrolment, error: rosterError } = await service
    .from('section_students')
    .select('id')
    .eq('section_id', sectionId)
    .eq('student_id', student.studentId)
    .neq('enrollment_status', 'withdrawn')
    .maybeSingle();

  // A FAILED lookup is not an absent student. `maybeSingle()` errors when more
  // than one row matches, and reading that as "not on this roster" would turn
  // a duplicate row into a teacher being told the child does not exist.
  if (rosterError) throw new Error(`section_students: ${rosterError.message}`);
  if (!enrolment) return notFound('roster check');

  return {
    ok: true,
    studentId: student.studentId,
    studentName:
      [student.firstName, student.lastName]
        .map((p) => p?.trim())
        .filter(Boolean)
        .join(' ') || null,
  };
}

// NAMED STEPS on the error path, because an unhandled throw here is an opaque
// 500 to the person filing and an anonymous stack in the log — which is how
// the sibling route's first live failure was reported: a screenshot reading
// "could not be loaded", with nothing on either side saying where it broke.
function failure(step: string, e: unknown, what: string): NextResponse {
  console.error(
    `[discipline] ${what} failed at "${step}":`,
    e instanceof Error ? (e.stack ?? e.message) : e
  );
  return NextResponse.json(
    {
      error: 'lookup failed',
      step,
      // OUTSIDE PRODUCTION ONLY. An exception message can name a table, a
      // column or a constraint, and none of that belongs in a response a
      // browser can read on a live system.
      ...(process.env.NODE_ENV === 'production'
        ? {}
        : { detail: e instanceof Error ? e.message : String(e) }),
    },
    { status: 500 }
  );
}

export async function GET(
  _request: NextRequest,
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

  const { sectionId, studentNumber } = await params;
  const { user, role } = auth as { user: { id: string }; role: Role };

  let step = 'access';
  try {
    const access = await resolveAccess(sectionId, studentNumber, role, user.id);
    if (!access.ok) return access.response;

    step = 'read';
    // Cross-year on purpose. `studentNumber` is the stable id (Hard Rule #4)
    // and a child's history does not restart in August; the surface decides
    // how much of it to show.
    const records = await listDisciplineForStudent(access.studentId);
    return NextResponse.json({ records });
  } catch (e) {
    return failure(step, e, `read for ${studentNumber}`);
  }
}

export async function POST(
  request: NextRequest,
  { params }: Ctx
): Promise<NextResponse> {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth && auth.error) return auth.error;

  const { sectionId, studentNumber } = await params;
  const { user, role } = auth as {
    user: { id: string; email: string | null };
    role: Role;
  };

  let step = 'access';
  try {
    const access = await resolveAccess(sectionId, studentNumber, role, user.id);
    if (!access.ok) return access.response;

    step = 'validate';
    const parsed = DisciplineRecordSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      // The schema carries admin-facing wording on every field, so the first
      // issue is already a sentence worth showing.
      return NextResponse.json(
        {
          error:
            parsed.error.issues[0]?.message ?? 'Check the form and try again.',
        },
        { status: 400 }
      );
    }

    step = 'academic year';
    const service = createServiceClient();
    // Taken from the SECTION, never from the request or from "what year is it
    // now". A class belongs to exactly one academic year, so this is the one
    // answer that cannot disagree with the section the record is filed under.
    const { data: section, error: sectionError } = await service
      .from('sections')
      .select('academic_year_id, academic_year:academic_years(ay_code)')
      .eq('id', sectionId)
      .maybeSingle();
    if (sectionError) throw new Error(`sections: ${sectionError.message}`);
    if (!section)
      return NextResponse.json({ error: 'not found' }, { status: 404 });

    const row = section as {
      academic_year_id: string;
      academic_year: { ay_code: string } | { ay_code: string }[] | null;
    };
    const ayRel = row.academic_year;
    const ayCode =
      (Array.isArray(ayRel) ? ayRel[0]?.ay_code : ayRel?.ay_code) ?? null;

    step = 'insert';
    const result = await createDisciplineRecord(
      service,
      {
        studentId: access.studentId,
        sectionId,
        academicYearId: row.academic_year_id,
      },
      user.id,
      parsed.data
    );
    if (!result.ok) {
      console.error('[discipline] insert failed:', result.error);
      return NextResponse.json(
        { error: "Couldn't save this record. Try again." },
        { status: 500 }
      );
    }

    step = 'audit';
    await logAction({
      service,
      actor: { id: user.id, email: user.email ?? null, role },
      action: 'discipline.record.file',
      entityType: 'student_discipline_record',
      entityId: result.id,
      context: {
        studentNumber,
        student_id: access.studentId,
        student_name: access.studentName,
        section_id: sectionId,
        record_type: parsed.data.record_type,
        occurred_on: parsed.data.occurred_on,
        nature: parsed.data.nature,
        // Whether a link was given, never the link. A SharePoint or Drive URL
        // routinely carries a sharing token in its query string, and audit_log
        // is append-only and readable by every coordinator and above — so
        // logging the value would put a credential somewhere it can never be
        // taken back out of. Same shape as `ex_note_present` on the attendance
        // route.
        document_url_present: Boolean(parsed.data.document_url),
        // `details` and `remarks` are DELIBERATELY absent. audit_log is
        // append-only and readable by every coordinator and above, so a
        // child's behavioural narrative typed in error would be permanent and
        // widely visible. Same PRIVACY line as attendance `ex_note`
        // (migration 109) and classroom notes. The record itself is where the
        // story is read.
      },
    });

    // Best-effort, and never a reason to fail a write that already landed.
    if (ayCode) invalidateDrillTags('records', ayCode);

    return NextResponse.json({ ok: true, id: result.id }, { status: 201 });
  } catch (e) {
    return failure(step, e, `filing for ${studentNumber}`);
  }
}
