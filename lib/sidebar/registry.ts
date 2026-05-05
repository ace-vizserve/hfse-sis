import {
  AlertTriangle,
  Archive,
  BookOpen,
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarCog,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  Copy,
  Database,
  FilePlus2,
  FileSearch,
  FileStack,
  FileText,
  FileUp,
  FolderOpen,
  History,
  LayoutDashboard,
  LayoutGrid,
  RefreshCw,
  Settings2,
  ShieldCheck,
  SquarePen,
  Tag,
  UserCog,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import type { Module, Role, SidebarBadgeKey } from "@/lib/auth/roles";

export type SidebarModule = Module | "parent";

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
  quickActionByRole: Partial<Record<Role | "parent", QuickAction>>;
};

// Order shown in the module-switcher popover. Lifecycle: intake →
// identity → docs → grading → attendance → evaluation → admin config.
// Parent is excluded — parents only ever reach one module, so they get
// the single-module fallback header (no popover).
export const MODULE_ORDER: Module[] = [
  "admissions",
  "records",
  "p-files",
  "markbook",
  "attendance",
  "evaluation",
  "sis",
];

const MARKBOOK_QUICK_REGISTRAR: QuickAction = {
  label: "Review change requests",
  href: "/markbook/change-requests",
  icon: FileText,
  badgeKey: "changeRequests",
};

