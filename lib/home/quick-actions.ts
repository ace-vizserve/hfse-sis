import { isRouteAllowed, type Role } from '@/lib/auth/roles';
import { isHiddenModuleHref } from '@/lib/sidebar/module-visibility';
import type { SidebarModule } from '@/lib/sidebar/registry';

export type QuickAction = { label: string; href: string };

// Exported for the drift test only: `getQuickActions` FILTERS, so a row whose
// href a role can't open would vanish silently. The test compares the raw
// table against `isRouteAllowed` to catch that at build time instead.
export const QUICK_ACTIONS: Record<Role, QuickAction[]> = {
  teacher: [
    { label: 'Enter grades', href: '/markbook/grading' },
    { label: 'Mark attendance', href: '/attendance/sections' },
    { label: 'Write evaluation', href: '/evaluation' },
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
export function getQuickActions(
  role: Role,
  hiddenModules: readonly SidebarModule[] = []
): QuickAction[] {
  return QUICK_ACTIONS[role].filter(
    (a) =>
      isRouteAllowed(a.href, role) && !isHiddenModuleHref(a.href, hiddenModules)
  );
}
