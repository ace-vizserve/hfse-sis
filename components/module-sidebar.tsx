'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar';
import type { Capability } from '@/lib/auth/capabilities';
import { resolveSectionsForRole } from '@/lib/auth/nav-visibility';
import {
  type NavItem,
  type Role,
  type SidebarBadges,
  type SidebarCounts,
} from '@/lib/auth/roles';
import {
  SIDEBAR_GROUPS_COOKIE,
  SIDEBAR_GROUPS_COOKIE_MAX_AGE,
  decodeGroupCookie,
  encodeGroupCookie,
  groupKey,
  isCollapsibleGroup,
  resolveExpandedGroups,
} from '@/lib/sidebar/group-state';
import { SIDEBAR_REGISTRY, type SidebarModule } from '@/lib/sidebar/registry';
import { useRealtimeBadges } from '@/lib/sidebar/use-realtime-badges';

import { CommandPaletteTrigger } from '@/components/sis/command-palette';
import { ModuleSidebarHeader } from './module-sidebar/sidebar-header';
import { SidebarNavGroup } from './module-sidebar/sidebar-nav-group';
import { SidebarProfile } from './module-sidebar/sidebar-profile';
import { SidebarQuickAction } from './module-sidebar/sidebar-quick-action';

type ModuleSidebarProps = {
  module: SidebarModule;
  role: Role | null;
  email: string;
  userId: string;
  badges?: SidebarBadges;
  // Informational per-item count chips (e.g. AY Setup "6/7", Sections "28").
  // Optional and additive — only SIS Admin passes this today (Task V2); every
  // other module's call site omits it and renders byte-identically to before.
  counts?: SidebarCounts;
  // Modules this viewer's ASSIGNMENTS make dead ends (a subject-teacher-only
  // user can never use Attendance or Evaluation). Optional + additive: every
  // non-teacher call site resolves to [] and renders identically to before.
  // See lib/sidebar/module-visibility.ts.
  hiddenModules?: readonly SidebarModule[];
  // The viewer's capabilities, resolved server-side by the layout via
  // `getCapabilitiesForRole`. Nav items carrying `requiresCapability` are
  // HIDDEN without this — omitting the prop can only remove rows, never reveal
  // them (KD #173). A layout that forgets it silently loses those rows, so
  // __tests__/auth/link-capability-consistency.test.ts asserts all eight pass it.
  capabilities?: readonly Capability[];
  // Group keys this viewer has left open, read from the `sidebar:groups` cookie
  // server-side by the layout — same shape as `defaultOpen` for the sidebar
  // itself. Passed rather than read here so the first paint is already correct;
  // a client-side read renders the default and then pops groups open.
  // Omitted (first ever visit) means "collapsed except the current page's group".
  expandedGroups?: readonly string[];
};

// Stable empty default. Inlining `badges ?? {}` would create a fresh
// object every render and the realtime-badges hook would treat each as
// a state change → infinite loop on modules that don't ship badges.
const EMPTY_BADGES: SidebarBadges = {};
const EMPTY_COUNTS: SidebarCounts = {};

// Some entry points (e.g. /sis/sections) want the parent nav item to
// stay highlighted on /sis/sections/[id]. Add their primary hrefs here.
const PREFIX_MATCH_HREFS = new Set<string>([
  '/sis/sections',
  '/markbook/sections',
  '/markbook/grading',
  '/markbook/report-cards',
  '/admissions/applications',
  '/records/students',
  '/evaluation/sections',
  '/attendance/sections',
]);

// Split a sidebar href into its pathname and (optional) query params.
// Quicklinks like `/p-files?status=missing` and
// `/evaluation/sections?term=1` use query strings to express a pre-applied
// filter on the destination page; the active-state matcher below treats
// each as "this href is active iff the current URL is on the same path
// AND every query param the href declares is set to the same value in the
// current URL." Extra params in the current URL (e.g. `?ay=AY9999`) are
// ignored — they don't break the match.
function parseHrefWithQuery(href: string): {
  path: string;
  params: URLSearchParams;
} {
  const idx = href.indexOf('?');
  if (idx < 0) return { path: href, params: new URLSearchParams() };
  return {
    path: href.slice(0, idx),
    params: new URLSearchParams(href.slice(idx + 1)),
  };
}

