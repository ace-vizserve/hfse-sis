'use client';

import {
  ArrowLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
  SearchIcon,
  UserIcon,
} from 'lucide-react';
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
  primaryStudentVerb,
  visibleNavEntries,
  visibleQuickActions,
  visibleStudentVerbs,
  type NavEntry,
} from '@/lib/sis/command-palette-nav';
import {
  addRecent,
  readRecents,
  writeRecents,
  type RecentDestination,
  type RecentEntry,
  type RecentStudent,
} from '@/lib/sis/palette-recents';
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

/** One student row — rendered identically whether it came from a live search
 *  or from recents, so the two lists never drift apart visually.
 *
 *  `data-student-key` is how the ArrowRight handler maps cmdk's highlighted
 *  DOM node back to a match; cmdk owns selection, so the row has to carry its
 *  own identity. */
function StudentRow({
  student,
  valuePrefix,
  drillable,
  onOpen,
}: {
  student: StudentMatch;
  valuePrefix: string;
  drillable: boolean;
  onOpen: () => void;
}) {
  return (
    <CommandItem
      data-student-key={`${student.ayCode}-${student.enroleeNumber}`}
      value={`${valuePrefix} ${student.fullName} ${student.enroleeNumber} ${student.studentNumber ?? ''}`}
      onSelect={onOpen}
    >
      <UserIcon />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-serif text-sm font-semibold text-foreground">
          {student.fullName}
        </span>
        <span className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {student.ayCode} · {student.enroleeNumber}
          {student.studentNumber && <> · {student.studentNumber}</>}
          {student.level && <> · {student.level}</>}
          {student.status && <> · {student.status}</>}
        </span>
      </div>
      {drillable && (
        <ChevronRightIcon
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      )}
    </CommandItem>
  );
}

// ──────────────────────────────────────────────────────────────────────────

