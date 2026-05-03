import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';

// Cross-year student history — keyed on `student_number` (Hard Rule #4:
// the only stable student ID). Pulls placement + academic + attendance
// history spanning every AY this student has appeared in. Used by
// `/records/students/[studentNumber]` to render the permanent record.

export type StudentHeader = {
  studentId: string;
  studentNumber: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
};

export type PlacementRow = {
  ayCode: string;
  ayLabel: string;
  sectionId: string;
  sectionName: string;
  levelCode: string;
  levelLabel: string;
  enrollmentStatus: 'active' | 'late_enrollee' | 'withdrawn';
  indexNumber: number;
  enrollmentDate: string | null;
  withdrawalDate: string | null;
};

export type AcademicTermRow = {
  termNumber: number;
  subjects: Array<{
    subjectCode: string;
    subjectName: string;
    initialGrade: number | null;
    quarterlyGrade: number | null;
  }>;
};

export type AcademicHistoryRow = {
  ayCode: string;
  ayLabel: string;
  terms: AcademicTermRow[];
};

export type AttendanceHistoryRow = {
  ayCode: string;
  ayLabel: string;
  terms: Array<{
    termNumber: number;
    schoolDays: number | null;
    daysPresent: number | null;
    daysLate: number | null;
  }>;
};

export async function findStudentByNumber(
  studentNumber: string,
): Promise<StudentHeader | null> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('students')
    .select('id, student_number, first_name, middle_name, last_name')
    .eq('student_number', studentNumber)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    id: string;
    student_number: string;
    first_name: string | null;
    middle_name: string | null;
    last_name: string | null;
  };
  return {
    studentId: row.id,
    studentNumber: row.student_number,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
  };
}

