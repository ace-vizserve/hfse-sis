import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { STUDENT_RECORD_WRITERS } from '@/lib/auth/student-record';
import { loadApplicationFit } from '@/lib/admissions/options-loader';
import { listAssignableSections } from '@/lib/sis/class-assignment';
import { createServiceClient } from '@/lib/supabase/service';
import { createAdmissionsClient } from '@/lib/supabase/admissions';

// GET /api/sis/students/[enroleeNumber]/assignable-sections?ay=AY2026
//
// Feeds the section picker rendered inline in EditStageDialog when a
// registrar is about to flip the application stage to Enrolled. Resolves
// the applicant's current levelApplied server-side so the client only
// needs enroleeNumber + ay, matching the same lookup shape as
// assign-section's existing route.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string }> }
) {
  // Who may write the shared student record — see lib/auth/student-record.ts.
  // school_admin was added 2026-07-31 (KD #173): both pages that render these
  // editors already admitted her, so every save 403'd against a form that had
  // opened for her.
  const auth = await requireRole([...STUDENT_RECORD_WRITERS]);
  if ('error' in auth) return auth.error;

  const { enroleeNumber } = await params;
  const url = new URL(request.url);
  const ayCode = (url.searchParams.get('ay') ?? '').trim();
  if (!/^AY\d{4}$/i.test(ayCode)) {
    return NextResponse.json(
      { error: 'Invalid or missing ay query param' },
      { status: 400 }
    );
  }

  const admissions = createAdmissionsClient();
  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  const { data: appRow, error: appErr } = await admissions
    .from(`${prefix}_enrolment_applications`)
    .select('levelApplied, studentNumber')
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (appErr) {
    return NextResponse.json({ error: appErr.message }, { status: 500 });
  }
  const app = appRow as {
    levelApplied: string | null;
    studentNumber: string | null;
  } | null;
  const levelApplied = app?.levelApplied ?? null;

  // What the parent asked for — class type and session — read apart from the
  // select above and allowed to fail: `classType` is a later portal column
  // (MINIMAL_APP_COLUMNS in lib/sis/queries.ts), and a legacy AY missing it
  // must cost only the "Matches their application" hint, not the picker.
  const { data: prefsRow } = await admissions
    .from(`${prefix}_enrolment_applications`)
    .select('classType, preferredSchedule')
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  const prefs = (prefsRow ?? null) as {
    classType: unknown;
    preferredSchedule: unknown;
  } | null;

  const service = createServiceClient();
  const [result, applicationFit] = await Promise.all([
    listAssignableSections(service, ayCode, levelApplied),
    loadApplicationFit(service, ayCode, {
      levelApplied,
      classType: typeof prefs?.classType === 'string' ? prefs.classType : null,
      preferredSchedule:
        typeof prefs?.preferredSchedule === 'string'
          ? prefs.preferredSchedule
          : null,
    }),
  ]);

  // IS THIS STUDENT ALREADY IN A CLASS?
  //
  // Mr Ace, 2026-09-16: the picker "still show even if the student has a
  // assigned class already". It was gated on stage, status, permission and
  // prerequisites — every question except the one that decides whether
  // assigning a class is a thing left to do.
  //
  // Answered HERE rather than passed in by the caller: the roster is the only
  // place that knows, and a prop threaded down from a page would be a second
  // opinion that can go stale between the page render and the dialog opening.
  const currentSection = await findCurrentPlacement(
    service,
    ayCode,
    app?.studentNumber ?? null
  );

  const hasAttendance = await hasAttendanceThisAy(
    service,
    ayCode,
    app?.studentNumber ?? null
  );

  return NextResponse.json({
    ...result,
    applicationFit,
    currentSection,
    hasAttendance,
  });
}

/**
 * Has this student been marked present or absent in this academic year?
 *
 * ⚠ ANSWERED HERE so the withdrawal form can stop demanding "the last day
 * they actually attended" from a student who has never attended. A class row
 * is not attendance: YS Youngstarters hold 15 class rows and zero marks, and
 * they were the only students tripping that requirement. The server gate
 * (lib/sis/withdrawal-cascade.ts) makes the same distinction; this is the read
 * that lets the FORM agree with it instead of asking first and being refused.
 *
 * Returns null when it cannot tell, which the dialog treats as "assume they
 * attended" — the same fail-closed direction as the server.
 */
async function hasAttendanceThisAy(
  service: ReturnType<typeof createServiceClient>,
  ayCode: string,
  studentNumber: string | null
): Promise<boolean | null> {
  if (!studentNumber) return false;

  const [studentRes, ayRes] = await Promise.all([
    service
      .from('students')
      .select('id')
      .eq('student_number', studentNumber)
      .maybeSingle(),
    service
      .from('academic_years')
      .select('id')
      .eq('ay_code', ayCode)
      .maybeSingle(),
  ]);
  const studentId = (studentRes.data as { id: string } | null)?.id ?? null;
  const ayId = (ayRes.data as { id: string } | null)?.id ?? null;
  if (!studentId || !ayId) return false;

  const { data: rows, error: rowsErr } = await service
    .from('section_students')
    .select('id, section:sections!inner(academic_year_id)')
    .eq('student_id', studentId)
    .eq('sections.academic_year_id', ayId);
  if (rowsErr) return null;
  const ids = ((rows ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (ids.length === 0) return false;

  const { count, error } = await service
    .from('attendance_daily')
    .select('id', { count: 'exact', head: true })
    .in('section_student_id', ids);
  if (error) return null;
  return (count ?? 0) > 0;
}

/**
 * The class this student already sits in for this academic year, if any.
 *
 * ⚠ WITHDRAWN COUNTS AS PLACED. A withdrawn student keeps their
 * `section_students` row and their index number (Hard Rule #6, KD #67), so
 * offering to assign them a class would either fail on the unique constraint
 * or quietly create a second enrolment. If they are genuinely returning, that
 * is a re-enrolment on the existing row, not a fresh placement.
 */
async function findCurrentPlacement(
  service: ReturnType<typeof createServiceClient>,
  ayCode: string,
  studentNumber: string | null
): Promise<{
  sectionName: string;
  levelCode: string | null;
  status: string;
} | null> {
  if (!studentNumber) return null;

  const { data: student } = await service
    .from('students')
    .select('id')
    .eq('student_number', studentNumber)
    .maybeSingle();
  if (!student) return null;

  const { data: ay } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ay) return null;

  const { data: rows } = await service
    .from('section_students')
    .select(
      'enrollment_status, section:sections!inner(name, academic_year_id, level:levels(code))'
    )
    .eq('student_id', (student as { id: string }).id)
    .eq('sections.academic_year_id', (ay as { id: string }).id)
    .limit(1);

  const row = (rows ?? [])[0] as
    | {
        enrollment_status: string;
        section:
          | {
              name: string;
              level: { code: string } | { code: string }[] | null;
            }
          | Array<{
              name: string;
              level: { code: string } | { code: string }[] | null;
            }>
          | null;
      }
    | undefined;
  if (!row) return null;

  const section = Array.isArray(row.section) ? row.section[0] : row.section;
  if (!section) return null;
  const level = Array.isArray(section.level) ? section.level[0] : section.level;

  return {
    sectionName: section.name,
    levelCode: level?.code ?? null,
    status: row.enrollment_status,
  };
}
