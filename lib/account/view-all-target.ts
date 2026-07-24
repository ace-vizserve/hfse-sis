import type { Role } from '@/lib/auth/roles';

const VIEW_ALL_ACTIVITY_TARGET: Record<Role, string> = {
  teacher: '/markbook/audit-log',
  academic_coordinator: '/markbook/audit-log',
  school_admin: '/sis/audit-log',
  superadmin: '/sis/audit-log',
  p_file_officer: '/p-files/audit-log',
  admissions: '/admissions/audit-log',
};

/**
 * Where the account page's "View all activity" link goes, per role — each
 * role's most-central module (KD #2), pre-filtered to just this account via
 * ?actor=. Requires the target audit-log page to support that param (see
 * docs/superpowers/specs/2026-07-24-account-page-role-aware-design.md).
 */
export function viewAllActivityHref(role: Role, email: string): string {
  return `${VIEW_ALL_ACTIVITY_TARGET[role]}?actor=${encodeURIComponent(email)}`;
}
