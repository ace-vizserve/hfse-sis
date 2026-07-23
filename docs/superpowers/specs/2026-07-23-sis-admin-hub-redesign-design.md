# SIS Admin Hub — Command Centre Redesign

**Date:** 2026-07-23
**Status:** Draft for review
**Scope:** `/sis` (the SIS Admin Hub) only. No other SIS Admin page changes.

---

## 1. Problem & motivation

The Admin Hub already went through three redesign passes this cycle (IA restructure, visual makeover, content pass — see KD #154 in `.claude/rules/key-decisions/records.md`) and is genuinely on-brand, not a rebuild-from-scratch situation like the module Insights pages were. But the user's framing was specific: **"admins live here"** — and the current page only answers two questions ("is setup done?" via the year band, "is anything broken right now?" via the attention feed). It doesn't answer **"what's been happening?"** or **"how healthy is the system, day to day?"** — genuinely different questions from a one-time setup checklist.

A parallel finding: the year band's readiness fraction was displaying a stale placeholder (the code's actual `getAyReadiness()` engine tracks **9 required steps**, not the "6/7"/"7" figures referenced earlier in exploration) with zero per-step detail visible without a full page navigation to `/sis/ay-setup`.

## 2. Goal

Add substance to the hub without bloating its default footprint: richer readiness detail (on demand, not permanently inline), a whole-school snapshot, a cross-module glance, and genuinely new — not duplicative — activity/health visualizations, all sourced from data that already exists in the codebase (no new loaders' worth of business logic, only new call sites + light aggregation).

## 3. What stays exactly as-is

- Page header (`SisPageHeader`), role gate (`school_admin | superadmin`).
- `SystemHealthStrip` (superadmin-only).
- `HubYearBand` component and its position — only its readiness _count_ is corrected (see §4.1) and a new button is added to it.
- `HubAttentionFeed` ("Needs attention") and `HubUpcomingEventsCard` ("Coming up") — unchanged.
- `HubQuickActions` (4 launch tiles) — unchanged.
- The trust strip.

## 4. New sections

### 4.1 Readiness detail — Popover off a "Summary" button

**Problem with the inline-panel version explored first:** showing all 9 step rows permanently below the year band pushed the whole page down every single day, even when nothing needs attention (density complaint — "cause its taking too much space").

**Resolution:** a `Summary` button (`outline` variant, next to the existing `Finish setup` primary CTA) opens a `Popover` (`components/ui/popover.tsx` — already the canonical primitive for anchored floating panels: facet filters, inline editors, module switcher) anchored under the button. Default state: **closed**, zero permanent page height. Closes on click-away / Escape, per the primitive's native behavior.

**Content — ring-progress rows**, one per `ReadinessStep` (`lib/sis/readiness.ts`), grouped exactly as the existing `/sis/ay-setup` checklist already clusters them (`CLUSTER_LABEL_BEFORE` in `year-setup-checklist.tsx`): **Core setup** (ay-setup, calendar) → **Grading & staffing** (sections, subject-weights, advisers, section-subjects, grading-sheets) → **Branding & admissions** (virtue-themes, letterhead) → **Optional** (app-window).

Each row: a small ring (conic-gradient fill = `step.fraction.done / step.fraction.total`, or 100%/0% for boolean steps like letterhead/app-window) in mint (done) / amber (partial) / muted (not-started, optional only), the step's real `label`, a one-line summary derived the same way `checklistSummary(step.id, {...})` (`lib/sis/year-setup.ts`) already renders it on the full checklist page, and a right-aligned badge: `Ready` (done), the literal `done/total` fraction (partial), or `Optional`/`Not started`.

A `Full checklist →` link in the popover header goes to `/sis/ay-setup`.

**Data:** `getAyReadiness(ayCode)` — already fetched by `app/(sis)/layout.tsx` and passed down; no new query. **Correction to earlier exploration:** the readiness engine tracks **9 required steps** (`STEP_META` in `lib/sis/readiness.ts`), not 7 — the hub's fraction display and any copy must read `{complete}/9`, not a stale smaller denominator.

### 4.2 School Snapshot

A new full-width card, positioned after the year band + popover, before the stat row. Four columns (meta-strip pattern, `09a-design-patterns.md` §8):

1. **Enrolled by level** — mini horizontal bars, one per level (P1–S4, the fixed 10-level catalog per migration 086), primary levels in indigo, secondary in sky. Data: `getLevelDistribution(ayCode)` (`lib/sis/dashboard.ts`).
2. **Staff** — total active account count + a role breakdown (teacher / registrar / school_admin / superadmin counts). Data: `listStaffUsers()` (`lib/sis/users/queries.ts`), aggregated client-side (or in the page RSC) by `role`.
3. **Sections** — active section count + average roster size vs the 50-student cap (Hard Rule #5), as a simple utilization bar. Data: `getHubKpis(ayCode).activeSections` (already fetched) + a lightweight `section_students` count aggregate (new, but a single `count` query, not new business logic).
4. **Current term** — term label + days remaining, computed via `resolveCurrentTerm` (`lib/sis/current-term.ts`) + a date-math delta against the resolved term's `end_date` (same pattern already used for `daysLeftInActiveTerm` in `lib/sis/enrolment-position.ts` — reuse the calculation, not necessarily that exact function, since this is "current term" not "late-enrollee" framing).

### 4.3 Stat row — unchanged content, one addition

The existing 4 tiles (`enrolledStudents`, `activeSections`, `pendingChangeRequests`, `openPublicationWindows`) are unchanged. **Addition:** the "Enrolled students" tile gains a growth-delta chip (`+12 vs AY2025` style, mint/amber per direction) using the already-shared `growthDelta()` helper (`lib/dashboard/growth.ts` — the same one Admissions/Records Insights use) comparing against the prior AY's enrolled-student count. No new metric, just an over-time framing on an existing one — consistent with KD #140's "a metric on two surfaces needs a genuine over-time angle" rule (this AY-over-AY angle doesn't exist on the flat hub stat today).

### 4.4 Module overview

A new row of 6 compact cards, one per module, each a live headline number + a one-line label, linking to that module's own dashboard. **All fields verified against real KPI-loader return types** (correcting one mistake found during spec-writing — see below):

| Module     | Metric                     | Source                                                                         | Field                                                                                                                                               |
| ---------- | -------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admissions | New applications this week | `getAdmissionsKpisRange(input)`                                                | `applicationsInRange`                                                                                                                               |
| Records    | Enrolled students (+YoY)   | `getHubKpis(ayCode).enrolledStudents` (already fetched) + §4.3's `growthDelta` | —                                                                                                                                                   |
| Attendance | Attendance rate today      | `getAttendanceKpisRange({from: today, to: today, ...})`                        | `attendancePct`                                                                                                                                     |
| Markbook   | Sheets locked              | `getMarkbookKpisRange(input)`                                                  | `lockedPct` **(corrected — `gradesEntered` is a raw count, not a percentage; `lockedPct` is the real completion-percentage field this card needs)** |
| Evaluation | Write-ups submitted        | `getEvaluationKpisRange(input)`                                                | `submissionPct`                                                                                                                                     |
| P-Files    | Docs expiring ≤30d         | `getPFilesKpisRange(input)`                                                    | `expiringSoon30`                                                                                                                                    |

Each `RangeInput` call uses a sensible default window (e.g., "this week" for Admissions/count-style metrics, a single-day range for Attendance's "today" framing) — exact range defaults are an implementation-plan decision, not a design one; the point locked here is the **field**, not the window.

**Anti-duplication note (KD #140):** these are single headline numbers with a link out, not new analytics — the module's own dashboard remains the place to actually explore the metric. This mirrors the pre-KD-#154 card-grid pattern that was _removed_ for being dead links with no data — the difference here is these cards carry a **live** number, closing that exact gap without resurrecting the "menu of links" the removal was correcting for.

### 4.5 Recent activity

A trimmed feed of the most recent **governance/config** changes (school config edits, template applies, environment switches, user/role changes, AY create/switch/delete, approver assign/revoke, early-bird toggles) — i.e. `getStructuralChangeFeed()` (`lib/sis/dashboard.ts`), already computed for `/sis/audit-log?view=overview` but not rendered on the hub. Capped to ~5 rows, with a `View full audit log →` link.

**Deliberately not** `getRecentSisActivity()` — that broader feed (student/enrolment/AY/P-Files/`sis.*` actions) is **already live on the Records dashboard** (`app/(records)/records/page.tsx`). Using it here too would be a direct duplicate; the narrower governance-only feed is the genuinely hub-specific slice (config/system changes an admin, not a registrar, cares about).

### 4.6 Activity & health charts

Two panels, side by side (wider trend chart : narrower bar chart), both pulling data already computed for `/sis/audit-log?view=overview` but never rendered on the hub:

1. **System activity trend** — a line/area chart (reuse `TrendChart`, `components/dashboard/charts/trend-chart.tsx`) of daily audit-event volume over the last 14 days. Data: `getAuditDailyTrend(input)` → `AuditDailyTrendResult` (`RangeResult<VelocityPoint[]>`).
2. **Activity by module** — a horizontal bar chart (reuse `ComparisonBarChart`, `orientation="horizontal"`) of audit-event counts per module over the current week. Data: `getAuditActivityByModule(input)` → `RangeResult<AuditModulePoint[]>`.

**Why these two specifically** (and not top-actors / top-actions / auth-events, the other cards already built for the audit-log page): both are genuinely **cross-module** — no single module's own dashboard can show "how is activity distributed across the whole system" or "is system-wide admin activity trending up or down." Top-actors and top-actions are more "who/what" than "how healthy," and auth events lean security-monitoring rather than day-to-day admin use — all three stay exclusive to the audit-log page for now (not removed from consideration, just not part of this pass).

## 5. Icon fidelity

Every icon tile across all new sections uses real inline `lucide-react` components (`Calendar`, `ShieldCheck`, `ArrowRight`, `Users`, `LayoutGrid`, `ArrowLeftRight`, `BookOpen`, `FileText`, `CheckCircle2`, `MessageSquare`, `FileWarning`, `TrendingUp`, `BarChart3`, `ClipboardList`, `UserPlus`, `CalendarOff`, `AlertTriangle`, `Zap`, `ArrowUp` for the delta chip) — never emoji or Unicode pictographs. This was a specific, explicit correction during mockup review (the mockup itself, built as static HTML, used emoji placeholders for speed; every one was swept and replaced with lucide-equivalent inline SVG before this spec was written, confirming the icon set is real and available in the installed `lucide-react` version).

## 6. Data-honesty notes

- **Readiness fraction is `{complete}/9`**, not the earlier placeholder "6/7" — the real engine's required-step count.
- **Module overview cards use the exact field names verified against each loader's TypeScript return type** (§4.4 table) — the Markbook metric was caught and corrected from an invented "82% grades entered" (not a real field) to the real `lockedPct`.
- **Recent activity and Records' existing feed are deliberately different data sources** — no duplication, confirmed by reading both call sites.
- **Activity/health charts are genuinely cross-module** — chosen specifically because no other dashboard can show them, per KD #140's anti-duplication rule.

## 7. Non-goals / out of scope

- No new database migrations, no new tables.
- No changes to `/sis/ay-setup`'s full checklist page (the Popover reuses its data + summary logic, doesn't replace it).
- No changes to any other SIS Admin sub-page (Sections, Staff, Approvers, School Config, Calendar, Subject Weights, Structure Defaults, Discount Codes, Audit Log, Settings).
- Top-actors, top-actions, and auth-events cards stay exclusive to `/sis/audit-log` — not pulled onto the hub in this pass.
- No change to the existing `getRecentSisActivity()`-powered feed on the Records dashboard.

## 8. Open item carried into implementation

**Density.** The hub is now visibly denser than before this pass (year band + popover trigger, School Snapshot, stat row, module overview, needs-attention/coming-up, recent activity, two charts, quick actions). The readiness detail was deliberately moved behind a Popover specifically to manage this; the remaining sections were reviewed and approved section-by-section through the mockup rather than as a single before/after comparison. Once implemented, a manual browser pass (per Workflow §3) should confirm the page reads as substantive rather than cluttered — if it doesn't, School Snapshot and Module Overview are the two most collapsible/deferrable candidates (both are net-new, neither replaces something that was there before).

## 9. Verification approach (detailed further in the implementation plan)

- `npx vitest run` on any new pure helpers (e.g., a role-count aggregator, a "days remaining in term" pure function if one doesn't already exist verbatim).
- `npx next build` clean.
- Hard Rule #7 grep sweep on every new/edited file (no raw hex/oklch/slate/zinc/gray/bg-white/bg-black).
- Manual browser pass: Popover opens/closes correctly (click-away, Escape), all 6 module-overview links resolve, growth-delta chip shows correct direction/color, both new charts render with real data on a populated AY, icon tiles render as crisp SVG (not missing/broken).
