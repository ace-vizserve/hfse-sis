import {
  CalendarClockIcon,
  ClipboardListIcon,
  FileTextIcon,
  GraduationCapIcon,
  HomeIcon,
  InboxIcon,
  PlaneIcon,
  Settings2Icon,
  SparklesIcon,
  StethoscopeIcon,
  UserIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from 'lucide-react';

import { can, type Capability } from '@/lib/auth/capabilities';
import type { Role } from '@/lib/auth/roles';
import { isRouteAllowed } from '@/lib/auth/roles';
import { isHiddenModuleHref } from '@/lib/sidebar/module-visibility';
import type { SidebarModule } from '@/lib/sidebar/registry';

// The ⌘K palette's static nav data + its visibility rule, extracted out of
// components/sis/command-palette.tsx so both can be imported by a plain test.
// That file is 'use client' and pulls in cmdk, React hooks and TanStack Query —
// far too heavy for a pure auth test to load. Icons are plain module-level
// values, so they are safe here; this module carries no 'use client'.

// ──────────────────────────────────────────────────────────────────────────
// Static navigation entries — every primary route the palette can jump to.
// Role-gated via isRouteAllowed() against the user's role at render time.
// Order = lifecycle order (Admissions → Records → P-Files → Markbook →
// Attendance → Evaluation → SIS Admin) for consistency with the module
// switcher (KD #43).
// ──────────────────────────────────────────────────────────────────────────

export type NavEntry = {
  href: string;
  label: string;
  group: 'Modules' | 'Cohorts' | 'Admin';
  icon: LucideIcon;
  shortcut?: string;
  // Explicit role gate, bypassing the href→isRouteAllowed() lookup below.
  // Only needed when an entry's href carries a query string that would
  // otherwise resolve to the WRONG ROUTE_ACCESS row once the query is
  // stripped for matching (see "Staff accounts" below) — every other entry
  // should omit this and let isRouteAllowed() (the same gate the proxy +
  // sidebar use) decide.
  requiresRoles?: Role[];
  // A capability the DESTINATION PAGE itself requires. `requiresRoles` and
  // isRouteAllowed() answer "may the proxy let you through"; this answers
  // "will the page keep you once you arrive". A route can admit a role at the
  // prefix and then bounce them on a capability they no longer hold — an
  // entry that advertises such a page is a dead end, so it is filtered out
  // here rather than offered.
  requiresCapability?: Capability;
};

export const NAV_ENTRIES: NavEntry[] = [
  // Module dashboards
  {
    href: '/',
    label: 'Home — Module picker',
    group: 'Modules',
    icon: HomeIcon,
  },
  {
    href: '/admissions',
    label: 'Admissions — Dashboard',
    group: 'Modules',
    icon: InboxIcon,
  },
  {
    href: '/admissions/applications',
    label: 'Admissions — Applications',
    group: 'Modules',
    icon: FileTextIcon,
  },
  {
    href: '/admissions/upcoming/applications',
    label: 'Admissions — Upcoming AY Applications',
    group: 'Modules',
    icon: InboxIcon,
  },
  {
    href: '/admissions/document-validation',
    label: 'Admissions — Document Validation Queue',
    group: 'Modules',
    icon: ClipboardListIcon,
    // The ROUTE_ACCESS prefix still admits the academic coordinator, but the
    // page requires this capability and she no longer holds it (KD #173 —
    // document work moved off her onto the P-Files officer + school_admin).
    // Without this the palette advertises a page that bounces her.
    requiresCapability: 'documents_pre_enrolment.read',
  },
  {
    href: '/records',
    label: 'Records — Dashboard',
    group: 'Modules',
    icon: UsersIcon,
  },
  {
    href: '/records/students',
    label: 'Records — Students',
    group: 'Modules',
    icon: UsersIcon,
  },
  {
    href: '/records/movements',
    label: 'Records — Enrolment Movements',
    group: 'Modules',
    icon: UsersIcon,
  },
  {
    href: '/records/unsynced',
    label: 'Records — Unsynced Students',
    group: 'Modules',
    icon: UserIcon,
  },
  {
    href: '/p-files',
    label: 'P-Files — Dashboard',
    group: 'Modules',
    icon: FileTextIcon,
  },
  {
    href: '/markbook',
    label: 'Markbook — Dashboard',
    group: 'Modules',
    icon: GraduationCapIcon,
  },
  {
    href: '/markbook/grading',
    label: 'Markbook — Grading',
    group: 'Modules',
    icon: GraduationCapIcon,
  },
  {
    href: '/markbook/report-cards',
    label: 'Markbook — Report Cards',
    group: 'Modules',
    icon: FileTextIcon,
  },
  {
    href: '/records/academic-summary',
    label: 'Records — Academic Summary',
    group: 'Modules',
    icon: FileTextIcon,
  },
  {
    href: '/markbook/change-requests',
    label: 'Markbook — Change Requests',
    group: 'Modules',
    icon: InboxIcon,
  },
  {
    href: '/markbook/audit-log',
    label: 'Markbook — Audit Log',
    group: 'Modules',
    icon: ClipboardListIcon,
  },
  {
    href: '/attendance',
    label: 'Attendance — Dashboard',
    group: 'Modules',
    icon: ClipboardListIcon,
  },
  {
    href: '/attendance/sections',
    label: 'Attendance — Sections',
    group: 'Modules',
    icon: UsersIcon,
  },
  {
    href: '/evaluation',
    label: 'Evaluation — Dashboard',
    group: 'Modules',
    icon: SparklesIcon,
  },
  {
    href: '/sis',
    label: 'SIS Admin — Hub',
    group: 'Modules',
    icon: Settings2Icon,
  },

  // Cohorts
  {
    href: '/admissions/cohorts/stp',
    label: 'STP applications (admissions)',
    group: 'Cohorts',
    icon: PlaneIcon,
  },
  {
    href: '/admissions/cohorts/medical',
    label: 'Medical alerts (admissions)',
    group: 'Cohorts',
    icon: StethoscopeIcon,
  },
  {
    href: '/admissions/cohorts/promised',
    label: 'Promised follow-ups (admissions)',
    group: 'Cohorts',
    icon: CalendarClockIcon,
  },
  {
    href: '/records/cohorts/stp',
    label: 'STP applications (records)',
    group: 'Cohorts',
    icon: PlaneIcon,
  },
  {
    href: '/records/cohorts/medical',
    label: 'Medical alerts (records)',
    group: 'Cohorts',
    icon: StethoscopeIcon,
  },
  {
    href: '/records/cohorts/pass-expiry',
    label: 'Pass expiry (records)',
    group: 'Cohorts',
    icon: WalletIcon,
  },

  // Admin surfaces
  {
    href: '/sis/calendar',
    label: 'School Calendar',
    group: 'Admin',
    icon: ClipboardListIcon,
  },
  { href: '/sis/sections', label: 'Sections', group: 'Admin', icon: UsersIcon },
  {
    href: '/sis/ay-setup',
    label: 'Academic Year Setup',
    group: 'Admin',
    icon: Settings2Icon,
  },
  {
    href: '/sis/admin/discount-codes',
    label: 'Discount Codes',
    group: 'Admin',
    icon: WalletIcon,
  },
  {
    href: '/sis/admin/subjects',
    label: 'Subject Weights',
    group: 'Admin',
    icon: GraduationCapIcon,
  },
  {
    href: '/sis/admin/school-config',
    label: 'School Config',
    group: 'Admin',
    icon: Settings2Icon,
  },
  {
    href: '/sis/admin/staff',
    label: 'Staff — teaching assignments',
    group: 'Admin',
    icon: UsersIcon,
  },
  {
    // Staff accounts merged into /sis/admin/staff (SIS Admin IA Phase 4,
    // KD #154) — deep-links straight to the Accounts cut. isRouteAllowed()
    // is now called on the QUERY-STRIPPED pathname (see below), so on its
    // own this href would resolve to /sis/admin/staff's own ROUTE_ACCESS row
    // — registrar included. That's wrong for THIS entry: the Accounts cut
    // isn't for registrar (account management is school_admin+/superadmin
    // territory), even though the server-rendered page itself is registrar-
    // tolerant (an unrecognised/unauthorized ?view= falls back to the
    // Assignments tab, so a registrar who somehow lands here isn't broken —
    // just redundant). Explicit `requiresRoles` pins the intended gate
    // instead of relying on query-string-vs-ROUTE_ACCESS-row coincidence.
    href: '/sis/admin/staff?view=accounts',
    label: 'Staff accounts',
    group: 'Admin',
    icon: UsersIcon,
    requiresRoles: ['school_admin', 'superadmin'],
  },
  {
    href: '/sis/admin/approvers',
    label: 'Approvers',
    group: 'Admin',
    icon: UsersIcon,
  },
  {
    href: '/sis/audit-log',
    label: 'Audit Log',
    group: 'Admin',
    icon: ClipboardListIcon,
  },
];

// isRouteAllowed()'s ROUTE_ACCESS matching is pathname-only (exact match or
// prefix + "/") — a raw href with a query string (e.g. "?view=accounts")
// never matches its own route's row and silently falls through to a
// broader/less-specific one. Strip the query before gating so every entry's
// visibility reflects the route it actually points at, not an accident of
// which catch-all rule the unstripped string happens to hit.
export function pathnameOnly(href: string): string {
  const qIndex = href.indexOf('?');
  return qIndex === -1 ? href : href.slice(0, qIndex);
}

// Filter nav entries by role gate. isRouteAllowed lives in lib/auth/roles
// so the palette uses the SAME gate as the proxy + sidebar — called on the
// query-stripped pathname (see pathnameOnly() above). An entry with an
// explicit `requiresRoles` (only "Staff accounts" today) bypasses the
// href lookup entirely.
//
// FAILS CLOSED on a missing `capabilities` argument — `can()` returns false for
// `undefined`, so a caller that forgets to thread capabilities hides the gated
// entries rather than offering ones that bounce on arrival.
export function visibleNavEntries(
  role: Role | null,
  capabilities: readonly Capability[] | undefined,
  hiddenModules: readonly SidebarModule[] = []
): NavEntry[] {
  return NAV_ENTRIES.filter(
    (entry) =>
      (entry.requiresRoles
        ? !!role && entry.requiresRoles.includes(role)
        : isRouteAllowed(pathnameOnly(entry.href), role)) &&
      !isHiddenModuleHref(entry.href, hiddenModules) &&
      (!entry.requiresCapability || can(capabilities, entry.requiresCapability))
  );
}
