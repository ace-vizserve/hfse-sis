import type {
  AssignmentRow,
  EffectiveAssignmentRow,
} from '@/lib/auth/teacher-assignments';
import type { Role } from '@/lib/auth/roles';
import { SIDEBAR_REGISTRY, type SidebarModule } from '@/lib/sidebar/registry';

// Which modules the switcher should hide from a teacher whose ASSIGNMENTS make
// them dead ends.
//
// The switcher filters on `ROUTE_ACCESS`, which knows only the role. Every
// teacher therefore sees Attendance and Evaluation tiles — but both modules are
// form-adviser work:
//
//   • attendance_records is gated `is_adviser_for_section` at the DB
//     (005_rls_teacher_scoping.sql), so a subject teacher cannot read a single
//     row of it.
//   • Evaluation is FCA write-ups only, and KD #114 explicitly removed subject
//     teachers from the module.
//
// So a subject-teacher-only user clicks either tile and lands on an empty list
// with nothing they can ever do — a promise the app can't keep.
//
// This comment used to add "that is not a data leak — RLS and the page guards
// hold." That was FALSE for two attendance pages, and the correction is worth
// keeping visible here rather than quietly deleting: `/attendance/[sectionId]`
// and its `/summary` sibling read marks through the SERVICE client (see the
// header of lib/attendance/queries.ts), so `attendance_daily`'s
// `is_adviser_for_section` RLS never applied, and neither page checked the
// assignment itself — a subject-teacher-only user who typed the URL saw the
// full register. Both now gate on `canReadAttendance` (KD #163). The claim
// holds again, but only because those guards were added; RLS alone never
// carried it on a service-client read path.
//
// The FCA/subject distinction lives in `teacher_assignments`, not in `Role`
// (KD #160), which is why this can't be expressed in ROUTE_ACCESS and needs the
// assignment rows.

/** Modules that only a form adviser can actually use. */
export const ADVISER_ONLY_MODULES: readonly SidebarModule[] = [
  'attendance',
  'evaluation',
] as const;

/**
 * Modules to hide from the switcher for this viewer.
 *
 * Only ever narrows the TEACHER role. Oversight roles work across classes and
 * hold no assignments at all — returning anything for them would hide the
 * modules from the people who most need them, which is the failure mode this
 * function has to avoid more than it has to avoid showing a dead tile.
 *
 * Being a form adviser ANYWHERE is enough. Per-section capability is Classroom's
 * job; this is a coarse "is this module ever useful to you" question, and a
 * teacher who advises one class and teaches subjects in five still needs
 * Attendance.
 *
 * "Anywhere" also means "in any ACADEMIC YEAR", because the caller's read
 * (lib/auth/teacher-assignments.ts::loadAssignmentsForUser) has no AY filter.
 * So a teacher holding only a PRIOR year's adviser row would be offered
 * modules that are empty for the current one — the dead end this function
 * exists to remove. Checked against production on 2026-07-30: every
 * `teacher_assignments` row sits in the current AY, so nothing is affected
 * today. If assignments are ever carried across a rollover, scope the read in
 * `resolveHiddenModules` alone — never in `loadAssignmentsForUser`, whose
 * other callers are authorization gates that resolve one specific section
 * (the grade-entry gate, lib/classroom/scope.ts) and must not change.
 */
export function hiddenModulesForTeacher(
  role: Role | null,
  assignments: readonly (AssignmentRow | EffectiveAssignmentRow)[]
): SidebarModule[] {
  if (role !== 'teacher') return [];

  // The two adviser-only modules stopped moving together when relief teachers
  // landed. A substitute covering a form adviser takes that class's attendance
  // but does not write its write-ups — the regular adviser keeps those while
  // away — so Attendance must appear for them and Evaluation must not.
  const isCover = (a: AssignmentRow | EffectiveAssignmentRow) =>
    'via' in a && a.via === 'relief';
  const advises = assignments.some((a) => a.role === 'form_adviser');
  const advisesSubstantively = assignments.some(
    (a) => a.role === 'form_adviser' && !isCover(a)
  );

  // Derived from ADVISER_ONLY_MODULES rather than naming the two modules
  // again, so adding a third adviser-only module forces a decision here about
  // which axis it belongs to instead of silently defaulting to visible.
  const requiresSubstantive: ReadonlySet<SidebarModule> = new Set([
    'evaluation',
  ]);
  return ADVISER_ONLY_MODULES.filter((m) =>
    requiresSubstantive.has(m) ? !advisesSubstantively : !advises
  );
}

