'use client';

import { usePathname, useSearchParams } from 'next/navigation';

import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
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
import { SIDEBAR_REGISTRY, type SidebarModule } from '@/lib/sidebar/registry';
import { useRealtimeBadges } from '@/lib/sidebar/use-realtime-badges';

import { CommandPaletteTrigger } from '@/components/sis/command-palette';
import { ModuleSidebarHeader } from './module-sidebar/sidebar-header';
import { SidebarNavItem } from './module-sidebar/sidebar-nav-item';
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

export function ModuleSidebar({
  module,
  role,
  email,
  userId,
  badges,
  counts,
  hiddenModules,
  capabilities,
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
              <SidebarGroup key={i}>
                {section.label &&
                  // The cadence-hint chrome (flex spread + span wrapper) is
                  // gated strictly on `section.hint` — hint-less groups (every
                  // module except SIS Admin today) render the exact pre-V2
                  // markup: bare label text, original className, no wrapper
                  // span. `items-baseline`/`justify-between` must not leak
                  // into the hint-less branch (twMerge would override the
                  // primitive's base `items-center`).
                  (section.hint ? (
                    <SidebarGroupLabel className="flex items-baseline justify-between gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/50">
                      <span>{section.label}</span>
                      <span className="font-normal normal-case tracking-normal text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden">
                        {section.hint}
                      </span>
                    </SidebarGroupLabel>
                  ) : (
                    <SidebarGroupLabel className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/50">
                      {section.label}
                    </SidebarGroupLabel>
                  ))}
                <SidebarGroupContent>
                  <SidebarMenu>
                    {section.items.map((item) => (
                      <SidebarNavItem
                        key={item.href}
                        item={item}
                        isActive={item.href === activeHref}
                        config={config}
                        badges={liveBadges}
                        counts={itemCounts}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
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
