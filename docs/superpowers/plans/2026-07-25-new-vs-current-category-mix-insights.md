# New vs. Current Category Mix — Admissions & Records Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "New vs. Current" category-mix `GroupedBarChart` to both `/admissions/insights` (application volume) and `/records/insights` (enrolled-student volume), each trended this-AY-vs-compare-AY via the pages' existing `compareAy` picker.

**Architecture:** Two independent, module-appropriate additions sharing one `CategoryMixRow` type. Admissions extends its existing `loadFunnelRows` cached loader (add one column, one pure aggregator, one cached export) in `lib/admissions/insights-funnel.ts`. Records adds a new cross-table loader in `lib/sis/records-insights.ts` that joins enrolled `section_students` to the admissions-side `category` column by `enrolee_number`, with a pure, independently-testable join/bucket function and an `Unspecified` fallback for any student whose admissions link doesn't resolve. Both pages wire the new loader into their existing `Promise.all` fan-out and render a `GroupedBarChart` in an already-existing section.

**Tech Stack:** Next.js 16 App Router (RSC), Supabase (service-role client, `unstable_cache`), Vitest, `recharts` via the existing `GroupedBarChart` wrapper.

## Global Constraints

- Hard Rule #7: semantic tokens only in JSX — this plan adds no new raw colors (reuses `GroupedBarChart`'s existing palette + `muted` series flag).
- KD #62: `category` is one of exactly 4 values — `New`, `Current`, `VizSchool New`, `VizSchool Current` (`ENROLEE_CATEGORIES` in `lib/schemas/sis.ts`, currently un-exported).
- KD #51/#140 module-ownership boundary: Admissions counts applications (demand), Records counts enrolled students (population) — the two loaders read different source tables and must not be merged into one cross-module function.
- Records' loader reads `category` from `ay{YYYY}_enrolment_applications` specifically — not `enrolment_status.enroleeType`, its schema-mirrored twin — so both new loaders (Admissions' and Records') read the exact same source column and can never disagree if the two mirrored columns ever drift.
- Admissions' new chart counts ALL applications for the AY (including cancelled/withdrawn) — a demand-mix question, matching the page's existing "By source"/"Withdrawn by level" charts' scope, not a conversion-rate question.
- Records' new chart counts only non-withdrawn `section_students` rows for the AY — matches `getInsightsHeadcount`'s existing scope exactly, so the two Records loaders never disagree on "who counts as enrolled."
- Every unlinked/unresolvable row (null `enrolee_number`, no matching admissions row, or null `category`) buckets into `'Unspecified'` — never silently dropped from the total.
- `computeCategoryMix`/`computeEnrolledCategoryMix` always emit all 4 real categories (even at count 0) since it's a fixed taxonomy the registrar expects every time; `'Unspecified'` only appears in the output when its count is > 0.
- No new page-level UI controls, URL params, or chart primitives — both charts reuse the pages' existing `compareAy`/`CompareAyPicker` mechanism and the already-built `GroupedBarChart` component.
- Records' new chart is gated behind having a comparison year selected (same visibility rule as the existing "Distribution" chart on that page) — it does not render at all when `compareAy` is null.

---

### Task 1: Export `ENROLEE_CATEGORIES` from `lib/schemas/sis.ts`

**Files:**

- Modify: `lib/schemas/sis.ts:74`

**Interfaces:**

- Produces: `export const ENROLEE_CATEGORIES = ['New', 'Current', 'VizSchool New', 'VizSchool Current'] as const;` — importable by both `lib/admissions/insights-funnel.ts` (Task 2) and `lib/sis/records-insights.ts` (Task 4).

This constant already exists at `lib/schemas/sis.ts:74-79` but is not exported (no `export` keyword, only used internally at line 131 for `ProfileUpdateSchema.category`). This task exports it so both new loaders can import the same canonical 4-value list instead of redefining it.

- [ ] **Step 1: Read the current definition to confirm line numbers haven't drifted**

Run: `grep -n "ENROLEE_CATEGORIES" "lib/schemas/sis.ts"`
Expected output includes a line like:

```
74:const ENROLEE_CATEGORIES = [
131:  category: z.enum(ENROLEE_CATEGORIES).nullable().optional(),
```

- [ ] **Step 2: Add the `export` keyword**

In `lib/schemas/sis.ts`, change:

```ts
const ENROLEE_CATEGORIES = [
  'New',
  'Current',
  'VizSchool New',
  'VizSchool Current',
] as const;
```

to:

```ts
export const ENROLEE_CATEGORIES = [
  'New',
  'Current',
  'VizSchool New',
  'VizSchool Current',
] as const;
```

Do not change anything else on those lines — the internal usage at line 131 (`ProfileUpdateSchema.category`) is unaffected by adding `export`.

- [ ] **Step 3: Verify the project still typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors (this is a pure additive export — nothing that imports `lib/schemas/sis.ts` can break from a symbol becoming _more_ visible).

- [ ] **Step 4: Commit**

```bash
git add lib/schemas/sis.ts
git commit -m "feat(sis): export ENROLEE_CATEGORIES for reuse outside the schema file"
```

---

### Task 2: Admissions — `category` in the funnel loader + `computeCategoryMix` + `getCategoryMix`

**Files:**

- Modify: `lib/admissions/insights-funnel.ts`
- Test: `__tests__/admissions/insights-funnel.test.ts`

