import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { createClient } from '@/lib/supabase/server';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';

// Roster for a single section — ordered by index number (immutable).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(['teacher', 'registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  const supabase = await createClient();

  const { data: section, error: secErr } = await supabase
    .from('sections')
    .select('id, name, level:levels(code, label)')
    .eq('id', id)
    .single();
  if (secErr || !section) {
    return NextResponse.json({ error: 'section not found' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, enrollment_date, withdrawal_date, student:students(id, student_number, last_name, first_name, middle_name)',
    )
    .eq('section_id', id)
    .order('index_number');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ section, students: data ?? [] });
}

// Add an Enrolled admissions applicant to a section's roster.
//
// Locked-down per project conventions (KD #51 + KD #67 + Hard Rule #4):
//   - identity must be an existing admissions record (no free-text typing)
//   - applicant must be `Enrolled` / `Enrolled (Conditional)` for the
//     section's AY
//   - applicant's admissions-side `classLevel` must match the section's
//     level label
//   - applicant must not already hold an active row in another section in
//     this AY (closes the dual-section bug — KD #67)
//   - section must be under the 50-cap (Hard Rule #5)
//
// Each guard returns a structured `{ error, code, ... }` body so the client
// can branch on `code` and surface a specific actionable toast (toast.action
// per the sileo shim).
const MAX_PER_SECTION = 50;
const ENROLLED_STATUSES = ['Enrolled', 'Enrolled (Conditional)'];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id: sectionId } = await params;
  const body = await request.json().catch(() => null) as
    | {
        student_number?: string;
        enrollment_status?: 'active' | 'late_enrollee';
        bus_no?: string | null;
        classroom_officer_role?: string | null;
      }
    | null;
  if (!body) {
    return NextResponse.json({ error: 'invalid body', code: 'invalid_body' }, { status: 400 });
  }

  const studentNumber = body.student_number?.trim();
  if (!studentNumber) {
    return NextResponse.json(
      { error: 'student_number is required', code: 'missing_student_number' },
      { status: 400 },
    );
  }
  const enrollmentStatus = body.enrollment_status === 'late_enrollee' ? 'late_enrollee' : 'active';
  const busNo = body.bus_no?.toString().trim() || null;
  const classroomOfficerRole = body.classroom_officer_role?.toString().trim() || null;

  const service = createServiceClient();

  // ── 1. Section exists + resolve its AY + level label ───────────────────
  const { data: secRow, error: secErr } = await service
    .from('sections')
    .select('id, name, academic_year_id, levels!inner(label)')
    .eq('id', sectionId)
    .maybeSingle();
  if (secErr || !secRow) {
    return NextResponse.json({ error: 'section not found', code: 'section_not_found' }, { status: 404 });
  }
  const section = secRow as {
    id: string;
    name: string;
    academic_year_id: string;
    levels: { label: string } | { label: string }[];
  };
  const sectionLevelLabel = Array.isArray(section.levels)
    ? section.levels[0]?.label
    : section.levels?.label;
  if (!sectionLevelLabel) {
    return NextResponse.json(
      { error: 'section has no level label', code: 'section_level_missing' },
      { status: 500 },
    );
  }

  const { data: ayRow, error: ayErr } = await service
    .from('academic_years')
    .select('ay_code')
    .eq('id', section.academic_year_id)
    .maybeSingle();
  if (ayErr || !ayRow) {
    return NextResponse.json(
      { error: 'academic year for section not found', code: 'ay_not_found' },
      { status: 404 },
    );
  }
  const ayCode = (ayRow as { ay_code: string }).ay_code;
  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;

  // ── 2. Student must already exist in public.students (synced) ─────────
  // The legacy "create-by-name" path is gone; identity must come from an
  // admissions record that's been synced to the grading roster.
  const { data: existing, error: stuErr } = await service
    .from('students')
    .select('id, last_name, first_name, middle_name')
    .eq('student_number', studentNumber)
    .maybeSingle();
  if (stuErr) {
    return NextResponse.json({ error: stuErr.message, code: 'student_lookup_failed' }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json(
      {
        error:
          'No student record found for that student number — sync from admissions first.',
        code: 'not_synced',
        studentNumber,
      },
      { status: 404 },
    );
  }
  const studentId = (existing as { id: string }).id;

  // ── 3. Admissions applicant must be Enrolled in this AY ───────────────
  const admissions = createAdmissionsClient();
  const { data: appRows, error: appErr } = await admissions
    .from(`${prefix}_enrolment_applications`)
    .select('enroleeNumber, studentNumber')
    .eq('studentNumber', studentNumber)
    .limit(1);
  if (appErr) {
    return NextResponse.json(
      { error: appErr.message, code: 'admissions_lookup_failed' },
      { status: 500 },
    );
  }
  const apps = (appRows ?? []) as Array<{ enroleeNumber: string | null }>;
  const enroleeNumber = apps[0]?.enroleeNumber ?? null;
  if (!enroleeNumber) {
    return NextResponse.json(
      {
        error: `Student ${studentNumber} has no admissions row in ${ayCode}.`,
        code: 'not_in_admissions',
        studentNumber,
        ayCode,
      },
      { status: 422 },
    );
  }

  const { data: statusRow, error: statusErr } = await admissions
    .from(`${prefix}_enrolment_status`)
    .select('applicationStatus, classLevel')
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (statusErr) {
    return NextResponse.json(
      { error: statusErr.message, code: 'status_lookup_failed' },
      { status: 500 },
    );
  }
  const applicationStatus = (statusRow as { applicationStatus: string | null } | null)?.applicationStatus ?? null;
  const applicantLevel = (statusRow as { classLevel: string | null } | null)?.classLevel ?? null;

  if (!applicationStatus || !ENROLLED_STATUSES.includes(applicationStatus)) {
    return NextResponse.json(
      {
        error: `Applicant must be Enrolled before being placed in a section. Current status: ${applicationStatus ?? '(none)'}`,
        code: 'not_enrolled',
        enroleeNumber,
        ayCode,
        applicationStatus,
      },
      { status: 422 },
    );
  }

  // ── 4. Level guard ─────────────────────────────────────────────────────
  if (!applicantLevel || applicantLevel.trim() !== sectionLevelLabel.trim()) {
    return NextResponse.json(
      {
        error: `Applicant level (${applicantLevel ?? 'none'}) does not match section level (${sectionLevelLabel}).`,
        code: 'wrong_level',
        enroleeNumber,
        ayCode,
        applicantLevel,
        sectionLevelLabel,
      },
      { status: 422 },
    );
  }

  // ── 5. Not in another active section in same AY ───────────────────────
  // Scope to the section's AY by joining sections so a stale row from a
  // prior AY doesn't trigger a false dual-section error.
  const { data: aySectionRows } = await service
    .from('sections')
    .select('id')
    .eq('academic_year_id', section.academic_year_id);
  const aySectionIds = ((aySectionRows ?? []) as { id: string }[]).map((s) => s.id);

  if (aySectionIds.length > 0) {
    const { data: existingEnrolments } = await service
      .from('section_students')
      .select('id, section_id, enrollment_status')
      .eq('student_id', studentId)
      .in('section_id', aySectionIds)
      .in('enrollment_status', ['active', 'late_enrollee']);
    const conflicts = (existingEnrolments ?? []) as Array<{
      id: string;
      section_id: string;
      enrollment_status: string;
    }>;
    const conflict = conflicts.find((r) => r.section_id !== sectionId);
    const sameSectionRow = conflicts.find((r) => r.section_id === sectionId);
    if (sameSectionRow) {
      return NextResponse.json(
        {
          error: `already enrolled in this section (status: ${sameSectionRow.enrollment_status})`,
          code: 'already_in_this_section',
        },
        { status: 409 },
      );
    }
    if (conflict) {
      return NextResponse.json(
        {
          error: `Student is currently active in another section (use the Move flow instead).`,
          code: 'already_in_section',
          otherSectionId: conflict.section_id,
          enroleeNumber,
          ayCode,
        },
        { status: 409 },
      );
    }
  }

  // ── 6. 50-cap check (Hard Rule #5) ─────────────────────────────────────
  const { count: activeCount } = await service
    .from('section_students')
    .select('id', { count: 'exact', head: true })
    .eq('section_id', sectionId)
    .in('enrollment_status', ['active', 'late_enrollee']);
  if ((activeCount ?? 0) >= MAX_PER_SECTION) {
    return NextResponse.json(
      {
        error: `Section is at capacity (${MAX_PER_SECTION}).`,
        code: 'at_capacity',
        sectionId,
      },
      { status: 422 },
    );
  }

  // ── 7. Insert section_students row ────────────────────────────────────
  const { data: maxRow } = await service
    .from('section_students')
    .select('index_number')
    .eq('section_id', sectionId)
    .order('index_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextIndex = ((maxRow as { index_number: number } | null)?.index_number ?? 0) + 1;

  const { data: enrolmentRow, error: enrErr } = await service
    .from('section_students')
    .insert({
      section_id: sectionId,
      student_id: studentId,
      index_number: nextIndex,
      enrollment_status: enrollmentStatus,
      enrollment_date: new Date().toISOString().slice(0, 10),
      bus_no: busNo,
      classroom_officer_role: classroomOfficerRole,
    })
    .select('id')
    .single();
  if (enrErr || !enrolmentRow) {
    return NextResponse.json(
      { error: enrErr?.message ?? 'enrolment failed', code: 'insert_failed' },
      { status: 500 },
    );
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'student.add',
    entityType: 'section_student',
    entityId: enrolmentRow.id,
    context: {
      student_number: studentNumber,
      section_id: sectionId,
      section_name: section.name,
      index_number: nextIndex,
      enrollment_status: enrollmentStatus,
      enroleeNumber,
      applicationStatus,
      ayCode,
      sourcedFromAdmissions: true,
    },
  });

  const fullName = [
    (existing as { last_name: string | null }).last_name,
    (existing as { first_name: string | null }).first_name,
  ]
    .filter(Boolean)
    .join(', ');

  return NextResponse.json({
    success: true,
    student_id: studentId,
    index_number: nextIndex,
    enroleeNumber,
    fullName,
  });
}
