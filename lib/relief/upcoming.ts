import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { reliefStatus } from '@/lib/relief/display';
import { subjectDisplayNameResolver } from '@/lib/sis/subjects/display-names-for-ay';
import type { AssignmentRole } from '@/lib/schemas/teacher-assignment';

// "What am I booked to cover?" — the substitute's own heads-up.
//
// ⚠ THIS IS NOT AN ACCESS ANSWER, AND NOTHING MAY TREAT IT AS ONE.
// Every row this returns is cover that has NOT started. The teacher named on it
// can open none of these classes today — no register, no mark sheet, no roster.
// If you find yourself passing this into a permission check, an `isSubjectTeacher`,
// a scope resolver or an RLS-shaped decision, stop: the only loader that answers
// "may this person act" is `loadEffectiveAssignmentsForUser`
// (lib/auth/teacher-assignments.ts), and it drops these rows on purpose.
//
// WHY IT EXISTS. Cover gained a start date in migration 123, and until that date
// the class is invisible to the substitute — correct for acting, useless for
// preparing. Mr Ace, 2026-08-24: a teacher should see what they are booked to
// cover so they can get ready for it. Christina had asked for the same thing
// from the other end on 2026-08-21 — she wanted relief monitoring precisely so
// an absent teacher's lesson could be handed over, which cannot happen if the
// stand-in learns about the class on the morning.
//
// It reads with the CALLER'S client, not the service client, and that works
// because migration 123 deliberately left the `teacher_assignments_scoped_read`
// policy unwindowed. Reading the row is not access to the class; the three
// `is_*_for_*` helpers carry the window and gate everything that matters.

export type UpcomingCover = {
  assignmentId: string;
  sectionId: string;
  /** "P4 Diligence" — how staff say it. */
  sectionName: string;
  /** Null for a form-class cover; the subject's name otherwise. */
  subjectName: string | null;
  role: AssignmentRole;
  /** First day they may act. Never null on a row returned here. */
  startedOn: string;
  endedOn: string | null;
};

type Raw = {
  id: string;
  role: AssignmentRole;
  relief_started_on: string | null;
  relief_ended_on: string | null;
  section:
    | {
        id: string;
        name: string;
        academic_year_id: string;
        level: { code: string | null } | { code: string | null }[] | null;
      }
    | Array<{
        id: string;
        name: string;
        academic_year_id: string;
        level: { code: string | null } | { code: string | null }[] | null;
      }>
    | null;
  subject: { id: string; name: string } | { id: string; name: string }[] | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/**
 * Cover booked for this user that has not started yet, soonest first.
 *
 * Returns `[]` on any failure rather than throwing — a heads-up panel is a
 * convenience, and it must never be the reason a teacher's home page 500s.
 */
export async function loadUpcomingCoverForUser(
  supabase: SupabaseClient,
  userId: string,
  academicYearId?: string
): Promise<UpcomingCover[]> {
  const query = supabase
    .from('teacher_assignments')
    .select(
      `id, role, relief_started_on, relief_ended_on,
       section:sections!inner(id, name, academic_year_id, level:levels(code)),
       subject:subjects(id, name)`
    )
    .eq('relief_teacher_user_id', userId)
    // A row with no start date is already live, so it is not "upcoming" and
    // belongs to the access loader instead.
    .not('relief_started_on', 'is', null);

  const { data, error } = academicYearId
    ? await query.eq('section.academic_year_id', academicYearId)
    : await query;

  if (error) {
    console.error('[upcoming-cover] read failed:', error.message);
    return [];
  }

  const rows = (data ?? []) as unknown as Raw[];

  // What each subject is called in the year the COVER is in (migration 137).
  //
  // Resolved per row off `section.academic_year_id`, not off the
  // `academicYearId` parameter — that parameter is optional, and when a caller
  // omits it these rows can span years. Reading the year from the row is right
  // either way and cannot silently label a cover with another year's name.
  const resolveName = await subjectDisplayNameResolver(
    supabase,
    rows.map((r) => one(r.section)?.academic_year_id),
    rows.map((r) => one(r.subject)?.id)
  );

  return rows
    .flatMap<UpcomingCover>((a) => {
      const section = one(a.section);
      const startedOn = a.relief_started_on;
      if (!section || !startedOn) return [];

      // The same predicate the gate uses, so this panel can never advertise a
      // class the gate would already have opened — or one it has finished with.
      if (reliefStatus(startedOn, a.relief_ended_on) !== 'scheduled') return [];

      const level = one(section.level);
      return [
        {
          assignmentId: a.id,
          sectionId: section.id,
          sectionName: level?.code
            ? `${level.code} ${section.name}`
            : section.name,
          subjectName: one(a.subject)
            ? resolveName(section.academic_year_id, one(a.subject)!)
            : null,
          role: a.role,
          startedOn,
          endedOn: a.relief_ended_on,
        },
      ];
    })
    .sort((x, y) => x.startedOn.localeCompare(y.startedOn));
}
