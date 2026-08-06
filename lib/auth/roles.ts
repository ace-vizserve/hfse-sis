import type { User } from '@supabase/supabase-js';

// TYPE-ONLY on purpose. This module is in proxy.ts's import graph (edge
// runtime); a type-only import erases at compile time, so nothing from the
// capability layer reaches the edge bundle. lib/auth/capabilities.ts is pure
// and client-safe anyway (its only import is `type Role` from this file), but
// keeping it type-only makes that unarguable and keeps the dependency acyclic
// at runtime.
import type { Capability } from '@/lib/auth/capabilities';

export type Role =
  | 'teacher'
  | 'academic_coordinator'
  | 'school_admin'
  | 'superadmin'
  | 'p_file_officer'
  | 'admissions';

export const ROLES: Role[] = [
  'teacher',
  'academic_coordinator',
  'school_admin',
  'superadmin',
  'p_file_officer',
  'admissions',
];

export type Module =
  | 'markbook'
  | 'p-files'
  | 'records'
  | 'sis'
  | 'attendance'
  | 'evaluation'
  | 'admissions'
  | 'classroom';

export type NavItem = {
  href: string;
  label: string;
  badgeKey?: SidebarBadgeKey;
  // Informational count chip (mono, bordered, muted) — distinct from
  // badgeKey's realtime "needs attention" alert pill. Always shown when
  // present (no >0 gating); value is a pre-formatted string (e.g. "6/7",
  // "28") since it's assembled server-side by the layout, not counted
  // live client-side like badgeKey. SIS Admin visual pass (Task V2).
  countKey?: SidebarCountKey;
  requiresRoles?: Role[];
  // The capability the DESTINATION page guards on.
  //
  // `requiresRoles` answers "may the proxy let you through" — it mirrors
  // ROUTE_ACCESS. This answers the different question "will the page keep you
  // once you arrive", for the pages that now gate on a capability rather than a
  // role name. A page migrated to a capability gate MUST set this, or the item
  // advertises work the page then bounces the viewer away from — which is what
  // happened to the academic coordinator on /admissions/document-validation
  // (KD #173).
  //
  // ONE capability, not a list. The only page whose guard is an OR of two
  // (/p-files/document-validation, pre-enrolment read OR post-enrolment read)
  // keeps plain `requiresRoles`, which is exactly that OR's holder set; the
  // regression test proves the two agree rather than letting this field grow an
  // any-of form nothing else needs.
  requiresCapability?: Capability;
  step?: number;
  // Child rows, shown indented under this item when it is expanded.
  //
  // For pages whose sub-views are their own routes (Staff -> Accounts), so the
  // work is reachable and visible from the sidebar instead of hidden behind an
  // in-page tab. Each child is gated INDEPENDENTLY of its parent — a viewer who
  // may open Staff but lacks `staff.view_accounts` sees the parent without that
  // child, which is the whole point of gating them separately.
  //
  // One level only. A second level of nesting has no home in this sidebar's
  // visual language and nothing in the app needs it.
  children?: NavItem[];
};
export type NavSection = {
  label?: string;
  // Right-aligned cadence hint next to the group label (e.g. "weekly",
  // "yearly", "rare") — plain text, muted, no visual weight beyond the
  // existing mono-eyebrow group-label styling. Optional; groups that
  // don't set it render byte-identically to before. SIS Admin visual
  // pass (Task V2).
  hint?: string;
  items: NavItem[];
};

export type SidebarBadgeKey =
  | 'changeRequests'
  | 'pendingDocValidation'
  | 'unsyncedStudents'
  | 'pfileAwaitingVerification'
  | 'levelMismatches';
export type SidebarBadges = Partial<Record<SidebarBadgeKey, number>>;

// Informational nav-item count chips — see NavItem.countKey above.
export type SidebarCountKey =
  | 'aySetupReadiness'
  | 'sectionsCount'
  | 'staffCount';
export type SidebarCounts = Partial<Record<SidebarCountKey, string>>;

