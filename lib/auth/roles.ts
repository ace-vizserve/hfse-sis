import type { User } from "@supabase/supabase-js";

export type Role =
  | "teacher"
  | "registrar"
  | "school_admin"
  | "admin"
  | "superadmin"
  | "p-file"
  | "admissions";

export const ROLES: Role[] = [
  "teacher",
  "registrar",
  "school_admin",
  "admin",
  "superadmin",
  "p-file",
  "admissions",
];

export type Module = "markbook" | "p-files" | "records" | "sis" | "attendance" | "evaluation" | "admissions";

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
  { items: [{ href: "/p-files", label: "Dashboard" }] },
  {
    // Quick filters land on the dashboard with a `?status=` preset so the
    // P-Files officer can jump straight to the work queue. The completeness
    // table reads the searchParam and applies it as its initial filter.
    label: "Quick filters",
    items: [
      { href: "/p-files?status=missing", label: "Missing documents" },
      { href: "/p-files?status=expired", label: "Expired documents" },
      { href: "/p-files?status=uploaded", label: "Pending review" },
      { href: "/p-files?status=complete", label: "Fully validated" },
    ],
  },
  {
    label: "Admin",
    items: [{ href: "/p-files/audit-log", label: "Audit Log" }],
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
  { items: [{ href: "/records", label: "Dashboard" }] },
  {
    label: "Operations",
    items: [
      { href: "/records/students", label: "Students" },
      // Discount-codes catalogue is config — moved to SIS Admin
      // (2026-04-22). Cross-module link kept here for registrar convenience.
      {
        href: "/sis/admin/discount-codes",
        label: "Discount Codes",
        requiresRoles: ["registrar", "school_admin", "admin", "superadmin"],
      },
      // Bulk admissions→SIS sync lives in SIS Admin (2026-04-23). Cross-module
      // link kept here for registrar convenience — they own roster ingest and
      // mostly work out of Records.
      {
        href: "/sis/sync-students",
        label: "Sync from Admissions",
        requiresRoles: ["registrar", "school_admin", "admin", "superadmin"],
      },
    ],
  },
  // Cohort views — pre-baked filtered lists for cross-cutting student
  // attributes that previously required clicking into each student. Records
  // scope = enrolled students only (per KD #51).
  {
    label: "Cohorts",
    items: [
      { href: "/records/cohorts/stp", label: "STP applications" },
      { href: "/records/cohorts/medical", label: "Medical alerts" },
      { href: "/records/cohorts/pass-expiry", label: "Pass expiry" },
    ],
  },
  {
    label: "Admin",
    items: [{ href: "/records/audit-log", label: "Audit Log" }],
  },
];

// Attendance module — sole writer of daily attendance (KD #47).
// Route group: (attendance)/attendance/*. Form advisers + registrar+ mark
// daily attendance; import is registrar+ only.
const ATTENDANCE_NAV: NavSection[] = [
  {
    items: [
      { href: "/attendance", label: "Dashboard" },
      { href: "/attendance/sections", label: "Sections" },
    ],
  },
  {
    label: "Setup",
    items: [
      {
        // Cross-module link: the calendar is SIS Admin config, but
        // registrars work out of Attendance and need a one-click path.
        href: "/sis/calendar",
        label: "School Calendar",
        requiresRoles: ["registrar", "school_admin", "admin", "superadmin"],
      },
      {
        href: "/attendance/import",
        label: "Import",
        requiresRoles: ["registrar", "school_admin", "admin", "superadmin"],
      },
    ],
  },
  {
    label: "Admin",
    items: [{ href: "/attendance/audit-log", label: "Audit Log" }],
  },
];

// Admissions module — pre-enrolment funnel surface. Admissions team owns
// applications and conversion analytics. Once a student's stage hits
// `Enrolled`, the cross-year permanent record lives in `/records/*` instead.
const ADMISSIONS_NAV: NavSection[] = [
  { items: [{ href: "/admissions", label: "Dashboard" }] },
  {
    label: "Pipeline",
    items: [{ href: "/admissions/applications", label: "Applications" }],
  },
  // Cohort views — Admissions scope = funnel students (Submitted /
  // Ongoing Verification / Processing). Mirrors the Records-side cohorts
  // for the pre-enrolment side of the workflow.
  {
    label: "Cohorts",
    items: [
      { href: "/admissions/cohorts/stp", label: "STP applications" },
      { href: "/admissions/cohorts/medical", label: "Medical alerts" },
      { href: "/admissions/cohorts/pass-expiry", label: "Pass expiry" },
    ],
  },
  {
    label: "Quicklinks",
    items: [
      {
        href: "/records/students",
        label: "Enrolled students",
        requiresRoles: ["registrar", "school_admin", "admin", "superadmin"],
      },
      {
        href: "/p-files",
        label: "Document validation",
        requiresRoles: ["p-file", "admin", "superadmin"],
      },
      {
        href: "/sis/ay-setup",
        label: "AY Setup",
        requiresRoles: ["school_admin", "admin", "superadmin"],
      },
    ],
  },
  {
    label: "Admin",
    items: [{ href: "/admissions/audit-log", label: "Audit Log" }],
  },
];

