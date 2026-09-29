# Insights Drill Sheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every number and chart on the four Insights pages opens the list behind it, and the list's row count equals the number shown.

**Architecture:** Eight shared chart primitives gain an optional `onSegmentClick`. Each module's existing drill system (`lib/<module>/drill.ts` + `app/api/<module>/drill/[target]` + `<Module>DrillSheet`) gains the targets and row fields the Insights numbers need, each filtering with the same predicate the Insights loader counts with. Client wrappers in `insights-drill-cards.tsx` per module hold the clicked segment and open the sheet; the Insights pages wire `MetricCard.drillSheet` and swap charts for those wrappers.

**Tech Stack:** Next.js 16 App Router (RSC pages, `'use client'` wrappers), Recharts via `components/dashboard/charts/`, shadcn `Sheet`, Supabase service client, Vitest (`--pool=threads`).

**Spec:** `docs/superpowers/specs/2026-09-29-insights-drill-sheets-design.md`

## Global Constraints

- Count = rows: every drill's row count equals the figure on the card or segment it opens (KD #82/#124); averages equal the mean of the listed rows.
- Same predicate: a new target filters with the function the Insights loader counts with; inline loader predicates are extracted to a shared export first, with the loader's existing tests still green.
- Same window: Admissions / Markbook / Records Insights drills omit `from`/`to` (whole year); Attendance Insights drills get the selected term's window; vacation leave uses the **selected** term.
- A click on a comparison-year series opens that year (`ayCode` = the series' year).
- Rates open the denominator, with the outcome as a column.
- Dashboard drills keep their behaviour — add targets, never change an existing target's predicate.
- Chart callback type, identical in every primitive: `onSegmentClick?: (category: string, series?: string) => void`.
- KD #81 linkified primary identifier; KD #80 cache headers + `invalidateDrillTags`; every DataTable column with a render-function header carries `meta: { label }` (KD #161).
- Design system binding (Hard Rule #7): tokens from `app/globals.css` only; clickable segments reuse the hover/pointer treatment `ComparisonBarChart` already has; list blocks get a `ghost` "See all" button in the card header. Plain-English copy.
- No migration.
- Vitest: `npx vitest run <path> --pool=threads`. Tests import vitest globals explicitly.
- Commits: `git add <paths> && git commit` as ONE command (shared index). `git pull --rebase` before any push. Do not push mid-plan.

## Review Focus

1. **Comparison year clicked** — clicking last year's bar/point must open last year's rows, not this year's (every grouped/trend chart with a compare series).
2. **Empty segment** — a segment worth 0 (or a year with no data) opens an empty list with the sheet's empty state, not an error.
3. **"Other" buckets** — top-N donuts with an overflow slice (cancellation reasons, referral) must open exactly the rows the overflow counts.
4. **Level label vs code** — charts plot level codes (`P1`), some drills key by label; the segment must resolve so the count matches.
5. **Page opened, not just built** — RSC "functions cannot be passed to Client Components" only fires at render; each phase opens its page before it is done.

## Phases

Each phase is gated: its tests pass, tsc is clean, its page renders with every block clickable, and a reviewer pass approves before the next phase starts.

| Phase                        | File                                                     |
| ---------------------------- | -------------------------------------------------------- |
| 1 — Shared chart click props | `2026-09-29-insights-drill-sheets/phase-1-charts.md`     |
| 2 — Attendance Insights      | `2026-09-29-insights-drill-sheets/phase-2-attendance.md` |
| 3 — Admissions Insights      | `2026-09-29-insights-drill-sheets/phase-3-admissions.md` |
| 4 — Records Insights         | `2026-09-29-insights-drill-sheets/phase-4-records.md`    |
| 5 — Markbook Insights        | `2026-09-29-insights-drill-sheets/phase-5-markbook.md`   |
| 6 — Docs                     | below                                                    |

Phases 2–5 depend on Phase 1 only; they do not depend on each other.

## Where the phases depart from the spec (found while reading the code)

- **Chart callbacks:** `TrendChart` reports `'current' | 'comparison'`, `ComposedBarLineChart` `'bar' | 'line'` — wrappers map them to AY codes. Retention's key is `didNotReturn`; attrition reports reason labels. Zero-value bars draw nothing and can't be clicked.
- **Existing figures that undercount today, fixed here (production numbers will move):** Markbook's sheets-locked bars and both `compare.ts` sheet reads are unpaginated (a year has ~1,116 sheets, PostgREST caps at 1,000); Admissions' terminal-reason loader is unpaginated and counts a reason on any status; Admissions Insights loaders join status-first where drills join application-first (Task 3.4's probe measures the shift).
- **Rates open the denominator, applied further:** the controllability banner opens every withdrawal with a Preventable? column; "Top reason per level" opens all that level's reasons.
- **New targets beyond the spec:** `intake-month` (Admissions), `movement-month` (Records — the bars count audit events, not roster rows). `funnel-stage` (no callers) is aligned in place.
- **Markbook:** subjects keyed by catalogue name; the level line is an average of subject averages (parity via the shared helper, not a row mean); no Markbook chart plots the comparison year, so the hero badge's sheet offers the other year.
- **Records retention** needs `compareAy` on the drill request; late/withdrawal lists are one row per event.
- **Attendance:** the vacation "approaching" list switches to the drill's rule (drops a 0-allowance student with no trips); the CSV link's missing `termId` is fixed.

## Phase 6 — Docs

### Task 6.1: Record the decision

**Files:**

- Modify: `docs/key-decisions/dashboards.md` (append KD #229)
- Modify: `.claude/rules/key-decisions.md` (dashboards row + quick lookup `229 dashboards`) — rule file, edit approved as part of this plan's KD addition
- Modify: `docs/context/20-dashboards.md` (Insights section: drills now exist)

- [ ] **Step 1:** Append to `docs/key-decisions/dashboards.md`:

```markdown
### KD #229

**Insights pages drill, and the list always matches the number (2026-09-29).** Every KPI and chart on `/admissions/insights`, `/attendance/insights`, `/markbook/insights` and `/records/insights` opens the rows behind it through the module's existing drill system. Rules: the drill filters with the same predicate the Insights loader counts with (extracted to a shared export where it was inline), so the row count equals the figure; whole-year pages drill whole-year, Attendance drills the selected term (vacation leave included); a comparison-year series opens that year; a rate opens its denominator with the outcome as a column; where a dashboard target counts differently, Insights gets its own target and the dashboard's is untouched. Charts: `GroupedBarChart`, `TrendChart`, `CategoryLineChart`, `ComposedBarLineChart`, `RetentionStackedBarChart`, `AttritionStackedBarChart`, `NationalityMixPie`, `NationalityByLevelBars` take `onSegmentClick(category, series?)`. Filters are the follow-up.
```

- [ ] **Step 2:** Add `229` to the dashboards row and `· 229 dashboards` to the quick-lookup in `.claude/rules/key-decisions.md`; bump its "1–228" range to "1–229".
- [ ] **Step 3:** In `docs/context/20-dashboards.md`, replace any statement that Insights pages have no drill with one line pointing at KD #229.
- [ ] **Step 4:** Commit: `git add docs/key-decisions/dashboards.md .claude/rules/key-decisions.md docs/context/20-dashboards.md && git commit -m "docs: KD #229 — insights pages drill"`