export const SIDEBAR_REGISTRY: Record<SidebarModule, ModuleSidebarConfig> = {
  markbook: {
    label: "Markbook",
    icon: BookOpen,
    primaryHref: "/markbook",
    fallbackIcon: BookOpen,
    iconByHref: {
      "/markbook": LayoutDashboard,
      "/markbook/grading": ClipboardList,
      "/markbook/grading/new": FilePlus2,
      "/markbook/grading/requests": FileText,
      "/markbook/sections": Users,
      "/markbook/sync-students": RefreshCw,
      "/markbook/change-requests": FileText,
      "/markbook/report-cards": FileText,
      "/markbook/audit-log": History,
    },
    quickActionByRole: {
      teacher: { label: "Open my sheets", href: "/markbook/grading", icon: ClipboardList },
      registrar: MARKBOOK_QUICK_REGISTRAR,
      // school_admin is the consolidated approver pool (Sprint 33) and
      // gets the same quick action as registrar.
      school_admin: MARKBOOK_QUICK_REGISTRAR,
      superadmin: MARKBOOK_QUICK_REGISTRAR,
    },
  },

  attendance: {
    label: "Attendance",
    icon: CalendarCheck,
    primaryHref: "/attendance",
    fallbackIcon: CalendarCheck,
    iconByHref: {
      "/attendance": LayoutDashboard,
      "/attendance/sections": CalendarCheck,
      "/sis/calendar": CalendarDays,
      "/attendance/import": FileUp,
      "/attendance/audit-log": History,
    },
    quickActionByRole: {
      teacher: { label: "Mark today", href: "/attendance/sections", icon: CalendarCheck },
      // Registrars+ land on the analytics dashboard which IS the action;
      // no extra CTA needed.
    },
  },

  "p-files": {
    label: "P-Files",
    icon: FolderOpen,
    primaryHref: "/p-files",
    fallbackIcon: FolderOpen,
    iconByHref: {
      "/p-files": LayoutDashboard,
      "/p-files/audit-log": History,
      // P-Files only surfaces the renewal lens for enrolled students:
      // already-expired + the 30/60/90-day expiring window. Initial-chase
      // statuses (To follow, Rejected, Uploaded/Pending review) belong on
      // Admissions per the un-enrolled vs enrolled scope split.
      "/p-files?status=expired": AlertTriangle,
      "/p-files?expiring=30": CalendarClock,
      "/p-files?expiring=60": CalendarClock,
      "/p-files?expiring=90": CalendarClock,
    },
    quickActionByRole: {
      // P-Files quick action = the most-actionable renewal bucket: docs
      // expiring within 30 days. Already-expired surfaces as a sidebar
      // nav item one click away. School admin / admin / superadmin are
      // read-only on P-Files (KD #31).
      "p-file": { label: "Expiring ≤30 days", href: "/p-files?expiring=30", icon: CalendarClock },
    },
  },

  records: {
    label: "Records",
    icon: Users,
    primaryHref: "/records",
    fallbackIcon: LayoutDashboard,
    iconByHref: {
      "/records": LayoutDashboard,
      "/records/students": Users,
      "/sis/admin/discount-codes": Tag,
      "/sis/sync-students": RefreshCw,
      "/records/audit-log": History,
    },
    quickActionByRole: {
      registrar: { label: "Browse students", href: "/records/students", icon: Users },
      school_admin: { label: "Browse students", href: "/records/students", icon: Users },
      superadmin: { label: "Browse students", href: "/records/students", icon: Users },
    },
  },

  admissions: {
    label: "Admissions",
    icon: FileStack,
    primaryHref: "/admissions",
    fallbackIcon: LayoutDashboard,
    iconByHref: {
      "/admissions": LayoutDashboard,
      "/admissions/applications": FileStack,
      "/admissions/applications/closed": Archive,
      "/admissions/audit-log": History,
      // Pre-enrolment chase quicklinks (Workstream A) — focused-view
      // filters on the dashboard for the un-enrolled scope. Mirror the
      // P-Files renewal quicklinks pattern from KD #64.
      "/admissions?status=to-follow": CalendarClock,
      "/admissions?status=rejected": XCircle,
      "/admissions?status=uploaded": FileSearch,
      "/admissions?status=expired": AlertTriangle,
      "/records/students": Users,
      "/p-files": FolderOpen,
      "/sis/ay-setup": CalendarRange,
    },
    quickActionByRole: {
      // Admissions team's most-actionable bucket: parents committed but
      // file not yet sent. Other roles still get the generic "Open
      // applications" CTA — they don't own the chase loop day-to-day.
      admissions: { label: "To follow", href: "/admissions?status=to-follow", icon: CalendarClock },
      registrar: { label: "Open applications", href: "/admissions/applications", icon: FileStack },
      school_admin: { label: "Open applications", href: "/admissions/applications", icon: FileStack },
      superadmin: { label: "Open applications", href: "/admissions/applications", icon: FileStack },
    },
  },

  evaluation: {
    label: "Evaluation",
    icon: ClipboardCheck,
    primaryHref: "/evaluation",
    fallbackIcon: ClipboardCheck,
    iconByHref: {
      "/evaluation": LayoutDashboard,
      "/evaluation/sections": SquarePen,
      "/evaluation/sections?term=1": CalendarDays,
      "/evaluation/sections?term=2": CalendarRange,
      "/evaluation/sections?term=3": CalendarClock,
    },
    quickActionByRole: {
      teacher: { label: "Open writeups", href: "/evaluation/sections", icon: SquarePen },
      // Registrar+ land on analytics dashboard.
    },
  },

  sis: {
    label: "SIS Admin",
    icon: ShieldCheck,
    primaryHref: "/sis",
    fallbackIcon: LayoutDashboard,
    iconByHref: {
      "/sis": LayoutDashboard,
      "/sis/ay-setup": CalendarCog,
      "/sis/calendar": CalendarDays,
      "/sis/sections": LayoutGrid,
      "/sis/admin/discount-codes": Tag,
      "/sis/admin/approvers": ShieldCheck,
      "/sis/admin/template": Copy,
      "/sis/admin/school-config": Building2,
      "/sis/admin/evaluation-checklists": ClipboardList,
      "/sis/admin/users": UserCog,
      "/sis/admin/settings": Settings2,
      "/sis/sync-students": Database,
    },
    quickActionByRole: {
      // school_admin: most-used config surface is the calendar.
      school_admin: { label: "School Calendar", href: "/sis/calendar", icon: CalendarDays },
      // Superadmin lives in AY Setup / structural config more often.
      superadmin: { label: "AY Setup", href: "/sis/ay-setup", icon: CalendarCog },
    },
  },

  parent: {
    label: "Parent Portal",
    icon: Users,
    primaryHref: "/parent",
    fallbackIcon: Users,
    iconByHref: {
      "/parent": Users,
    },
    quickActionByRole: {},
  },
};
