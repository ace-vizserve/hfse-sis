# Home page (`/`) — hierarchy & content redesign

**Date:** 2026-07-25
**Status:** Approved (mockups reviewed interactively via the brainstorming visual companion — no artifact file saved, session-local only)
**Amends:** `docs/superpowers/specs/2026-07-24-home-role-overview-design.md` (the original role-aware overview spec, shipped in commit range `aaf9a743..6854e9f8`). This spec does not change _what data_ appears — every source in the original spec's "Data sources — reuse vs. new" section is unchanged — it changes _how it's composed and worded_.

## Problem

Shipped and manually reviewed against real screenshots (all 4 roles). The complaint, verbatim: "it looks like a bunch of details put in there with no intent, just put together no layout. just to make look the page has contents in it." Concretely:

1. Every section (to-do, coming-up, KPI row, module cards) rendered as an identical white bordered box in a flat grid — nothing signaled which was more important.
2. The 3 quick-action buttons (solid gradient, repeated 3×) were visually the loudest thing on the page despite being the least important content (navigation, not information).
3. The module-card mini-chart mix (ring / dots / single-point sparkline) was visually inconsistent and some renders looked broken — the "ring" charts appeared as near-empty outlines at 96%/61%, and the attendance "sparkline" (a single data point, a known limitation already flagged in the original implementation's final review) rendered as a plain solid bar with no chart shape at all.
4. Every module card showed a lone percentage with no denominator, no time window, and no sense of whether the number was good or concerning — "34% Conversion," "92% Docs on file," "82% Sheets locked" carried no context.

## Goal

Two changes, addressed separately because they're genuinely different problems:

- **A. Hierarchy** — restructure the page so importance is visually legible: one clear hero section, everything else quieter and appropriately sized, not a flat grid of equal-weight boxes.
- **B. Content** — pair every lone percentage with the real fraction (or comparable context) it's computed from, using data these cards already fetch. No new queries.

## A. Hierarchy redesign

### Layout changes (top to bottom)

1. **Container gets a max-width** (~1040px, centered) — the original page had no width cap and stretched edge-to-edge on wide viewports, which flattened everything into one undifferentiated wide strip.
2. **Quick actions demoted** from 3 solid-gradient `Button` `default`-variant CTAs to plain text links (indigo, with the trailing `ArrowUpRight` icon retained) in a single row, with a hairline rule underneath separating them from the content below. They're navigation shortcuts, not the day's news — they should read as a quiet utility row, not the loudest element on the page.
3. **To-do becomes the page's hero**, rendered as a vertical timeline (dot + connecting line down the left edge) instead of a flat list of table-like rows. This is a real layout change to `TodoPanel`, not just a restyle:
   - Each item gets a dot (indigo; amber when its aging tone is `warning`/`destructive`) and a header line (module chip + relative timestamp, e.g. "requested 2 days ago" — reusing the existing `aging` data already computed by `lib/home/todos.ts`, just rendered as prose instead of a badge-only chip).
   - `kind: 'change-request'` items (school_admin only) get a **sub-card**: a light-muted inset panel showing the student name + "requested by {teacher}" line, with the aging badge and Approve/Reject actions inline — richer than the shipped flat-row treatment, but reuses the exact same `TodoCrActions` mutation component underneath (no change to the approve/reject behavior, KD #24/#41 unaffected).
   - `kind: 'review'` items stay a single line + "Review ›" link, no sub-card (they don't have a person/requester to show).
4. **To-do sits beside a sidebar column** (was: To-do beside "Coming up" alone). The sidebar now stacks **two** cards: "Coming up" (unchanged content) directly above a new **"Snapshot" card** that holds the same 3 KPI values the original spec's KPI row showed — moved out of a separate full-width row and into the sidebar, since 3 numbers in their own full-width strip were competing for the same visual rank as the hero.
5. **Module card grid drops from the original per-role column count to a flat 3-column grid** for every role that sees module cards (previously the grid used `cols-3`/`cols-5`/`cols-7` matching the exact card count — the wide `cols-7` row for school_admin/superadmin was the "wall of tiles" the complaint called out). 7 cards now wrap to 3 rows (3/3/1) instead of straining into one row.
6. **Module card mini-charts are unified onto one visual language: a labeled horizontal progress bar**, for every metric that is a percentage. The ring/dots/sparkline chart-kind mix from the original spec is retired entirely:
   - Every `Percentage`-shaped card (Admissions conversion, P-Files docs-on-file, Markbook sheets-locked, Attendance today's-rate, Evaluation submitted, SIS Admin AY-readiness) gets the same thin gradient progress-bar treatment.
   - Plain-count cards (Records enrolled) stay bare numbers, no bar — there's nothing to fill a bar with.
   - **This supersedes the original spec's "Module card content mapping" table** (which assigned sparkline/ring/dots/none per module). Read this spec's table below as the replacement, not an addition.

### Superseded: module card chart mapping

Original spec's table (sparkline for Attendance, ring for Markbook/Evaluation, dots for SIS Admin, plain for Admissions/Records/P-Files) is replaced with:

| Module                                         | Visual       | Why                                                                                                                                                                    |
| ---------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admissions (oversight roles)                   | Progress bar | It's a percentage (conversion)                                                                                                                                         |
| Admissions (academic_coordinator, operational) | Plain stat   | "New (7d)" is a count, not a percentage                                                                                                                                |
| Records                                        | Plain stat   | Enrolled headcount, not a percentage                                                                                                                                   |
| P-Files                                        | Progress bar | Percentage (docs on file)                                                                                                                                              |
| Markbook                                       | Progress bar | Percentage (sheets locked)                                                                                                                                             |
| Attendance                                     | Progress bar | Percentage (today's rate) — the single-point "sparkline" is retired, closing the final-review-flagged degenerate-chart issue for good rather than deferring it further |
| Evaluation                                     | Progress bar | Percentage (submitted)                                                                                                                                                 |
| SIS Admin                                      | Progress bar | AY readiness is a fraction (`complete`/`total`) — a progress bar communicates this at least as well as discrete dots, and keeps the whole grid visually consistent     |

## B. Content — pair every percentage with its real fraction

Every module card and Snapshot-sidebar stat that shows a lone percentage gains a second line: "`{numerator} of {denominator} {plain-English noun phrase}`". No new queries — every fraction below is already returned by the same loader call the original spec's Task 3/Task 2 already wired up; this is a copy change to the JSX, not a data change to `lib/home/*`.

| Stat                                       | Old copy                          | New copy                                                            | Source (already fetched)                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | --------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Markbook sheets locked                     | "82% · Sheets locked"             | "82% · 41 of 50 sheets locked"                                      | `MarkbookRangeKpis.sheetsLocked` / `.sheetsTotal` (both already on the object `lockedPct` is read from)                                                                                                                                                                                                                                                                                                                                           |
| Evaluation submitted                       | "61% · Submitted, this term"      | "61% · 55 of 90 write-ups submitted"                                | `EvaluationKpis.submitted` / `.expected` (both already on the object `submissionPct` is read from)                                                                                                                                                                                                                                                                                                                                                |
| P-Files docs on file                       | "92% · Docs on file"              | "92% · 184 of 200 documents on file"                                | `SlotStatusMix.valid` / `(valid+pending+rejected+missing)` — the exact sum already computed inline to derive `pctOnFile`                                                                                                                                                                                                                                                                                                                          |
| Attendance today's rate                    | "96% · Today's rate"              | "96% · 480 of 500 marked as attending today"                        | `AttendanceKpis` — **verified directly against `lib/attendance/dashboard.ts:169-171`: `encoded = present+late+excused+absent`, `attendancePct = (present+late+excused)/encoded × 100`.** The numerator is `present+late+excused`, NOT `present` alone — late/excused both count toward the rate. Caught during spec self-review; the mockup's "480 of 500 present today" undercounted late/excused as failures and must not ship as literal copy. |
| Admissions conversion (oversight roles)    | "34% · Conversion"                | "34% · 12 of 35 applications enrolled"                              | `AdmissionsRangeKpis.enrolledInRange` / `.applicationsInRange` — **verified directly against `lib/admissions/dashboard.ts:664`: `conversionPct: applications > 0 ? (enrolled / applications) * 100 : 0`, so the denominator is `applicationsInRange`, NOT `sampleSize`** (a different, unrelated field that backs `avgDaysToEnroll`'s sample count — flagged during the mockup pass specifically to avoid shipping this wrong)                    |
| Snapshot: attendance rate                  | "96% · Attendance rate, today"    | adds a second line: "480 of 500 marked as attending"                | same as the Attendance module card above — same present+late+excused numerator correction applies                                                                                                                                                                                                                                                                                                                                                 |
| Snapshot: documents on file (school_admin) | "92% · Documents on file"         | adds a second line: "184 of 200 documents"                          | same as the P-Files module card above                                                                                                                                                                                                                                                                                                                                                                                                             |
| SIS Admin AY readiness                     | "5/9 · AY readiness"              | "5 of 9 AY setup steps complete" (prose instead of a bare fraction) | `AyReadiness.complete` / `.total` — unchanged source, copy only                                                                                                                                                                                                                                                                                                                                                                                   |
| Records enrolled                           | "812 · Enrolled"                  | unchanged — a plain headcount has no percentage to pair             | `RecordsRangeKpis.activeEnrolled`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Snapshot: active students                  | "1,048 · Active students, AY2026" | unchanged — same reasoning                                          | `RecordsRangeKpis.activeEnrolled`                                                                                                                                                                                                                                                                                                                                                                                                                 |

To-do timeline copy is **not** revisited here — it was judged the strongest part of the page as shipped (requester name, aging, plain-English reason like "need a section assigned" were already present) and needs no change beyond the layout treatment in section A.

## Visual design

All existing tokens/recipes from the original spec are unchanged (real `Card`/`Badge`/`Button` primitives, `font-serif` for values, mono-uppercase eyebrows, the `ModuleTile` gradient). New additions, all composed from existing tokens, no new raw colors:

- Timeline dot + connecting line: `border-brand-indigo` (default) / `border-brand-amber` (aging warning/destructive), a 1.5px `border-hairline` vertical line.
- Progress bar: `bg-hairline` track, `bg-gradient-to-r from-brand-indigo to-brand-sky` fill — same gradient family already used for the ring chart it replaces, just a different shape.
- Sidebar "Snapshot" card and "Coming up" card share one `Card` treatment (title + stacked rows, divided by `border-hairline`), replacing the original spec's separate full-width `KpiRow` component.

## Testing plan

- Update existing component tests (`__tests__/home/module-card-grid.test.tsx`, any `KpiRow`/`ComingUpPanel`/`TodoPanel` tests) for the new copy strings and the retired chart kinds — `ModuleCardChart`'s `'sparkline' | 'ring' | 'dots'` union collapses to a single `'bar'` kind (plus `'none'` unchanged).
- Add fraction fields to `ModuleCard`/`HomeKpi` types where a stat gained a second line — e.g. `ModuleCard.statFraction?: string`, `HomeKpi.fraction?: string` — and thread them through `lib/home/module-cards.ts`/`lib/home/kpis.ts` from data already being fetched.
- Manual visual check per role (still outstanding from the original spec's shipped version too — no live browser available in this environment).

## Out of scope

- Trend/delta captions ("▲ 3.1% vs last AY") — explicitly deferred; the user chose the lighter "pair with real fraction" option over wiring `lib/dashboard/trend-delta.ts` into these cards, which would require new comparison-period data fetches this page doesn't currently make.
- Any change to the to-do panel's data sources, the `school_admin`-only change-request authorization boundary, or any `lib/home/*` query logic — this spec is presentation-layer only.
