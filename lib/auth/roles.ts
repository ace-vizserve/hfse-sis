import type { User } from '@supabase/supabase-js';

export type Role =
  | 'teacher'
  | 'registrar'
  | 'school_admin'
  | 'superadmin'
  | 'p-file'
  | 'admissions';

export const ROLES: Role[] = [
  'teacher',
  'registrar',
  'school_admin',
  'superadmin',
  'p-file',
  'admissions',
];

export type Module =
  | 'markbook'
  | 'p-files'
  | 'records'
  | 'sis'
  | 'attendance'
  | 'evaluation'
  | 'admissions';

export type NavItem = {
  href: string;
  label: string;
  badgeKey?: SidebarBadgeKey;
  requiresRoles?: Role[];
  step?: number;
};
export type NavSection = { label?: string; items: NavItem[] };

export type SidebarBadgeKey =
  | 'changeRequests'
  | 'pendingDocValidation'
  | 'unsyncedStudents'
  | 'pfileAwaitingVerification';
export type SidebarBadges = Partial<Record<SidebarBadgeKey, number>>;

const PFILES_NAV: NavSection[] = [
  {
    items: [{ href: '/p-files', label: 'Dashboard' }],
  },
  {
    // Quick filters land on the dashboard with a `?status=` preset so the
    // P-Files officer can jump straight to the work queue (oversight role —
    // school_admin — sees the same lists but in read-only mode).
    label: 'Quick filters',
    items: [{ href: '/p-files?status=expired', label: 'Expired documents' }],
  },
  {
    // Renewal-outreach windows — officer+ only (p-file / school_admin /
    // superadmin) because these are the lists the bulk-remind action operates
    // on. school_admin sees the same data in read-only mode (per KD #74 — no
    // bulk-notify CTA). Oversight-only roles (registrar etc.) are not granted
    // these quicklinks.
    label: 'Expiring soon',
    items: [
      {
        href: '/p-files?expiring=30',
        label: 'Within 30 days',
        requiresRoles: ['p-file', 'school_admin', 'superadmin'],
      },
      {
        href: '/p-files?expiring=60',
        label: 'Within 60 days',
        requiresRoles: ['p-file', 'school_admin', 'superadmin'],
      },
      {
        href: '/p-files?expiring=90',
        label: 'Within 90 days',
        requiresRoles: ['p-file', 'school_admin', 'superadmin'],
      },
    ],
  },
  {
    // Workflow shortcut — dedicated validation queue for enrolled students.
    // Badge = count of Uploaded non-expiring slots awaiting officer review.
    // Triage mode available to p-file / superadmin; school_admin sees
    // read-only watchlist; the actual validate/notify CTAs are gated by
    // `canWrite` on the detail + completeness rows.
    label: 'Quicklinks',
    items: [
      {
        href: '/p-files/document-validation',
        label: 'Document validation',
        badgeKey: 'pfileAwaitingVerification',
        requiresRoles: ['p-file', 'school_admin', 'superadmin'],
      },
    ],
  },
  {
    label: 'Admin',
    items: [{ href: '/p-files/audit-log', label: 'Audit Log' }],
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
      { href: '/records', label: 'Dashboard' },
      {
        href: '/records/insights',
        label: 'Insights',
        requiresRoles: ['registrar', 'school_admin', 'superadmin'],
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/records/students', label: 'Students' },
      { href: '/records/movements', label: 'Movements' },
      // Operational queue for enrolled-but-not-synced students. Per-row
      // sync gates on BOTH studentNumber AND classSection — when either
      // is missing the student is stranded outside grading. The queue
      // surfaces them and offers the assign-section CTA inline. Badge
      // mirrors the row count from `countUnsyncedEnrolledStudents`.
      {
        href: '/records/unsynced',
        label: 'Students needing setup',
        badgeKey: 'unsyncedStudents',
      },
      // Section setup lives in SIS Admin, but the registrar can't reach the SIS
      // module (its /sis hub is school_admin+). Cross-link kept here so she can
      // get to the section rosters — incl. the Generate-class-index action,
      // which is registrar work — without a SIS tile. Mirrors the sync link.
      {
        href: '/sis/sections',
        label: 'Section setup',
        requiresRoles: ['registrar', 'school_admin', 'superadmin'],
      },
    ],
  },
  // Cohort views — pre-baked filtered lists for cross-cutting student
  // attributes that previously required clicking into each student. Records
  // scope = enrolled students only (per KD #51).
  {
    label: 'Cohorts',
    items: [
      { href: '/records/cohorts/stp', label: 'STP applications' },
      { href: '/records/cohorts/medical', label: 'Medical alerts' },
      { href: '/records/cohorts/pass-expiry', label: 'Pass expiry' },
    ],
  },
  // Academic Summary hub + quick views (KD #95/#127). Labelled group so the
  // three quick views read as sub-items under the hub.
  {
    label: 'Academic Summary',
    items: [
      {
        href: '/records/academic-summary',
        label: 'Overview',
        requiresRoles: ['registrar', 'school_admin', 'superadmin'],
      },
      {
        href: '/records/academic-summary/awards',
        label: 'Awards',
        requiresRoles: ['registrar', 'school_admin', 'superadmin'],
      },
      {
        href: '/records/academic-summary/attendance',
        label: 'Attendance',
        requiresRoles: ['registrar', 'school_admin', 'superadmin'],
      },
      {
        href: '/records/academic-summary/comments',
        label: 'Comments',
        requiresRoles: ['registrar', 'school_admin', 'superadmin'],
      },
    ],
  },
  {
    label: 'Admin',
    items: [{ href: '/records/audit-log', label: 'Audit Log' }],
  },
];

