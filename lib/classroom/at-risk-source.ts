import {
  rankAtRisk,
  type AtRiskObservation,
  type AtRiskStudent,
  type AtRiskStudentRef,
} from '@/lib/classroom/at-risk';
import { loadPriorTermGrades, sumTaken } from '@/lib/markbook/grade-diff';
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

/**
 * Stored as decimals (0.40), printed as percents on the panel's measure pills.
 * One set per subject since migration 080, so they cannot differ by term.
 */
type ConfigLite = {
  ww_weight: number | string;
  pt_weight: number | string;
  qa_weight: number | string;
};

type SheetRow = {
  id: string;
  subject_id: string;
  ww_totals: (number | null)[] | null;
  pt_totals: (number | null)[] | null;
  qa_total: number | null;
  subject: SubjectLite | SubjectLite[] | null;
  config: ConfigLite | ConfigLite[] | null;
};

type EntryRow = {
  section_student_id: string;
  grading_sheet_id: string;
  quarterly_grade: number | null;
  ww_ps: number | null;
  pt_ps: number | null;
  qa_ps: number | null;
  ww_scores: (number | null)[] | null;
  pt_scores: (number | null)[] | null;
  qa_score: number | null;
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
    .select('term_number, label')
    .eq('id', termId)
    .maybeSingle();
  const termRow = term as { term_number: number; label: string } | null;
  const termNumber = termRow?.term_number;
  const currentTermLabel = termRow?.label ?? 'This term';
  // A term id that names no term is a broken request, not an empty class.
  if (!termNumber) return [];
  // Term 1 has nothing behind it to compare against. That used to return an
  // empty list, which was right while this was a triage list and wrong the
  // moment it became the whole roster: in Term 1 an adviser should see their
  // class with nothing flagged, not a blank panel. Everything below still
  // runs; `loadPriorTermGrades` simply finds no earlier terms, so no student
  // has any drops.

  // ERRORS THROW, THEY DO NOT DEGRADE TO AN EMPTY LIST. Both of these used to
  // be read with the error discarded, so a failed fetch reached the adviser as
  // "nobody in this class is at risk" — the most reassuring possible rendering
  // of a broken query, on a surface whose entire job is to say who needs a
  // phone call home. The route above catches, logs the step and returns a 500,
  // which is a panel that says something went wrong instead of a panel that
  // lies.
  const [
    { data: rosterRaw, error: rosterError },
    { data: sheetsRaw, error: sheetsError },
  ] = await Promise.all([
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
      .select(
        'id, subject_id, ww_totals, pt_totals, qa_total, subject:subjects(name, is_examinable), config:subject_configs(ww_weight, pt_weight, qa_weight)'
      )
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
  if (rosterError) throw new Error(`roster: ${rosterError.message}`);
  if (sheetsError) throw new Error(`grading sheets: ${sheetsError.message}`);

  const roster = (rosterRaw ?? []) as unknown as RosterRow[];
  const sheets = (sheetsRaw ?? []) as unknown as SheetRow[];
  // Genuinely empty is a real answer — a class with no roster or no sheets for
  // the term has nobody to flag. It only means that now the errors are gone.
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
          'section_student_id, grading_sheet_id, quarterly_grade, ww_ps, pt_ps, qa_ps, ww_scores, pt_scores, qa_score'
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

  const sheetById = new Map(sheets.map((s) => [s.id, s]));
  const subjectBySheet = new Map(
    sheets.map((s) => [
      s.id,
      firstOf(s.subject) ?? { name: 'Subject', is_examinable: true },
    ])
  );
  const priorsBySheet = new Map(
    sheets.map((s, i) => [s.id, priorsBySubject[i]])
  );
  // Decimals to whole percents, so the pills read "30%" rather than "0.3".
  // Dropped entirely when a sheet has no config rather than guessed at — a
  // wrong weight beside a figure is worse than no weight at all.
  const weightsBySheet = new Map(
    sheets.map((s) => {
      const c = firstOf(s.config);
      return [
        s.id,
        c
          ? {
              ww: Math.round(Number(c.ww_weight) * 100),
              pt: Math.round(Number(c.pt_weight) * 100),
              qa: Math.round(Number(c.qa_weight) * 100),
            }
          : undefined,
      ] as const;
    })
  );

  const observations: AtRiskObservation[] = entries.map((e) => ({
    sectionStudentId: e.section_student_id,
    subject: subjectBySheet.get(e.grading_sheet_id)?.name ?? 'Subject',
    // Defaults to examinable when a sheet somehow has no subject row: showing
    // a number where a band belongs is a smaller lie than the reverse, which
    // would invent a letter for a real percentage.
    isExaminable: subjectBySheet.get(e.grading_sheet_id)?.is_examinable ?? true,
    weights: weightsBySheet.get(e.grading_sheet_id),
    current: {
      quarterly: e.quarterly_grade,
      ww: e.ww_ps,
      pt: e.pt_ps,
      qa: e.qa_ps,
    },
    // What this term's percentages are percentages OF. Same Blank ≠ Zero rule
    // as the percentage itself — a slot not taken counts in neither half.
    currentMarks: (() => {
      const sheet = sheetById.get(e.grading_sheet_id);
      const ww = sumTaken(e.ww_scores, sheet?.ww_totals ?? null);
      const pt = sumTaken(e.pt_scores, sheet?.pt_totals ?? null);
      return {
        ww,
        pt,
        qa: {
          scored: e.qa_score ?? null,
          max: e.qa_score == null ? null : (sheet?.qa_total ?? null),
        },
      };
    })(),
    priors: priorsBySheet.get(e.grading_sheet_id)?.[e.section_student_id] ?? [],
  }));

  return rankAtRisk({ students, observations, currentTermLabel });
}
