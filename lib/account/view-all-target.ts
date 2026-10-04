import type { Role } from '@/lib/auth/roles';

// `null` = this role can open no audit-log page. A teacher was pointed at
// /markbook/audit-log, which redirects every role but academic_coordinator /
// school_admin / superadmin to `/` — so "View all activity" sent them home.
const VIEW_ALL_ACTIVITY_TARGET: Record<Role, string | null> = {
  teacher: null,
  academic_coordinator: '/markbook/audit-log',
  school_admin: '/sis/audit-log',
  superadmin: '/sis/audit-log',
  admissions: '/admissions/audit-log',
};

/**
 * Where the account page's "View all activity" link goes, per role — each
 * role's most-central module (KD #2), pre-filtered to just this account via
 * ?actor=. Requires the target audit-log page to support that param (see
 * docs/superpowers/specs/2026-07-24-account-page-role-aware-design.md).
 * Returns null when the role has no audit log to open; the link is then left
 * out.
 */
export function viewAllActivityHref(role: Role, email: string): string | null {
  const target = VIEW_ALL_ACTIVITY_TARGET[role];
  return target ? `${target}?actor=${encodeURIComponent(email)}` : null;
}
