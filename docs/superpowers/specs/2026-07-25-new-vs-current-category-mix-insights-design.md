# New vs. Current category mix — Admissions & Records Insights

**Date:** 2026-07-25
**Status:** Approved, pending implementation plan

## Summary

Add a "New vs. Current" volume-mix chart to each of `/admissions/insights` and
`/records/insights`, based on the `category` / `enroleeType` axis (KD #62:
`New | Current | VizSchool New | VizSchool Current`). Each chart answers a
different, module-appropriate question:

- **Admissions Insights** — of the applications received this AY, what's the
  New-vs-returning mix? (demand-side)
- **Records Insights** — of the students enrolled this AY, what's the
  New-vs-returning mix? (enrolled-body-side)

Both reuse the page's existing AY-comparison mechanism (`compareAy` picker)
to show the mix as a this-year-vs-comparison-year grouped bar, not a static
snapshot.

## Why this shape, not the old one

A near-identical report — a "Conversion by applicant type" table (New /
Current / VizSchool New / VizSchool Current × Applied / Enrolled / Rate) —
existed on `/admissions/insights` and was deliberately deleted on 2026-07-10
during an adversarial Insights-simplification review (commit `3dbe2eec`,
`docs/superpowers/specs/2026-07-10-insights-simplification-design.md`). The
stated reason was not a data problem (the `category` column has no known
prod-emptiness issue) — it was cut for being analytically non-actionable:
returning students ("Current"/"VizSchool Current") convert at ~100%
structurally, so a static applied/enrolled/rate table told an unsurprising
story nobody acted on. The underlying code
(`lib/admissions/insights-funnel.ts::computeEnroleeTypeConversion`) was
deleted entirely, tests included — nothing reusable remains.

This design deliberately avoids repeating that mistake:

1. **Volume mix, not conversion rate.** This shows _how many_ of each
   category, not _what fraction converts_ — a different, simpler claim that
   isn't structurally pre-determined the way a returning-student conversion
   rate is.
2. **Trended (this AY vs. compare AY), not a static snapshot.** Matches this
   module's own "Insights = over-time diagnosis" doctrine (KD #140) — the
   real question is whether the New:Current ratio is _shifting_, which is
   genuinely diagnostic (a shrinking New-applicant share is a demand-health
   signal; a shrinking New-enrollee share alongside strong retention is a
   different story than the same shrink alongside falling retention).
3. **Split across two modules, not squeezed into one.** Enrolled headcount is
   explicitly Records' territory, applications/demand is explicitly
   Admissions' (KD #51/#140 — stated directly in `/admissions/insights`'s own
   code comments). Building one cross-module report would have fought that
   boundary; building two small, module-appropriate ones respects it.

## 1. Admissions Insights — "New vs. Current applications"

**Placement:** the existing **"Channels & segments"** section (currently the
only section on the page that doesn't yet deliver on its own name — it has
"By source" but nothing else called out as a "segment"). New card sits
alongside the existing "By source" referral donut.

**Shape:** `InsightChartCard` wrapping a `GroupedBarChart`
(`components/dashboard/charts/grouped-bar-chart.tsx`, already used on this
same page for the "Entrance assessment" chart). X-axis = category (`New`,
`Current`, `VizSchool New`, `VizSchool Current`, in `ENROLE_CATEGORIES`
order). Series = `[selectedAy]` alone, or `[selectedAy, compareAy]` when a
comparison year is picked — mirrors the assessment chart's
`ASSESSMENT_SERIES` pattern exactly.

**Scope:** same population as the page's other "all applicants" charts
(referral-by-source, withdrawn-by-level) — every application row for the AY,
regardless of terminal status. This is a demand-mix question ("who applied"),
not a conversion question, so cancelled/withdrawn rows are included exactly
like the sibling charts already do.

**Data layer** (`lib/admissions/insights-funnel.ts`):

- `loadFunnelRowsUncached` currently selects `enroleeNumber, levelApplied,
howDidYouKnowAboutHFSEIS` from `{prefix}_enrolment_applications`. Add
  `category` to that select. One extra column on an already-fetched,
  already-cached query — no new round trip, no new cache tag.
- `JoinedFunnelRow` type gains a `category: string | null` field.
- New pure function `computeCategoryMix(rows: JoinedFunnelRow[]):
CategoryMixRow[]` — groups by `category`, counts rows per bucket, in the
  same file and same style as `computeWithdrawnByLevel` /
  `computeReferralConversion` (both already consume `JoinedFunnelRow[]` from
  this exact loader). Buckets: the 4 real values, plus an `Unspecified`
  bucket for `category === null`.
- New exported `getCategoryMix(ayCode: string): Promise<CategoryMixRow[]>`
  mirroring `getWithdrawnByLevel`'s one-line shape (`loadFunnelRows(ayCode)`
  → `computeCategoryMix(rows)`).

**Page wiring** (`app/(admissions)/admissions/insights/page.tsx`):

- `getCategoryMix(selectedAy)` and, when `compareAy` is set,
  `getCategoryMix(compareAy)` — added to the existing `Promise.all` fan-out.
- Reshape into `GroupedBarChart` data: one row per category, `current` =
  selected-AY count, `compare` = compare-AY count (undefined/omitted when no
  compareAy).
- Empty state (`EmptyChartState`, existing pattern) when the selected AY has
  zero applications.

## 2. Records Insights — "New vs. Current enrolled"

**Placement:** the existing **"Population & growth"** section, next to the
current "Distribution" (population-by-level) chart — both are "who makes up
the student body" questions.

