// Helpers for checking teacher assignments.
// Assignments are the app-level answer to "who is this teacher responsible
// for?" — separate from the Supabase auth role (which only says "teacher").
//
// SINCE RELIEF TEACHERS (migration 117) THERE ARE TWO QUESTIONS HERE, and
// they no longer have the same answer:
//
//   loadAssignmentsForUser           — the classes this teacher HOLDS
//   loadEffectiveAssignmentsForUser  — the classes this teacher MAY WORK ON,
//                                      including any they are covering
//
// Use the effective loader for anything that decides what someone can DO. Use
// the plain loader for anything that decides WHOSE NAME APPEARS — the regular
// teacher stays the name of record on report cards, grading sheets and the
// masterfile for the whole of a cover, so those surfaces must not see the
// substitute. `__tests__/auth/assignment-read-classification.test.ts` classifies
// every reader in the codebase and fails on a new unclassified one.

import type { SupabaseClient } from '@supabase/supabase-js';

const ASSIGNMENT_COLUMNS =
  'id, teacher_user_id, section_id, subject_id, role, relief_teacher_user_id';

export type AssignmentRow = {
  id: string;
  teacher_user_id: string;
  section_id: string;
  subject_id: string | null;
  role: 'form_adviser' | 'subject_teacher';
  /** Who is covering this class right now, or null when nobody is. */
  relief_teacher_user_id?: string | null;
};

/** How a teacher came by an assignment: they hold it, or they are covering it. */
export type AssignmentVia = 'substantive' | 'relief';

export type EffectiveAssignmentRow = AssignmentRow & {
  via: AssignmentVia;
  /** Set only when `via === 'relief'` — the teacher actually being covered. */
  covered_teacher_user_id?: string;
};

export async function loadAssignmentsForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<AssignmentRow[]> {
  const { data, error } = await supabase
    .from('teacher_assignments')
    .select(ASSIGNMENT_COLUMNS)
    .eq('teacher_user_id', userId);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AssignmentRow[];
}

/**
 * Every assignment this user may act on: the ones they hold, plus the ones they
 * are covering for an absent colleague.
 *
 * Cover is a switch, not a period — `relief_teacher_user_id` is set while
 * somebody is covering and cleared when they stop (migration 117). Clearing it
 * is what takes the access away; there is nothing else to revoke and no date
 * window for this and the database to disagree about.
 *
 * Relief-derived rows carry the COVERED assignment's section, subject and role —
 * that is what access turns on — but `teacher_user_id` is set to the caller, so
 * a consumer filtering "my rows" behaves the same either way. The substantive
 * holder is preserved separately as `covered_teacher_user_id`.
 */
export async function loadEffectiveAssignmentsForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<EffectiveAssignmentRow[]> {
  // One query, both arms. `or` across two columns of the SAME table is fine —
  // what PostgREST cannot do is `or` across a root column and an embedded
  // table's column, which is precisely why cover being a column and not a
  // joined table removes the constraint.
  const { data, error } = await supabase
    .from('teacher_assignments')
    .select(ASSIGNMENT_COLUMNS)
    .or(`teacher_user_id.eq.${userId},relief_teacher_user_id.eq.${userId}`);

  if (error) throw new Error(error.message);

  // A teacher can hold one class and cover another, so decide row by row rather
  // than assuming the two sets are disjoint. Holding it wins: if you are
  // somehow both, you are the teacher, not the substitute.
  return ((data ?? []) as unknown as AssignmentRow[]).map((a) =>
    a.teacher_user_id === userId
      ? { ...a, via: 'substantive' as const }
      : {
          ...a,
          teacher_user_id: userId,
          covered_teacher_user_id: a.teacher_user_id,
          via: 'relief' as const,
        }
  );
}

// True if the user is the subject teacher for (section, subject) — whether they
// hold the slot or are covering it.
export function isSubjectTeacher(
  assignments: Array<AssignmentRow | EffectiveAssignmentRow>,
  sectionId: string,
  subjectId: string
): boolean {
  return assignments.some(
    (a) =>
      a.role === 'subject_teacher' &&
      a.section_id === sectionId &&
      a.subject_id === subjectId
  );
}

// Pairs of (section_id, subject_id) the user is allowed to see as a subject
// teacher. Used to filter the grading sheet list for non-manager roles.
export function subjectTeacherPairs(
  assignments: Array<AssignmentRow | EffectiveAssignmentRow>
): Array<{ section_id: string; subject_id: string }> {
  return assignments
    .filter((a) => a.role === 'subject_teacher' && a.subject_id != null)
    .map((a) => ({
      section_id: a.section_id,
      subject_id: a.subject_id as string,
    }));
}

/** True if any of these assignments is one the teacher is only covering. */
export function hasActiveCover(
  assignments: Array<AssignmentRow | EffectiveAssignmentRow>
): boolean {
  return assignments.some((a) => 'via' in a && a.via === 'relief');
}
