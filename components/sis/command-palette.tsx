'use client';

import { Loader2Icon, SearchIcon, UserIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

import { apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import type { Capability } from '@/lib/auth/capabilities';
import type { Role } from '@/lib/auth/roles';
import {
  visibleNavEntries,
  type NavEntry,
} from '@/lib/sis/command-palette-nav';
import type { SidebarModule } from '@/lib/sidebar/registry';
import { cn } from '@/lib/utils';
import { ScrollArea } from '../ui/scroll-area';

// ──────────────────────────────────────────────────────────────────────────
// Context — allows any component (sidebar, topbar, page header) to open the
// palette via <CommandPaletteTrigger /> in addition to the global ⌘K binding.
// ──────────────────────────────────────────────────────────────────────────

type CommandPaletteContextValue = {
  open: boolean;
  setOpen: (next: boolean) => void;
};

const CommandPaletteContext =
  React.createContext<CommandPaletteContextValue | null>(null);

function useCommandPaletteContext(): CommandPaletteContextValue {
  const ctx = React.useContext(CommandPaletteContext);
  if (!ctx) {
    throw new Error(
      'CommandPalette: useCommandPaletteContext used outside <CommandPaletteProvider>. Wrap the tree in app/layout.tsx.'
    );
  }
  return ctx;
}

export function CommandPaletteProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const value = React.useMemo(() => ({ open, setOpen }), [open]);
  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
    </CommandPaletteContext.Provider>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Trigger — visible, clickable button that opens the palette. Renders with a
// search-input affordance + the ⌘K shortcut hint so users discover both
// entry paths. Drop anywhere inside the provider tree.
// ──────────────────────────────────────────────────────────────────────────

export function CommandPaletteTrigger({
  className,
  hideShortcut = false,
  placeholder = 'Search…',
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
        'group flex h-9 w-full items-center gap-2 rounded-md border border-hairline bg-background px-2.5 text-left text-sm shadow-input transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/30',
        className
      )}
      aria-label="Open command palette"
    >
      <SearchIcon className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      <span className="flex-1 truncate text-muted-foreground group-hover:text-foreground">
        {placeholder}
      </span>
      {!hideShortcut && (
        <kbd className="shrink-0 rounded border border-hairline bg-muted/60 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          ⌘K
        </kbd>
      )}
    </button>
  );
}

// The static nav entries (NAV_ENTRIES), the query-stripping helper and the
// visibility predicate all live in lib/sis/command-palette-nav.ts — a pure
// module a plain test can import without dragging in cmdk, React hooks and
// TanStack Query.

// Roles that can search students via /api/sis/search.
// Teachers need it for student navigation; admissions officers need it for
// finding applicants. The server route enforces the same list.
const STUDENT_SEARCH_ROLES: Role[] = [
  'teacher',
  'admissions',
  'academic_coordinator',
  'school_admin',
  'superadmin',
];

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

export function CommandPalette({
  role,
  capabilities,
  hiddenModules = [],
}: {
  role: Role | null;
  /** What this viewer may actually DO, resolved server-side from
   *  `role_permissions` (KD #166). A route can admit a role at the prefix and
   *  then bounce them on a capability the page requires, so an entry tagged
   *  `requiresCapability` is filtered out for anyone lacking it. Omitting this
   *  hides those entries rather than offering dead ends. */
  capabilities?: readonly Capability[];
  /** Modules this viewer's assignments make dead ends. The palette is a
   *  navigation surface like the switchers, so it applies the same narrowing —
   *  otherwise Cmd+K still offers the module the tiles just stopped showing.
   *  See lib/sidebar/module-visibility.ts. */
  hiddenModules?: readonly SidebarModule[];
}) {
  const router = useRouter();
  const { open, setOpen } = useCommandPaletteContext();
  const [query, setQuery] = React.useState('');
  // Debounced query that actually drives the search read — the raw `query`
  // updates on every keystroke, but only this trailing-edge value (200ms)
  // feeds the queryKey/enabled so we don't fire a request per character.
  const [debouncedQuery, setDebouncedQuery] = React.useState('');

  const canSearchStudents = !!role && STUDENT_SEARCH_ROLES.includes(role);

  // Cmd+K (or Ctrl+K) toggles the palette globally — second entry point on
  // top of the visible <CommandPaletteTrigger> button rendered in the
  // sidebar. Both paths funnel into the same context-managed open state.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!open);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // Reset query + result list when the dialog closes — keeps the next open
  // fresh + avoids stale matches flashing on re-open.
  React.useEffect(() => {
    if (!open) {
      setQuery('');
      setDebouncedQuery('');
    }
  }, [open]);

  // Debounce the query → debouncedQuery (200ms). Preserves the original
  // search debounce; the read below keys off debouncedQuery.
  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [query]);

  // Debounced student search via TanStack Query. Enabled only when the dialog
  // is open, the role can access /api/sis/search (teachers / parents /
  // admissions / p-file users are excluded — palette still works for
  // navigation, just no Students group), and the trimmed query is ≥ 2 chars.
  const trimmedQuery = debouncedQuery.trim();
  const searchEnabled = open && canSearchStudents && trimmedQuery.length >= 2;

  const studentsQuery = useQuery({
    queryKey: queryKeys.commandPalette(trimmedQuery),
    queryFn: async ({ signal }) => {
      const body = await apiFetch<{ matches?: StudentMatch[] }>(
        `/api/sis/search?q=${encodeURIComponent(trimmedQuery)}`,
        { credentials: 'include', signal }
      );
      return Array.isArray(body.matches) ? body.matches : [];
    },
    enabled: searchEnabled,
  });

  // On error (or while disabled) treat the result set as empty — the original
  // .catch(() => setStudents([])) behaviour. Students only render when enabled.
  const students: StudentMatch[] = searchEnabled
    ? (studentsQuery.data ?? [])
    : [];
  const loading = searchEnabled && studentsQuery.isFetching;

  const visibleNav = React.useMemo(
    () => visibleNavEntries(role, capabilities, hiddenModules),
    [role, capabilities, hiddenModules]
  );

  const navByGroup = React.useMemo(() => {
    const groups: Record<NavEntry['group'], NavEntry[]> = {
      Modules: [],
      Cohorts: [],
      Admin: [],
    };
    for (const entry of visibleNav) {
      groups[entry.group].push(entry);
    }
    return groups;
  }, [visibleNav]);

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
      description="Search students, navigate to a module, or jump to an admin surface"
    >
      <CommandInput
        placeholder={
          canSearchStudents
            ? 'Search students or navigate…'
            : 'Navigate to a module or action…'
        }
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
                    value={`student ${s.fullName} ${s.enroleeNumber} ${s.studentNumber ?? ''}`}
                    onSelect={() => go(studentHref(s))}
                  >
                    <UserIcon />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-serif text-sm font-semibold text-foreground">
                        {s.fullName}
                      </span>
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

          {(['Modules', 'Cohorts', 'Admin'] as const).map((group) => {
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
                      onSelect={() => go(entry.href)}
                    >
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
              Type at least 2 characters to find students across all academic
              years
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