/**
 * Which of the two teaching jobs this person actually holds.
 *
 * `hiddenModulesForTeacher` above answers a MODULE-shaped question ("is
 * Attendance ever useful to you"). This answers the finer one the home page
 * needs: adviser work and subject work are different jobs, and an action that
 * belongs to one must not be offered to someone who only does the other.
 *
 * The case that forced this: a form-adviser-only teacher was offered "Enter
 * grades". Not a dead link — RLS lets an adviser READ every subject's sheet in
 * their section (`is_teacher_for_sheet`, migration 005) — but the write gate is
 * application code (`isSubjectTeacher` in
 * app/api/grading-sheets/[id]/entries/[entryId]/route.ts), which a `form_adviser`
 * row can never satisfy. So the button landed on a fully populated, entirely
 * read-only grid. A module-level check could never catch that, because Markbook
 * is genuinely useful to both jobs — it is the ACTION that isn't.
 *
 * Same two invariants as its sibling above:
 *  - never narrows a non-teacher role (oversight roles hold no assignments, so
 *    deriving anything from them would strip the people who need it most);
 *  - "anywhere" spans academic years, inheriting the no-AY-filter caveat
 *    documented on `hiddenModulesForTeacher`.
 */
export type TeachingProfile = {
  /**
   * Does adviser work somewhere — attendance, the class overview — whether the
   * class is theirs or one they are covering.
   */
  advises: boolean;
  /**
   * Is the adviser OF RECORD somewhere, cover excluded.
   *
   * Split from `advises` by relief teachers (migrations 112/113). A substitute
   * covering an adviser takes that class's attendance, but the regular adviser
   * still writes the write-ups and the report card comment while they are away.
   * So "Mark attendance" turns on `advises` and "Write evaluation" turns on
   * this — offering the second to a substitute would land them on a page that
   * 404s.
   */
  advisesSubstantively: boolean;
  /** Holds at least one `subject_teacher` row — the only job that may enter grades. */
  teachesSubject: boolean;
};

/** A role that holds no teaching assignments at all. */
export const NO_TEACHING_PROFILE: TeachingProfile = {
  advises: false,
  advisesSubstantively: false,
  teachesSubject: false,
};

export function teachingProfileFor(
  role: Role | null,
  assignments: readonly (AssignmentRow | EffectiveAssignmentRow)[]
): TeachingProfile {
  if (role !== 'teacher') return NO_TEACHING_PROFILE;
  const isCover = (a: AssignmentRow | EffectiveAssignmentRow) =>
    'via' in a && a.via === 'relief';
  return {
    advises: assignments.some((a) => a.role === 'form_adviser'),
    advisesSubstantively: assignments.some(
      (a) => a.role === 'form_adviser' && !isCover(a)
    ),
    teachesSubject: assignments.some((a) => a.role === 'subject_teacher'),
  };
}

/**
 * Does this link lead into a module we're hiding from this viewer?
 *
 * Modules are offered in FIVE places, not one — the sidebar switcher, the
 * topbar switcher on `/` and `/account`, the quick-action row on `/`, the
 * account shortcuts, and the Cmd+K palette. Hiding a tile in the switcher
 * while "Mark attendance" still sits on the home page is worse than not
 * hiding it at all: the dead end is still reachable, just harder to explain.
 * Every one of those surfaces routes its filtering through this.
 *
 * Matches on the module's own `primaryHref` prefix, so `/attendance/sections`
 * and `/attendance/[id]?date=…` are caught alongside `/attendance` itself.
 */
export function isHiddenModuleHref(
  href: string,
  hidden: readonly SidebarModule[]
): boolean {
  if (hidden.length === 0) return false;
  const path = href.split(/[?#]/)[0];
  return hidden.some((m) => {
    const base = SIDEBAR_REGISTRY[m].primaryHref;
    return path === base || path.startsWith(`${base}/`);
  });
}
