import type { Role } from '@/lib/auth/roles';
import { isHiddenModuleHref } from '@/lib/sidebar/module-visibility';
import type { SidebarModule } from '@/lib/sidebar/registry';

export type QuickAction = { label: string; href: string };

const QUICK_ACTIONS: Record<Role, QuickAction[]> = {
  teacher: [
    { label: 'Enter grades', href: '/markbook/grading' },
    { label: 'Mark attendance', href: '/attendance/sections' },
    { label: 'Write evaluation', href: '/evaluation' },
  ],
  academic_coordinator: [
    { label: 'Review applications', href: '/admissions/applications' },
    { label: 'Lock overdue sheets', href: '/markbook/grading' },
    { label: 'Assign a section', href: '/records/unsynced' },
  ],
  school_admin: [
    { label: 'Validate documents', href: '/admissions/document-validation' },
    { label: 'AY Setup', href: '/sis/ay-setup' },
    { label: 'Manage staff', href: '/sis/admin/staff' },
  ],
  superadmin: [
    { label: 'Validate documents', href: '/p-files/document-validation' },
    { label: 'Manage staff', href: '/sis/admin/staff' },
    { label: 'School config', href: '/sis/admin/school-config' },
  ],
  // These two roles redirect away from `/` before this ever renders
  // (app/(dashboard)/page.tsx + layout.tsx) — kept here only so the
  // Record<Role, ...> map is exhaustive and getQuickActions is total.
  p_file_officer: [],
  admissions: [],
};

//  drops actions that lead into a module this viewer can't use
// — a subject-teacher-only user must not be offered "Mark attendance" on the
// home page while the same module is hidden from the switcher.
export function getQuickActions(
  role: Role,
  hiddenModules: readonly SidebarModule[] = []
): QuickAction[] {
  return QUICK_ACTIONS[role].filter(
    (a) => !isHiddenModuleHref(a.href, hiddenModules)
  );
}
