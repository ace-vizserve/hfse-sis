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

import { sgToday } from '@/lib/dates';

const ASSIGNMENT_COLUMNS =
  'id, teacher_user_id, section_id, subject_id, role, relief_teacher_user_id, relief_started_on, relief_ended_on';

export type AssignmentRow = {
  id: string;
  teacher_user_id: string;
  section_id: string;
  subject_id: string | null;
  role: 'form_adviser' | 'subject_teacher';
  /** Who is covering this class, or null when nobody is. */
  relief_teacher_user_id?: string | null;
  /** First day the cover applies. Null = live from whenever it was set. */
  relief_started_on?: string | null;
  /** Last day the cover applies, inclusive. Null = open-ended. */
  relief_ended_on?: string | null;
};

/**
 * Does a cover window include today?
 *
 * ⚠ THIS IS ONE HALF OF A PAIR. The other half is `public.relief_is_live` in
 * migration 123, and the two MUST agree. Migration 115 exists only because a
 * date window in SQL and the same window in the app disagreed, so a teacher
 * could act in one layer and not the other.
 *
 * The pair is pinned by `__tests__/auth/relief-window-parity.test.ts`, which
 * checks this truth table AND that every relief test in the SQL calls the
 * shared function rather than inlining the comparison. If you change the rule
 * here, change it there in the same commit.
 *
 * Both bounds are inclusive, and null means unbounded in that direction:
 * null start = live from whenever it was set (every pre-123 row), null end =
 * open-ended, "until she is back".
 */
export function isReliefLive(
  startedOn: string | null | undefined,
  endedOn: string | null | undefined,
  today: string = sgToday()
): boolean {
  if (startedOn && startedOn > today) return false;
  if (endedOn && endedOn < today) return false;
  return true;
}

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
 * Cover CARRIES A DATE WINDOW since migration 123 — `relief_started_on` /
 * `relief_ended_on`, either or both null. A cover whose start has not arrived
 * grants nothing yet; one whose end has passed grants nothing any more.
 * Clearing `relief_teacher_user_id` still ends a cover immediately.
 *
 * ⚠ THE WINDOW IS APPLIED HERE AND NOT LEFT TO RLS, and that is deliberate.
 * Five callers pass the SERVICE client, which bypasses RLS outright
 * (lib/classroom/queries.ts, lib/attendance/adviser-dashboard-queries.ts,
 * app/api/attendance/daily/route.ts, app/api/attendance/[sectionId]/export/route.ts,
 * app/(classroom)/classroom/page.tsx). Rely on the policy alone and all five
 * would hand a substitute access to a class they are not covering yet.
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
  // somehow both, you are the teacher, not the substitute — and holding has no
  // window, so a lapsed cover on your own class never costs you access to it.
  //
  // The window is filtered here rather than in the query above: expressing it
  // in PostgREST needs an `or(and(or(…),or(…)))` nested three deep, and the row
  // count per teacher is tiny.
  const today = sgToday();

  // The generic is load-bearing: without it the return type is inferred from
  // the first branch alone and the relief branch then fails to assign.
  return (
    (data ?? []) as unknown as AssignmentRow[]
  ).flatMap<EffectiveAssignmentRow>((a) => {
    if (a.teacher_user_id === userId) {
      return [{ ...a, via: 'substantive' as const }];
    }
    if (!isReliefLive(a.relief_started_on, a.relief_ended_on, today)) {
      return [];
    }
    return [
      {
        ...a,
        teacher_user_id: userId,
        covered_teacher_user_id: a.teacher_user_id,
        via: 'relief' as const,
      },
    ];
  });
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
