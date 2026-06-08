import type { SupabaseClient } from '@supabase/supabase-js';

// Shared FCA-comment completeness logic — the single source of truth for both
// the publish-readiness checklist (per-term advisory display) and the publish
// mutation's HARD gate (cumulative 1..N enforcement). Keeping them on one
// helper means the gate the registrar sees and the gate the server enforces
// can never drift.
//
// Rules (KD #49 + KD #120):
//   • A term's report-card comment is "done" when EVERY active-roster student
//     for that term has a SUBMITTED + NON-EMPTY write-up.
//   • Roster is resolved by the section's current active `section_students`
//     rows (`enrollment_status != 'withdrawn'`), tallied by `student_id` — the
//     write-up's denormalized `section_id` does NOT follow a mid-year transfer
//     (KD #67), so we match write-ups by `(term_id, student_id)`.
//   • PER-TERM ROSTER CORRECTNESS: a student is only required to have a
//     term-T comment if they were enrolled during/by term T — i.e. their
//     `section_students.enrollment_date` is null (always-enrolled) OR <= term
//     T's `end_date`. A late enrollee who joined after term T ended could
//     never have written a term-T comment, so requiring one is a false
//     publish-block. Date compare is date-only `yyyy-MM-dd` string compare
//     (both are date columns).
//   • T4 has no FCA comment block (KD #49) — never gated.

export type RosterStudent = {
  /** section_students.id */
  sectionStudentId: string;
  /** students.id — null only for an unsynced/orphaned roster row. */
  studentId: string | null;
  indexNumber: number | null;
  name: string;
  /**
   * section_students.enrollment_date (date-only `yyyy-MM-dd`), or null for an
   * always-enrolled student. Drives per-term roster correctness — a student is
   * required for term T only if this is null or <= term T's end_date.
   */
  enrollmentDate: string | null;
};

export type WriteupLite = {
  student_id: string;
  writeup: string | null;
  submitted: boolean;
};

/**
 * Pure predicate: given a term's active roster and that term's write-up rows,
 * return the students whose comment is NOT done (no row, not submitted, or
 * empty). An orphaned roster row (no studentId) is always "missing" — there is
 * no student to attach a write-up to.
 */
export function missingCommentStudents(
  roster: RosterStudent[],
  writeups: WriteupLite[]
): RosterStudent[] {
  const byStudent = new Map<string, WriteupLite>(
    writeups.map((w) => [w.student_id, w])
  );
  return roster.filter((s) => {
    if (!s.studentId) return true;
    const w = byStudent.get(s.studentId);
    return (
      !w || w.submitted !== true || !w.writeup || w.writeup.trim().length === 0
    );
  });
}

/**
 * Load the section's active roster (active + late_enrollee) for the
 * completeness check, resolved per KD #120 (tally by student_id).
 */
export async function loadActiveRoster(
  service: SupabaseClient,
  sectionId: string
): Promise<RosterStudent[]> {
  const { data: enrolments } = await service
    .from('section_students')
    .select(
      'id, index_number, enrollment_status, enrollment_date, student:students(id, last_name, first_name)'
    )
    .eq('section_id', sectionId)
    .in('enrollment_status', ['active', 'late_enrollee'])
    .order('index_number');

  return (enrolments ?? []).map((e) => {
    const s = Array.isArray(e.student) ? e.student[0] : e.student;
    const rawDate = (e.enrollment_date as string | null) ?? null;
    return {
      sectionStudentId: e.id as string,
      indexNumber: (e.index_number as number | null) ?? null,
      studentId: (s?.id as string | undefined) ?? null,
      name: s ? `${s.last_name}, ${s.first_name}` : '(unknown)',
      // Normalize to date-only `yyyy-MM-dd` for string comparison against the
      // term's date-only end_date.
      enrollmentDate: rawDate ? rawDate.slice(0, 10) : null,
    };
  });
}

/**
 * Per-term roster correctness: keep only students who were enrolled during/by
 * the term ending on `termEndDate`. A null `enrollmentDate` = always-enrolled
 * (kept); a date <= `termEndDate` joined on or before the term ended (kept); a
 * later date is a late enrollee who joined after the term ended (dropped — they
 * could never have a comment for it). When `termEndDate` is null (term has no
 * dated window) we keep everyone — we can't prove anyone joined later.
 */
