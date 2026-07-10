# Insights Pages Simplification — Phased Fix Plan

## Context

The four module Insights pages (Admissions "Enrollment Health", Attendance "Attendance Health", Markbook "Academic Performance", Records "Retention & Population" — KD #140–143) have grown bloated and partly dishonest. Four parallel adversarial reviewers judged every section against five criteria: **(A)** answers the module's governing question, **(B)** data a real user (Joann, admissions team, school admins) actually consults, **(C)** honest on **production** data (not the seeded AY9999 that masks hollow columns), **(D)** right chart representation, **(E)** not a duplicate of the module's main dashboard.

**Headline findings (verified against source):**

- Every page ends on a permanently-empty `BuildingHistoryCard` "seasonality" placeholder.
- Admissions' diagnostic centerpiece ("Why don't they enroll?" donut) is 100% driven by `applicationTerminalReason` — **0/490 in prod** → structurally empty on real data. Same class: time-to-enroll (`enrolledAt` only stamps going forward, migration 075) and the Takeaways "needs follow-up" bullet (`applicationUpdatedDate` 0/490 → flags the entire pipeline).
- Records' movement trend buckets months by audit-row `created_at` (`lib/sis/movements.ts:433,459`), so the backfilled AY2025 comparison overlay is **fabricated seasonality** (whole year piles into the backfill month) — and the uncommitted `TrendDeltaCaption` promotes that fabrication to a 24px serif headline.
- Markbook's uncommitted +71-line change put ~10 subject series (≈40 bars) through `GroupedBarChart`'s 5-color palette (guaranteed hue collisions) and hand-rolled ~50 lines of delta math (`page.tsx:266–309`) beside the tested `summariseAyTrend` helper the same changeset created.
- Heavy dashboard duplication: attendance "Late incidents" rendered 3× across surfaces, records "Withdrawals" 4×, markbook velocity + publication-coverage and attendance sections-table are verbatim dashboard reruns.
- The **new uncommitted shared primitives are all keepers**: `chart-primitives.ts`, `AyComparisonLineChart` (endpoint labels, dashed-grey comparison, zero-line), `GroupedBarChart` (correct for ≤5 series), `TrendDeltaCaption` + `lib/dashboard/trend-delta.ts` (honest null-guarded delta). The defects are in per-page **usage**, not the primitives.

**User decisions:** hollow-but-will-fill sections → **auto-hide until data exists** (render nothing, self-heal when capture starts). Dashboard duplicates → **cut all** (Dashboard = today, Insights = over time).

**Chart-form rules applied (dataviz skill):** movement/trend → line, not grouped bars; >5 series → top-N by movement, never cycled hues; ranked part-to-whole → sorted bars, not donuts; truncated y-axis legal on lines, not bars; single scalar → stat tile, not a section.

---

## Branch & hygiene

- Branch `feat/insights-simplification` off `main`, carrying the in-flight working-tree changes. First commit = the kept shared primitives + existing page swaps as the base; phases land as separate commits.
- **Do NOT commit** the unrelated untracked noise: `scripts/backfill/*`, `grade-skill-result/`, `.claude/skills/`.
- Implementation session MUST invoke `frontend-design:frontend-design` before any JSX (always-do-first rule) and consult the dataviz skill references for chart specifics. Design system 09/09a is binding; plain-English copy throughout.
- First implementation step: materialize this plan as `docs/superpowers/specs/2026-07-10-insights-simplification-design.md` per repo convention.

## Files touched

- `app/(admissions)/admissions/insights/page.tsx`
- `app/(attendance)/attendance/insights/page.tsx`
- `app/(markbook)/markbook/insights/page.tsx`
- `app/(records)/records/insights/page.tsx`
- `lib/sis/records-insights.ts` (backfill-resolution guard)
- `lib/admissions/insights-funnel.ts` (sort conversion-by-level by rate)
- `lib/markbook/insights-compare.ts` (top-5-by-movement selection; stale comment)
- DELETE: `components/dashboard/charts/multi-series-trend-chart.{tsx,client.tsx}`, `__tests__/dashboard/multi-series-trend-muted.test.tsx` (orphaned — verified zero page imports remain)
- Tests under `__tests__/dashboard/`, `__tests__/admissions/`, `__tests__/sis/` as noted per phase

---

## Phase 1 — Cuts & dedup (pure deletions, all four pages)

**Admissions** (10 sections → ~5):

- Cut the "Cancellations with a reason" MetricCard from §1 (hollow `terminal.total`).
- Cut §3.1 enrolee-type conversion table (returning students re-enrol ~100% structurally; nobody acts on it).
- Cut the Takeaways `InsightsPanel` section (same `admissionsInsights` engine already mounted on `/admissions`; its staleness bullet flags the whole pipeline on prod). Inline `RecommendationCallout`s per section keep serving the narrative role.
- Cut the "When do applications peak?" seasonal placeholder.

**Attendance** (7 sections → 4):

- §1: keep the attendance-rate anchor tile (+ compareAy badge); cut Late + Absences tiles (verbatim `/attendance` dupes).
- Cut §4 "Which classes are below average?" table entirely (verbatim dupe of `AttendanceBySectionCard`, no over-time angle).
- §5: keep the A/EX mix split-bar (genuinely diagnostic, new); cut the EX-reason donut (dupes `/attendance` `ExReasonDrillCard`) and the third "Late incidents" tile.
- Cut §7 seasonal placeholder.

**Markbook** (~8 chart units → ~4):

- §1c: cut the primary grade-distribution bar-list (dupes `/markbook` `GradeDistributionDrillCard`); keep only the compare-AY overlay, auto-hidden when the compare AY has no data (no `BuildingHistoryCard`).
- §3: cut the grading-velocity `TrendChart` (dashboard's version is strictly richer) and the publication-coverage bar-list (dupes `PublicationCoverageDrillCard`); keep CR KPIs + per-term sheets-locked card (the one throughput cut the dashboard lacks).
- Cut the trailing seasonal placeholder.

**Records** (6 sections → ~4):

- §1: keep Enrolled tile **with** YoY delta (the one growth signal `/records` lacks); cut Levels-in-use + Withdrawals tiles.
- §3: cut all 4 movement MetricCards (byte-for-byte `/movements` stat cards); keep only the net-movement line.
- §6: cut the reasons `DonutChart` and the per-level withdrawals bar-list (both are marginals of the stacked bar) — subject to the Phase 3 fallback below.
- Records has no separate seasonal card; §4 `BuildingHistoryCard` retention states remain (they're genuine building-history, addressed in Phase 2).

## Phase 2 — Representation fixes

- **Markbook §1b (the big one):** replace `GroupedBarChart` (10 series) with `AyComparisonLineChart` limited to the **top 5 subjects by |first→latest term movement|** (selection helper in `lib/markbook/insights-compare.ts`, unit-tested; remaining subjects noted in the section description, not plotted). Delete the inline `averageAvgGrade`/`trendCaptionDelta` math (`page.tsx:266–309`) and call `summariseAyTrend` from `lib/dashboard/trend-delta.ts`. Keep `TrendDeltaCaption`.
- **Attendance §2:** swap `GroupedBarChart` → `AyComparisonLineChart` (a movement question wants a line; the [80,100] domain is legal on a line where it exaggerates on bars). Keep `TrendDeltaCaption` + the existing null-guarded delta.
- **Admissions §2.1 conversion-by-level:** replace the P1→S4-ordered table with a **sorted CSS bar-list by conversion % (worst at top)** — same bar-list pattern already on the page; keep the callout.
- **Admissions §3.1c referral:** sort rows by conversion % and make the inline bar encode conversion (currently encodes volume while the story is conversion).
- **Records §2 population-by-level:** render only when a `compareAy` is chosen, as a `GroupedBarChart` (selected vs compare per level — its correct ≤5-series use... levels >5, so instead: keep the CSS bar-list but add a dashed-grey compare value per row). Without compareAy the section auto-hides (snapshot dupes the dashboard's `LevelDistributionDrillCard`).
- **Records §4 retention:** default `compareAy` to the prior AY on first load so the marquee section doesn't open as a placeholder.

## Phase 3 — Data-honesty guards (auto-hide)

- **Admissions "Why don't they enroll?":** render nothing when `terminal.total === 0` (today's empty-card explainer goes away; the section appears once reasons are recorded).
- **Admissions "How long does enrolment take?":** render nothing when `sampleSize === 0`; when populated, render as a stat tile inside §1's headline row rather than a full section.
- **Records §6 controllability:** when withdrawal reasons are all Unspecified, hide the "% preventable" banner + act callout + stacked bar and fall back to the simple withdrawals-per-level bar-list (the honest representation of what's actually known); when reasons exist, show stacked bar + banner (per-level list stays cut).
- **Records §3 movement overlay:** in `lib/sis/records-insights.ts`, suppress the compare-AY overlay and the caption delta when the comparison AY's events span ≤1 distinct month (the backfill signature — no real monthly resolution). Pure helper, unit-tested.
- **Attendance compare spine:** already honest (`summariseAyTrend` null-guards; rate badge degrades to "Pick a comparison year") — no change beyond Phase 1 cuts.

## Phase 4 — Cleanup, tests, verify

- Delete orphaned `MultiSeriesTrendChart` (wrapper, client, test); fix the two stale comments (`lib/markbook/insights-compare.ts:61`, `lib/sis/records-insights.ts:639`). `ChartSkeleton kind="multi-trend"` stays (used by `AyComparisonLineChart`).
- Tests: keep/extend `__tests__/dashboard/{ay-comparison-line-chart,grouped-bar-chart,trend-delta}.test.*`; add unit tests for the top-5-by-movement selector, the ≤1-distinct-month backfill guard, and the conversion-sorted level rows.
- Run `/sync-docs` at wrap-up (KD #140–143 gain update notes; dev-plan snapshot).

## Verification

1. `npx vitest run` — full suite green (~900 tests + new).
2. `npx next build` — clean compile.
3. Manual smoke on all four `/​*/insights` pages against the seeded AY9999 (full-experience path) **and** with a compare-AY unset / hollow-data path to confirm auto-hide renders nothing (no orphaned headers, no empty cards).
4. Recount charts per page (target: Admissions ~2, Attendance ~1–2, Markbook ~4, Records ~3–4 — all comfortably under the ≤8 budget).
5. Design-system pre-delivery checklist (09 §10): no raw colors, empty state for every remaining data region, keyboard pass, 375–1440 smoke.