const PFILES_NAV: NavSection[] = [
  {
    items: [{ href: '/p-files', label: 'Dashboard' }],
  },
  {
    // Quick filters land on the dashboard with a `?status=` preset so the
    // P-File Officer can jump straight to the work queue. school_admin sees
    // the same lists, and the page still renders them read-only — but that is
    // now a UI gap rather than a rule: migration 106 gave her the
    // post-enrolment document capabilities while the page kept its
    // role-literal write gate. See KD #173.
    label: 'Quick filters',
    items: [{ href: '/p-files?status=expired', label: 'Expired documents' }],
  },
  {
    // Renewal-outreach windows — officer+ only (p_file_officer / school_admin
    // / superadmin) because these are the lists the bulk-remind action
    // operates on. school_admin reaches the lists but gets no bulk-notify CTA;
    // that used to be KD #74 policy and is now just the page's role-literal
    // gate lagging her migration-106 grants (KD #173). Other oversight roles
    // are not granted these quicklinks at all.
    label: 'Expiring soon',
    items: [
      {
        href: '/p-files?expiring=30',
        label: 'Within 30 days',
        requiresRoles: ['p_file_officer', 'school_admin', 'superadmin'],
      },
      {
        href: '/p-files?expiring=60',
        label: 'Within 60 days',
        requiresRoles: ['p_file_officer', 'school_admin', 'superadmin'],
      },
      {
        href: '/p-files?expiring=90',
        label: 'Within 90 days',
        requiresRoles: ['p_file_officer', 'school_admin', 'superadmin'],
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
        requiresRoles: ['p_file_officer', 'school_admin', 'superadmin'],
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
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
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
      // Both ways a level blocks enrolment (KD-adjacent to unsynced students —
      // same "surface the gap, offer a one-click fix" pattern): an admissions
      // `levelApplied` value matching no known level, and a level that has
      // students waiting but no class section to seat them in. Badge sums
      // `countUnmatchedLevelLabels` + `countLevelsAwaitingSections`, because
      // to a registrar these are one queue, not two.
      {
        href: '/records/level-mismatches',
        label: 'Levels needing attention',
        badgeKey: 'levelMismatches',
      },
      // The three cross-links below are SHORTCUTS, not the only way in.
      //
      // They were added when the academic coordinator had no SIS tile — the
      // switcher shows a module iff `isRouteAllowed(primaryHref)` and SIS's is
      // `/sis`, which she couldn't open, so these routes were reachable only by
      // typing the URL. That changed on 2026-07-31: `/sis` now admits her, she
      // gets the tile and the SIS sidebar, and each of these appears there too.
      //
      // Kept anyway, deliberately. Section setup and the staff directory are
      // things she reaches WHILE working in Records (rosters, class index
      // numbers, who advises what), so making her switch modules for them would
      // be a step backwards. Anyone editing these: the old "she can't reach SIS
      // at all" justification is spent — the reason now is task adjacency.
      {
        href: '/sis/sections',
        label: 'Section setup',
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
      },
      {
        href: '/sis/admin/staff',
        label: 'Staff directory',
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
      },
      {
        // She owns the WW/PT/QA weighting behind every grade, so this is
        // squarely her work — and it sits next to the grade data she reads in
        // Records.
        href: '/sis/admin/subjects',
        label: 'Subject weights',
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
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
  // Academic Summary hub (KD #95/#127). The Awards/Attendance/Comments
  // quick views were relocated to their owning modules (Markbook/
  // Attendance/Evaluation respectively) in the Academic Summary module
  // redesign — this hub link is what remains.
  {
    label: 'Academic Summary',
    items: [
      {
        href: '/records/academic-summary',
        label: 'Overview',
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
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
      // Phase 7 repointed this to /classroom; Phase 8 reverts it (design doc
      // 2026-07-28-classroom-workspace-design.md, Phase 8) — the handoff
      // into Classroom now happens at the row level, per role, not at the
      // nav level. A teacher clicking through from Attendance stays in
      // Attendance's own working surface; only the row destination changes.
      { href: '/attendance/sections', label: 'Sections' },
      {
        href: '/attendance/insights',
        label: 'Insights',
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
      },
      {
        href: '/attendance/summary',
        label: 'Attendance Summary',
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
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
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
      },
      {
        href: '/attendance/import',
        label: 'Import',
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
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
          'academic_coordinator',
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
      // awaiting review. Badge mirrors the row count from
      // `countPendingDocValidation`.
      //
      // CAPABILITY-GATED, not role-gated (KD #173). The page redirects anyone
      // without `documents_pre_enrolment.read`, and migration 106 took that off
      // the academic coordinator when document validation moved to the P-Files
      // officer and school_admin. She is admitted to /admissions by
      // ROUTE_ACCESS, so a `requiresRoles` list here would have to restate the
      // capability's holder set and then drift from it the next time a grant
      // moves. Naming the capability makes the row and the page read the same
      // source.
      {
        href: '/admissions/document-validation',
        requiresCapability: 'documents_pre_enrolment.read',
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
          'academic_coordinator',
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
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
      },
      {
        href: '/admissions?status=expired',
        label: 'Expired documents',
        requiresRoles: [
          'admissions',
          'academic_coordinator',
          'school_admin',
          'superadmin',
        ],
      },
      {
        href: '/sis/ay-setup',
        label: 'AY Setup',
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
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
    items: [
      // Phase 7 repointed this to /classroom; Phase 8 reverts it (design doc
      // 2026-07-28-classroom-workspace-design.md, Phase 8) — the handoff
      // into Classroom now happens at the row level, per role, not at the
      // nav level. Phase 9 renamed "All terms" → "Sections" and dropped the
      // Quick filters group (below) — the list page no longer scopes by
      // term, so `?term=N` quicklinks and the old term-in-eyebrow label were
      // both stale (design doc 2026-07-28-classroom-workspace-design.md
      // Phase 9 / phase-9-brief.md).
      { href: '/evaluation/sections', label: 'Sections' },
      {
        href: '/evaluation/comments',
        label: 'Comments',
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
      },
    ],
  },
  {
    label: 'Setup',
    items: [
      {
        href: '/evaluation/virtue-themes',
        label: 'Virtue themes',
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
      },
    ],
  },
  {
    label: 'Administration',
    items: [
      {
        href: '/evaluation/audit-log',
        label: 'Audit Log',
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
      },
    ],
  },
];

// Classroom module — a section × term workspace for teaching staff (design
// doc 2026-07-28-classroom-workspace-design.md). Route group:
// (classroom)/classroom/*. Phase 2 ships only the class list; the module is
// deliberately a single flat nav item — there is nothing else to link to
// yet (no quick action either, same reasoning as Attendance/Evaluation:
// the one nav item already is the destination).
const CLASSROOM_NAV: NavSection[] = [
  { items: [{ href: '/classroom', label: 'All classes' }] },
];

// SIS admin hub — the system-level admin surface where structural ops live.
// Distinct from Records. Route group: (sis)/sis/*. Access: school_admin +
// superadmin own the full hub (Sprint 33 consolidation — the old `admin`
// twin was retired and school_admin is now the cross-cutting generalist).
// Groups mirror the landing-page sections on /sis (page.tsx).
// Group structure restored to the production sidebar (Year Setup /
// Organisation / Access / System) per user request (2026-07-12), carrying
// the post-KD #154 item set and names: no "Sync from Admissions" (page
// deleted — auto-sync cron per KD #90/#154), and no "Users" (accounts
// merged into Staff's Accounts cut; /sis/admin/users is a superadmin-gated
// redirect stub reachable via the "Staff accounts" command-palette entry or
// the Staff page's Accounts tab). "Grade Levels" (KD #153's managed-entity
// page) was removed by migration 086 — the volatile-level / per-AY-offering
// concept it managed was deleted outright; the level catalog is now a fixed
// 10-row constant (lib/sis/levels.ts) with no admin surface.
// Grouping/relatedness pass (2026-07-17): "Access" (a single-item group
// holding only Approvers) folded into "System" — a labeled section over one
// row wasn't grouping anything. The sis module's `quickActionByRole`
// (lib/sidebar/registry.ts) was also emptied out — both prior entries (AY
// Setup for superadmin, School Calendar for school_admin) duplicated the
// first two rows of this very "Year Setup" group, so the CTA slot added a
// visually-duplicate row with zero click savings, unlike other modules
// where the quick action actually skips past several groups.
// Structure Defaults removed (migration 089, Structure Defaults template
// removal): the "Structure Defaults" nav item (was "Class Template," then
// renamed 2026-07-17) is gone — new AYs now always copy their starting
// sections/subjects/weights forward from the most recently created prior
// AY, so there's no admin-managed template to link to. "Organisation" now
// holds Discount Codes + Subject Weights only.
const SIS_NAV: NavSection[] = [
  {
    items: [
      {
        href: '/sis',
        label: 'Admin Hub',
        // Mirrors ROUTE_ACCESS's `/sis` catch-all exactly — a nav link visible
        // to a role the proxy then bounces is the dead-end KD #159 direction A
        // exists to prevent, and the guard test asserts these two agree. The
        // academic coordinator was added to both on 2026-07-31 so SIS Admin
        // shows up in her module switcher; her cross-links from Records and
        // Admissions still work and are now a shortcut rather than the only
        // way in.
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
      },
    ],
  },
  {
    label: 'Year Setup',
    items: [
      {
        href: '/sis/ay-setup',
        label: 'AY Setup',
        countKey: 'aySetupReadiness',
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
      },
      {
        href: '/sis/calendar',
        label: 'School Calendar',
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
      },
      {
        href: '/sis/sections',
        label: 'Sections',
        countKey: 'sectionsCount',
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
      },
      {
        href: '/sis/admin/staff',
        label: 'Staff',
        countKey: 'staffCount',
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
        // Both cuts of the staff directory, each its own route. Accounts is
        // capability-gated independently, so the academic coordinator sees the
        // parent and Teaching assignments but not Accounts — matching what the
        // page itself enforces.
        children: [
          {
            href: '/sis/admin/staff',
            label: 'Teaching assignments',
          },
          {
            href: '/sis/admin/staff/accounts',
            label: 'Accounts',
            requiresCapability: 'staff.view_accounts',
          },
        ],
      },
    ],
  },
  {
    label: 'Organisation',
    items: [
      {
        href: '/sis/admin/discount-codes',
        label: 'Discount Codes',
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
      },
      {
        href: '/sis/admin/subjects',
        label: 'Subject Weights',
        requiresRoles: ['academic_coordinator', 'school_admin', 'superadmin'],
      },
    ],
  },
  {
    label: 'System',
    items: [
      // Approvers folded in from the former standalone "Access" group — a
      // labeled section over a single row didn't group anything; it's
      // access-control config alongside School Config/Settings/Audit Log.
      {
        href: '/sis/admin/approvers',
        label: 'Approvers',
        requiresRoles: ['superadmin'],
      },
      {
        href: '/sis/admin/roles',
        label: 'Role permissions',
        requiresRoles: ['superadmin'],
      },
      {
        href: '/sis/admin/school-config',
        label: 'School Config',
        requiresRoles: ['school_admin', 'superadmin'],
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
  classroom: NavSection[];
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
    academic_coordinator: [
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
        // Phase 7 repointed this to /classroom; Phase 8 reverts it (design
        // doc 2026-07-28-classroom-workspace-design.md, Phase 8) — the
        // handoff into Classroom now happens at the row level, per role,
        // not at the nav level.
        label: 'Students',
        items: [{ href: '/markbook/sections', label: 'Sections' }],
      },
      {
        items: [
          { href: '/markbook/report-cards', label: 'Report Cards' },
          { href: '/markbook/awards', label: 'Awards' },
        ],
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
        // school_admin was the only Markbook-allowed role with no Grading
        // group — reachable by URL (ROUTE_ACCESS `/markbook` + the RLS
        // `is_registrar_or_above()` gate both allow it, and the page even
        // grants them `canCreate`), but with no way to click there. They
        // are also the grade-change approver pool (KD #41), so inspecting
        // a sheet is core to their job.
        //
        // "New Sheet" is deliberately absent here, unlike the coordinator's and
        // superadmin's copies of this group: /markbook/grading/new gates on
        // ALLOWED_ROLES = { academic_coordinator, superadmin } and 404s a
        // school_admin, so the item was a dead link. The KD #159 nav test
        // cannot catch it — its documented direction-B limitation is that it
        // checks ROUTE_ACCESS prefixes, and that page sits under the broad
        // `/markbook` rule this role already links elsewhere.
        label: 'Grading',
        items: [{ href: '/markbook/grading', label: 'All Sheets' }],
      },
      {
        // Phase 7 repointed this to /classroom; Phase 8 reverts it (design
        // doc 2026-07-28-classroom-workspace-design.md, Phase 8) — the
        // handoff into Classroom now happens at the row level, per role,
        // not at the nav level.
        label: 'Students',
        items: [{ href: '/markbook/sections', label: 'Sections' }],
      },
      {
        items: [
          { href: '/markbook/report-cards', label: 'Report Cards' },
          { href: '/markbook/awards', label: 'Awards' },
        ],
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
        // Phase 7 repointed this to /classroom; Phase 8 reverts it (design
        // doc 2026-07-28-classroom-workspace-design.md, Phase 8) — the
        // handoff into Classroom now happens at the row level, per role,
        // not at the nav level.
        label: 'Students',
        items: [{ href: '/markbook/sections', label: 'Sections' }],
      },
      {
        items: [
          { href: '/markbook/report-cards', label: 'Report Cards' },
          { href: '/markbook/awards', label: 'Awards' },
        ],
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
  classroom: CLASSROOM_NAV,
};

// Which roles may access a given route prefix. Longer prefixes are
// evaluated first via the explicit `find` order below, so `/sis/ay-setup`
// must appear before the broader `/sis` rule.
// fallow-ignore-next-line unused-export
export const ROUTE_ACCESS: Array<{
  prefix: string;
  allowed: Role[];
  // Match THIS PATHNAME ONLY, never the subtree beneath it.
  //
  // The one thing a prefix table cannot otherwise say is "the file, not the
  // folder": `/admissions/applications` and
  // `/admissions/applications/[enroleeNumber]` share a prefix string, so no
  // amount of reordering separates the list page from a detail page. Needed
  // when a role should reach a record they were linked to without being handed
  // the whole index — see the P-Files officer rows below (KD #173).
  //
  // First-match-in-declaration-order still decides everything, so an `exact`
  // row must sit ABOVE the subtree row it carves out of.
  exact?: boolean;
}> = [
  { prefix: '/sis/admin/approvers', allowed: ['superadmin'] },
  // Who may edit what each role is allowed to do. Superadmin only, and
  // deliberately gated on the ROLE rather than on a capability: a capability
  // controlling access to the capability editor could be revoked, locking the
  // holder out of the only surface that could put it back.
  { prefix: '/sis/admin/roles', allowed: ['superadmin'] },
  {
    // academic_coordinator added so a role granted `subjects.read` can actually
    // reach the page — the capability governs what you may DO, this rule governs
    // whether the proxy lets you through, and the proxy runs first. Scoped to
    // this one prefix (longer-prefix-wins), so the broad `/sis` rule below still
    // keeps her out of every other SIS surface. Same shape as the
    // /sis/admin/staff row (KD #154/#159).
    prefix: '/sis/admin/subjects',
    allowed: ['academic_coordinator', 'school_admin', 'superadmin'],
  },
  {
    prefix: '/sis/admin/school-config',
    allowed: ['school_admin', 'superadmin'],
  },
  // /sis/admin/users is now a redirect stub → /sis/admin/staff?view=accounts
  // (SIS Admin IA Phase 4, KD #154 — staff accounts merged into the staff
  // directory). Kept superadmin-only so the gate still fires before the
  // redirect for any role that isn't allowed to see the page at all.
  { prefix: '/sis/admin/users', allowed: ['superadmin'] },
  {
    // Was missing a ROUTE_ACCESS row entirely — the registrar's Staff nav
    // link (SIS_NAV "Year Setup" group) was visible but proxy-blocked
    // because pathname resolution fell through to the broad `/sis`
    // catch-all (school_admin/superadmin only). Matches the page's own
    // inline guard (app/(sis)/sis/admin/staff/page.tsx).
    prefix: '/sis/admin/staff',
    allowed: ['academic_coordinator', 'school_admin', 'superadmin'],
  },
  {
    // Discount codes are operationally owned by admissions (they assign codes
    // to applicants); office roles keep access per their rights. Config stays
    // in SIS Admin (KD #48) — admissions reaches it via the cross-module link
    // in the Admissions sidebar. This longer prefix wins over the broader
    // `/sis` rule, so admissions is scoped to this one route, not all of /sis.
    prefix: '/sis/admin/discount-codes',
    allowed: [
      'admissions',
      'academic_coordinator',
      'school_admin',
      'superadmin',
    ],
  },
  // academic_coordinator added 2026-07-31 (Mr Ace) — she sets up the academic
  // year alongside classes and subject weights. The proxy runs before any page
  // guard, so this row is what lets her through; what she may DO once inside is
  // the `academic_year.*` capability set, editable at /sis/admin/roles.
  {
    prefix: '/sis/ay-setup',
    allowed: ['academic_coordinator', 'school_admin', 'superadmin'],
  },
  {
    prefix: '/sis/calendar',
    allowed: ['academic_coordinator', 'school_admin', 'superadmin'],
  },
  {
    prefix: '/sis/sections',
    allowed: ['academic_coordinator', 'school_admin', 'superadmin'],
  },
  { prefix: '/sis/audit-log', allowed: ['school_admin', 'superadmin'] },
  {
    prefix: '/admin/admissions',
    allowed: ['academic_coordinator', 'school_admin', 'superadmin'],
  },
  // The bare legacy `/admin` bookmark, which is a one-line `redirect('/records')`
  // stub like its `/admin/admissions` sibling above. It had no rule at all until
  // KD #173, and `isRouteAllowed` returns true for an unmatched prefix — so a
  // teacher, admissions or p_file_officer user opening an old bookmark was let
  // through, redirected to /records, blocked there by the proxy, bounced to `/`,
  // and redirected once more by the home page's own role routing. Three hops to
  // say "no". With this row the gate fires on the first request, which is the
  // whole reason a redirect stub carries a ROUTE_ACCESS row.
  //
  // Must sit AFTER `/admin/admissions`: first-match-in-declaration-order decides,
  // and this shorter prefix would otherwise swallow that row. The two allow the
  // same roles today, so nothing breaks if they diverge — but the ordering is
  // what keeps them independently editable.
  {
    prefix: '/admin',
    allowed: ['academic_coordinator', 'school_admin', 'superadmin'],
  },
  // Classroom — a section × term workspace for teaching staff. Mandatory
  // row: isRouteAllowed defaults to ALLOW for any prefix with no matching
  // rule, so without this, admissions and p_file_officer (who have no
  // teaching role) could open it. No competing `/classroom*` rule exists,
  // so placement relative to the other rules doesn't matter for
  // longest-prefix-wins.
  {
    prefix: '/classroom',
    allowed: ['teacher', 'academic_coordinator', 'school_admin', 'superadmin'],
  },
  {
    prefix: '/attendance/import',
    allowed: ['academic_coordinator', 'school_admin', 'superadmin'],
  },
  {
    prefix: '/attendance/calendar',
    allowed: ['academic_coordinator', 'school_admin', 'superadmin'],
  },
  // Attendance Summary (Academic Summary redesign) is registrar+ only —
  // must precede the broader /attendance rule so the longer prefix wins.
  {
    prefix: '/attendance/summary',
    allowed: ['academic_coordinator', 'school_admin', 'superadmin'],
  },
  {
    prefix: '/attendance',
    allowed: ['teacher', 'academic_coordinator', 'school_admin', 'superadmin'],
  },
  {
    prefix: '/evaluation/audit-log',
    allowed: ['academic_coordinator', 'school_admin', 'superadmin'],
  },
  {
    prefix: '/evaluation/virtue-themes',
    allowed: ['academic_coordinator', 'school_admin', 'superadmin'],
  },
  // Comments (Academic Summary redesign) is registrar+ only — must precede
  // the broader /evaluation rule so the longer prefix wins.
  {
    prefix: '/evaluation/comments',
    allowed: ['academic_coordinator', 'school_admin', 'superadmin'],
  },
  {
    prefix: '/evaluation',
    allowed: ['teacher', 'academic_coordinator', 'school_admin', 'superadmin'],
  },
  // Masterfile is registrar+ only — KD #95 restricts the cross-subject
  // view to operational/oversight roles. Must precede the broader
  // /markbook rule so the longer prefix wins.
  {
    prefix: '/markbook/masterfile',
    allowed: ['academic_coordinator', 'school_admin', 'superadmin'],
  },
  // Awards (Academic Summary redesign) is registrar+ only — must precede
  // the broader /markbook rule so the longer prefix wins.
  {
    prefix: '/markbook/awards',
    allowed: ['academic_coordinator', 'school_admin', 'superadmin'],
  },
  {
    prefix: '/markbook',
    allowed: ['teacher', 'academic_coordinator', 'school_admin', 'superadmin'],
  },
  {
    prefix: '/p-files',
    allowed: ['p_file_officer', 'school_admin', 'superadmin'],
  },
  // ── The applicant record, split list-vs-detail for the P-Files officer ────
  // These three rows are order-sensitive; see `exact` on ROUTE_ACCESS above.
  //
  // Migration 106 gave `p_file_officer` the pre-enrolment document
  // capabilities, so /p-files/document-validation now shows them an Applicants
  // tab. Every applicant name in that queue links to the applicant file — which
  // lived behind the broad /admissions rule, so the link bounced them to `/`.
  // They may now open the FILE. They still may not browse the funnel: the
  // closed archive and the applications list keep their original audience.
  {
    prefix: '/admissions/applications/closed',
    allowed: [
      'admissions',
      'academic_coordinator',
      'school_admin',
      'superadmin',
    ],
  },
  {
    // The list. `exact` is the whole mechanism — without it this row would
    // swallow every detail page below and the officer would be shut out again.
    prefix: '/admissions/applications',
    exact: true,
    allowed: [
      'admissions',
      'academic_coordinator',
      'school_admin',
      'superadmin',
    ],
  },
  {
    // The applicant file. Detail-only by construction: the `exact` row above
    // has already claimed the bare list path.
    prefix: '/admissions/applications',
    allowed: [
      'admissions',
      'academic_coordinator',
      'school_admin',
      'superadmin',
      'p_file_officer',
    ],
  },
  {
    prefix: '/admissions',
    allowed: [
      'admissions',
      'academic_coordinator',
      'school_admin',
      'superadmin',
    ],
  },
  // Academic Summary (the consolidated masterfile, KD #95) — registrar+ only.
  // Matches the same role set as /records overall, but kept explicit so the
  // restriction is documented at the route and longer-prefix-wins holds.
  {
    prefix: '/records/academic-summary',
    allowed: ['academic_coordinator', 'school_admin', 'superadmin'],
  },
  {
    prefix: '/records',
    allowed: ['academic_coordinator', 'school_admin', 'superadmin'],
  },
  // The hub admits the academic coordinator so SIS Admin appears in her module
  // switcher — the switcher shows a module iff `isRouteAllowed(primaryHref)`,
  // and SIS's primaryHref is this route, so without this row she owned four
  // surfaces under /sis with no way in except a cross-link from another
  // module's sidebar. Narrows KD #154's "hub is school_admin+" on Mr Ace's
  // explicit instruction (2026-07-31).
  //
  // This is the catch-all, so it only grants what no longer-prefix rule
  // overrides: ay-setup, calendar, sections, staff and admin/subjects each
  // carry their own row admitting her, while audit-log, school-config,
  // approvers and admin/roles carry rows that do not — longer-prefix-wins
  // keeps her out of those. The hub is status-and-launch, so what it can
  // expose is bounded by what she can already open; the two links that were
  // NOT so bounded (the approver-readiness attention row and the "New staff
  // member" quick action, which deep-links to an Accounts tab she cannot see)
  // are gated at their source rather than left as dead ends.
  {
    prefix: '/sis',
    allowed: ['academic_coordinator', 'school_admin', 'superadmin'],
  },
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
  const rule = ROUTE_ACCESS.find((r) =>
    r.exact
      ? pathname === r.prefix
      : pathname === r.prefix || pathname.startsWith(r.prefix + '/')
  );
  if (!rule) return true;
  return role != null && rule.allowed.includes(role);
}