export function rosterRequiredForTerm(
  roster: RosterStudent[],
  termEndDate: string | null
): RosterStudent[] {
  if (!termEndDate) return roster;
  const end = termEndDate.slice(0, 10);
  return roster.filter(
    (s) => s.enrollmentDate === null || s.enrollmentDate <= end
  );
}

/**
 * Per-term comment completeness for a section. Loads the active roster + the
 * term's submitted/non-empty write-ups, then returns the missing students.
 * Pass a pre-loaded `roster` to avoid re-querying (the readiness route already
 * has it). `termEndDate` enables per-term roster correctness — only students
 * enrolled during/by the term are required (see `rosterRequiredForTerm`).
 */
export async function commentCompletenessForTerm(
  service: SupabaseClient,
  sectionId: string,
  termId: string,
  roster?: RosterStudent[],
  termEndDate?: string | null
): Promise<{ roster: RosterStudent[]; missing: RosterStudent[] }> {
  const activeRoster = roster ?? (await loadActiveRoster(service, sectionId));
  // Restrict to students who were actually enrolled during/by this term.
  const requiredRoster = rosterRequiredForTerm(
    activeRoster,
    termEndDate ?? null
  );
  const studentIds = requiredRoster
    .map((s) => s.studentId)
    .filter((id): id is string => !!id);

  if (studentIds.length === 0) {
    // Nobody required (or only orphan rows) → every (orphan) row is missing.
    return {
      roster: requiredRoster,
      missing: missingCommentStudents(requiredRoster, []),
    };
  }

  // Match by the section's current active roster (student_id), NOT the
  // write-up's denormalized section_id (KD #67/#120).
  const { data: writeupRows } = await service
    .from('evaluation_writeups')
    .select('student_id, writeup, submitted')
    .eq('term_id', termId)
    .in('student_id', studentIds);

  const writeups = (writeupRows ?? []) as WriteupLite[];
  return {
    roster: requiredRoster,
    missing: missingCommentStudents(requiredRoster, writeups),
  };
}

export type CumulativeTerm = {
  id: string;
  term_number: number;
  /** Term's date-only `yyyy-MM-dd` end_date — drives per-term roster correctness. */
  end_date?: string | null;
  /** Term's free-text virtue theme; null/blank counts as a gap when this term is displayed (KD #49/#129). */
  virtue_theme?: string | null;
};

export type CumulativeGap = {
  termId: string;
  termNumber: number;
  missing: RosterStudent[];
  /** True when the term's virtue_theme is null/blank — the comment-box heading would drop its HFSE-Virtues framing. */
  virtueMissing: boolean;
};

/**
 * HARD-GATE input: the cumulative set of comment terms a publish of `term N`
 * will display. A published report card for interim term N shows the FCA
 * comment boxes for terms 1..N (KD #49) — so publishing N requires comments
 * for every term 1..min(N, 3). Future terms are never required; T4 is exempt
 * entirely (no FCA block).
 *
 * A term is a gap when ≥1 student is missing a submitted/non-empty write-up
 * OR the term's `virtue_theme` is null/blank (the comment-box heading would
 * otherwise render without its HFSE-Virtues framing — KD #49/#129).
 *
 * Returns the list of terms 1..N that are still incomplete. An empty array
 * means the cumulative comment requirement is satisfied (publish allowed).
 */
export async function cumulativeCommentGaps(
  service: SupabaseClient,
  sectionId: string,
  allTerms: CumulativeTerm[],
  viewingTermNumber: number
): Promise<CumulativeGap[]> {
  // T4 (or anything ≥4): no FCA comment block, no comment gate.
  if (viewingTermNumber >= 4) return [];

  const requiredTerms = allTerms
    .filter((t) => t.term_number >= 1 && t.term_number <= viewingTermNumber)
    .sort((a, b) => a.term_number - b.term_number);

  // Roster is the same active set for every term — load once.
  const roster = await loadActiveRoster(service, sectionId);

  const gaps: CumulativeGap[] = [];
  for (const t of requiredTerms) {
    const { missing } = await commentCompletenessForTerm(
      service,
      sectionId,
      t.id,
      roster,
      t.end_date ?? null
    );
    const virtueMissing = !t.virtue_theme?.trim();
    if (missing.length > 0 || virtueMissing) {
      gaps.push({
        termId: t.id,
        termNumber: t.term_number,
        missing,
        virtueMissing,
      });
    }
  }
  return gaps;
}