// Attendance module — sole writer of daily attendance (KD #47).
// Route group: (attendance)/attendance/*. Form advisers + registrar+ mark
// daily attendance; import is registrar+ only.
const ATTENDANCE_NAV: NavSection[] = [
  {
    items: [
      { href: '/attendance', label: 'Dashboard' },
      { href: '/attendance/sections', label: 'Sections' },
      {
        href: '/attendance/insights',
        label: 'Insights',
        requiresRoles: ['registrar', 'school_admin', 'superadmin'],
      },
    ],
  },
  {
    label: 'Setup',
    items: [
      {
        // Cross-module link: the calendar is SIS Admin config, but
        // registrars work out of Attendance and need a one-click path.
        href: '/sis/calendar',
        label: 'School Calendar',
        requiresRoles: ['registrar', 'school_admin', 'superadmin'],
      },
      {
        href: '/attendance/import',
        label: 'Import',
        requiresRoles: ['registrar', 'school_admin', 'superadmin'],
      },
    ],
  },
  {
    label: 'Admin',
    items: [{ href: '/attendance/audit-log', label: 'Audit Log' }],
  },
];

// Admissions module — pre-enrolment funnel surface. Admissions team owns
// applications and conversion analytics. Once a student's stage hits
// `Enrolled`, the cross-year permanent record lives in `/records/*` instead.
const ADMISSIONS_NAV: NavSection[] = [
  {
    items: [
      { href: '/admissions', label: 'Dashboard' },
      {
        href: '/admissions/insights',
        label: 'Insights',
        requiresRoles: [
          'admissions',
          'registrar',
          'school_admin',
          'superadmin',
        ],
      },
    ],
  },
  {
    label: 'Pipeline',
    items: [
      { href: '/admissions/applications', label: 'Applications' },
      // Document validation (KD #70 + KD #71): dedicated triage queue for
      // un-enrolled applicants whose documents are status='Uploaded' and
      // awaiting registrar review. Replaces the legacy
      // `/admissions?status=uploaded` quicklink with a purpose-built page.
      // Badge mirrors the row count from `countPendingDocValidation`.
      {
        href: '/admissions/document-validation',
        label: 'Document validation',
        badgeKey: 'pendingDocValidation',
      },
      // KD #77: surfaces the parallel pipeline for the AY where
      // accepting_applications=true AND is_current=false. The page itself
      // renders an empty state when no such AY exists, so the entry can
      // safely stay in nav even when early-bird is closed.
      {
        href: '/admissions/upcoming/applications',
        label: 'Upcoming AY applications',
      },
      // Discount codes apply to enrolment fees — operationally owned by
      // admissions (they assign codes to applicants). Config lives in SIS
      // Admin; this is the cross-module convenience link.
      {
        href: '/sis/admin/discount-codes',
        label: 'Discount Codes',
        requiresRoles: [
          'admissions',
          'registrar',
          'school_admin',
          'superadmin',
        ],
      },
    ],
  },
  // Cohort views — Admissions scope = funnel students (Submitted /
  // Ongoing Verification / Processing). STP + medical mirror the
  // Records-side cohorts; "Promised follow-ups" is admissions-only —
  // documents the parent committed to upload by a specific date, sorted
  // by soonest with past-due rows pinned to the top. Pass-expiry lives
  // on the Records side only (enrolled scope) — pre-enrolment travel-doc
  // lapses are surfaced via /admissions?status=expired (KD #70).
  {
    label: 'Cohorts',
    items: [
      { href: '/admissions/cohorts/stp', label: 'STP applications' },
      { href: '/admissions/cohorts/medical', label: 'Medical alerts' },
      { href: '/admissions/cohorts/promised', label: 'Promised follow-ups' },
      {
        href: '/admissions/cohorts/pre-course',
        label: 'Pre-Course Counselling',
      },
    ],
  },
  {
    label: 'Analytics',
    items: [{ href: '/admissions/feedback', label: 'Application Feedback' }],
  },
  // History — terminal applicants (Cancelled / Withdrawn) who exited the
  // funnel without ever being classified as Enrolled. Read-only archive;
  // no chase actions, no analytics. Pure observability piece — the
  // active-funnel page filters these out of the in-flight list, so
  // without this group they are operationally orphaned.
  {
    label: 'History',
    items: [
      { href: '/admissions/applications/closed', label: 'Closed applications' },
    ],
  },
  {
    label: 'Quicklinks',
    items: [
      {
        href: '/records/students',
        label: 'Enrolled students',
        requiresRoles: ['registrar', 'school_admin', 'superadmin'],
      },
      {
        href: '/admissions?status=expired',
        label: 'Expired documents',
        requiresRoles: [
          'admissions',
          'registrar',
          'school_admin',
          'superadmin',
        ],
      },
      {
        href: '/sis/ay-setup',
        label: 'AY Setup',
        requiresRoles: ['school_admin', 'superadmin'],
      },
    ],
  },
  {
    label: 'Admin',
    items: [{ href: '/admissions/audit-log', label: 'Audit Log' }],
  },
];

