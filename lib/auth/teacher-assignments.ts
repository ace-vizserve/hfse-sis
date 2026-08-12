// Helpers for checking teacher assignments.
// Assignments are the app-level answer to "who is this teacher responsible
// for?" — separate from the Supabase auth role (which only says "teacher").
//
// SINCE RELIEF TEACHERS (migrations 112/113) THERE ARE TWO QUESTIONS HERE, and
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
import { sgToday } from '@/lib/dates';

export type AssignmentRow = {
  id: string;
  teacher_user_id: string;
  section_id: string;
  subject_id: string | null;
  role: 'form_adviser' | 'subject_teacher';
};

/** How a teacher came by an assignment: they hold it, or they are covering it. */
export type AssignmentVia = 'substantive' | 'relief';

export type EffectiveAssignmentRow = AssignmentRow & {
  via: AssignmentVia;
  /** Set only when `via === 'relief'` — the teacher actually being covered. */
  covered_teacher_user_id?: string;
  /** Set only when `via === 'relief'` — for tracing back to the cover record. */
  relief_id?: string;
};

export async function loadAssignmentsForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<AssignmentRow[]> {
  const { data, error } = await supabase
    .from('teacher_assignments')
    .select('id, teacher_user_id, section_id, subject_id, role')
    .eq('teacher_user_id', userId);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssignmentRow[];
}

/**
 * Every assignment this user may act on: the ones they hold, plus the ones they
 * are actively covering for an absent colleague.
 *
 * Relief-derived rows carry the COVERED assignment's section, subject and role —
 * that is what access turns on — but `teacher_user_id` is set to the caller, so
 * a consumer filtering "my rows" behaves the same either way. The substantive
 * holder is preserved separately as `covered_teacher_user_id`.
 *
 * A cover is active when it has started and has not yet finished — `ended_on`
 * being the LAST day, so a substitute keeps access through the day cover ends
 * rather than losing it that morning mid-register. Falling out of that window
 * removes the row from this result on the next call, which is what takes the
 * access away; there is nothing else to revoke.
 *
 * The same window is enforced in SQL by `has_active_relief_for_assignment`
 * (migration 115). Both must agree: this decides what the app offers, that
 * decides what the database returns, and a disagreement shows up as a page
 * that renders with every panel empty.
 *
 * Cover lookup failures are NOT swallowed. A silent empty result here would
 * read as "this teacher covers nothing" and lock a substitute out of the class
 * they were asked to take, with no error anywhere.
 */
export async function loadEffectiveAssignmentsForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<EffectiveAssignmentRow[]> {
  // Singapore time. `new Date()` on a UTC server rolls the date at 08:00 SGT,
  // which would start and end cover eight hours late for a school that opens
  // at 08:15 — the register would be shut for the first period.
  const today = sgToday();

  const [substantive, reliefs] = await Promise.all([
    loadAssignmentsForUser(supabase, userId),
    supabase
      .from('assignment_reliefs')
      .select(
        `id, relief_teacher_user_id,
         assignment:teacher_assignments!inner(
           id, teacher_user_id, section_id, subject_id, role
         )`
      )
      .eq('relief_teacher_user_id', userId)
      .lte('started_on', today)
      .or(`ended_on.is.null,ended_on.gte.${today}`),
  ]);

  if (reliefs.error) throw new Error(reliefs.error.message);

  const out: EffectiveAssignmentRow[] = substantive.map((a) => ({
    ...a,
    via: 'substantive',
  }));

  // A teacher can hold a class AND be covering another teacher's slot for the
  // same subject, so dedupe on the assignment identity rather than assuming
  // the two sets are disjoint.
  const held = new Set(out.map((a) => a.id));

  type ReliefRow = {
    id: string;
    relief_teacher_user_id: string;
    assignment: AssignmentRow | AssignmentRow[] | null;
  };

  for (const row of (reliefs.data ?? []) as ReliefRow[]) {
    const assignment = Array.isArray(row.assignment)
      ? row.assignment[0]
      : row.assignment;
    if (!assignment || held.has(assignment.id)) continue;
    held.add(assignment.id);
    out.push({
      ...assignment,
      teacher_user_id: userId,
      covered_teacher_user_id: assignment.teacher_user_id,
      relief_id: row.id,
      via: 'relief',
    });
  }

  return out;
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
