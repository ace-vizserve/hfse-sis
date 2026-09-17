import { NextResponse, type NextRequest, after } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { getUserRoleSet } from '@/lib/auth/roles';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';
import { writeAuditRows } from '@/lib/audit/log-grade-change';
import { toPlainText } from '@/lib/rich-text';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { notifyAnnualLetterChanged } from '@/lib/notifications/email-annual-letter';
import { ANNUAL_LETTER_VALUES } from '@/lib/compute/letter-grade';

// PATCH /api/grading-sheets/[id]/entries/[entryId]/annual-letter
// Registrar-only: sets the freeform annual_letter_grade on a non-examinable
// subject's T4 grade_entry row. Hard Rule #5 does not apply — this is
// registrar metadata, not a per-term grade; no approval_reference required.
//
// ⚠ BUT A LOCKED SHEET STILL LEAVES THE POST-LOCK RECORD. This value is set at
// year end, when the Term 4 sheet is normally already locked, so gating it
// behind a change request would block the routine first entry. What it does
// NOT get to do is change a locked sheet silently: changing an existing value
// already requires a correction note, and on a locked sheet that change is
// also appended to `grade_audit_log` with the note as its reference — the same
// table every other post-lock change lands in. A first entry (blank → value)
// is not a correction and is recorded in `audit_log` only, with `was_locked`.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { id: sheetId, entryId } = await params;

  const body = (await request.json().catch(() => null)) as {
    annual_letter_grade: string | null;
    correction_note?: string | null;
  } | null;
  if (!body || !('annual_letter_grade' in body)) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const rawValue =
    typeof body.annual_letter_grade === 'string' &&
    body.annual_letter_grade.trim() !== ''
      ? body.annual_letter_grade.trim()
      : null;

  if (
    rawValue !== null &&
    !(ANNUAL_LETTER_VALUES as readonly string[]).includes(rawValue)
  ) {
    return NextResponse.json(
      {
        error: `invalid value — must be one of ${ANNUAL_LETTER_VALUES.join(', ')}`,
      },
      { status: 422 }
    );
  }
  const newValue = rawValue;

  const correctionNote =
    typeof body.correction_note === 'string' &&
    body.correction_note.trim() !== ''
      ? body.correction_note.trim()
      : null;

  const service = createServiceClient();

  const [sheetRes, entryRes] = await Promise.all([
    service
      .from('grading_sheets')
      .select(
        `
        id, is_locked,
        term:terms(term_number, label),
        subject:subjects(is_examinable, code),
        section:sections(academic_year_id, name)
      `
      )
      .eq('id', sheetId)
      .single(),
    service
      .from('grade_entries')
      .select(
        `
        id, grading_sheet_id, annual_letter_grade,
        section_student:section_students(
          student:students(student_number, first_name, last_name)
        )
      `
      )
      .eq('id', entryId)
      .single(),
  ]);

  if (sheetRes.error || !sheetRes.data) {
    return NextResponse.json({ error: 'sheet not found' }, { status: 404 });
  }
  if (entryRes.error || !entryRes.data) {
    return NextResponse.json({ error: 'entry not found' }, { status: 404 });
  }

  type SheetRow = {
    id: string;
    is_locked: boolean;
    term:
      | { term_number: number; label: string | null }
      | { term_number: number; label: string | null }[]
      | null;
    subject:
      | { is_examinable: boolean; code: string }
      | { is_examinable: boolean; code: string }[]
      | null;
    section:
      | { academic_year_id: string; name: string }
      | { academic_year_id: string; name: string }[]
      | null;
  };
  type EntryRow = {
    id: string;
    grading_sheet_id: string;
    annual_letter_grade: string | null;
    section_student:
      | {
          student:
            | { first_name: string; last_name: string }
            | { first_name: string; last_name: string }[]
            | null;
        }
      | { student: unknown }[]
      | null;
  };
  const sheet = sheetRes.data as unknown as SheetRow;
  const entry = entryRes.data as unknown as EntryRow;

  if (entry.grading_sheet_id !== sheetId) {
    return NextResponse.json(
      { error: 'entry does not belong to sheet' },
      { status: 400 }
    );
  }

  const subjectData = (
    Array.isArray(sheet.subject) ? sheet.subject[0] : sheet.subject
  ) as { is_examinable: boolean; code: string } | null;
  if (!subjectData) {
    return NextResponse.json(
      { error: 'subject not found on sheet' },
      { status: 404 }
    );
  }
  if (subjectData.is_examinable) {
    return NextResponse.json(
      {
        error:
          'annual_letter_grade is only applicable to non-examinable subjects',
      },
      { status: 422 }
    );
  }

  // correction_note only required when changing an existing value (first-time
  // entry null → Passed is routine annual workflow, not a correction).
  const existingValue = entry.annual_letter_grade;
  if (existingValue !== null && !correctionNote) {
    return NextResponse.json(
      { error: 'correction_note is required when changing an existing value' },
      { status: 422 }
    );
  }

  const { error: updateError } = await service
    .from('grade_entries')
    .update({ annual_letter_grade: newValue })
    .eq('id', entryId);

  if (updateError) {
    return NextResponse.json(
      { error: 'update failed', detail: updateError.message },
      { status: 500 }
    );
  }

  // Resolve context for audit log, notifications, and cache invalidation.
  const sectionData = (
    Array.isArray(sheet.section) ? sheet.section[0] : sheet.section
  ) as { academic_year_id: string; name: string } | null;
  const termData = (Array.isArray(sheet.term) ? sheet.term[0] : sheet.term) as {
    term_number: number;
  } | null;
  const sectionStudentData = Array.isArray(entry.section_student)
    ? entry.section_student[0]
    : entry.section_student;
  const studentData =
    sectionStudentData && 'student' in sectionStudentData
      ? Array.isArray((sectionStudentData as { student: unknown }).student)
        ? (
            sectionStudentData as {
              student: { first_name: string; last_name: string }[];
            }
          ).student[0]
        : (
            sectionStudentData as {
              student: { first_name: string; last_name: string } | null;
            }
          ).student
      : null;

  const studentName = studentData
    ? `${studentData.last_name}, ${studentData.first_name}`
    : '(unknown student)';
  const sectionName = sectionData?.name ?? '(unknown section)';
  const termLabel = termData
    ? `Term ${termData.term_number}`
    : '(unknown term)';

  let ayCode: string | null = null;
  if (sectionData?.academic_year_id) {
    const { data: ayRow } = await service
      .from('academic_years')
      .select('ay_code')
      .eq('id', sectionData.academic_year_id)
      .single();
    ayCode = ayRow?.ay_code ?? null;
  }
  if (!ayCode) {
    ayCode = await requireCurrentAyCode();
  }

  // Post-lock correction record (see the note at the top of this file).
  const isLockedCorrection =
    sheet.is_locked && existingValue !== null && existingValue !== newValue;
  const approvalReference = isLockedCorrection
    ? `Final grade correction: ${toPlainText(correctionNote).slice(0, 200)}`
    : null;
  let gradeAuditLogFailed = false;
  if (isLockedCorrection) {
    gradeAuditLogFailed = !(await writeAuditRows(service, [
      {
        grading_sheet_id: sheetId,
        grade_entry_id: entryId,
        changed_by: auth.user.email ?? auth.user.id,
        field_changed: 'annual_letter_grade',
        old_value: existingValue,
        new_value: newValue,
        approval_reference: approvalReference as string,
      },
    ]));
  }

  const studentNumber =
    (studentData as { student_number?: string | null } | null)
      ?.student_number ?? null;

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'grade_entry.annual_letter.update',
    entityType: 'grade_entry',
    entityId: entryId,
    context: {
      grading_sheet_id: sheetId,
      grade_entry_id: entryId,
      student_name: studentName,
      student_number: studentNumber,
      subject_code: subjectData.code,
      section_name: sectionName,
      term_label:
        (Array.isArray(sheet.term) ? sheet.term[0] : sheet.term)?.label ??
        termLabel,
      before: entry.annual_letter_grade,
      after: newValue,
      correction_note: correctionNote,
      was_locked: sheet.is_locked,
      ...(approvalReference ? { approval_reference: approvalReference } : {}),
      ...(gradeAuditLogFailed ? { grade_audit_log_failed: true } : {}),
    },
  });

  invalidateDrillTags('markbook', ayCode);

  // Notify admins when changing an existing value (not on initial entry —
  // setting "Passed" for the first time is routine, not a correction).
  // Runs via after() so it survives past the response on Vercel's
  // serverless runtime (an un-awaited void(async()) has no such guarantee —
  // see the matching note in app/api/change-requests/route.ts).
  if (existingValue !== null && correctionNote) {
    after(async () => {
      try {
        const { data: { users } = { users: [] } } =
          await service.auth.admin.listUsers({ perPage: 200 });
        const recipients = users
          .filter((u) => {
            // Every role the account holds, not the one it is using right now:
            // this picks who to TELL about a corrected final grade, and an
            // admin who also teaches still needs to know about it on the days
            // she is teaching.
            const roles = getUserRoleSet(u);
            return (
              (roles.includes('school_admin') ||
                roles.includes('superadmin')) &&
              u.email &&
              u.email !== auth.user.email
            );
          })
          .map((u) => u.email as string);
        if (recipients.length > 0) {
          await notifyAnnualLetterChanged(
            {
              studentName,
              subjectCode: subjectData.code,
              sectionName,
              termLabel,
              before: existingValue,
              after: newValue,
              reason: correctionNote,
              actorEmail: auth.user.email ?? '(unknown)',
            },
            recipients
          );
        }
      } catch (e) {
        console.error('[annual-letter] notification failed:', e);
      }
    });
  }

  return NextResponse.json({ ok: true });
}
