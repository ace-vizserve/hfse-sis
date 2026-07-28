# Cross-module change-request notification bell

**Date:** 2026-07-28
**Status:** Approved, not yet implemented

## Problem

Grade change-request approvers (school_admin / superadmin designated as primary or secondary approver, KD #41) are notified today only two ways: email (KD #88/#123 — recently found to have been silently failing in prod due to an unawaited fire-and-forget promise, since fixed) and a badge on the "Change Requests" / "My Sheets → My Requests" nav item inside **Markbook's own sidebar** (`lib/change-requests/sidebar-counts.ts::getSidebarChangeRequestCount`, wired through `lib/sidebar/use-realtime-badges.ts`).

That badge is already correctly computed and already live (realtime Supabase subscription) — but it's invisible unless the approver is currently browsing inside the Markbook module. An approver whose day-to-day work is in Records, SIS Admin, or elsewhere has no in-app signal that something needs their action.

## Scope

This is **not** a general-purpose notification system. It is the existing `changeRequests` signal, made visible from every module instead of only Markbook. No new notification types, no read/unread persistence beyond what the live count already implies, no settings page. If other approval-style flows (P-Files document validation, admissions stage reviews) want a similar affordance later, that's a separate, later decision — not built here.

## Placement

Every module already renders a shared, per-module-layout sticky header bar at the top of the page content (`app/(markbook)/layout.tsx` and its 6 module siblings — same pattern repeated in each), currently holding only the sidebar collapse-toggle (`<SidebarTrigger>`). This is **not** part of `<ModuleSidebar>` (which has its own separate header/footer, explored and ruled out during design). The bell is added to this existing top header bar, next to `<SidebarTrigger>`, right-aligned. Because this header is already rendered identically across all 7 module layouts, the bell is visible on every module automatically.

Out of scope: relocating the Cmd+K search trigger (currently inside `<ModuleSidebar>`'s own header) into this same bar. Visually related, functionally unrelated to this feature — a separate decision if wanted later.

## Data layer

Add `getSidebarChangeRequestPreview(service, role, userId, limit)` to `lib/change-requests/sidebar-counts.ts`, alongside the existing `getSidebarChangeRequestCount`. It shares the **exact same** per-role, per-current-AY scope logic as the count function (teacher: own pending · academic_coordinator: approved-not-yet-applied · school_admin/superadmin: pending where they're the designated primary/secondary approver, or legacy null-approver rows) — copy the filter branches, don't rederive them, so the preview list can never disagree with the badge count it's paired with (this codebase's own established rule, KD #124: a card's count and its drill must share one scope).

Difference from the count function: no `head: true`, selects `id, field_changed, reason_category, requested_at, grading_sheet_id, grade_entry_id`, orders by `requested_at desc`, capped at `limit` (5). Student/sheet display labels are resolved via the existing `fetchLabels(service, gradingSheetId, gradeEntryId)` helper (already used by the email-notification code, `lib/change-requests/labels.ts`) — cheap at N≤5.

Explicitly **not** reused: the general-purpose `GET /api/change-requests` route. It powers the full `/markbook/change-requests` inbox page, has no current-AY scoping, and has no `academic_coordinator` branch — it answers a different question ("everything I'm allowed to browse") than the bell needs ("what's actionable for me right now").

## Live updates

The sidebar's existing badge already subscribes to a Supabase realtime channel on `grade_change_requests` INSERT/UPDATE, scoped per role, and recomputes the count client-side (`lib/sidebar/use-realtime-badges.ts`). The bell needs the same live count. Rather than have the bell open a second independent subscription duplicating that role-scoped SQL, extract the `changeRequests`-specific subscribe-and-recount logic out of `use-realtime-badges.ts` into a standalone hook:

```
useChangeRequestCount(role: Role, userId: string, initial: number | null): number | null
```

New file `lib/sidebar/use-change-request-count.ts`, alongside the existing `lib/sidebar/use-realtime-badges.ts`. Both the sidebar's `useRealtimeBadges` (calling this hook internally instead of inlining the channel/recount logic it has today) and the new bell call this hook independently. Shared filter logic, two lightweight subscriptions (not a shared piece of client state) — introducing a context/provider across all 7 layouts just to share one number is more architecture than this feature warrants.

## Component

New client component `components/notifications/notification-bell.tsx`:

- Bell icon button (lucide `Bell`), with a numeric badge pill when count > 0 — reusing the exact same style already used for sidebar nav-item badges (`rounded-full bg-destructive px-1.5 text-[10px] font-semibold tabular-nums text-white`), not a bare dot. When count is 0, no badge renders.
- Clicking opens a `Popover` (same primitive `SidebarProfile` already uses for the account menu) anchored below-right of the bell.
- Panel content (the row list) is fetched lazily via TanStack Query, `enabled` only while the popover is open (KD #24's established lazy-fetch-on-open pattern, mirrors how drill sheets already behave) — calls a new thin route, `GET /api/change-requests/preview`, wrapping `getSidebarChangeRequestPreview`. The badge count itself does not depend on this fetch; it comes from `useChangeRequestCount` and is available immediately.
- Each row: student/sheet label (via `fetchLabels`), field changed, relative "requested X ago" timestamp. Row is a `next/link` to `/markbook/change-requests?req=<id>` (the exact deep-link format the email notifications already use, KD #123) — clicking closes the popover and navigates.
- Empty state (count === 0, panel opened anyway): plain "Nothing pending" message, no fetch needed.

## Mounting

Added to each of the 7 module `layout.tsx` files' `<header>` block, next to the existing `<SidebarTrigger>` — matching how `SidebarTrigger` itself is already duplicated per-layout rather than centralized (Phase 2 pattern match, not a new convention). Each layout already computes `sidebarBadges.changeRequests` server-side today (passed into `<ModuleSidebar badges={sidebarBadges}>`); the bell reuses that same already-fetched value as its `initialCount` prop — no additional query fires on page load.

## Role gating

Only mounts/shows for roles where the `changeRequests` badge key is meaningful today — teacher, academic_coordinator, school_admin, superadmin. Admissions and p_file_officer roles never see it (mirrors the existing sidebar-badge gate; they're not participants in the change-request flow, KD #2).

## Testing

- Unit test for `getSidebarChangeRequestPreview`, mirroring the existing scope-correctness coverage this codebase already has for `getSidebarChangeRequestCount` (one case per role branch, plus the current-AY exclusion case).
- Component test for `<NotificationBell>`: renders the badge pill only when count > 0, opens the popover, lazy-fetches only once opened, row click navigates to the correct deep-link and closes the popover. Follows the existing patterns under `__tests__/query/` and `__tests__/admin/publish-window-panel.test.tsx` (a comparable popover + lazy-query component already in this repo).

## Out of scope (explicitly deferred)

- Generalizing to other approval-style flows (P-Files, admissions) — no second consumer exists yet to design a shared primitive against.
- Moving the Cmd+K search trigger into the same header bar.
- Any notification type beyond change-requests (this is not a general notification system).
- Read/unread/dismiss state beyond what the live count already implies.
