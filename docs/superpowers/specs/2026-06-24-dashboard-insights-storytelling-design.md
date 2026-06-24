# Dashboard & Insights Storytelling Pass — Design Spec

**Date:** 2026-06-24
**Branch:** `feat/insights-comparison-readability` (stacked)
**Status:** approved design, pre-plan

## Goal

Make every operational dashboard and Insights page **read as a clear story** — a viewer should grasp _the single most important thing_, _why_, and _what to do_ without decoding axes. Apply the Maven "storytelling with data" framework (finding-stating titles, surfaced recommendations, decluttering, F-pattern flow) **adapted to a data-dense admin tool** and **grounded in the binding design system (09/09a)** — not marketing-y, no new visual language.

## Surfaces (10)

- **4 Insights pages:** Admissions, Records, Attendance, Markbook.
- **6 module dashboards:** Admissions, Records, Attendance, Markbook, P-Files, Evaluation.
- **Excluded:** `/sis` hub (navigation cards, not a data story); P-Files + Evaluation Insights (don't exist, KD #140).

## Out of scope

- No DB schema changes / migrations. No new loaders or metrics (we narrate the data we already compute).
- No new chart components unless a targeted-B reflow genuinely needs one (default: reuse existing).
- Not a re-audit of correctness/analytics — that's done (Phase 1/2/3). This is **presentation only**.

## The pattern (every surface)

Built on existing primitives — `InsightsSection` (eyebrow/title/description), `MetricCard`, `DashboardHero`, `InsightsPanel`/`ActionList`, `ChartLegendChip` — using their title/description/callout slots well. Design system 09/09a is binding (Hard Rule #7: semantic tokens only).

1. **Finding-stating titles.** Section + chart titles state the takeaway, not the axis. _"Funnel drop-off"_ → _"Most applicants drop at Assessment."_ Eyebrow keeps the neutral category; the title carries the finding.
2. **Surfaced recommendation line.** Where a recommendation is already computed (biggest leak, top controllable loss, intervene-list, subject-Δ, the dashboard to-dos), render a one-line _"what this means / do this"_ near the relevant element, in the §9.3 status tone (mint healthy / amber watch / destructive act).
3. **One headline per surface** (top-left, F-pattern): the single most important thing right now, stated in plain English.
4. **Declutter + flow:** cut redundant labels / duplicate metrics / chart noise; order high-level → granular; light enclosure to group a "chapter."

## Two voices

- **Dashboards = "what needs you today."** Lede = the top priority/number. The `PriorityPanel`/`ActionList` to-dos _are_ the recommendations — sharpen their copy to read as directives ("Lock 3 overdue sheets", not "3 sheets unlocked").
- **Insights = "trend → why → what to do."** Lede = the headline finding/trend. Section titles state the diagnosis; the computed recommendations become the explicit "what to do."

## The non-negotiable: narrative is **derived from data, never hardcoded**

Every finding-stating title and recommendation line is **templated from the actual computed value at render time** — _"Most drop at {biggestLeakStage}"_, _"{topControllableReason} is your biggest fixable loss, concentrated in {level}"_. If a signal is genuinely neutral (flat trend, no clear leak, healthy across the board), the copy says **that** — we never manufacture a story the data doesn't support. A storytelling title that can go stale or lie is a defect. This is the guardrail.

**Honesty rules:**

- Superlatives ("most", "biggest", "worst") must be backed by the computed extreme, with a tie/empty fallback.
- A recommendation line renders only when the underlying signal crosses a meaningful threshold; otherwise a neutral "looks healthy" / "nothing flagged" state.
- No claim about a period/segment the data doesn't cover.

## Per-surface narrative map

Drawn from the metrics + recommendations already computed (post Phase 1/2/3). Each surface gets: a **lede**, **finding-titles** on its sections, and **recommendation lines** off the computed extremes.

### Insights

| Surface        | Lede                                      | Key finding-titles / recommendation sources                                                                                                 |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Admissions** | conversion rate + the biggest funnel leak | deep funnel → biggest-leak stage; conversion-by-level → worst level; referral conversion → best/worst channel; terminal reasons → top cause |
| **Records**    | retention % + the top controllable loss   | controllability takeaway (top controllable reason × level); per-level retention → worst-returning cohort; reason×level                      |
| **Attendance** | attendance rate + the intervene count     | intervene/monitor split → "N students need a truancy follow-up"; sections-to-watch → worst section; A/EX mix; quota risk                    |
| **Markbook**   | the most-regressed / weakest subject      | subjects-to-watch (worst subject×level); term-Δ → biggest regression; failing tail → worst tail subject                                     |

### Dashboards (lede = top priority/to-do)

| Surface        | Lede / directive source                                        |
| -------------- | -------------------------------------------------------------- |
| **Admissions** | new applications to action + chase count (PriorityPanel)       |
| **Records**    | unsynced enrolled + docs-to-collect (chase strip / ActionList) |
| **Attendance** | today's unencoded sections / gaps (registrar)                  |
| **Markbook**   | pending change-requests + unlocked overdue sheets              |
| **P-Files**    | documents expiring / needing renewal (chase queue)             |
| **Evaluation** | outstanding write-ups + advisers behind                        |

(Exact ledes finalized per surface during build against the live loaders — never invented.)

## Targeted-B (reflow) candidates

Default is **A** (titles/recommendations/declutter, layout intact). Apply **B** (chapter regrouping / enclosure) only where a page genuinely needs it. Primary candidate: **Admissions Insights** — group its many sections into _"Demand & conversion" / "Who & why we lose" / "Channels & segments"_. Flag others per-surface during build; do not reflow speculatively.

## Rollout

1. **Template first — Admissions Insights** (freshest; the funnel is the cleanest finding-title example; the targeted-B candidate). Build A + its targeted-B.
2. **User reviews the template in the browser**, locks the pattern (titles voice, recommendation-callout treatment, enclosure).
3. **Roll the agreed pattern across the other 9** (3 insights + 6 dashboards), one per task, reusing whatever shared callout/lede helper the template establishes.

## Grounding & constraints

- Design system 09/09a binding; semantic tokens only (Hard Rule #7). Reuse existing primitives; introduce a shared "recommendation callout" / "lede" treatment only if it can be a thin, token-pure helper.
- Copy: plain English (school admins, not IT), active voice, name things by what the user controls; finding-titles true to the data.
- No DB changes; presentation/copy + light layout only.

## Verification

- `npx tsc --noEmit` clean; `npx vitest run` green (any narrative helper with branching logic — extreme/tie/empty/threshold — is pure + unit-tested).
- **Narrative-honesty check** per surface: confirm every finding-title + recommendation line is derived from a live computed value with a neutral fallback (grep for hardcoded claim strings — there should be none).
- **Visual pass** per surface (user, in the browser) — the only true test that it "reads like a story."
- `next build` clean at the rollout boundary.