export function CommandPalette({
  role,
  viewerId,
  capabilities,
  hiddenModules = [],
}: {
  role: Role | null;
  /** Signed-in account id — namespaces the recents store. School machines are
   *  shared, so an unscoped store would show the previous user's students to
   *  the next one. See lib/sis/palette-recents.ts. */
  viewerId: string;
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
  // The student whose verb list is showing, or null for the search view. This
  // is the whole of the "sub-view" — one nullable value, not a route or a
  // nested dialog (a dialog inside CommandDialog is the nesting we avoid).
  const [activeStudent, setActiveStudent] = React.useState<StudentMatch | null>(
    null
  );
  // The verb view's own filter text. Separate from `query` so entering and
  // leaving the sub-view never disturbs the search behind it.
  const [verbQuery, setVerbQuery] = React.useState('');
  const [recents, setRecents] = React.useState<RecentEntry[]>([]);

  // ⚠ THE REAL ROLE, NOT THE LENS, and deliberately so. This decides whether to
  // CALL `/api/sis/search`, and that route answers on the JWT role — lensing
  // the switch here would either fire a request the server refuses or hide a
  // group the server would happily fill. It is also inert for the accounts that
  // hold a lens: `teacher` is in the list, so a teaching admin keeps student
  // search in both views. (role-switcher Phase 3c.)
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
  // fresh + avoids stale matches flashing on re-open. The verb sub-view resets
  // with it: re-opening ⌘K always lands on the search, never mid-drill.
  React.useEffect(() => {
    if (!open) {
      setQuery('');
      setDebouncedQuery('');
      setVerbQuery('');
      setActiveStudent(null);
    }
  }, [open]);

  // Recents, read once per open rather than on mount — another tab may have
  // added rows since, and this component lives for the whole session.
  React.useEffect(() => {
    if (open) setRecents(readRecents(viewerId));
  }, [open, viewerId]);

  function remember(entry: RecentEntry) {
    setRecents((prev) => {
      const next = addRecent(prev, entry);
      writeRecents(viewerId, next);
      return next;
    });
  }

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
  // Memoised so the reachable-students filter below keeps a stable input —
  // a fresh `[]` on every render would re-run that filter every time.
  const students: StudentMatch[] = React.useMemo(
    () => (searchEnabled ? (studentsQuery.data ?? []) : []),
    [searchEnabled, studentsQuery.data]
  );
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

  const quickActions = React.useMemo(
    () => visibleQuickActions(role, hiddenModules),
    [role, hiddenModules]
  );

  // Drop any match this viewer has no reachable surface for, rather than
  // rendering a row whose Enter does nothing. Same principle as the
  // `requiresCapability` filter on nav: hide the dead end, don't offer it.
  const reachableStudents = React.useMemo(
    () => students.filter((s) => visibleStudentVerbs(s, role).length > 0),
    [students, role]
  );

  const activeVerbs = React.useMemo(
    () => (activeStudent ? visibleStudentVerbs(activeStudent, role) : []),
    [activeStudent, role]
  );

  // Narrowed the same way live results are: a remembered student this role
  // now has no reachable surface for would render a row whose Enter silently
  // does nothing. Reachability can change under a stored row — a role change,
  // or an applicant remembered before the viewer lost /admissions.
  const recentStudents = recents.filter(
    (e): e is RecentStudent =>
      e.kind === 'student' && visibleStudentVerbs(e, role).length > 0
  );
  const recentDestinations = recents.filter(
    (e): e is RecentDestination => e.kind === 'destination'
  );
  const showRecents =
    query.length === 0 && !activeStudent && recents.length > 0;

  /** A recent student is openable exactly like a live hit — same verbs, same
   *  Enter. Widened back to StudentMatch so one code path renders both;
   *  `section` is the only field recents don't keep, and no verb reads it. */
  function recentAsMatch(r: RecentStudent): StudentMatch {
    return {
      ayCode: r.ayCode,
      enroleeNumber: r.enroleeNumber,
      studentNumber: r.studentNumber,
      fullName: r.fullName,
      level: r.level,
      section: null,
      status: r.status,
    };
  }

  function studentKeyOf(s: StudentMatch): string {
    return `${s.ayCode}-${s.enroleeNumber}`;
  }

  // Lets the ArrowRight handler resolve the highlighted DOM row back to its
  // match. cmdk owns the selection, so the row carries its key as a data
  // attribute and this maps it back.
  const studentByKey = React.useMemo(() => {
    const map = new Map<string, StudentMatch>();
    for (const r of recentStudents) {
      const m = recentAsMatch(r);
      map.set(studentKeyOf(m), m);
    }
    for (const s of reachableStudents) map.set(studentKeyOf(s), s);
    return map;
  }, [recentStudents, reachableStudents]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  /** Navigate and remember. `hint` is the mono micro-copy the recent row will
   *  carry, so a remembered destination reads the same as the live one. */
  function goDestination(href: string, label: string, hint: string) {
    remember({
      kind: 'destination',
      href,
      label,
      hint,
    } satisfies RecentDestination);
    go(href);
  }

  function rememberStudent(s: StudentMatch) {
    remember({
      kind: 'student',
      studentNumber: s.studentNumber,
      enroleeNumber: s.enroleeNumber,
      ayCode: s.ayCode,
      fullName: s.fullName,
      level: s.level,
      status: s.status,
    } satisfies RecentStudent);
  }

  /** Enter on a student — the primary verb, which resolves to the record for
   *  an enrolled student and the application for an applicant. That is exactly
   *  where the old studentHref() sent you, so the fast path is unchanged. */
  function openStudentPrimary(s: StudentMatch) {
    const verb = primaryStudentVerb(s, role);
    if (!verb) return;
    rememberStudent(s);
    go(verb.href);
  }

  /** → on a student — the other surfaces of the same record. A student with
   *  only one reachable surface has nothing to choose between, so there is no
   *  sub-view for them and no chevron inviting one. */
  function openStudentVerbs(s: StudentMatch) {
    if (visibleStudentVerbs(s, role).length <= 1) return;
    setVerbQuery('');
    setActiveStudent(s);
  }

  /** Back to the search view, with the verb filter cleared so re-opening any
   *  student starts from the full list. */
  function closeStudentVerbs() {
    setVerbQuery('');
    setActiveStudent(null);
  }

  function canDrill(s: StudentMatch): boolean {
    return visibleStudentVerbs(s, role).length > 1;
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
          activeStudent
            ? `What next for ${activeStudent.fullName}?`
            : canSearchStudents
              ? 'Search students or navigate…'
              : 'Navigate to a module or action…'
        }
        value={activeStudent ? verbQuery : query}
        onValueChange={(next) => {
          // The verb view types into its OWN value, so cmdk filters the verbs
          // while the search query and its cached results sit untouched behind
          // it — going back does not re-run the search.
          if (activeStudent) setVerbQuery(next);
          else setQuery(next);
        }}
        onKeyDown={(e) => {
          // ← leaves the verb view. Esc is left to cmdk, which closes the
          // dialog — matching every other dialog here.
          if (activeStudent) {
            // Only from the start of the field, so ← still moves the caret
            // while you are filtering the verbs. Mirrors the → guard below.
            if (e.key === 'ArrowLeft' && e.currentTarget.selectionStart === 0) {
              e.preventDefault();
              closeStudentVerbs();
            }
            return;
          }
          if (e.key !== 'ArrowRight') return;
          // Only when the caret is at the end, so → still moves the cursor
          // while you are editing what you typed.
          const input = e.currentTarget;
          if (input.selectionStart !== input.value.length) return;
          const selected = document.querySelector<HTMLElement>(
            '[cmdk-item][data-selected="true"], [cmdk-item][aria-selected="true"]'
          );
          const key = selected?.dataset.studentKey;
          if (!key) return;
          const match = studentByKey.get(key);
          if (!match) return;
          e.preventDefault();
          openStudentVerbs(match);
        }}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <ScrollArea className="h-96">
          {activeStudent ? (
            <>
              {/* Context bar — the one crafted tile in the dialog (§7.4), so
                  the verb list never loses whose record it is acting on. */}
              <div className="flex items-center gap-3 border-b border-hairline px-3 py-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                  <UserIcon className="size-4" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-serif text-sm font-semibold text-foreground">
                    {activeStudent.fullName}
                  </span>
                  <span className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {activeStudent.ayCode} · {activeStudent.enroleeNumber}
                    {activeStudent.studentNumber && (
                      <> · {activeStudent.studentNumber}</>
                    )}
                    {activeStudent.level && <> · {activeStudent.level}</>}
                  </span>
                </div>
              </div>

              <CommandGroup heading="Open">
                {activeVerbs.map((verb) => {
                  const Icon = verb.icon;
                  return (
                    <CommandItem
                      key={verb.key}
                      value={`verb ${verb.label} ${verb.hint}`}
                      onSelect={() => {
                        rememberStudent(activeStudent);
                        go(verb.href);
                      }}
                    >
                      <Icon />
                      <span className="flex-1">{verb.label}</span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        {verb.hint}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>

              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  value="back to search"
                  onSelect={closeStudentVerbs}
                >
                  <ArrowLeftIcon />
                  <span className="flex-1">Back to search</span>
                  <kbd className="rounded border border-hairline bg-background px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
                    ←
                  </kbd>
                </CommandItem>
              </CommandGroup>
            </>
          ) : (
            <>
              {showRecents && recentStudents.length > 0 && (
                <CommandGroup heading="Recent students">
                  {recentStudents.map((r) => {
                    const s = recentAsMatch(r);
                    return (
                      <StudentRow
                        key={`recent-${studentKeyOf(s)}`}
                        student={s}
                        valuePrefix="recent student"
                        drillable={canDrill(s)}
                        onOpen={() => openStudentPrimary(s)}
                      />
                    );
                  })}
                </CommandGroup>
              )}

              {showRecents && recentDestinations.length > 0 && (
                <CommandGroup heading="Recent pages">
                  {recentDestinations.map((r) => (
                    <CommandItem
                      key={`recent-${r.href}`}
                      value={`recent ${r.label} ${r.hint}`}
                      onSelect={() => goDestination(r.href, r.label, r.hint)}
                    >
                      <ChevronRightIcon />
                      <span className="flex-1">{r.label}</span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        {r.hint}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {showRecents && <CommandSeparator />}

              {reachableStudents.length > 0 && (
                <>
                  <CommandGroup
                    heading={`Students · ${reachableStudents.length}`}
                  >
                    {reachableStudents.slice(0, 20).map((s) => (
                      <StudentRow
                        key={studentKeyOf(s)}
                        student={s}
                        valuePrefix="student"
                        drillable={canDrill(s)}
                        onOpen={() => openStudentPrimary(s)}
                      />
                    ))}
                  </CommandGroup>
                  <CommandSeparator />
                </>
              )}

              {loading && reachableStudents.length === 0 && (
                <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Searching students…
                </div>
              )}

              {quickActions.length > 0 && (
                <CommandGroup heading="Quick actions">
                  {quickActions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <CommandItem
                        key={action.href}
                        value={`quick action ${action.label} ${action.moduleLabel}`}
                        onSelect={() =>
                          goDestination(
                            action.href,
                            action.label,
                            action.moduleLabel
                          )
                        }
                      >
                        <Icon />
                        <span className="flex-1">{action.label}</span>
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          {action.moduleLabel}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
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
                          onSelect={() =>
                            goDestination(entry.href, entry.label, group)
                          }
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
            </>
          )}
        </ScrollArea>
      </CommandList>
      {/* First-use guidance. Recents replace it once there are any — but it
          stays for a brand-new account, because an empty palette that says
          nothing reads as broken (§7.6). */}
      {canSearchStudents &&
        query.length === 0 &&
        !activeStudent &&
        !showRecents && (
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
