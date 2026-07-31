import { isRouteAllowed, type Role } from '@/lib/auth/roles';
import {
  isHiddenModuleHref,
  NO_TEACHING_PROFILE,
  type TeachingProfile,
} from '@/lib/sidebar/module-visibility';
import type { SidebarModule } from '@/lib/sidebar/registry';

export type QuickAction = { label: string; href: string };

/**
 * Which teaching job an action belongs to, for the rows where that differs.
 *
 * `teacher` is one RBAC role covering two jobs (KD #160), so a per-ROLE table
 * cannot express "advisers do this, subject teachers do that" — which is how a
 * form adviser came to be offered "Enter grades", an action whose destination
 * is entirely read-only for them (the write gate is `isSubjectTeacher` in
 * app/api/grading-sheets/[id]/entries/[entryId]/route.ts, which no
 * `form_adviser` row satisfies).
 *
 * Omitted on every non-teacher row: oversight roles hold no assignments, and a
 * requirement there would silently strip their actions.
 */
type JobRequirement = 'adviser' | 'subject';

type QuickActionRow = QuickAction & { requires?: JobRequirement };

/** The one action offered to a teacher with no assignments at all. */
const NO_ASSIGNMENTS_FALLBACK: QuickAction = {
  label: 'Open Classroom',
  href: '/classroom',
};

// Exported for the drift test only: `getQuickActions` FILTERS, so a row whose
// href a role can't open would vanish silently. The test compares the raw
// table against `isRouteAllowed` to catch that at build time instead.
export const QUICK_ACTIONS: Record<Role, QuickActionRow[]> = {
  teacher: [
    // Subject teachers only. An adviser reaches every sheet in their section
    // but may not encode a single score, and the sheet tells them so on
    // arrival ("only the assigned subject teacher enters the scores") — so
    // offering it here promised work they cannot do.
    { label: 'Enter grades', href: '/markbook/grading', requires: 'subject' },
    // Both adviser-only at the DB (`is_adviser_for_section`, migration 005).
    // `hiddenModules` already removed these for a teacher who advises nowhere;
    // the requirement states it directly instead of relying on a module-shaped
    // filter to imply it.
    {
      label: 'Mark attendance',
      href: '/attendance/sections',
      requires: 'adviser',
    },
    { label: 'Write evaluation', href: '/evaluation', requires: 'adviser' },
  ],
  academic_coordinator: [
    { label: 'Review applications', href: '/admissions/applications' },
    // Not "Lock overdue sheets": the grading list does support locking (bulk
    // "Lock selected" + a per-row action) but has no overdue filter to
    // deep-link, so the old label promised a pre-filtered queue that isn't
    // there.
    { label: 'Lock grading sheets', href: '/markbook/grading' },
    { label: 'Assign a section', href: '/records/unsynced' },
  ],
  // school_admin and superadmin are pointed at two DIFFERENT document queues —
  // pre-enrolment application validation vs post-enrolment renewals — so the
  // labels have to say which. They both read "Validate documents" before.
  school_admin: [
    {
      label: 'Validate application documents',
      href: '/admissions/document-validation',
    },
    { label: 'AY Setup', href: '/sis/ay-setup' },
    { label: 'Manage staff', href: '/sis/admin/staff' },
  ],
  superadmin: [
    {
      label: 'Validate renewal documents',
      href: '/p-files/document-validation',
    },
    { label: 'Manage staff', href: '/sis/admin/staff' },
    { label: 'School config', href: '/sis/admin/school-config' },
  ],
  // These two roles redirect away from `/` before this ever renders
  // (app/(dashboard)/page.tsx + layout.tsx) — kept here only so the
  // Record<Role, ...> map is exhaustive and getQuickActions is total.
  p_file_officer: [],
  admissions: [],
};

// Drops actions this viewer can't use, on two independent grounds:
//
//  1. ROLE — the href must pass the same `isRouteAllowed` gate the proxy and
//     the sidebar use. The table above happens to be correct today, but
//     nothing stopped a wrong href from shipping: the proxy would simply
//     bounce the user, with no compile-time or test-time signal. Mirrors
//     lib/account/shortcuts.ts, which has always checked this.
//  2. ASSIGNMENTS — a subject-teacher-only user must not be offered "Mark
//     attendance" on the home page while the same module is hidden from the
//     switcher. Callers MUST pass `hiddenModules` (from resolveHiddenModules);
//     the default only exists for roles that hold no assignments.
//  3. THE JOB — `teacher` covers two jobs sharing one role, so an action can be
//     wrong for a viewer whose role is right. This is the finer check; it
//     subsumes (2) for teachers, since both adviser-only modules now also carry
//     an explicit `requires: 'adviser'`. (2) is kept anyway — it still serves
//     the switchers, and two independent filters agreeing is cheap.
export function getQuickActions(
  role: Role,
  hiddenModules: readonly SidebarModule[] = [],
  profile: TeachingProfile = NO_TEACHING_PROFILE
): QuickAction[] {
  const actions = QUICK_ACTIONS[role]
    .filter((a) => {
      if (a.requires === 'adviser' && !profile.advises) return false;
      if (a.requires === 'subject' && !profile.teachesSubject) return false;
      return true;
    })
    .filter(
      (a) =>
        isRouteAllowed(a.href, role) &&
        !isHiddenModuleHref(a.href, hiddenModules)
    )
    .map(({ label, href }) => ({ label, href }));

  // A teacher with no assignments matches nothing above, and QuickActionsRow
  // renders null for an empty list — leaving a header with a blank right-hand
  // side. Give them the one destination that always makes sense. Same problem
  // and same remedy as lib/account/shortcuts.ts:36-64.
  //
  // Deliberately teacher-only: an oversight role reaching zero actions would
  // mean the table itself is wrong, and papering over that with a fallback
  // would hide it.
  if (actions.length === 0 && role === 'teacher') {
    return [NO_ASSIGNMENTS_FALLBACK];
  }
  return actions;
}
