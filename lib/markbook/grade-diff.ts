import { createServiceClient } from '@/lib/supabase/service';

export type PriorTermGrade = {
  term_number: number;
  term_label: string;
  quarterly_grade: number | null;
};

type TermLite = { term_number: number; label: string };

const firstOf = <T>(v: T | T[] | null): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

/**
 * Pure mapper: fold prior-term grade entries — keyed by whichever
 * section_students row the grade was entered under — into a map keyed by the
 * CURRENT section's section_student_id (what the score-entry grid keys rows
 * by). Transfer-safe (KD #67): a mid-year transfer withdraws the old row and
 * inserts a fresh one in the destination section, so the transferred
 * student's prior-term grades live under the old, now-withdrawn row —
 * resolving via student_id unions them back onto the new row.
 *
 * When the same (student, term) holds entries under two enrolment rows (e.g.
 * a transfer mid-term seeds a blank entry in the destination sheet), a
 * non-null quarterly wins over a blank one.
 */
export function buildPriorGradeMap(args: {
  /** The current section's roster rows (the ids the grid keys rows by). */
  currentRoster: { id: string; student_id: string }[];
  /** Every section_students row those students hold this AY (old + new). */
  enrolmentToStudent: Record<string, string>;
  entries: {
    section_student_id: string;
    quarterly_grade: number | null;
    grading_sheet_id: string;
  }[];
  termBySheetId: Map<string, TermLite>;
}): Record<string, PriorTermGrade[]> {
  const byStudent = new Map<string, Map<number, PriorTermGrade>>();
  for (const e of args.entries) {
    const term = args.termBySheetId.get(e.grading_sheet_id);
    if (!term) continue;
    const studentId = args.enrolmentToStudent[e.section_student_id];
    if (!studentId) continue;
    let terms = byStudent.get(studentId);
    if (!terms) {
      terms = new Map();
      byStudent.set(studentId, terms);
    }
    const existing = terms.get(term.term_number);
    if (
      !existing ||
      (existing.quarterly_grade == null && e.quarterly_grade != null)
    ) {
      terms.set(term.term_number, {
        term_number: term.term_number,
        term_label: term.label,
        quarterly_grade: e.quarterly_grade,
      });
    }
  }

  const result: Record<string, PriorTermGrade[]> = {};
  for (const r of args.currentRoster) {
    const terms = byStudent.get(r.student_id);
    if (!terms || terms.size === 0) continue;
    result[r.id] = Array.from(terms.values()).sort(
      (a, b) => a.term_number - b.term_number
    );
  }
  return result;
}

/**
 * Returns prior-term quarterly grades for all students in the given
 * (section, subject), keyed by the current section's section_student_id,
 * sorted by term_number asc. "Prior" means term_number < currentTermNumber.
 *
 * Grades are resolved by student_id across ALL of each student's
 * section_students rows in the AY, and across every section's sheets for the
 * subject — NOT just this section's — so mid-year transfers (KD #67) keep
 * their prior-term history in the Alerts column.
 */
export async function loadPriorTermGrades(
  sectionId: string,
  subjectId: string,
  currentTermNumber: number
): Promise<Record<string, PriorTermGrade[]>> {
  const service = createServiceClient();

  // 1) Current roster + the section's AY (one query). All statuses — the grid
  //    also renders withdrawn rows.
  const { data: rosterRaw } = await service
    .from('section_students')
    .select('id, student_id, section:sections!inner(academic_year_id)')
    .eq('section_id', sectionId);
  type RosterRow = {
    id: string;
    student_id: string | null;
    section:
      | { academic_year_id: string }
      | { academic_year_id: string }[]
      | null;
  };
  const roster = ((rosterRaw ?? []) as unknown as RosterRow[]).filter(
    (r): r is RosterRow & { student_id: string } => !!r.student_id
  );
  if (roster.length === 0) return {};
  const ayId = firstOf(roster[0].section)?.academic_year_id;
  if (!ayId) return {};

  const studentIds = Array.from(new Set(roster.map((r) => r.student_id)));

  // 2) Prior terms in the AY + every enrolment row those students hold in the
  //    AY (independent — fetch in parallel).
  const [{ data: termsRaw }, { data: enrolmentsRaw }] = await Promise.all([
    service
      .from('terms')
      .select('id, term_number, label')
      .eq('academic_year_id', ayId),
    service
      .from('section_students')
      .select('id, student_id, section:sections!inner(academic_year_id)')
      .in('student_id', studentIds)
      .eq('section.academic_year_id', ayId),
  ]);

  const priorTerms = (
    (termsRaw ?? []) as { id: string; term_number: number; label: string }[]
  ).filter((t) => t.term_number < currentTermNumber);
  if (priorTerms.length === 0) return {};
  const termById = new Map<string, TermLite>(
    priorTerms.map((t) => [
      t.id,
      { term_number: t.term_number, label: t.label },
    ])
  );

  const enrolmentToStudent: Record<string, string> = {};
  for (const r of (enrolmentsRaw ?? []) as {
    id: string;
    student_id: string | null;
  }[]) {
    if (r.student_id) enrolmentToStudent[r.id] = r.student_id;
  }
  const allEnrolmentIds = Object.keys(enrolmentToStudent);
  if (allEnrolmentIds.length === 0) return {};

  // 3) Prior-term sheets for this subject across ALL sections in the AY —
  //    a transferred-in student's old grades live under the origin section's
  //    sheets.
  const { data: sheetsRaw } = await service
    .from('grading_sheets')
    .select('id, term_id')
    .eq('subject_id', subjectId)
    .in(
      'term_id',
      priorTerms.map((t) => t.id)
    );
  const sheets = (sheetsRaw ?? []) as { id: string; term_id: string }[];
  if (sheets.length === 0) return {};

  const termBySheetId = new Map<string, TermLite>();
  for (const s of sheets) {
    const t = termById.get(s.term_id);
    if (t) termBySheetId.set(s.id, t);
  }

  // 4) Entries — bounded by (this roster's enrolment rows × prior sheets for
  //    one subject), well under the PostgREST 1000-row cap.
  const { data: entriesRaw } = await service
    .from('grade_entries')
    .select('section_student_id, quarterly_grade, grading_sheet_id')
    .in(
      'grading_sheet_id',
      sheets.map((s) => s.id)
    )
    .in('section_student_id', allEnrolmentIds);

  return buildPriorGradeMap({
    currentRoster: roster.map((r) => ({
      id: r.id,
      student_id: r.student_id,
    })),
    enrolmentToStudent,
    entries: (entriesRaw ?? []) as {
      section_student_id: string;
      quarterly_grade: number | null;
      grading_sheet_id: string;
    }[],
    termBySheetId,
  });
}
