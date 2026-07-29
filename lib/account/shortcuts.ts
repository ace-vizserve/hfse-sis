import {
  MODULE_ORDER,
  SIDEBAR_REGISTRY,
  type QuickAction,
  type SidebarModule,
} from '@/lib/sidebar/registry';
import { isRouteAllowed, type Role } from '@/lib/auth/roles';

export type AccountShortcut = QuickAction & { module: SidebarModule };

/**
 * The account page's "Shortcuts" list for one role: every module this role
 * can open (per the same isRouteAllowed check the sidebar/proxy use) that
 * also has a quickActionByRole entry for this role. Modules without an
 * entry (documented per-module in lib/sidebar/registry.ts — e.g. teacher
 * has none for Markbook because "My Sheets" already sits at the top of that
 * module's own nav) are skipped, not shown empty.
 */
export function shortcutsForRole(
  role: Role,
  // Modules this viewer's assignments make dead ends. Same narrowing the two
  // switchers and the home quick-actions apply — see
  // lib/sidebar/module-visibility.ts.
  hiddenModules: readonly SidebarModule[] = []
): AccountShortcut[] {
  const out: AccountShortcut[] = [];
  for (const module of MODULE_ORDER) {
    const config = SIDEBAR_REGISTRY[module];
    if (!isRouteAllowed(config.primaryHref, role)) continue;
    if (hiddenModules.includes(module)) continue;
    const action = config.quickActionByRole[role];
    if (!action) continue;
    out.push({ ...action, module });
  }

  // Fallback: never return an empty list for a role that can open something.
  //
  // `quickActionByRole` serves two surfaces with different needs. In the
  // sidebar, a CTA that duplicates the module's single nav item is noise —
  // which is exactly why classroom/attendance/evaluation define no quick
  // action (see their comments in lib/sidebar/registry.ts). But this card is a
  // CROSS-MODULE jump list shown to someone who isn't in a module yet, and
  // there "Open Classroom" is not a duplicate, it's the only path.
  //
  // The result was that `teacher` — the only role whose every module omits a
  // quick action — got a card with a header and nothing under it. Every other
  // role has 1-3 real actions, so it went unnoticed.
  //
  // Applied ONLY when the role would otherwise have zero, so roles with real
  // quick actions keep their short, curated list instead of ballooning to one
  // row per module.
  if (out.length === 0) {
    for (const module of MODULE_ORDER) {
      const config = SIDEBAR_REGISTRY[module];
      if (!isRouteAllowed(config.primaryHref, role)) continue;
      if (hiddenModules.includes(module)) continue;
      out.push({
        label: `Open ${config.label}`,
        href: config.primaryHref,
        icon: config.icon,
        module,
      });
    }
  }

  return out;
}
