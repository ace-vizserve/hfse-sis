# Sidebar Redesign — Design Spec

**Date:** 2026-04-26
**Branch:** to be created off `feat/swap-sonner-sileo` (or `main` post-merge)
**Status:** Drafted, awaiting user review

## 1. Problem

The staff sidebar is duplicated across 8 modules — `markbook`, `attendance`, `sis`, `p-files`, `records`, `admissions`, `evaluation`, `parent` — as eight ~200-line files that differ only in module label, icon-by-href map, and (in markbook only) badge wiring. Beyond the obvious refactor cost, the visual layer has drifted from the rest of the app:

- **Brand redundancy.** The sidebar header shows "HFSE / Markbook" while the topbar already renders `<ModuleSwitcher>` with the same identity. Two surfaces compete for the same job.
- **Active state is dated.** A 2px brand-indigo bar on the left of the active item — subtle, fragile, and inconsistent with the §9.3 non-flat language adopted in Sprints 24–25 (gradient pills, ring-inset, shadow-md).
- **Footer chrome is heavy.** Every screen renders avatar + email + role + Account row + Sign out row — four lines of always-visible profile noise.
- **Live badges only work in markbook.** `useRealtimeBadgeCount` is hardcoded into `markbook-sidebar.tsx`. Other modules with badge-worthy state (P-Files missing docs, Attendance unmarked sections, Admissions applications-by-stage) carry no live indicator.
- **No "front door" affordance.** The first thing every user does — open today's work — has no visual anchor. Users scan the nav tree to find the right link.

## 2. Goals

1. **One shared `<ModuleSidebar>` primitive** replaces all 8 per-module sidebars.
2. **Module identity moves into the sidebar header** as a clickable popover; the topbar `<ModuleSwitcher>` is removed.
3. **Active item adopts the §9.3 non-flat recipe** — gradient wash + ring-inset, no left bar.
4. **Footer collapses to a single profile pill** that opens a popover for Account + Sign out.
5. **Generalized live-badge slot** — any module can declare a `badgeKey` and the shared sidebar wires the supabase channel.
6. **Per-role quick actions** — a 0–1 item slot above the nav tree, rendered as a primary CTA, surfacing the module's most common landing.

## 3. Non-goals

- **Mobile bottom-nav variant.** Out of scope. Sheet-driven mobile sidebar (current behavior) stays.
- **Sidebar collapse state persisting per-module.** Stays global, cookie-based, as today.
- **Cross-module pinned items.** No "favorite a route from Module A while in Module B." YAGNI.
- **Dynamic quick actions.** Quick actions are declarative (per `module × role`); no "smart" computation like "next unmarked section".
- **Replacing `lib/auth/roles.ts::NAV_BY_MODULE`.** That registry stays as-is; the new sidebar registry is additive.

## 4. Architecture overview

```
components/
  module-sidebar.tsx                ← NEW: single <ModuleSidebar> consumed by all 8 layouts
  module-sidebar/
    sidebar-header.tsx              ← NEW: brand tile + module-switcher popover
    sidebar-quick-action.tsx        ← NEW: optional CTA above the nav tree
    sidebar-nav-item.tsx            ← NEW: nav row with non-flat active state + badge slot
    sidebar-profile.tsx             ← NEW: footer profile pill + popover
  module-switcher.tsx               ← DELETED (folded into sidebar-header.tsx)
  markbook-sidebar.tsx              ← DELETED
  attendance-sidebar.tsx            ← DELETED
  sis-sidebar.tsx                   ← DELETED
  p-files-sidebar.tsx               ← DELETED
  records-sidebar.tsx               ← DELETED
  admissions-sidebar.tsx            ← DELETED
  evaluation-sidebar.tsx            ← DELETED
  parent-sidebar.tsx                ← DELETED

lib/sidebar/
  registry.ts                       ← NEW: per-module icons + quick actions
  use-realtime-badges.ts            ← NEW: generalized hook (extracted from markbook)

app/(<module>)/layout.tsx           ← all 8 layouts simplified to render <ModuleSidebar module="..." ... />
                                      and drop the topbar <ModuleSwitcher>
```

