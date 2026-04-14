import type { User } from '@supabase/supabase-js';

export type Role = 'teacher' | 'registrar' | 'admin' | 'superadmin';

export const ROLES: Role[] = ['teacher', 'registrar', 'admin', 'superadmin'];

export type NavItem = { href: string; label: string };
export type NavSection = { label?: string; items: NavItem[] };

// Sectioned navigation. The sidebar renders each section with a small
// uppercase label above its items. An empty `label` means the section has
// no header (used for top-level items like Dashboard / Report Cards).
export const NAV_BY_ROLE: Record<Role, NavSection[]> = {
  teacher: [
    { items: [{ href: '/', label: 'Dashboard' }] },
    {
      label: 'Grading',
      items: [{ href: '/grading', label: 'My Sheets' }],
    },
  ],
  registrar: [
    { items: [{ href: '/', label: 'Dashboard' }] },
    {
      label: 'Grading',
      items: [
        { href: '/grading', label: 'All Sheets' },
        { href: '/grading/new', label: 'New Sheet' },
      ],
    },
    {
      label: 'Students',
      items: [
        { href: '/admin/sections', label: 'Sections' },
        { href: '/admin/sync-students', label: 'Sync from Admissions' },
      ],
    },
    { items: [{ href: '/report-cards', label: 'Report Cards' }] },
    {
      label: 'Admin',
      items: [
        { href: '/admin/admissions', label: 'Admissions Dashboard' },
        { href: '/admin/audit-log', label: 'Audit Log' },
      ],
    },
  ],
  admin: [
    { items: [{ href: '/', label: 'Dashboard' }] },
    {
      label: 'Students',
      items: [{ href: '/admin/sections', label: 'Sections' }],
    },
    { items: [{ href: '/report-cards', label: 'Report Cards' }] },
    {
      label: 'Admissions',
      items: [{ href: '/admin/admissions', label: 'Pipeline Dashboard' }],
    },
    {
      label: 'Admin',
      items: [{ href: '/admin/audit-log', label: 'Audit Log' }],
    },
  ],
  superadmin: [
    { items: [{ href: '/', label: 'Dashboard' }] },
    {
      label: 'Grading',
      items: [
        { href: '/grading', label: 'All Sheets' },
        { href: '/grading/new', label: 'New Sheet' },
      ],
    },
    {
      label: 'Students',
      items: [
        { href: '/admin/sections', label: 'Sections' },
        { href: '/admin/sync-students', label: 'Sync from Admissions' },
      ],
    },
    { items: [{ href: '/report-cards', label: 'Report Cards' }] },
    {
      label: 'Admissions',
      items: [{ href: '/admin/admissions', label: 'Pipeline Dashboard' }],
    },
    {
      label: 'Admin',
      items: [{ href: '/admin/audit-log', label: 'Audit Log' }],
    },
  ],
};

// Which roles may access a given route prefix.
export const ROUTE_ACCESS: Array<{ prefix: string; allowed: Role[] }> = [
  { prefix: '/admin',        allowed: ['registrar', 'admin', 'superadmin'] },
  { prefix: '/report-cards', allowed: ['registrar', 'admin', 'superadmin'] },
  { prefix: '/grading',      allowed: ['teacher', 'registrar', 'superadmin'] },
];

export function getUserRole(user: User | null | undefined): Role | null {
  const raw = user?.app_metadata?.role ?? user?.user_metadata?.role;
  return ROLES.includes(raw as Role) ? (raw as Role) : null;
}

export function isRouteAllowed(pathname: string, role: Role | null): boolean {
  const rule = ROUTE_ACCESS.find(r => pathname === r.prefix || pathname.startsWith(r.prefix + '/'));
  if (!rule) return true;
  return role != null && rule.allowed.includes(role);
}