function findActiveHref(
  items: NavItem[],
  pathname: string,
  searchParams: URLSearchParams
): string | undefined {
  return (
    items
      .filter((i) => {
        const { path, params } = parseHrefWithQuery(i.href);
        const pathMatches = PREFIX_MATCH_HREFS.has(path)
          ? pathname === path || pathname.startsWith(path + '/')
          : pathname === path;
        if (!pathMatches) return false;
        for (const [key, value] of params) {
          if (searchParams.get(key) !== value) return false;
        }
        return true;
      })
      // Longest-href wins. Query-aware items (e.g. `/p-files?status=missing`)
      // are longer than their path-only parent (`/p-files`), so when both
      // match we pick the more specific quicklink — that's the desired
      // behavior when the URL has a `?status=` filter set.
      .sort((a, b) => b.href.length - a.href.length)[0]?.href
  );
}

// Rewrite this module's entry in the shared cookie without disturbing the other
// seven — a viewer moves between modules and each keeps its own open groups.
function persistExpandedGroups(moduleName: string, keys: string[]) {
  if (typeof document === 'undefined') return;
  const raw = document.cookie
    .split('; ')
    .find((c) => c.startsWith(SIDEBAR_GROUPS_COOKIE + '='))
    ?.slice(SIDEBAR_GROUPS_COOKIE.length + 1);
  const all = decodeGroupCookie(raw ? decodeURIComponent(raw) : undefined);
  all[moduleName] = keys;
  document.cookie =
    `${SIDEBAR_GROUPS_COOKIE}=${encodeURIComponent(encodeGroupCookie(all))}` +
    `; path=/; max-age=${SIDEBAR_GROUPS_COOKIE_MAX_AGE}`;
}

export function ModuleSidebar({
  module,
  role,
  email,
  userId,
  badges,
  counts,
  hiddenModules,
  capabilities,
  expandedGroups,
}: ModuleSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const config = SIDEBAR_REGISTRY[module];

  const liveBadges = useRealtimeBadges(role, userId, badges ?? EMPTY_BADGES);
  const itemCounts = counts ?? EMPTY_COUNTS;

  const sections = resolveSectionsForRole(module, role, capabilities);
  const allItems = sections.flatMap((s) => s.items);
  const activeHref = findActiveHref(
    allItems,
    pathname ?? '',
    new URLSearchParams(searchParams?.toString() ?? '')
  );

  const quickAction = role ? config.quickActionByRole[role] : undefined;
  const profileRole: Role | null = role ?? null;

  // Initial resolve only. After this the viewer's own toggles are authoritative
  // — forcing the active group open on every render would make clicking to
  // close it do nothing, which reads as a broken control.
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    resolveExpandedGroups({
      sections,
      activeHref,
      saved: expandedGroups ? [...expandedGroups] : undefined,
    })
  );

  // Navigating to a page inside a closed group opens that group — you have to
  // be able to see where you are. Additive, so it never reopens something the
  // viewer just closed. The functional update returns `prev` unchanged when the
  // key is already present, so React bails out rather than looping on the
  // freshly-built `sections` array.
  useEffect(() => {
    const activeSection = sections.find(
      (s) => isCollapsibleGroup(s) && s.items.some((i) => i.href === activeHref)
    );
    if (!activeSection?.label) return;
    const key = groupKey(activeSection.label);
    setExpanded((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, [activeHref, sections]);

  // Next set computed outside the updater on purpose: writing the cookie inside
  // one would run twice under StrictMode's double-invoke.
  const toggleGroup = useCallback(
    (label: string) => {
      const key = groupKey(label);
      const next = new Set(expanded);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setExpanded(next);
      persistExpandedGroups(module, [...next]);
    },
    [expanded, module]
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-4">
        <ModuleSidebarHeader
          module={module}
          role={role}
          hiddenModules={hiddenModules}
        />
        {/* Search trigger — clickable affordance for the global ⌘K command
            palette. Both paths (button click + keyboard shortcut) open the
            same dialog via CommandPaletteContext. */}
        <CommandPaletteTrigger
          className="mt-3 group-data-[collapsible=icon]:hidden"
          placeholder="Search…"
        />
      </SidebarHeader>

      <SidebarContent className="overflow-hidden px-0 py-0">
        <ScrollArea className="h-full w-full">
          {quickAction && (
            <SidebarQuickAction action={quickAction} badges={liveBadges} />
          )}
          <div className="px-1.5 pb-3 pt-1">
            {sections.map((section, i) => (
              <SidebarNavGroup
                key={section.label ?? `group-${i}`}
                section={section}
                activeHref={activeHref}
                config={config}
                badges={liveBadges}
                counts={itemCounts}
                isExpanded={
                  section.label ? expanded.has(groupKey(section.label)) : true
                }
                onToggle={() =>
                  section.label ? toggleGroup(section.label) : undefined
                }
              />
            ))}
          </div>
        </ScrollArea>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <SidebarProfile email={email} role={profileRole} />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
