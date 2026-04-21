import type { User } from "@supabase/supabase-js";

export type Role =
  | "teacher"
  | "registrar"
  | "school_admin"
  | "admin"
  | "superadmin"
  | "p-file";

export const ROLES: Role[] = [
  "teacher",
  "registrar",
  "school_admin",
  "admin",
  "superadmin",
  "p-file",
];

export type Module = "markbook" | "p-files" | "records" | "sis";

export type NavItem = {
  href: string;
  label: string;
  badgeKey?: SidebarBadgeKey;
  requiresRoles?: Role[];
};
export type NavSection = { label?: string; items: NavItem[] };

export type SidebarBadgeKey = "changeRequests";
export type SidebarBadges = Partial<Record<SidebarBadgeKey, number>>;

const PFILES_NAV: NavSection[] = [
  {
    items: [
      { href: "/p-files", label: "Dashboard" },
      { href: "/p-files/audit-log", label: "Audit Log" },
    ],
  },
];

// Records module — the student-records operational surface.
// Route group: (records)/records/*. The Records dashboard consolidates
// operational records (internal stage pipeline, doc backlog, level
// distribution) with admissions analytics (conversion funnel, time-to-enroll,
// outdated applications, assessment outcomes, referral sources) — one
// dashboard, not two. /admin/admissions redirects to /records for legacy
// bookmark compatibility.
const RECORDS_NAV: NavSection[] = [
  {
    items: [
      { href: "/records", label: "Dashboard" },
      { href: "/records/students", label: "Students" },
      { href: "/records/discount-codes", label: "Discount Codes" },
      { href: "/records/audit-log", label: "Audit Log" },
    ],
  },
];

// SIS admin hub — the system-level admin surface where structural ops live.
// Distinct from Records. Route group: (sis)/sis/*. Access: school_admin +
// admin + superadmin (AY Setup) and superadmin-only (Approvers).
const SIS_NAV: NavSection[] = [
  {
    items: [
      { href: "/sis", label: "Admin Hub" },
      { href: "/sis/ay-setup", label: "AY Setup", requiresRoles: ["school_admin", "admin", "superadmin"] },
      { href: "/sis/admin/approvers", label: "Approvers", requiresRoles: ["superadmin"] },
    ],
  },
];

// Sidebar navigation is scoped per module. The module switcher
// (components/module-switcher.tsx) moves between them; each module's sidebar
// renders only its own tree so links don't duplicate the switcher.
// Markbook varies by role; P-Files and SIS render one list regardless of role
// (access is gated by proxy.ts + ROUTE_ACCESS).
export const NAV_BY_MODULE: {
  markbook: Partial<Record<Role, NavSection[]>>;
  "p-files": NavSection[];
  records: NavSection[];
  sis: NavSection[];
} = {
  markbook: {
    teacher: [
      { items: [{ href: "/markbook", label: "Dashboard" }] },
      {
        label: "Grading",
        items: [
          { href: "/markbook/grading", label: "My Sheets" },
          { href: "/markbook/grading/requests", label: "My Requests", badgeKey: "changeRequests" },
        ],
      },
    ],
    registrar: [
      { items: [{ href: "/markbook", label: "Dashboard" }] },
      {
        label: "Grading",
        items: [
          { href: "/markbook/grading", label: "All Sheets" },
          { href: "/markbook/grading/new", label: "New Sheet" },
        ],
      },
      {
        label: "Students",
        items: [
          { href: "/markbook/sections", label: "Sections" },
          { href: "/markbook/sync-students", label: "Sync from Admissions" },
        ],
      },
      { items: [{ href: "/markbook/report-cards", label: "Report Cards" }] },
      {
        label: "Admin",
        items: [
          { href: "/markbook/change-requests", label: "Change Requests", badgeKey: "changeRequests" },
          { href: "/markbook/audit-log", label: "Audit Log" },
        ],
      },
    ],
    admin: [
      { items: [{ href: "/markbook", label: "Dashboard" }] },
      {
        label: "Students",
        items: [{ href: "/markbook/sections", label: "Sections" }],
      },
      { items: [{ href: "/markbook/report-cards", label: "Report Cards" }] },
      {
        label: "Admin",
        items: [
          { href: "/markbook/change-requests", label: "Change Requests", badgeKey: "changeRequests" },
          { href: "/markbook/audit-log", label: "Audit Log" },
        ],
      },
    ],
    // school_admin mirrors admin MINUS the "Change Requests" approval inbox —
    // school admins don't approve grade changes (that's academic admin work).
    school_admin: [
      { items: [{ href: "/markbook", label: "Dashboard" }] },
      {
        label: "Students",
        items: [{ href: "/markbook/sections", label: "Sections" }],
      },
      { items: [{ href: "/markbook/report-cards", label: "Report Cards" }] },
      {
        label: "Admin",
        items: [
          { href: "/markbook/audit-log", label: "Audit Log" },
        ],
      },
    ],
    superadmin: [
      { items: [{ href: "/markbook", label: "Dashboard" }] },
      {
        label: "Grading",
        items: [
          { href: "/markbook/grading", label: "All Sheets" },
          { href: "/markbook/grading/new", label: "New Sheet" },
        ],
      },
      {
        label: "Students",
        items: [
          { href: "/markbook/sections", label: "Sections" },
          { href: "/markbook/sync-students", label: "Sync from Admissions" },
        ],
      },
      { items: [{ href: "/markbook/report-cards", label: "Report Cards" }] },
      {
        label: "Admin",
        items: [
          { href: "/markbook/change-requests", label: "Change Requests", badgeKey: "changeRequests" },
          { href: "/markbook/audit-log", label: "Audit Log" },
        ],
      },
    ],
  },
  "p-files": PFILES_NAV,
  records: RECORDS_NAV,
  sis: SIS_NAV,
};

// Which roles may access a given route prefix. Longer prefixes are
// evaluated first via the explicit `find` order below, so `/sis/ay-setup`
// must appear before the broader `/sis` rule.
export const ROUTE_ACCESS: Array<{ prefix: string; allowed: Role[] }> = [
  { prefix: "/sis/admin/approvers", allowed: ["superadmin"] },
  { prefix: "/sis/ay-setup", allowed: ["school_admin", "admin", "superadmin"] },
  { prefix: "/admin/admissions", allowed: ["registrar", "school_admin", "admin", "superadmin"] },
  { prefix: "/markbook", allowed: ["teacher", "registrar", "school_admin", "admin", "superadmin"] },
  { prefix: "/p-files", allowed: ["p-file", "school_admin", "admin", "superadmin"] },
  { prefix: "/records", allowed: ["registrar", "school_admin", "admin", "superadmin"] },
  { prefix: "/sis", allowed: ["school_admin", "admin", "superadmin"] },
];

export function getUserRole(user: User | null | undefined): Role | null {
  const raw = user?.app_metadata?.role ?? user?.user_metadata?.role;
  return ROLES.includes(raw as Role) ? (raw as Role) : null;
}

export function getRoleFromClaims(claims: Record<string, unknown> | null | undefined): Role | null {
  const appMeta = claims?.app_metadata as Record<string, unknown> | undefined;
  const userMeta = claims?.user_metadata as Record<string, unknown> | undefined;
  const raw = appMeta?.role ?? userMeta?.role;
  return ROLES.includes(raw as Role) ? (raw as Role) : null;
}

export function isRouteAllowed(pathname: string, role: Role | null): boolean {
  const rule = ROUTE_ACCESS.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + "/"));
  if (!rule) return true;
  return role != null && rule.allowed.includes(role);
}
