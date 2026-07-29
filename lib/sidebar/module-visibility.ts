import type { AssignmentRow } from '@/lib/auth/teacher-assignments';
import type { Role } from '@/lib/auth/roles';
import type { SidebarModule } from '@/lib/sidebar/registry';

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
// with nothing they can ever do. That is not a data leak — RLS and the page
// guards hold — but it is a promise the app can't keep.
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
 */
export function hiddenModulesForTeacher(
  role: Role | null,
  assignments: readonly AssignmentRow[]
): SidebarModule[] {
  if (role !== 'teacher') return [];
  const advisesSomewhere = assignments.some((a) => a.role === 'form_adviser');
  return advisesSomewhere ? [] : [...ADVISER_ONLY_MODULES];
}