// Evaluation module — form class adviser writeups (KD #49).
// Route group: (evaluation)/evaluation/*. Teachers hit it via cross-module
// links from Markbook for sections where they are `form_adviser`; registrar+
// sees all sections. The writeup is the sole source of the FCA comment on
// T1-T3 report cards — grades/attendance come from their own modules.
const EVALUATION_NAV: NavSection[] = [
  {
    items: [{ href: '/evaluation', label: 'Dashboard' }],
  },
  {
    label: 'Write-ups',
    items: [{ href: '/evaluation/sections', label: 'All terms' }],
  },
  {
    label: 'Setup',
    items: [
      {
        href: '/evaluation/virtue-themes',
        label: 'Virtue themes',
        requiresRoles: ['registrar', 'school_admin', 'superadmin'],
      },
    ],
  },
  {
    // Per-term quicklinks land on the sections picker with `?term=<number>`
    // preselected. T4 has no FCA comment section (KD #49) so it's omitted.
    label: 'Quick filters',
    items: [
      { href: '/evaluation/sections?term=1', label: 'Term 1 write-ups' },
      { href: '/evaluation/sections?term=2', label: 'Term 2 write-ups' },
      { href: '/evaluation/sections?term=3', label: 'Term 3 write-ups' },
    ],
  },
  {
    label: 'Administration',
    items: [
      {
        href: '/evaluation/audit-log',
        label: 'Audit Log',
        requiresRoles: ['registrar', 'school_admin', 'superadmin'],
      },
    ],
  },
];

