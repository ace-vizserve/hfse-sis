# Module Insights — design spec (replaces "Compare")

**Date:** 2026-06-10
**Status:** Design — pending implementation plan
**Supersedes:** the per-module `compare` feature (KD #78/#79/#115)

## Context

The `compare` feature is a static side-by-side KPI grid: pick periods, read raw numbers, draw your own conclusion. It doesn't interpret anything or speak to a module's actual purpose, and (for the flexible modules) its AY×month model was confusing. The school's real questions are diagnostic and trend-based — _Are we growing or shrinking? Where/why are we losing students? What's trending?_ — which a scoreboard can't answer.

This replaces `compare` with **Insights**: a per-module, purpose-driven surface that answers "what has been happening over time, and what does it mean," for the modules that have enough analytical depth to justify it.

## Core principle — Dashboard vs Insights

The dividing line that decides what goes where (and which modules get an Insights page at all):

|                   | **Dashboard** (exists)                                            | **Insights** (new)                                                                       |
| ----------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Question          | _What is happening today?_                                        | _What has been happening over time?_                                                     |
| Horizon           | Now / current term                                                | Across terms, AYs, cycles                                                                |
| Nature            | Operational snapshot + to-dos                                     | Trend + diagnosis ("where" + "why")                                                      |
| Example (Records) | 312 active · 5 pending section assignments · 3 recent withdrawals | Withdrawals up 15% · retention dropped in Secondary · late enrolments concentrated in T2 |

**"Compare" is retired entirely.** The 4 deep modules get Insights in its place (the old side-by-side comparison is subsumed by richer over-time trend views). The 2 thin modules lose the surface — their dashboard already _is_ their insight.

## Scope

**Gets an Insights page (real diagnostic depth, distinct from the dashboard):**

- **Admissions → Enrollment Health** — funnel drop-off + cancellation/withdrawal causes. School's core focus; richest data.
- **Records → Retention / Population** — headcount growth, movement, retention, attrition causes. Naturally accumulates history.
- **Attendance → Attendance Health** — rate trend, chronic absentees, absence causes (EX-reason mix).
- **Markbook → Academic Performance** — grade distribution, GA trend, subject/section performance, grading throughput.

**No Insights page (too operational/thin — dashboard already covers the actionable signal):**

- **P-Files** — a repository/checklist; value is all "expiring soon → chase" (today). No causal depth.
- **Evaluation** — submission rate + who's behind, already the dashboard chase cards (KD #126). No causes captured, nothing to diagnose.

For P-Files + Evaluation: **remove the compare surface entirely** (route + nav), dashboard stands alone.

## Shared framework

Every Insights page composes from the same skeleton so the modules feel consistent and the code is reused:

1. **Headline** — the module's one purpose metric + plain-English direction.
2. **Trend over time** — the core outcome charted across months/terms/AYs.
3. **Diagnosis (where + why)** — the module-specific breakdown that points at a cause.
4. **Watchlist** — specific rows to act on (drill-linked).
5. **Takeaways** — narrative bullets.

**Reuse, not new plumbing.** Builds on existing infrastructure: per-module `lib/<module>/dashboard.ts` range/velocity loaders, `lib/<module>/drill.ts` + the drill-sheet framework (KD #56), the `lib/dashboard/insights.ts` narrative engines, the chart wrappers (`components/dashboard/charts/*`), and `lib/sis/movements.ts` (Records). The net-new work is _synthesis_ (aggregating cause data, framing takeaways), plus the multi-period/multi-AY trend queries.

**Data honesty (built in).** The _diagnostic_ layer (trend + where/why, from data already captured) ships now. The _seasonal-baseline + light-prediction_ layer ("this month historically averages X") is wired but shows a "building history…" state until ≥3 real cycles exist, then fills in automatically — so no confidently-wrong numbers at go-live. Anything below tagged **[now]** is buildable from existing data; **[needs ≥N cycles]** waits for history.

## Per-module specs

### Admissions — Enrollment Health

**Answers:** Are we enrolling more or fewer? Where in the funnel do applicants drop? Why do they cancel/withdraw?

- **Intake trend** — applications + enrolments over time (by month/cycle). **[now]**
- **Funnel conversion + biggest drop-off stage** — where applicants stall/exit. **[now]** (reuses conversion funnel + pipeline-stage breakdown)
- **Cancellation / withdrawal causes** — top `applicationTerminalReason` + withdrawal reasons, **by level** and over time. **[now]** (the key diagnostic — data captured per KD #111, never aggregated)
- **Time-to-enroll trend** + **referral-source effectiveness**. **[now]**
- **Early-bird pace vs last cycle** + **seasonal "applications usually peak in…"**. **[needs ≥2–3 cycles]**

### Records — Retention / Population (uses the user's section breakdown verbatim)

**Answers:** Are we growing or shrinking? How many withdrew, and which levels? How many late enrollees / transfers? What's our retention?

- **Student Population** — current headcount · previous-AY headcount · growth %. **[now, needs ≥2 AYs for growth]**
- **Student Movement** — new enrollees · withdrawals · transfers · re-enrollees, over time. **[now]** (from `lib/sis/movements.ts`)
- **Retention** — returned students · did-not-return · retention % (cross-AY by `studentNumber` via `lib/sis/records-history.ts`). **[now, needs ≥2 AYs]**
- **Late Enrollees** — trend · by level · by term. **[now]** (`late_enrollee_term_number` / `enrollment_date`, KD #68/#111)
- **Withdrawal Analysis** — top withdrawal reasons · by AY · by level. **[now]** (`withdrawal_reason`, KD #111)

### Attendance — Attendance Health

**Answers:** Is attendance trending up or down? Who's chronically absent? Why are they absent?

- **Attendance-rate trend** + **absenteeism trend**. **[now]**
- **Chronic-absentee watchlist** (drill-linked). **[now]** (top-absent rollup)
- **Absence causes** — EX-reason mix (MC / vacation / compassionate), late patterns. **[now]**
- **Leave-quota risk** — students near/over VL or compassionate quotas. **[now]**
- **Seasonal "attendance dips in…"**. **[needs ≥2 cycles]**

### Markbook — Academic Performance

**Answers:** How is performance trending? Which subjects/sections lag? Are grades in on time?

- **Grade distribution + General-Average trend** across terms. **[now]** (subject-performance trend exists, KD #115)
- **Subject / section performance** — who's lagging. **[now]**
- **Award distribution** (Bronze/Silver/Gold spread). **[now]**
- **Grading throughput** — change-request volume + decision time, lock/publish readiness across terms. **[now]**

## Routing / nav changes

- The 4 deep modules: `/<module>/compare` → **`/<module>/insights`** (route + sidebar label; old `compare` URL redirects to `insights`).
- P-Files + Evaluation: **remove** the compare route + its sidebar entry (redirect old URL → the module dashboard).
- `parseCompareParams` / `buildCompareCells` / `CompareToolbar` / `CompareGrid` are absorbed into the Insights "trend" + (optional) period-comparison components rather than deleted outright — reuse what fits.

## Phasing / build order

1. **Admissions Insights** — first, establishes the shared `lib/dashboard/insights-framework` + the page skeleton (the template every other module copies). Deepest data, highest value.
2. **Records Insights** — the user's priority; the section spec above is the most concrete.
3. **Attendance Insights**, then **Markbook Insights** — same skeleton.
4. **Seasonal-baseline + prediction layer** — a later phase, switches on per-module once enough cycles exist.

Each module is its own plan → implementation cycle (one PR per module), so this never has to land as one mega-change.

## Non-goals

- No Insights for P-Files or Evaluation.
- No forecasting/ML at launch — only data-grounded trend + diagnosis now; seasonal baselines arrive with history.
- No new operational/behavioral flows — Insights is read-only analysis; it changes nothing about how data is entered.
- No new data plumbing where an existing loader/drill/movements feed already provides it.

## Open decisions (confirm at spec review)

1. **Per-module page titles** — "Enrollment Health / Retention / Attendance Health / Academic Performance" — wording OK?
2. **P-Files + Evaluation compare** — confirm full removal (vs leaving a plain grid). Lean: remove.
3. **Build order** — Admissions first as template, or Records first (most-detailed spec)? Lean: Admissions (sets the framework), Records second.

## Verification (per module, at build time)

- `npx tsc --noEmit` + `npx next build` clean.
- Each Insights section renders from real seeded data (test AY); trend/diagnosis numbers reconcile with the dashboard's "today" figures where they overlap (e.g. Records current headcount == dashboard active count).
- `[needs cycles]` sections show the honest "building history…" state when <N cycles exist (verify with the 1–2 seeded AYs).
- Old `/<module>/compare` URLs redirect correctly; removed surfaces (p-files/eval) redirect to dashboard.
