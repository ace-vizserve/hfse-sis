# Phase 3 — Admissions Insights drills

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every KPI card, chart segment and list on `/admissions/insights` opens the applicants behind it, and each list's row count equals the number it was opened from — including the comparison year and every folded "Other" bucket.

**Depends on:** Phase 1 only. Facts from `phase-1-charts.md` this phase relies on: the shared handler type is `SegmentClickHandler = (category: string, series?: string) => void` (`components/dashboard/charts/chart-primitives.ts`); `GroupedBarChart` reports `(row.x, series.key)` — on this page the keys are `'current'`/`'compare'` (category mix) and `'pass'`/`'fail'`/`'notAssessed'` (assessment); `TrendChart` reports `(x, 'current' | 'comparison')`, **not** an AY code; `NationalityMixPie` reports `(nationality)` and `NationalityByLevelBars` reports `(level as displayed, nationality)`, both passing `'Other'` / `'Unspecified'` through verbatim; `DonutChart` / `ComparisonBarChart` report the slice name / category. A zero-value bar draws nothing, so it cannot be clicked.

**Binding:** the index's Global Constraints and Review Focus (`docs/superpowers/plans/2026-09-29-insights-drill-sheets.md`). Spec: `docs/superpowers/specs/2026-09-29-insights-drill-sheets-design.md` §2 and the Admissions table.

**What this phase adds**

| Block on the page                     | Opens                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Applications received                 | `funnel-stage` segment `Submitted` (predicate aligned to `getConversionFunnel`, Task 3.5)                          |
| Conversion rate                       | the same list, grouped by Status (the denominator, outcome visible)                                                |
| Avg. days to enrol                    | `avg-time`, no range                                                                                               |
| Applications per month (point)        | **new** `intake-month` segment `Jan`…`Nov`, `ayCode` = the clicked line's year                                     |
| Application experience (★ bar)        | **new** route `/api/admissions/drill/feedback-rating` segment `1`–`5`, its own row kind and sheet                  |
| Withdrawn by level (slice)            | **new** `withdrawn-by-level` segment = level as applied                                                            |
| Entrance assessment (bar)             | **new** `assessment-all` segment `math:pass` … `eng:notAssessed` (terminal statuses included)                      |
| Cancellation reasons (slice)          | **new** `terminal-reason` segment `encodePairSegment('', reason)`; overflow → `encodePairSegment('', '__other__')` |
| Top reason per level (row) · See all  | `terminal-reason` segment `encodePairSegment(level, '')` · no segment                                              |
| By source (slice)                     | **new** `referral-all` segment = source; folded "Other" → `'__other__'`                                            |
| By category (bar)                     | **new** `category` segment = category, `ayCode` = that bar's year                                                  |
| Nationality mix · nationality × level | **new** `nationality` segment `encodePairSegment('', nationality)` · `encodePairSegment(level, nationality)`       |

**Facts established while writing this phase (read before building):**

