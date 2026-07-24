# Role-aware `/account` page — design spec

## Context

The `/account` page (`app/(dashboard)/account/page.tsx`) is the one neutral, cross-module surface every signed-in user lands on regardless of role. Today it's minimal: a read-only identity card (email, role) and a change-password form, capped to `max-w-2xl`. It gives no sense of what the account is actually set up to do.

Mr Ace asked for it to become role-aware — informative (what does this account do, what's outstanding) and actionable (shortcuts to what that role actually uses), sized to the page's full width rather than a narrow stack. The direction converged over a few mockup rounds into a specific two-column layout (validated against a reference screenshot the user supplied), settling on:

- Live, per-role numbers (not just static blurb text) — reusing existing dashboard/priority-panel computations wherever one already exists, never inventing a new query when one is available.
- A personal activity feed sourced from `audit_log`, capped at 6 rows, deep-linking to the relevant module's full audit log.
- A full-width two-column layout: a 300px left rail (identity + password) and a wide main column (activity, shortcuts, this-term stats).

## Layout

```
┌─────────────┐  ┌──────────────────────────────────────────┐
│ About card  │  │ Recent activity (full width)              │
│ · avatar    │  │  6 rows max, dot-timeline, "View all →"   │
│ · name/role │  ├──────────────────┬─────────────────────────┤
│ · Identity  │  │ Shortcuts        │ This term                │
│ · sections* │  │ (list rows)      │ (icon+label+value rows)  │
├─────────────┤  └──────────────────┴─────────────────────────┘
│ Change      │
│ password    │
└─────────────┘
  300px              flexible (grid-template-columns: 300px 1fr)
```

Collapses to a single column under ~860px (matches the breakpoint already used by `app/(sis)/sis/loading.tsx`'s own `md:grid-cols-[1fr_320px]` aside pattern — this spec's `300px 1fr` split is the same idiom, not a new one). The page drops its current `max-w-2xl` override and uses `PageShell`'s normal width.

`*` "Your sections" is a **teacher-only** sub-section — see per-role content table below. No other role gets a forced-empty placeholder in its place; their About card is just avatar/name/role chip + Identity (email, role).

## Section 1 — About card (left rail, top)

- Avatar: initials tile, same visual recipe as `StaffAvatar` (`components/sis/staff-visuals.tsx`) — `staffInitials(name)` on the session user's display name, `bg-brand-indigo/10 text-brand-indigo rounded-xl`.
- Name + `RoleChip` (`components/sis/staff-visuals.tsx`, already exports `ROLE_CHIP_LABEL`/`ROLE_CHIP_TONE`) — reused as-is, flat by design (§9.3 pattern, never gradient — confirmed against that file's own doc comment).
- **Identity** sub-section: Email, Role (mono, `text-primary`) — this is the existing "Signed-in identity" card's content, folded into the About card instead of living as its own separate card.
- **Your sections** sub-section (teacher only): one row per `teacher_assignments` entry via `loadAssignmentsForUser(supabase, userId)` (`lib/auth/teacher-assignments.ts`), deduped by section, showing section name + role tag ("Form adviser" / the subject name for `subject_teacher` rows) — mirrors the reference's "Teams: role · member count" rows, same precedent already used by `loadMarkbookTeacherPriorityUncached` (`lib/markbook/dashboard.ts:1046`) and `loadEvaluationTeacherPriorityUncached` (`lib/evaluation/dashboard.ts:568`) to derive a teacher's own section set.

## Section 2 — Change password (left rail, bottom)

Unchanged — the existing `ChangePasswordForm` (`app/(dashboard)/account/change-password-form.tsx`), just relocated from its own full-width card into the left rail.

## Section 3 — Recent activity (main column, top, full width)

- Query: `audit_log` where `actor_email = sessionUser.email`, `order by created_at desc`, `limit 6`. Runs directly in the page RSC (server client is fine — RLS already gates `audit_log` SELECT to `is_registrar_or_above()`... **note**: this means non-privileged roles (teacher, p_file_officer, admissions) cannot SELECT from `audit_log` under current RLS (migration 006, KD #9). This section **must read via the service client**, same as every per-module audit-log page already does, or teachers will just see an empty/errored feed. Flag this explicitly in the plan — it's not optional.
- Each row rendered via the existing humanizer: `auditActionLabel(action)` for the title, `auditContextSummary(action, context)` for the one-line summary (never JSON, per that function's own contract), relative time (`toLocaleString`/a small "N min ago" helper — check if one already exists before writing a new one).
- Dot color: reuse `auditActionTone(action)` → map `default/info/warning/destructive` to the existing indigo/mint/amber/muted dot classes already established in the mockup (destructive tone → an existing destructive-red equivalent, not introduced yet — confirm against the design system's status palette, §9.3).
- Empty state (brand-new account, zero rows): "No activity yet." — not an error, not a spinner forever.
- **"View all activity →"** button at the bottom, always visible (even with < 6 rows), linking to:

  | Role                   | Target                                |
  | ---------------------- | ------------------------------------- |
  | `teacher`              | `/markbook/audit-log?actor=<email>`   |
  | `academic_coordinator` | `/markbook/audit-log?actor=<email>`   |
  | `school_admin`         | `/sis/audit-log?actor=<email>`        |
  | `superadmin`           | `/sis/audit-log?actor=<email>`        |
  | `p_file_officer`       | `/p-files/audit-log?actor=<email>`    |
  | `admissions`           | `/admissions/audit-log?actor=<email>` |

  Chosen as each role's most-central module (matches KD #2's role descriptions), not an arbitrary pick — see "Audit-log actor-filter extension" below for why all 6 targets work correctly.

## Section 4 — Shortcuts (main column, bottom-left of the two-up row)

- Source: `SIDEBAR_REGISTRY` (`lib/sidebar/registry.ts`) — for each module in `MODULE_ORDER`, check `isRouteAllowed(config.primaryHref, role)` (or equivalent access check) to scope to modules this role can actually open, then take `config.quickActionByRole[role]` when present. Some role/module combinations have **no** quick action by design (documented in-file — e.g. teacher has none for Markbook since "My Sheets" is already the second sidebar row) — those modules are simply skipped, not shown as a broken/empty row.
- Rendered as list-rows (icon tile — reuse each module's own icon + a module-appropriate gradient tone, matching `SIDEBAR_REGISTRY[module].icon`), not the icon-tile grid from earlier mockup rounds — this matches the reference's row style and reads better once "This term" occupies the other half of the two-up row.
- Badge counts (`quickActionByRole[role].badgeKey`, resolved via whatever the existing sidebar realtime-badge mechanism (`lib/sidebar/use-realtime-badges.ts`) already computes) are a **stretch goal for this page**, not required for v1 — that hook is designed for the client-side sidebar's own polling, and reusing it server-side in an RSC needs its own look before committing to it. If it turns out cheap, include it; if not, ship shortcuts without badges and note the follow-up.

## Section 5 — This term (main column, bottom-right of the two-up row)

Per-role stat rows (icon + label + value, `.ov-row` style from the mockup), sourced from **already-existing, already-cached functions** — no new query is invented for this page:

| Role                   | Stat(s)                                               | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `teacher`              | Sections; Write-ups still needed; Open grading sheets | `loadAssignmentsForUser` (count); `getEvaluationTeacherPriority({ayCode, teacherUserId})` (`lib/evaluation/dashboard.ts:706`) `.headline.value`; `getMarkbookTeacherPriority({ayCode, teacherUserId})` (`lib/markbook/dashboard.ts:1157`) `.headline.value` — **note**: this is "sheets currently unlocked", not literally "due this week" (no due-date concept exists on grading sheets) — the mockup's "1 sheet due this week" copy should read "N open grading sheets" instead, to stay honest about what the number means. |
| `academic_coordinator` | Change requests pending (system-wide)                 | `getMarkbookKpisRange(...).current.changeRequestsPending` (`lib/markbook/dashboard.ts:784`) — AY-wide, unwindowed live count                                                                                                                                                                                                                                                                                                                                                                                                   |
| `school_admin`         | Change requests awaiting your review                  | `getSidebarChangeRequestCount(service, role, userId)` (`lib/change-requests/sidebar-counts.ts:17`) — already the exact per-approver count, same one powering the sidebar badge                                                                                                                                                                                                                                                                                                                                                 |
| `superadmin`           | Active staff accounts; Environment; Current AY        | `getStaffCount()` (`lib/auth/staff-list.ts`, just hardened this session); environment from the existing test-AY-detection convention (`ay_code ~ '^AY9'`, KD #52); current AY from `getCurrentAcademicYear()`                                                                                                                                                                                                                                                                                                                  |
| `p_file_officer`       | Expiring ≤30 days; Already expired                    | `getPFilesKpisRange(...).current.expiringSoon30` (`lib/p-files/dashboard.ts:488`); `overdue.length` derived the same way `getPFilesPriority` already does (`lib/p-files/dashboard.ts:759`, filtering `getExpiringDocuments` results to `daysUntilExpiry < 0`)                                                                                                                                                                                                                                                                  |
| `admissions`           | Applications needing follow-up                        | `getOutdatedApplications(ayCode).length` (`lib/admissions/dashboard.ts:367`)                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Every source above already has its own caching (60s TTL pattern, KD #54) or is cheap enough to call directly — this page adds no new `unstable_cache` wrapper of its own.

## Audit-log actor-filter extension (prerequisite, not optional)

3 of 7 module audit-log pages already accept `?actor=<email>` and apply it server-side: Markbook (`.eq('actor_email', ...)`, exact), Evaluation (`.eq(...)`, exact), Attendance (`.ilike('%...%')`, partial — **pre-existing inconsistency, left as-is**, out of scope to "fix" here). The other 4 — P-Files, Records, Admissions, SIS — have no such param today.

Per Mr Ace's decision: extend the same `?actor=` → `.eq('actor_email', actorFilter)` pattern (copying Markbook/Evaluation's exact form, not Attendance's `.ilike`) to all 4 remaining pages, so every role's "View all activity" link is precisely scoped to their own rows, not the whole module's log. This is small and mechanical — same param name, same filter shape, 4 files.

(Records' audit-log page has a pre-existing unrelated oddity — its exported function is literally named `SisAuditLogPage`, an apparent copy-paste leftover. Not this spec's concern; noted for whoever eventually cleans it up.)

## Error / empty states

- **New account, zero audit rows**: "No activity yet." in the timeline panel, no error styling.
- **Teacher with zero section assignments** (shouldn't normally happen, but not impossible mid-transition): omit the "Your sections" sub-section entirely rather than showing an empty list.
- **`getStaffCount`-style query failures**: every source function listed above already fails gracefully (returns `0`/`[]`/`null` on error per their existing implementations) — this page doesn't need its own fallback layer beyond what those functions already do.

## Testing approach

- Pure logic (stat-selection per role, shortcut-scoping-by-role, actor-filter query construction) gets unit tests following this repo's existing Vitest conventions — mirroring `__tests__/sis/staff-list.test.ts`'s mock-`createServiceClient` pattern for anything touching `audit_log` or `listUsers`.
- The 4 newly-actor-filterable audit-log pages get the same coverage style the plan should establish for Markbook/Evaluation's existing `?actor=` behavior (check if a test already exists for those two; if not, that's a pre-existing gap the plan can note but isn't obligated to backfill beyond the 4 new pages).
- No new E2E/browser test infra — this app doesn't have one; verification is `tsc` + `vitest run` + `next build` + manual click-through per this repo's established workflow (`.claude/rules/workflow.md`).

## Out of scope (explicitly, so the plan doesn't scope-creep)

- Shortcut badge counts (stretch goal, noted above — decide during planning, not blocking).
- Fixing Attendance's `.ilike` vs the other pages' `.eq` inconsistency.
- A cross-module "all my activity everywhere" page — the per-role "View all" link goes to one module's log, not a unified feed.
- Any change to `ChangePasswordForm`'s own behavior — it only moves position on the page.