**Shape:** same `InsightChartCard` + `GroupedBarChart` pattern as Admissions,
same X-axis (category), same this-AY-vs-compare-AY series shape. Matches the
page's existing "Distribution" chart's own comparison-only visibility rule
(see below).

**The real wrinkle — enrolled headcount and `category` live in different
tables.** Records' enrolled headcount (`getInsightsHeadcount` in
`lib/sis/records-insights.ts`) is sourced from `section_students` (joined to
`sections`/`levels`) — deliberately, per that function's own doc comment, so
it shares its source with the retention calculation (KD #90: `section_students`
and the admissions-side tables can drift). `category` lives on the
admissions-side `ay{YYYY}_enrolment_applications` table (or its mirror,
`enrolment_status.enroleeType`). Crossing them means resolving each enrolled
`section_students` row's `enrolee_number` back to its admissions row — and
that link is not guaranteed populated for every historically-synced row (the
same class of gap Records' existing "Unsynced students" queue already
surfaces elsewhere in this codebase).

**Resolution:** any enrolled student whose `enrolee_number` doesn't resolve
to a `category` value is bucketed as **`Unspecified`** — never silently
dropped from the total, never guessed at. This mirrors the existing,
established pattern on this exact page: withdrawal reasons already have an
`Unspecified` bucket with its own honest fallback copy
("`hasSpecifiedWithdrawalReasons`" gate + the "No reason has been recorded
for any withdrawal on record yet" message). The new chart follows the same
convention rather than inventing a new one.

**Data layer** (`lib/sis/records-insights.ts`):

- New function `getEnrolledCategoryMix(ayCode: string): Promise<CategoryMixRow[]>`:
  1. Fetch enrolled `section_students` rows for the AY (`enrollment_status
!= 'withdrawn'`, mirroring `getInsightsHeadcount`'s own scope), including
     `enrolee_number`.
  2. Fetch `category` from the AY's `ay{YYYY}_enrolment_applications` table,
     keyed by `enroleeNumber` — deliberately the same source column the
     Admissions loader reads (not `enrolment_status.enroleeType`, its
     mirror), so both new loaders have exactly one source of truth for
     `category` between them and can never disagree if the two mirrored
     columns ever drift (KD #62 says they shouldn't, but reading one column
     from two different places for the same concept is how that kind of
     drift becomes visible instead of silent).
  3. Join in memory by `enrolee_number`; any enrolled row with no match, or
     whose `enrolee_number` is null, buckets into `Unspecified`.
  4. Return the same `CategoryMixRow[]` shape as the Admissions side (shared
     type — see "Shared" below) so both pages' chart-reshaping code is
     identical.

**Page wiring** (`app/(records)/records/insights/page.tsx`):

- `getEnrolledCategoryMix(selectedAy)` and, when `compareAy` is set,
  `getEnrolledCategoryMix(compareAy)` — added to the page's existing
  `Promise.all` fan-out.
- Same comparison-only visibility rule the existing "Distribution" chart
  uses (`{compareAy && priorHeadcount && (...)}`) — a primary-AY-only
  snapshot of "how many New vs Current students" is a fine standalone
  number, but per this design's own "trend, not snapshot" reasoning (see
  "Why this shape"), the chart itself is gated behind having a comparison
  year selected, exactly like Distribution already is. Without a compareAy,
  nothing renders here (no half-built single-bar version) — consistent with
  the existing page's stated policy that a primary-AY-only population
  snapshot duplicates the `/records` dashboard.

## Shared

- Both loaders return the same `CategoryMixRow` type:
  ```ts
  export type CategoryMixRow = {
    category:
      | 'New'
      | 'Current'
      | 'VizSchool New'
      | 'VizSchool Current'
      | 'Unspecified';
    count: number;
  };
  ```
  Defined once — proposed home: `lib/admissions/insights-funnel.ts` (the
  Admissions loader's own file), re-exported/imported by
  `lib/sis/records-insights.ts` for the Records loader. Avoids two pages
  independently inventing the same shape.
- Both pages reuse their existing `compareAy`/`CompareAyPicker` — no new
  page-level state, no new URL params.
- Both use the already-built `GroupedBarChart` component — no new chart
  primitive.
- Category order on both charts follows `ENROLEE_CATEGORIES` (`New`,
  `Current`, `VizSchool New`, `VizSchool Current`), with `Unspecified` always
  last when present — never sorted by count, so the axis reads the same way
  every time a registrar looks at it.

## Testing

- Pure functions get unit tests: `computeCategoryMix` (Admissions) — mirrors
  the existing `computeWithdrawnByLevel`/`computeReferralConversion` test
  style in `__tests__/admissions/insights-funnel.test.ts`; and the
  join/bucketing logic inside `getEnrolledCategoryMix` (Records) — extract
  the pure join step so it's testable without a live Supabase client, same
  pattern the rest of `lib/sis/records-insights.ts` already follows for its
  other rollups.
- Cover: all 4 real categories present; a null/unlinked `enrolee_number`
  bucketing to `Unspecified`; zero-enrolled-this-AY empty state; the
  compare-AY series being `undefined` when no compare year is picked.

## Out of scope

- No new page-level filter/control — this rides entirely on the existing AY
  - compare-AY pickers.
- No change to the `category`/`enroleeType` data model, sync logic, or the
  discount-codes catalog's own 6-value superset (KD #62 unchanged).
- No retry at the old "conversion by applicant type" framing — that
  question stays deliberately unanswered per the 2026-07-10 review's
  reasoning, which this design does not challenge.
- Records' `Unspecified` bucket size is not itself surfaced as a data-quality
  callout in this pass (e.g. "N% of enrolled students have no linked
  application") — if that turns out to be a large bucket in practice, that's
  a follow-up worth its own look, not bundled into this report.