// SIS admin hub — the system-level admin surface where structural ops live.
// Distinct from Records. Route group: (sis)/sis/*. Access: school_admin +
// superadmin own the full hub (Sprint 33 consolidation — the old `admin`
// twin was retired and school_admin is now the cross-cutting generalist).
// Groups mirror the landing-page sections on /sis (page.tsx).
const SIS_NAV: NavSection[] = [
  {
    items: [
      {
        href: '/sis',
        label: 'Admin Hub',
        // The hub root is school_admin/superadmin-only territory (ROUTE_ACCESS's
        // broad `/sis` catch-all excludes registrar) — gating the nav link to
        // match kills the registrar dead-end where the link was visible but
        // the proxy bounced her off it. Her direct cross-links into SIS Admin
        // (Records → /sis/sections, /sis/admin/staff, /sis/admin/discount-codes)
        // are unaffected — those routes carry their own ROUTE_ACCESS rows.
        requiresRoles: ['school_admin', 'superadmin'],
      },
    ],
  },
  {
    // Recurring, day-to-day work — the things a registrar or school_admin
    // touches through the school year. Per-item requiresRoles preserved
    // from the pre-regroup tree; registrar keeps every entry she had.
    label: 'This year',
    items: [
      {
        href: '/sis/ay-setup',
        label: 'AY Setup',
        requiresRoles: ['school_admin', 'superadmin'],
      },
      {
        href: '/sis/calendar',
        label: 'School Calendar',
        requiresRoles: ['registrar', 'school_admin', 'superadmin'],
      },
      {
        href: '/sis/sections',
        label: 'Sections',
        requiresRoles: ['registrar', 'school_admin', 'superadmin'],
      },
      {
        href: '/sis/admin/staff',
        label: 'Staff',
        requiresRoles: ['registrar', 'school_admin', 'superadmin'],
      },
      {
        href: '/sis/admin/discount-codes',
        label: 'Discount Codes',
        requiresRoles: ['registrar', 'school_admin', 'superadmin'],
      },
    ],
  },
  {
    // Once-a-year structural config — school_admin + superadmin only.
    label: 'Structure',
    items: [
      {
        href: '/sis/admin/levels',
        label: 'Grade Levels',
        requiresRoles: ['school_admin', 'superadmin'],
      },
      {
        href: '/sis/admin/subjects',
        label: 'Subject Weights',
        requiresRoles: ['school_admin', 'superadmin'],
      },
      {
        // Label-only rename (was "Class Template"); href unchanged. Full
        // reframe of this surface is sub-project 3, out of scope here.
        href: '/sis/admin/template',
        label: 'Structure Defaults',
        requiresRoles: ['school_admin', 'superadmin'],
      },
    ],
  },
  {
    // Break-glass — superadmin by default; School Config + Audit Log are
    // school_admin+ per KD #39. Gates unchanged from the pre-regroup tree.
    // "Users" was dropped from this group in the same pass that merges it
    // into the Staff page (sub-project 2 Phase 4) — still reachable via the
    // command palette / direct URL until that lands.
    label: 'Access & system',
    items: [
      {
        href: '/sis/admin/approvers',
        label: 'Approvers',
        requiresRoles: ['superadmin'],
      },
      {
        href: '/sis/admin/school-config',
        label: 'School Config',
        requiresRoles: ['school_admin', 'superadmin'],
      },
      {
        href: '/sis/admin/settings',
        label: 'Settings',
        requiresRoles: ['superadmin'],
      },
      {
        href: '/sis/audit-log',
        label: 'Audit Log',
        requiresRoles: ['school_admin', 'superadmin'],
      },
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
  'p-files': NavSection[];
  records: NavSection[];
  sis: NavSection[];
  attendance: NavSection[];
  evaluation: NavSection[];
  admissions: NavSection[];
} = {
  markbook: {
    teacher: [
      { items: [{ href: '/markbook', label: 'Dashboard' }] },
      {
        label: 'Grading',
        items: [
          { href: '/markbook/grading', label: 'My Sheets' },
          {
            href: '/markbook/grading/requests',
            label: 'My Requests',
            badgeKey: 'changeRequests',
          },
        ],
      },
    ],
    registrar: [
      {
        items: [
          { href: '/markbook', label: 'Dashboard' },
          { href: '/markbook/insights', label: 'Insights' },
        ],
      },
      {
        label: 'Grading',
        items: [
          { href: '/markbook/grading', label: 'All Sheets' },
          { href: '/markbook/grading/new', label: 'New Sheet' },
        ],
      },
      {
        label: 'Students',
        items: [{ href: '/markbook/sections', label: 'Sections' }],
      },
      {
        items: [{ href: '/markbook/report-cards', label: 'Report Cards' }],
      },
      {
        label: 'Admin',
        items: [
          {
            href: '/markbook/change-requests',
            label: 'Change Requests',
            badgeKey: 'changeRequests',
          },
          { href: '/markbook/audit-log', label: 'Audit Log' },
        ],
      },
    ],
    // school_admin is the consolidated cross-cutting role (Sprint 33 — the
    // old `admin` twin was retired). Sees the Change Requests approval
    // inbox + audit log alongside the section/report-card surfaces.
    school_admin: [
      {
        items: [
          { href: '/markbook', label: 'Dashboard' },
          { href: '/markbook/insights', label: 'Insights' },
        ],
      },
      {
        label: 'Students',
        items: [{ href: '/markbook/sections', label: 'Sections' }],
      },
      {
        items: [{ href: '/markbook/report-cards', label: 'Report Cards' }],
      },
      {
        label: 'Admin',
        items: [
          {
            href: '/markbook/change-requests',
            label: 'Change Requests',
            badgeKey: 'changeRequests',
          },
          { href: '/markbook/audit-log', label: 'Audit Log' },
        ],
      },
    ],
    superadmin: [
      {
        items: [
          { href: '/markbook', label: 'Dashboard' },
          { href: '/markbook/insights', label: 'Insights' },
        ],
      },
      {
        label: 'Grading',
        items: [
          { href: '/markbook/grading', label: 'All Sheets' },
          { href: '/markbook/grading/new', label: 'New Sheet' },
        ],
      },
      {
        label: 'Students',
        items: [{ href: '/markbook/sections', label: 'Sections' }],
      },
      {
        items: [{ href: '/markbook/report-cards', label: 'Report Cards' }],
      },
      {
        label: 'Admin',
        items: [
          {
            href: '/markbook/change-requests',
            label: 'Change Requests',
            badgeKey: 'changeRequests',
          },
          { href: '/markbook/audit-log', label: 'Audit Log' },
        ],
      },
    ],
  },
  'p-files': PFILES_NAV,
  records: RECORDS_NAV,
  sis: SIS_NAV,
  attendance: ATTENDANCE_NAV,
  evaluation: EVALUATION_NAV,
  admissions: ADMISSIONS_NAV,
};

// Which roles may access a given route prefix. Longer prefixes are
// evaluated first via the explicit `find` order below, so `/sis/ay-setup`
// must appear before the broader `/sis` rule.
// fallow-ignore-next-line unused-export
export const ROUTE_ACCESS: Array<{ prefix: string; allowed: Role[] }> = [
  { prefix: '/sis/admin/approvers', allowed: ['superadmin'] },
  { prefix: '/sis/admin/subjects', allowed: ['school_admin', 'superadmin'] },
  { prefix: '/sis/admin/levels', allowed: ['school_admin', 'superadmin'] },
  { prefix: '/sis/admin/template', allowed: ['school_admin', 'superadmin'] },
  {
    prefix: '/sis/admin/school-config',
    allowed: ['school_admin', 'superadmin'],
  },
  // /sis/admin/users is now a redirect stub → /sis/admin/staff?view=accounts
  // (SIS Admin IA Phase 4, KD #154 — staff accounts merged into the staff
  // directory). Kept superadmin-only so the gate still fires before the
  // redirect for any role that isn't allowed to see the page at all.
  { prefix: '/sis/admin/users', allowed: ['superadmin'] },
  { prefix: '/sis/admin/settings', allowed: ['superadmin'] },
  {
    // Was missing a ROUTE_ACCESS row entirely — the registrar's Staff nav
    // link (SIS_NAV "Year Setup" group) was visible but proxy-blocked
    // because pathname resolution fell through to the broad `/sis`
    // catch-all (school_admin/superadmin only). Matches the page's own
    // inline guard (app/(sis)/sis/admin/staff/page.tsx).
    prefix: '/sis/admin/staff',
    allowed: ['registrar', 'school_admin', 'superadmin'],
  },
  {
    // Discount codes are operationally owned by admissions (they assign codes
    // to applicants); office roles keep access per their rights. Config stays
    // in SIS Admin (KD #48) — admissions reaches it via the cross-module link
    // in the Admissions sidebar. This longer prefix wins over the broader
    // `/sis` rule, so admissions is scoped to this one route, not all of /sis.
    prefix: '/sis/admin/discount-codes',
    allowed: ['admissions', 'registrar', 'school_admin', 'superadmin'],
  },
  { prefix: '/sis/ay-setup', allowed: ['school_admin', 'superadmin'] },
  {
    prefix: '/sis/calendar',
    allowed: ['registrar', 'school_admin', 'superadmin'],
  },
  {
    prefix: '/sis/sections',
    allowed: ['registrar', 'school_admin', 'superadmin'],
  },
  { prefix: '/sis/audit-log', allowed: ['school_admin', 'superadmin'] },
  {
    prefix: '/admin/admissions',
    allowed: ['registrar', 'school_admin', 'superadmin'],
  },
  {
    prefix: '/attendance/import',
    allowed: ['registrar', 'school_admin', 'superadmin'],
  },
  {
    prefix: '/attendance/calendar',
    allowed: ['registrar', 'school_admin', 'superadmin'],
  },
  {
    prefix: '/attendance',
    allowed: ['teacher', 'registrar', 'school_admin', 'superadmin'],
  },
  {
    prefix: '/evaluation/audit-log',
    allowed: ['registrar', 'school_admin', 'superadmin'],
  },
  {
    prefix: '/evaluation/virtue-themes',
    allowed: ['registrar', 'school_admin', 'superadmin'],
  },
  {
    prefix: '/evaluation',
    allowed: ['teacher', 'registrar', 'school_admin', 'superadmin'],
  },
  // Masterfile is registrar+ only — KD #95 restricts the cross-subject
  // view to operational/oversight roles. Must precede the broader
  // /markbook rule so the longer prefix wins.
  {
    prefix: '/markbook/masterfile',
    allowed: ['registrar', 'school_admin', 'superadmin'],
  },
  {
    prefix: '/markbook',
    allowed: ['teacher', 'registrar', 'school_admin', 'superadmin'],
  },
  { prefix: '/p-files', allowed: ['p-file', 'school_admin', 'superadmin'] },
  {
    prefix: '/admissions',
    allowed: ['admissions', 'registrar', 'school_admin', 'superadmin'],
  },
  // Academic Summary (the consolidated masterfile, KD #95) — registrar+ only.
  // Matches the same role set as /records overall, but kept explicit so the
  // restriction is documented at the route and longer-prefix-wins holds.
  {
    prefix: '/records/academic-summary',
    allowed: ['registrar', 'school_admin', 'superadmin'],
  },
  { prefix: '/records', allowed: ['registrar', 'school_admin', 'superadmin'] },
  { prefix: '/sis', allowed: ['school_admin', 'superadmin'] },
];

export function getUserRole(user: User | null | undefined): Role | null {
  const raw = user?.app_metadata?.role ?? user?.user_metadata?.role;
  return ROLES.includes(raw as Role) ? (raw as Role) : null;
}

export function getRoleFromClaims(
  claims: Record<string, unknown> | null | undefined
): Role | null {
  const appMeta = claims?.app_metadata as Record<string, unknown> | undefined;
  const userMeta = claims?.user_metadata as Record<string, unknown> | undefined;
  const raw = appMeta?.role ?? userMeta?.role;
  return ROLES.includes(raw as Role) ? (raw as Role) : null;
}

export function isRouteAllowed(pathname: string, role: Role | null): boolean {
  const rule = ROUTE_ACCESS.find(
    (r) => pathname === r.prefix || pathname.startsWith(r.prefix + '/')
  );
  if (!rule) return true;
  return role != null && rule.allowed.includes(role);
}
