import { describe, it, expect } from 'vitest';
import type { LucideIcon } from 'lucide-react';

import { NAV_BY_MODULE, type NavSection, type Role } from '@/lib/auth/roles';
import { SIDEBAR_REGISTRY, type SidebarModule } from '@/lib/sidebar/registry';

// Sidebar icons must do two things, and until 2026-08-31 neither was guarded.
//
// `components/module-sidebar/sidebar-nav-item.tsx` resolves a row's glyph as
//     config.iconByHref[item.href] ?? config.fallbackIcon
// so a nav item added to `lib/auth/roles.ts` without a matching entry in
// `lib/sidebar/registry.ts` renders the MODULE's own icon — no error, no
// warning, just another row drawing the same picture as its neighbours. That
// is exactly what had happened: Records had EIGHT rows resolving to
// `LayoutDashboard`, the same glyph as its own Dashboard row (Insights,
// Discipline, Staff directory, Subject weights, and all three Cohorts);
// Admissions had five; SIS one; Markbook's Insights fell through to BookOpen.
// Separately, Markbook mapped three different destinations to `FileText`, and
// `/sis/ay-setup` drew CalendarRange from the Admissions sidebar and
// CalendarCog from the SIS one — the same page, two pictures.
//
// The three tests below are the three failure modes, in order:
//   1. COVERAGE   — no nav row may fall through to `fallbackIcon`.
//   2. DISTINCT   — no two rows of one sidebar may draw the same glyph.
//   3. UNIFORM    — a route listed by more than one module resolves to the
//                   same glyph in every one of them.
//
// Note on 2: it deliberately checks the UNION of every role's rows for a
// module, not the per-role subset a given person actually sees. That is
// stricter than the screen requires and cheaper to reason about — no role
// filtering, no capability resolution — and the whole app passes it.

function iconName(icon: LucideIcon): string {
  return (icon as unknown as { displayName?: string }).displayName ?? 'unknown';
}

/**
 * Every top-level nav row for a module, across every role that has one.
 *
 * Children (`item.children`) are deliberately excluded: `SidebarMenuSubButton`
 * renders a label only, so a child route carries no icon and needing one would
 * be a false failure.
 */
function topLevelItems(
  moduleName: SidebarModule
): Array<{ href: string; label: string; role?: Role }> {
  const nav = NAV_BY_MODULE[moduleName];

  const fromSections = (sections: NavSection[], role?: Role) =>
    sections.flatMap((section) =>
      section.items.map((item) => ({
        href: item.href,
        label: item.label,
        role,
      }))
    );

  // Markbook is the one module whose nav varies by role.
  if (Array.isArray(nav)) return fromSections(nav);

  return Object.entries(nav).flatMap(([role, sections]) =>
    sections ? fromSections(sections, role as Role) : []
  );
}

const MODULES = Object.keys(SIDEBAR_REGISTRY) as SidebarModule[];

describe('sidebar icon registry', () => {
  it('gives every nav row its own entry, so none falls back to the module glyph', () => {
    const missing: string[] = [];

    for (const moduleName of MODULES) {
      const { iconByHref } = SIDEBAR_REGISTRY[moduleName];
      for (const item of topLevelItems(moduleName)) {
        if (!iconByHref[item.href]) {
          missing.push(
            `${moduleName}${item.role ? ` (${item.role})` : ''}: "${item.label}" -> ${item.href}`
          );
        }
      }
    }

    expect(
      missing,
      `These sidebar rows have no icon in SIDEBAR_REGISTRY and would render the module's own glyph:\n  ${missing.join('\n  ')}\n\nAdd an iconByHref entry in lib/sidebar/registry.ts.`
    ).toEqual([]);
  });

  // Rows that SHOULD share a glyph. One page seen at three horizons, where the
  // number in the label — not the picture — is what tells them apart. Anything
  // added here needs a reason, not just a passing test.
  const ALLOWED_SHARED_GLYPHS: Partial<Record<SidebarModule, string[][]>> = {
    'p-files': [
      ['/p-files?expiring=30', '/p-files?expiring=60', '/p-files?expiring=90'],
    ],
  };

  it('draws every row of a sidebar with a different glyph', () => {
    const collisions: string[] = [];

    for (const moduleName of MODULES) {
      const { iconByHref } = SIDEBAR_REGISTRY[moduleName];
      const exempt = ALLOWED_SHARED_GLYPHS[moduleName] ?? [];

      const byIcon = new Map<LucideIcon, string[]>();
      for (const item of topLevelItems(moduleName)) {
        const icon = iconByHref[item.href];
        if (!icon) continue; // reported by the coverage test above
        const hrefs = byIcon.get(icon) ?? [];
        if (!hrefs.includes(item.href)) hrefs.push(item.href);
        byIcon.set(icon, hrefs);
      }

      for (const [icon, hrefs] of byIcon) {
        if (hrefs.length < 2) continue;
        const isExempt = exempt.some(
          (group) => hrefs.every((h) => group.includes(h)) && hrefs.length > 1
        );
        if (isExempt) continue;
        collisions.push(
          `${moduleName}: ${iconName(icon)} is used by ${hrefs.join(', ')}`
        );
      }
    }

    expect(
      collisions,
      `These sidebars draw two or more rows with the same icon:\n  ${collisions.join('\n  ')}\n\nGive each destination its own glyph in lib/sidebar/registry.ts, or add a reasoned exemption to ALLOWED_SHARED_GLYPHS.`
    ).toEqual([]);
  });

  it('draws a cross-module route the same way in every module that links it', () => {
    const drifted: string[] = [];

    const byHref = new Map<string, Map<string, SidebarModule[]>>();
    for (const moduleName of MODULES) {
      for (const [href, icon] of Object.entries(
        SIDEBAR_REGISTRY[moduleName].iconByHref
      )) {
        const perIcon = byHref.get(href) ?? new Map<string, SidebarModule[]>();
        const key = iconName(icon);
        perIcon.set(key, [...(perIcon.get(key) ?? []), moduleName]);
        byHref.set(href, perIcon);
      }
    }

    for (const [href, perIcon] of byHref) {
      if (perIcon.size < 2) continue;
      const detail = [...perIcon]
        .map(([icon, modules]) => `${icon} in ${modules.join('/')}`)
        .join('; ');
      drifted.push(`${href}: ${detail}`);
    }

    expect(
      drifted,
      `The same route draws a different icon depending on which sidebar you reach it from:\n  ${drifted.join('\n  ')}\n\nPoint both entries at the shared ICON_* constant in lib/sidebar/registry.ts.`
    ).toEqual([]);
  });
});