`Sidebar` from `components/ui/sidebar` (shadcn primitive) is unchanged — `<ModuleSidebar>` composes on top of it. `NAV_BY_MODULE` in `lib/auth/roles.ts` stays the source of truth for nav structure.

## 5. Five visual changes — detail

### 5.1 Header is the module switcher

The sidebar header today is a static "HFSE / Markbook" link. After: the same gradient brand tile (size-9, `from-brand-indigo to-brand-navy`, `shadow-brand-tile`) plus serif module label, but the whole row is a `Popover` trigger. Clicking opens a popover anchored under the trigger with a list of role-allowed modules in lifecycle order, derived from `isRouteAllowed()` (single source of truth — same rule as today's `<ModuleSwitcher>` and `proxy.ts`).

```tsx
<SidebarHeader className="border-b border-sidebar-border px-3 py-4">
  <Popover>
    <PopoverTrigger asChild>
      <button className="group flex w-full items-center gap-3 rounded-lg px-1 py-1
                         outline-none transition-colors hover:bg-sidebar-accent
                         focus-visible:ring-2 focus-visible:ring-sidebar-ring">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl
                        bg-gradient-to-br from-brand-indigo to-brand-navy text-white
                        shadow-brand-tile">
          <ModuleIcon className="size-4" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col text-left leading-tight
                        group-data-[collapsible=icon]:hidden">
          <span className="font-mono text-[10px] font-semibold uppercase
                           tracking-[0.14em] text-sidebar-foreground/60">HFSE</span>
          <span className="truncate font-serif text-base font-semibold tracking-tight
                           text-sidebar-foreground">{moduleLabel}</span>
        </div>
        <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-foreground/50
                                   group-data-[collapsible=icon]:hidden" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" side="right" className="w-[260px] p-1.5">
      {/* role-allowed modules, lifecycle-ordered, with current one marked */}
    </PopoverContent>
  </Popover>
</SidebarHeader>
```

**Collapsed (`collapsible=icon`) behavior.** When the sidebar collapses to icon-only, the trigger renders just the brand tile. The popover still works — clicking opens the same module list anchored to the right.

**Single-module users.** Parents (no role) and `p-file` officers reach only one module. For these the trigger is a non-interactive `<div>` (no popover) — same gradient tile + module label, no chevron.

**Topbar `<ModuleSwitcher>` removed.** All 8 `app/(<module>)/layout.tsx` files drop the `<ModuleSwitcher>` from the header. The topbar shrinks to `<SidebarTrigger>` only — leaves room for future breadcrumbs.

**Module list paint.** Each row in the popover is a `Button variant="ghost"` with a size-7 gradient tile + serif label. Current module gets `data-[active=true]:bg-accent` + a small mint dot. Hover lifts background to `bg-sidebar-accent`.

### 5.2 Non-flat active state on nav items

Today: 2px brand-indigo bar via `before:` pseudo-element. After: the active item's whole row gets the §9.3 informational recipe — `bg-accent` (indigo wash, `#EEF2FF`) + `text-brand-indigo-deep` + `ring-1 ring-inset ring-brand-indigo-soft/30` + bold icon. The before-bar is deleted.

```tsx
<SidebarMenuButton
  asChild
  isActive={isActive}
  tooltip={item.label}
  className="h-9 transition-colors
             data-[active=true]:bg-accent
             data-[active=true]:text-brand-indigo-deep
             data-[active=true]:font-semibold
             data-[active=true]:ring-1 data-[active=true]:ring-inset
             data-[active=true]:ring-brand-indigo-soft/30
             data-[active=true]:[&_svg]:text-brand-indigo-deep">
  <Link href={item.href}>
    <Icon />
    <span>{item.label}</span>
    {badge > 0 && <SidebarBadge count={badge} />}
  </Link>
</SidebarMenuButton>
```

Inactive items keep `text-sidebar-foreground/70`. Hover deepens to `text-sidebar-foreground` + `bg-sidebar-accent`.

**Why not gradient?** Gradient backgrounds are reserved for primary CTAs and tier-1 chip/CTA primitives (per §9.3 + the Sprint 24 non-flat refresh spec). Nav items are *informational* — the §9.4 accent wash is the right tier.

### 5.3 Footer profile pill

Today: 4 always-visible rows (avatar block, Account row, Sign out row). After: a single full-width pill at the bottom — avatar + truncated email + chevron — that opens a `Popover` anchored above containing role badge, Account link, Sign out button.

```tsx
<SidebarFooter className="border-t border-sidebar-border p-2">
  <Popover>
    <PopoverTrigger asChild>
      <button className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5
                         text-left transition-colors hover:bg-sidebar-accent
                         focus-visible:outline-none focus-visible:ring-2
                         focus-visible:ring-sidebar-ring">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full
                        bg-gradient-to-br from-brand-indigo to-brand-navy
                        text-[11px] font-semibold text-white shadow-brand-tile">
          {initials}
        </div>
        <div className="min-w-0 flex-1 leading-tight
                        group-data-[collapsible=icon]:hidden">
          <div className="truncate text-xs font-medium text-sidebar-foreground">
            {email}
          </div>
          <div className="mt-0.5 font-mono text-[9px] font-semibold uppercase
                          tracking-[0.14em] text-sidebar-foreground/60">
            {ROLE_LABEL[role]}
          </div>
        </div>
        <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-foreground/50
                                   group-data-[collapsible=icon]:hidden" />
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" align="start" className="w-[240px] p-1.5">
      {/* full email row, Account link, Separator, Sign out destructive button */}
    </PopoverContent>
  </Popover>
</SidebarFooter>
```

**Collapsed mode.** Pill becomes the avatar circle only; popover still works.

**Sign out** stays a `<Button variant="ghost">` with destructive hover (text-destructive on hover) inside the popover — same vibe as today.

### 5.4 Generalized live badges

Today: `useRealtimeBadgeCount` in `hooks/use-realtime-badge-count.ts` is hardcoded to "changeRequests" — markbook-only. After:

```ts
// lib/sidebar/use-realtime-badges.ts
export function useRealtimeBadges(
  role: Role,
  userId: string,
  initial: SidebarBadges,
): SidebarBadges {
  // subscribes to one channel per badgeKey present in `initial`,
  // returns merged live counts. No subscription if a badgeKey is absent.
}
```

The shared sidebar passes the merged badges to `<SidebarNavItem>`, which reads `item.badgeKey` (already in `NavItem`) and renders the count when > 0. Existing `getSidebarChangeRequestCount` keeps shipping the SSR initial value via `<ModuleSidebar badges={…}>`.

**New badge keys (deferred but slot-ready):**
- `attendanceUnmarked` — number of sections still needing today's mark (operational priority).
- `pfilesMissingDocs` — count of students with missing required docs.
- `admissionsToReview` — count of applications in `Inquiry`/`Applied`.

These plug into the same `SidebarBadgeKey` union in `lib/auth/roles.ts`. The actual SSR loaders + realtime channels are out of scope for this redesign — the slot exists, future PRs wire them.

**Badge paint.** Stay with the existing `rounded-full bg-destructive px-1.5 text-[10px] font-semibold tabular-nums text-white` — this matches §9.3 destructive role and existing markbook output. No change.

### 5.5 Quick actions (per module × role)

A 0–1 item slot at the top of `<SidebarContent>`, above the first `SidebarGroup`. Renders as a full-width primary CTA — the brand `Button` default variant (gradient + shadow-button) — labelled with a verb. The intent is "what does this user open first."

**Visual.**
```tsx
<div className="px-3 pt-3 pb-2">
  <Button asChild className="h-9 w-full justify-start gap-2">
    <Link href={action.href}>
      <ActionIcon className="size-4" />
      <span className="flex-1 text-left text-[13px] font-semibold">{action.label}</span>
      {action.badge && action.badge > 0 && (
        <span className="rounded-full bg-white/20 px-1.5 text-[10px] font-semibold tabular-nums">
          {action.badge}
        </span>
      )}
    </Link>
  </Button>
</div>
```

**Collapsed mode.** When the sidebar collapses to icon-only, the quick action shrinks to a square gradient tile (size-9) holding just the icon + a tooltip showing the label.

**Per-(module × role) declarations.** Lives in `lib/sidebar/registry.ts`. The registry is the single source — no inline scattering in module layouts. Initial set (call out gaps with reasoning):

| Module | Role(s) | Quick action | Href |
|---|---|---|---|
| markbook | teacher | "Open my sheets" | `/markbook/grading` |
| markbook | registrar / admin / superadmin | "Review change requests" (+ live badge) | `/markbook/change-requests` |
| markbook | school_admin | — (no approval pool, no urgent action) | — |
| attendance | teacher | "Mark today" | `/attendance/sections` |
| attendance | registrar+ | — (lands on dashboard, that *is* the action) | — |
| p-files | p-file | "Missing documents" (+ live badge when wired) | `/p-files?status=missing` |
| p-files | school_admin / admin / superadmin | — (read-only) | — |
| evaluation | teacher | "Open writeups" | `/evaluation/sections` |
| evaluation | registrar+ | — (analytics, no active task) | — |
| admissions | admissions / registrar+ | "Open applications" | `/admissions/applications` |
| records | registrar+ | "Browse students" | `/records/students` |
| sis | school_admin / admin | "School Calendar" | `/sis/calendar` |
| sis | superadmin | "AY Setup" | `/sis/ay-setup` |
| parent | (no role) | — | — |

**Why these.** Each row is the *most-likely-next-click after the dashboard* for that role, drawn from existing nav. The module-redesign doesn't introduce new pages.

**Verb-not-noun rule.** Quick action labels start with a verb where natural ("Open my sheets", "Mark today", "Review change requests") — distinguishes them from nav items, which are nouns ("Dashboard", "Sections", "Audit Log"). Exception: for config-oriented destinations in SIS, the destination noun stands alone ("School Calendar", "AY Setup") — verb-ifying ("Open School Calendar") reads as boilerplate.

## 6. Registry shape

```ts
// lib/sidebar/registry.ts
import type { LucideIcon } from "lucide-react";
import {
  BookOpen, CalendarCheck, ClipboardCheck, ClipboardList, FileStack,
  FilePlus2, FileText, FolderOpen, History, Home, RefreshCw, ShieldCheck,
  Users, UserCog, /* etc. */
} from "lucide-react";
import type { Module, Role, SidebarBadgeKey } from "@/lib/auth/roles";

export type QuickAction = {
  label: string;
  href: string;
  icon: LucideIcon;
  badgeKey?: SidebarBadgeKey;
};

export type ModuleSidebarConfig = {
  module: Module | "parent";       // "parent" is special-cased
  label: string;                    // "Markbook", "Attendance", …
  icon: LucideIcon;                 // matches ModuleSwitcher icons today
  iconByHref: Record<string, LucideIcon>;
  quickActionByRole: Partial<Record<Role | "parent", QuickAction>>;
};

export const SIDEBAR_REGISTRY: Record<Module | "parent", ModuleSidebarConfig> = {
  markbook: { /* … */ },
  attendance: { /* … */ },
  // …
};
```

`<ModuleSidebar module="markbook" role={role} email={email} badges={badges} userId={userId} />` reads from `SIDEBAR_REGISTRY[module]` + `NAV_BY_MODULE[module]` and composes the layout. No prop drilling beyond that.

## 7. Component API

```tsx
// components/module-sidebar.tsx
type ModuleSidebarProps = {
  module: Module | "parent";
  role: Role | null;            // null only for parents
  email: string;
  userId: string;               // needed for realtime channels
  badges?: SidebarBadges;       // SSR initial values
};

export function ModuleSidebar(props: ModuleSidebarProps): JSX.Element;
```

Internal subcomponents (`module-sidebar/*.tsx`) are not exported — implementation detail.

## 8. Tokens & primitives

| Surface | Token / primitive |
|---|---|
| Sidebar shell | `Sidebar collapsible="icon"` (shadcn, unchanged) |
| Header tile | `bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile` (§3.2) |
| Header label | `font-mono text-[10px] tracking-[0.14em]` eyebrow + `font-serif text-base` headline (§3.3) |
| Module switcher popover | `Popover` + `PopoverTrigger` + `PopoverContent` (shadcn) |
| Quick action CTA | `Button` default variant (gradient + `shadow-button`, §3.2) |
| Nav item active | `bg-accent` + `ring-1 ring-inset ring-brand-indigo-soft/30` + `text-brand-indigo-deep` (§9.4 wash family) |
| Nav item badge | `rounded-full bg-destructive px-1.5 text-[10px] tabular-nums text-white` (§9.3 destructive) |
| Section labels | `font-mono text-[10px] tracking-[0.14em] text-sidebar-foreground/50` (unchanged) |
| Footer pill | shadcn `Popover` with avatar + email + chevron |
| Footer avatar | `bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile` (§3.2) |

**Tokens added.** None — every recipe uses existing tokens. Hard Rule #7 maintained.

## 9. Layout integration

Each `app/(<module>)/layout.tsx` simplifies:

```tsx
// before
<SidebarProvider defaultOpen={defaultOpen}>
  <MarkbookSidebar role={role} email={email} badges={sidebarBadges} userId={id} />
  <SidebarInset>
    <TestModeBanner />
    <header className="…">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 h-4" />
      <ModuleSwitcher currentModule="markbook" role={role} />
    </header>
    <div className="…">{children}</div>
  </SidebarInset>
</SidebarProvider>

// after
<SidebarProvider defaultOpen={defaultOpen}>
  <ModuleSidebar module="markbook" role={role} email={email} userId={id}
                 badges={sidebarBadges} />
  <SidebarInset>
    <TestModeBanner />
    <header className="…">
      <SidebarTrigger className="-ml-1" />
      {/* ModuleSwitcher removed; topbar leaves room for future breadcrumbs */}
    </header>
    <div className="…">{children}</div>
  </SidebarInset>
</SidebarProvider>
```

The topbar shrinks visually but keeps the same height (h-14) — no layout shift on existing pages.

## 10. Migration strategy

This is a **bulk replacement**, not touch-it-when-you-touch-it (per `09-design-system.md` §4.2's migration policy, which applies to legacy wrappers like `Surface` — not to outright duplication). All 8 sidebars are replaced in one PR because they're literal copies of each other; gradual migration would mean shipping two diverging implementations.

Order of operations (informs the `writing-plans` plan, not a binding script):

1. Build `lib/sidebar/registry.ts` + `lib/sidebar/use-realtime-badges.ts`.
2. Build `components/module-sidebar/*.tsx` subcomponents.
3. Build `components/module-sidebar.tsx` composer.
4. Migrate one layout (markbook — highest complexity, validates badge wiring).
5. Smoke test: hover all states, collapse/expand, mobile sheet, popover keyboard nav.
6. Migrate remaining 7 layouts.
7. Delete legacy files (full list in §12: 8 sidebars + `module-switcher.tsx` + `use-realtime-badge-count.ts`).
8. Manual smoke at 1440 / 1024 / 768 / 375 across all modules.
9. `npx next build` clean.

## 11. Risks & gotchas

- **Popover-in-collapsed-sidebar.** The `Sidebar` shadcn primitive uses CSS group selectors (`group-data-[collapsible=icon]:hidden`) for its collapsed state. The header popover trigger needs to remain clickable when collapsed — verified the trigger renders the brand tile (not hidden) so `<PopoverTrigger>` still works. Anchoring uses `side="right"` to avoid clipping inside the narrow column.
- **Active state and `requiresRoles`-filtered items.** `SidebarMenuButton` with `data-[active=true]` selectors require the `isActive` prop to be set correctly. The shared sidebar runs the same longest-prefix-match logic markbook does today (`activeHref = items.filter(i => pathname === i.href || pathname.startsWith(i.href + "/")).sort((a, b) => b.href.length - a.href.length)[0]?.href`).
- **`ScrollArea` inconsistency.** `sis-sidebar.tsx` wraps `SidebarContent` in a `ScrollArea` (because the SIS nav is the longest tree). Other sidebars don't. The shared sidebar always wraps in `ScrollArea` — costs nothing on short trees and prevents the SIS-specific drift.
- **Parent sidebar.** `parent-sidebar.tsx` uses no `Role` (parents are null-role). The shared sidebar's `role: Role | null` type accepts this; `SIDEBAR_REGISTRY.parent` declares no `quickActionByRole` and no role-gated nav. Parent footer's role pill renders "Parent" label.
- **Test-mode banner.** Lives in `<SidebarInset>` outside the sidebar — unaffected by this redesign.
- **Markbook `<ModuleSwitcher>` icon parity.** `module-switcher.tsx` defines `MODULES` with one icon per module. Same icon set lives in `SIDEBAR_REGISTRY.icon`. Single source — `MODULES` is deleted alongside `module-switcher.tsx`, and the registry becomes authoritative.
- **`useRealtimeBadgeCount` callers.** `hooks/use-realtime-badge-count.ts` is referenced only by `markbook-sidebar.tsx` today. After the redesign it's referenced only by the new shared `lib/sidebar/use-realtime-badges.ts`. The old hook file gets deleted (its logic absorbed into the new generalized hook).
- **`getSidebarChangeRequestCount` SSR loader.** Stays in `lib/change-requests/sidebar-counts.ts`. Markbook layout still calls it and threads the result through `badges`. Future modules add similar loaders + registry entries.

## 12. Files touched

**New (10 files):**
- `lib/sidebar/registry.ts`
- `lib/sidebar/use-realtime-badges.ts`
- `components/module-sidebar.tsx`
- `components/module-sidebar/sidebar-header.tsx`
- `components/module-sidebar/sidebar-quick-action.tsx`
- `components/module-sidebar/sidebar-nav-item.tsx`
- `components/module-sidebar/sidebar-profile.tsx`

**Modified (8 layouts):**
- `app/(markbook)/layout.tsx`
- `app/(attendance)/layout.tsx`
- `app/(sis)/layout.tsx`
- `app/(p-files)/layout.tsx`
- `app/(records)/layout.tsx`
- `app/(admissions)/layout.tsx`
- `app/(evaluation)/layout.tsx`
- `app/(parent)/layout.tsx`

**Deleted (10 files):**
- `components/markbook-sidebar.tsx`
- `components/attendance-sidebar.tsx`
- `components/sis-sidebar.tsx`
- `components/p-files-sidebar.tsx`
- `components/records-sidebar.tsx`
- `components/admissions-sidebar.tsx`
- `components/evaluation-sidebar.tsx`
- `components/parent-sidebar.tsx`
- `components/module-switcher.tsx`
- `hooks/use-realtime-badge-count.ts`

**Net:** −10 + 7 + 8 mod = significant net reduction in code, single visual source of truth.

## 13. Acceptance criteria

- [ ] `npx next build` compiles clean.
- [ ] Hard Rule #7 holds: no raw `#rrggbb` / `oklch(...)` / `slate-*` / `zinc-*` / `gray-*` introduced.
- [ ] `grep -r "MarkbookSidebar\|AttendanceSidebar\|SisSidebar\|PFilesSidebar\|RecordsSidebar\|AdmissionsSidebar\|EvaluationSidebar\|ParentSidebar\|ModuleSwitcher" app components` returns zero results.
- [ ] All 8 modules render their sidebar correctly via `<ModuleSidebar>` at desktop + mobile widths.
- [ ] Module-switcher popover lists role-allowed modules in lifecycle order; current module marked.
- [ ] Active nav item shows the §9.4 wash recipe (no left bar).
- [ ] Quick actions render for the role/module combos in §5.5; absent gracefully where declared as `—`.
- [ ] Footer popover opens on click, closes on Escape, contains email row + Account link + Sign out.
- [ ] Markbook teacher's `/markbook/grading/requests` and registrar's `/markbook/change-requests` show the live changeRequests badge unchanged.
- [ ] Parent sidebar (`/parent`) renders with no role badge mismatch and no popover trigger on the brand tile (single-module case).
- [ ] Manual keyboard test: Tab order through quick action → nav items → profile pill; popover closes on Escape; all focus rings visible.

## 14. Out of scope (logged for later)

- Mobile bottom-nav variant (sheet-driven nav stays).
- Sidebar collapse persisting per-module.
- "Recent" or "Pinned" cross-module items.
- New SSR loaders for `attendanceUnmarked` / `pfilesMissingDocs` / `admissionsToReview` badges (the slot is wired; loaders ship in a follow-up).
- Breadcrumbs in the topbar (now has room — design later).
- Quick-action cycling per term/AY (e.g., "Mark Term 2 attendance" — current spec is static label).
