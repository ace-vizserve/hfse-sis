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
  enrolmentId: string;
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
  busNo: string | null;
  classroomOfficerRole: string | null;
  withdrawalReason: string | null;
  withdrawalNotes: string | null;
  lateEnrolleTermNumber: number | null;
};

export type AcademicTermRow = {
  termNumber: number;
  subjects: Array<{
    subjectCode: string;
    subjectName: string;
    isExaminable: boolean;
    initialGrade: number | null;
    quarterlyGrade: number | null;
    annualLetterGrade: string | null; // T4 row only; null for examinable subjects + T1-T3 rows
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

export type EvaluationWriteupEntry = {
  termNumber: number;
  termLabel: string;
  virtueTheme: string | null;
  writeup: string | null;
};

export async function findStudentByNumber(
  studentNumber: string
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

export async function getPlacementHistory(
  studentId: string
): Promise<PlacementRow[]> {
  const service = createServiceClient();
  const { data } = await service
    .from('section_students')
    .select(
      `
        id, enrollment_status, enrollment_date, withdrawal_date, index_number,
        bus_no, classroom_officer_role,
        withdrawal_reason, withdrawal_notes, late_enrollee_term_number,
        section:sections(
          id, name,
          level:levels(code, label),
          academic_year:academic_years(ay_code, label)
        )
      `
    )
    .eq('student_id', studentId);

  type Row = {
    id: string;
    enrollment_status: 'active' | 'late_enrollee' | 'withdrawn';
    enrollment_date: string | null;
    withdrawal_date: string | null;
    index_number: number;
    bus_no: string | null;
    classroom_officer_role: string | null;
    withdrawal_reason: string | null;
    withdrawal_notes: string | null;
    late_enrollee_term_number: number | null;
    section: {
      id: string;
      name: string;
      level:
        | { code: string; label: string }
        | { code: string; label: string }[]
        | null;
      academic_year:
        | { ay_code: string; label: string }
        | { ay_code: string; label: string }[]
        | null;
    } | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  return rows
    .map((r) => {
      const section = r.section;
      if (!section) return null;
      const level = Array.isArray(section.level)
        ? section.level[0]
        : section.level;
      const ay = Array.isArray(section.academic_year)
        ? section.academic_year[0]
        : section.academic_year;
      if (!level || !ay) return null;
      return {
        enrolmentId: r.id,
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
        busNo: r.bus_no,
        classroomOfficerRole: r.classroom_officer_role,
        withdrawalReason: r.withdrawal_reason,
        withdrawalNotes: r.withdrawal_notes,
        lateEnrolleTermNumber: r.late_enrollee_term_number,
      } satisfies PlacementRow;
    })
    .filter((r): r is PlacementRow => r !== null)
    .sort((a, b) => b.ayCode.localeCompare(a.ayCode));
}

export async function getAcademicHistory(
  studentId: string
): Promise<AcademicHistoryRow[]> {
  const service = createServiceClient();

  // grade_entries are keyed by section_student_id (Hard Rule #6), NOT student_id
  // — so resolve the student's section rows first. We include ALL of them: a
  // mid-year transfer (KD #67) leaves a withdrawn row holding the pre-transfer
  // grades, and we want the full academic history across sections.
  const { data: enrolments } = await service
    .from('section_students')
    .select('id')
    .eq('student_id', studentId);
  const sectionStudentIds = (enrolments ?? []).map(
    (r) => (r as { id: string }).id
  );
  if (sectionStudentIds.length === 0) return [];

  const { data, error } = await service
    .from('grade_entries')
    .select(
      `
        initial_grade, quarterly_grade, annual_letter_grade,
        grading_sheet:grading_sheets(
          subject:subjects(code, name, is_examinable),
          term:terms(
            term_number,
            academic_year:academic_years(ay_code, label)
          )
        )
      `
    )
    .in('section_student_id', sectionStudentIds);
  if (error) {
    console.warn('[records-history] academic fetch failed:', error.message);
    return [];
  }

  type Row = {
    initial_grade: number | null;
    quarterly_grade: number | null;
    annual_letter_grade: string | null;
    grading_sheet: {
      subject:
        | { code: string; name: string; is_examinable: boolean }
        | { code: string; name: string; is_examinable: boolean }[]
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
    } | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  // Group by AY → term → subjectCode, deduping across the student's section
  // rows. A transferred student has the same subject×term in two sections (the
  // one they actually attended that term holds the grade; the other is blank),
  // so keep the "richer" entry — the one with more non-null grade fields.
  type SubjectEntry = AcademicTermRow['subjects'][number];
  const richness = (e: SubjectEntry) =>
    [e.initialGrade, e.quarterlyGrade, e.annualLetterGrade].filter(
      (v) => v !== null
    ).length;

  const byAy = new Map<
    string,
    { ayLabel: string; terms: Map<number, Map<string, SubjectEntry>> }
  >();

  for (const r of rows) {
    const sheet = r.grading_sheet;
    if (!sheet) continue;
    const subject = Array.isArray(sheet.subject)
      ? sheet.subject[0]
      : sheet.subject;
    const term = Array.isArray(sheet.term) ? sheet.term[0] : sheet.term;
    if (!subject || !term) continue;
    const ay = Array.isArray(term.academic_year)
      ? term.academic_year[0]
      : term.academic_year;
    if (!ay) continue;

    if (!byAy.has(ay.ay_code)) {
      byAy.set(ay.ay_code, { ayLabel: ay.label, terms: new Map() });
    }
    const ayEntry = byAy.get(ay.ay_code)!;
    if (!ayEntry.terms.has(term.term_number)) {
      ayEntry.terms.set(term.term_number, new Map());
    }
    const subjMap = ayEntry.terms.get(term.term_number)!;
    const entry: SubjectEntry = {
      subjectCode: subject.code,
      subjectName: subject.name,
      isExaminable: subject.is_examinable ?? true,
      initialGrade: r.initial_grade,
      quarterlyGrade: r.quarterly_grade,
      annualLetterGrade: r.annual_letter_grade ?? null,
    };
    const existing = subjMap.get(subject.code);
    if (!existing || richness(entry) > richness(existing)) {
      subjMap.set(subject.code, entry);
    }
  }

  const out: AcademicHistoryRow[] = [];
  for (const [ayCode, ayEntry] of byAy) {
    const terms: AcademicTermRow[] = [];
    for (const [termNumber, subjMap] of ayEntry.terms) {
      terms.push({
        termNumber,
        subjects: Array.from(subjMap.values()).sort((a, b) =>
          a.subjectName.localeCompare(b.subjectName)
        ),
      });
    }
    terms.sort((a, b) => a.termNumber - b.termNumber);
    out.push({ ayCode, ayLabel: ayEntry.ayLabel, terms });
  }
  out.sort((a, b) => b.ayCode.localeCompare(a.ayCode));
  return out;
}

export async function getAttendanceHistory(
  studentId: string
): Promise<AttendanceHistoryRow[]> {
  const service = createServiceClient();

  // section_students → attendance_records → terms → academic_years
  const { data: enrolments } = await service
    .from('section_students')
    .select('id')
    .eq('student_id', studentId);
  const sectionStudentIds = (enrolments ?? []).map(
    (r) => (r as { id: string }).id
  );
  if (sectionStudentIds.length === 0) return [];

  const { data, error } = await service
    .from('attendance_records')
    .select(
      `
        school_days, days_present, days_late,
        term:terms(term_number, academic_year:academic_years(ay_code, label))
      `
    )
    .in('section_student_id', sectionStudentIds);
  if (error) {
    console.warn('[records-history] attendance fetch failed:', error.message);
    return [];
  }

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

  // Group by AY → term, summing across the student's section rows. A mid-year
  // transfer (KD #67) splits a term's attendance across the old + new section
  // row, so the per-term total is their sum; non-overlapping terms each have a
  // single record, so the sum is a no-op there.
  const byAy = new Map<
    string,
    {
      ayLabel: string;
      terms: Map<
        number,
        { schoolDays: number; daysPresent: number; daysLate: number }
      >;
    }
  >();

  for (const r of rows) {
    const term = Array.isArray(r.term) ? r.term[0] : r.term;
    if (!term) continue;
    const ay = Array.isArray(term.academic_year)
      ? term.academic_year[0]
      : term.academic_year;
    if (!ay) continue;

    if (!byAy.has(ay.ay_code)) {
      byAy.set(ay.ay_code, { ayLabel: ay.label, terms: new Map() });
    }
    const termMap = byAy.get(ay.ay_code)!.terms;
    const agg = termMap.get(term.term_number) ?? {
      schoolDays: 0,
      daysPresent: 0,
      daysLate: 0,
    };
    agg.schoolDays += r.school_days ?? 0;
    agg.daysPresent += r.days_present ?? 0;
    agg.daysLate += r.days_late ?? 0;
    termMap.set(term.term_number, agg);
  }

  const out: AttendanceHistoryRow[] = [];
  for (const [ayCode, v] of byAy) {
    out.push({
      ayCode,
      ayLabel: v.ayLabel,
      terms: Array.from(v.terms.entries())
        .map(([termNumber, agg]) => ({
          termNumber,
          schoolDays: agg.schoolDays,
          daysPresent: agg.daysPresent,
          daysLate: agg.daysLate,
        }))
        .sort((a, b) => a.termNumber - b.termNumber),
    });
  }
  out.sort((a, b) => b.ayCode.localeCompare(a.ayCode));
  return out;
}

/**
 * Returns FCA evaluation writeups for a student in a given AY.
 * Always returns exactly 3 entries (T1, T2, T3) — writeup is null when not yet recorded.
 * T4 is excluded per KD #49.
 */
export async function getEvaluationWriteupsForStudent(
  studentId: string,
  ayCode: string
): Promise<EvaluationWriteupEntry[]> {
  const service = createServiceClient();

  const { data } = await service
    .from('evaluation_writeups')
    .select(
      `writeup, terms!inner ( term_number, virtue_theme, academic_years!inner ( ay_code ) )`
    )
    .eq('student_id', studentId)
    .eq('terms.academic_years.ay_code', ayCode);

  type WriteupRow = {
    writeup: string | null;
    terms:
      | {
          term_number: number;
          virtue_theme: string | null;
          academic_years: { ay_code: string } | { ay_code: string }[] | null;
        }
      | {
          term_number: number;
          virtue_theme: string | null;
          academic_years: { ay_code: string } | { ay_code: string }[] | null;
        }[]
      | null;
  };
  const byTerm = new Map<
    number,
    { writeup: string | null; virtueTheme: string | null }
  >();
  for (const row of (data ?? []) as unknown as WriteupRow[]) {
    const term = Array.isArray(row.terms) ? row.terms[0] : row.terms;
    if (!term) continue;
    const n = term.term_number;
    if (n >= 1 && n <= 3) {
      byTerm.set(n, { writeup: row.writeup, virtueTheme: term.virtue_theme });
    }
  }

  return [1, 2, 3].map((n) => ({
    termNumber: n,
    termLabel: `T${n}`,
    virtueTheme: byTerm.get(n)?.virtueTheme ?? null,
    writeup: byTerm.get(n)?.writeup ?? null,
  }));
}

// Given an enroleeNumber (AY-scoped), walk every ay{YY}_enrolment_applications
// table and look up the matching row. Returns the `studentNumber` (stable ID)
// when found — used by the legacy `/records/students/by-enrolee/[enroleeNumber]`
// redirect to translate old URLs to the permanent Records URL.
export async function studentNumberFromEnroleeNumber(
  enroleeNumber: string
): Promise<{ studentNumber: string | null; ayCode: string | null }> {
  const service = createServiceClient();
  const { data: ays } = await service
    .from('academic_years')
    .select('ay_code')
    .order('ay_code', { ascending: false });
  const ayCodes = ((ays ?? []) as Array<{ ay_code: string }>).map(
    (r) => r.ay_code
  );

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
