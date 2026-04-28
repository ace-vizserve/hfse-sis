"use client";

import {
  ClipboardListIcon,
  FileTextIcon,
  GraduationCapIcon,
  HomeIcon,
  InboxIcon,
  Loader2Icon,
  PlaneIcon,
  SearchIcon,
  Settings2Icon,
  SparklesIcon,
  StethoscopeIcon,
  UserIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import type { Role } from "@/lib/auth/roles";
import { isRouteAllowed } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import { ScrollArea } from "../ui/scroll-area";

// ──────────────────────────────────────────────────────────────────────────
// Context — allows any component (sidebar, topbar, page header) to open the
// palette via <CommandPaletteTrigger /> in addition to the global ⌘K binding.
// ──────────────────────────────────────────────────────────────────────────

type CommandPaletteContextValue = {
  open: boolean;
  setOpen: (next: boolean) => void;
};

const CommandPaletteContext = React.createContext<CommandPaletteContextValue | null>(null);

function useCommandPaletteContext(): CommandPaletteContextValue {
  const ctx = React.useContext(CommandPaletteContext);
  if (!ctx) {
    throw new Error(
      "CommandPalette: useCommandPaletteContext used outside <CommandPaletteProvider>. Wrap the tree in app/layout.tsx.",
    );
  }
  return ctx;
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const value = React.useMemo(() => ({ open, setOpen }), [open]);
  return <CommandPaletteContext.Provider value={value}>{children}</CommandPaletteContext.Provider>;
}

// ──────────────────────────────────────────────────────────────────────────
// Trigger — visible, clickable button that opens the palette. Renders with a
// search-input affordance + the ⌘K shortcut hint so users discover both
// entry paths. Drop anywhere inside the provider tree.
// ──────────────────────────────────────────────────────────────────────────

export function CommandPaletteTrigger({
  className,
  hideShortcut = false,
  placeholder = "Search…",
}: {
  className?: string;
  hideShortcut?: boolean;
  placeholder?: string;
}) {
  const { setOpen } = useCommandPaletteContext();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={cn(
        "group flex h-9 w-full items-center gap-2 rounded-md border border-hairline bg-background px-2.5 text-left text-sm shadow-input transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/30",
        className,
      )}
      aria-label="Open command palette">
      <SearchIcon className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      <span className="flex-1 truncate text-muted-foreground group-hover:text-foreground">{placeholder}</span>
      {!hideShortcut && (
        <kbd className="shrink-0 rounded border border-hairline bg-muted/60 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          ⌘K
        </kbd>
      )}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Static navigation entries — every primary route the palette can jump to.
// Role-gated via isRouteAllowed() against the user's role at render time.
// Order = lifecycle order (Admissions → Records → P-Files → Markbook →
// Attendance → Evaluation → SIS Admin) for consistency with the module
// switcher (KD #43).
// ──────────────────────────────────────────────────────────────────────────

type NavEntry = {
  href: string;
  label: string;
  group: "Modules" | "Cohorts" | "Admin";
  icon: LucideIcon;
  shortcut?: string;
};

const NAV_ENTRIES: NavEntry[] = [
  // Module dashboards
  { href: "/", label: "Home — Module picker", group: "Modules", icon: HomeIcon },
  { href: "/admissions", label: "Admissions — Dashboard", group: "Modules", icon: InboxIcon },
  { href: "/admissions/applications", label: "Admissions — Applications", group: "Modules", icon: FileTextIcon },
  { href: "/records", label: "Records — Dashboard", group: "Modules", icon: UsersIcon },
  { href: "/records/students", label: "Records — Students", group: "Modules", icon: UsersIcon },
  { href: "/p-files", label: "P-Files — Dashboard", group: "Modules", icon: FileTextIcon },
  { href: "/markbook", label: "Markbook — Dashboard", group: "Modules", icon: GraduationCapIcon },
  { href: "/markbook/grading", label: "Markbook — Grading", group: "Modules", icon: GraduationCapIcon },
  { href: "/markbook/report-cards", label: "Markbook — Report Cards", group: "Modules", icon: FileTextIcon },
  { href: "/attendance", label: "Attendance — Dashboard", group: "Modules", icon: ClipboardListIcon },
  { href: "/attendance/sections", label: "Attendance — Sections", group: "Modules", icon: UsersIcon },
  { href: "/evaluation", label: "Evaluation — Dashboard", group: "Modules", icon: SparklesIcon },
  { href: "/sis", label: "SIS Admin — Hub", group: "Modules", icon: Settings2Icon },

  // Cohorts
  { href: "/admissions/cohorts/stp", label: "STP applications (admissions)", group: "Cohorts", icon: PlaneIcon },
  {
    href: "/admissions/cohorts/medical",
    label: "Medical alerts (admissions)",
    group: "Cohorts",
    icon: StethoscopeIcon,
  },
  { href: "/admissions/cohorts/pass-expiry", label: "Pass expiry (admissions)", group: "Cohorts", icon: WalletIcon },
  { href: "/records/cohorts/stp", label: "STP applications (records)", group: "Cohorts", icon: PlaneIcon },
  { href: "/records/cohorts/medical", label: "Medical alerts (records)", group: "Cohorts", icon: StethoscopeIcon },
  { href: "/records/cohorts/pass-expiry", label: "Pass expiry (records)", group: "Cohorts", icon: WalletIcon },

  // Admin surfaces
  { href: "/sis/calendar", label: "School Calendar", group: "Admin", icon: ClipboardListIcon },
  { href: "/sis/sections", label: "Sections", group: "Admin", icon: UsersIcon },
  { href: "/sis/ay-setup", label: "Academic Year Setup", group: "Admin", icon: Settings2Icon },
  { href: "/sis/admin/discount-codes", label: "Discount Codes", group: "Admin", icon: WalletIcon },
  { href: "/sis/admin/subjects", label: "Subject Weights", group: "Admin", icon: GraduationCapIcon },
  { href: "/sis/admin/users", label: "Users", group: "Admin", icon: UsersIcon },
  { href: "/sis/admin/approvers", label: "Approvers", group: "Admin", icon: UsersIcon },
  { href: "/sis/admin/school-config", label: "School Config", group: "Admin", icon: Settings2Icon },
  { href: "/sis/admin/settings", label: "System Settings (Test environment)", group: "Admin", icon: Settings2Icon },
  { href: "/sis/sync-students", label: "Sync from Admissions", group: "Admin", icon: UsersIcon },
];

// Roles that can search students via /api/sis/search.
const STUDENT_SEARCH_ROLES: Role[] = ["registrar", "school_admin", "admin", "superadmin"];

// API response shape (mirrors lib/sis/queries.ts::CrossAyMatch).
type StudentMatch = {
  ayCode: string;
  enroleeNumber: string;
  studentNumber: string | null;
  fullName: string;
  level: string | null;
  section: string | null;
  status: string | null;
};

// ──────────────────────────────────────────────────────────────────────────

export function CommandPalette({ role }: { role: Role | null }) {
  const router = useRouter();
  const { open, setOpen } = useCommandPaletteContext();
  const [query, setQuery] = React.useState("");
  const [students, setStudents] = React.useState<StudentMatch[]>([]);
  const [loading, setLoading] = React.useState(false);

  // Cmd+K (or Ctrl+K) toggles the palette globally — second entry point on
  // top of the visible <CommandPaletteTrigger> button rendered in the
  // sidebar. Both paths funnel into the same context-managed open state.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // Reset query + result list when the dialog closes — keeps the next open
  // fresh + avoids stale matches flashing on re-open.
  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setStudents([]);
      setLoading(false);
    }
  }, [open]);

  // Debounced student search. Skips when role can't access /api/sis/search
  // (teachers / parents / admissions / p-file users) — palette still works
  // for navigation, just no Students group.
  React.useEffect(() => {
    if (!open) return;
    if (!role || !STUDENT_SEARCH_ROLES.includes(role)) {
      setStudents([]);
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setStudents([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setLoading(true);
      fetch(`/api/sis/search?q=${encodeURIComponent(trimmed)}`, {
        credentials: "include",
      })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
        .then((body) => {
          if (cancelled) return;
          const matches = Array.isArray(body?.matches) ? body.matches : [];
          setStudents(matches as StudentMatch[]);
        })
        .catch(() => {
          if (!cancelled) setStudents([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, role, open]);

  // Filter nav entries by role gate. isRouteAllowed lives in lib/auth/roles
  // so the palette uses the SAME gate as the proxy + sidebar.
  const visibleNav = React.useMemo(() => NAV_ENTRIES.filter((entry) => isRouteAllowed(entry.href, role)), [role]);

  const navByGroup = React.useMemo(() => {
    const groups: Record<NavEntry["group"], NavEntry[]> = {
      Modules: [],
      Cohorts: [],
      Admin: [],
    };
    for (const entry of visibleNav) {
      groups[entry.group].push(entry);
    }
    return groups;
  }, [visibleNav]);

  const canSearchStudents = !!role && STUDENT_SEARCH_ROLES.includes(role);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  // Build student detail link — prefer /records when studentNumber is known
  // (cross-year permanent URL per Hard Rule #4); fall back to admissions
  // detail otherwise.
  function studentHref(s: StudentMatch): string {
    if (s.studentNumber) {
      return `/records/students/${encodeURIComponent(s.studentNumber)}`;
    }
    return `/admissions/applications/${encodeURIComponent(s.enroleeNumber)}?ay=${encodeURIComponent(s.ayCode)}`;
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Search students, navigate to a module, or jump to an admin surface">
      <CommandInput
        placeholder={canSearchStudents ? "Search students or navigate…" : "Navigate to a module or action…"}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <ScrollArea className="h-96">
          {students.length > 0 && (
            <>
              <CommandGroup heading={`Students · ${students.length}`}>
                {students.slice(0, 20).map((s) => (
                  <CommandItem
                    key={`${s.ayCode}-${s.enroleeNumber}`}
                    value={`student ${s.fullName} ${s.enroleeNumber} ${s.studentNumber ?? ""}`}
                    onSelect={() => go(studentHref(s))}>
                    <UserIcon />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-serif text-sm font-semibold text-foreground">{s.fullName}</span>
                      <span className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        {s.ayCode} · {s.enroleeNumber}
                        {s.studentNumber && <> · {s.studentNumber}</>}
                        {s.level && <> · {s.level}</>}
                        {s.status && <> · {s.status}</>}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          {loading && students.length === 0 && (
            <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" />
              Searching students…
            </div>
          )}

          {(["Modules", "Cohorts", "Admin"] as const).map((group) => {
            const entries = navByGroup[group];
            if (entries.length === 0) return null;
            return (
              <CommandGroup key={group} heading={group}>
                {entries.map((entry) => {
                  const Icon = entry.icon;
                  return (
                    <CommandItem
                      key={entry.href}
                      value={`${group} ${entry.label} ${entry.href}`}
                      onSelect={() => go(entry.href)}>
                      <Icon />
                      <span className="flex-1">{entry.label}</span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        {entry.href}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            );
          })}
        </ScrollArea>
      </CommandList>
      {canSearchStudents && query.length === 0 && (
        <div className="flex shrink-0 items-center gap-3 border-t border-hairline bg-linear-to-t from-primary/5 to-card px-4 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <SearchIcon className="size-4" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground">
              Cross-year student search
            </span>
            <span className="text-xs leading-tight text-muted-foreground">
              Type at least 2 characters to find students across all academic years
            </span>
          </div>
          <kbd className="shrink-0 rounded-md border border-hairline bg-background px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground shadow-input">
            ⌘K
          </kbd>
        </div>
      )}
    </CommandDialog>
  );
}
