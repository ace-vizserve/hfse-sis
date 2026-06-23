# Insights Two-AY Comparison — Readability Redesign (Patterns A + C)

**Date:** 2026-06-23
**Status:** Design — approved direction (Patterns A + C, all four Insights pages)
**Module(s):** Attendance / Records / Markbook / Admissions Insights (`/<module>/insights`)

---

## Problem

The two-AY comparison on the module Insights pages (merged via PR #14, branch `feat/insights-two-ay-comparison`) is hard to read: in most sections the compared (2nd) AY appears only as a **hero badge** or a **caption under a number** ("98% · 95% in AY2025"), and the charts plot **only the current AY**. The comparison axis is never drawn. An audit found that of all the insights sections, **only Markbook §2 (subject-performance trend) actually overlays both AYs as chart series** — everywhere else the 2nd AY is collapsed into prose. The user's complaint ("I can't see what's being compared") is literally accurate: it isn't drawn.

## Goal

Make every two-AY comparison legible by **drawing both years in one frame**, with the representation matched to the data's shape:

- **Pattern A — overlaid trend on a relative axis** for the time-series sections.
- **Pattern C — delta-first KPI** for the single-number headlines.

Applied **consistently across all four Insights pages**. The user reviewed rendered mockups of both patterns and approved this direction.

## Non-goals (explicitly deferred / out of scope)

- **Pattern B** (per-category paired-bars / dumbbell for grade-bands, levels, funnel stages) — a follow-up, not this spec.
- The **`CompareAyPicker`** selection UX and the `compareAy` URL-param contract — unchanged.
- Sections with **genuinely no second AY to compare** stay single-AY.
- No DB schema changes, migrations, or new query patterns.

---

## Pattern A — Overlaid trend on a relative axis

**The crux — relative axis, not calendar dates.** Both AYs render as series on a **relative** x-axis:

- **Academic modules** (Attendance, Markbook) → **term index T1–T4**.
- **Flexible modules** (Admissions, Records) → **month index** (month 1..N of the AY).

This is per the existing term-scoped-vs-flexible split (KD #79). Aligning on absolute dates is wrong: AY2025 (Jan–Nov 2025) and AY2026 (Jan–Nov 2026) have different dates and would slide past each other. On a relative axis the two years stack, and **the gap between the lines is the comparison**.

**Visual treatment** (final styling decided at build under frontend-design + ui-ux-pro-max, grounded in design-system §9/§10):

- Current AY = solid line, primary/brand-indigo weight.
- Compared AY = muted, dashed line (the "compare to previous" convention).
- Legend naming both AY codes, via `ChartLegendChip` / `chartLegendContent` (design-system §10 — gradient-pill key matching the series).
- Tooltip shows both AYs' value at the hovered period.
- Missing periods render as gaps (`connectNulls={false}`, already the `MultiSeriesTrendChart` default).

**Charts to convert:**

| Page · Section                   | Today                                               | After                                                                                                                                                                                             |
| -------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Attendance** §2 rate trend     | daily series, **current AY only** + a subtext badge | **per-term attendance %** (T1–T4), one line per AY. Per-term reads cleanly across years; daily can't be aligned across AYs with different dates.                                                  |
| **Admissions** §2 intake         | overlays a within-AY _prior period_                 | applications per **month-index**, one line per **compared AY**.                                                                                                                                   |
| **Records** §3 movement velocity | enrolments-vs-withdrawals (a _metric_ overlay)      | the comparison view shows **net enrolment movement per month**, one line per AY (current vs compared) — distinct from the operational dashboard's enrolments-vs-withdrawals framing, which stays. |
| **Markbook** §2 subject trend    | already overlays both AYs (the model)               | **standardize** onto the shared component (no behavioural change).                                                                                                                                |

**Component / data shaping:** Generalize Markbook's existing `buildMultiAyTrend` (`lib/markbook/insights-compare.ts`) into a **shared relative-axis series builder** that takes `{ periodIndex, periodLabel, ayCode, value }[]` and returns `MultiSeriesTrendChart`'s `{ data, series }` (one series per AY). Render via the existing **`MultiSeriesTrendChart`** (already a multi-line recharts chart with a legend). A small extension lets a series carry an AY-role so the compared AY draws dashed/muted.

## Pattern C — Delta-first KPI

For metrics that are a **single number per AY** (no series), the thing being compared is the **change** — so make it the hero, not a caption.

**Visual treatment:**

- The headline value stays the hero (serif, tabular-nums, §7).
- A prominent **delta chip** directly beneath: signed value + direction arrow.
- Colored by **good/bad**, not by up/down: mint (`§9.3` healthy recipe) when the change is favourable, destructive when not.
- A `vs {compareAy} · {priorValue}` line replacing the old buried subtext.

**Headlines to convert:** Attendance §1 rate · Records §1 enrolled · Admissions §1 applications + conversion · Markbook §1 top-band.

**Component:** a shared **`ComparisonKpiCard`** (or a `delta` slot added to the existing `MetricCard`) taking `{ value, compareValue, compareAy, direction: 'higherIsBetter' | 'lowerIsBetter', format }`. It derives the delta, arrow, and tone; direction is per-metric (attendance/enrolled = `higherIsBetter`; e.g. withdrawals = `lowerIsBetter`). Reuses the existing `growthDelta` / `computeDelta` math (`lib/dashboard/growth.ts`). When no compared AY exists, it degrades to the plain value (no chip).

## Data layer

No new DB work — the data is already loaded; it's rendered differently.

- **Trends:** per-AY series either already exist (Markbook) or are a light aggregation of data already loaded — the per-term attendance rollup, per-month admissions/records counts. Each module's insights-compare loader returns `{ periodIndex, periodLabel, ayCode, value }[]`; the shared builder reshapes it.
- **Headlines:** the current + compared scalars are already fetched (they feed `growthDelta` today); only the rendering changes.

## Architecture / units

- `lib/dashboard/insights-trend.ts` (new, pure, unit-tested) — the shared relative-axis series builder generalized from `buildMultiAyTrend`.
- `components/dashboard/insights/comparison-kpi-card.tsx` (new) — the delta-first KPI card.
- `components/dashboard/charts/multi-series-trend-chart.*` — extended so a series can render as the muted/dashed "compared AY".
- Per-module insights-compare loaders gain a `*TrendByPeriod(selectedAy, compareAy)` sibling where one doesn't already exist (Attendance per-term rate, Admissions per-month intake, Records per-month velocity).
- The four insights `page.tsx` files swap their headline `MetricCard`s for `ComparisonKpiCard` and their single-AY trend charts for the overlaid `MultiSeriesTrendChart`.

Each unit has one job, a typed interface, and is independently testable.

## Visual design

All line styling, the delta-chip design, legend, and tooltip are designed at build under the **`frontend-design`** + **`ui-ux-pro-max`** skills (per `always-do-first.md`), grounded in the binding design system (`docs/context/09-design-system.md` + `09a`): semantic color (§9 — tone by meaning), `ChartLegendChip` legends (§10), serif + tabular-nums KPI headlines (§7). No raw hex / `slate-*` / `gray-*` (Hard Rule #7).

## Testing

- **Series builder** (pure) — unit test: two AYs with different calendar dates align on the same term/month index; absent periods become gaps.
- **Delta-KPI tone/sign** — unit test per `direction` (favourable → mint, unfavourable → destructive; sign + arrow correct).
- **Component tests** (Vitest + jsdom + Testing Library) — `ComparisonKpiCard` renders both AYs; a converted insights section renders two series + a legend naming both AYs.
- `npx tsc --noEmit` clean + `npx next build` clean + a manual happy-path check on each insights page comparing AY2026 ↔ AY2025.

## Rollout

One feature branch (`feat/insights-comparison-readability`); shared primitives first (series builder + `ComparisonKpiCard` + chart extension), then convert page-by-page (Attendance first — the reported pain — then Admissions, Records, Markbook), verifying each before the next.
