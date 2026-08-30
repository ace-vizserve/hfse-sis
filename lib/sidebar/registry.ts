import {
  AlertTriangle,
  Archive,
  ArrowRightLeft,
  Award,
  BookOpen,
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarCog,
  CalendarDays,
  CalendarRange,
  CalendarX2,
  ClipboardCheck,
  ClipboardList,
  FileCheck,
  FileClock,
  FilePen,
  FilePlus2,
  FileQuestion,
  FileStack,
  FileText,
  FileUp,
  FolderOpen,
  Gavel,
  Handshake,
  HeartPulse,
  History,
  IdCard,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  MessageSquare,
  RefreshCw,
  Scale,
  School,
  ShieldCheck,
  Sparkles,
  Stamp,
  Tag,
  TrendingUp,
  UserCog,
  Users,
  UserX,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import type { Module, Role, SidebarBadgeKey } from '@/lib/auth/roles';

export type SidebarModule = Module;

export type QuickAction = {
  label: string;
  href: string;
  icon: LucideIcon;
  badgeKey?: SidebarBadgeKey;
};

export type ModuleSidebarConfig = {
  label: string;
  icon: LucideIcon;
  primaryHref: string;
  iconByHref: Record<string, LucideIcon>;
  fallbackIcon: LucideIcon;
  quickActionByRole: Partial<Record<Role, QuickAction>>;
};

// Order shown in the module-switcher popover. Lifecycle: intake →
// identity → docs → classroom (teaching entry point) → grading →
// attendance → evaluation → admin config.
export const MODULE_ORDER: Module[] = [
  'admissions',
  'records',
  'p-files',
  'classroom',
  'markbook',
  'attendance',
  'evaluation',
  'sis',
];

// ---------------------------------------------------------------------------
// One glyph per JOB, not per module.
//
// A sidebar icon has exactly two duties: tell a row apart from its neighbours,
// and read the same everywhere the same page appears. Both were being broken,
// because `iconByHref` is a per-module map with a `fallbackIcon` behind it — so
// a nav item added without an entry here rendered the MODULE's glyph, silently.
// Records had eight rows drawing one identical `LayoutDashboard` (the same
// glyph as its own Dashboard row), Admissions five, and Markbook used
// `FileText` for three different destinations. Meanwhile `/sis/ay-setup` drew
// a different icon depending on which sidebar you reached it from.
//
// The constants below are the fix for the second half: a route or a page-kind
// that appears in more than one module resolves through ONE name, so the two
// copies cannot drift apart. `__tests__/ui/sidebar-icon-coverage.test.ts` is
// the fix for the first half — it fails the build when a nav href has no entry
// here, or when two rows of one sidebar draw the same glyph.
//
// Adding a nav item? Add its icon here too. The fallback is a safety net, not
// a default.
// ---------------------------------------------------------------------------

/** A module's landing page. */
const ICON_DASHBOARD = LayoutDashboard;
/** Trends and analytics. The Insights pages head their own hero with this. */
const ICON_INSIGHTS = TrendingUp;
/** Who changed what, and when. */
const ICON_AUDIT_LOG = History;
/** A list of classes you open to work on one — Markbook, Attendance, Evaluation. */
const ICON_ROSTER = Users;
/** The student directory. Same people-glyph as a roster; never in the same sidebar. */
const ICON_STUDENT_DIRECTORY = Users;
/** Work waiting on your decision — change requests, parent declarations. */
const ICON_APPROVAL_INBOX = Stamp;
/** Uploaded documents queued for review — P-Files and Admissions. */
const ICON_DOC_VALIDATION = FileCheck;
/** Student Pass (ICA) applications — Records and Admissions. */
const ICON_STP = IdCard;
/** Medical alerts — Records and Admissions. */
const ICON_MEDICAL = HeartPulse;
/** The staff directory. Distinct from students, who get ICON_ROSTER. */
const ICON_STAFF = UserCog;
/** Class section setup — reached from Records and SIS Admin. */
const ICON_SECTION_SETUP = LayoutGrid;
/** WW/PT/QA weighting — reached from Records and SIS Admin. */
const ICON_SUBJECT_WEIGHTS = Scale;
/** Enrolment-fee discount codes — reached from Records, Admissions and SIS Admin. */
const ICON_DISCOUNT_CODES = Tag;
/** Term dates and non-school days — reached from Attendance and SIS Admin. */
const ICON_SCHOOL_CALENDAR = CalendarDays;
/** Academic-year rollover — reached from Admissions and SIS Admin. */
const ICON_AY_SETUP = CalendarCog;

const MARKBOOK_QUICK_REGISTRAR: QuickAction = {
  label: 'Review change requests',
  href: '/markbook/change-requests',
  icon: ICON_APPROVAL_INBOX,
  badgeKey: 'changeRequests',
};

export const SIDEBAR_REGISTRY: Record<SidebarModule, ModuleSidebarConfig> = {
  markbook: {
    label: 'Markbook',
    icon: BookOpen,
    primaryHref: '/markbook',
    fallbackIcon: BookOpen,
    iconByHref: {
      '/markbook': ICON_DASHBOARD,
      '/markbook/insights': ICON_INSIGHTS,
      '/markbook/grading': ClipboardList,
      '/markbook/grading/new': FilePlus2,
      // The two ends of the change-request flow, and they are deliberately
      // different glyphs: a teacher ASKS for a locked mark to be reopened
      // (FilePen — you are writing the request), an approver DECIDES
      // (ICON_APPROVAL_INBOX — you are stamping someone else's). All three of
      // these rows plus Report Cards used to draw one identical FileText.
      '/markbook/grading/requests': FilePen,
      '/markbook/change-requests': ICON_APPROVAL_INBOX,
      '/markbook/sections': ICON_ROSTER,
      '/markbook/report-cards': FileText,
      '/markbook/awards': Award,
      '/markbook/audit-log': ICON_AUDIT_LOG,
    },
    quickActionByRole: {
      // No teacher quick action — the destination (My Sheets) is already
      // the second row of nav, right under Dashboard, so a CTA would only
      // duplicate it. It's also a functional no-op: the RSC query
      // (app/(markbook)/markbook/grading/page.tsx) relies on RLS to scope
      // a teacher's rows to their own sheets already, so the `mine`
      // toggle the old CTA's `?grading.mine=1` set had nothing left to
      // filter.
      academic_coordinator: MARKBOOK_QUICK_REGISTRAR,
      // school_admin is the consolidated approver pool (Sprint 33) and
      // gets the same quick action as registrar.
      school_admin: MARKBOOK_QUICK_REGISTRAR,
      superadmin: MARKBOOK_QUICK_REGISTRAR,
    },
  },

  classroom: {
    label: 'Classroom',
    icon: School,
    primaryHref: '/classroom',
    fallbackIcon: School,
    iconByHref: {
      '/classroom': School,
    },
    // No quick action — the single nav item (All classes) is already the
    // destination, same reasoning as Attendance/Evaluation above.
    quickActionByRole: {},
  },

  attendance: {
    label: 'Attendance',
    icon: CalendarCheck,
    primaryHref: '/attendance',
    fallbackIcon: CalendarCheck,
    // Every row carries its own icon. Four of these used to resolve to
    // CalendarCheck — Sections and Summary said so explicitly, Declarations
    // and Insights were absent and fell through to `fallbackIcon` — so most
    // of the module's nav was one repeated glyph and the icons named the
    // module rather than the destination. Each now says what the row is:
    // a roster, a filing awaiting a decision, a trend, a date range.
    iconByHref: {
      '/attendance': ICON_DASHBOARD,
      // The class roster you open to mark — same icon, same meaning, as
      // '/markbook/sections'.
      '/attendance/sections': ICON_ROSTER,
      // A parent-filed absence or travel declaration waiting on YOUR
      // decision, so it takes the approval-inbox glyph shared with Markbook's
      // Change Requests. It used to borrow document-validation's FileCheck,
      // which read as "check these uploads" — a different job in a different
      // module, and the reason two unrelated pages looked alike.
      '/attendance/declarations': ICON_APPROVAL_INBOX,
      '/attendance/insights': ICON_INSIGHTS,
      '/sis/calendar': ICON_SCHOOL_CALENDAR,
      '/attendance/import': FileUp,
      '/attendance/audit-log': ICON_AUDIT_LOG,
      // Term-wide, read across a span of dates rather than marked on one.
      '/attendance/summary': CalendarRange,
    },
    // No quick action for any role — teacher's would-be target (Sections)
    // is already the second row of nav, right under Dashboard, with an
    // identical href, so a CTA would only duplicate it with zero click
    // savings. Registrars+ land on the analytics dashboard which IS the
    // action.
    quickActionByRole: {},
  },

  'p-files': {
    label: 'P-Files',
    icon: FolderOpen,
    primaryHref: '/p-files',
    fallbackIcon: FolderOpen,
    iconByHref: {
      '/p-files': ICON_DASHBOARD,
      '/p-files/document-validation': ICON_DOC_VALIDATION,
      '/p-files/audit-log': ICON_AUDIT_LOG,
      // P-Files only surfaces the renewal lens for enrolled students:
      // already-expired + the 30/60/90-day expiring window. Initial-chase
      // statuses (To follow, Rejected, Uploaded/Pending review) belong on
      // Admissions per the un-enrolled vs enrolled scope split.
      //
      // The three windows share one glyph ON PURPOSE — they are one page at
      // three horizons, and the number in the label is what tells them apart.
      // The icon-coverage test carries them as a named exemption.
      '/p-files?status=expired': AlertTriangle,
      '/p-files?expiring=30': CalendarClock,
      '/p-files?expiring=60': CalendarClock,
      '/p-files?expiring=90': CalendarClock,
    },
    quickActionByRole: {
      // P-Files quick action = the most-actionable renewal bucket: docs
      // expiring within 30 days. Already-expired surfaces as a sidebar
      // nav item one click away.
      //
      // No school_admin entry, and that is now a GAP rather than a policy.
      // KD #31 made her read-only on P-Files, but migration 106 granted her
      // `documents_post_enrolment.chase/upload/validate` — while the pages
      // still gate their write actions on a `role === 'p_file_officer' ||
      // 'superadmin'` literal. So she holds the rights and cannot reach them.
      // Deliberately left alone here (KD #173): widening the P-Files write
      // surface is its own decision, not a side effect of a comment fix.
      p_file_officer: {
        label: 'Expiring ≤30 days',
        href: '/p-files?expiring=30',
        icon: CalendarClock,
      },
    },
  },

  records: {
    label: 'Records',
    icon: Users,
    primaryHref: '/records',
    // The module glyph, not LayoutDashboard — that one belongs to the
    // Dashboard row, and using it as the fallback is how eight unmapped rows
    // ended up impersonating it.
    fallbackIcon: Users,
    iconByHref: {
      '/records': ICON_DASHBOARD,
      '/records/insights': ICON_INSIGHTS,
      '/records/students': ICON_STUDENT_DIRECTORY,
      '/records/movements': ArrowRightLeft,
      // Incident and disciplinary records. The system records these and
      // decides nothing (KD #189), so the glyph names the register, not a
      // verdict being handed down.
      '/records/discipline': Gavel,
      '/records/unsynced': UserX,
      '/records/level-mismatches': FileQuestion,
      '/sis/sections': ICON_SECTION_SETUP,
      '/sis/admin/staff': ICON_STAFF,
      '/sis/admin/subjects': ICON_SUBJECT_WEIGHTS,
      '/sis/admin/discount-codes': ICON_DISCOUNT_CODES,
      // Cohort lenses. Each is a different question about the same students,
      // so each gets its own glyph; STP and Medical match their Admissions
      // twins exactly.
      '/records/cohorts/stp': ICON_STP,
      '/records/cohorts/medical': ICON_MEDICAL,
      '/records/cohorts/pass-expiry': CalendarX2,
      '/records/audit-log': ICON_AUDIT_LOG,
      '/records/academic-summary': BookOpen,
    },
    quickActionByRole: {
      academic_coordinator: {
        label: 'Browse students',
        href: '/records/students',
        icon: ICON_STUDENT_DIRECTORY,
      },
      school_admin: {
        label: 'Browse students',
        href: '/records/students',
        icon: ICON_STUDENT_DIRECTORY,
      },
      superadmin: {
        label: 'Browse students',
        href: '/records/students',
        icon: ICON_STUDENT_DIRECTORY,
      },
    },
  },

  admissions: {
    label: 'Admissions',
    icon: FileStack,
    primaryHref: '/admissions',
    // The module glyph — see the note on Records' fallback.
    fallbackIcon: FileStack,
    iconByHref: {
      '/admissions': ICON_DASHBOARD,
      '/admissions/insights': ICON_INSIGHTS,
      '/admissions/applications': FileStack,
      // Next year's funnel running in parallel with this one (KD #77) — the
      // same list of applications, held for a year that hasn't started.
      '/admissions/upcoming/applications': FileClock,
      '/admissions/applications/closed': Archive,
      '/admissions/document-validation': ICON_DOC_VALIDATION,
      '/admissions/cohorts/stp': ICON_STP,
      '/admissions/cohorts/medical': ICON_MEDICAL,
      // Documents a parent committed to send by a date they named.
      '/admissions/cohorts/promised': Handshake,
      '/admissions/cohorts/pre-course': ClipboardList,
      '/admissions/feedback': MessageSquare,
      '/admissions/audit-log': ICON_AUDIT_LOG,
      '/sis/admin/discount-codes': ICON_DISCOUNT_CODES,
      // Pre-enrolment chase quicklinks (Workstream A) — focused-view
      // filters on the dashboard for the un-enrolled scope. Mirror the
      // P-Files renewal quicklinks pattern from KD #64.
      '/admissions?status=to-follow': CalendarClock,
      '/admissions?status=rejected': XCircle,
      '/admissions?status=expired': AlertTriangle,
      '/records/students': ICON_STUDENT_DIRECTORY,
      // No '/p-files' entry: Admissions has not linked it since the Quicklinks
      // group was rewritten, and the stale mapping said FolderOpen (the P-Files
      // MODULE glyph) where P-Files' own map says LayoutDashboard (its
      // dashboard row) — one href, two pictures, which is what the uniformity
      // test exists to stop. If a cross-link comes back, decide which of the
      // two it means and add a reasoned exemption.
      '/sis/ay-setup': ICON_AY_SETUP,
    },
    quickActionByRole: {
      // Admissions team's most-actionable bucket: parents committed but
      // file not yet sent. Other roles still get the generic "Open
      // applications" CTA — they don't own the chase loop day-to-day.
      admissions: {
        label: 'To follow',
        href: '/admissions?status=to-follow',
        icon: CalendarClock,
      },
      academic_coordinator: {
        label: 'Open applications',
        href: '/admissions/applications',
        icon: FileStack,
      },
      school_admin: {
        label: 'Open applications',
        href: '/admissions/applications',
        icon: FileStack,
      },
      superadmin: {
        label: 'Open applications',
        href: '/admissions/applications',
        icon: FileStack,
      },
    },
  },

  evaluation: {
    label: 'Evaluation',
    icon: ClipboardCheck,
    primaryHref: '/evaluation',
    fallbackIcon: ClipboardCheck,
    iconByHref: {
      '/evaluation': ICON_DASHBOARD,
      // The same "pick a class to work on" list Markbook and Attendance
      // show, so it takes the same glyph. It used to draw SquarePen, which
      // named the write-up rather than the page you actually land on.
      '/evaluation/sections': ICON_ROSTER,
      '/evaluation/virtue-themes': Sparkles,
      '/evaluation/comments': MessageSquare,
      '/evaluation/audit-log': ICON_AUDIT_LOG,
    },
    // No quick action for any role — teacher's would-be target (All
    // terms) is already the second row of nav, right under Dashboard,
    // with an identical href, so a CTA would only duplicate it with zero
    // click savings. Registrar+ land on the analytics dashboard.
    quickActionByRole: {},
  },

  sis: {
    label: 'SIS Admin',
    icon: ShieldCheck,
    primaryHref: '/sis',
    // The module glyph — see the note on Records' fallback.
    fallbackIcon: ShieldCheck,
    iconByHref: {
      '/sis': ICON_DASHBOARD,
      '/sis/ay-setup': ICON_AY_SETUP,
      '/sis/calendar': ICON_SCHOOL_CALENDAR,
      '/sis/sections': ICON_SECTION_SETUP,
      '/sis/admin/discount-codes': ICON_DISCOUNT_CODES,
      '/sis/admin/subjects': ICON_SUBJECT_WEIGHTS,
      '/sis/admin/approvers': ShieldCheck,
      // Who may do what. Approvers (above) is a named list of people;
      // this is the grant table behind every role, hence a key.
      '/sis/admin/roles': KeyRound,
      '/sis/admin/staff': ICON_STAFF,
      '/sis/admin/cover': RefreshCw,
      '/sis/admin/school-config': Building2,
      '/sis/audit-log': ICON_AUDIT_LOG,
    },
    // No quick action here — unlike other modules (where the quick action
    // skips past several nav groups to the day-to-day destination), both
    // candidate targets (AY Setup, School Calendar) already sit as the
    // first two items of the very first nav group ("Year Setup"), so a
    // dedicated CTA would only duplicate that row with zero click savings.
    quickActionByRole: {},
  },
};
