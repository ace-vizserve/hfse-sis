# Insights Bento Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the 4 module Insights pages (Attendance, Admissions, Records, Markbook) in the reference-kit bento visual language that was designed and locked as static HTML mockups this session, using real design-system tokens and each page's existing real data/loaders — no new queries, no data-shape changes.

**Architecture:** A shared `components/dashboard/insights/bento/` primitive library (bento grid + card, gradient stat card, segmented "Vehicle overview" bar, ranked "Top Services" bar (+ side-by-side legend variant), growth/rate dial, "Total Revenue" pill-bar chart, Gantt timeline, "Project List" row, "Sales performance" bar-stack, delta-pill before/after row, badge+tooltip) is built once, then each page's `page.tsx` is rebuilt to compose from it, staying byte-faithful to its locked mockup file. Real loaders/data plumbing are untouched — this is a presentation-layer rebuild only.

**Tech Stack:** Next.js 16 App Router (RSC), Tailwind v4 tokens from `app/globals.css` (brand-indigo/navy/sky/mint/amber, ink/ink-2..5, hairline, muted, destructive — Hard Rule #7, no raw hex in `app/` or `components/`), shadcn primitives where they fit (`Card` is NOT reused — the bento card is visually distinct, custom by design per the locked mockups), Vitest for any new pure-logic helpers.

## Global Constraints

- Hard Rule #7 (CLAUDE.md): no raw `#rrggbb`/`oklch()`/`slate-*`/`zinc-*`/`gray-*` in `app/` or `components/` — every colour in the mockups (e.g. `#213098`, `#e0483a`) maps to a real token: `--color-brand-indigo`, `--color-destructive`, etc. (confirmed 1:1 in `app/globals.css:239-255`).
- No new database queries, no new loader functions, no changed data shapes. Every number/section in each locked mockup already traces to a real value the existing `page.tsx` already computes — the mockups were built from the real loaders per this session's own mockup-vs-real audits.
- Radial/full-ring gauges (`RadialGaugeChart`) are NOT to be introduced or kept for any Insights section this plan touches — the dashed-tick semi-circle dial and ranked bars are the accepted substitutes (established this session for Attendance and carried through Markbook's grade-band section).
- Each page's locked mockup file is the literal spec for that phase — cross-reference it for exact section order, card widths (bento `c-N` spans), copy, and which anatomy each section uses. Do not improvise beyond what the mockup shows; if something in the real `page.tsx` has no mockup equivalent (e.g. a conditional empty-state), preserve the real page's existing behaviour for it.
- `npx next build` must stay clean at the end of every phase (workflow.md). Existing test suite must stay green.
- Locked mockup files (read-only reference, do not edit):
  - Attendance: `<scratchpad>/insights-mockup-v4.html` — https://claude.ai/code/artifact/ab0a8e65-e019-4f27-a03d-a4ee6f42e040
  - Admissions: `<scratchpad>/insights-mockup-admissions.html` — https://claude.ai/code/artifact/a75b6caa-571d-45ef-a76e-4c0d7684ae4a
  - Records: `<scratchpad>/insights-mockup-records.html` — https://claude.ai/code/artifact/1add452c-8513-4943-8758-b4b003067ad2
  - Markbook: `<scratchpad>/insights-mockup-markbook.html` — https://claude.ai/code/artifact/fb931b70-7cf2-43de-9894-4d2287c06601
  - (`<scratchpad>` = `C:\Users\Ace\AppData\Local\Temp\claude\c--Users-Ace-OneDrive---HFSE-International-School-Desktop-hfse-vizserve-projects-hfse-markbook\aebe5fa0-94e1-410b-968e-c4a4daa13e23\scratchpad\`)

---

## Phase 0 — Shared bento primitive library

**Files:**

- Create: `components/dashboard/insights/bento/bento-grid.tsx`, `bento-card.tsx`, `stat-card.tsx`, `segmented-bar.tsx` (Vehicle overview), `ranked-bar.tsx` (Top Services, incl. side-legend layout), `rate-dial.tsx` (dashed-tick semicircle), `pill-bar-chart.tsx` (Total Revenue), `gantt-timeline.tsx`, `project-list-row.tsx`, `bar-stack.tsx` (Sales performance barcode), `delta-bar-row.tsx` (before/after pair), `badge-tooltip.tsx`.
- Create: `components/dashboard/insights/bento/tokens.ts` (shared colour-ramp helpers: quality ramp destructive→amber→sky→mint, controllability colours, etc. — pure functions, unit-tested).
- Test: `__tests__/dashboard/insights-bento-tokens.test.ts`.

Each primitive takes typed props (no hardcoded copy/numbers) and renders using only design-system tokens. Reference the corresponding CSS class block in whichever mockup file first introduced that anatomy (documented in each mockup's own comments — e.g. `.vo-*` for segmented-bar, `.mv-*` for pill-bar-chart, `.nb-*`/`.nb-legend` for ranked-bar, `.gt-*` for Gantt, `.dial-wrap` for rate-dial).

- [ ] Build `bento-grid.tsx` / `bento-card.tsx` (12-col grid + `c-N` span wrapper, matches `.bento`/`.card`/`.c-N` in every mockup)
- [ ] Build `stat-card.tsx` (gradient icon tile + value + delta pill + date-pill, matches `.tile`/`.stat-val`/`.pill`/`.date-pill`)
- [ ] Build `segmented-bar.tsx` (tick labels + segmented bar + icon list, matches `.vo-*`)
- [ ] Build `ranked-bar.tsx` (numbered bar, label-inside-fill, optional side-by-side legend, matches `.nb-*`/`.nb-legend`/`.nb-layout`)
- [ ] Build `rate-dial.tsx` (16-tick dashed semicircle + caption + 2 icon-tile rows, matches `.dial-wrap`)
- [ ] Build `pill-bar-chart.tsx` (dot legend + dashed axis + zero-anchored pill pairs, matches `.mv-*`)
- [ ] Build `gantt-timeline.tsx` (month axis + dashed gridlines + per-row pill spans, matches `.gt-*`)
- [ ] Build `project-list-row.tsx` (icon + name + subtitle/fraction, matches `.pl2-*`)
- [ ] Build `bar-stack.tsx` (headline + divider + N-column barcode, matches `.sp-*`/`.tv-*`)
- [ ] Build `delta-bar-row.tsx` (from/to thin bars + delta pill, matches `.dl2-*`)
- [ ] Build `badge-tooltip.tsx` (hover pill+tooltip, matches `.tooltip-wrap`/`.tooltip-box`)
- [ ] `npx tsc --noEmit` clean, `npx vitest run __tests__/dashboard/insights-bento-tokens.test.ts` green
- [ ] Commit

**Review gate:** task-reviewer checks every primitive against its mockup CSS block (colours = real tokens only, spacing/typography matches) + code quality. Fix loop until clean.

---

## Phase 1 — Attendance Insights

**Files:** Modify `app/(attendance)/attendance/insights/page.tsx`. No new components beyond Phase 0's library (Attendance's mockup is the one Phase 0 was primarily modelled on).

- [ ] Rebuild the page JSX section-by-section against `insights-mockup-v4.html`, keeping every existing loader call and computed value as-is — swap only the rendering layer.
- [ ] Verify every real conditional (`BuildingHistoryCard`, empty states, `hasMonthlyResolution` guards, `isCurrentAy` badges) still fires correctly — the mockup used illustrative always-populated data, the real page must keep its honesty guards.
- [ ] `npx next build` clean; manual check in browser against both a populated and a sparse/no-compare-AY state.
- [ ] Commit

**Review gate:** task-reviewer diffs rendered output against the mockup screenshot/HTML section by section, flags any token/spacing drift or dropped real-data guard.

---

## Phase 2 — Admissions Insights

**Files:** Modify `app/(admissions)/admissions/insights/page.tsx`.

- [ ] Rebuild against `insights-mockup-admissions.html`: stat row, Population... (N/A for Admissions — use the real section list: intake trend pill-chart, growth dial, where-applicants-stall segmented bar w/ biggest-leak badge+tooltip, referral channels, conversion-by-level ranked-bar+side-legend.
- [ ] Preserve real conditionals (avg-days-to-enrol sample-size gate, etc.)
- [ ] `npx next build` clean; manual check.
- [ ] Commit

**Review gate:** same as Phase 1.

---

## Phase 3 — Records Insights

**Files:** Modify `app/(records)/records/insights/page.tsx`.

- [ ] Rebuild against `insights-mockup-records.html`: headline stats, population-by-level tabs (Primary/Secondary → "Total visitors" per-level columns), student movement pill-bar chart, retention dial + ranked-bar cohort list, late-enrollees (Project List + Gantt), withdrawal reasons (ranked-bar+legend) + withdrawal-by-level (segmented bar).
- [ ] Preserve every real auto-hide/backfill guard (`hasMonthlyResolution`, compareAy-gated sections, empty-roster states) — these are load-bearing honesty rules from KD #140/#141, not decorative.
- [ ] `npx next build` clean; manual check with and without a compare AY selected.
- [ ] Commit

**Review gate:** same, with explicit sign-off that no KD #140/#141 honesty guard was dropped.

---

## Phase 4 — Markbook Insights

**Files:** Modify `app/(markbook)/markbook/insights/page.tsx`.

- [ ] Rebuild against `insights-mockup-markbook.html`: 2 throughput-first stat cards... — per the FINAL locked state: 3 throughput stat cards at top, subject-trend chart (grouped-by-term, new chart type not in Phase 0's list — build inline or promote to Phase 0 if reused), watch/by-level pair, regression pill-bar chart, sheets-locked-per-term bar chart at bottom.
- [ ] Preserve every real narrative guard (`showRegression`, `showWorstWatch`, magnitude thresholds, tie guards) — the mockup's callouts/badges must stay conditionally rendered exactly as the real page already computes them.
- [ ] `npx next build` clean; manual check.
- [ ] Commit

**Review gate:** same.

---

## Phase 5 — Whole-branch review

- [ ] Dispatch the final code-reviewer over the full diff (all 5 phases) on the most capable available model.
- [ ] Confirm Hard Rule #7 compliance repo-wide for touched files (`rg` sweep for raw hex/oklch/slate/zinc/gray in the touched `app/`/`components/` paths).
- [ ] Full `npx next build` + full test suite run.
- [ ] Use `superpowers:finishing-a-development-branch` to close out.