**Interfaces:**

- Consumes: `ENROLEE_CATEGORIES` from `lib/schemas/sis.ts` (Task 1).
- Produces:
  - `export type CategoryMixRow = { category: string; count: number };`
  - `export function computeCategoryMix(rows: { category: string | null }[]): CategoryMixRow[]`
  - `export async function getCategoryMix(ayCode: string): Promise<CategoryMixRow[]>`
  - `JoinedFunnelRow` gains a `category: string | null` field (internal to this file — not imported elsewhere, but Task 3 relies on `getCategoryMix`'s return shape).

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/admissions/insights-funnel.test.ts`, after the `computeWithdrawnByLevel` `describe` block (before the closing of the file) — add the import first:

```ts
import { describe, it, expect } from 'vitest';
import {
  computeCategoryMix,
  computeConversionByLevel,
  computeReferralConversion,
  computeWithdrawnByLevel,
  sortLevelsByConversionAsc,
  type LevelConversionRow,
} from '@/lib/admissions/insights-funnel';
```

(Only `computeCategoryMix` is new in that import list — the rest already exist.)

Then append this new `describe` block at the end of the file:

```ts
// ──────────────────────────────────────────────────────────────────────────
// computeCategoryMix
// ──────────────────────────────────────────────────────────────────────────
describe('computeCategoryMix', () => {
  it('counts applications per category, including all 4 real categories at 0 when absent', () => {
    const rows = [
      { category: 'New' },
      { category: 'New' },
      { category: 'Current' },
    ];
    const result = computeCategoryMix(rows);
    expect(result).toEqual([
      { category: 'New', count: 2 },
      { category: 'Current', count: 1 },
      { category: 'VizSchool New', count: 0 },
      { category: 'VizSchool Current', count: 0 },
    ]);
  });

  it('includes cancelled/withdrawn applicants (unlike conversion metrics) — this is a demand-mix count, not a conversion rate', () => {
    // computeCategoryMix takes rows with only `category` — there is no
    // applicationStatus field to filter on, by design (the caller passes
    // ALL applications, never pre-filtered).
    const rows = [
      { category: 'New' },
      { category: 'New' },
      { category: 'New' },
    ];
    const result = computeCategoryMix(rows);
    expect(result.find((r) => r.category === 'New')?.count).toBe(3);
  });

  it('buckets null category into Unspecified, only when count > 0', () => {
    const rows = [{ category: 'New' }, { category: null }];
    const result = computeCategoryMix(rows);
    expect(result).toEqual([
      { category: 'New', count: 1 },
      { category: 'Current', count: 0 },
      { category: 'VizSchool New', count: 0 },
      { category: 'VizSchool Current', count: 0 },
      { category: 'Unspecified', count: 1 },
    ]);
  });

  it('omits Unspecified entirely when every row has a recognized category', () => {
    const rows = [{ category: 'New' }];
    const result = computeCategoryMix(rows);
    expect(result.find((r) => r.category === 'Unspecified')).toBeUndefined();
  });

  it('buckets an unrecognized/garbage category string into Unspecified', () => {
    const rows = [{ category: 'New' }, { category: 'Not A Real Category' }];
    const result = computeCategoryMix(rows);
    expect(result.find((r) => r.category === 'Unspecified')?.count).toBe(1);
  });

  it('always returns all 4 real categories even for empty input, with no Unspecified row', () => {
    const result = computeCategoryMix([]);
    expect(result).toEqual([
      { category: 'New', count: 0 },
      { category: 'Current', count: 0 },
      { category: 'VizSchool New', count: 0 },
      { category: 'VizSchool Current', count: 0 },
    ]);
  });

  it('output order always follows ENROLEE_CATEGORIES, Unspecified last', () => {
    const rows = [
      { category: 'VizSchool Current' },
      { category: null },
      { category: 'Current' },
      { category: 'VizSchool New' },
      { category: 'New' },
    ];
    const result = computeCategoryMix(rows);
    expect(result.map((r) => r.category)).toEqual([
      'New',
      'Current',
      'VizSchool New',
      'VizSchool Current',
      'Unspecified',
    ]);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run __tests__/admissions/insights-funnel.test.ts`
Expected: FAIL — `computeCategoryMix` is not exported from `lib/admissions/insights-funnel.ts` (module resolution / undefined-function error). The other pre-existing tests in this file (computeConversionByLevel, computeReferralConversion, computeWithdrawnByLevel, sortLevelsByConversionAsc) still pass.

- [ ] **Step 3: Implement — add `category` to the loader's fetch + row types**

In `lib/admissions/insights-funnel.ts`, update the row type definitions (near the top of the file, right after the existing type block):

```ts
type AppFunnelRow = {
  enroleeNumber: string | null;
  levelApplied: string | null;
  howDidYouKnowAboutHFSEIS: string | null;
  category: string | null;
};

type JoinedFunnelRow = {
  enroleeNumber: string;
  applicationStatus: string | null;
  levelApplied: string | null;
  howDidYouKnowAboutHFSEIS: string | null;
  category: string | null;
};
```

Then, inside `loadFunnelRowsUncached`, update the `_enrolment_applications` select to include `category`:

```ts
      fetchAllPages<AppFunnelRow>(
        (from, to) =>
          supabase
            .from(`${prefix}_enrolment_applications`)
            .select(
              'enroleeNumber, levelApplied, howDidYouKnowAboutHFSEIS, category'
            )
            .range(from, to) as unknown as P<AppFunnelRow>
      ),
```

And in the join loop at the bottom of `loadFunnelRowsUncached`, add `category` to the pushed object:

```ts
const out: JoinedFunnelRow[] = [];
for (const s of statusRows) {
  if (!s.enroleeNumber) continue;
  const app = appByEnrolee.get(s.enroleeNumber);
  out.push({
    enroleeNumber: s.enroleeNumber,
    applicationStatus: s.applicationStatus ?? null,
    levelApplied: app?.levelApplied ?? null,
    howDidYouKnowAboutHFSEIS: app?.howDidYouKnowAboutHFSEIS ?? null,
    category: app?.category ?? null,
  });
}
return out;
```

- [ ] **Step 4: Implement — add the `category` import + `CategoryMixRow` type + `computeCategoryMix`**

Add this import near the top of `lib/admissions/insights-funnel.ts`, alongside the existing imports:

```ts
import { ENROLEE_CATEGORIES } from '@/lib/schemas/sis';
```

Add this new section at the end of the file, before the "Cached public API" section:

```ts
// ──────────────────────────────────────────────────────────────────────────
// Category mix (New vs. Current vs. VizSchool variants)
// ──────────────────────────────────────────────────────────────────────────

export type CategoryMixRow = {
  category: string;
  count: number;
};

type CategoryRow = {
  category: string | null;
};

/**
 * Count ALL applications per enrolee category — deliberately NOT filtered by
 * applicationStatus (unlike computeConversionByLevel/computeReferralConversion's
 * "applied" counts, which still include cancelled/withdrawn but ARE paired
 * with an "enrolled" count for a rate). This is a pure demand-mix headcount:
 * "of everyone who applied, what's the New:Current split" — every row the
 * caller passes counts, full stop.
 *
 * All 4 real ENROLEE_CATEGORIES values always appear in the output, even at
 * count 0 — it's a fixed taxonomy the registrar expects to see every AY, not
 * a variable set like withdrawal reasons. A null, blank, or unrecognized
 * category value buckets into 'Unspecified', which is appended to the output
 * ONLY when its count is > 0 — a clean AY with every application correctly
 * categorized should never show a permanent empty 5th bar.
 */
export function computeCategoryMix(rows: CategoryRow[]): CategoryMixRow[] {
  const counts = new Map<string, number>(ENROLEE_CATEGORIES.map((c) => [c, 0]));
  let unspecified = 0;
  for (const r of rows) {
    const cat = (r.category ?? '').trim();
    if (cat && counts.has(cat)) {
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    } else {
      unspecified += 1;
    }
  }
  const out: CategoryMixRow[] = ENROLEE_CATEGORIES.map((category) => ({
    category,
    count: counts.get(category) ?? 0,
  }));
  if (unspecified > 0) {
    out.push({ category: 'Unspecified', count: unspecified });
  }
  return out;
}
```

- [ ] **Step 5: Implement — add `getCategoryMix` to the cached public API section**

At the bottom of `lib/admissions/insights-funnel.ts`, in the existing "Cached public API" section, add:

```ts
export async function getCategoryMix(
  ayCode: string
): Promise<CategoryMixRow[]> {
  const rows = await loadFunnelRows(ayCode);
  return computeCategoryMix(rows.map((r) => ({ category: r.category })));
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run __tests__/admissions/insights-funnel.test.ts`
Expected: all tests pass, including the 7 new `computeCategoryMix` tests and every pre-existing test in the file (unchanged behavior for `computeConversionByLevel`/`computeReferralConversion`/`computeWithdrawnByLevel`/`sortLevelsByConversionAsc`).

- [ ] **Step 7: Verify the project builds**

Run: `npx next build`
Expected: clean compile, no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add lib/admissions/insights-funnel.ts __tests__/admissions/insights-funnel.test.ts
git commit -m "feat(admissions): add computeCategoryMix + getCategoryMix — New vs Current application volume"
```

---

### Task 3: Admissions Insights page — render the New vs. Current applications chart

**Files:**

- Modify: `app/(admissions)/admissions/insights/page.tsx`

**Interfaces:**

- Consumes: `getCategoryMix(ayCode: string): Promise<CategoryMixRow[]>` and `type CategoryMixRow` from `lib/admissions/insights-funnel.ts` (Task 2). `GroupedBarChart`, `type GroupedBarSeries` from `@/components/dashboard/charts/grouped-bar-chart`.
- Produces: nothing new for later tasks — this is the final step of the Admissions half.

- [ ] **Step 1: Add the imports**

In `app/(admissions)/admissions/insights/page.tsx`, update the existing import from `lib/admissions/insights-funnel.ts`:

```ts
import {
  getCategoryMix,
  getReferralConversion,
  getWithdrawnByLevel,
  type CategoryMixRow,
} from '@/lib/admissions/insights-funnel';
```

Add `Users` to the existing `lucide-react` import list (the page currently imports `ArrowLeft, ClipboardCheck, Clock, FileStack, Filter, GraduationCap, Info, Megaphone, Percent, Star, TrendingUp, type LucideIcon` — add `Users` alphabetically among them):

```ts
import {
  ArrowLeft,
  ClipboardCheck,
  Clock,
  FileStack,
  Filter,
  GraduationCap,
  Info,
  Megaphone,
  Percent,
  Star,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
```

Add the `GroupedBarChart`/`GroupedBarSeries` import next to the existing chart imports:

```ts
import {
  GroupedBarChart,
  type GroupedBarSeries,
} from '@/components/dashboard/charts/grouped-bar-chart';
```

(Note: `GroupedBarChart` is likely already imported for the existing Entrance Assessment chart — check first. If the import already exists, just add `type GroupedBarSeries` to it instead of duplicating the import line.)

- [ ] **Step 2: Fetch `categoryMix` + `priorCategoryMix` in the existing `Promise.all`**

In the page's main `Promise.all` array (the one starting `const [funnel, priorFunnel, terminal, ...] = await Promise.all([...])`), add two more entries at the end of both the destructuring and the array:

```ts
const [
  funnel,
  priorFunnel,
  terminal,
  intakeTrendPoints,
  withdrawnByLevel,
  referralConversion,
  timeToEnroll,
  assessmentConversion,
  feedback,
  priorFeedback,
  categoryMix,
  priorCategoryMix,
] = await Promise.all([
  getConversionFunnel(selectedAy),
  compareAy ? getConversionFunnel(compareAy) : Promise.resolve(null),
  getAdmissionsTerminalReasons(selectedAy),
  getIntakeTrendByAy(trendAyRequests),
  getWithdrawnByLevel(selectedAy),
  getReferralConversion(selectedAy),
  getAverageTimeToEnrollment(selectedAy),
  getConversionByAssessment(selectedAy),
  getAdmissionsFeedback(selectedAy),
  compareAy ? getAdmissionsFeedback(compareAy) : Promise.resolve(null),
  getCategoryMix(selectedAy),
  compareAy ? getCategoryMix(compareAy) : Promise.resolve(null),
]);
```

(Keep every existing line's comments exactly as they were — only the two new lines are added at the end of each array. Do not reformat or remove existing inline comments in this block.)

- [ ] **Step 3: Add the chart-data derivation**

Near the other "Chart-primitive presentation derivations" (the block of `const ... = ...` reshaping raw loader output into chart-prop shapes, right before the `return (` that starts the JSX), add:

```ts
// §7 — category mix: New vs. Current vs. VizSchool variants, this AY vs.
// the picked comparison AY. Demand-mix count (includes cancelled/withdrawn
// applicants, same scope as the referral/withdrawn-by-level charts) — NOT
// a conversion rate, so there is no "enrolled" denominator here.
const categoryMixSeries: GroupedBarSeries[] = compareAy
  ? [
      { key: 'current', label: selectedAy },
      { key: 'compare', label: compareAy, muted: true },
    ]
  : [{ key: 'current', label: selectedAy }];
const priorCategoryMixByCategory = new Map(
  (priorCategoryMix ?? []).map((r: CategoryMixRow) => [r.category, r.count])
);
const categoryMixData = categoryMix.map((r: CategoryMixRow) => ({
  x: r.category,
  current: r.count,
  ...(compareAy
    ? { compare: priorCategoryMixByCategory.get(r.category) ?? 0 }
    : {}),
}));
const haveCategoryMixData = categoryMix.some(
  (r: CategoryMixRow) => r.count > 0
);
```

- [ ] **Step 4: Render the chart card in the "Channels & segments" section**

In the JSX, find the `{/* ═══ Channels & segments ═══ */}` block. It currently contains one `InsightChartCard` ("By source"). Wrap both cards in a responsive grid and add the new card after the existing one:

Before:

```tsx
<div className="space-y-5 border-t border-hairline pt-7">
  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-mint">
    Channels &amp; segments
  </p>

  <InsightChartCard
    cap="By source"
    title={referralTitle}
    icon={Megaphone}
    scopeNote="All applicants — includes cancelled/withdrawn"
  >
    {referralDonutData.length === 0 ? (
      <EmptyChartState message="No referral sources recorded yet." />
    ) : (
      <>
        <DonutChart
          data={referralDonutData}
          centerValue={totalReferralApplicants.toLocaleString('en-SG')}
          centerLabel="Applicants"
        />
        {showBestRef ? (
          <RecommendationCallout tone="positive" className="mt-5">
            {bestRef.item!.source} converts best at{' '}
            {bestRef.item!.conversionPct}%
            {!worstRef.isTie &&
            worstRef.item !== null &&
            worstRef.item.source !== bestRef.item!.source
              ? `, ${worstRef.item.source} the lowest at ${worstRef.item.conversionPct}%`
              : ''}{' '}
            — lean into what&rsquo;s working.
          </RecommendationCallout>
        ) : null}
      </>
    )}
  </InsightChartCard>
</div>;
{
  /* ═══ end Channels & segments ═══ */
}
```

After:

```tsx
<div className="space-y-5 border-t border-hairline pt-7">
  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-mint">
    Channels &amp; segments
  </p>

  <div className="grid gap-4 lg:grid-cols-2">
    <InsightChartCard
      cap="By source"
      title={referralTitle}
      icon={Megaphone}
      scopeNote="All applicants — includes cancelled/withdrawn"
    >
      {referralDonutData.length === 0 ? (
        <EmptyChartState message="No referral sources recorded yet." />
      ) : (
        <>
          <DonutChart
            data={referralDonutData}
            centerValue={totalReferralApplicants.toLocaleString('en-SG')}
            centerLabel="Applicants"
          />
          {showBestRef ? (
            <RecommendationCallout tone="positive" className="mt-5">
              {bestRef.item!.source} converts best at{' '}
              {bestRef.item!.conversionPct}%
              {!worstRef.isTie &&
              worstRef.item !== null &&
              worstRef.item.source !== bestRef.item!.source
                ? `, ${worstRef.item.source} the lowest at ${worstRef.item.conversionPct}%`
                : ''}{' '}
              — lean into what&rsquo;s working.
            </RecommendationCallout>
          ) : null}
        </>
      )}
    </InsightChartCard>

    <InsightChartCard
      cap={`By category${compareAy ? ` · ${selectedAy} vs ${compareAy}` : ` · ${selectedAy}`}`}
      title="New vs. returning applicants"
      icon={Users}
      scopeNote="All applicants — includes cancelled/withdrawn"
    >
      {haveCategoryMixData ? (
        <GroupedBarChart
          series={categoryMixSeries}
          data={categoryMixData}
          yFormat="number"
          height={260}
        />
      ) : (
        <EmptyChartState message="No applications recorded yet for this academic year." />
      )}
    </InsightChartCard>
  </div>
</div>;
{
  /* ═══ end Channels & segments ═══ */
}
```

- [ ] **Step 5: Verify the project builds**

Run: `npx next build`
Expected: clean compile, no TypeScript errors, `/admissions/insights` appears in the route list with no error markers.

- [ ] **Step 6: Manual verification**

Start the dev server (`npm run dev`), sign in as a `school_admin`/`superadmin`/`academic_coordinator`/`admissions` user, and visit `/admissions/insights`:

- Confirm the "Channels & segments" section now shows two cards side by side (on a wide viewport) or stacked (narrow).
- Confirm the new "New vs. returning applicants" card renders a grouped bar chart with 4 (or 5, if any application has an unset category) bars.
- Pick a comparison AY via the `CompareAyPicker` and confirm the chart gains a second, greyed-out bar per category and the card's `cap` text updates to show "vs {compareAy}".

- [ ] **Step 7: Commit**

```bash
git add "app/(admissions)/admissions/insights/page.tsx"
git commit -m "feat(admissions): render New vs. Current applications chart on Insights"
```

---

### Task 4: Records — `computeEnrolledCategoryMix` + `getEnrolledCategoryMix`

**Files:**

- Modify: `lib/sis/records-insights.ts`
- Test: `__tests__/sis/records-insights.test.ts`

**Interfaces:**

- Consumes: `CategoryMixRow` type from `lib/admissions/insights-funnel.ts` (Task 2); `ENROLEE_CATEGORIES` from `lib/schemas/sis.ts` (Task 1); `prefixFor` from `lib/admissions/_shared`; `fetchAllPages` from `lib/supabase/paginate`; `createServiceClient` from `lib/supabase/service` (already imported in this file).
- Produces:
  - `export type EnrolledStudentCategoryRow = { enroleeNumber: string | null };` (the pure function's input row shape)
  - `export function computeEnrolledCategoryMix(enrolledRows: EnrolledStudentCategoryRow[], categoryByEnroleeNumber: Map<string, string>): CategoryMixRow[]`
  - `export async function getEnrolledCategoryMix(ayCode: string): Promise<CategoryMixRow[]>`

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/sis/records-insights.test.ts` — update the existing import block at the top of the file to add the new symbols:

```ts
import { describe, it, expect } from 'vitest';
import {
  computeEnrolledCategoryMix,
  currentInProgressMonthLabel,
  hasMonthlyResolution,
  isTerminalLevel,
  monthlyMovementSeries,
  netMovementByMonth,
  rollupMovements,
  TERMINAL_LEVEL_CODES,
  WITHDRAWAL_CONTROLLABILITY,
} from '@/lib/sis/records-insights';
```

(Only `computeEnrolledCategoryMix` is new in that import list.)

Append this new `describe` block at the end of the file:

```ts
// ──────────────────────────────────────────────────────────────────────────
// computeEnrolledCategoryMix
// ──────────────────────────────────────────────────────────────────────────
describe('computeEnrolledCategoryMix', () => {
  it('counts enrolled students per category via the enroleeNumber lookup, including all 4 real categories at 0 when absent', () => {
    const enrolledRows = [
      { enroleeNumber: 'E1' },
      { enroleeNumber: 'E2' },
      { enroleeNumber: 'E3' },
    ];
    const lookup = new Map([
      ['E1', 'New'],
      ['E2', 'New'],
      ['E3', 'Current'],
    ]);
    const result = computeEnrolledCategoryMix(enrolledRows, lookup);
    expect(result).toEqual([
      { category: 'New', count: 2 },
      { category: 'Current', count: 1 },
      { category: 'VizSchool New', count: 0 },
      { category: 'VizSchool Current', count: 0 },
    ]);
  });

  it('buckets a null enroleeNumber into Unspecified', () => {
    const enrolledRows = [{ enroleeNumber: 'E1' }, { enroleeNumber: null }];
    const lookup = new Map([['E1', 'New']]);
    const result = computeEnrolledCategoryMix(enrolledRows, lookup);
    expect(result.find((r) => r.category === 'Unspecified')?.count).toBe(1);
  });

  it('buckets an enroleeNumber with no matching admissions row into Unspecified', () => {
    // Simulates the real gap this function exists to handle: a
    // section_students row whose enrolee_number doesn't resolve to any
    // ay{YYYY}_enrolment_applications row (a historically-unsynced link).
    const enrolledRows = [
      { enroleeNumber: 'E1' },
      { enroleeNumber: 'E-ORPHAN' },
    ];
    const lookup = new Map([['E1', 'New']]);
    const result = computeEnrolledCategoryMix(enrolledRows, lookup);
    expect(result.find((r) => r.category === 'New')?.count).toBe(1);
    expect(result.find((r) => r.category === 'Unspecified')?.count).toBe(1);
  });

  it('omits Unspecified entirely when every enrolled student resolves to a real category', () => {
    const enrolledRows = [{ enroleeNumber: 'E1' }];
    const lookup = new Map([['E1', 'New']]);
    const result = computeEnrolledCategoryMix(enrolledRows, lookup);
    expect(result.find((r) => r.category === 'Unspecified')).toBeUndefined();
  });

  it('never drops a student from the total — enrolled count always equals sum of all bucket counts', () => {
    const enrolledRows = [
      { enroleeNumber: 'E1' },
      { enroleeNumber: null },
      { enroleeNumber: 'E-ORPHAN' },
      { enroleeNumber: 'E2' },
    ];
    const lookup = new Map([
      ['E1', 'New'],
      ['E2', 'VizSchool Current'],
    ]);
    const result = computeEnrolledCategoryMix(enrolledRows, lookup);
    const total = result.reduce((sum, r) => sum + r.count, 0);
    expect(total).toBe(enrolledRows.length);
  });

  it('returns all 4 real categories with 0 for an empty enrolled roster', () => {
    const result = computeEnrolledCategoryMix([], new Map());
    expect(result).toEqual([
      { category: 'New', count: 0 },
      { category: 'Current', count: 0 },
      { category: 'VizSchool New', count: 0 },
      { category: 'VizSchool Current', count: 0 },
    ]);
  });

  it('output order always follows ENROLEE_CATEGORIES, Unspecified last', () => {
    const enrolledRows = [
      { enroleeNumber: 'E1' },
      { enroleeNumber: 'E2' },
      { enroleeNumber: 'E3' },
      { enroleeNumber: 'E4' },
      { enroleeNumber: null },
    ];
    const lookup = new Map([
      ['E1', 'VizSchool Current'],
      ['E2', 'Current'],
      ['E3', 'VizSchool New'],
      ['E4', 'New'],
    ]);
    const result = computeEnrolledCategoryMix(enrolledRows, lookup);
    expect(result.map((r) => r.category)).toEqual([
      'New',
      'Current',
      'VizSchool New',
      'VizSchool Current',
      'Unspecified',
    ]);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run __tests__/sis/records-insights.test.ts`
Expected: FAIL — `computeEnrolledCategoryMix` is not exported from `lib/sis/records-insights.ts`. Every pre-existing test in this file still passes.

- [ ] **Step 3: Implement — add the imports**

In `lib/sis/records-insights.ts`, update the existing import block to add:

```ts
import { prefixFor } from '@/lib/admissions/_shared';
import type { CategoryMixRow } from '@/lib/admissions/insights-funnel';
import { ENROLEE_CATEGORIES } from '@/lib/schemas/sis';
```

Place these alongside the file's existing imports (e.g. right after the `growthDelta`/`AyTrendPoint`/`WITHDRAWAL_REASON_LABELS` imports at the top of the file — exact position doesn't matter, just keep the existing imports intact).

- [ ] **Step 4: Implement — `computeEnrolledCategoryMix` (pure)**

Add this new section to `lib/sis/records-insights.ts`, right after the "Headcount" section (after `getInsightsHeadcount`'s closing brace, before the "Net-movement trend" section comment block):

```ts
// ──────────────────────────────────────────────────────────────────────────
// Enrolled category mix — New vs. Current vs. VizSchool variants.
//
// Enrolled headcount (section_students) and `category` (the admissions-side
// ay{YYYY}_enrolment_applications table) are different sources — crossing
// them means resolving each enrolled student's enrolee_number back to their
// admissions row, and that link is not guaranteed for every historically-
// synced row (the same class of gap Records' "Unsynced students" queue
// already tracks). Any enrolled student whose enrolee_number is null, or
// whose enrolee_number has no matching admissions row, or whose category is
// null/unrecognized, buckets into 'Unspecified' — never silently dropped
// from the total.
// ──────────────────────────────────────────────────────────────────────────

export type EnrolledStudentCategoryRow = { enroleeNumber: string | null };

/**
 * Pure: given the enrolled section_students rows for an AY (each carrying
 * its enrolee_number, possibly null) and an enroleeNumber → category lookup
 * built from that AY's admissions applications table, buckets every
 * enrolled student into their category.
 *
 * All 4 real ENROLEE_CATEGORIES values always appear in the output, even at
 * count 0 (same convention as computeCategoryMix in
 * lib/admissions/insights-funnel.ts). 'Unspecified' is appended ONLY when
 * its count is > 0.
 */
export function computeEnrolledCategoryMix(
  enrolledRows: EnrolledStudentCategoryRow[],
  categoryByEnroleeNumber: Map<string, string>
): CategoryMixRow[] {
  const counts = new Map<string, number>(ENROLEE_CATEGORIES.map((c) => [c, 0]));
  let unspecified = 0;
  for (const r of enrolledRows) {
    const en = r.enroleeNumber?.trim();
    const cat = en ? categoryByEnroleeNumber.get(en) : undefined;
    if (cat && counts.has(cat)) {
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    } else {
      unspecified += 1;
    }
  }
  const out: CategoryMixRow[] = ENROLEE_CATEGORIES.map((category) => ({
    category,
    count: counts.get(category) ?? 0,
  }));
  if (unspecified > 0) {
    out.push({ category: 'Unspecified', count: unspecified });
  }
  return out;
}
```

- [ ] **Step 5: Implement — `getEnrolledCategoryMix` (cached loader)**

Immediately after `computeEnrolledCategoryMix`, add:

```ts
async function loadEnrolledCategoryMixUncached(
  ayCode: string
): Promise<CategoryMixRow[]> {
  const service = createServiceClient();
  const { data: ay } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = (ay as { id: string } | null)?.id;
  if (!ayId) return computeEnrolledCategoryMix([], new Map());

  type SsRow = { enrolee_number: string | null };
  const enrolledRows = await fetchAllPages<SsRow>((from, to) =>
    service
      .from('section_students')
      .select('enrolee_number, section:sections!inner(academic_year_id)')
      .eq('section.academic_year_id', ayId)
      .neq('enrollment_status', 'withdrawn')
      .range(from, to)
  );

  const prefix = prefixFor(ayCode);
  type AppRow = { enroleeNumber: string | null; category: string | null };
  const appRows = await fetchAllPages<AppRow>((from, to) =>
    service
      .from(`${prefix}_enrolment_applications`)
      .select('enroleeNumber, category')
      .range(from, to)
  );

  const categoryByEnroleeNumber = new Map<string, string>();
  for (const a of appRows) {
    if (a.enroleeNumber && a.category) {
      categoryByEnroleeNumber.set(a.enroleeNumber, a.category);
    }
  }

  return computeEnrolledCategoryMix(
    enrolledRows.map((r) => ({ enroleeNumber: r.enrolee_number })),
    categoryByEnroleeNumber
  );
}

export function getEnrolledCategoryMix(
  ayCode: string
): Promise<CategoryMixRow[]> {
  return unstable_cache(
    () => loadEnrolledCategoryMixUncached(ayCode),
    ['sis', 'enrolled-category-mix', ayCode],
    { tags: ['sis', `sis:${ayCode}`], revalidate: CACHE_TTL_SECONDS }
  )();
}
```

Note: `CACHE_TTL_SECONDS` is already defined earlier in this file (used by `getRecordsRetention`/`getRecordsRetentionByLevel`) — reuse it, do not redefine it.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run __tests__/sis/records-insights.test.ts`
Expected: all tests pass, including the 7 new `computeEnrolledCategoryMix` tests and every pre-existing test in the file.

- [ ] **Step 7: Verify the project builds**

Run: `npx next build`
Expected: clean compile, no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add lib/sis/records-insights.ts __tests__/sis/records-insights.test.ts
git commit -m "feat(records): add computeEnrolledCategoryMix + getEnrolledCategoryMix — New vs Current enrolled volume"
```

---

### Task 5: Records Insights page — render the New vs. Current enrolled chart

**Files:**

- Modify: `app/(records)/records/insights/page.tsx`

**Interfaces:**

- Consumes: `getEnrolledCategoryMix(ayCode: string): Promise<CategoryMixRow[]>` from `lib/sis/records-insights.ts` (Task 4); `type CategoryMixRow` from `lib/admissions/insights-funnel.ts` (Task 2); `GroupedBarChart`, `type GroupedBarSeries` from `@/components/dashboard/charts/grouped-bar-chart` (already imported on this page for the Movement chart — reuse the existing import, just add `type GroupedBarSeries` to it if not already present).
- Produces: nothing — final task in this plan.

- [ ] **Step 1: Add the imports**

In `app/(records)/records/insights/page.tsx`, update the existing import from `lib/sis/records-insights.ts` to add `getEnrolledCategoryMix`:

```ts
import {
  getEnrolledCategoryMix,
  getInsightsHeadcount,
  getRecordsRetention,
  getRecordsRetentionByLevel,
  growthDelta,
  isTerminalLevel,
  MONTH_LABELS,
  monthlyMovementSeries,
  rollupMovements,
  WITHDRAWAL_CONTROLLABILITY,
} from '@/lib/sis/records-insights';
```

Add a new import for `CategoryMixRow` (it lives in the Admissions file, per the plan's shared-type decision):

```ts
import type { CategoryMixRow } from '@/lib/admissions/insights-funnel';
```

Check the existing `GroupedBarChart` import (already present for the "Mid-year movement" chart) — update it to also import `type GroupedBarSeries` if that type isn't already imported:

```ts
import {
  GroupedBarChart,
  type GroupedBarSeries,
} from '@/components/dashboard/charts/grouped-bar-chart';
```

`Users` is already imported from `lucide-react` on this page (used for the "Enrolled" `MetricCard` and the footer trust strip) — no new icon import needed.

- [ ] **Step 2: Fetch `categoryMix` + `priorCategoryMix` in the existing `Promise.all`**

In the page's `Promise.all` array (`const [headcount, priorHeadcount, retention, retentionByLevel, movementEvents] = await Promise.all([...])`), add two more entries:

```ts
const [
  headcount,
  priorHeadcount,
  retention,
  retentionByLevel,
  movementEvents,
  categoryMix,
  priorCategoryMix,
] = await Promise.all([
  getInsightsHeadcount(selectedAy),
  compareAy ? getInsightsHeadcount(compareAy) : Promise.resolve(null),
  getRecordsRetention(selectedAy, compareAy),
  getRecordsRetentionByLevel(selectedAy, compareAy),
  getMovementEvents(selectedAy),
  getEnrolledCategoryMix(selectedAy),
  compareAy ? getEnrolledCategoryMix(compareAy) : Promise.resolve(null),
]);
```

- [ ] **Step 3: Add the chart-data derivation**

Near the page's other chart-data derivations (alongside `populationComposedData`/`movementBarData`), add:

```ts
// §Category mix — New vs. Current vs. VizSchool variants, of ENROLLED
// students. Comparison-only (same visibility rule as Distribution above):
// a primary-AY-only snapshot doesn't answer the "is the mix shifting"
// question this chart exists for, so it renders nothing without a
// compareAy — no half-built single-bar version.
const categoryMixSeries: GroupedBarSeries[] = compareAy
  ? [
      { key: 'current', label: selectedAy },
      { key: 'compare', label: compareAy, muted: true },
    ]
  : [];
const priorCategoryMixByCategory = new Map(
  (priorCategoryMix ?? []).map((r: CategoryMixRow) => [r.category, r.count])
);
const categoryMixData = categoryMix.map((r: CategoryMixRow) => ({
  x: r.category,
  current: r.count,
  compare: priorCategoryMixByCategory.get(r.category) ?? 0,
}));
const haveCategoryMixData = categoryMix.some(
  (r: CategoryMixRow) => r.count > 0
);
```

- [ ] **Step 4: Render the chart card in the "Population & growth" section**

In the JSX, find the existing "Distribution" `InsightChartCard` (the one gated on `{compareAy && priorHeadcount && (...)}`). Add the new card immediately after it, inside the same `space-y-5` section, gated the same way:

Before (context — the existing Distribution card, unchanged, followed by the Mid-year movement card):

```tsx
        {compareAy && priorHeadcount && (
          <InsightChartCard
            cap="Distribution"
            title={distributionTitle}
            icon={Users}
            scopeNote={`This year vs ${compareAy}`}
          >
            {populationComposedData.length === 0 ? (
              <EmptyChartState message="No enrolled students recorded for this year yet." />
            ) : (
              <ComposedBarLineChart
                data={populationComposedData}
                barLabel={selectedAy}
                lineLabel={compareAy}
                yFormat="number"
                height={300}
              />
            )}
          </InsightChartCard>
        )}

        {/* Mid-year movement — enrollments vs withdrawals per month. */}
        <InsightChartCard
```

After:

```tsx
        {compareAy && priorHeadcount && (
          <InsightChartCard
            cap="Distribution"
            title={distributionTitle}
            icon={Users}
            scopeNote={`This year vs ${compareAy}`}
          >
            {populationComposedData.length === 0 ? (
              <EmptyChartState message="No enrolled students recorded for this year yet." />
            ) : (
              <ComposedBarLineChart
                data={populationComposedData}
                barLabel={selectedAy}
                lineLabel={compareAy}
                yFormat="number"
                height={300}
              />
            )}
          </InsightChartCard>
        )}

        {compareAy && priorCategoryMix && (
          <InsightChartCard
            cap={`By category · ${selectedAy} vs ${compareAy}`}
            title="New vs. returning enrolled students"
            icon={Users}
            scopeNote="Enrolled students — excludes withdrawn"
          >
            {haveCategoryMixData ? (
              <GroupedBarChart
                series={categoryMixSeries}
                data={categoryMixData}
                yFormat="number"
                height={260}
              />
            ) : (
              <EmptyChartState message="No enrolled students recorded for this year yet." />
            )}
          </InsightChartCard>
        )}

        {/* Mid-year movement — enrollments vs withdrawals per month. */}
        <InsightChartCard
```

- [ ] **Step 5: Verify the project builds**

Run: `npx next build`
Expected: clean compile, no TypeScript errors, `/records/insights` appears in the route list with no error markers.

- [ ] **Step 6: Manual verification**

With the dev server running, sign in as a `academic_coordinator`/`school_admin`/`superadmin` user and visit `/records/insights`:

- With no comparison AY picked, confirm the new "New vs. returning enrolled students" card does NOT render (same as "Distribution" not rendering).
- Pick a comparison AY via the `CompareAyPicker` and confirm both "Distribution" and the new category-mix card now render, the new one showing a grouped bar chart with a this-year bar and a greyed-out compare-year bar per category.

- [ ] **Step 7: Commit**

```bash
git add "app/(records)/records/insights/page.tsx"
git commit -m "feat(records): render New vs. Current enrolled students chart on Insights"
```

---

## Final verification (after all 5 tasks)

- [ ] Run the full test suite: `npx vitest run` — expect all tests passing, including the 14 new tests added across Tasks 2 and 4.
- [ ] Run the full build: `npx next build` — expect a clean compile.
- [ ] Manually re-verify both pages together: `/admissions/insights` shows the New vs. Current applications chart unconditionally (with or without a compare AY); `/records/insights` shows its enrolled-students counterpart only when a compare AY is picked.
