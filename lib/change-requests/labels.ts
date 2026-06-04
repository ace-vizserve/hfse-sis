import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';
import {
  getApproverEmailList,
  getRegistrarEmailList,
} from '@/lib/auth/staff-list';

// Shared change-request workflow helpers. Moved here (verbatim in logic) from
// app/api/change-requests/route.ts so that lib/ modules — notably
// lib/change-requests/decide.ts — can import them without reaching into an
// app/api/ route file (route files can carry segment config + are fragile to
// pull from under the Next bundler). Both email helpers delegate to the 5-min
// cached helpers in lib/auth/staff-list.ts so auth.admin.listUsers() is called
// at most once per 5-minute window.
export async function fetchApproverEmails(
  _service: ReturnType<typeof createServiceClient>
): Promise<string[]> {
  return getApproverEmailList();
}

export async function fetchRegistrarEmails(
  _service: ReturnType<typeof createServiceClient>
): Promise<string[]> {
  return getRegistrarEmailList();
}

export async function fetchLabels(
  service: ReturnType<typeof createServiceClient>,
  sheetId: string,
  entryId: string
): Promise<{ student_label: string | null; sheet_label: string | null }> {
  const [sheetRes, entryRes] = await Promise.all([
    service
      .from('grading_sheets')
      .select(
        `term:terms(label),
         section:sections(name, level:levels(label)),
         subject:subjects(name)`
      )
      .eq('id', sheetId)
      .single(),
    service
      .from('grade_entries')
      .select(
        'section_student:section_students(student:students(student_number, first_name, last_name))'
      )
      .eq('id', entryId)
      .single(),
  ]);

  const sheetData = sheetRes.data as {
    term: { label: string | null } | { label: string | null }[] | null;
    section: {
      name: string | null;
      level: { label: string | null } | { label: string | null }[] | null;
    } | null;
    subject: { name: string | null } | { name: string | null }[] | null;
  } | null;
  const term = sheetData
    ? Array.isArray(sheetData.term)
      ? sheetData.term[0]
      : sheetData.term
    : null;
  const section = sheetData?.section ?? null;
  const level = section
    ? Array.isArray(section.level)
      ? section.level[0]
      : section.level
    : null;
  const subject = sheetData
    ? Array.isArray(sheetData.subject)
      ? sheetData.subject[0]
      : sheetData.subject
    : null;
  const sheetLabel =
    sheetData && subject && section
      ? `${level?.label ?? ''} ${section.name ?? ''} · ${subject.name ?? ''} · ${term?.label ?? ''}`.trim()
      : null;

  type StudentRef = {
    student_number: string | null;
    first_name: string | null;
    last_name: string | null;
  };
  type SectionStudentRef = { student: StudentRef | StudentRef[] | null };
  const entryData = entryRes.data as {
    section_student: SectionStudentRef | SectionStudentRef[] | null;
  } | null;
  const sectionStudent = entryData
    ? Array.isArray(entryData.section_student)
      ? entryData.section_student[0]
      : entryData.section_student
    : null;
  const student = sectionStudent
    ? Array.isArray(sectionStudent.student)
      ? sectionStudent.student[0]
      : sectionStudent.student
    : null;
  const studentLabel = student
    ? `${student.last_name ?? ''}, ${student.first_name ?? ''}`.trim() +
      ` (${student.student_number ?? '—'})`
    : null;

  return { student_label: studentLabel, sheet_label: sheetLabel };
}