export async function getPlacementHistory(studentId: string): Promise<PlacementRow[]> {
  const service = createServiceClient();
  const { data } = await service
    .from('section_students')
    .select(
      `
        enrollment_status, enrollment_date, withdrawal_date, index_number,
        section:sections(
          id, name,
          level:levels(code, label),
          academic_year:academic_years(ay_code, label)
        )
      `,
    )
    .eq('student_id', studentId);

  type Row = {
    enrollment_status: 'active' | 'late_enrollee' | 'withdrawn';
    enrollment_date: string | null;
    withdrawal_date: string | null;
    index_number: number;
    section:
      | {
          id: string;
          name: string;
          level: { code: string; label: string } | { code: string; label: string }[] | null;
          academic_year:
            | { ay_code: string; label: string }
            | { ay_code: string; label: string }[]
            | null;
        }
      | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  return rows
    .map((r) => {
      const section = r.section;
      if (!section) return null;
      const level = Array.isArray(section.level) ? section.level[0] : section.level;
      const ay = Array.isArray(section.academic_year)
        ? section.academic_year[0]
        : section.academic_year;
      if (!level || !ay) return null;
      return {
        ayCode: ay.ay_code,
        ayLabel: ay.label,
        sectionId: section.id,
        sectionName: section.name,
        levelCode: level.code,
        levelLabel: level.label,
        enrollmentStatus: r.enrollment_status,
        indexNumber: r.index_number,
        enrollmentDate: r.enrollment_date,
        withdrawalDate: r.withdrawal_date,
      } satisfies PlacementRow;
    })
    .filter((r): r is PlacementRow => r !== null)
    .sort((a, b) => b.ayCode.localeCompare(a.ayCode));
}

export async function getAcademicHistory(studentId: string): Promise<AcademicHistoryRow[]> {
  const service = createServiceClient();
  const { data } = await service
    .from('grade_entries')
    .select(
      `
        initial_grade, quarterly_grade,
        grading_sheet:grading_sheets(
          subject:subjects(code, name),
          term:terms(
            term_number,
            academic_year:academic_years(ay_code, label)
          )
        )
      `,
    )
    .eq('student_id', studentId);

  type Row = {
    initial_grade: number | null;
    quarterly_grade: number | null;
    grading_sheet:
      | {
          subject:
            | { code: string; name: string }
            | { code: string; name: string }[]
            | null;
          term:
            | {
                term_number: number;
                academic_year:
                  | { ay_code: string; label: string }
                  | { ay_code: string; label: string }[]
                  | null;
              }
            | {
                term_number: number;
                academic_year:
                  | { ay_code: string; label: string }
                  | { ay_code: string; label: string }[]
                  | null;
              }[]
            | null;
        }
      | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  // Group by AY → term → subject.
  const byAy = new Map<
    string,
    { ayLabel: string; terms: Map<number, AcademicTermRow['subjects']> }
  >();

  for (const r of rows) {
    const sheet = r.grading_sheet;
    if (!sheet) continue;
    const subject = Array.isArray(sheet.subject) ? sheet.subject[0] : sheet.subject;
    const term = Array.isArray(sheet.term) ? sheet.term[0] : sheet.term;
    if (!subject || !term) continue;
    const ay = Array.isArray(term.academic_year) ? term.academic_year[0] : term.academic_year;
    if (!ay) continue;

    if (!byAy.has(ay.ay_code)) {
      byAy.set(ay.ay_code, { ayLabel: ay.label, terms: new Map() });
    }
    const ayEntry = byAy.get(ay.ay_code)!;
    if (!ayEntry.terms.has(term.term_number)) {
      ayEntry.terms.set(term.term_number, []);
    }
    ayEntry.terms.get(term.term_number)!.push({
      subjectCode: subject.code,
      subjectName: subject.name,
      initialGrade: r.initial_grade,
      quarterlyGrade: r.quarterly_grade,
    });
  }

  const out: AcademicHistoryRow[] = [];
  for (const [ayCode, ayEntry] of byAy) {
    const terms: AcademicTermRow[] = [];
    for (const [termNumber, subjects] of ayEntry.terms) {
      terms.push({
        termNumber,
        subjects: subjects.sort((a, b) => a.subjectName.localeCompare(b.subjectName)),
      });
    }
    terms.sort((a, b) => a.termNumber - b.termNumber);
    out.push({ ayCode, ayLabel: ayEntry.ayLabel, terms });
  }
  out.sort((a, b) => b.ayCode.localeCompare(a.ayCode));
  return out;
}

export async function getAttendanceHistory(
  studentId: string,
): Promise<AttendanceHistoryRow[]> {
  const service = createServiceClient();

  // section_students → attendance_records → terms → academic_years
  const { data: enrolments } = await service
    .from('section_students')
    .select('id')
    .eq('student_id', studentId);
  const sectionStudentIds = (enrolments ?? []).map((r) => (r as { id: string }).id);
  if (sectionStudentIds.length === 0) return [];

  const { data } = await service
    .from('attendance_records')
    .select(
      `
        school_days, days_present, days_late,
        term:terms(term_number, academic_year:academic_years(ay_code, label))
      `,
    )
    .in('section_student_id', sectionStudentIds);

  type Row = {
    school_days: number | null;
    days_present: number | null;
    days_late: number | null;
    term:
      | {
          term_number: number;
          academic_year:
            | { ay_code: string; label: string }
            | { ay_code: string; label: string }[]
            | null;
        }
      | {
          term_number: number;
          academic_year:
            | { ay_code: string; label: string }
            | { ay_code: string; label: string }[]
            | null;
        }[]
      | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  const byAy = new Map<
    string,
    { ayLabel: string; terms: AttendanceHistoryRow['terms'] }
  >();

  for (const r of rows) {
    const term = Array.isArray(r.term) ? r.term[0] : r.term;
    if (!term) continue;
    const ay = Array.isArray(term.academic_year) ? term.academic_year[0] : term.academic_year;
    if (!ay) continue;

    if (!byAy.has(ay.ay_code)) {
      byAy.set(ay.ay_code, { ayLabel: ay.label, terms: [] });
    }
    byAy.get(ay.ay_code)!.terms.push({
      termNumber: term.term_number,
      schoolDays: r.school_days,
      daysPresent: r.days_present,
      daysLate: r.days_late,
    });
  }

  const out: AttendanceHistoryRow[] = [];
  for (const [ayCode, v] of byAy) {
    out.push({
      ayCode,
      ayLabel: v.ayLabel,
      terms: v.terms.sort((a, b) => a.termNumber - b.termNumber),
    });
  }
  out.sort((a, b) => b.ayCode.localeCompare(a.ayCode));
  return out;
}

// Given an enroleeNumber (AY-scoped), walk every ay{YY}_enrolment_applications
// table and look up the matching row. Returns the `studentNumber` (stable ID)
// when found — used by the legacy `/records/students/by-enrolee/[enroleeNumber]`
// redirect to translate old URLs to the permanent Records URL.
export async function studentNumberFromEnroleeNumber(
  enroleeNumber: string,
): Promise<{ studentNumber: string | null; ayCode: string | null }> {
  const service = createServiceClient();
  const { data: ays } = await service
    .from('academic_years')
    .select('ay_code')
    .order('ay_code', { ascending: false });
  const ayCodes = ((ays ?? []) as Array<{ ay_code: string }>).map((r) => r.ay_code);

  for (const ayCode of ayCodes) {
    const slug = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
    const table = `${slug}_enrolment_applications`;
    const { data, error } = await service
      .from(table)
      .select('studentNumber, enroleeNumber')
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle();
    if (error) continue;
    if (data) {
      const row = data as { studentNumber: string | null };
      return { studentNumber: row.studentNumber, ayCode };
    }
  }
  return { studentNumber: null, ayCode: null };
}
