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
export function shortcutsForRole(role: Role): AccountShortcut[] {
  const out: AccountShortcut[] = [];
  for (const module of MODULE_ORDER) {
    const config = SIDEBAR_REGISTRY[module];
    if (!isRouteAllowed(config.primaryHref, role)) continue;
    const action = config.quickActionByRole[role];
    if (!action) continue;
    out.push({ ...action, module });
  }
  return out;
}