- **`funnel-stage` Submitted does NOT count what "Applications received" counts today.** The card is `getConversionFunnel`'s Submitted stage = the five canonical non-terminal statuses (`getPipelineCounts`, `lib/admissions/dashboard.ts:202-225`, `:300-342`). The drill's Submitted branch (`lib/admissions/drill.ts:518-520`) keeps every row that is not Cancelled/Withdrawn — including blank status (`'No status'`) and any non-canonical status, which the card drops into "Other". `funnel-stage` has **no caller anywhere** (`grep -rn "funnel-stage" app components` finds none), so Task 3.5 aligns it in place through the shared `hasReachedFunnelStage` — no dashboard behaviour changes.
- **`avg-time` and `getAverageTimeToEnrollment` disagree in two edge cases.** The loader (`dashboard.ts:251-272`) compares the status untrimmed and rounds before rejecting negatives, so an `enrolledAt` up to 12 hours before `created_at` rounds to `-0` and is counted; the drill (`drill.ts:274-284`) trims the status and rejects `end < start`. Task 3.3 moves both onto one `daysToEnrol` (the drill's rule, which the range KPI `computeRangeKpis` and the histogram already use).
- **The Insights "Applications per month" is bucketed by UTC month of `created_at` with the year ignored, December dropped** (`lib/admissions/insights-compare.ts:97-138`). The existing `applications` target clamps by a `from`/`to` date range — a different predicate — so a new `intake-month` target is added. The loader also counts application rows with a blank `enroleeNumber`, which no drill can list; Task 3.3 drops them from the loader (`intakeRowsFromApps`).
- **The funnel/referral/category/nationality/withdrawn loaders join status-first; every drill joins application-first.** `loadFunnelRowsUncached` (`lib/admissions/insights-funnel.ts:101-114`) iterates `_enrolment_status` rows, so a status row with no application is counted (null level/source/nationality), an application with no status row is not, and a duplicated status row is counted twice. The drill (`drill.ts:242-252`) iterates applications and keeps the last status row per applicant. `loadTerminalReasonsUncached` (`lib/admissions/insights.ts:116-160`) has the same status-first shape, is not paginated (PostgREST caps it at 1,000 rows), and counts **any** status row with a non-null `applicationTerminalReason` whatever its status. Task 3.4 moves all of these to the drill's application-first join (`joinFunnelRows`, `joinTerminalReasonRows`) and adds a read-only probe that measures how far the figures move on production.
- **Three different "levels" are on this page.** `DrillRow.level` prefers the status table's `classLevel`; withdrawals and cancellation reasons group by the application's raw `levelApplied` (`trim() || 'Unknown'`); nationality × level groups by `canonicaliseLevelApplied(levelApplied)` (`'Not specified'` when blank). `DrillRow` gains `levelAsApplied` (raw) and each target resolves the level with the loader's own function (Review Focus #4).
- **Level labels contain `|`** (`'Youngstarters | Little Stars'`), so a `level|reason` segment cannot be split on the first `|`. Two-part segments are built with `encodePairSegment` (both halves URI-encoded, so the one literal `|` is the separator).
- **The "Top reason per level" row shows the level's total, not its top reason's count** (`page.tsx:453-457`, `lvl.count`). A row therefore opens every reason for that level (`encodePairSegment(level, '')`), not `level|topReason` as the spec table reads.
- **`lib/admissions/drill.ts` is bundled into the client** (`admissions-drill-sheet.tsx` imports values from it). Every predicate it shares with a loader must live in a module with no `'server-only'` — `insights-funnel.ts`, `insights.ts` and `insights-compare.ts` all import `'server-only'`. Task 3.1 creates `lib/admissions/insights-predicates.ts` (client-safe) and moves `canonicaliseNationality`, `canonicaliseLevelApplied`, `reasonLabel`, `TOP_REASON_COUNT` and `AY_MONTH_LABELS` there; the old modules re-export them so every existing import keeps working.
- **Feedback rows always carry an applicant number** — `loadFeedbackUncached` skips rows without one (`lib/admissions/feedback.ts:189`), so every rating row links (the spec's "may not" risk does not arise). The ★ histogram is computed inline on the page (`page.tsx:402-408`); Task 3.6 extracts it to `feedbackRatingBuckets`, which the drill filter shares.
- **No `initialRows` prefetch on this page.** The dashboard seeds `initialRows` as a placeholder; here a comparison-year click would paint the selected year's un-narrowed rows under the comparison year's title while it fetched. The Insights drills open on the skeleton instead, and the page makes no extra `buildDrillRows` call.
- **`buildDrillRows`' cache key must change** when `DrillRow` gains fields (same trap as `insights-funnel.ts:120-126`): old entries would serve rows without the new fields for 60 s. Task 3.5 bumps `'rows'` → `'rows-v2'`.
- Known, pre-existing, left as is: a parent-typed nationality literally `"Other"` or a referral source literally `"Other"` collides with the folded bucket's name on the chart itself; the drill follows the fold.

**Files touched in this phase**

- Create: `lib/admissions/insights-predicates.ts`, `lib/admissions/insights-drill-segments.ts`, `lib/admissions/feedback-drill.ts`, `app/api/admissions/drill/feedback-rating/route.ts`, `components/admissions/drills/feedback-rating-drill-sheet.tsx`, `components/admissions/drills/insights-drill-cards.tsx`, `scripts/probe-insights-drill-population.ts`
- Modify: `lib/admissions/dashboard.ts`, `lib/admissions/insights-compare.ts`, `lib/admissions/insights-funnel.ts`, `lib/admissions/insights.ts`, `lib/admissions/drill.ts`, `app/api/admissions/drill/[target]/route.ts`, `components/admissions/drills/admissions-drill-sheet.tsx`, `app/(admissions)/admissions/insights/page.tsx`, `__tests__/admissions/drill.test.ts`
- Tests created: `__tests__/admissions/insights-predicates.test.ts`, `__tests__/admissions/insights-drill-parity.test.ts`, `__tests__/admissions/insights-loader-alignment.test.ts`, `__tests__/admissions/insights-joins.test.ts`, `__tests__/admissions/drill-insights-targets.test.ts`, `__tests__/admissions/feedback-rating-drill.test.ts`, `__tests__/admissions/insights-drill-segments.test.ts`, `__tests__/admissions/insights-drill-cards.test.tsx`

---

### Task 3.1: One client-safe home for every Insights predicate

**Files:**

- Create: `lib/admissions/insights-predicates.ts`
- Modify: `lib/admissions/insights-funnel.ts` (remove lines 437-463 and 540-565 — `NATIONALITY_ALIASES`, `CANONICAL_BY_LOWER`, `canonicaliseNationality`, `canonicaliseLevelApplied` — and re-export them)
- Modify: `lib/admissions/insights.ts` (remove lines 9 `ReasonCount`, 67-74 `reasonLabel`, 78-80 `TOP_REASON_COUNT`; re-export them)
- Modify: `lib/admissions/insights-compare.ts` (remove lines 34-50 `AY_MONTH_LABELS` / `AyMonthLabel`; re-export them)
- Test: `__tests__/admissions/insights-predicates.test.ts`

**Interfaces:**

- Consumes: `COUNTRY_NAME_SET` (`lib/data/countries.ts`), `APPLICATION_TERMINAL_REASON_LABELS`, `ENROLEE_CATEGORIES` (`lib/schemas/sis.ts:1041`, `:164`).
- Produces (all from `lib/admissions/insights-predicates.ts`, no `'server-only'`):
  - `type KeyCount = { key: string; count: number }`; `function rankKeys(keys: Iterable<string>): KeyCount[]`
  - `const OVERFLOW_SEGMENT = '__other__'`
  - `function encodePairSegment(first: string, second: string): string`; `function decodePairSegment(segment: string): { first: string; second: string } | null`
  - `const FUNNEL_STAGES` (`'Submitted' | 'Ongoing Verification' | 'Processing' | 'Enrolled'`); `type FunnelStageName`; `function isFunnelStageName(value: string | null | undefined): value is FunnelStageName`; `function hasReachedFunnelStage(status: string | null | undefined, stage: FunnelStageName): boolean`
  - `function isEnrolledApplication(status: string | null | undefined): boolean`; `function daysToEnrol(input: { status: string | null | undefined; createdAt: string | null | undefined; enrolledAt: string | null | undefined }): number | null`
  - `const AY_MONTH_LABELS`; `type AyMonthLabel`; `function intakeMonthIndex(createdAt: string | null | undefined): number | null`
  - `function levelAsAppliedKey(raw: string | null | undefined): string`; `function isWithdrawnApplication(status: string | null | undefined): boolean`
  - `type ReasonCount = { reason: string; count: number }`; `const UNSPECIFIED_REASON = 'Unspecified'`; `const TOP_REASON_COUNT = 5`; `const OTHER_REASONS_BAR_KEY = 'other_reasons'`; `function terminalReasonKey(raw: string | null | undefined): string | null`; `function sortReasonCounts(keys: Iterable<string>): ReasonCount[]`; `function topReasonKeys(keys: Iterable<string>): Set<string>`; `function reasonLabel(reason: string): string`
  - `const REFERRAL_TOP_COUNT = 8`; `function referralSourceKey(raw: string | null | undefined): string`; `function referralBucketer(keys: Iterable<string>): (key: string) => string`
  - `const UNSPECIFIED_CATEGORY = 'Unspecified'`; `function categoryMixKey(raw: string | null | undefined): string`
  - `function canonicaliseNationality(value: string | null): string | null`; `function canonicaliseLevelApplied(raw: string | null): string`; `const NATIONALITY_MIX_LIMIT = 8`; `const NATIONALITY_BY_LEVEL_LIMIT = 6`; `function nationalityBucketer(values: Iterable<string | null>, limit: number): (value: string | null) => string`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/admissions/insights-predicates.test.ts
import { describe, expect, it } from 'vitest';

import { APPLICATION_TERMINAL_REASON_LABELS } from '@/lib/schemas/sis';
import {
  categoryMixKey,
  daysToEnrol,
  decodePairSegment,
  encodePairSegment,
  hasReachedFunnelStage,
  intakeMonthIndex,
  isFunnelStageName,
  isWithdrawnApplication,
  levelAsAppliedKey,
  nationalityBucketer,
  OVERFLOW_SEGMENT,
  rankKeys,
  reasonLabel,
  referralBucketer,
  referralSourceKey,
  terminalReasonKey,
  topReasonKeys,
} from '@/lib/admissions/insights-predicates';

describe('rankKeys', () => {
  it('orders by count, then by name', () => {
    expect(rankKeys(['b', 'a', 'b', 'c', 'a', 'd'])).toEqual([
      { key: 'a', count: 2 },
      { key: 'b', count: 2 },
      { key: 'c', count: 1 },
      { key: 'd', count: 1 },
    ]);
  });
});

describe('pair segments', () => {
  it('survive a level label that contains the separator', () => {
    const seg = encodePairSegment('Youngstarters | Little Stars', 'financial');
    expect(decodePairSegment(seg)).toEqual({
      first: 'Youngstarters | Little Stars',
      second: 'financial',
    });
  });
  it('carry an empty half as "any"', () => {
    expect(decodePairSegment(encodePairSegment('', OVERFLOW_SEGMENT))).toEqual({
      first: '',
      second: OVERFLOW_SEGMENT,
    });
  });
  it('reject a segment with no separator', () => {
    expect(decodePairSegment('financial')).toBeNull();
  });
});

describe('hasReachedFunnelStage', () => {
  it('counts the five canonical statuses as Submitted, trimmed', () => {
    for (const s of [
      'Submitted',
      'Ongoing Verification',
      ' Processing ',
      'Enrolled',
      'Enrolled (Conditional)',
    ]) {
      expect(hasReachedFunnelStage(s, 'Submitted')).toBe(true);
    }
  });
  it('counts a blank, unknown or terminal status in no stage', () => {
    for (const s of [
      '',
      null,
      'No status',
      'Deferred',
      'Cancelled',
      'Withdrawn',
    ]) {
      expect(hasReachedFunnelStage(s, 'Submitted')).toBe(false);
    }
  });
  it('is cumulative', () => {
    expect(hasReachedFunnelStage('Enrolled', 'Processing')).toBe(true);
    expect(hasReachedFunnelStage('Processing', 'Enrolled')).toBe(false);
  });
  it('recognises stage names', () => {
    expect(isFunnelStageName('Submitted')).toBe(true);
    expect(isFunnelStageName('Enrolled (Conditional)')).toBe(false);
    expect(isFunnelStageName(null)).toBe(false);
  });
});

describe('daysToEnrol', () => {
  const base = {
    status: 'Enrolled',
    createdAt: '2026-03-01T00:00:00Z',
    enrolledAt: '2026-04-01T00:00:00Z',
  };
  it('counts whole days from application to enrolment', () => {
    expect(daysToEnrol(base)).toBe(31);
  });
  it('reads a status with stray spaces as enrolled', () => {
    expect(daysToEnrol({ ...base, status: ' Enrolled (Conditional) ' })).toBe(
      31
    );
  });
  it('is null for anyone not enrolled or missing a timestamp', () => {
    expect(daysToEnrol({ ...base, status: 'Processing' })).toBeNull();
    expect(daysToEnrol({ ...base, enrolledAt: null })).toBeNull();
    expect(daysToEnrol({ ...base, createdAt: undefined })).toBeNull();
  });
  it('is null when enrolment is stamped before the application, even by hours', () => {
    expect(
      daysToEnrol({ ...base, enrolledAt: '2026-02-28T18:00:00Z' })
    ).toBeNull();
  });
});

describe('intakeMonthIndex', () => {
  it('uses the UTC month and ignores the year', () => {
    expect(intakeMonthIndex('2026-01-10T02:00:00Z')).toBe(0);
    expect(intakeMonthIndex('2025-03-31T20:00:00Z')).toBe(2);
  });
  it('drops December, blanks and unreadable dates', () => {
    expect(intakeMonthIndex('2025-12-15T00:00:00Z')).toBeNull();
    expect(intakeMonthIndex(null)).toBeNull();
    expect(intakeMonthIndex('not a date')).toBeNull();
  });
});

describe('level and withdrawal', () => {
  it('reads the level as applied, blank as Unknown', () => {
    expect(levelAsAppliedKey(' P1 ')).toBe('P1');
    expect(levelAsAppliedKey('   ')).toBe('Unknown');
    expect(levelAsAppliedKey(null)).toBe('Unknown');
  });
  it('recognises a withdrawn application with stray spaces', () => {
    expect(isWithdrawnApplication(' Withdrawn ')).toBe(true);
    expect(isWithdrawnApplication('Cancelled')).toBe(false);
  });
});

describe('terminal reasons', () => {
  it('keeps no reason as null and a blank reason as Unspecified', () => {
    expect(terminalReasonKey(null)).toBeNull();
    expect(terminalReasonKey(undefined)).toBeNull();
    expect(terminalReasonKey('   ')).toBe('Unspecified');
    expect(terminalReasonKey(' financial ')).toBe('financial');
  });
  it('names the top five by count, ties by name', () => {
    const keys = ['f', 'f', 'e', 'e', 'd', 'c', 'b', 'a'];
    expect([...topReasonKeys(keys)].sort()).toEqual(['a', 'b', 'c', 'e', 'f']);
  });
  it('labels a known code and passes free text through', () => {
    const [code, label] = Object.entries(APPLICATION_TERMINAL_REASON_LABELS)[0];
    expect(reasonLabel(code)).toBe(label);
    expect(reasonLabel('Moved to Johor')).toBe('Moved to Johor');
  });
});

describe('referral sources', () => {
  it('reads a blank source as Not specified', () => {
    expect(referralSourceKey('  ')).toBe('Not specified');
    expect(referralSourceKey(null)).toBe('Not specified');
  });
  it('keeps every source when there are eight or fewer', () => {
    const bucketOf = referralBucketer(['a', 'b', 'c']);
    expect(bucketOf('c')).toBe('c');
  });
  it('folds the sources past the top eight into the overflow bucket', () => {
    const keys = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].flatMap(
      (s, i) => Array.from({ length: i + 1 }, () => s)
    );
    const bucketOf = referralBucketer(keys);
    expect(bucketOf('J')).toBe('J');
    expect(bucketOf('C')).toBe('C');
    expect(bucketOf('B')).toBe(OVERFLOW_SEGMENT);
    expect(bucketOf('A')).toBe(OVERFLOW_SEGMENT);
  });
});

describe('categoryMixKey', () => {
  it('keeps a real category and folds anything else into Unspecified', () => {
    expect(categoryMixKey(' Current ')).toBe('Current');
    expect(categoryMixKey('New')).toBe('New');
    expect(categoryMixKey('nonsense')).toBe('Unspecified');
    expect(categoryMixKey(null)).toBe('Unspecified');
  });
});

describe('nationalityBucketer', () => {
  it('names the top N, folds the rest into Other, blank into Unspecified', () => {
    const values = [
      'Singapore',
      'Singapore',
      'Philippines',
      'Philippines',
      'India',
      null,
    ];
    const bucketOf = nationalityBucketer(values, 2);
    expect(bucketOf('singapore')).toBe('Singapore');
    expect(bucketOf('India')).toBe('Other');
    expect(bucketOf('  ')).toBe('Unspecified');
  });
  it('merges the two spellings of Vietnam before ranking', () => {
    const bucketOf = nationalityBucketer(['Viet Nam', 'Vietnam', 'India'], 1);
    expect(bucketOf('Viet Nam')).toBe('Vietnam');
    expect(bucketOf('India')).toBe('Other');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run __tests__/admissions/insights-predicates.test.ts --pool=threads`
Expected: FAIL — `Failed to resolve import "@/lib/admissions/insights-predicates"`.

- [ ] **Step 3: Create the module**

```ts
// lib/admissions/insights-predicates.ts
//
// The ONE copy of every rule an Admissions Insights number is counted with.
// The Insights loaders (dashboard.ts, insights-compare.ts, insights-funnel.ts,
// insights.ts) count with these, and the drill targets that list the rows
// behind those numbers (drill.ts) filter with the same functions — a drill
// with its own copy of a rule drifts from the number it opens from
// (KD #82/#124, KD #229).
//
// ⚠ CLIENT-SAFE ON PURPOSE. lib/admissions/drill.ts is imported by the client
// drill sheet and imports this file, so nothing here may import
// 'server-only', next/cache or a Supabase client.

import { COUNTRY_NAME_SET } from '@/lib/data/countries';
import {
  APPLICATION_TERMINAL_REASON_LABELS,
  ENROLEE_CATEGORIES,
} from '@/lib/schemas/sis';

// ── Ranking ────────────────────────────────────────────────────────────────

export type KeyCount = { key: string; count: number };

/** Count each key; most frequent first, ties broken by key (localeCompare).
 *  The single ordering every Insights top-N ranks with — reasons, referral
 *  sources, nationalities — so a drill's overflow bucket is the chart's. */
export function rankKeys(keys: Iterable<string>): KeyCount[] {
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Segment value for a top-N chart's folded "Other" slice. */
export const OVERFLOW_SEGMENT = '__other__';

// ── Two-part segments ──────────────────────────────────────────────────────
// A level label can contain '|' ("Youngstarters | Little Stars"), so both
// halves are URI-encoded (encodeURIComponent turns '|' into %7C) and the one
// literal '|' left is the separator. An empty half means "any".

export function encodePairSegment(first: string, second: string): string {
  return `${encodeURIComponent(first)}|${encodeURIComponent(second)}`;
}

export function decodePairSegment(
  segment: string
): { first: string; second: string } | null {
  const bar = segment.indexOf('|');
  if (bar === -1) return null;
  try {
    return {
      first: decodeURIComponent(segment.slice(0, bar)),
      second: decodeURIComponent(segment.slice(bar + 1)),
    };
  } catch {
    return null;
  }
}

// ── Funnel ─────────────────────────────────────────────────────────────────
// Cumulative: every enrolled application also passed verification and
// processing. A blank, unrecognised, Cancelled or Withdrawn status reaches no
// stage — the statuses getConversionFunnel has always left out.

export const FUNNEL_STAGES = [
  'Submitted',
  'Ongoing Verification',
  'Processing',
  'Enrolled',
] as const;
export type FunnelStageName = (typeof FUNNEL_STAGES)[number];

const ENROLLED_STATUSES = ['Enrolled', 'Enrolled (Conditional)'] as const;

const REACHED_STAGE: Record<FunnelStageName, ReadonlySet<string>> = {
  Submitted: new Set([
    'Submitted',
    'Ongoing Verification',
    'Processing',
    ...ENROLLED_STATUSES,
  ]),
  'Ongoing Verification': new Set([
    'Ongoing Verification',
    'Processing',
    ...ENROLLED_STATUSES,
  ]),
  Processing: new Set(['Processing', ...ENROLLED_STATUSES]),
  Enrolled: new Set(ENROLLED_STATUSES),
};

export function isFunnelStageName(
  value: string | null | undefined
): value is FunnelStageName {
  return (FUNNEL_STAGES as readonly string[]).includes(value ?? '');
}

export function hasReachedFunnelStage(
  status: string | null | undefined,
  stage: FunnelStageName
): boolean {
  return REACHED_STAGE[stage].has((status ?? '').trim());
}

// ── Enrolment ──────────────────────────────────────────────────────────────

export function isEnrolledApplication(
  status: string | null | undefined
): boolean {
  return (ENROLLED_STATUSES as readonly string[]).includes(
    (status ?? '').trim()
  );
}

/** Whole days from application (`created_at`) to enrolment (`enrolledAt`,
 *  migration 075). Null when not enrolled, when either timestamp is missing
 *  or unreadable, or when enrolment is stamped before the application. */
export function daysToEnrol(input: {
  status: string | null | undefined;
  createdAt: string | null | undefined;
  enrolledAt: string | null | undefined;
}): number | null {
  if (!isEnrolledApplication(input.status)) return null;
  if (!input.createdAt || !input.enrolledAt) return null;
  const start = Date.parse(input.createdAt);
  const end = Date.parse(input.enrolledAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000);
}

// ── Intake month ───────────────────────────────────────────────────────────

/** HFSE AY months in order (Jan = 0 … Nov = 10). December is excluded — it
 *  falls outside the HFSE academic year window (KD #13). */
export const AY_MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
] as const;

export type AyMonthLabel = (typeof AY_MONTH_LABELS)[number];

/** The intake chart's month for an application: the UTC month of
 *  `created_at`, year ignored. Null for December, blank or unreadable. */
export function intakeMonthIndex(
  createdAt: string | null | undefined
): number | null {
  if (!createdAt) return null;
  const month = new Date(createdAt).getUTCMonth();
  if (Number.isNaN(month) || month > 10) return null;
  return month;
}

// ── Level as applied / withdrawal ─────────────────────────────────────────

/** The application's own `levelApplied`, blank as 'Unknown' — the level the
 *  withdrawn and cancellation-reason charts group by. */
export function levelAsAppliedKey(raw: string | null | undefined): string {
  return (raw ?? '').trim() || 'Unknown';
}

export function isWithdrawnApplication(
  status: string | null | undefined
): boolean {
  return (status ?? '').trim() === 'Withdrawn';
}

// ── Terminal (cancellation) reasons ────────────────────────────────────────

export type ReasonCount = { reason: string; count: number };

export const UNSPECIFIED_REASON = 'Unspecified';

/** How many individual reasons the donut names before folding the rest into
 *  a single "Other reasons" bucket. */
export const TOP_REASON_COUNT = 5;

/** The overflow bar's key in selectTopReasonBars (lib/admissions/insights.ts). */
export const OTHER_REASONS_BAR_KEY = 'other_reasons';

/** Null = no reason recorded (not on the chart at all); a blank reason is
 *  'Unspecified'. */
export function terminalReasonKey(
  raw: string | null | undefined
): string | null {
  if (raw === null || raw === undefined) return null;
  return raw.trim() || UNSPECIFIED_REASON;
}

export function sortReasonCounts(keys: Iterable<string>): ReasonCount[] {
  return rankKeys(keys).map(({ key, count }) => ({ reason: key, count }));
}

export function topReasonKeys(keys: Iterable<string>): Set<string> {
  return new Set(
    sortReasonCounts(keys)
      .slice(0, TOP_REASON_COUNT)
      .map((r) => r.reason)
  );
}

/** Humanize a terminal-reason code via the schema label map; fall back to the
 *  raw stored string (e.g. 'Unspecified' / 'Other free-text') when unmapped. */
export function reasonLabel(reason: string): string {
  return (
    (APPLICATION_TERMINAL_REASON_LABELS as Record<string, string>)[reason] ??
    reason
  );
}

// ── Referral source ────────────────────────────────────────────────────────

export const REFERRAL_TOP_COUNT = 8;

export function referralSourceKey(raw: string | null | undefined): string {
  return (raw ?? '').trim() || 'Not specified';
}

/** Maps a source key to itself when it is among the top eight, else to
 *  OVERFLOW_SEGMENT. Every source keeps its name when there are ≤ 8. */
export function referralBucketer(
  keys: Iterable<string>
): (key: string) => string {
  const ranked = rankKeys(keys);
  if (ranked.length <= REFERRAL_TOP_COUNT) return (key) => key;
  const named = new Set(ranked.slice(0, REFERRAL_TOP_COUNT).map((r) => r.key));
  return (key) => (named.has(key) ? key : OVERFLOW_SEGMENT);
}

// ── Category ───────────────────────────────────────────────────────────────

export const UNSPECIFIED_CATEGORY = 'Unspecified';

const CATEGORY_SET: ReadonlySet<string> = new Set(ENROLEE_CATEGORIES);

export function categoryMixKey(raw: string | null | undefined): string {
  const cat = (raw ?? '').trim();
  return cat && CATEGORY_SET.has(cat) ? cat : UNSPECIFIED_CATEGORY;
}

// ── Nationality ────────────────────────────────────────────────────────────
// Moved verbatim from lib/admissions/insights-funnel.ts (which re-exports
// them) — see the measurement notes there (probe 2026-08-17).

/** Spelling variants seen in production that `countries-list` names
 *  differently. Keyed lowercase; extend only from probe output, never from
 *  imagination. */
const NATIONALITY_ALIASES: Record<string, string> = {
  'viet nam': 'Vietnam',
};

/** lowercase country name → its canonical casing, built once. */
const CANONICAL_BY_LOWER: Map<string, string> = new Map(
  Array.from(COUNTRY_NAME_SET, (name) => [name.toLowerCase(), name])
);

/**
 * Trim, collapse internal whitespace, apply a known alias, then snap to the
 * canonical country-name casing when we recognise it. An unrecognised value
 * is preserved exactly as the parent typed it. Returns null for blank/null,
 * which the caller buckets as 'Unspecified'.
 */
export function canonicaliseNationality(value: string | null): string | null {
  const trimmed = (value ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  const aliased = NATIONALITY_ALIASES[trimmed.toLowerCase()] ?? trimmed;
  return CANONICAL_BY_LOWER.get(aliased.toLowerCase()) ?? aliased;
}

/**
 * Admissions' `levelApplied` is free text and drifts (measured 2026-08-17).
 * Folds the SPELLING variants of the Youngstarters programme together and
 * nothing else; blank → 'Not specified'; anything unrecognised passes
 * through untouched.
 */
export function canonicaliseLevelApplied(raw: string | null): string {
  const trimmed = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'Not specified';
  const flat = trimmed.toLowerCase().replace(/[^a-z]/g, '');
  if (flat.startsWith('youngstarter')) {
    if (flat.includes('little')) return 'Youngstarters | Little Stars';
    if (flat.includes('junior')) return 'Youngstarters | Junior Stars';
    if (flat.includes('senior')) return 'Youngstarters | Senior Stars';
    return 'Youngstarters';
  }
  return trimmed;
}

/** Top nationalities named on the mix pie. */
export const NATIONALITY_MIX_LIMIT = 8;
/** Top nationalities named on the nationality × level bars. */
export const NATIONALITY_BY_LEVEL_LIMIT = 6;

/** Maps a raw nationality to the bucket the chart draws it in: its canonical
 *  name when among the top `limit`, 'Other' past it, 'Unspecified' blank. */
export function nationalityBucketer(
  values: Iterable<string | null>,
  limit: number
): (value: string | null) => string {
  const names: string[] = [];
  for (const v of values) {
    const name = canonicaliseNationality(v);
    if (name) names.push(name);
  }
  const top = new Set(
    rankKeys(names)
      .slice(0, Math.max(0, limit))
      .map((r) => r.key)
  );
  return (value) => {
    const name = canonicaliseNationality(value);
    if (!name) return 'Unspecified';
    return top.has(name) ? name : 'Other';
  };
}
```

- [ ] **Step 4: Point the three old homes at it**

In `lib/admissions/insights-funnel.ts`: delete lines 437-463 (`NATIONALITY_ALIASES`, `CANONICAL_BY_LOWER`, `canonicaliseNationality` with their comments) and lines 540-565 (`canonicaliseLevelApplied` with its comment); delete the now-unused `import { COUNTRY_NAME_SET } from '@/lib/data/countries';` (line 6); and add below the imports:

```ts
import {
  canonicaliseLevelApplied,
  canonicaliseNationality,
} from '@/lib/admissions/insights-predicates';

// Moved to the client-safe predicates module (KD #229); re-exported so every
// existing import of these from here keeps working.
export { canonicaliseLevelApplied, canonicaliseNationality };
```

In `lib/admissions/insights.ts`: delete line 9 (`export type ReasonCount …`), lines 66-74 (`reasonLabel` + comment) and lines 78-80 (`TOP_REASON_COUNT` + comment); delete the now-unused `APPLICATION_TERMINAL_REASON_LABELS` import (line 7); add below the imports:

```ts
import {
  reasonLabel,
  TOP_REASON_COUNT,
  type ReasonCount,
} from '@/lib/admissions/insights-predicates';

export { reasonLabel, TOP_REASON_COUNT, type ReasonCount };
```

In `lib/admissions/insights-compare.ts`: delete lines 30-50 (`AY_MONTH_LABELS`, `AyMonthLabel` and their banner/comment); add below the imports:

```ts
import {
  AY_MONTH_LABELS,
  type AyMonthLabel,
} from '@/lib/admissions/insights-predicates';

export { AY_MONTH_LABELS, type AyMonthLabel };
```

- [ ] **Step 5: Run the new test and the tests of the three moved-from modules**

Run: `npx vitest run __tests__/admissions/insights-predicates.test.ts __tests__/admissions/insights-nationality.test.ts __tests__/admissions/insights.test.ts __tests__/admissions/insights-compare.test.ts __tests__/admissions/insights-funnel.test.ts --pool=threads`
Expected: PASS (all files).

- [ ] **Step 6: Commit**

```bash
git add lib/admissions/insights-predicates.ts lib/admissions/insights-funnel.ts lib/admissions/insights.ts lib/admissions/insights-compare.ts __tests__/admissions/insights-predicates.test.ts && git commit -m "refactor(admissions): one client-safe home for the Insights predicates

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.2: Parity tests — every Insights figure equals its drill's row count (red)

**Files:**

- Test: `__tests__/admissions/insights-drill-parity.test.ts`

**Interfaces:**

- Consumes: `getConversionFunnel`, `getAverageTimeToEnrollment`, `getConversionByAssessment` (`lib/admissions/dashboard.ts`); `getIntakeTrendByAy` (`insights-compare.ts:222`); `getWithdrawnByLevel`, `getReferralConversion`, `getCategoryMix`, `getNationalityMix`, `getApplicantNationalityByLevel` (`insights-funnel.ts:643-688`); `getAdmissionsTerminalReasons`, `selectTopReasonBars` (`insights.ts`); `buildDrillRows`, `applyTargetFilter` (`drill.ts:434`, `:483`); predicates from Task 3.1.
- Produces: the guard every later task in this phase turns green. `ReferralConversionRow.folded` (Task 3.4) and the seven new targets (Task 3.5) are referenced here before they exist — that is the red.

- [ ] **Step 1: Write the test**

```ts
// __tests__/admissions/insights-drill-parity.test.ts
//
// KD #82/#124/#229: every figure on /admissions/insights equals the row count
// of the drill it opens. The fixture carries every case that has broken this
// before: blank and unknown statuses, a status with stray spaces, an
// application with no applicant number, a status row with no application, a
// duplicated status row, an enrolment stamped hours before its application,
// a level label containing '|', and enough reasons / sources / nationalities
// to force each top-N chart to fold an "Other" bucket. Two academic years, so
// the comparison year is checked on its own rows.

import { describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
}));

vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
}));

vi.mock('@/lib/supabase/admissions', () => ({
  createAdmissionsClient: () => ({
    from: (table: string) => ({
      select: () => ({
        range: () =>
          Promise.resolve({ data: fx.tables[table] ?? [], error: null }),
      }),
    }),
  }),
}));

import {
  getAverageTimeToEnrollment,
  getConversionByAssessment,
  getConversionFunnel,
} from '@/lib/admissions/dashboard';
import { applyTargetFilter, buildDrillRows } from '@/lib/admissions/drill';
import {
  getAdmissionsTerminalReasons,
  selectTopReasonBars,
} from '@/lib/admissions/insights';
import { getIntakeTrendByAy } from '@/lib/admissions/insights-compare';
import {
  getApplicantNationalityByLevel,
  getCategoryMix,
  getNationalityMix,
  getReferralConversion,
  getWithdrawnByLevel,
} from '@/lib/admissions/insights-funnel';
import {
  encodePairSegment,
  OTHER_REASONS_BAR_KEY,
  OVERFLOW_SEGMENT,
} from '@/lib/admissions/insights-predicates';

// ── Fixture ───────────────────────────────────────────────────────────────

const STATUSES = [
  'Submitted',
  'Ongoing Verification',
  'Processing',
  'Enrolled',
  'Enrolled (Conditional)',
  'Cancelled',
  'Withdrawn',
  '',
  'Deferred',
  'Enrolled ',
];
const LEVELS = [
  'P1',
  'P2',
  'S1',
  'Youngstarters | Little Stars',
  'YoungStarter Little Star',
  '',
  null,
];
const SOURCES = [
  'Facebook',
  'Google',
  'Friend',
  'Walk-in',
  'Instagram',
  'Newspaper',
  'Event',
  'Agent',
  'Radio',
  'Billboard',
  '',
  null,
];
const CATEGORIES = ['New', 'Current', 'VizSchool New', 'Nonsense', null];
const NATIONALITIES = [
  'Singapore',
  'Singapore',
  'Philippines',
  'Philippines',
  'Viet Nam',
  'Vietnam',
  'India',
  'China',
  'Japan',
  'Malaysia',
  'Indonesia',
  'Thailand',
  'Australia',
  'Canada',
  null,
  '  ',
];
const REASONS = [
  'chose_another_school',
  'visa_denied',
  'lost_interest',
  'financial',
  'family_relocation',
  'Moved to Johor',
  'Health',
  '   ',
  null,
];
const GRADES = ['<p>93.55% (29/31)</p>', '40%', null, 'B', 'F'];
const CREATED = [
  '2026-01-10T02:00:00.000Z',
  '2026-02-03T09:00:00.000Z',
  '2026-03-31T20:00:00.000Z',
  '2025-12-15T03:00:00.000Z',
  '2026-07-01T01:00:00.000Z',
  '2026-11-30T05:00:00.000Z',
];

function buildYear(prefix: string, n: number, seed: number) {
  const apps: Array<Record<string, unknown>> = [];
  const statuses: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) {
    const k = i + seed;
    const enroleeNumber = `E${seed}-${i}`;
    const createdAt = i % 17 === 0 ? null : CREATED[k % CREATED.length];
    const enrolledAt =
      createdAt && i % 4 !== 0
        ? new Date(
            Date.parse(createdAt) +
              (i % 4 === 1 ? -6 * 3_600_000 : (k % 40) * 86_400_000)
          ).toISOString()
        : null;
    apps.push({
      enroleeNumber,
      studentNumber: null,
      enroleeFullName: `Child ${seed}-${i}`,
      firstName: 'Child',
      lastName: `${seed}-${i}`,
      levelApplied: LEVELS[k % LEVELS.length],
      created_at: createdAt,
      howDidYouKnowAboutHFSEIS: SOURCES[k % SOURCES.length],
      category: CATEGORIES[k % CATEGORIES.length],
      nationality: NATIONALITIES[k % NATIONALITIES.length],
    });
    statuses.push({
      enroleeNumber,
      applicationStatus: STATUSES[k % STATUSES.length],
      applicationUpdatedDate: null,
      enrolledAt,
      classLevel: i % 5 === 0 ? 'P3' : null,
      levelApplied: null,
      assessmentGradeMath: GRADES[k % GRADES.length],
      assessmentGradeEnglish: GRADES[(k + 2) % GRADES.length],
      applicationTerminalReason:
        i % 2 === 0 ? REASONS[k % REASONS.length] : null,
    });
  }
  // An application with no applicant number — no drill can list it.
  apps.push({
    enroleeNumber: null,
    enroleeFullName: 'No number',
    levelApplied: 'P1',
    created_at: '2026-01-20T00:00:00.000Z',
    howDidYouKnowAboutHFSEIS: 'Facebook',
    category: 'New',
    nationality: 'Singapore',
  });
  // A status row with no application behind it.
  statuses.push({
    enroleeNumber: `ORPHAN-${seed}`,
    applicationStatus: 'Withdrawn',
    applicationTerminalReason: 'financial',
  });
  // A second status row for one applicant — the last one wins.
  statuses.push({
    enroleeNumber: `E${seed}-5`,
    applicationStatus: 'Cancelled',
    applicationTerminalReason: 'visa_denied',
  });
  fx.tables[`${prefix}_enrolment_applications`] = apps;
  fx.tables[`${prefix}_enrolment_status`] = statuses;
}

buildYear('ay2026', 60, 0);
buildYear('ay2025', 25, 7);

const YEARS = ['AY2026', 'AY2025'] as const;

// ── Demand & conversion ───────────────────────────────────────────────────

describe('Applications received, conversion rate and average days', () => {
  it.each(YEARS)(
    '%s: Applications received equals the Submitted list',
    async (ay) => {
      const funnel = await getConversionFunnel(ay);
      const rows = await buildDrillRows({ ayCode: ay });
      const submitted = funnel.find((s) => s.stage === 'Submitted')!.count;
      expect(submitted).toBeGreaterThan(0);
      expect(applyTargetFilter(rows, 'funnel-stage', 'Submitted')).toHaveLength(
        submitted
      );
    }
  );

  it('the enrolled share of that list is the conversion numerator', async () => {
    const funnel = await getConversionFunnel('AY2026');
    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    const enrolled = funnel.find((s) => s.stage === 'Enrolled')!.count;
    const list = applyTargetFilter(rows, 'funnel-stage', 'Submitted');
    expect(
      list.filter(
        (r) => r.status === 'Enrolled' || r.status === 'Enrolled (Conditional)'
      )
    ).toHaveLength(enrolled);
  });

  it('Avg. days to enrol: the sample is the list, the average its mean', async () => {
    const t = await getAverageTimeToEnrollment('AY2026');
    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    const list = applyTargetFilter(rows, 'avg-time');
    expect(t.sampleSize).toBeGreaterThan(0);
    expect(list).toHaveLength(t.sampleSize);
    const mean = Math.round(
      list.reduce((s, r) => s + (r.daysToEnroll ?? 0), 0) / list.length
    );
    expect(t.avgDays).toBe(mean);
  });
});

describe('Applications per month', () => {
  it('each point, in both years, equals that year’s intake-month list', async () => {
    const points = await getIntakeTrendByAy([
      { ayCode: 'AY2026', isCurrent: false },
      { ayCode: 'AY2025', isCurrent: false },
    ]);
    for (const ay of YEARS) {
      const rows = await buildDrillRows({ ayCode: ay });
      const mine = points.filter((p) => p.ayCode === ay);
      expect(mine.length).toBe(11);
      for (const p of mine) {
        expect(
          applyTargetFilter(rows, 'intake-month', p.periodLabel)
        ).toHaveLength(p.value ?? 0);
      }
    }
  });
});

// ── Who & why we lose ─────────────────────────────────────────────────────

describe('Withdrawn by level', () => {
  it('each slice and the total equal the withdrawn-by-level list', async () => {
    const byLevel = await getWithdrawnByLevel('AY2026');
    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    expect(byLevel.length).toBeGreaterThan(1);
    for (const r of byLevel) {
      expect(
        applyTargetFilter(rows, 'withdrawn-by-level', r.level)
      ).toHaveLength(r.count);
    }
    expect(applyTargetFilter(rows, 'withdrawn-by-level')).toHaveLength(
      byLevel.reduce((s, r) => s + r.count, 0)
    );
  });
});

describe('Entrance assessment', () => {
  it('each bar opens exactly the applicants it is a rate of', async () => {
    const conv = await getConversionByAssessment('AY2026');
    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    const OUTCOME = {
      Pass: 'pass',
      Fail: 'fail',
      'Not assessed': 'notAssessed',
    };
    expect(conv.length).toBe(6);
    for (const c of conv) {
      const seg = `${c.subject === 'Math' ? 'math' : 'eng'}:${OUTCOME[c.outcome]}`;
      expect(applyTargetFilter(rows, 'assessment-all', seg)).toHaveLength(
        c.applied
      );
    }
  });
});

describe('Cancellation reasons', () => {
  it('each slice — the overflow included — equals its list', async () => {
    const t = await getAdmissionsTerminalReasons('AY2026');
    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    const bars = selectTopReasonBars(t.overall);
    expect(bars.some((b) => b.key === OTHER_REASONS_BAR_KEY)).toBe(true);
    for (const b of bars) {
      const seg = encodePairSegment(
        '',
        b.key === OTHER_REASONS_BAR_KEY ? OVERFLOW_SEGMENT : b.key
      );
      expect(applyTargetFilter(rows, 'terminal-reason', seg)).toHaveLength(
        b.count
      );
    }
    expect(applyTargetFilter(rows, 'terminal-reason')).toHaveLength(t.total);
  });

  it('each "top reason per level" row equals its level’s list', async () => {
    const t = await getAdmissionsTerminalReasons('AY2026');
    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    expect(t.byLevel.some((l) => l.level.includes('|'))).toBe(true);
    for (const lvl of t.byLevel) {
      expect(
        applyTargetFilter(
          rows,
          'terminal-reason',
          encodePairSegment(lvl.level, '')
        )
      ).toHaveLength(lvl.count);
    }
  });
});

// ── Channels & segments ───────────────────────────────────────────────────

describe('By source', () => {
  it('each slice — the folded Other included — equals its list', async () => {
    const refs = await getReferralConversion('AY2026');
    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    expect(refs.some((r) => r.folded === true)).toBe(true);
    for (const r of refs) {
      expect(
        applyTargetFilter(
          rows,
          'referral-all',
          r.folded ? OVERFLOW_SEGMENT : r.source
        )
      ).toHaveLength(r.applied);
    }
  });
});

describe('By category', () => {
  it.each(YEARS)('%s: each bar equals its category list', async (ay) => {
    const mix = await getCategoryMix(ay);
    const rows = await buildDrillRows({ ayCode: ay });
    expect(mix.some((c) => c.category === 'Unspecified')).toBe(true);
    for (const c of mix) {
      expect(applyTargetFilter(rows, 'category', c.category)).toHaveLength(
        c.count
      );
    }
  });
});

describe('Nationality', () => {
  it('each pie slice — Other and Unspecified included — equals its list', async () => {
    const mix = await getNationalityMix('AY2026');
    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    expect(mix.some((r) => r.nationality === 'Other')).toBe(true);
    expect(mix.some((r) => r.nationality === 'Unspecified')).toBe(true);
    for (const r of mix) {
      expect(
        applyTargetFilter(
          rows,
          'nationality',
          encodePairSegment('', r.nationality)
        )
      ).toHaveLength(r.count);
    }
  });

  it('each level × nationality segment equals its list', async () => {
    const byLevel = await getApplicantNationalityByLevel('AY2026');
    const rows = await buildDrillRows({ ayCode: 'AY2026' });
    expect(byLevel.legend).toContain('Other');
    for (const lvl of byLevel.rows) {
      for (const seg of lvl.segments) {
        expect(
          applyTargetFilter(
            rows,
            'nationality',
            encodePairSegment(lvl.level, seg.nationality)
          )
        ).toHaveLength(seg.count);
      }
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run __tests__/admissions/insights-drill-parity.test.ts --pool=threads`
Expected: FAIL — the funnel test (blank/`Deferred` statuses are in the drill's Submitted list), the avg-days test (the `-6h` enrolment is in the loader's sample), the intake test (the no-number application is in the loader's January), and every new-target test (an unknown target returns every row; `folded` is undefined). No test passes except possibly the conversion-numerator one.

- [ ] **Step 3: Commit the red test**

```bash
git add __tests__/admissions/insights-drill-parity.test.ts && git commit -m "test(admissions): insights figure = drill row count, red until the targets land

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.3: The funnel, the average and the intake trend count with the shared rules

**Files:**

- Modify: `lib/admissions/dashboard.ts` (delete lines 42-59 `PIPELINE_STATUSES`/`PipelineStatus`/`PipelineCounts` and 202-225 `getPipelineCounts`; rewrite 251-272 `computeAverageTimeToEnrollment` and 297-342 `getConversionFunnel`)
- Modify: `lib/admissions/insights-compare.ts` (`shapeIntakeTrendPoints` lines 104-115; loader lines 184-203)
- Test: `__tests__/admissions/insights-loader-alignment.test.ts`

**Interfaces:**

- Consumes: `daysToEnrol`, `FUNNEL_STAGES`, `hasReachedFunnelStage`, `intakeMonthIndex` (Task 3.1).
- Produces: `export function computeConversionFunnel(rows: Pick<JoinedRow, 'applicationStatus'>[]): FunnelStage[]` (`dashboard.ts`); `export function intakeRowsFromApps(ayCode: string, apps: { enroleeNumber: string | null; created_at: string | null }[]): { ayCode: string; createdAt: string | null }[]` (`insights-compare.ts`). `getConversionFunnel` and `getAverageTimeToEnrollment` keep their signatures.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/admissions/insights-loader-alignment.test.ts
import { describe, expect, it } from 'vitest';

import {
  computeAverageTimeToEnrollment,
  computeConversionFunnel,
} from '@/lib/admissions/dashboard';
import {
  intakeRowsFromApps,
  shapeIntakeTrendPoints,
} from '@/lib/admissions/insights-compare';

describe('computeConversionFunnel', () => {
  it('counts a blank or unrecognised status in no stage, and trims', () => {
    const funnel = computeConversionFunnel([
      { applicationStatus: 'Submitted' },
      { applicationStatus: ' Processing ' },
      { applicationStatus: 'Enrolled (Conditional)' },
      { applicationStatus: '' },
      { applicationStatus: null },
      { applicationStatus: 'Deferred' },
      { applicationStatus: 'Cancelled' },
    ]);
    expect(funnel.map((s) => [s.stage, s.count])).toEqual([
      ['Submitted', 3],
      ['Ongoing Verification', 2],
      ['Processing', 2],
      ['Enrolled', 1],
    ]);
    expect(funnel.map((s) => s.dropOffPct)).toEqual([0, 33, 0, 50]);
  });
});

describe('computeAverageTimeToEnrollment — the drill’s rule', () => {
  it('leaves out an enrolment stamped hours before its application', () => {
    expect(
      computeAverageTimeToEnrollment([
        {
          applicationStatus: 'Enrolled',
          created_at: '2026-03-01T12:00:00Z',
          enrolledAt: '2026-03-01T06:00:00Z',
        },
      ]).sampleSize
    ).toBe(0);
  });

  it('reads a status with stray spaces as enrolled', () => {
    expect(
      computeAverageTimeToEnrollment([
        {
          applicationStatus: 'Enrolled ',
          created_at: '2026-03-01T00:00:00Z',
          enrolledAt: '2026-03-11T00:00:00Z',
        },
      ])
    ).toEqual({ avgDays: 10, sampleSize: 1 });
  });
});

describe('intake trend rows', () => {
  it('drops an application with no applicant number', () => {
    expect(
      intakeRowsFromApps('AY2026', [
        { enroleeNumber: 'E1', created_at: '2026-01-05T00:00:00Z' },
        { enroleeNumber: null, created_at: '2026-01-06T00:00:00Z' },
        { enroleeNumber: '', created_at: '2026-01-07T00:00:00Z' },
      ])
    ).toEqual([{ ayCode: 'AY2026', createdAt: '2026-01-05T00:00:00Z' }]);
  });

  it('ignores an unreadable date', () => {
    const points = shapeIntakeTrendPoints(
      [
        { ayCode: 'AY2026', createdAt: 'not a date' },
        { ayCode: 'AY2026', createdAt: '2026-02-01T00:00:00Z' },
      ],
      new Map([['AY2026', 10]])
    );
    expect(points.find((p) => p.periodLabel === 'Feb')?.value).toBe(1);
    expect(points.reduce((s, p) => s + (p.value ?? 0), 0)).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run __tests__/admissions/insights-loader-alignment.test.ts --pool=threads`
Expected: FAIL — `computeConversionFunnel` and `intakeRowsFromApps` are not exported (`is not a function`); the hours-before case reports `sampleSize: 1`; the stray-spaces case reports `sampleSize: 0`.

- [ ] **Step 3: Implement in `lib/admissions/dashboard.ts`**

Add to the imports:

```ts
import {
  daysToEnrol,
  FUNNEL_STAGES,
  hasReachedFunnelStage,
} from '@/lib/admissions/insights-predicates';
```

Delete lines 42-59 (the `PIPELINE_STATUSES` comment, constant, `PipelineStatus` and `PipelineCounts`) and lines 198-225 (the "Aggregators" banner stays — delete only `getPipelineCounts`, lines 202-225). Replace `computeAverageTimeToEnrollment` (lines 250-272) with:

```ts
/** Pure helper — testable without the cache layer. Same rule as the
 *  `avg-time` drill row (`daysToEnrol`, lib/admissions/insights-predicates.ts),
 *  so the card's sample is exactly the list it opens (KD #229). */
export function computeAverageTimeToEnrollment(
  rows: Pick<JoinedRow, 'applicationStatus' | 'created_at' | 'enrolledAt'>[]
): TimeToEnrollment {
  let total = 0;
  let n = 0;
  for (const r of rows) {
    const days = daysToEnrol({
      status: r.applicationStatus,
      createdAt: r.created_at,
      enrolledAt: r.enrolledAt,
    });
    if (days === null) continue;
    total += days;
    n += 1;
  }
  return { avgDays: n > 0 ? Math.round(total / n) : 0, sampleSize: n };
}
```

Replace `getConversionFunnel` and its comment (lines 297-342) with:

```ts
// Funnel counts are cumulative: every enrolled application also passed
// through verification and processing, so a status counts toward every
// earlier stage. The stage rule is the shared `hasReachedFunnelStage`, which
// the `funnel-stage` drill filters with too (KD #229) — a blank or
// unrecognised status reaches no stage, on the card and in the list.
/** Pure — exported for unit tests. */
export function computeConversionFunnel(
  rows: Pick<JoinedRow, 'applicationStatus'>[]
): FunnelStage[] {
  const stages = FUNNEL_STAGES.map((stage) => ({
    stage,
    count: rows.filter((r) => hasReachedFunnelStage(r.applicationStatus, stage))
      .length,
  }));
  const out: FunnelStage[] = [];
  for (let i = 0; i < stages.length; i++) {
    const prev = i === 0 ? stages[i].count : stages[i - 1].count;
    const dropOffPct =
      prev > 0 && i > 0
        ? Math.round(((prev - stages[i].count) / prev) * 100)
        : 0;
    out.push({ ...stages[i], dropOffPct });
  }
  return out;
}

export async function getConversionFunnel(
  ayCode: string
): Promise<FunnelStage[]> {
  return computeConversionFunnel(await loadJoinedRows(ayCode));
}
```

- [ ] **Step 4: Implement in `lib/admissions/insights-compare.ts`**

Extend the Task 3.1 import to `import { AY_MONTH_LABELS, intakeMonthIndex, type AyMonthLabel } from '@/lib/admissions/insights-predicates';`. In `shapeIntakeTrendPoints`, replace lines 105-110:

```ts
  for (const row of rows) {
    // Shared with the `intake-month` drill (KD #229): UTC month of
    // created_at, year ignored, December / blank / unreadable dropped.
    const monthIndex = intakeMonthIndex(row.createdAt);
    if (monthIndex === null) continue;
```

Add above `loadIntakeTrendByAyUncached`:

```ts
/**
 * The applications the intake trend counts: only those with an applicant
 * number, because no drill can list one without it (the drill's row set is
 * keyed on `enroleeNumber`, lib/admissions/drill.ts). Pure — exported for
 * unit tests.
 */
export function intakeRowsFromApps(
  ayCode: string,
  apps: { enroleeNumber: string | null; created_at: string | null }[]
): { ayCode: string; createdAt: string | null }[] {
  return apps
    .filter((a) => !!a.enroleeNumber)
    .map((a) => ({ ayCode, createdAt: a.created_at }));
}
```

In the loader, replace lines 188-199 with:

```ts
type AppDateRow = {
  enroleeNumber: string | null;
  created_at: string | null;
};
const rows = await fetchAllPages<AppDateRow>(
  (from, to) =>
    supabase
      .from(appsTable)
      .select('enroleeNumber, created_at')
      .range(from, to) as unknown as PromiseLike<{
      data: AppDateRow[] | null;
      error: { message: string } | null;
    }>
);
return intakeRowsFromApps(ayCode, rows);
```

- [ ] **Step 5: Run the new test and the loaders' existing tests**

Run: `npx vitest run __tests__/admissions/insights-loader-alignment.test.ts __tests__/admissions/time-to-enroll.test.ts __tests__/admissions/insights-compare.test.ts __tests__/admissions/conversion-by-assessment.test.ts --pool=threads`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/admissions/dashboard.ts lib/admissions/insights-compare.ts __tests__/admissions/insights-loader-alignment.test.ts && git commit -m "fix(admissions): funnel, average days and intake trend count with the drill's rules

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.4: Insights loaders join application-first, as every drill does

**Files:**

- Create: `scripts/probe-insights-drill-population.ts`
- Modify: `lib/admissions/insights-funnel.ts` (types lines 32-52 exported; loader join lines 96-114; cache key line 126; `computeWithdrawnByLevel` 270-282; `ReferralConversionRow` 288-293 and `computeReferralConversion` 302-347; `computeCategoryMix` 377-396; `computeNationalityMix` 477-512; `computeNationalityByLevel` 567-624)
- Modify: `lib/admissions/insights.ts` (`rollupTerminalReasons` 33-56, `toSortedCounts` 26-30, `selectTopReasonBars` 91-112, loader 116-160)
- Test: `__tests__/admissions/insights-joins.test.ts`

**Interfaces:**

- Consumes: Task 3.1 predicates.
- Produces:
  - `insights-funnel.ts`: `export type StatusFunnelRow`, `export type AppFunnelRow`, `export type JoinedFunnelRow`; `export function joinFunnelRows(statusRows: StatusFunnelRow[], appRows: AppFunnelRow[]): JoinedFunnelRow[]`; `ReferralConversionRow` gains `folded?: true` (only on the overflow row).
  - `insights.ts`: `export function joinTerminalReasonRows(statusRows: { enroleeNumber: string | null; applicationTerminalReason: string | null }[], appRows: { enroleeNumber: string | null; levelApplied: string | null }[]): { applicationTerminalReason: string | null; levelApplied: string | null }[]`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/admissions/insights-joins.test.ts
import { describe, expect, it } from 'vitest';

import {
  joinTerminalReasonRows,
  rollupTerminalReasons,
} from '@/lib/admissions/insights';
import {
  computeReferralConversion,
  computeWithdrawnByLevel,
  joinFunnelRows,
} from '@/lib/admissions/insights-funnel';

const app = (
  enroleeNumber: string | null,
  levelApplied: string | null = 'P1'
) => ({
  enroleeNumber,
  levelApplied,
  howDidYouKnowAboutHFSEIS: null,
  category: null,
  nationality: null,
});

describe('joinFunnelRows — application-first, as the drill joins', () => {
  it('keeps an application with no status row, drops a status row with no application', () => {
    const out = joinFunnelRows(
      [
        { enroleeNumber: 'E1', applicationStatus: 'Submitted' },
        { enroleeNumber: 'ORPHAN', applicationStatus: 'Withdrawn' },
      ],
      [app('E1'), app('E2')]
    );
    expect(out.map((r) => [r.enroleeNumber, r.applicationStatus])).toEqual([
      ['E1', 'Submitted'],
      ['E2', null],
    ]);
  });

  it('reads the last status row when an applicant has two', () => {
    const out = joinFunnelRows(
      [
        { enroleeNumber: 'E1', applicationStatus: 'Submitted' },
        { enroleeNumber: 'E1', applicationStatus: 'Cancelled' },
      ],
      [app('E1')]
    );
    expect(out).toHaveLength(1);
    expect(out[0].applicationStatus).toBe('Cancelled');
  });

  it('drops an application with no applicant number', () => {
    expect(joinFunnelRows([], [app(null), app('')])).toEqual([]);
  });
});

describe('joinTerminalReasonRows', () => {
  it('keeps applications whose last status row carries a reason, blank included', () => {
    const out = joinTerminalReasonRows(
      [
        { enroleeNumber: 'E1', applicationTerminalReason: 'financial' },
        { enroleeNumber: 'E2', applicationTerminalReason: null },
        { enroleeNumber: 'E3', applicationTerminalReason: '' },
        { enroleeNumber: 'ORPHAN', applicationTerminalReason: 'financial' },
        { enroleeNumber: 'E4', applicationTerminalReason: 'financial' },
        { enroleeNumber: 'E4', applicationTerminalReason: null },
      ],
      [
        { enroleeNumber: 'E1', levelApplied: 'P1' },
        { enroleeNumber: 'E2', levelApplied: 'P1' },
        { enroleeNumber: 'E3', levelApplied: null },
        { enroleeNumber: 'E4', levelApplied: 'P2' },
      ]
    );
    expect(out).toEqual([
      { applicationTerminalReason: 'financial', levelApplied: 'P1' },
      { applicationTerminalReason: '', levelApplied: null },
    ]);
    const rollup = rollupTerminalReasons(out);
    expect(rollup.total).toBe(2);
    expect(rollup.byLevel.map((l) => l.level)).toEqual(['P1', 'Unknown']);
  });
});

describe('computeWithdrawnByLevel', () => {
  it('reads a withdrawn status with stray spaces', () => {
    expect(
      computeWithdrawnByLevel([
        { levelApplied: 'P1', applicationStatus: ' Withdrawn ' },
      ])
    ).toEqual([{ level: 'P1', count: 1 }]);
  });
});

describe('computeReferralConversion', () => {
  it('marks the folded Other row, and only that row', () => {
    const sources = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    const rows = sources.flatMap((s, i) =>
      Array.from({ length: i + 1 }, () => ({
        howDidYouKnowAboutHFSEIS: s,
        applicationStatus: 'Processing',
      }))
    );
    const out = computeReferralConversion(rows);
    expect(out.filter((r) => r.folded === true)).toEqual([
      {
        source: 'Other',
        applied: 3,
        enrolled: 0,
        conversionPct: 0,
        folded: true,
      },
    ]);
    expect(out.filter((r) => r.folded === undefined)).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run __tests__/admissions/insights-joins.test.ts --pool=threads`
Expected: FAIL — `joinFunnelRows` / `joinTerminalReasonRows` are not exported; `' Withdrawn '` is not counted; the Other row has no `folded`.

- [ ] **Step 3: Implement in `lib/admissions/insights-funnel.ts`**

Replace the Task 3.1 predicates import with:

```ts
import {
  canonicaliseLevelApplied,
  canonicaliseNationality,
  categoryMixKey,
  isWithdrawnApplication,
  levelAsAppliedKey,
  NATIONALITY_BY_LEVEL_LIMIT,
  NATIONALITY_MIX_LIMIT,
  rankKeys,
  REFERRAL_TOP_COUNT,
  referralSourceKey,
  UNSPECIFIED_CATEGORY,
} from '@/lib/admissions/insights-predicates';
```

Export the three row types (lines 32, 37, 45): `export type StatusFunnelRow`, `export type AppFunnelRow`, `export type JoinedFunnelRow`. Add after `JoinedFunnelRow`:

```ts
/**
 * Application-first join — the same join the drill row set uses
 * (lib/admissions/drill.ts loadDrillRowsUncached): one row per application
 * with an applicant number, its LAST status row, nothing for a status row
 * with no application. Until KD #229 this loader iterated status rows, so an
 * orphan status row was counted and a duplicated one counted twice — numbers
 * no drill could list. Pure — exported for unit tests.
 */
export function joinFunnelRows(
  statusRows: StatusFunnelRow[],
  appRows: AppFunnelRow[]
): JoinedFunnelRow[] {
  const statusByEnrolee = new Map<string, StatusFunnelRow>();
  for (const s of statusRows) {
    if (s.enroleeNumber) statusByEnrolee.set(s.enroleeNumber, s);
  }
  const out: JoinedFunnelRow[] = [];
  for (const a of appRows) {
    if (!a.enroleeNumber) continue;
    const s = statusByEnrolee.get(a.enroleeNumber);
    out.push({
      enroleeNumber: a.enroleeNumber,
      applicationStatus: s?.applicationStatus ?? null,
      levelApplied: a.levelApplied ?? null,
      howDidYouKnowAboutHFSEIS: a.howDidYouKnowAboutHFSEIS ?? null,
      category: a.category ?? null,
      nationality: a.nationality ?? null,
    });
  }
  return out;
}
```

Replace the loader's lines 96-114 with `return joinFunnelRows(statusRows, appRows);`. Change the cache key (line 126) to `['admissions-funnel-v3', ayCode],` and append to its comment: `(v3: application-first join, KD #229, 2026-09-29.)`.

In `computeWithdrawnByLevel` replace lines 275-276 with:

```ts
if (!isWithdrawnApplication(r.applicationStatus)) continue;
const level = levelAsAppliedKey(r.levelApplied);
```

Replace `ReferralConversionRow` (lines 288-293) with:

```ts
export type ReferralConversionRow = {
  source: string;
  applied: number;
  enrolled: number;
  conversionPct: number;
  /** Only on the folded 'Other' row — the sources past the top eight. Lets
   *  the drill tell it from a source a parent literally named "Other". */
  folded?: true;
};
```

Replace `computeReferralConversion`'s body (lines 305-346) with:

```ts
const enrolled = new Map<string, number>();
const keys: string[] = [];
for (const r of rows) {
  const source = referralSourceKey(r.howDidYouKnowAboutHFSEIS);
  keys.push(source);
  if (ENROLLED_STATUSES.has(r.applicationStatus ?? '')) {
    enrolled.set(source, (enrolled.get(source) ?? 0) + 1);
  }
}

// Shared ranking (count desc, then name) — the `referral-all` drill folds
// with the same order, so its overflow is exactly this Other row.
const all: ReferralConversionRow[] = rankKeys(keys).map(
  ({ key: source, count: app }) => {
    const enr = enrolled.get(source) ?? 0;
    return {
      source,
      applied: app,
      enrolled: enr,
      conversionPct: app > 0 ? Math.round((enr / app) * 100) : 0,
    };
  }
);

if (all.length <= REFERRAL_TOP_COUNT) return all;
const top = all.slice(0, REFERRAL_TOP_COUNT);
const rest = all.slice(REFERRAL_TOP_COUNT);
const otherApplied = rest.reduce((s, r) => s + r.applied, 0);
const otherEnrolled = rest.reduce((s, r) => s + r.enrolled, 0);
top.push({
  source: 'Other',
  applied: otherApplied,
  enrolled: otherEnrolled,
  conversionPct:
    otherApplied > 0 ? Math.round((otherEnrolled / otherApplied) * 100) : 0,
  folded: true,
});
return top;
```

In `computeCategoryMix` replace lines 380-387 with:

```ts
for (const r of rows) {
  const key = categoryMixKey(r.category);
  if (key === UNSPECIFIED_CATEGORY) {
    unspecified += 1;
  } else {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
}
```

In `computeNationalityMix` change the signature default to `limit = NATIONALITY_MIX_LIMIT` and replace lines 481-497 with:

```ts
const names: string[] = [];
let unspecified = 0;

for (const r of rows) {
  const name = canonicaliseNationality(r.nationality);
  if (!name) {
    unspecified += 1;
    continue;
  }
  names.push(name);
}

// Shared ranking (count desc, then name) — nationalityBucketer folds with
// the same order, so the `nationality` drill's Other is this Other.
const all = rankKeys(names).map(({ key, count }) => ({
  nationality: key,
  count,
}));
```

In `computeNationalityByLevel` change the signature default to `limit = NATIONALITY_BY_LEVEL_LIMIT` and replace lines 578-585 with:

```ts
const ranked = rankKeys(
  normalised.flatMap((r) => (r.nationality ? [r.nationality] : []))
).map((r) => r.key);
```

- [ ] **Step 4: Implement in `lib/admissions/insights.ts`**

Replace the Task 3.1 predicates import with:

```ts
import {
  levelAsAppliedKey,
  OTHER_REASONS_BAR_KEY,
  reasonLabel,
  sortReasonCounts,
  terminalReasonKey,
  TOP_REASON_COUNT,
  UNSPECIFIED_REASON,
  type ReasonCount,
} from '@/lib/admissions/insights-predicates';
import { fetchAllPages } from '@/lib/supabase/paginate';
```

Delete `const UNSPECIFIED = 'Unspecified';`, `bump` and `toSortedCounts` (lines 21-30). Replace `rollupTerminalReasons` (lines 32-56) with:

```ts
/** Aggregate terminal (cancelled/withdrawn-application) reasons overall + by
 *  level. Reason and level keys are the shared ones the `terminal-reason`
 *  drill filters with (KD #229). */
export function rollupTerminalReasons(
  rows: TerminalRow[]
): TerminalReasonRollup {
  const overallKeys: string[] = [];
  const perLevel = new Map<string, string[]>();
  for (const r of rows) {
    const reason =
      terminalReasonKey(r.applicationTerminalReason ?? '') ??
      UNSPECIFIED_REASON;
    const level = levelAsAppliedKey(r.levelApplied);
    overallKeys.push(reason);
    const list = perLevel.get(level) ?? [];
    list.push(reason);
    perLevel.set(level, list);
  }
  const byLevel = [...perLevel.entries()]
    .map(([level, keys]) => ({
      level,
      count: keys.length,
      reasons: sortReasonCounts(keys),
    }))
    .sort((a, b) => b.count - a.count || a.level.localeCompare(b.level));
  return {
    overall: sortReasonCounts(overallKeys),
    byLevel,
    total: rows.length,
  };
}

/**
 * Application-first join — the drill row set's join: one row per application
 * with an applicant number whose LAST status row carries a reason (blank
 * counts, as 'Unspecified'). A status row with no application is not counted.
 * Pure — exported for unit tests.
 */
export function joinTerminalReasonRows(
  statusRows: {
    enroleeNumber: string | null;
    applicationTerminalReason: string | null;
  }[],
  appRows: { enroleeNumber: string | null; levelApplied: string | null }[]
): TerminalRow[] {
  const reasonByEnrolee = new Map<string, string | null>();
  for (const s of statusRows) {
    if (s.enroleeNumber) {
      reasonByEnrolee.set(s.enroleeNumber, s.applicationTerminalReason ?? null);
    }
  }
  const out: TerminalRow[] = [];
  for (const a of appRows) {
    if (!a.enroleeNumber) continue;
    const reason = reasonByEnrolee.get(a.enroleeNumber) ?? null;
    if (terminalReasonKey(reason) === null) continue;
    out.push({
      applicationTerminalReason: reason,
      levelApplied: a.levelApplied ?? null,
    });
  }
  return out;
}
```

In `selectTopReasonBars` change `key: 'other_reasons',` to `key: OTHER_REASONS_BAR_KEY,`. Replace `loadTerminalReasonsUncached` (lines 116-160) with:

```ts
async function loadTerminalReasonsUncached(
  ayCode: string
): Promise<TerminalReasonRollup> {
  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();
  type StatusRow = {
    enroleeNumber: string | null;
    applicationTerminalReason: string | null;
  };
  type AppRow = { enroleeNumber: string | null; levelApplied: string | null };
  type P<T> = PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>;
  // Paginated (the old single select stopped at PostgREST's 1,000-row cap)
  // and joined application-first like the drill (KD #229).
  // NOTE: applicationTerminalReason is a case-sensitive camelCase column —
  // double-quoted in the select, mirroring LIST_STATUS_COLUMNS in
  // lib/sis/queries.ts.
  try {
    const [statusRows, appRows] = await Promise.all([
      fetchAllPages<StatusRow>(
        (from, to) =>
          supabase
            .from(`${prefix}_enrolment_status`)
            .select('enroleeNumber, "applicationTerminalReason"')
            .range(from, to) as unknown as P<StatusRow>
      ),
      fetchAllPages<AppRow>(
        (from, to) =>
          supabase
            .from(`${prefix}_enrolment_applications`)
            .select('enroleeNumber, levelApplied')
            .range(from, to) as unknown as P<AppRow>
      ),
    ]);
    return rollupTerminalReasons(joinTerminalReasonRows(statusRows, appRows));
  } catch (err) {
    console.error('[admissions-insights] terminal reasons fetch failed:', err);
    return { overall: [], byLevel: [], total: 0 };
  }
}
```

Change the cache key in `getAdmissionsTerminalReasons` to `['admissions-insights', 'terminal-reasons-v2', ayCode],`.

- [ ] **Step 5: Write the read-only probe**

```ts
// scripts/probe-insights-drill-population.ts
//
// Measures how far the Admissions Insights figures move when their loaders
// switch from a status-first to an application-first join (KD #229, phase 3
// of docs/superpowers/plans/2026-09-29-insights-drill-sheets.md).
//
// STRICTLY READ-ONLY — every statement is a SELECT. Safe against production.
// Run it against PRODUCTION, not the seeder.
//
// Run:
//   npx tsx --env-file=.env.local scripts/probe-insights-drill-population.ts
import { prefixFor } from '../lib/admissions/_shared';
import { fetchAllPages } from '../lib/supabase/paginate';
import { createServiceClient } from '../lib/supabase/service';

type App = { enroleeNumber: string | null; created_at: string | null };
type Status = {
  enroleeNumber: string | null;
  applicationStatus: string | null;
  applicationTerminalReason: string | null;
};
type P<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

const CANONICAL = new Set([
  'Submitted',
  'Ongoing Verification',
  'Processing',
  'Enrolled',
  'Enrolled (Conditional)',
  'Withdrawn',
  'Cancelled',
]);

async function main() {
  const supabase = createServiceClient();
  for (const ay of ['AY2025', 'AY2026', 'AY2027']) {
    const p = prefixFor(ay);
    const apps = await fetchAllPages<App>(
      (from, to) =>
        supabase
          .from(`${p}_enrolment_applications`)
          .select('enroleeNumber, created_at')
          .range(from, to) as unknown as P<App>
    );
    const statuses = await fetchAllPages<Status>(
      (from, to) =>
        supabase
          .from(`${p}_enrolment_status`)
          .select(
            'enroleeNumber, applicationStatus, "applicationTerminalReason"'
          )
          .range(from, to) as unknown as P<Status>
    );
    const appNumbers = new Set(
      apps.map((a) => a.enroleeNumber).filter((n): n is string => !!n)
    );
    const statusCount = new Map<string, number>();
    for (const s of statuses) {
      if (s.enroleeNumber) {
        statusCount.set(
          s.enroleeNumber,
          (statusCount.get(s.enroleeNumber) ?? 0) + 1
        );
      }
    }
    const orphan = (s: Status) =>
      !s.enroleeNumber || !appNumbers.has(s.enroleeNumber);
    console.log(ay, {
      applications: apps.length,
      applicationsWithoutNumber: apps.filter((a) => !a.enroleeNumber).length,
      statusRows: statuses.length,
      statusRowsWithoutApplication: statuses.filter(orphan).length,
      applicationsWithoutStatusRow: [...appNumbers].filter(
        (n) => !statusCount.has(n)
      ).length,
      applicantsWithDuplicateStatusRows: [...statusCount.values()].filter(
        (c) => c > 1
      ).length,
      statusRowsBlankOrNonCanonical: statuses.filter(
        (s) => !CANONICAL.has((s.applicationStatus ?? '').trim())
      ).length,
      terminalReasonRows: statuses.filter(
        (s) => s.applicationTerminalReason !== null
      ).length,
      terminalReasonRowsWithoutApplication: statuses.filter(
        (s) => s.applicationTerminalReason !== null && orphan(s)
      ).length,
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: Run the probe and record what it says**

Run: `npx tsx --env-file=.env.local scripts/probe-insights-drill-population.ts`
Expected: one object per AY. Copy the three lines into the task report. Any non-zero `statusRowsWithoutApplication`, `applicantsWithDuplicateStatusRows` or `terminalReasonRowsWithoutApplication` is exactly how far the withdrawn / source / category / nationality / cancellation figures on `/admissions/insights` move after this task — state it in plain English in the phase report for Mr Ace (e.g. "AY2026 cancellation reasons drop from 58 to 57: one reason sits on a status row with no application"). Zero everywhere means no figure moves.

- [ ] **Step 7: Run the new test and the loaders' existing tests**

Run: `npx vitest run __tests__/admissions/insights-joins.test.ts __tests__/admissions/insights-funnel.test.ts __tests__/admissions/insights.test.ts __tests__/admissions/insights-nationality.test.ts __tests__/admissions/insights-export.test.ts __tests__/sis --pool=threads`
Expected: PASS (`__tests__/sis` covers Records' use of `computeNationalityByLevel`).

- [ ] **Step 8: Commit**

```bash
git add lib/admissions/insights-funnel.ts lib/admissions/insights.ts scripts/probe-insights-drill-population.ts __tests__/admissions/insights-joins.test.ts && git commit -m "fix(admissions): insights loaders join application-first, as every drill does

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.5: The drill row set carries the new fields and answers the seven new targets

**Files:**

- Modify: `lib/admissions/drill.ts` (imports lines 1-21; `DrillTarget` 41-53; `DrillRow` 55-91; `AppLite` 163-172; `StatusLite` 173-185; `statusCols` 192-202; apps select 213; row build 274-348; cache key 450; `funnel-stage` 506-534; new cases before `default:` 629; `DrillColumnKey` 652-668; `ALL_DRILL_COLUMNS` 670-687; `defaultColumnsForTarget` before `default:` 796; `DRILL_COLUMN_LABELS` 801-818; `drillHeaderForTarget` 846-852 and before `default:` 923)
- Modify: `app/api/admissions/drill/[target]/route.ts` (`VALID_TARGETS` 17-30; CSV switch 136-164; imports)
- Modify: `__tests__/admissions/drill.test.ts` (`makeRow` lines 71-98)
- Test: `__tests__/admissions/drill-insights-targets.test.ts`

**Interfaces:**

- Consumes: Task 3.1 predicates.
- Produces:
  - `DrillTarget` adds `'intake-month' | 'withdrawn-by-level' | 'assessment-all' | 'terminal-reason' | 'referral-all' | 'category' | 'nationality'`.
  - `DrillRow` adds `levelAsApplied: string | null` (raw application `levelApplied`), `terminalReason: string | null` (`terminalReasonKey`), `category: string | null` (trimmed raw), `nationality: string | null` (`canonicaliseNationality`).
  - `DrillColumnKey` adds `'levelAsApplied' | 'terminalReason' | 'category' | 'nationality'`.
  - `export function parseAssessmentAllSegment(segment: string): { subject: 'math' | 'eng'; outcome: 'pass' | 'fail' | 'unknown' } | null`
  - Segment contract per target — `intake-month`: `'Jan'`…`'Nov'`; `withdrawn-by-level`: `levelAsAppliedKey` value; `assessment-all`: `'math' | 'eng'` + `':'` + `'pass' | 'fail' | 'notAssessed'`; `terminal-reason`: `encodePairSegment(level | '', reason | '__other__' | '')`; `referral-all`: `referralSourceKey` value or `'__other__'`; `category`: `categoryMixKey` value; `nationality`: `encodePairSegment(level | '', bucket)`. No segment = the whole population. An unreadable segment = an empty list.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/admissions/drill-insights-targets.test.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
}));
vi.mock('@/lib/supabase/admissions', () => ({
  createAdmissionsClient: vi.fn(),
}));

import {
  applyTargetFilter,
  drillHeaderForTarget,
  parseAssessmentAllSegment,
  type DrillRow,
} from '@/lib/admissions/drill';
import {
  encodePairSegment,
  OVERFLOW_SEGMENT,
} from '@/lib/admissions/insights-predicates';

function makeRow(overrides: Partial<DrillRow>): DrillRow {
  return {
    enroleeNumber: 'ENR-0001',
    studentNumber: null,
    fullName: 'Doe, Jane',
    status: 'Submitted',
    level: 'P1',
    stage: 'Submitted',
    pipelineStage: 'Submitted',
    referralSource: null,
    assessmentMath: null,
    assessmentEnglish: null,
    assessmentMathOutcome: 'unknown',
    assessmentEnglishOutcome: 'unknown',
    assessmentOutcome: 'unknown',
    applicationDate: '2026-01-01T00:00:00.000Z',
    enrollmentDate: null,
    daysToEnroll: null,
    daysSinceUpdate: null,
    rawDaysSinceUpdate: null,
    daysInPipeline: 10,
    hasMissingDocs: true,
    documentsComplete: 0,
    documentsTotal: 5,
    levelAsApplied: 'P1',
    terminalReason: null,
    category: null,
    nationality: null,
    ...overrides,
  };
}

describe('funnel-stage — the card’s predicate', () => {
  it('leaves a blank or unrecognised status out of Submitted', () => {
    const rows = [
      makeRow({ status: 'Processing' }),
      makeRow({ status: 'No status' }),
      makeRow({ status: 'Deferred' }),
      makeRow({ status: 'Cancelled' }),
    ];
    expect(applyTargetFilter(rows, 'funnel-stage', 'Submitted')).toHaveLength(
      1
    );
  });
});

describe('an unreadable segment opens an empty list, never every row', () => {
  it.each([
    'intake-month',
    'assessment-all',
    'terminal-reason',
    'nationality',
  ] as const)('%s', (target) => {
    expect(applyTargetFilter([makeRow({})], target, 'garbage')).toEqual([]);
  });
});

describe('withdrawn-by-level groups by the level as applied', () => {
  it('ignores the class level the status table prefers', () => {
    const rows = [
      makeRow({ status: 'Withdrawn', level: 'P3', levelAsApplied: 'P1' }),
      makeRow({ status: 'Cancelled', levelAsApplied: 'P1' }),
    ];
    expect(applyTargetFilter(rows, 'withdrawn-by-level', 'P1')).toHaveLength(1);
    expect(applyTargetFilter(rows, 'withdrawn-by-level', 'P3')).toHaveLength(0);
  });
});

describe('terminal-reason', () => {
  const rows = [
    makeRow({
      terminalReason: 'financial',
      levelAsApplied: 'Youngstarters | Little Stars',
    }),
    makeRow({ terminalReason: 'visa_denied', levelAsApplied: 'P1' }),
    makeRow({ terminalReason: null }),
  ];
  it('matches a level whose label contains the separator', () => {
    expect(
      applyTargetFilter(
        rows,
        'terminal-reason',
        encodePairSegment('Youngstarters | Little Stars', '')
      )
    ).toHaveLength(1);
  });
  it('lists only applications with a reason when no segment is given', () => {
    expect(applyTargetFilter(rows, 'terminal-reason')).toHaveLength(2);
  });
});

describe('assessment-all keeps cancelled and withdrawn applicants', () => {
  it('matches the chart, unlike the dashboard’s assessment target', () => {
    const rows = [
      makeRow({ status: 'Cancelled', assessmentEnglishOutcome: 'unknown' }),
      makeRow({ status: 'Submitted', assessmentEnglishOutcome: 'unknown' }),
    ];
    expect(
      applyTargetFilter(rows, 'assessment-all', 'eng:notAssessed')
    ).toHaveLength(2);
    expect(parseAssessmentAllSegment('eng:notAssessed')).toEqual({
      subject: 'eng',
      outcome: 'unknown',
    });
    expect(parseAssessmentAllSegment('science:pass')).toBeNull();
  });
});

describe('headers read in plain English', () => {
  it('names the overflow reason bucket', () => {
    expect(
      drillHeaderForTarget(
        'terminal-reason',
        encodePairSegment('', OVERFLOW_SEGMENT)
      ).title
    ).toBe('Cancelled or withdrawn — other reasons');
  });
  it('names the Submitted list after the card', () => {
    expect(drillHeaderForTarget('funnel-stage', 'Submitted').title).toBe(
      'Applications received'
    );
  });
  it('names a failed assessment without jargon', () => {
    expect(drillHeaderForTarget('assessment-all', 'math:fail').title).toBe(
      'Applicants who did not pass the Maths assessment'
    );
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run __tests__/admissions/drill-insights-targets.test.ts --pool=threads`
Expected: FAIL — `parseAssessmentAllSegment` is not exported; `funnel-stage` Submitted returns 3; unknown targets return every row; the headers differ.

- [ ] **Step 3: Rows — `lib/admissions/drill.ts`**

Add to the imports:

```ts
import {
  AY_MONTH_LABELS,
  canonicaliseLevelApplied,
  canonicaliseNationality,
  categoryMixKey,
  daysToEnrol,
  decodePairSegment,
  hasReachedFunnelStage,
  intakeMonthIndex,
  isFunnelStageName,
  isWithdrawnApplication,
  levelAsAppliedKey,
  NATIONALITY_BY_LEVEL_LIMIT,
  NATIONALITY_MIX_LIMIT,
  nationalityBucketer,
  OVERFLOW_SEGMENT,
  reasonLabel,
  referralBucketer,
  referralSourceKey,
  terminalReasonKey,
  topReasonKeys,
  type AyMonthLabel,
} from '@/lib/admissions/insights-predicates';
```

Replace `DrillTarget` (lines 41-53) with:

```ts
export type DrillTarget =
  | 'applications'
  | 'enrolled'
  | 'conversion'
  | 'avg-time'
  | 'funnel-stage'
  | 'pipeline-stage'
  | 'referral'
  | 'assessment'
  | 'time-to-enroll-bucket'
  | 'applications-by-level'
  | 'doc-completion'
  | 'outdated'
  // Admissions Insights (KD #229) — each filters with the predicate its
  // Insights loader counts with (lib/admissions/insights-predicates.ts).
  | 'intake-month'
  | 'withdrawn-by-level'
  | 'assessment-all'
  | 'terminal-reason'
  | 'referral-all'
  | 'category'
  | 'nationality';
```

Add to `DrillRow`, after `documentsTotal` (line 90):

```ts
/** The application's own `levelApplied`, raw. The Insights withdrawn,
 *  cancellation-reason and nationality charts group by this — NOT `level`,
 *  which prefers the status table's classLevel. */
levelAsApplied: string | null;
/** `terminalReasonKey(applicationTerminalReason)`: null = none recorded,
 *  'Unspecified' = recorded blank. */
terminalReason: string | null;
/** Enrolee category as the parent portal stored it, trimmed. */
category: string | null;
/** `canonicaliseNationality(nationality)`. */
nationality: string | null;
```

Add to `AppLite` (after line 171): `category: string | null;` and `nationality: string | null;`. Add to `StatusLite` (after line 184): `applicationTerminalReason: string | null;`. Add `'"applicationTerminalReason"',` to `statusCols` after `'assessmentGradeEnglish',` (line 200). Change the apps select (line 213) to `'enroleeNumber, studentNumber, enroleeFullName, firstName, lastName, levelApplied, created_at, howDidYouKnowAboutHFSEIS, category, nationality'`.

Replace lines 278-284 (`const daysToEnroll = …`) with:

```ts
// Shared with getAverageTimeToEnrollment (KD #229) — the card's sample is
// exactly the rows with a non-null value here.
const daysToEnroll = daysToEnrol({
  status,
  createdAt: a.created_at,
  enrolledAt,
});
```

Delete the now-unused `createdMs` / `enrolledMs` only if the linter flags them — `createdMs` is still used by `daysInPipeline`; delete `enrolledMs` (line 272). In `out.push({ … })` add after `documentsTotal,` (line 347):

```ts
      levelAsApplied: a.levelApplied ?? null,
      terminalReason: terminalReasonKey(s?.applicationTerminalReason),
      category: (a.category ?? '').trim() || null,
      nationality: canonicaliseNationality(a.nationality ?? null),
```

Change the cache key (line 450) to `['admissions-drill', 'rows-v2', input.ayCode],` with the comment `// v2: DrillRow gained levelAsApplied / terminalReason / category / nationality (KD #229) — a stale v1 entry would serve rows without them.`

- [ ] **Step 4: Targets — `lib/admissions/drill.ts`**

Replace the `funnel-stage` case (lines 506-534) with:

```ts
    case 'funnel-stage':
      // Same stage rule as getConversionFunnel (hasReachedFunnelStage): a
      // blank or unrecognised status reaches no stage, so "Applications
      // received" equals this list. This target had no caller before the
      // Insights page (KD #229), so aligning it changed no dashboard.
      if (!isFunnelStageName(segment)) return rows;
      return rows.filter((r) => hasReachedFunnelStage(r.status, segment));
```

Add before `default:` (line 629):

```ts
    case 'intake-month': {
      // getIntakeTrendByAy: UTC month of created_at, year ignored.
      if (!segment) {
        return rows.filter((r) => intakeMonthIndex(r.applicationDate) !== null);
      }
      const month = AY_MONTH_LABELS.indexOf(segment as AyMonthLabel);
      if (month === -1) return [];
      return rows.filter((r) => intakeMonthIndex(r.applicationDate) === month);
    }
    case 'withdrawn-by-level': {
      // getWithdrawnByLevel: status Withdrawn, grouped by the level as applied.
      const withdrawn = rows.filter((r) => isWithdrawnApplication(r.status));
      if (!segment) return withdrawn;
      return withdrawn.filter(
        (r) => levelAsAppliedKey(r.levelAsApplied) === segment
      );
    }
    case 'assessment-all': {
      // getConversionByAssessment: every applicant, terminal included.
      if (!segment) return rows;
      const parsed = parseAssessmentAllSegment(segment);
      if (!parsed) return [];
      return rows.filter(
        (r) =>
          (parsed.subject === 'math'
            ? r.assessmentMathOutcome
            : r.assessmentEnglishOutcome) === parsed.outcome
      );
    }
    case 'terminal-reason': {
      // getAdmissionsTerminalReasons: applications with a reason recorded.
      const withReason = rows.filter((r) => r.terminalReason !== null);
      if (!segment) return withReason;
      const pair = decodePairSegment(segment);
      if (!pair) return [];
      // The overflow is ranked over EVERY reason, as selectTopReasonBars
      // ranks terminal.overall.
      const named =
        pair.second === OVERFLOW_SEGMENT
          ? topReasonKeys(withReason.map((r) => r.terminalReason as string))
          : null;
      return withReason.filter((r) => {
        if (pair.first && levelAsAppliedKey(r.levelAsApplied) !== pair.first) {
          return false;
        }
        if (pair.second === '') return true;
        if (named) return !named.has(r.terminalReason as string);
        return r.terminalReason === pair.second;
      });
    }
    case 'referral-all': {
      // getReferralConversion: every applicant, terminal included.
      if (!segment) return rows;
      if (segment === OVERFLOW_SEGMENT) {
        const bucketOf = referralBucketer(
          rows.map((r) => referralSourceKey(r.referralSource))
        );
        return rows.filter(
          (r) =>
            bucketOf(referralSourceKey(r.referralSource)) === OVERFLOW_SEGMENT
        );
      }
      return rows.filter((r) => referralSourceKey(r.referralSource) === segment);
    }
    case 'category':
      // getCategoryMix: every applicant, blank/unknown as Unspecified.
      if (!segment) return rows;
      return rows.filter((r) => categoryMixKey(r.category) === segment);
    case 'nationality': {
      // getNationalityMix (no level) / getApplicantNationalityByLevel (level).
      if (!segment) return rows;
      const pair = decodePairSegment(segment);
      if (!pair) return [];
      if (!pair.first) {
        const bucketOf = nationalityBucketer(
          rows.map((r) => r.nationality),
          NATIONALITY_MIX_LIMIT
        );
        return rows.filter((r) => bucketOf(r.nationality) === pair.second);
      }
      const bucketOf = nationalityBucketer(
        rows.map((r) => r.nationality),
        NATIONALITY_BY_LEVEL_LIMIT
      );
      return rows.filter(
        (r) =>
          canonicaliseLevelApplied(r.levelAsApplied) === pair.first &&
          (pair.second === '' || bucketOf(r.nationality) === pair.second)
      );
    }
```

Add after `applyTargetFilter` (before `parseTimeToEnrollBucket`, line 634):

```ts
/** `'math:pass'` … `'eng:notAssessed'` → subject + the drill row's outcome
 *  value. `notAssessed` is the chart's name for `unknown`. */
export function parseAssessmentAllSegment(
  segment: string
): { subject: 'math' | 'eng'; outcome: 'pass' | 'fail' | 'unknown' } | null {
  const colon = segment.indexOf(':');
  if (colon === -1) return null;
  const subject = segment.slice(0, colon);
  const raw = segment.slice(colon + 1);
  if (subject !== 'math' && subject !== 'eng') return null;
  const outcome =
    raw === 'pass' || raw === 'fail'
      ? raw
      : raw === 'notAssessed' || raw === 'unknown'
        ? 'unknown'
        : null;
  return outcome ? { subject, outcome } : null;
}
```

- [ ] **Step 5: Columns, defaults and headers — `lib/admissions/drill.ts`**

Add to `DrillColumnKey` (line 668): `| 'levelAsApplied' | 'terminalReason' | 'category' | 'nationality'`. Append to `ALL_DRILL_COLUMNS` after `'documentsComplete',`: `'levelAsApplied', 'terminalReason', 'category', 'nationality',`. Add to `DRILL_COLUMN_LABELS`:

```ts
  levelAsApplied: 'Level applied for',
  terminalReason: 'Reason',
  category: 'Category',
  nationality: 'Nationality',
```

Add to `defaultColumnsForTarget` before `default:` (line 796):

```ts
    case 'intake-month':
      return ['fullName', 'enroleeNumber', 'status', 'level', 'applicationDate'];
    case 'withdrawn-by-level':
      return ['fullName', 'enroleeNumber', 'levelAsApplied', 'status', 'applicationDate'];
    case 'assessment-all':
      return ['fullName', 'enroleeNumber', 'status', 'level', 'assessmentMath', 'assessmentEnglish'];
    case 'terminal-reason':
      return ['fullName', 'enroleeNumber', 'status', 'levelAsApplied', 'terminalReason'];
    case 'referral-all':
      return ['fullName', 'enroleeNumber', 'referralSource', 'status', 'level'];
    case 'category':
      return ['fullName', 'enroleeNumber', 'category', 'status', 'level'];
    case 'nationality':
      return ['fullName', 'enroleeNumber', 'nationality', 'levelAsApplied', 'status'];
```

In `drillHeaderForTarget`, replace the `funnel-stage` case (lines 846-852) with:

```ts
    case 'funnel-stage':
      return {
        eyebrow: 'Admissions funnel',
        title:
          segment === 'Submitted'
            ? 'Applications received'
            : segment
              ? `Applicants who reached the ${segment} stage`
              : 'Applicants by funnel stage reached',
      };
```

and add before `default:` (line 923):

```ts
    case 'intake-month':
      return {
        eyebrow: 'Admissions insights',
        title: segment
          ? `Applications received in ${segment}`
          : 'Applications received by month',
      };
    case 'withdrawn-by-level':
      return {
        eyebrow: 'Admissions insights',
        title: segment
          ? `Withdrawn applications for ${segment}`
          : 'Withdrawn applications',
      };
    case 'assessment-all': {
      const parsed = segment ? parseAssessmentAllSegment(segment) : null;
      if (!parsed) {
        return {
          eyebrow: 'Admissions insights',
          title: 'Applicants by entrance assessment result',
        };
      }
      const subject = parsed.subject === 'math' ? 'Maths' : 'English';
      return {
        eyebrow: 'Admissions insights',
        title:
          parsed.outcome === 'unknown'
            ? `Applicants with no ${subject} assessment result`
            : `Applicants who ${parsed.outcome === 'pass' ? 'passed' : 'did not pass'} the ${subject} assessment`,
      };
    }
    case 'terminal-reason': {
      const pair = segment ? decodePairSegment(segment) : null;
      if (!pair) {
        return {
          eyebrow: 'Admissions insights',
          title: 'Every application with a cancellation reason',
        };
      }
      const reason =
        pair.second === OVERFLOW_SEGMENT
          ? 'other reasons'
          : pair.second
            ? reasonLabel(pair.second)
            : null;
      return {
        eyebrow: 'Admissions insights',
        title:
          pair.first && reason
            ? `${pair.first}: cancelled or withdrawn — ${reason}`
            : pair.first
              ? `Cancellation reasons for ${pair.first}`
              : `Cancelled or withdrawn — ${reason}`,
      };
    }
    case 'referral-all':
      return {
        eyebrow: 'Admissions insights',
        title: !segment
          ? 'Applicants by how they heard about HFSE'
          : segment === OVERFLOW_SEGMENT
            ? 'Applicants from other referral sources'
            : segment === 'Not specified'
              ? 'Applicants who did not say how they heard about HFSE'
              : `Applicants who heard about HFSE from ${segment}`,
      };
    case 'category':
      return {
        eyebrow: 'Admissions insights',
        title: !segment
          ? 'Applicants by category'
          : segment === 'Unspecified'
            ? 'Applicants with no category recorded'
            : `${segment} applicants`,
      };
    case 'nationality': {
      const pair = segment ? decodePairSegment(segment) : null;
      if (!pair) {
        return { eyebrow: 'Admissions insights', title: 'Applicants by nationality' };
      }
      const who =
        pair.second === 'Other'
          ? 'Applicants of other nationalities'
          : pair.second === 'Unspecified'
            ? 'Applicants with no nationality recorded'
            : pair.second
              ? `${pair.second} applicants`
              : 'Applicants';
      return {
        eyebrow: 'Admissions insights',
        title: pair.first ? `${who} for ${pair.first}` : who,
      };
    }
```

- [ ] **Step 6: The route — `app/api/admissions/drill/[target]/route.ts`**

Append to `VALID_TARGETS` after `'outdated',`:

```ts
  'intake-month',
  'withdrawn-by-level',
  'assessment-all',
  'terminal-reason',
  'referral-all',
  'category',
  'nationality',
```

Add `import { reasonLabel } from '@/lib/admissions/insights-predicates';` and, in the CSV switch before `default:` (line 163):

```ts
        case 'levelAsApplied':
          return r.levelAsApplied ?? '';
        case 'terminalReason':
          return r.terminalReason ? reasonLabel(r.terminalReason) : '';
        case 'category':
          return r.category ?? '';
        case 'nationality':
          return r.nationality ?? '';
```

- [ ] **Step 7: Keep the existing drill test compiling**

In `__tests__/admissions/drill.test.ts` `makeRow`, add after `documentsTotal: 5,` (line 95):

```ts
    levelAsApplied: 'P1',
    terminalReason: null,
    category: null,
    nationality: null,
```

- [ ] **Step 8: Run the targets test, the parity test and the existing drill test**

Run: `npx vitest run __tests__/admissions/drill-insights-targets.test.ts __tests__/admissions/insights-drill-parity.test.ts __tests__/admissions/drill.test.ts --pool=threads`
Expected: PASS — every parity case, both years, every overflow bucket.

- [ ] **Step 9: Commit**

```bash
git add lib/admissions/drill.ts "app/api/admissions/drill/[target]/route.ts" __tests__/admissions/drill.test.ts __tests__/admissions/drill-insights-targets.test.ts && git commit -m "feat(admissions): drill targets behind every Admissions Insights figure

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.6: The ★ ratings open the parents who gave them

**Files:**

- Create: `lib/admissions/feedback-drill.ts`
- Create: `app/api/admissions/drill/feedback-rating/route.ts` (a static segment beside `[target]`; Next resolves the static one first)
- Create: `components/admissions/drills/feedback-rating-drill-sheet.tsx`
- Modify: `components/admissions/drills/admissions-drill-sheet.tsx` (line 223: export `StatusBadge`)
- Test: `__tests__/admissions/feedback-rating-drill.test.ts`

**Interfaces:**

- Consumes: `getAdmissionsFeedback`, `isRatingInScale`, `FEEDBACK_RATING_MIN`, `FEEDBACK_RATING_MAX`, `type FeedbackRow` (`lib/admissions/feedback.ts`); `buildCsv` (`lib/csv.ts:28`); `requireRole` (`lib/auth/require-role.ts:19`); `DrillDownSheet`, `DrillSheetSkeleton`; `queryKeys.admissionsDrill` (`lib/query/keys.ts:20`).
- Produces:
  - `feedback-drill.ts`: `type RatingBucket = { stars: number; count: number }`; `function feedbackRatingBuckets(rows: readonly FeedbackRow[]): RatingBucket[]`; `function filterFeedbackByRating(rows: readonly FeedbackRow[], segment: string | null | undefined): FeedbackRow[]`; `const FEEDBACK_DRILL_CSV_HEADERS: string[]`; `function feedbackDrillCsvRow(r: FeedbackRow): (string | number)[]`
  - `GET /api/admissions/drill/feedback-rating?ay=AY2026&segment=4[&format=csv]` → `{ rows: FeedbackRow[], total, target: 'feedback-rating', segment, ayCode }`
  - `export function FeedbackRatingDrillSheet(props: { ayCode: string; segment: string | null }): React.ReactElement`
  - `export function StatusBadge({ status }: { status: string })` from `admissions-drill-sheet.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/admissions/feedback-rating-drill.test.ts
import { describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({
  apps: [] as Array<Record<string, unknown>>,
  statuses: [] as Array<Record<string, unknown>>,
}));

vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        range: () =>
          Promise.resolve({
            data: table.endsWith('_enrolment_applications')
              ? fx.apps
              : fx.statuses,
            error: null,
          }),
      }),
    }),
  }),
}));

import { getAdmissionsFeedback } from '@/lib/admissions/feedback';
import {
  FEEDBACK_DRILL_CSV_HEADERS,
  feedbackDrillCsvRow,
  feedbackRatingBuckets,
  filterFeedbackByRating,
} from '@/lib/admissions/feedback-drill';

const RATINGS: Array<number | null> = [5, 5, 4, 3, 1, 0, 6, null, 2, null];
fx.apps = RATINGS.map((feedbackRating, i) => ({
  enroleeNumber: `E${i}`,
  studentNumber: null,
  enroleeFullName: `Child ${i}`,
  levelApplied: 'P1',
  feedbackRating,
  feedbackComments: i === 0 ? '  Easy form  ' : null,
  feedbackConsent: i === 0 ? true : null,
  // Row 7 (null rating) has a submission date so it is kept; row 9 is not.
  feedbackSubmittedAt: i === 9 ? null : `2026-02-0${(i % 9) + 1}T00:00:00Z`,
  motherEmail: null,
  fatherEmail: null,
}));
fx.statuses = RATINGS.map((_, i) => ({
  enroleeNumber: `E${i}`,
  applicationStatus: i === 0 ? 'Enrolled' : 'Submitted',
}));

describe('feedback-rating drill', () => {
  it('each ★ bar opens exactly the parents who gave that rating', async () => {
    const { rows } = await getAdmissionsFeedback('AY2026');
    const buckets = feedbackRatingBuckets(rows);
    expect(buckets).toEqual([
      { stars: 1, count: 1 },
      { stars: 2, count: 1 },
      { stars: 3, count: 1 },
      { stars: 4, count: 1 },
      { stars: 5, count: 2 },
    ]);
    for (const b of buckets) {
      expect(filterFeedbackByRating(rows, String(b.stars))).toHaveLength(
        b.count
      );
    }
  });

  it('no segment opens every in-scale rating — the response count on the card', async () => {
    const { rows, stats } = await getAdmissionsFeedback('AY2026');
    expect(filterFeedbackByRating(rows, null)).toHaveLength(stats.ratingCount);
  });

  it('an off-scale or unreadable segment opens an empty list', async () => {
    const { rows } = await getAdmissionsFeedback('AY2026');
    for (const seg of ['0', '6', 'abc', '4.5']) {
      expect(filterFeedbackByRating(rows, seg)).toEqual([]);
    }
  });

  it('writes one CSV cell per header', async () => {
    const { rows } = await getAdmissionsFeedback('AY2026');
    const row = rows.find((r) => r.enroleeNumber === 'E0')!;
    const cells = feedbackDrillCsvRow(row);
    expect(cells).toHaveLength(FEEDBACK_DRILL_CSV_HEADERS.length);
    expect(cells).toEqual([
      'Child 0',
      'E0',
      '',
      'P1',
      'Enrolled',
      5,
      'Easy form',
      'Yes',
      '2026-02-01T00:00:00Z',
    ]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run __tests__/admissions/feedback-rating-drill.test.ts --pool=threads`
Expected: FAIL — `Failed to resolve import "@/lib/admissions/feedback-drill"`.

- [ ] **Step 3: The filter — `lib/admissions/feedback-drill.ts`**

```ts
// lib/admissions/feedback-drill.ts
//
// The ★ histogram on /admissions/insights and the list each bar opens, from
// one rule (KD #229): a rating bucket is `feedbackRating === stars` over the
// in-scale values. Server-side only in practice — it imports the feedback
// loader's module; the client sheet imports just the FeedbackRow type.

import {
  FEEDBACK_RATING_MAX,
  FEEDBACK_RATING_MIN,
  isRatingInScale,
  type FeedbackRow,
} from '@/lib/admissions/feedback';

export type RatingBucket = { stars: number; count: number };

/** No segment = every in-scale rating (the card's response count); a star
 *  value = that rating; anything else = an empty list. */
export function filterFeedbackByRating(
  rows: readonly FeedbackRow[],
  segment: string | null | undefined
): FeedbackRow[] {
  if (segment === null || segment === undefined || segment === '') {
    return rows.filter((r) => isRatingInScale(r.feedbackRating));
  }
  const stars = Number(segment);
  if (!isRatingInScale(stars)) return [];
  return rows.filter((r) => r.feedbackRating === stars);
}

/** One bucket per star on the scale, zero-count ones included. */
export function feedbackRatingBuckets(
  rows: readonly FeedbackRow[]
): RatingBucket[] {
  return Array.from(
    { length: FEEDBACK_RATING_MAX - FEEDBACK_RATING_MIN + 1 },
    (_, i) => FEEDBACK_RATING_MIN + i
  ).map((stars) => ({
    stars,
    count: filterFeedbackByRating(rows, String(stars)).length,
  }));
}

export const FEEDBACK_DRILL_CSV_HEADERS = [
  'Applicant',
  'Applicant Number',
  'Student ID',
  'Level applied for',
  'Status',
  'Rating',
  'Comment',
  'Open to follow-up',
  'Submitted on',
];

export function feedbackDrillCsvRow(r: FeedbackRow): (string | number)[] {
  return [
    r.enroleeFullName ?? '',
    r.enroleeNumber,
    r.studentNumber ?? '',
    r.levelApplied ?? '',
    (r.applicationStatus ?? '').trim() || 'No status',
    r.feedbackRating ?? '',
    r.feedbackComments ?? '',
    r.feedbackConsent === true
      ? 'Yes'
      : r.feedbackConsent === false
        ? 'No'
        : '',
    r.feedbackSubmittedAt ?? '',
  ];
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run __tests__/admissions/feedback-rating-drill.test.ts --pool=threads`
Expected: PASS.

- [ ] **Step 5: The route — `app/api/admissions/drill/feedback-rating/route.ts`**

```ts
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { getAdmissionsFeedback } from '@/lib/admissions/feedback';
import {
  FEEDBACK_DRILL_CSV_HEADERS,
  feedbackDrillCsvRow,
  filterFeedbackByRating,
} from '@/lib/admissions/feedback-drill';
import { buildCsv } from '@/lib/csv';

// The ★ histogram's drill (KD #229). Its own route because its rows are
// feedback responses, not DrillRow applicants. A static segment, so Next
// serves it ahead of the sibling [target] route.

const ALLOWED_ROLES = [
  'admissions',
  'academic_coordinator',
  'school_admin',
  'superadmin',
] as const;

export async function GET(req: Request) {
  const guard = await requireRole([...ALLOWED_ROLES]);
  if ('error' in guard) return guard.error;

  const url = new URL(req.url);
  const ayCode = url.searchParams.get('ay');
  if (!ayCode || !/^AY\d{4}$/.test(ayCode)) {
    return NextResponse.json({ error: 'invalid_ay' }, { status: 400 });
  }
  const segment = url.searchParams.get('segment');

  const { rows: all } = await getAdmissionsFeedback(ayCode);
  const rows = filterFeedbackByRating(all, segment);

  if (url.searchParams.get('format') === 'csv') {
    const csv = buildCsv(
      FEEDBACK_DRILL_CSV_HEADERS,
      rows.map(feedbackDrillCsvRow)
    );
    const today = new Date().toISOString().slice(0, 10);
    const suffix = segment ? `-${segment.replace(/[^0-9]/g, '')}-stars` : '';
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="drill-admissions-feedback${suffix}-${ayCode}-${today}.csv"`,
      },
    });
  }

  const res = NextResponse.json({
    rows,
    total: rows.length,
    target: 'feedback-rating',
    segment,
    ayCode,
  });
  res.headers.set(
    'Cache-Control',
    'private, max-age=60, stale-while-revalidate=300'
  );
  return res;
}
```

- [ ] **Step 6: Export `StatusBadge`**

In `components/admissions/drills/admissions-drill-sheet.tsx` line 223, change `function StatusBadge(` to `export function StatusBadge(`.

- [ ] **Step 7: The sheet — `components/admissions/drills/feedback-rating-drill-sheet.tsx`**

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { StatusBadge } from '@/components/admissions/drills/admissions-drill-sheet';
import { DrillDownSheet } from '@/components/dashboard/drill-down-sheet';
import { DrillSheetSkeleton } from '@/components/dashboard/drill-sheet-skeleton';
import { Button } from '@/components/ui/button';
import type { FeedbackRow } from '@/lib/admissions/feedback';
import { apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils';

// The parents behind one bar of the Insights ★ histogram (KD #229). Its own
// sheet because a feedback response is not an applicant DrillRow.

const EMPTY_ROWS: FeedbackRow[] = [];

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function statusOf(row: FeedbackRow): string {
  return (row.applicationStatus ?? '').trim() || 'No status';
}

// KD #81: enrolled → Records; everyone else → their application.
function applicantHref(row: FeedbackRow): string {
  const status = statusOf(row);
  if (status !== 'Enrolled' && status !== 'Enrolled (Conditional)') {
    return `/admissions/applications/${encodeURIComponent(row.enroleeNumber)}`;
  }
  return row.studentNumber
    ? `/records/students/${encodeURIComponent(row.studentNumber)}`
    : `/records/students/by-enrolee/${encodeURIComponent(row.enroleeNumber)}`;
}

function feedbackDrillUrl(
  ayCode: string,
  segment: string | null,
  format: 'json' | 'csv'
): string {
  const params = new URLSearchParams({ ay: ayCode });
  if (segment) params.set('segment', segment);
  if (format === 'csv') params.set('format', 'csv');
  return `/api/admissions/drill/feedback-rating?${params.toString()}`;
}

const COLUMNS: ColumnDef<FeedbackRow, unknown>[] = [
  {
    id: 'applicant',
    accessorFn: (r) => r.enroleeFullName ?? r.enroleeNumber,
    header: 'Applicant',
    meta: { label: 'Applicant' },
    cell: ({ row }) => (
      <div className="space-y-0.5">
        <Link
          href={applicantHref(row.original)}
          className="font-medium text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
        >
          {row.original.enroleeFullName ?? row.original.enroleeNumber}
        </Link>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {row.original.enroleeNumber}
        </div>
      </div>
    ),
    enableSorting: true,
  },
  {
    id: 'levelApplied',
    accessorFn: (r) => r.levelApplied ?? '',
    header: 'Level applied for',
    meta: { label: 'Level applied for' },
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.levelApplied?.trim() || '—'}
      </span>
    ),
    enableSorting: true,
  },
  {
    id: 'status',
    accessorFn: statusOf,
    header: 'Status',
    meta: { label: 'Status' },
    cell: ({ row }) => <StatusBadge status={statusOf(row.original)} />,
    enableSorting: true,
  },
  {
    id: 'rating',
    accessorKey: 'feedbackRating',
    header: 'Rating',
    meta: { label: 'Rating' },
    cell: ({ row }) => (
      <span className="font-mono text-sm tabular-nums text-foreground">
        {row.original.feedbackRating ?? '—'} / 5
      </span>
    ),
    enableSorting: true,
  },
  {
    id: 'comment',
    accessorFn: (r) => r.feedbackComments ?? '',
    header: 'Comment',
    meta: { label: 'Comment' },
    cell: ({ row }) => (
      <p className="max-w-80 whitespace-normal text-sm leading-relaxed text-foreground">
        {row.original.feedbackComments ?? '—'}
      </p>
    ),
    enableSorting: false,
  },
  {
    id: 'consent',
    accessorFn: (r) =>
      r.feedbackConsent === true
        ? 'Yes'
        : r.feedbackConsent === false
          ? 'No'
          : '',
    header: 'Open to follow-up',
    meta: { label: 'Open to follow-up' },
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.feedbackConsent === true
          ? 'Yes'
          : row.original.feedbackConsent === false
            ? 'No'
            : '—'}
      </span>
    ),
    enableSorting: true,
  },
  {
    id: 'submittedAt',
    accessorKey: 'feedbackSubmittedAt',
    header: 'Submitted on',
    meta: { label: 'Submitted on' },
    cell: ({ row }) => (
      <span className="text-sm tabular-nums text-muted-foreground">
        {formatDate(row.original.feedbackSubmittedAt)}
      </span>
    ),
    enableSorting: true,
  },
];

export function FeedbackRatingDrillSheet({
  ayCode,
  segment,
}: {
  ayCode: string;
  segment: string | null;
}) {
  const query = useQuery({
    queryKey: queryKeys.admissionsDrill('feedback-rating', {
      ay: ayCode,
      segment,
    }),
    queryFn: async ({ signal }) => {
      const json = await apiFetch<{ rows?: FeedbackRow[] }>(
        feedbackDrillUrl(ayCode, segment, 'json'),
        { credentials: 'include', signal }
      );
      return Array.isArray(json.rows) ? json.rows : [];
    },
  });

  const rows = query.data ?? EMPTY_ROWS;
  const title = segment
    ? `Parents who rated the form ${segment} out of 5`
    : 'Every rating of the application form';

  if (query.isLoading) return <DrillSheetSkeleton title={title} />;

  if (query.isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-b from-destructive/15 to-destructive/5 text-destructive ring-1 ring-inset ring-destructive/20">
          <AlertTriangle className="size-6" />
        </div>
        <p className="font-serif text-lg font-semibold text-foreground">
          Couldn’t load these ratings
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RotateCcw
            className={cn('size-4', query.isFetching && 'animate-spin')}
          />
          Try again
        </Button>
      </div>
    );
  }

  return (
    <DrillDownSheet<FeedbackRow>
      title={title}
      eyebrow="Application experience"
      description="Whole academic year"
      count={rows.length}
      csvHref={feedbackDrillUrl(ayCode, segment, 'csv')}
      columns={COLUMNS}
      rows={rows}
      emptyMessage="No parent gave this rating."
    />
  );
}
```

- [ ] **Step 8: Type-check and run the column-label guard**

Run: `npx tsc --noEmit` then `npx vitest run __tests__/ui/data-table-column-label-coverage.test.ts __tests__/admissions/feedback-rating-drill.test.ts --pool=threads`
Expected: tsc exits 0; both test files PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/admissions/feedback-drill.ts app/api/admissions/drill/feedback-rating/route.ts components/admissions/drills/feedback-rating-drill-sheet.tsx components/admissions/drills/admissions-drill-sheet.tsx __tests__/admissions/feedback-rating-drill.test.ts && git commit -m "feat(admissions): each star rating opens the parents who gave it

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.7: Segment mapping for the wrappers, and the sheet's Insights options

**Files:**

- Create: `lib/admissions/insights-drill-segments.ts`
- Modify: `components/admissions/drills/admissions-drill-sheet.tsx` (props 50-61; state 627-631; `buildColumnDef` before `default:` 607; `description` 859; imports 23-42)
- Test: `__tests__/admissions/insights-drill-segments.test.ts`

**Interfaces:**

- Consumes: `encodePairSegment`, `OTHER_REASONS_BAR_KEY`, `OVERFLOW_SEGMENT`, `reasonLabel` (Task 3.1).
- Produces:
  - `insights-drill-segments.ts` (client-safe): `const INSIGHTS_SCOPE_LABEL = 'Whole academic year'`; `function resolveSeriesAy(series: string | undefined, ays: { selectedAy: string; compareAy: string | null }): string`; `function ratingSegmentFromCategory(category: string): string | null`; `function assessmentSegment(subject: string, series: string | undefined): string | null`; `function reasonSegmentForSlice(sliceName: string, bars: ReadonlyArray<{ key: string; label: string }>): string | null`; `function referralSegmentForSlice(sliceName: string, rows: ReadonlyArray<{ source: string; folded?: true }>): string`; `function nationalitySegment(nationality: string, level?: string): string`; `function levelReasonsSegment(level: string): string`
  - `AdmissionsDrillSheetProps` gains `scopeLabel?: string` (replaces the date-anchor line) and `initialGroupBy?: DrillDownGroupBy`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/admissions/insights-drill-segments.test.ts
import { describe, expect, it } from 'vitest';

import {
  assessmentSegment,
  levelReasonsSegment,
  nationalitySegment,
  ratingSegmentFromCategory,
  reasonSegmentForSlice,
  referralSegmentForSlice,
  resolveSeriesAy,
} from '@/lib/admissions/insights-drill-segments';
import {
  decodePairSegment,
  OVERFLOW_SEGMENT,
} from '@/lib/admissions/insights-predicates';

const AYS = { selectedAy: 'AY2026', compareAy: 'AY2025' };

describe('resolveSeriesAy', () => {
  it('sends a comparison click to the comparison year', () => {
    expect(resolveSeriesAy('comparison', AYS)).toBe('AY2025');
    expect(resolveSeriesAy('compare', AYS)).toBe('AY2025');
    expect(resolveSeriesAy('AY2025', AYS)).toBe('AY2025');
  });
  it('sends everything else to the selected year', () => {
    expect(resolveSeriesAy('current', AYS)).toBe('AY2026');
    expect(resolveSeriesAy(undefined, AYS)).toBe('AY2026');
    expect(
      resolveSeriesAy('comparison', { selectedAy: 'AY2026', compareAy: null })
    ).toBe('AY2026');
  });
});

describe('ratingSegmentFromCategory', () => {
  it('reads the star count off the bar label', () => {
    expect(ratingSegmentFromCategory('4★')).toBe('4');
    expect(ratingSegmentFromCategory('★')).toBeNull();
  });
});

describe('assessmentSegment', () => {
  it('maps subject + series key to the target segment', () => {
    expect(assessmentSegment('Math', 'pass')).toBe('math:pass');
    expect(assessmentSegment('English', 'notAssessed')).toBe('eng:notAssessed');
    expect(assessmentSegment('Science', 'pass')).toBeNull();
    expect(assessmentSegment('Math', undefined)).toBeNull();
  });
});

describe('reasonSegmentForSlice', () => {
  const bars = [
    { key: 'financial', label: 'Financial reasons' },
    { key: 'other_reasons', label: 'Other reasons' },
  ];
  it('opens a named reason by its code', () => {
    expect(
      decodePairSegment(reasonSegmentForSlice('Financial reasons', bars)!)
    ).toEqual({
      first: '',
      second: 'financial',
    });
  });
  it('opens the overflow slice as the overflow bucket', () => {
    expect(
      decodePairSegment(reasonSegmentForSlice('Other reasons', bars)!)
    ).toEqual({
      first: '',
      second: OVERFLOW_SEGMENT,
    });
  });
  it('ignores a slice it does not know', () => {
    expect(reasonSegmentForSlice('Nope', bars)).toBeNull();
  });
});

describe('referralSegmentForSlice', () => {
  it('opens the folded Other as the overflow bucket', () => {
    const rows = [
      { source: 'Facebook' },
      { source: 'Other', folded: true as const },
    ];
    expect(referralSegmentForSlice('Other', rows)).toBe(OVERFLOW_SEGMENT);
    expect(referralSegmentForSlice('Facebook', rows)).toBe('Facebook');
  });
  it('keeps a real source named Other when nothing was folded', () => {
    expect(referralSegmentForSlice('Other', [{ source: 'Other' }])).toBe(
      'Other'
    );
  });
});

describe('pair helpers', () => {
  it('build the nationality and level-reasons segments', () => {
    expect(decodePairSegment(nationalitySegment('Singapore'))).toEqual({
      first: '',
      second: 'Singapore',
    });
    expect(
      decodePairSegment(
        nationalitySegment('Other', 'Youngstarters | Little Stars')
      )
    ).toEqual({ first: 'Youngstarters | Little Stars', second: 'Other' });
    expect(decodePairSegment(levelReasonsSegment('P1'))).toEqual({
      first: 'P1',
      second: '',
    });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run __tests__/admissions/insights-drill-segments.test.ts --pool=threads`
Expected: FAIL — `Failed to resolve import "@/lib/admissions/insights-drill-segments"`.

- [ ] **Step 3: Implement `lib/admissions/insights-drill-segments.ts`**

```ts
// lib/admissions/insights-drill-segments.ts
//
// Turns a chart click on /admissions/insights into the drill target's
// segment and year (KD #229). Pure and client-safe — the 'use client'
// wrappers in components/admissions/drills/insights-drill-cards.tsx call it.

import {
  encodePairSegment,
  OTHER_REASONS_BAR_KEY,
  OVERFLOW_SEGMENT,
} from '@/lib/admissions/insights-predicates';

/** Shown under every Insights drill's title in place of the date anchor —
 *  Admissions Insights is whole-year, so its drills take no date range. */
export const INSIGHTS_SCOPE_LABEL = 'Whole academic year';

/** TrendChart reports 'current' | 'comparison'; this page's GroupedBarChart
 *  series keys are 'current' | 'compare'. Either comparison name, or the
 *  comparison year itself, opens the comparison year (Review Focus #1). */
export function resolveSeriesAy(
  series: string | undefined,
  ays: { selectedAy: string; compareAy: string | null }
): string {
  if (!ays.compareAy || series === undefined) return ays.selectedAy;
  if (
    series === 'comparison' ||
    series === 'compare' ||
    series === ays.compareAy
  ) {
    return ays.compareAy;
  }
  return ays.selectedAy;
}

/** '4★' → '4'. */
export function ratingSegmentFromCategory(category: string): string | null {
  const match = /^\s*(\d+)/.exec(category);
  return match ? match[1] : null;
}

const ASSESSMENT_SUBJECT: Readonly<Record<string, 'math' | 'eng'>> = {
  Math: 'math',
  English: 'eng',
};
const ASSESSMENT_OUTCOME: ReadonlySet<string> = new Set([
  'pass',
  'fail',
  'notAssessed',
]);

/** ('English', 'notAssessed') → 'eng:notAssessed'. */
export function assessmentSegment(
  subject: string,
  series: string | undefined
): string | null {
  const subj = ASSESSMENT_SUBJECT[subject];
  if (!subj || !series || !ASSESSMENT_OUTCOME.has(series)) return null;
  return `${subj}:${series}`;
}

/** A cancellation-reasons donut slice (drawn by label) → its reason code,
 *  or the overflow bucket for "Other reasons". */
export function reasonSegmentForSlice(
  sliceName: string,
  bars: ReadonlyArray<{ key: string; label: string }>
): string | null {
  const bar = bars.find((b) => b.label === sliceName);
  if (!bar) return null;
  return encodePairSegment(
    '',
    bar.key === OTHER_REASONS_BAR_KEY ? OVERFLOW_SEGMENT : bar.key
  );
}

/** A by-source donut slice → its source, or the overflow bucket when it is
 *  the folded Other row. */
export function referralSegmentForSlice(
  sliceName: string,
  rows: ReadonlyArray<{ source: string; folded?: true }>
): string {
  const folded = rows.find((r) => r.folded === true);
  return folded && folded.source === sliceName ? OVERFLOW_SEGMENT : sliceName;
}

/** The nationality pie (no level) or the nationality × level bars. */
export function nationalitySegment(
  nationality: string,
  level?: string
): string {
  return encodePairSegment(level ?? '', nationality);
}

/** Every cancellation reason recorded for one level. */
export function levelReasonsSegment(level: string): string {
  return encodePairSegment(level, '');
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run __tests__/admissions/insights-drill-segments.test.ts --pool=threads`
Expected: PASS.

- [ ] **Step 5: The sheet learns the Insights options and the new columns**

In `components/admissions/drills/admissions-drill-sheet.tsx`, add to `AdmissionsDrillSheetProps` after `initialRows` (line 60):

```ts
  /** Replaces the date-anchor line under the title. Insights passes
   *  "Whole academic year" (its drills take no range). */
  scopeLabel?: string;
  /** Opening grouping. Conversion rate on Insights opens grouped by status. */
  initialGroupBy?: DrillDownGroupBy;
```

Destructure `scopeLabel, initialGroupBy` in the component signature (line 624) and replace the `groupBy` state initialiser (lines 629-631) with:

```ts
const [groupBy, setGroupBy] = React.useState<DrillDownGroupBy>(
  () => initialGroupBy ?? (target === 'conversion' ? 'status' : 'none')
);
```

Replace `description={dateAnchorLabel}` (line 859) with `description={scopeLabel ?? dateAnchorLabel}`. Add `import { reasonLabel } from '@/lib/admissions/insights-predicates';` to the imports, and to `buildColumnDef` before `default:` (line 607):

```tsx
    case 'levelAsApplied':
      return {
        id: 'levelAsApplied',
        accessorKey: 'levelAsApplied',
        header,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.levelAsApplied?.trim() || '—'}
          </span>
        ),
        enableSorting: true,
      };
    case 'terminalReason':
      return {
        id: 'terminalReason',
        accessorFn: (r) => (r.terminalReason ? reasonLabel(r.terminalReason) : ''),
        header,
        cell: ({ row }) => (
          <span className="text-sm text-foreground">
            {row.original.terminalReason
              ? reasonLabel(row.original.terminalReason)
              : '—'}
          </span>
        ),
        enableSorting: true,
      };
    case 'category':
      return {
        id: 'category',
        accessorKey: 'category',
        header,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.category ?? '—'}
          </span>
        ),
        enableSorting: true,
      };
    case 'nationality':
      return {
        id: 'nationality',
        accessorKey: 'nationality',
        header,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.nationality ?? '—'}
          </span>
        ),
        enableSorting: true,
      };
```

- [ ] **Step 6: Type-check and run the guards**

Run: `npx tsc --noEmit` then `npx vitest run __tests__/ui/data-table-column-label-coverage.test.ts __tests__/admissions --pool=threads`
Expected: tsc exits 0 (the `never` exhaustiveness guard in `buildColumnDef` proves every new column key is rendered); all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/admissions/insights-drill-segments.ts components/admissions/drills/admissions-drill-sheet.tsx __tests__/admissions/insights-drill-segments.test.ts && git commit -m "feat(admissions): map insights chart clicks to drill segments; sheet shows the new columns

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.8: Client wrappers that open the sheet from each chart and list

**Files:**

- Create: `components/admissions/drills/insights-drill-cards.tsx`
- Test: `__tests__/admissions/insights-drill-cards.test.tsx`

**Interfaces:**

- Consumes: `AdmissionsDrillSheet` (with `scopeLabel`), `FeedbackRatingDrillSheet` (Task 3.6), the Task 3.7 mapping functions, Phase 1's `onSegmentClick` on `TrendChart`, `GroupedBarChart`, `NationalityMixPie`, `NationalityByLevelBars`; the existing one on `DonutChart` / `ComparisonBarChart`; `Sheet` (`components/ui/sheet`), `Button`.
- Produces (all `'use client'`, props serialisable from the RSC page):
  - `IntakeTrendDrillChart({ label, current, comparison, selectedAy, compareAy })`
  - `FeedbackRatingDrillChart({ data: ComparisonBarPoint[], ayCode })`
  - `WithdrawnByLevelDrillDonut({ data: DonutSlice[], centerValue, centerLabel, ayCode })`
  - `AssessmentConversionDrillChart({ series: GroupedBarSeries[], data, ayCode })`
  - `CancellationReasonsDrillDonut({ bars: ReasonBar[], centerValue, centerLabel, ayCode })`
  - `TerminalReasonsSeeAll({ ayCode })`
  - `TopReasonPerLevelList({ ayCode, rows: { level: string; count: number; topReasonLabel: string | null }[] })`
  - `ReferralVolumeDrillDonut({ rows: ReferralConversionRow[], centerValue, centerLabel, ayCode })`
  - `CategoryMixDrillChart({ series: GroupedBarSeries[], data, selectedAy, compareAy })`
  - `NationalityMixDrillPie({ rows, compareRows, compareLabel, unitLabel, ayCode })`
  - `NationalityByLevelDrillBars({ data: NationalityByLevel, unitLabel, ayCode })`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/admissions/insights-drill-cards.test.tsx
//
// The wrappers turn a click into (target, segment, year). Charts and sheets
// are mocked to buttons / a JSON readout so each test clicks exactly the
// part a reader would, and reads back what would open.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Click = (category: string, series?: string) => void;

vi.mock('@/components/admissions/drills/admissions-drill-sheet', () => ({
  AdmissionsDrillSheet: (p: {
    target: string;
    segment?: string | null;
    ayCode: string;
    scopeLabel?: string;
    initialGroupBy?: string;
  }) => (
    <output data-testid="drill">
      {JSON.stringify({
        target: p.target,
        segment: p.segment ?? null,
        ayCode: p.ayCode,
        scopeLabel: p.scopeLabel ?? null,
      })}
    </output>
  ),
}));
vi.mock('@/components/admissions/drills/feedback-rating-drill-sheet', () => ({
  FeedbackRatingDrillSheet: (p: { ayCode: string; segment: string | null }) => (
    <output data-testid="drill">
      {JSON.stringify({
        target: 'feedback-rating',
        segment: p.segment,
        ayCode: p.ayCode,
      })}
    </output>
  ),
}));
vi.mock('@/components/dashboard/charts/trend-chart', () => ({
  TrendChart: ({ onSegmentClick }: { onSegmentClick?: Click }) => (
    <div>
      <button onClick={() => onSegmentClick?.('Mar', 'current')}>
        current Mar
      </button>
      <button onClick={() => onSegmentClick?.('Mar', 'comparison')}>
        comparison Mar
      </button>
      <button onClick={() => onSegmentClick?.('Oct', 'current')}>
        current Oct
      </button>
    </div>
  ),
}));
vi.mock('@/components/dashboard/charts/grouped-bar-chart', () => ({
  GroupedBarChart: ({
    data,
    series,
    onSegmentClick,
  }: {
    data: Array<{ x: string }>;
    series: Array<{ key: string }>;
    onSegmentClick?: Click;
  }) => (
    <div>
      {data.flatMap((row) =>
        series.map((s) => (
          <button
            key={`${row.x}-${s.key}`}
            onClick={() => onSegmentClick?.(row.x, s.key)}
          >
            {`${row.x} ${s.key}`}
          </button>
        ))
      )}
    </div>
  ),
}));
vi.mock('@/components/dashboard/charts/donut-chart', () => ({
  DonutChart: ({
    data,
    onSegmentClick,
  }: {
    data: Array<{ name: string }>;
    onSegmentClick?: Click;
  }) => (
    <div>
      {data.map((d) => (
        <button key={d.name} onClick={() => onSegmentClick?.(d.name)}>
          {d.name}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('@/components/dashboard/charts/comparison-bar-chart', () => ({
  ComparisonBarChart: ({
    data,
    onSegmentClick,
  }: {
    data: Array<{ category: string }>;
    onSegmentClick?: Click;
  }) => (
    <div>
      {data.map((d) => (
        <button key={d.category} onClick={() => onSegmentClick?.(d.category)}>
          {d.category}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('@/components/dashboard/insights/nationality-mix-pie', () => ({
  NationalityMixPie: ({
    rows,
    onSegmentClick,
  }: {
    rows: Array<{ nationality: string }>;
    onSegmentClick?: Click;
  }) => (
    <div>
      {rows.map((r) => (
        <button
          key={r.nationality}
          onClick={() => onSegmentClick?.(r.nationality)}
        >
          {r.nationality}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('@/components/dashboard/insights/nationality-by-level-bars', () => ({
  NationalityByLevelBars: ({
    data,
    onSegmentClick,
  }: {
    data: {
      rows: Array<{ level: string; segments: Array<{ nationality: string }> }>;
    };
    onSegmentClick?: Click;
  }) => (
    <div>
      {data.rows.flatMap((r) =>
        r.segments.map((s) => (
          <button
            key={`${r.level}-${s.nationality}`}
            onClick={() => onSegmentClick?.(r.level, s.nationality)}
          >
            {`${r.level} ${s.nationality}`}
          </button>
        ))
      )}
    </div>
  ),
}));

import {
  AssessmentConversionDrillChart,
  CancellationReasonsDrillDonut,
  CategoryMixDrillChart,
  FeedbackRatingDrillChart,
  IntakeTrendDrillChart,
  NationalityByLevelDrillBars,
  NationalityMixDrillPie,
  ReferralVolumeDrillDonut,
  TerminalReasonsSeeAll,
  TopReasonPerLevelList,
  WithdrawnByLevelDrillDonut,
} from '@/components/admissions/drills/insights-drill-cards';
import {
  encodePairSegment,
  OVERFLOW_SEGMENT,
} from '@/lib/admissions/insights-predicates';

afterEach(cleanup);

const opened = () =>
  JSON.parse(screen.getByTestId('drill').textContent ?? 'null') as {
    target: string;
    segment: string | null;
    ayCode: string;
    scopeLabel?: string | null;
  };

describe('IntakeTrendDrillChart', () => {
  const current = [
    { x: 'Mar', y: 4 },
    { x: 'Oct', y: null as unknown as number },
  ];
  const comparison = [
    { x: 'Mar', y: 2 },
    { x: 'Oct', y: 1 },
  ];
  const props = {
    label: 'Applications',
    current,
    comparison,
    selectedAy: 'AY2026',
    compareAy: 'AY2025',
  };

  it("opens last year's applications for a click on last year's point", () => {
    render(<IntakeTrendDrillChart {...props} />);
    fireEvent.click(screen.getByText('comparison Mar'));
    expect(opened()).toEqual({
      target: 'intake-month',
      segment: 'Mar',
      ayCode: 'AY2025',
      scopeLabel: 'Whole academic year',
    });
  });

  it("opens this year's applications for this year's point", () => {
    render(<IntakeTrendDrillChart {...props} />);
    fireEvent.click(screen.getByText('current Mar'));
    expect(opened().ayCode).toBe('AY2026');
  });

  it('opens nothing for a month that has not happened yet', () => {
    render(<IntakeTrendDrillChart {...props} />);
    fireEvent.click(screen.getByText('current Oct'));
    expect(screen.queryByTestId('drill')).toBeNull();
  });
});

describe('CategoryMixDrillChart', () => {
  it("opens the comparison year's category for its bar", () => {
    render(
      <CategoryMixDrillChart
        series={[
          { key: 'current', label: 'AY2026' },
          { key: 'compare', label: 'AY2025', muted: true },
        ]}
        data={[{ x: 'New', current: 3, compare: 2 }]}
        selectedAy="AY2026"
        compareAy="AY2025"
      />
    );
    fireEvent.click(screen.getByText('New compare'));
    expect(opened()).toMatchObject({
      target: 'category',
      segment: 'New',
      ayCode: 'AY2025',
    });
  });
});

describe('AssessmentConversionDrillChart', () => {
  it('opens the not-assessed English applicants', () => {
    render(
      <AssessmentConversionDrillChart
        series={[
          { key: 'pass', label: 'Pass' },
          { key: 'notAssessed', label: 'Not assessed' },
        ]}
        data={[{ x: 'English', pass: 50, notAssessed: 20 }]}
        ayCode="AY2026"
      />
    );
    fireEvent.click(screen.getByText('English notAssessed'));
    expect(opened()).toMatchObject({
      target: 'assessment-all',
      segment: 'eng:notAssessed',
    });
  });
});

describe('CancellationReasonsDrillDonut', () => {
  it('opens the overflow slice as the overflow bucket', () => {
    render(
      <CancellationReasonsDrillDonut
        bars={[
          { key: 'financial', label: 'Financial reasons', count: 4 },
          { key: 'other_reasons', label: 'Other reasons', count: 3 },
        ]}
        centerValue="7"
        centerLabel="Cancellations"
        ayCode="AY2026"
      />
    );
    fireEvent.click(screen.getByText('Other reasons'));
    expect(opened()).toMatchObject({
      target: 'terminal-reason',
      segment: encodePairSegment('', OVERFLOW_SEGMENT),
    });
  });
});

describe('Top reason per level', () => {
  it('a row opens every reason for that level', () => {
    render(
      <TopReasonPerLevelList
        ayCode="AY2026"
        rows={[
          {
            level: 'Youngstarters | Little Stars',
            count: 3,
            topReasonLabel: 'Financial reasons',
          },
        ]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Youngstarters/ }));
    expect(opened()).toMatchObject({
      target: 'terminal-reason',
      segment: encodePairSegment('Youngstarters | Little Stars', ''),
    });
  });

  it('See all opens every application with a reason', () => {
    render(<TerminalReasonsSeeAll ayCode="AY2026" />);
    fireEvent.click(screen.getByRole('button', { name: 'See all' }));
    expect(opened()).toMatchObject({
      target: 'terminal-reason',
      segment: null,
    });
  });
});

describe('ReferralVolumeDrillDonut', () => {
  it('opens the folded Other as the overflow bucket', () => {
    render(
      <ReferralVolumeDrillDonut
        rows={[
          { source: 'Facebook', applied: 5, enrolled: 1, conversionPct: 20 },
          {
            source: 'Other',
            applied: 3,
            enrolled: 0,
            conversionPct: 0,
            folded: true,
          },
        ]}
        centerValue="8"
        centerLabel="Applicants"
        ayCode="AY2026"
      />
    );
    fireEvent.click(screen.getByText('Other'));
    expect(opened()).toMatchObject({
      target: 'referral-all',
      segment: OVERFLOW_SEGMENT,
    });
  });
});

describe('the remaining charts', () => {
  it('a ★ bar opens that rating', () => {
    render(
      <FeedbackRatingDrillChart
        data={[{ category: '4★', current: 2 }]}
        ayCode="AY2026"
      />
    );
    fireEvent.click(screen.getByText('4★'));
    expect(opened()).toEqual({
      target: 'feedback-rating',
      segment: '4',
      ayCode: 'AY2026',
    });
  });

  it('a withdrawn slice opens that level', () => {
    render(
      <WithdrawnByLevelDrillDonut
        data={[{ name: 'P1', value: 2 }]}
        centerValue="2"
        centerLabel="Withdrawn"
        ayCode="AY2026"
      />
    );
    fireEvent.click(screen.getByText('P1'));
    expect(opened()).toMatchObject({
      target: 'withdrawn-by-level',
      segment: 'P1',
    });
  });

  it('a nationality slice opens that nationality', () => {
    render(
      <NationalityMixDrillPie
        rows={[{ nationality: 'Singapore', count: 3 }]}
        compareRows={null}
        compareLabel={null}
        unitLabel="applicants"
        ayCode="AY2026"
      />
    );
    fireEvent.click(screen.getByText('Singapore'));
    expect(opened()).toMatchObject({
      target: 'nationality',
      segment: encodePairSegment('', 'Singapore'),
    });
  });

  it('a nationality × level segment opens that level and bucket', () => {
    render(
      <NationalityByLevelDrillBars
        data={{
          legend: ['Other'],
          rows: [
            {
              level: 'Youngstarters | Little Stars',
              total: 2,
              segments: [{ nationality: 'Other', count: 2 }],
            },
          ],
        }}
        unitLabel="applicants"
        ayCode="AY2026"
      />
    );
    fireEvent.click(screen.getByText('Youngstarters | Little Stars Other'));
    expect(opened()).toMatchObject({
      target: 'nationality',
      segment: encodePairSegment('Youngstarters | Little Stars', 'Other'),
    });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run __tests__/admissions/insights-drill-cards.test.tsx --pool=threads`
Expected: FAIL — `Failed to resolve import "@/components/admissions/drills/insights-drill-cards"`.

- [ ] **Step 3: Implement `components/admissions/drills/insights-drill-cards.tsx`**

```tsx
'use client';

import { GraduationCap } from 'lucide-react';
import * as React from 'react';

import { AdmissionsDrillSheet } from '@/components/admissions/drills/admissions-drill-sheet';
import { FeedbackRatingDrillSheet } from '@/components/admissions/drills/feedback-rating-drill-sheet';
import {
  ComparisonBarChart,
  type ComparisonBarPoint,
} from '@/components/dashboard/charts/comparison-bar-chart';
import {
  DonutChart,
  type DonutSlice,
} from '@/components/dashboard/charts/donut-chart';
import {
  GroupedBarChart,
  type GroupedBarChartProps,
  type GroupedBarSeries,
} from '@/components/dashboard/charts/grouped-bar-chart';
import {
  TrendChart,
  type TrendPoint,
} from '@/components/dashboard/charts/trend-chart';
import { NationalityByLevelBars } from '@/components/dashboard/insights/nationality-by-level-bars';
import { NationalityMixPie } from '@/components/dashboard/insights/nationality-mix-pie';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import type { DrillTarget } from '@/lib/admissions/drill';
import type { ReasonBar } from '@/lib/admissions/insights';
import {
  assessmentSegment,
  INSIGHTS_SCOPE_LABEL,
  levelReasonsSegment,
  nationalitySegment,
  ratingSegmentFromCategory,
  reasonSegmentForSlice,
  referralSegmentForSlice,
  resolveSeriesAy,
} from '@/lib/admissions/insights-drill-segments';
import type {
  NationalityByLevel,
  NationalityMixRow,
  ReferralConversionRow,
} from '@/lib/admissions/insights-funnel';

// Admissions Insights (KD #229): each wrapper holds the clicked segment and
// opens the Admissions drill sheet for it. One 'use client' module so the
// Server Component page passes data only — never a function (Next 16 rejects
// functions across the boundary, and only at render time).
//
// No `initialRows`: a comparison-year click would paint the selected year's
// broad rows under the other year's title while it fetched. These open on the
// skeleton instead.

type Pick = { ayCode: string; segment: string | null };

function useDrillPick() {
  const [pick, setPick] = React.useState<Pick | null>(null);
  const onOpenChange = React.useCallback((open: boolean) => {
    if (!open) setPick(null);
  }, []);
  return { pick, setPick, onOpenChange };
}

function InsightsDrill({
  target,
  pick,
}: {
  target: DrillTarget;
  pick: Pick | null;
}) {
  if (!pick) return null;
  return (
    <AdmissionsDrillSheet
      target={target}
      segment={pick.segment}
      ayCode={pick.ayCode}
      scopeLabel={INSIGHTS_SCOPE_LABEL}
    />
  );
}

// ─── Applications per month ─────────────────────────────────────────────────

export function IntakeTrendDrillChart({
  label,
  current,
  comparison,
  selectedAy,
  compareAy,
}: {
  label: string;
  current: TrendPoint[];
  comparison: TrendPoint[] | null;
  selectedAy: string;
  compareAy: string | null;
}) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  const handleClick = React.useCallback(
    (x: string, series?: string) => {
      const ayCode = resolveSeriesAy(series, { selectedAy, compareAy });
      const points = ayCode === selectedAy ? current : (comparison ?? []);
      const point = points.find((p) => p.x === x);
      // A month that has not happened yet is a gap, not a zero.
      if (!point || (point.y as number | null) === null) return;
      setPick({ ayCode, segment: x });
    },
    [current, comparison, selectedAy, compareAy, setPick]
  );
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <TrendChart
        label={label}
        current={current}
        comparison={comparison}
        yFormat="number"
        onSegmentClick={handleClick}
      />
      <InsightsDrill target="intake-month" pick={pick} />
    </Sheet>
  );
}

// ─── Application experience ─────────────────────────────────────────────────

export function FeedbackRatingDrillChart({
  data,
  ayCode,
}: {
  data: ComparisonBarPoint[];
  ayCode: string;
}) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <ComparisonBarChart
        data={data}
        orientation="vertical"
        yFormat="number"
        height={200}
        rotateLabels={false}
        onSegmentClick={(category: string) => {
          const segment = ratingSegmentFromCategory(category);
          if (segment) setPick({ ayCode, segment });
        }}
      />
      {pick && (
        <FeedbackRatingDrillSheet ayCode={pick.ayCode} segment={pick.segment} />
      )}
    </Sheet>
  );
}

// ─── Withdrawn by level ─────────────────────────────────────────────────────

export function WithdrawnByLevelDrillDonut({
  data,
  centerValue,
  centerLabel,
  ayCode,
}: {
  data: DonutSlice[];
  centerValue: string;
  centerLabel: string;
  ayCode: string;
}) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <DonutChart
        data={data}
        centerValue={centerValue}
        centerLabel={centerLabel}
        onSegmentClick={(level: string) => setPick({ ayCode, segment: level })}
      />
      <InsightsDrill target="withdrawn-by-level" pick={pick} />
    </Sheet>
  );
}

// ─── Entrance assessment ────────────────────────────────────────────────────

export function AssessmentConversionDrillChart({
  series,
  data,
  ayCode,
}: {
  series: GroupedBarSeries[];
  data: GroupedBarChartProps['data'];
  ayCode: string;
}) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <GroupedBarChart
        series={series}
        data={data}
        yFormat="percent"
        height={240}
        onSegmentClick={(subject: string, s?: string) => {
          const segment = assessmentSegment(subject, s);
          if (segment) setPick({ ayCode, segment });
        }}
      />
      <InsightsDrill target="assessment-all" pick={pick} />
    </Sheet>
  );
}

// ─── Cancellation reasons ───────────────────────────────────────────────────

export function CancellationReasonsDrillDonut({
  bars,
  centerValue,
  centerLabel,
  ayCode,
}: {
  bars: ReasonBar[];
  centerValue: string;
  centerLabel: string;
  ayCode: string;
}) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  const data = React.useMemo<DonutSlice[]>(
    () => bars.map((b) => ({ name: b.label, value: b.count })),
    [bars]
  );
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <DonutChart
        data={data}
        centerValue={centerValue}
        centerLabel={centerLabel}
        onSegmentClick={(name: string) => {
          const segment = reasonSegmentForSlice(name, bars);
          if (segment) setPick({ ayCode, segment });
        }}
      />
      <InsightsDrill target="terminal-reason" pick={pick} />
    </Sheet>
  );
}

/** The ghost "See all" in the Top-reason-per-level card header. */
export function TerminalReasonsSeeAll({ ayCode }: { ayCode: string }) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setPick({ ayCode, segment: null })}
      >
        See all
      </Button>
      <InsightsDrill target="terminal-reason" pick={pick} />
    </Sheet>
  );
}

/** Top reason per level — each row opens every reason recorded for its
 *  level, because the figure on the row is the level's total. */
export function TopReasonPerLevelList({
  ayCode,
  rows,
}: {
  ayCode: string;
  rows: { level: string; count: number; topReasonLabel: string | null }[];
}) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <div>
        {rows.map((lvl) => (
          <button
            key={lvl.level}
            type="button"
            onClick={() =>
              setPick({ ayCode, segment: levelReasonsSegment(lvl.level) })
            }
            className="flex w-full cursor-pointer items-center gap-3.5 rounded-md border-t border-hairline py-3 text-left transition-colors first:border-t-0 first:pt-1 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <GraduationCap className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold text-foreground">
                {lvl.level}
              </div>
              <div className="truncate text-[11.5px] text-muted-foreground">
                {lvl.topReasonLabel ?? '—'}
              </div>
            </div>
            <span className="shrink-0 font-mono text-[13px] font-bold text-foreground">
              {lvl.count.toLocaleString('en-SG')}
            </span>
          </button>
        ))}
      </div>
      <InsightsDrill target="terminal-reason" pick={pick} />
    </Sheet>
  );
}

// ─── By source ──────────────────────────────────────────────────────────────

export function ReferralVolumeDrillDonut({
  rows,
  centerValue,
  centerLabel,
  ayCode,
}: {
  rows: ReferralConversionRow[];
  centerValue: string;
  centerLabel: string;
  ayCode: string;
}) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  const data = React.useMemo<DonutSlice[]>(
    () =>
      rows
        .filter((r) => r.applied > 0)
        .map((r) => ({ name: r.source, value: r.applied })),
    [rows]
  );
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <DonutChart
        data={data}
        centerValue={centerValue}
        centerLabel={centerLabel}
        onSegmentClick={(name: string) =>
          setPick({ ayCode, segment: referralSegmentForSlice(name, rows) })
        }
      />
      <InsightsDrill target="referral-all" pick={pick} />
    </Sheet>
  );
}

// ─── By category ────────────────────────────────────────────────────────────

export function CategoryMixDrillChart({
  series,
  data,
  selectedAy,
  compareAy,
}: {
  series: GroupedBarSeries[];
  data: GroupedBarChartProps['data'];
  selectedAy: string;
  compareAy: string | null;
}) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <GroupedBarChart
        series={series}
        data={data}
        yFormat="number"
        height={260}
        onSegmentClick={(category: string, s?: string) =>
          setPick({
            ayCode: resolveSeriesAy(s, { selectedAy, compareAy }),
            segment: category,
          })
        }
      />
      <InsightsDrill target="category" pick={pick} />
    </Sheet>
  );
}

// ─── Nationality ────────────────────────────────────────────────────────────

export function NationalityMixDrillPie({
  rows,
  compareRows,
  compareLabel,
  unitLabel,
  ayCode,
}: {
  rows: NationalityMixRow[];
  compareRows: NationalityMixRow[] | null;
  compareLabel: string | null;
  unitLabel: string;
  ayCode: string;
}) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <NationalityMixPie
        rows={rows}
        compareRows={compareRows}
        compareLabel={compareLabel}
        unitLabel={unitLabel}
        onSegmentClick={(nationality: string) =>
          setPick({ ayCode, segment: nationalitySegment(nationality) })
        }
      />
      <InsightsDrill target="nationality" pick={pick} />
    </Sheet>
  );
}

export function NationalityByLevelDrillBars({
  data,
  unitLabel,
  ayCode,
}: {
  data: NationalityByLevel;
  unitLabel: string;
  ayCode: string;
}) {
  const { pick, setPick, onOpenChange } = useDrillPick();
  return (
    <Sheet open={pick !== null} onOpenChange={onOpenChange}>
      <NationalityByLevelBars
        data={data}
        unitLabel={unitLabel}
        onSegmentClick={(level: string, nationality?: string) =>
          setPick({
            ayCode,
            segment: nationalitySegment(nationality ?? '', level),
          })
        }
      />
      <InsightsDrill target="nationality" pick={pick} />
    </Sheet>
  );
}
```

`GroupedBarChartProps` is exported from the shell (`components/dashboard/charts/grouped-bar-chart.tsx:24`). `ReasonBar` and the `insights-funnel` types are imported with `import type`, so the `'server-only'` modules they live in never reach the client bundle.

- [ ] **Step 4: Run it**

Run: `npx vitest run __tests__/admissions/insights-drill-cards.test.tsx --pool=threads`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0 (proves Phase 1's `onSegmentClick` props exist on `TrendChart`, `GroupedBarChart`, `NationalityMixPie`, `NationalityByLevelBars`).

- [ ] **Step 6: Commit**

```bash
git add components/admissions/drills/insights-drill-cards.tsx __tests__/admissions/insights-drill-cards.test.tsx && git commit -m "feat(admissions): insights chart wrappers open the drill for the part clicked

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.9: Wire the page

**Files:**

- Modify: `app/(admissions)/admissions/insights/page.tsx` — imports 21-100; `InsightChartCard` 117-159; delete `TopReasonRow` 161-190; `ratingChartData` 402-408; `reasonDonutData` 616-622; MetricCards 776-807; trend 838-843; rating chart 870-876; withdrawn donut 924-928; assessment chart 958-966; reasons donut 989-993; top-reason card 1004-1019; referral donut 1043-1047; category chart 1071-1076; nationality 1093-1098 and 1111-1114. Edit bottom-up so the line numbers above stay valid.

**Interfaces:**

- Consumes: Task 3.8 wrappers; `AdmissionsDrillSheet` with `scopeLabel` / `initialGroupBy`; `feedbackRatingBuckets` (Task 3.6); `INSIGHTS_SCOPE_LABEL` (Task 3.7).
- Produces: every block on `/admissions/insights` clickable; nothing else on the page changes.

- [ ] **Step 1: Swap the charts (bottom-up)**

Nationality × level (1111-1114) →

```tsx
<NationalityByLevelDrillBars
  data={nationalityByLevel}
  unitLabel="applicants"
  ayCode={selectedAy}
/>
```

Nationality mix (1093-1098) →

```tsx
<NationalityMixDrillPie
  rows={nationalityMix}
  compareRows={priorNationalityMix}
  compareLabel={compareAy}
  unitLabel="applicants"
  ayCode={selectedAy}
/>
```

Category (1071-1076) →

```tsx
<CategoryMixDrillChart
  series={categoryMixSeries}
  data={categoryMixData}
  selectedAy={selectedAy}
  compareAy={compareAy}
/>
```

Referral donut (1043-1047) →

```tsx
<ReferralVolumeDrillDonut
  rows={referralConversion}
  centerValue={totalReferralApplicants.toLocaleString('en-SG')}
  centerLabel="Applicants"
  ayCode={selectedAy}
/>
```

Top-reason card (1004-1019) →

```tsx
<InsightChartCard
  cap="Top reason per level"
  title="By level"
  icon={GraduationCap}
  headerAction={<TerminalReasonsSeeAll ayCode={selectedAy} />}
>
  <TopReasonPerLevelList ayCode={selectedAy} rows={terminalByLevelRows} />
</InsightChartCard>
```

Reasons donut (989-993) →

```tsx
<CancellationReasonsDrillDonut
  bars={reasonBars}
  centerValue={terminal.total.toLocaleString('en-SG')}
  centerLabel="Cancellations"
  ayCode={selectedAy}
/>
```

Assessment chart (958-966) →

```tsx
<AssessmentConversionDrillChart
  series={ASSESSMENT_SERIES.map((s) => ({
    key: s.key,
    label: s.label,
  }))}
  data={assessmentGroupedData}
  ayCode={selectedAy}
/>
```

Withdrawn donut (924-928) →

```tsx
<WithdrawnByLevelDrillDonut
  data={withdrawnDonutData}
  centerValue={totalWithdrawn.toLocaleString('en-SG')}
  centerLabel="Withdrawn"
  ayCode={selectedAy}
/>
```

Rating chart (870-876) →

```tsx
<FeedbackRatingDrillChart data={ratingChartData} ayCode={selectedAy} />
```

Trend (838-843) →

```tsx
<IntakeTrendDrillChart
  label="Applications"
  current={intakeCurrentPts}
  comparison={intakeComparePts}
  selectedAy={selectedAy}
  compareAy={compareAy}
/>
```

- [ ] **Step 2: The KPI cards (776-807)**

Add to each MetricCard:

Applications received —

```tsx
            drillSheet={() => (
              <AdmissionsDrillSheet
                target="funnel-stage"
                segment="Submitted"
                ayCode={selectedAy}
                scopeLabel={INSIGHTS_SCOPE_LABEL}
              />
            )}
```

Conversion rate — the same list, opened grouped by status so the enrolled share reads at a glance:

```tsx
            drillSheet={() => (
              <AdmissionsDrillSheet
                target="funnel-stage"
                segment="Submitted"
                ayCode={selectedAy}
                scopeLabel={INSIGHTS_SCOPE_LABEL}
                initialGroupBy="status"
              />
            )}
```

Avg. days to enrol —

```tsx
              drillSheet={() => (
                <AdmissionsDrillSheet
                  target="avg-time"
                  ayCode={selectedAy}
                  scopeLabel={INSIGHTS_SCOPE_LABEL}
                />
              )}
```

- [ ] **Step 3: Derivations**

Delete `reasonDonutData` and its comment (616-622) — the wrapper builds it from `reasonBars`. Replace `ratingChartData` (402-408) with:

```ts
const ratingChartData: ComparisonBarPoint[] = feedbackRatingBuckets(
  feedback.rows
).map((b) => ({ category: `${b.stars}★`, current: b.count }));
```

(Keep the comment block above it; replace its last paragraph "Buckets come from the scale itself…" with: "Buckets come from `feedbackRatingBuckets` (lib/admissions/feedback-drill.ts), the same rule each bar's drill filters with (KD #229).")

- [ ] **Step 4: The card shell and the moved row**

Delete `TopReasonRow` (161-190) — it now lives in `TopReasonPerLevelList`. In `InsightChartCard` add the prop `headerAction?: ReactNode;` (with the doc comment `/** A control beside the icon tile — the list blocks' ghost "See all". */`), destructure it, and replace its `<CardAction>` (150-154) with:

```tsx
<CardAction>
  <div className="flex items-center gap-2">
    {headerAction}
    <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
      <Icon className="size-4" />
    </div>
  </div>
</CardAction>
```

- [ ] **Step 5: Imports**

Replace the chart imports (lines 28-43) with type-only imports:

```ts
import type { TrendPoint } from '@/components/dashboard/charts/trend-chart';
import type { ComparisonBarPoint } from '@/components/dashboard/charts/comparison-bar-chart';
import type { GroupedBarSeries } from '@/components/dashboard/charts/grouped-bar-chart';
import type { DonutSlice } from '@/components/dashboard/charts/donut-chart';
```

Delete the `NationalityByLevelBars` and `NationalityMixPie` imports (69-70) and `FEEDBACK_RATING_MAX`, `FEEDBACK_RATING_MIN` from the feedback import (72-73). Add:

```ts
import { AdmissionsDrillSheet } from '@/components/admissions/drills/admissions-drill-sheet';
import {
  AssessmentConversionDrillChart,
  CancellationReasonsDrillDonut,
  CategoryMixDrillChart,
  FeedbackRatingDrillChart,
  IntakeTrendDrillChart,
  NationalityByLevelDrillBars,
  NationalityMixDrillPie,
  ReferralVolumeDrillDonut,
  TerminalReasonsSeeAll,
  TopReasonPerLevelList,
  WithdrawnByLevelDrillDonut,
} from '@/components/admissions/drills/insights-drill-cards';
import { feedbackRatingBuckets } from '@/lib/admissions/feedback-drill';
import { INSIGHTS_SCOPE_LABEL } from '@/lib/admissions/insights-drill-segments';
```

- [ ] **Step 6: Type-check and lint the page**

Run: `npx tsc --noEmit` then `npx eslint "app/(admissions)/admissions/insights/page.tsx" components/admissions/drills/insights-drill-cards.tsx`
Expected: both exit 0 (no unused imports left behind).

- [ ] **Step 7: Commit**

```bash
git add "app/(admissions)/admissions/insights/page.tsx" && git commit -m "feat(admissions): every number and chart on Admissions Insights opens its list

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.10: Phase gate

**Files:** none changed — verification only. Fix forward in the task that owns a failure, then re-run this gate.

- [ ] **Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 2: Module tests (Records included — it shares `computeNationalityByLevel`)**

Run: `npx vitest run __tests__/admissions __tests__/sis --pool=threads`
Expected: PASS. Re-run any failure on its own before calling it a regression (forks/threads flakiness on this machine).

- [ ] **Step 3: Column-label guard (KD #161)**

Run: `npx vitest run __tests__/ui/data-table-column-label-coverage.test.ts --pool=threads`
Expected: PASS.

- [ ] **Step 4: Open the page and click every block**

Restart `npm run dev` (new route files do not reliably reach a running dev server), sign in as an `admissions` or `superadmin` user, open `/admissions/insights?ay=AY2026&compareAy=AY2025`, and watch the dev terminal for "Functions cannot be passed to Client Components" or route-conflict warnings (Review Focus #5). Then, for each block, the sheet's count must equal the figure clicked:

1. **Applications received** → "Applications received"; count = the card.
2. **Conversion rate** → same count, grouped by status; the Enrolled + Conditional groups = the "N of M applicants enrolled" caption's N.
3. **Avg. days to enrol** (if shown) → count = the card's `n=`.
4. **Applications per month** → click an AY2026 point, then the dashed AY2025 point for the same month: each sheet shows its own year's count (Review Focus #1). A future month of the current year opens nothing.
5. **Application experience** → click the 5★ bar: count = bar height; names link to the application (or to Records if enrolled).
6. **Withdrawals by level** → click the largest slice: count = its legend figure.
7. **Entrance assessment** → click Math · Not assessed: the list includes Cancelled / Withdrawn applicants.
8. **Cancellation reasons** → click "Other reasons" (if drawn): count = its slice (Review Focus #3).
9. **Top reason per level** → click a row: count = the row's figure; **See all** (ghost, card header): count = the donut's centre.
10. **By source** → click "Other" (if drawn) and one named source.
11. **By category** → click a muted AY2025 bar: the sheet title reads that category and its rows are AY2025's.
12. **Nationality** → click "Other" on the pie; click a Youngstarters segment on the level bars (label with `|`, Review Focus #4).

Also open `/admissions` (the dashboard) and click one KPI and one chart segment: behaviour unchanged (Global Constraint — dashboard drills keep their behaviour).

- [ ] **Step 5: Request the phase review**

Hand the reviewer this phase file, the probe output from Task 3.4 Step 6, and `git log --oneline` for this phase's commits. Phase 3 is done when the reviewer approves.
