import {
  rankAtRisk,
  type AtRiskObservation,
  type AtRiskStudent,
  type AtRiskStudentRef,
} from '@/lib/classroom/at-risk';
import { loadPriorTermGrades } from '@/lib/markbook/grade-diff';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { createServiceClient } from '@/lib/supabase/service';

// Gathers what `rankAtRisk` needs for one (section, term), across every subject
// the class takes.
//
// WHY IT CALLS `loadPriorTermGrades` ONCE PER SUBJECT rather than issuing one
// wide query. That helper is transfer-safe in a way that is easy to get wrong
// and expensive to get wrong quietly: a mid-year transfer (KD #67) withdraws
// the student's old enrolment row and inserts a new one, so their Term 1 marks
// live under a row this section has never heard of, and it resolves them by
// `student_id` across every section's sheets for the subject. Re-deriving that
// here would duplicate the subtlest query in the codebase and let the two
// copies drift. Ten subjects is ten parallel calls, on a panel opened by hand.

type SubjectLite = { name: string; is_examinable: boolean };

type SheetRow = {
  id: string;
  subject_id: string;
  subject: SubjectLite | SubjectLite[] | null;
};

type EntryRow = {
  section_student_id: string;
  grading_sheet_id: string;
  quarterly_grade: number | null;
  ww_ps: number | null;
  pt_ps: number | null;
  qa_ps: number | null;
};

const firstOf = <T>(v: T | T[] | null): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

export async function loadSectionAtRisk(
  sectionId: string,
  termId: string
): Promise<AtRiskStudent[]> {
  const service = createServiceClient();

  const { data: term } = await service
    .from('terms')
    .select('term_number')
    .eq('id', termId)
    .maybeSingle();
  const termNumber = (term as { term_number: number } | null)?.term_number;
  // Term 1 has nothing behind it to compare against, and that is a real answer
  // rather than an error — the list is simply empty until a second term exists.
  if (!termNumber || termNumber < 2) return [];

  const [{ data: rosterRaw }, { data: sheetsRaw }] = await Promise.all([
    service
      .from('section_students')
      .select(
        'id, index_number, student:students(student_number, last_name, first_name, middle_name)'
      )
      .eq('section_id', sectionId)
      .neq('enrollment_status', 'withdrawn')
      .order('index_number'),
    service
      .from('grading_sheets')
      .select('id, subject_id, subject:subjects(name, is_examinable)')
      .eq('section_id', sectionId)
      .eq('term_id', termId),
  ]);

  type RosterRow = {
    id: string;
    index_number: number;
    student: {
      student_number: string;
      last_name: string | null;
      first_name: string | null;
      middle_name: string | null;
    } | null;
  };
  const roster = (rosterRaw ?? []) as unknown as RosterRow[];
  const sheets = (sheetsRaw ?? []) as unknown as SheetRow[];
  if (roster.length === 0 || sheets.length === 0) return [];

  const students: AtRiskStudentRef[] = roster
    .filter((r) => r.student)
    .map((r) => ({
      sectionStudentId: r.id,
      studentNumber: r.student!.student_number,
      studentName:
        [r.student!.last_name, r.student!.first_name, r.student!.middle_name]
          .filter(Boolean)
          .join(', ') || '(no name on file)',
      indexNumber: r.index_number,
    }));

  // This term's marks for every sheet in the section, and each subject's prior
  // terms — independent, so they go together.
  // PAGINATED, and not because today's numbers need it. The biggest class in
  // production is 10 sheets x 35 students = 350 rows against a 1000-row server
  // cap, so an unpaginated `.in()` works — right up until a class grows or a
  // level gains subjects, at which point PostgREST returns the first 1000 rows
  // with no error and no flag. A silently truncated at-risk list is the worst
  // failure this feature has: it looks complete, and the students it drops are
  // exactly the ones nobody then rings home about. Every comparable query in
  // this codebase paginates; this one was the outlier.
  const [entries, priorsBySubject] = await Promise.all([
    fetchAllPages<EntryRow>((from, to) =>
      service
        .from('grade_entries')
        .select(
          'section_student_id, grading_sheet_id, quarterly_grade, ww_ps, pt_ps, qa_ps'
        )
        .in(
          'grading_sheet_id',
          sheets.map((s) => s.id)
        )
        .range(from, to)
    ),
    Promise.all(
      sheets.map((s) =>
        loadPriorTermGrades(sectionId, s.subject_id, termNumber)
      )
    ),
  ]);

  const subjectBySheet = new Map(
    sheets.map((s) => [
      s.id,
      firstOf(s.subject) ?? { name: 'Subject', is_examinable: true },
    ])
  );
  const priorsBySheet = new Map(
    sheets.map((s, i) => [s.id, priorsBySubject[i]])
  );

  const observations: AtRiskObservation[] = entries.map((e) => ({
    sectionStudentId: e.section_student_id,
    subject: subjectBySheet.get(e.grading_sheet_id)?.name ?? 'Subject',
    // Defaults to examinable when a sheet somehow has no subject row: showing
    // a number where a band belongs is a smaller lie than the reverse, which
    // would invent a letter for a real percentage.
    isExaminable: subjectBySheet.get(e.grading_sheet_id)?.is_examinable ?? true,
    current: {
      quarterly: e.quarterly_grade,
      ww: e.ww_ps,
      pt: e.pt_ps,
      qa: e.qa_ps,
    },
    priors: priorsBySheet.get(e.grading_sheet_id)?.[e.section_student_id] ?? [],
  }));

  return rankAtRisk({ students, observations });
}
