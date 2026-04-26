"use client";

import { usePathname } from "next/navigation";

import { ScrollArea } from "@/components/ui/scroll-area";
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
} from "@/components/ui/sidebar";
import {
  NAV_BY_MODULE,
  type NavItem,
  type NavSection,
  type Role,
  type SidebarBadges,
} from "@/lib/auth/roles";
import { SIDEBAR_REGISTRY, type SidebarModule } from "@/lib/sidebar/registry";
import { useRealtimeBadges } from "@/lib/sidebar/use-realtime-badges";

import { ModuleSidebarHeader } from "./module-sidebar/sidebar-header";
import { SidebarNavItem } from "./module-sidebar/sidebar-nav-item";
import { SidebarProfile } from "./module-sidebar/sidebar-profile";
import { SidebarQuickAction } from "./module-sidebar/sidebar-quick-action";

type ModuleSidebarProps = {
  module: SidebarModule;
  role: Role | null;
  email: string;
  userId: string;
  badges?: SidebarBadges;
};

// Stable empty default. Inlining `badges ?? {}` would create a fresh
// object every render and the realtime-badges hook would treat each as
// a state change → infinite loop on modules that don't ship badges.
const EMPTY_BADGES: SidebarBadges = {};

// Some entry points (e.g. /sis/sections) want the parent nav item to
// stay highlighted on /sis/sections/[id]. Add their primary hrefs here.
const PREFIX_MATCH_HREFS = new Set<string>([
  "/sis/sections",
  "/markbook/sections",
  "/markbook/grading",
  "/markbook/report-cards",
  "/admissions/applications",
  "/records/students",
  "/evaluation/sections",
  "/attendance/sections",
]);

function resolveSectionsForRole(module: SidebarModule, role: Role | null): NavSection[] {
  if (module === "parent") {
    // Parent has a single hardcoded nav item — "My children" → /parent.
    // Keeping it inline (rather than threading through NAV_BY_MODULE)
    // since parents are null-role and the registry stays small.
    return [
      {
        items: [{ href: "/parent", label: "My children" }],
      },
    ];
  }

  if (module === "markbook") {
    if (!role) return [];
    const byRole = NAV_BY_MODULE.markbook[role] ?? [];
    return byRole;
  }

  const sections = NAV_BY_MODULE[module] ?? [];
  if (!role) return sections;

  // Filter requiresRoles per item, drop empty groups so no orphan
  // labels render.
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.requiresRoles || item.requiresRoles.includes(role),
      ),
    }))
    .filter((section) => section.items.length > 0);
}

function findActiveHref(items: NavItem[], pathname: string): string | undefined {
  return items
    .filter((i) => {
      if (PREFIX_MATCH_HREFS.has(i.href)) {
        return pathname === i.href || pathname.startsWith(i.href + "/");
      }
      return pathname === i.href;
    })
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export function ModuleSidebar({ module, role, email, userId, badges }: ModuleSidebarProps) {
  const pathname = usePathname();
  const config = SIDEBAR_REGISTRY[module];

  const liveBadges = useRealtimeBadges(role, userId, badges ?? EMPTY_BADGES);

  const sections = resolveSectionsForRole(module, role);
  const allItems = sections.flatMap((s) => s.items);
  const activeHref = findActiveHref(allItems, pathname ?? "");

  const quickAction = role ? config.quickActionByRole[role] : config.quickActionByRole.parent;
  const profileRole: Role | "parent" = role ?? "parent";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-4">
        <ModuleSidebarHeader module={module} role={role} />
      </SidebarHeader>

      <SidebarContent className="overflow-hidden px-0 py-0">
        <ScrollArea className="h-full w-full">
          {quickAction && <SidebarQuickAction action={quickAction} badges={liveBadges} />}
          <div className="px-1.5 pb-3 pt-1">
            {sections.map((section, i) => (
              <SidebarGroup key={i}>
                {section.label && (
                  <SidebarGroupLabel className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/50">
                    {section.label}
                  </SidebarGroupLabel>
                )}
                <SidebarGroupContent>
                  <SidebarMenu>
                    {section.items.map((item) => (
                      <SidebarNavItem
                        key={item.href}
                        item={item}
                        isActive={item.href === activeHref}
                        config={config}
                        badges={liveBadges}
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