// Evaluation module — form class adviser writeups (KD #49).
// Route group: (evaluation)/evaluation/*. Teachers hit it via cross-module
// links from Markbook for sections where they are `form_adviser`; registrar+
// sees all sections. The writeup is the sole source of the FCA comment on
// T1-T3 report cards — grades/attendance come from their own modules.
const EVALUATION_NAV: NavSection[] = [
  { items: [{ href: "/evaluation", label: "Dashboard" }] },
  {
    label: "Write-ups",
    items: [{ href: "/evaluation/sections", label: "All terms" }],
  },
  {
    // Per-term quicklinks land on the sections picker with `?term=<number>`
    // preselected. T4 has no FCA comment section (KD #49) so it's omitted.
    label: "Quick filters",
    items: [
      { href: "/evaluation/sections?term=1", label: "Term 1 write-ups" },
      { href: "/evaluation/sections?term=2", label: "Term 2 write-ups" },
      { href: "/evaluation/sections?term=3", label: "Term 3 write-ups" },
    ],
  },
];

// SIS admin hub — the system-level admin surface where structural ops live.
// Distinct from Records. Route group: (sis)/sis/*. Access: school_admin +
// admin + superadmin (AY Setup) and superadmin-only (Approvers).
// Groups mirror the landing-page sections on /sis (page.tsx).
const SIS_NAV: NavSection[] = [
  { items: [{ href: "/sis", label: "Admin Hub" }] },
  {
    label: "Academic Year",
    items: [
      { href: "/sis/ay-setup", label: "AY Setup", requiresRoles: ["school_admin", "admin", "superadmin"] },
      {
        href: "/sis/calendar",
        label: "School Calendar",
        requiresRoles: ["registrar", "school_admin", "admin", "superadmin"],
      },
    ],
  },
  {
    label: "Organisation",
    items: [
      {
        href: "/sis/sections",
        label: "Sections",
        requiresRoles: ["registrar", "school_admin", "admin", "superadmin"],
      },
      {
        href: "/sis/admin/discount-codes",
        label: "Discount Codes",
        requiresRoles: ["registrar", "school_admin", "admin", "superadmin"],
      },
      { href: "/sis/admin/subjects", label: "Subject Weights", requiresRoles: ["superadmin"] },
      { href: "/sis/admin/evaluation-checklists", label: "Eval Checklists", requiresRoles: ["superadmin"] },
      {
        href: "/sis/sync-students",
        label: "Sync from Admissions",
        requiresRoles: ["registrar", "school_admin", "admin", "superadmin"],
      },
    ],
  },
  {
    label: "Access",
    items: [
      { href: "/sis/admin/approvers", label: "Approvers", requiresRoles: ["superadmin"] },
      { href: "/sis/admin/users", label: "Users", requiresRoles: ["superadmin"] },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/sis/admin/school-config", label: "School Config", requiresRoles: ["superadmin"] },
      { href: "/sis/admin/settings", label: "Settings", requiresRoles: ["superadmin"] },
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
  attendance: NavSection[];
  evaluation: NavSection[];
  admissions: NavSection[];
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
  attendance: ATTENDANCE_NAV,
  evaluation: EVALUATION_NAV,
  admissions: ADMISSIONS_NAV,
};

// Which roles may access a given route prefix. Longer prefixes are
// evaluated first via the explicit `find` order below, so `/sis/ay-setup`
// must appear before the broader `/sis` rule.
export const ROUTE_ACCESS: Array<{ prefix: string; allowed: Role[] }> = [
  { prefix: "/sis/admin/approvers", allowed: ["superadmin"] },
  { prefix: "/sis/admin/subjects", allowed: ["superadmin"] },
  { prefix: "/sis/admin/school-config", allowed: ["superadmin"] },
  { prefix: "/sis/admin/evaluation-checklists", allowed: ["superadmin"] },
  { prefix: "/sis/admin/users", allowed: ["superadmin"] },
  { prefix: "/sis/admin/settings", allowed: ["superadmin"] },
  { prefix: "/sis/admin/discount-codes", allowed: ["registrar", "school_admin", "admin", "superadmin"] },
  { prefix: "/sis/ay-setup", allowed: ["school_admin", "admin", "superadmin"] },
  { prefix: "/sis/calendar", allowed: ["registrar", "school_admin", "admin", "superadmin"] },
  { prefix: "/sis/sections", allowed: ["registrar", "school_admin", "admin", "superadmin"] },
  { prefix: "/sis/sync-students", allowed: ["registrar", "school_admin", "admin", "superadmin"] },
  { prefix: "/admin/admissions", allowed: ["registrar", "school_admin", "admin", "superadmin"] },
  { prefix: "/attendance/import", allowed: ["registrar", "school_admin", "admin", "superadmin"] },
  { prefix: "/attendance/calendar", allowed: ["registrar", "school_admin", "admin", "superadmin"] },
  { prefix: "/attendance", allowed: ["teacher", "registrar", "school_admin", "admin", "superadmin"] },
  { prefix: "/evaluation", allowed: ["teacher", "registrar", "school_admin", "admin", "superadmin"] },
  { prefix: "/markbook", allowed: ["teacher", "registrar", "school_admin", "admin", "superadmin"] },
  { prefix: "/p-files", allowed: ["p-file", "school_admin", "admin", "superadmin"] },
  { prefix: "/admissions", allowed: ["admissions", "registrar", "school_admin", "admin", "superadmin"] },
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
