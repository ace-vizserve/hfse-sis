# Phase 4 — Records Insights

> Part of `docs/superpowers/plans/2026-09-29-insights-drill-sheets.md`. Its Global Constraints and Review Focus bind every task here. Spec §2 and §3 "Records". Depends on Phase 1 only (`SegmentClickHandler` on `ComposedBarLineChart`, `GroupedBarChart`, `RetentionStackedBarChart`, `AttritionStackedBarChart`, `NationalityMixPie`, `NationalityByLevelBars`; `DonutChart` and `ComparisonBarChart` already have it).

**Goal:** Every KPI and chart on `/records/insights` opens the rows behind it, and the row count equals the number on screen.

## What was measured before writing this phase (read these before starting)

1. **Three different populations sit on this page.** They are not interchangeable:
   - **On-roll rows**: `section_students` rows in the year whose `enrollment_status <> 'withdrawn'` (graduated rows included), inner-joined to `sections` + `levels`. Used by `getInsightsHeadcount` (Enrolled, Distribution), `getEnrolledCategoryMix`, `getEnrolledNationalityMix` and `getEnrolledNationalityByLevel`. It counts **rows**, so a student with two live rows counts twice. None of the existing targets match it: `active-enrolled` keeps only `active`/`late_enrollee` and drops soft-closed admissions rows; `students-by-level` dedupes per enrolee and keys on the admissions `classLevel`.
   - **The retention cohort**: the comparison year's on-roll students, **one per `student_number`**, minus the terminal level (S4), each marked returned when the number is on roll in the selected year (`loadRecordsRetention`). The by-level chart uses the same cohort; the page drops S4 before drawing it.
   - **Movement events**: `getMovementEvents(ay)` reads **`audit_log`** (`enrolment.metadata.update` with a withdrawn `after`, `lateEnrolleeTransition`, `reEnrolment`). Late enrollees, every withdrawal block and the "Who moves in and out" bars count **events**, not class rows.
2. **Both existing movement targets differ from the movement bars.** `enrollments-range` = enrolled roster rows by admissions `created_at`; the bars = late-enrolled + re-enrolled audit events by event date. `withdrawals-range` = withdrawn class rows, deduped per student, by `withdrawal_date`; the bars = withdrawn audit events (one per event). So a new `movement-month` target is added; the dashboard targets are untouched.
3. **`lib/sis/drill.ts` is imported by client components** (`records-drill-sheet.tsx`). `lib/sis/records-insights.ts`, `lib/sis/movements.ts` and `lib/admissions/insights-funnel.ts` all `import 'server-only'`. So:
   - every predicate `applyTargetFilter` needs moves to a new **client-safe** `lib/sis/insights-shared.ts` (the loaders import it back);
   - the row builders for the new targets live in a new **server-only** `lib/sis/insights-drill-rows.ts`, which the route calls.
4. **Where the four new row fields come from.**
   - `withdrawalReason`: the movement event's `reasonLabel` (from `audit_log.context.withdrawalReason`, falling back to `context.reason`, labelled via `WITHDRAWAL_REASON_LABELS`), `'Unspecified'` when blank — exactly what `rollupMovements` counts. **Not** `section_students.withdrawal_reason`, which can be edited after the event and would break count = rows.
   - `controllable`: `WITHDRAWAL_CONTROLLABILITY[event.reason]`, `'unspecified'` for a blank or unknown reason.
   - `category`: `ay{YYYY}_enrolment_applications.category` joined on the **raw** `section_students.enrolee_number` (no student-number fallback — the loader has none), bucketed to one of `ENROLEE_CATEGORIES` or `'Unspecified'`.
   - `nationality`: `ay{YYYY}_enrolment_applications.nationality` on the same raw join, canonicalised by `canonicaliseNationality`.
     The rows also need `returned`, `joinedTerm`, `movementKind`, `movementDate`, `nationalityMixBucket` and `nationalityLevelBucket` — the segment filters read them. All new fields are optional, so no existing row builder or test fixture changes.
5. **Level code vs label (Review Focus #4).** The Distribution and Retention charts plot `levelShortCode(label)` (`'P1'`; a level outside `LEVEL_LABELS`, e.g. `'Youngstarters'`, stays its label). Late/withdrawal/nationality-by-level charts plot the label. The filter matches a segment against a row's label **or** its short code through one helper, `levelMatchesSegment`, and `levelShortCode` moves out of the page into `insights-shared.ts` so the chart and the filter use the same function.
6. **"Other" (Review Focus #3).** The nationality pie folds everything past the top 8 into `'Other'`; the by-level bars fold past a global top 6. Each drill row carries both buckets, computed by running the loader's own `computeEnrolledNationalityMix` / `computeNationalityByLevel` over the same inputs, so `'Other'` opens exactly the rows it counts.

## Segment format

Every new target takes a keyed segment, built and read by one pair of functions in `insights-shared.ts`: `key:value` parts joined by `|`, e.g. `level:P1|outcome:didNotReturn`. Keys: `level`, `term`, `flow`, `month`, `reason`, `outcome`, `category`, `nationality`. A value keeps everything after the first `:`. A segment that does not parse opens an empty list, never the whole population.

| Target               | Population (the loader's predicate)                                                            | Segments                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `enrolled-headcount` | on-roll rows                                                                                   | none · `level:<code or label>`                                                                                     |
| `category`           | on-roll rows                                                                                   | none · `category:<New/Current/VizSchool New/VizSchool Current/Unspecified>`                                        |
| `nationality`        | on-roll rows                                                                                   | none · `nationality:<name/Other/Unspecified>` (pie) · `level:<label>\|nationality:<name/Other/Unspecified>` (bars) |
| `retention`          | comparison-year cohort, S4 excluded; needs `compareAy`                                         | none · `level:<code>\|outcome:returned` · `level:<code>\|outcome:didNotReturn`                                     |
| `late-enrollees`     | late-enrolled events                                                                           | none · `level:<label>` · `term:<n>`                                                                                |
| `withdrawals`        | withdrawn events                                                                               | none · `reason:<label>` · `level:<label>` · `level:<label>\|reason:<label>`                                        |
| `movement-month`     | late-enrolled + re-enrolled events (`flow:enrollments`), withdrawn events (`flow:withdrawals`) | `flow:<enrollments/withdrawals>\|month:<Jan…Nov>`                                                                  |

---

### Task 4.1: Client-safe shared helpers

**Files:**

- Create: `lib/sis/insights-shared.ts`
- Modify: `lib/sis/records-insights.ts` (lines 5–25 imports; 59–97 controllability; 128; 169–214 rollup loop; 289–316 terminal level; 657–680 category mix; 929–942 month labels; 963–988 `netMovementByMonth`; 1011–1032 `monthlyMovementSeries`)
- Modify: `app/(records)/records/insights/page.tsx` (lines 115–127)
- Test: `__tests__/sis/insights-shared.test.ts`

**Interfaces:**

- Consumes: `LEVEL_LABELS` (`lib/sis/levels.ts`), `ENROLEE_CATEGORIES` (`lib/schemas/sis.ts`), `WITHDRAWAL_REASON_VALUES` / `WithdrawalReason` (`lib/schemas/enrolment.ts`) — all client-safe.
- Produces (all from `lib/sis/insights-shared.ts`):
  - `MONTH_LABELS` (moved), `INSIGHTS_MOVEMENT_MONTHS: readonly string[]` (Jan–Nov)
  - `TERMINAL_LEVEL_CODES`, `isTerminalLevel(levelValue: string): boolean` (moved)
  - `WITHDRAWAL_CONTROLLABILITY`, `type WithdrawalControllability` (moved), `type ControllabilityBucket = WithdrawalControllability | 'unspecified'`, `controllabilityOf(rawReason: string | null | undefined): ControllabilityBucket`
  - `UNSPECIFIED_REASON`, `withdrawalReasonLabelOf(e: { reasonLabel?: string | null }): string`
  - `movementLevelOf(e: { level?: string | null }): string`, `isMidYearJoinKind(kind: string): boolean`, `movementMonthIndex(date: string | null | undefined): number`
  - `levelShortCode(label: string): string`, `levelMatchesSegment(levelLabel: string | null | undefined, segment: string): boolean`, `levelLabelOf(levels: LevelEmbed | LevelEmbed[] | null | undefined): string`
  - `isOnRoll(enrollmentStatus: string | null | undefined): boolean`
  - `UNSPECIFIED_CATEGORY`, `enrolledCategoryBucket(enroleeNumber: string | null | undefined, categoryByEnroleeNumber: Map<string, string>): string`
  - `type InsightsSegment`, `encodeInsightsSegment(parts: InsightsSegment): string | null`, `parseInsightsSegment(segment: string | null | undefined): InsightsSegment | null`
  - `pickSeriesAy(series: string | undefined, compareSeriesKey: string, selectedAy: string, compareAy: string | null): string`, `termSegmentFromLabel(label: string): string | null`
- `lib/sis/records-insights.ts` re-exports `MONTH_LABELS`, `TERMINAL_LEVEL_CODES`, `isTerminalLevel`, `WITHDRAWAL_CONTROLLABILITY`, `type WithdrawalControllability` so every current importer keeps working.

- [ ] **Step 1: Write the failing test** — `__tests__/sis/insights-shared.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  controllabilityOf,
  encodeInsightsSegment,
  enrolledCategoryBucket,
  INSIGHTS_MOVEMENT_MONTHS,
  isMidYearJoinKind,
  isOnRoll,
  levelLabelOf,
  levelMatchesSegment,
  levelShortCode,
  movementLevelOf,
  movementMonthIndex,
  parseInsightsSegment,
  pickSeriesAy,
  termSegmentFromLabel,
  withdrawalReasonLabelOf,
} from '@/lib/sis/insights-shared';
import {
  isTerminalLevel as reExportedIsTerminal,
  MONTH_LABELS as reExportedMonths,
  WITHDRAWAL_CONTROLLABILITY as reExportedControllability,
} from '@/lib/sis/records-insights';
import {
  isTerminalLevel,
  MONTH_LABELS,
  WITHDRAWAL_CONTROLLABILITY,
} from '@/lib/sis/insights-shared';

describe('records-insights keeps re-exporting the moved constants', () => {
  it('is the same object, not a copy', () => {
    expect(reExportedMonths).toBe(MONTH_LABELS);
    expect(reExportedControllability).toBe(WITHDRAWAL_CONTROLLABILITY);
    expect(reExportedIsTerminal).toBe(isTerminalLevel);
  });
});

describe('level helpers', () => {
  it('short-codes a catalog label and leaves anything else as it is', () => {
    expect(levelShortCode('Primary One')).toBe('P1');
    expect(levelShortCode('Youngstarters')).toBe('Youngstarters');
    expect(levelShortCode('Unknown')).toBe('Unknown');
  });

  it('matches a segment by label or by code', () => {
    expect(levelMatchesSegment('Primary One', 'P1')).toBe(true);
    expect(levelMatchesSegment('Primary One', 'Primary One')).toBe(true);
    expect(levelMatchesSegment('Primary Two', 'P1')).toBe(false);
    expect(levelMatchesSegment('Youngstarters', 'Youngstarters')).toBe(true);
    expect(levelMatchesSegment(null, 'Unknown')).toBe(true);
  });

  it('reads a level embed the way the loaders do', () => {
    expect(levelLabelOf({ label: ' Primary One ', code: 'P1' })).toBe(
      'Primary One'
    );
    expect(levelLabelOf([{ label: null, code: 'P2' }])).toBe('P2');
    expect(levelLabelOf(null)).toBe('Unknown');
  });

  it('treats every status but withdrawn as on roll', () => {
    expect(isOnRoll('active')).toBe(true);
    expect(isOnRoll('late_enrollee')).toBe(true);
    expect(isOnRoll('graduated')).toBe(true);
    expect(isOnRoll('withdrawn')).toBe(false);
  });
});

describe('movement helpers', () => {
  it('buckets a blank level as Unknown and a blank reason as Unspecified', () => {
    expect(movementLevelOf({ level: '  ' })).toBe('Unknown');
    expect(movementLevelOf({ level: 'Primary One' })).toBe('Primary One');
    expect(withdrawalReasonLabelOf({ reasonLabel: null })).toBe('Unspecified');
    expect(withdrawalReasonLabelOf({ reasonLabel: 'Health / medical' })).toBe(
      'Health / medical'
    );
  });

  it('classifies a raw reason, and anything unknown as unspecified', () => {
    expect(controllabilityOf('financial')).toBe('controllable');
    expect(controllabilityOf(' family_relocation ')).toBe('structural');
    expect(controllabilityOf(null)).toBe('unspecified');
    expect(controllabilityOf('made_up')).toBe('unspecified');
  });

  it('counts late and re-enrolled as mid-year joins, nothing else', () => {
    expect(isMidYearJoinKind('late-enrolled')).toBe(true);
    expect(isMidYearJoinKind('re-enrolled')).toBe(true);
    expect(isMidYearJoinKind('withdrawn')).toBe(false);
    expect(isMidYearJoinKind('section-transfer')).toBe(false);
  });

  it('reads the month of an ISO date, -1 when it cannot', () => {
    expect(movementMonthIndex('2026-03-10')).toBe(2);
    expect(movementMonthIndex('2026-12-01')).toBe(11);
    expect(movementMonthIndex('')).toBe(-1);
    expect(movementMonthIndex(null)).toBe(-1);
    expect(INSIGHTS_MOVEMENT_MONTHS).toHaveLength(11);
    expect(INSIGHTS_MOVEMENT_MONTHS[10]).toBe('Nov');
  });
});

describe('enrolledCategoryBucket', () => {
  const map = new Map([
    ['E1', 'New'],
    ['E2', ' Current '],
    ['E3', 'Bogus'],
  ]);
  it('keeps a real category and buckets the rest as Unspecified', () => {
    expect(enrolledCategoryBucket('E1', map)).toBe('New');
    expect(enrolledCategoryBucket(' E2 ', map)).toBe('Current');
    expect(enrolledCategoryBucket('E3', map)).toBe('Unspecified');
    expect(enrolledCategoryBucket('E9', map)).toBe('Unspecified');
    expect(enrolledCategoryBucket(null, map)).toBe('Unspecified');
  });
});

describe('insights segments', () => {
  it('round-trips in a fixed key order', () => {
    const s = encodeInsightsSegment({ outcome: 'returned', level: 'P1' });
    expect(s).toBe('level:P1|outcome:returned');
    expect(parseInsightsSegment(s)).toEqual({
      level: 'P1',
      outcome: 'returned',
    });
  });

  it('keeps a value that itself holds a colon', () => {
    expect(parseInsightsSegment('nationality:Korea: South')).toEqual({
      nationality: 'Korea: South',
    });
  });

  it('is null for nothing, and null (not "everything") for garbage', () => {
    expect(encodeInsightsSegment({})).toBeNull();
    expect(parseInsightsSegment(null)).toEqual({});
    expect(parseInsightsSegment('P1')).toBeNull();
    expect(parseInsightsSegment('colour:red')).toBeNull();
  });
});

describe('wrapper helpers', () => {
  it('sends the comparison series to the comparison year', () => {
    expect(pickSeriesAy('line', 'line', 'AY2026', 'AY2025')).toBe('AY2025');
    expect(pickSeriesAy('bar', 'line', 'AY2026', 'AY2025')).toBe('AY2026');
    expect(pickSeriesAy(undefined, 'line', 'AY2026', 'AY2025')).toBe('AY2026');
    expect(pickSeriesAy('compare', 'compare', 'AY2026', null)).toBe('AY2026');
  });

  it('reads the term number off the late-by-term bar label', () => {
    expect(termSegmentFromLabel('Term 2')).toBe('term:2');
    expect(termSegmentFromLabel('Whenever')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run __tests__/sis/insights-shared.test.ts --pool=threads`. Expected: FAIL, `Failed to resolve import "@/lib/sis/insights-shared"`.

- [ ] **Step 3: Create `lib/sis/insights-shared.ts`:**

```ts
// Records Insights — pure helpers shared by the Insights loaders
// (lib/sis/records-insights.ts, server-only) and the drill filter
// (lib/sis/drill.ts, imported by client components). One function per rule so
// the number on the page and the list behind it can never count differently
// (KD #82/#124).
//
// ⚠ CLIENT-SAFE. No `server-only`, no database client, no import from a
// server-only module — `lib/sis/drill.ts` imports this file and is itself
// imported by 'use client' components.

import {
  WITHDRAWAL_REASON_VALUES,
  type WithdrawalReason,
} from '@/lib/schemas/enrolment';
import { ENROLEE_CATEGORIES } from '@/lib/schemas/sis';
import { LEVEL_LABELS } from '@/lib/sis/levels';

// ── Months ──────────────────────────────────────────────────────────────────

export const MONTH_LABELS = [
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
  'Dec',
] as const;

/** HFSE's AY runs January–November (KD #13) — the movement chart's axis. */
export const INSIGHTS_MOVEMENT_MONTHS: readonly string[] = MONTH_LABELS.slice(
  0,
  11
);

/** 0-based month of an ISO `yyyy-mm-dd`, or -1 when it cannot be read. */
export function movementMonthIndex(date: string | null | undefined): number {
  const n = Number((date ?? '').slice(5, 7)) - 1;
  return Number.isInteger(n) && n >= 0 && n <= 11 ? n : -1;
}

// ── Levels ──────────────────────────────────────────────────────────────────

/**
 * Terminal grade codes. A prior-year student in one of these levels GRADUATED
 * — their absence the next year is completion, not attrition — so they are
 * excluded from retention entirely (the overall rate, the by-level chart, and
 * the retention drill).
 */
export const TERMINAL_LEVEL_CODES: ReadonlySet<string> = new Set(['S4']);

const TERMINAL_LEVEL_LABELS: ReadonlySet<string> = new Set(
  [...TERMINAL_LEVEL_CODES].map(
    (code) => LEVEL_LABELS[code as keyof typeof LEVEL_LABELS]
  )
);

/** True for a terminal grade, given its label ("Secondary Four") or code ("S4"). */
export function isTerminalLevel(levelValue: string): boolean {
  const v = levelValue.trim();
  return TERMINAL_LEVEL_CODES.has(v) || TERMINAL_LEVEL_LABELS.has(v);
}

const LABEL_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(LEVEL_LABELS).map(([code, label]) => [label, code])
);

/**
 * Level label → short code ("Primary One" → "P1") for the compact Insights
 * axes. A label outside the fixed catalog (e.g. "Youngstarters") is returned
 * as it is — so a chart axis and a drill segment built from it still agree.
 */
export function levelShortCode(label: string): string {
  return LABEL_TO_CODE[label] ?? label;
}

/**
 * Does a row's level label answer a clicked segment? Charts plot the short
 * code (Distribution, Retention) or the label (late, withdrawals, nationality
 * by level); both resolve here, through the same `levelShortCode` the charts
 * use.
 */
export function levelMatchesSegment(
  levelLabel: string | null | undefined,
  segment: string
): boolean {
  const label = (levelLabel ?? '').trim() || 'Unknown';
  return label === segment || levelShortCode(label) === segment;
}

export type LevelEmbed = { label?: string | null; code?: string | null };

/** The loaders' level rule: the label, else the code, else 'Unknown'. */
export function levelLabelOf(
  levels: LevelEmbed | LevelEmbed[] | null | undefined
): string {
  const lvl = Array.isArray(levels) ? levels[0] : levels;
  return lvl?.label?.trim() || lvl?.code?.trim() || 'Unknown';
}

/** On roll = any class row that is not withdrawn (graduated included). */
export function isOnRoll(enrollmentStatus: string | null | undefined): boolean {
  return enrollmentStatus !== 'withdrawn';
}

// ── Enrolee category ────────────────────────────────────────────────────────

export const UNSPECIFIED_CATEGORY = 'Unspecified';

/**
 * The enrolled category mix's bucket for one class row: the admissions
 * category for its enrolee number when it is one of ENROLEE_CATEGORIES,
 * otherwise 'Unspecified' — never dropped.
 */
export function enrolledCategoryBucket(
  enroleeNumber: string | null | undefined,
  categoryByEnroleeNumber: Map<string, string>
): string {
  const en = enroleeNumber?.trim();
  const cat = (en ? categoryByEnroleeNumber.get(en) : undefined)?.trim();
  return cat && (ENROLEE_CATEGORIES as readonly string[]).includes(cat)
    ? cat
    : UNSPECIFIED_CATEGORY;
}

// ── Movement events ─────────────────────────────────────────────────────────

export type WithdrawalControllability = 'controllable' | 'structural';
export type ControllabilityBucket = WithdrawalControllability | 'unspecified';

/**
 * controllable = the school can realistically act on it; structural = largely
 * external. 'other' is structural so the preventable share is never inflated
 * by unknowns.
 */
export const WITHDRAWAL_CONTROLLABILITY: Record<
  WithdrawalReason,
  WithdrawalControllability
> = {
  financial: 'controllable',
  disciplinary: 'controllable',
  academic_fit: 'controllable',
  transferred_other_school: 'structural',
  family_relocation: 'structural',
  health: 'structural',
  other: 'structural',
} satisfies Record<WithdrawalReason, WithdrawalControllability>;

/** The raw reason's class; blank or unrecognised → 'unspecified'. */
export function controllabilityOf(
  rawReason: string | null | undefined
): ControllabilityBucket {
  const raw = (rawReason ?? '').trim();
  if (raw && (WITHDRAWAL_REASON_VALUES as readonly string[]).includes(raw)) {
    return WITHDRAWAL_CONTROLLABILITY[raw as WithdrawalReason];
  }
  return 'unspecified';
}

export const UNSPECIFIED_REASON = 'Unspecified';

export function withdrawalReasonLabelOf(e: {
  reasonLabel?: string | null;
}): string {
  return (e.reasonLabel ?? '').trim() || UNSPECIFIED_REASON;
}

export function movementLevelOf(e: { level?: string | null }): string {
  return (e.level ?? '').trim() || 'Unknown';
}

/** Mid-year joins: late enrollees and re-enrolments. Transfers move nobody. */
export function isMidYearJoinKind(kind: string): boolean {
  return kind === 'late-enrolled' || kind === 're-enrolled';
}

// ── Drill segments ──────────────────────────────────────────────────────────

export type InsightsSegmentKey =
  | 'level'
  | 'term'
  | 'flow'
  | 'month'
  | 'reason'
  | 'outcome'
  | 'category'
  | 'nationality';
export type InsightsSegment = Partial<Record<InsightsSegmentKey, string>>;

const SEGMENT_KEY_ORDER: readonly InsightsSegmentKey[] = [
  'level',
  'term',
  'flow',
  'month',
  'reason',
  'outcome',
  'category',
  'nationality',
];

/** `{ level: 'P1', outcome: 'returned' }` → `'level:P1|outcome:returned'`. */
export function encodeInsightsSegment(parts: InsightsSegment): string | null {
  const bits = SEGMENT_KEY_ORDER.filter(
    (k) => parts[k] !== undefined && parts[k] !== ''
  ).map((k) => `${k}:${parts[k]}`);
  return bits.length > 0 ? bits.join('|') : null;
}

/**
 * The reverse. `{}` for no segment (the whole population); `null` when the
 * segment is present but unreadable — the filter then opens an empty list
 * rather than silently showing everyone.
 */
export function parseInsightsSegment(
  segment: string | null | undefined
): InsightsSegment | null {
  if (!segment) return {};
  const out: InsightsSegment = {};
  for (const part of segment.split('|')) {
    const i = part.indexOf(':');
    if (i <= 0) return null;
    const key = part.slice(0, i) as InsightsSegmentKey;
    if (!SEGMENT_KEY_ORDER.includes(key)) return null;
    out[key] = part.slice(i + 1);
  }
  return out;
}

// ── Chart wrapper helpers ───────────────────────────────────────────────────

/** A click on the comparison series opens the comparison year (Review Focus #1). */
export function pickSeriesAy(
  series: string | undefined,
  compareSeriesKey: string,
  selectedAy: string,
  compareAy: string | null
): string {
  return series === compareSeriesKey && compareAy ? compareAy : selectedAy;
}

/** 'Term 2' (the late-by-term bar's category) → 'term:2'. */
export function termSegmentFromLabel(label: string): string | null {
  const m = /(\d+)\s*$/.exec(label);
  return m ? encodeInsightsSegment({ term: m[1] }) : null;
}
```

- [ ] **Step 4: Point `lib/sis/records-insights.ts` at it.**

  a. Imports (lines 15–22). Replace

  ```ts
  import {
    WITHDRAWAL_REASON_LABELS,
    WITHDRAWAL_REASON_VALUES,
    type WithdrawalReason,
  } from '@/lib/schemas/enrolment';
  import { ENROLEE_CATEGORIES } from '@/lib/schemas/sis';
  import { getLevelDistribution, type LevelCount } from '@/lib/sis/dashboard';
  import { compareLevelLabels, LEVEL_LABELS } from '@/lib/sis/levels';
  ```

  with

  ```ts
  import { ENROLEE_CATEGORIES } from '@/lib/schemas/sis';
  import { getLevelDistribution, type LevelCount } from '@/lib/sis/dashboard';
  import {
    controllabilityOf,
    enrolledCategoryBucket,
    isMidYearJoinKind,
    isTerminalLevel,
    MONTH_LABELS,
    movementLevelOf,
    movementMonthIndex,
    UNSPECIFIED_CATEGORY,
    withdrawalReasonLabelOf,
  } from '@/lib/sis/insights-shared';

  export {
    isTerminalLevel,
    MONTH_LABELS,
    TERMINAL_LEVEL_CODES,
    WITHDRAWAL_CONTROLLABILITY,
    type WithdrawalControllability,
  } from '@/lib/sis/insights-shared';
  ```

  (`WITHDRAWAL_REASON_LABELS`, `WITHDRAWAL_REASON_VALUES`, `WithdrawalReason`, `compareLevelLabels` and `LEVEL_LABELS` are no longer used in this file once the steps below land.)

  b. Delete lines 59–97 (the `WithdrawalControllability` type, the `WITHDRAWAL_CONTROLLABILITY` map and its `_exhaustive` guard) — they now live in `insights-shared.ts`. Delete line 128 (`const UNSPECIFIED = 'Unspecified';`).

  c. Replace the rollup loop body, lines 169–204 (from `for (const e of events) {` through the closing `}` of the `if (e.kind === 'withdrawn')` block), with:

  ```ts
    for (const e of events) {
      const level = movementLevelOf(e);
      if (e.kind === 'withdrawn') {
        counts.withdrawn += 1;
        const reasonLabel = withdrawalReasonLabelOf(e);

        bump(wReason, reasonLabel);
        bump(wLevel, level);

        // Reason×level matrix
        if (!wReasonByLevel.has(level)) wReasonByLevel.set(level, new Map());
        bump(wReasonByLevel.get(level)!, reasonLabel);

        // Controllability — the same classifier the withdrawals drill reads.
        const bucket = controllabilityOf(e.reason);
        if (bucket === 'controllable') {
          controllableCount += 1;
          bump(controllableByLabel, reasonLabel);
          bump(controllableByLabelAndLevel, `${reasonLabel}::${level}`);
        } else if (bucket === 'structural') {
          structuralCount += 1;
        } else {
          unspecifiedCount += 1;
        }
  ```

  The `} else if (e.kind === 'late-enrolled') {` branch that follows is unchanged.

  d. Delete lines 289–316 (the `TERMINAL_LEVEL_CODES` doc + constant, `TERMINAL_LEVEL_LABELS`, and `isTerminalLevel`) — moved.

  e. In `computeEnrolledCategoryMix` (lines 657–680) replace the loop

  ```ts
  for (const r of enrolledRows) {
    const en = r.enroleeNumber?.trim();
    const cat = (en ? categoryByEnroleeNumber.get(en) : undefined)?.trim();
    if (cat && counts.has(cat)) {
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    } else {
      unspecified += 1;
    }
  }
  ```

  with

  ```ts
  for (const r of enrolledRows) {
    const bucket = enrolledCategoryBucket(
      r.enroleeNumber,
      categoryByEnroleeNumber
    );
    if (bucket === UNSPECIFIED_CATEGORY) unspecified += 1;
    else counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  ```

  and change the pushed row to `out.push({ category: UNSPECIFIED_CATEGORY, count: unspecified });`.

  f. Delete lines 929–942 (the local `MONTH_LABELS`) — now imported and re-exported.

  g. In `netMovementByMonth` replace

  ```ts
      const monthIdx = Number(e.date.slice(5, 7)) - 1; // 0-based
      if (monthIdx < 0 || monthIdx > 11) continue;
      if (e.kind === 'late-enrolled' || e.kind === 're-enrolled') {
  ```

  with

  ```ts
      const monthIdx = movementMonthIndex(e.date);
      if (monthIdx < 0) continue;
      if (isMidYearJoinKind(e.kind)) {
  ```

  h. In `monthlyMovementSeries` replace

  ```ts
      const monthIdx = Number(e.date.slice(5, 7)) - 1; // 0-based
      if (monthIdx < 0 || monthIdx >= months.length) continue;
      if (e.kind === 'late-enrolled' || e.kind === 're-enrolled') {
  ```

  with

  ```ts
      const monthIdx = movementMonthIndex(e.date);
      if (monthIdx < 0 || monthIdx >= months.length) continue;
      if (isMidYearJoinKind(e.kind)) {
  ```

- [ ] **Step 5: The page uses the shared short-code.** In `app/(records)/records/insights/page.tsx` delete lines 119–127 (the `LABEL_TO_CODE` comment, constant and local `levelShortCode`), replace line 117 `const AY_MONTHS: string[] = MONTH_LABELS.slice(0, 11);` with `const AY_MONTHS: readonly string[] = INSIGHTS_MOVEMENT_MONTHS;`, and add

  ```ts
  import {
    INSIGHTS_MOVEMENT_MONTHS,
    levelShortCode,
  } from '@/lib/sis/insights-shared';
  ```

  Remove `LEVEL_LABELS` from the `@/lib/sis/levels` import (line 75) and `MONTH_LABELS` from the `@/lib/sis/records-insights` import (line 86) — both are now unused on the page.

- [ ] **Step 6: Run** — `npx vitest run __tests__/sis/insights-shared.test.ts __tests__/sis/records-insights.test.ts __tests__/sis/records-insights-export.test.ts --pool=threads`. Expected: PASS (the existing Insights tests stay green — the rollup, month series and category mix count exactly as before).

- [ ] **Step 7: Commit** — `git add lib/sis/insights-shared.ts lib/sis/records-insights.ts "app/(records)/records/insights/page.tsx" __tests__/sis/insights-shared.test.ts && git commit -m "refactor(records): insights predicates move to a client-safe shared file"`

---

### Task 4.2: Loader predicates become shared, pure functions

**Files:**

- Modify: `lib/sis/records-insights.ts` (lines 318–403 `loadEnrolledStudentData` + wrapper; 430–510 retention loaders; 573–628 `getInsightsHeadcount`; 682–724, 772–814, 846–904 the three mix loaders)
- Test: `__tests__/sis/records-insights-loaders.test.ts`

**Interfaces:**

- Consumes: `levelLabelOf`, `isTerminalLevel` (Task 4.1).
- Produces (exported from `lib/sis/records-insights.ts`):
  - `ON_ROLL_LEVEL_SELECT: string` = `'section:sections!inner(academic_year_id, levels!inner(label, code))'`
  - `type ServiceClient = ReturnType<typeof createServiceClient>`
  - `resolveAyId(service: ServiceClient, ayCode: string): Promise<string | null>`
  - `fetchOnRollRows<T>(service: ServiceClient, ayId: string, select: string): Promise<T[]>` — **the on-roll predicate** (year's sections, `enrollment_status <> 'withdrawn'`); `select` must embed `section:sections!inner(academic_year_id …)`
  - `type OnRollSectionEmbed`, `type OnRollRow`, `sectionOf(r: OnRollRow): OnRollSectionEmbed | null`
  - `headcountFromRows(rows: OnRollRow[]): RecordsHeadcount`
  - `type EnrolRow`, `type EnrolledStudentData`, `enrolledStudentDataFrom(rows: EnrolRow[]): EnrolledStudentData`, `loadEnrolledStudentData(ayCode: string): Promise<EnrolledStudentData>` (now exported)
  - `type RetentionCohortMember = { studentNumber: string; level: string | null; returned: boolean }`
  - `retentionCohortFrom(prior: EnrolledStudentData, currentNumbers: ReadonlySet<string>, opts?: { includeTerminal?: boolean }): RetentionCohortMember[]`
  - `retentionFromCohort(priorAy: string, cohort: RetentionCohortMember[]): Retention`
  - `retentionByLevelFromCohort(cohort: RetentionCohortMember[]): LevelRetentionRow[]`
  - `valueByEnroleeNumber(appRows: EnroleeValueRow[], key: 'category' | 'nationality'): Map<string, string>`, `fetchEnroleeValueMap(service: ServiceClient, ayCode: string, key: 'category' | 'nationality'): Promise<Map<string, string>>`
  - `nationalityByLevelInputs(rows: Array<OnRollRow & { enrolee_number: string | null }>, nationalityByEnroleeNumber: Map<string, string>): { level: string; nationality: string | null }[]`

- [ ] **Step 1: Write the failing test** — `__tests__/sis/records-insights-loaders.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  enrolledStudentDataFrom,
  headcountFromRows,
  nationalityByLevelInputs,
  retentionByLevelFromCohort,
  retentionCohortFrom,
  retentionFromCohort,
  valueByEnroleeNumber,
  type EnrolRow,
  type OnRollRow,
} from '@/lib/sis/records-insights';

const sec = (label: string | null, code: string) => ({
  academic_year_id: 'ay',
  levels: { label, code },
});

describe('headcountFromRows', () => {
  it('counts class rows per level label, code when the label is blank', () => {
    const rows: OnRollRow[] = [
      { section: sec('Primary One', 'P1') },
      { section: [sec('Primary One', 'P1')] },
      { section: sec(null, 'P2') },
      { section: null },
    ];
    const out = headcountFromRows(rows);
    expect(out.total).toBe(3);
    expect(out.byLevel).toEqual([
      { level: 'P2', count: 1 },
      { level: 'Primary One', count: 2 },
    ]);
  });
});

describe('enrolledStudentDataFrom', () => {
  it('is one entry per student number, first level wins, nameless rows skipped', () => {
    const rows: EnrolRow[] = [
      { student: { student_number: 'S1' }, section: sec('Primary One', 'P1') },
      {
        student: [{ student_number: 'S1' }],
        section: sec('Primary Two', 'P2'),
      },
      { student: { student_number: null }, section: sec('Primary One', 'P1') },
      {
        student: { student_number: 'S2' },
        section: sec('Secondary Four', 'S4'),
      },
    ];
    const data = enrolledStudentDataFrom(rows);
    expect([...data.studentNumbers]).toEqual(['S1', 'S2']);
    expect(data.levelByStudentNumber.get('S1')).toBe('Primary One');
    expect(data.levelByStudentNumber.get('S2')).toBe('Secondary Four');
  });
});

describe('retention cohort', () => {
  const prior = {
    studentNumbers: new Set(['S1', 'S2', 'S3', 'S4', 'S5']),
    levelByStudentNumber: new Map([
      ['S1', 'Primary One'],
      ['S2', 'Primary One'],
      ['S3', 'Primary Two'],
      ['S4', 'Secondary Four'],
    ]),
  };
  const current = new Set(['S1', 'S3', 'S4']);

  it('drops the terminal level, keeps a student with no level', () => {
    const cohort = retentionCohortFrom(prior, current);
    expect(cohort.map((m) => m.studentNumber)).toEqual([
      'S1',
      'S2',
      'S3',
      'S5',
    ]);
    expect(retentionFromCohort('AY2025', cohort)).toEqual({
      priorAy: 'AY2025',
      returned: 2,
      didNotReturn: 2,
      priorTotal: 4,
      pct: 50,
    });
  });

  it('by level keeps the terminal level and skips a student with no level', () => {
    const rows = retentionByLevelFromCohort(
      retentionCohortFrom(prior, current, { includeTerminal: true })
    );
    expect(rows).toEqual([
      {
        level: 'Primary One',
        priorTotal: 2,
        returned: 1,
        didNotReturn: 1,
        pct: 50,
      },
      {
        level: 'Primary Two',
        priorTotal: 1,
        returned: 1,
        didNotReturn: 0,
        pct: 100,
      },
      {
        level: 'Secondary Four',
        priorTotal: 1,
        returned: 1,
        didNotReturn: 0,
        pct: 100,
      },
    ]);
  });
});

describe('admissions lookups', () => {
  it('maps enrolee number → value, skipping blanks', () => {
    const map = valueByEnroleeNumber(
      [
        { enroleeNumber: 'E1', category: 'New' },
        { enroleeNumber: null, category: 'Current' },
        { enroleeNumber: 'E2', category: null },
      ],
      'category'
    );
    expect([...map.entries()]).toEqual([['E1', 'New']]);
  });

  it('builds the nationality-by-level inputs from the raw enrolee number', () => {
    const nat = new Map([['E1', 'Philippines']]);
    expect(
      nationalityByLevelInputs(
        [
          { enrolee_number: ' E1 ', section: sec('Primary One', 'P1') },
          { enrolee_number: null, section: null },
        ],
        nat
      )
    ).toEqual([
      { level: 'Primary One', nationality: 'Philippines' },
      { level: 'Unknown', nationality: null },
    ]);
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run __tests__/sis/records-insights-loaders.test.ts --pool=threads`. Expected: FAIL, `headcountFromRows is not a function` (none of the names are exported yet).

- [ ] **Step 3: Add the shared query + row helpers.** In `lib/sis/records-insights.ts`, add `levelLabelOf,` to the `@/lib/sis/insights-shared` import from Task 4.1, then directly above the `// Cross-AY retention` banner (line 285), add:

```ts
// ──────────────────────────────────────────────────────────────────────────
// On-roll rows — the ONE predicate every enrolled-population loader and its
// drill share: the year's class rows that are not withdrawn (graduated rows
// included), inner-joined to their section + level. Counted as ROWS.
// ──────────────────────────────────────────────────────────────────────────

export type ServiceClient = ReturnType<typeof createServiceClient>;

export const ON_ROLL_LEVEL_SELECT =
  'section:sections!inner(academic_year_id, levels!inner(label, code))';

export async function resolveAyId(
  service: ServiceClient,
  ayCode: string
): Promise<string | null> {
  const { data } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Every on-roll class row of the year, past the PostgREST 1000-row cap.
 * `select` MUST embed `section:sections!inner(academic_year_id …)` — the
 * year filter runs on that embed.
 */
export function fetchOnRollRows<T>(
  service: ServiceClient,
  ayId: string,
  select: string
): Promise<T[]> {
  // `select` is a runtime string, so supabase-js cannot infer the row type —
  // the cast names it. The builder itself is passed through untouched, so
  // fetchAllPages still appends its `id` tie-break ORDER BY.
  return fetchAllPages<T>(
    (from, to) =>
      service
        .from('section_students')
        .select(select)
        .eq('section.academic_year_id', ayId)
        .neq('enrollment_status', 'withdrawn')
        .range(from, to) as unknown as PromiseLike<{
        data: T[] | null;
        error: { message: string } | null;
      }>
  );
}

type LevelEmbedRow = { label: string | null; code: string };
export type OnRollSectionEmbed = {
  id?: string;
  academic_year_id?: string;
  name?: string | null;
  levels: LevelEmbedRow | LevelEmbedRow[] | null;
};
export type OnRollRow = {
  section: OnRollSectionEmbed | OnRollSectionEmbed[] | null;
};

export function sectionOf(r: OnRollRow): OnRollSectionEmbed | null {
  return Array.isArray(r.section) ? (r.section[0] ?? null) : r.section;
}

/** Enrolled headcount: class rows per level label (Insights §1). */
export function headcountFromRows(rows: OnRollRow[]): RecordsHeadcount {
  const levelCounts = new Map<string, number>();
  for (const r of rows) {
    const sec = sectionOf(r);
    if (!sec) continue;
    const label = levelLabelOf(sec.levels);
    levelCounts.set(label, (levelCounts.get(label) ?? 0) + 1);
  }
  const byLevel: LevelCount[] = [...levelCounts.entries()]
    .map(([level, count]) => ({ level, count }))
    .sort((a, b) => a.level.localeCompare(b.level));
  const total = byLevel.reduce((s, l) => s + l.count, 0);
  return { total, byLevel };
}

export type EnroleeValueRow = {
  enroleeNumber: string | null;
  category?: string | null;
  nationality?: string | null;
};

/** enroleeNumber → the admissions value, blanks skipped. */
export function valueByEnroleeNumber(
  appRows: EnroleeValueRow[],
  key: 'category' | 'nationality'
): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of appRows) {
    const v = a[key];
    if (a.enroleeNumber && v) out.set(a.enroleeNumber, v);
  }
  return out;
}

/** The whole year's applications table, read the way every mix loader reads it. */
export async function fetchEnroleeValueMap(
  service: ServiceClient,
  ayCode: string,
  key: 'category' | 'nationality'
): Promise<Map<string, string>> {
  const appRows = await fetchAllPages<EnroleeValueRow>(
    (from, to) =>
      service
        .from(`${prefixFor(ayCode)}_enrolment_applications`)
        .select(`enroleeNumber, ${key}`)
        .range(from, to) as unknown as PromiseLike<{
        data: EnroleeValueRow[] | null;
        error: { message: string } | null;
      }>
  );
  return valueByEnroleeNumber(appRows, key);
}

/** Nationality × level inputs: section level label + the raw enrolee's nationality. */
export function nationalityByLevelInputs(
  rows: Array<OnRollRow & { enrolee_number: string | null }>,
  nationalityByEnroleeNumber: Map<string, string>
): { level: string; nationality: string | null }[] {
  return rows.map((r) => {
    const en = r.enrolee_number?.trim();
    return {
      level: levelLabelOf(sectionOf(r)?.levels),
      nationality: (en && nationalityByEnroleeNumber.get(en)) || null,
    };
  });
}
```

- [ ] **Step 4: Retention from one cohort.** Replace lines 318–403 (the `loadEnrolledStudentData` doc through the end of the deprecated `loadEnrolledStudentNumbers`) with:

```ts
export type EnrolRow = OnRollRow & {
  student:
    | { student_number: string | null }
    | { student_number: string | null }[]
    | null;
};

export type EnrolledStudentData = {
  studentNumbers: Set<string>;
  levelByStudentNumber: Map<string, string>;
};

/**
 * One entry per student_number, with the level of the first row that has a
 * section (level is stable within an AY in practice). Rows with no student
 * number are skipped.
 */
export function enrolledStudentDataFrom(rows: EnrolRow[]): EnrolledStudentData {
  const studentNumbers = new Set<string>();
  const levelByStudentNumber = new Map<string, string>();
  for (const r of rows) {
    const s = Array.isArray(r.student) ? r.student[0] : r.student;
    if (!s?.student_number) continue;
    const sn = s.student_number;
    studentNumbers.add(sn);
    if (!levelByStudentNumber.has(sn)) {
      const sec = sectionOf(r);
      if (sec) levelByStudentNumber.set(sn, levelLabelOf(sec.levels));
    }
  }
  return { studentNumbers, levelByStudentNumber };
}

export async function loadEnrolledStudentData(
  ayCode: string
): Promise<EnrolledStudentData> {
  const service = createServiceClient();
  const ayId = await resolveAyId(service, ayCode);
  if (!ayId)
    return { studentNumbers: new Set(), levelByStudentNumber: new Map() };
  const rows = await fetchOnRollRows<EnrolRow>(
    service,
    ayId,
    `student:students(student_number), ${ON_ROLL_LEVEL_SELECT}`
  );
  return enrolledStudentDataFrom(rows);
}

export type RetentionCohortMember = {
  studentNumber: string;
  /** Prior-year level label; null when no level is on record. */
  level: string | null;
  returned: boolean;
};

/**
 * The retention cohort: every prior-year student, marked returned when on
 * roll in the current year. The terminal level (S4) graduates rather than
 * leaves, so it is dropped unless `includeTerminal`. A student with no level
 * is NOT assumed terminal.
 */
export function retentionCohortFrom(
  prior: EnrolledStudentData,
  currentNumbers: ReadonlySet<string>,
  opts: { includeTerminal?: boolean } = {}
): RetentionCohortMember[] {
  const out: RetentionCohortMember[] = [];
  for (const sn of prior.studentNumbers) {
    const level = prior.levelByStudentNumber.get(sn) ?? null;
    if (!opts.includeTerminal && isTerminalLevel(level ?? '')) continue;
    out.push({ studentNumber: sn, level, returned: currentNumbers.has(sn) });
  }
  return out;
}

export function retentionFromCohort(
  priorAy: string,
  cohort: RetentionCohortMember[]
): Retention {
  const priorTotal = cohort.length;
  const returned = cohort.filter((m) => m.returned).length;
  return {
    priorAy,
    returned,
    didNotReturn: priorTotal - returned,
    priorTotal,
    pct:
      priorTotal === 0 ? null : Math.round((returned / priorTotal) * 1000) / 10,
  };
}

/** Per prior-year level, worst rate first. Students with no level are skipped. */
export function retentionByLevelFromCohort(
  cohort: RetentionCohortMember[]
): LevelRetentionRow[] {
  const byLevel = new Map<string, { total: number; returned: number }>();
  for (const m of cohort) {
    if (m.level === null) continue;
    const bucket = byLevel.get(m.level) ?? { total: 0, returned: 0 };
    bucket.total += 1;
    if (m.returned) bucket.returned += 1;
    byLevel.set(m.level, bucket);
  }
  return [...byLevel.entries()]
    .map(([level, { total, returned }]) => ({
      level,
      priorTotal: total,
      returned,
      didNotReturn: total - returned,
      pct: total === 0 ? null : Math.round((returned / total) * 1000) / 10,
    }))
    .sort((a, b) => {
      const aRate = a.pct ?? 100;
      const bRate = b.pct ?? 100;
      return aRate - bRate || a.level.localeCompare(b.level);
    });
}
```

Move the `Retention` and `LevelRetentionRow` type declarations (lines 405–420) above this block so the functions can name them. Then replace the bodies of `loadRecordsRetention` (from `const [currentNumbers, priorData]` to the end) and `loadRecordsRetentionByLevel` (from `const [currentData, priorData]` to the end) with, respectively:

```ts
const [current, prior] = await Promise.all([
  loadEnrolledStudentData(currentAy),
  loadEnrolledStudentData(priorAy),
]);
return retentionFromCohort(
  priorAy,
  retentionCohortFrom(prior, current.studentNumbers)
);
```

```ts
const [current, prior] = await Promise.all([
  loadEnrolledStudentData(currentAy),
  loadEnrolledStudentData(priorAy),
]);
return retentionByLevelFromCohort(
  retentionCohortFrom(prior, current.studentNumbers, {
    includeTerminal: true,
  })
);
```

- [ ] **Step 5: The four on-roll loaders use the shared predicate.**

  `getInsightsHeadcount` body (lines 576–627) becomes:

```ts
const service = createServiceClient();
const ayId = await resolveAyId(service, ayCode);
if (!ayId) return { total: 0, byLevel: [] };
const rows = await fetchOnRollRows<OnRollRow>(
  service,
  ayId,
  ON_ROLL_LEVEL_SELECT
);
return headcountFromRows(rows);
```

`loadEnrolledCategoryMixUncached` body (lines 685–723) becomes:

```ts
const service = createServiceClient();
const ayId = await resolveAyId(service, ayCode);
if (!ayId) return computeEnrolledCategoryMix([], new Map());
const [enrolledRows, categoryByEnroleeNumber] = await Promise.all([
  fetchOnRollRows<{ enrolee_number: string | null }>(
    service,
    ayId,
    `enrolee_number, ${ON_ROLL_LEVEL_SELECT}`
  ),
  fetchEnroleeValueMap(service, ayCode, 'category'),
]);
return computeEnrolledCategoryMix(
  enrolledRows.map((r) => ({ enroleeNumber: r.enrolee_number })),
  categoryByEnroleeNumber
);
```

`loadEnrolledNationalityMixUncached` body (lines 775–813) becomes the same shape with `'nationality'` and `computeEnrolledNationalityMix(…, nationalityByEnroleeNumber)`.

`loadEnrolledNationalityByLevelUncached` body (lines 849–903) becomes:

```ts
const service = createServiceClient();
const ayId = await resolveAyId(service, ayCode);
if (!ayId) return computeNationalityByLevel([]);
const [enrolledRows, nationalityByEnroleeNumber] = await Promise.all([
  fetchOnRollRows<OnRollRow & { enrolee_number: string | null }>(
    service,
    ayId,
    `enrolee_number, ${ON_ROLL_LEVEL_SELECT}`
  ),
  fetchEnroleeValueMap(service, ayCode, 'nationality'),
]);
return computeNationalityByLevel(
  nationalityByLevelInputs(enrolledRows, nationalityByEnroleeNumber)
);
```

⚠ The category and nationality mixes used to select `section:sections!inner(academic_year_id)` without the level embed; they now share `ON_ROLL_LEVEL_SELECT` (`levels!inner`). `sections.level_id` is required, so no row changes population — but this is the line that makes all four loaders and the drill one population. Delete the now-unused local `SsRow` / `AppRow` types in those three loaders.

- [ ] **Step 6: Run** — `npx vitest run __tests__/sis/records-insights-loaders.test.ts __tests__/sis/records-insights.test.ts __tests__/sis/records-insights-export.test.ts --pool=threads`. Expected: PASS.

- [ ] **Step 7: Commit** — `git add lib/sis/records-insights.ts __tests__/sis/records-insights-loaders.test.ts && git commit -m "refactor(records): insights loaders count through shared, testable predicates"`

---

### Task 4.3: Seven new Records drill targets (filter, columns, headers)

**Files:**

- Modify: `lib/sis/drill.ts` — `RecordsDrillTarget` (line 62), `RecordsDrillRow` (line 73), `applyTargetFilter` (line 867), `DrillColumnKey` / `ALL_DRILL_COLUMNS` / `DRILL_COLUMN_LABELS` (lines 993–1040), `defaultColumnsForTarget` (line 1042), `drillHeaderForTarget` (line 1093)
- Test: `__tests__/sis/records-insights-drill-filter.test.ts`

**Interfaces:**

- Consumes: `parseInsightsSegment`, `levelMatchesSegment`, `isOnRoll`, `isMidYearJoinKind`, `movementMonthIndex`, `MONTH_LABELS`, `type ControllabilityBucket` (Task 4.1).
- Produces:
  - `RecordsDrillTarget` gains `'enrolled-headcount' | 'retention' | 'late-enrollees' | 'withdrawals' | 'movement-month' | 'category' | 'nationality'`
  - `INSIGHTS_DRILL_TARGETS: ReadonlySet<RecordsDrillTarget>`
  - `RecordsDrillRow` gains optional `withdrawalReason`, `controllable`, `category`, `nationality`, `nationalityMixBucket`, `nationalityLevelBucket`, `returned`, `joinedTerm`, `movementKind`, `movementDate`
  - `DrillColumnKey` gains `'withdrawalReason' | 'controllable' | 'category' | 'nationality' | 'returned' | 'joinedTerm' | 'movementDate'`

- [ ] **Step 1: Write the failing test** — `__tests__/sis/records-insights-drill-filter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  ALL_DRILL_COLUMNS,
  applyTargetFilter,
  defaultColumnsForTarget,
  DRILL_COLUMN_LABELS,
  drillHeaderForTarget,
  INSIGHTS_DRILL_TARGETS,
  type RecordsDrillRow,
} from '@/lib/sis/drill';

function row(over: Partial<RecordsDrillRow>): RecordsDrillRow {
  return {
    enroleeNumber: 'E1',
    studentNumber: 'S1',
    fullName: 'Jane Doe',
    enrollmentStatus: 'active',
    applicationStatus: '',
    level: 'Primary One',
    sectionId: 'sec1',
    sectionName: 'Obedience',
    pipelineStage: 'Enrolled',
    applicationDate: null,
    enrollmentDate: null,
    withdrawalDate: null,
    daysSinceUpdate: null,
    hasMissingDocs: false,
    expiringDocsCount: 0,
    documentsComplete: 0,
    documentsTotal: 0,
    ...over,
  };
}

describe('enrolled-headcount', () => {
  const rows = [
    row({}),
    row({ enrollmentStatus: 'graduated', level: 'Secondary Four' }),
    row({ enrollmentStatus: 'withdrawn' }),
    row({ level: 'Youngstarters' }),
  ];
  it('keeps every on-roll row, graduated included', () => {
    expect(applyTargetFilter(rows, 'enrolled-headcount', null)).toHaveLength(3);
  });
  it('matches a level code and a label the catalog does not know', () => {
    expect(
      applyTargetFilter(rows, 'enrolled-headcount', 'level:P1')
    ).toHaveLength(1);
    expect(
      applyTargetFilter(rows, 'enrolled-headcount', 'level:Youngstarters')
    ).toHaveLength(1);
  });
  it('opens nothing for an unreadable segment', () => {
    expect(applyTargetFilter(rows, 'enrolled-headcount', 'P1')).toEqual([]);
  });
});

describe('category and nationality', () => {
  const rows = [
    row({
      category: 'New',
      nationalityMixBucket: 'Other',
      nationalityLevelBucket: 'Philippines',
    }),
    row({
      category: 'Unspecified',
      level: 'Primary Two',
      nationalityMixBucket: 'Philippines',
      nationalityLevelBucket: 'Other',
    }),
  ];
  it('filters the category bucket', () => {
    expect(
      applyTargetFilter(rows, 'category', 'category:Unspecified')
    ).toHaveLength(1);
  });
  it('uses the pie bucket alone and the by-level bucket with a level', () => {
    expect(
      applyTargetFilter(rows, 'nationality', 'nationality:Other')
    ).toHaveLength(1);
    expect(
      applyTargetFilter(
        rows,
        'nationality',
        'level:Primary Two|nationality:Other'
      )
    ).toHaveLength(1);
    expect(
      applyTargetFilter(
        rows,
        'nationality',
        'level:Primary One|nationality:Other'
      )
    ).toHaveLength(0);
  });
});

describe('retention', () => {
  const rows = [
    row({ returned: true }),
    row({ returned: false }),
    row({ returned: false, level: 'Primary Two' }),
  ];
  it('opens the whole cohort with no segment', () => {
    expect(applyTargetFilter(rows, 'retention', null)).toHaveLength(3);
  });
  it('splits a level by outcome, level given as the chart code', () => {
    expect(
      applyTargetFilter(rows, 'retention', 'level:P1|outcome:returned')
    ).toHaveLength(1);
    expect(
      applyTargetFilter(rows, 'retention', 'level:P1|outcome:didNotReturn')
    ).toHaveLength(1);
  });
});

describe('movement targets', () => {
  const rows = [
    row({
      movementKind: 'late-enrolled',
      joinedTerm: 2,
      movementDate: '2026-03-02',
    }),
    row({
      movementKind: 'late-enrolled',
      joinedTerm: null,
      movementDate: '2026-04-02',
    }),
    row({ movementKind: 're-enrolled', movementDate: '2026-03-09' }),
    row({
      movementKind: 'withdrawn',
      withdrawalReason: 'Financial / non-payment',
      controllable: 'controllable',
      movementDate: '2026-03-20',
    }),
    row({
      movementKind: 'withdrawn',
      level: 'Primary Two',
      withdrawalReason: 'Unspecified',
      controllable: 'unspecified',
      movementDate: '2026-06-20',
    }),
  ];
  it('late enrollees by term and level', () => {
    expect(applyTargetFilter(rows, 'late-enrollees', null)).toHaveLength(2);
    expect(applyTargetFilter(rows, 'late-enrollees', 'term:2')).toHaveLength(1);
    expect(
      applyTargetFilter(rows, 'late-enrollees', 'level:Primary One')
    ).toHaveLength(2);
  });
  it('withdrawals by reason, level, and cell', () => {
    expect(applyTargetFilter(rows, 'withdrawals', null)).toHaveLength(2);
    expect(
      applyTargetFilter(rows, 'withdrawals', 'reason:Unspecified')
    ).toHaveLength(1);
    expect(
      applyTargetFilter(
        rows,
        'withdrawals',
        'level:Primary One|reason:Financial / non-payment'
      )
    ).toHaveLength(1);
  });
  it('movement month splits joins from withdrawals', () => {
    expect(
      applyTargetFilter(rows, 'movement-month', 'flow:enrollments|month:Mar')
    ).toHaveLength(2);
    expect(
      applyTargetFilter(rows, 'movement-month', 'flow:withdrawals|month:Mar')
    ).toHaveLength(1);
    expect(
      applyTargetFilter(rows, 'movement-month', 'flow:withdrawals|month:Feb')
    ).toEqual([]);
    expect(applyTargetFilter(rows, 'movement-month', null)).toEqual([]);
  });
});

describe('every insights target has columns, labels and a plain title', () => {
  it.each([...INSIGHTS_DRILL_TARGETS])('%s', (target) => {
    const cols = defaultColumnsForTarget(target);
    expect(cols.length).toBeGreaterThan(0);
    for (const c of cols) expect(ALL_DRILL_COLUMNS).toContain(c);
    expect(drillHeaderForTarget(target, null).title.length).toBeGreaterThan(0);
  });
  it('labels every column key', () => {
    for (const c of ALL_DRILL_COLUMNS) {
      expect(DRILL_COLUMN_LABELS[c].length).toBeGreaterThan(0);
    }
  });
  it('titles a code segment with the level name', () => {
    expect(
      drillHeaderForTarget('retention', 'level:P1|outcome:didNotReturn').title
    ).toBe('Primary One · did not come back');
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run __tests__/sis/records-insights-drill-filter.test.ts --pool=threads`. Expected: FAIL, `INSIGHTS_DRILL_TARGETS` is undefined / type errors on the new targets.

- [ ] **Step 3: Types.** In `lib/sis/drill.ts` add to the imports:

```ts
import {
  isMidYearJoinKind,
  isOnRoll,
  levelMatchesSegment,
  MONTH_LABELS,
  movementMonthIndex,
  parseInsightsSegment,
  type ControllabilityBucket,
} from '@/lib/sis/insights-shared';
import { LEVEL_LABELS } from '@/lib/sis/levels';
```

Extend `RecordsDrillTarget` (after `'class-assignment-readiness'`):

```ts
  | 'class-assignment-readiness'
  // Records Insights (KD #229). Rows come from lib/sis/insights-drill-rows.ts,
  // not buildRecordsDrillRows — see INSIGHTS_DRILL_TARGETS.
  | 'enrolled-headcount'
  | 'retention'
  | 'late-enrollees'
  | 'withdrawals'
  | 'movement-month'
  | 'category'
  | 'nationality';

/** Targets whose rows are built by `buildInsightsDrillRows`, not `buildRecordsDrillRows`. */
export const INSIGHTS_DRILL_TARGETS: ReadonlySet<RecordsDrillTarget> =
  new Set<RecordsDrillTarget>([
    'enrolled-headcount',
    'retention',
    'late-enrollees',
    'withdrawals',
    'movement-month',
    'category',
    'nationality',
  ]);
```

Add to `RecordsDrillRow`, after `docSlotBuckets?`:

```ts
  // ── Records Insights fields (set only by lib/sis/insights-drill-rows.ts) ──
  /** Withdrawal events: the reason label the rollup counts ('Unspecified' when none). */
  withdrawalReason?: string | null;
  /** Withdrawal events: WITHDRAWAL_CONTROLLABILITY of the raw reason. */
  controllable?: ControllabilityBucket | null;
  /** On-roll rows: enrolee category bucket (ENROLEE_CATEGORIES or 'Unspecified'). */
  category?: string | null;
  /** On-roll rows: canonical nationality, null when none on record. */
  nationality?: string | null;
  /** On-roll rows: the nationality pie's slice for this row (top 8, 'Other', 'Unspecified'). */
  nationalityMixBucket?: string | null;
  /** On-roll rows: the nationality-by-level bar segment (global top 6, 'Other', 'Unspecified'). */
  nationalityLevelBucket?: string | null;
  /** Retention cohort rows: on roll again in the selected year. */
  returned?: boolean | null;
  /** Late-enrolled events: the joining term number. */
  joinedTerm?: number | null;
  /** Movement rows: which event this row is. */
  movementKind?: 'late-enrolled' | 're-enrolled' | 'withdrawn' | null;
  /** Movement rows: the event date the monthly chart buckets by (ISO). */
  movementDate?: string | null;
```

- [ ] **Step 4: Filter.** In `applyTargetFilter`, add before `default:`:

```ts
    // ── Records Insights. The row builders already hold each loader's
    // population; these cases re-assert it and apply the clicked segment. A
    // segment that does not parse opens nothing, never everyone.
    case 'enrolled-headcount': {
      const seg = parseInsightsSegment(segment);
      if (!seg) return [];
      return rows.filter(
        (r) =>
          isOnRoll(r.enrollmentStatus) &&
          (seg.level === undefined || levelMatchesSegment(r.level, seg.level))
      );
    }
    case 'category': {
      const seg = parseInsightsSegment(segment);
      if (!seg) return [];
      return rows.filter(
        (r) =>
          isOnRoll(r.enrollmentStatus) &&
          (seg.category === undefined || r.category === seg.category)
      );
    }
    case 'nationality': {
      const seg = parseInsightsSegment(segment);
      if (!seg) return [];
      return rows.filter((r) => {
        if (!isOnRoll(r.enrollmentStatus)) return false;
        if (seg.nationality === undefined) return true;
        if (seg.level !== undefined) {
          return (
            levelMatchesSegment(r.level, seg.level) &&
            r.nationalityLevelBucket === seg.nationality
          );
        }
        return r.nationalityMixBucket === seg.nationality;
      });
    }
    case 'retention': {
      const seg = parseInsightsSegment(segment);
      if (!seg) return [];
      return rows.filter(
        (r) =>
          typeof r.returned === 'boolean' &&
          (seg.level === undefined || levelMatchesSegment(r.level, seg.level)) &&
          (seg.outcome === undefined ||
            (seg.outcome === 'returned' && r.returned) ||
            (seg.outcome === 'didNotReturn' && !r.returned))
      );
    }
    case 'late-enrollees': {
      const seg = parseInsightsSegment(segment);
      if (!seg) return [];
      return rows.filter(
        (r) =>
          r.movementKind === 'late-enrolled' &&
          (seg.level === undefined || levelMatchesSegment(r.level, seg.level)) &&
          (seg.term === undefined ||
            (typeof r.joinedTerm === 'number' &&
              String(r.joinedTerm) === seg.term))
      );
    }
    case 'withdrawals': {
      const seg = parseInsightsSegment(segment);
      if (!seg) return [];
      return rows.filter(
        (r) =>
          r.movementKind === 'withdrawn' &&
          (seg.level === undefined || levelMatchesSegment(r.level, seg.level)) &&
          (seg.reason === undefined || r.withdrawalReason === seg.reason)
      );
    }
    case 'movement-month': {
      const seg = parseInsightsSegment(segment);
      if (!seg || !seg.flow || !seg.month) return [];
      const monthIdx = (MONTH_LABELS as readonly string[]).indexOf(seg.month);
      if (monthIdx < 0) return [];
      const isFlow =
        seg.flow === 'enrollments'
          ? (k: string) => isMidYearJoinKind(k)
          : seg.flow === 'withdrawals'
            ? (k: string) => k === 'withdrawn'
            : null;
      if (!isFlow) return [];
      return rows.filter(
        (r) =>
          !!r.movementKind &&
          isFlow(r.movementKind) &&
          movementMonthIndex(r.movementDate) === monthIdx
      );
    }
```

- [ ] **Step 5: Columns and headers.** Extend `DrillColumnKey`, `ALL_DRILL_COLUMNS` and `DRILL_COLUMN_LABELS`:

```ts
  | 'documentsComplete'
  | 'withdrawalReason'
  | 'controllable'
  | 'category'
  | 'nationality'
  | 'returned'
  | 'joinedTerm'
  | 'movementDate';
```

append the same seven keys, in that order, to `ALL_DRILL_COLUMNS`, and to `DRILL_COLUMN_LABELS`:

```ts
  withdrawalReason: 'Reason',
  controllable: 'Preventable?',
  category: 'Category',
  nationality: 'Nationality',
  returned: 'Came back?',
  joinedTerm: 'Joined in',
  movementDate: 'Date',
```

Add to `defaultColumnsForTarget`:

```ts
    case 'enrolled-headcount':
      return ['fullName', 'level', 'sectionName', 'enrollmentStatus', 'enrollmentDate'];
    case 'category':
      return ['fullName', 'level', 'sectionName', 'category'];
    case 'nationality':
      return ['fullName', 'level', 'sectionName', 'nationality'];
    case 'retention':
      return ['fullName', 'level', 'sectionName', 'returned'];
    case 'late-enrollees':
      return ['fullName', 'level', 'sectionName', 'joinedTerm', 'movementDate'];
    case 'withdrawals':
      return ['fullName', 'level', 'withdrawalReason', 'controllable', 'withdrawalDate'];
    case 'movement-month':
      return ['fullName', 'level', 'sectionName', 'movementDate', 'enrollmentStatus'];
```

Add above `drillHeaderForTarget`:

```ts
/** A segment's level for a title: the chart's code shown as its name. */
function levelTitle(v: string): string {
  return (LEVEL_LABELS as Record<string, string>)[v] ?? v;
}
```

and these cases inside it:

```ts
    case 'enrolled-headcount': {
      const s = parseInsightsSegment(segment);
      return {
        eyebrow: 'Drill · Enrolled',
        title: s?.level ? `Enrolled in ${levelTitle(s.level)}` : 'Enrolled students',
      };
    }
    case 'category': {
      const s = parseInsightsSegment(segment);
      const c = s?.category;
      return {
        eyebrow: 'Drill · Category',
        title: !c
          ? 'Enrolled students by category'
          : c === 'Unspecified'
            ? 'No category on record'
            : `${c} students`,
      };
    }
    case 'nationality': {
      const s = parseInsightsSegment(segment);
      const n = s?.nationality;
      const name = !n
        ? 'Enrolled students by nationality'
        : n === 'Other'
          ? 'Other nationalities'
          : n === 'Unspecified'
            ? 'No nationality on record'
            : n;
      return {
        eyebrow: 'Drill · Nationality',
        title: s?.level ? `${levelTitle(s.level)} · ${name}` : name,
      };
    }
    case 'retention': {
      const s = parseInsightsSegment(segment);
      if (!s?.level) return { eyebrow: 'Drill · Retention', title: 'Who came back' };
      const outcome =
        s.outcome === 'returned'
          ? ' · came back'
          : s.outcome === 'didNotReturn'
            ? ' · did not come back'
            : '';
      return {
        eyebrow: 'Drill · Retention',
        title: `${levelTitle(s.level)}${outcome}`,
      };
    }
    case 'late-enrollees': {
      const s = parseInsightsSegment(segment);
      return {
        eyebrow: 'Drill · Late enrollees',
        title: s?.term
          ? `Joined late in Term ${s.term}`
          : s?.level
            ? `Late enrollees in ${levelTitle(s.level)}`
            : 'Late enrollees',
      };
    }
    case 'withdrawals': {
      const s = parseInsightsSegment(segment);
      const parts = [s?.level ? levelTitle(s.level) : null, s?.reason ?? null].filter(
        (p): p is string => !!p
      );
      return {
        eyebrow: 'Drill · Withdrawals',
        title: parts.length > 0 ? `Withdrawals · ${parts.join(' · ')}` : 'Withdrawals this year',
      };
    }
    case 'movement-month': {
      const s = parseInsightsSegment(segment);
      return {
        eyebrow: 'Drill · Movement',
        title:
          s?.flow === 'withdrawals'
            ? `Withdrew in ${s.month ?? ''}`.trim()
            : `Joined mid-year in ${s?.month ?? ''}`.trim(),
      };
    }
```

- [ ] **Step 6: Run** — `npx vitest run __tests__/sis/records-insights-drill-filter.test.ts __tests__/sis/records-enrollments-anchor.test.ts __tests__/sis/records-backlog-segment.test.ts --pool=threads`. Expected: PASS (dashboard targets unchanged).

- [ ] **Step 7: Commit** — `git add lib/sis/drill.ts __tests__/sis/records-insights-drill-filter.test.ts && git commit -m "feat(records): drill targets for every insights number"`

---

### Task 4.4: Insights row builders + parity tests

**Files:**

- Create: `lib/sis/insights-drill-rows.ts` (server-only)
- Test: `__tests__/sis/records-insights-drill-parity.test.ts`

**Interfaces:**

- Consumes: Task 4.2 exports (`fetchOnRollRows`, `resolveAyId`, `sectionOf`, `enrolledStudentDataFrom`, `retentionCohortFrom`, `loadEnrolledStudentData`, `fetchEnroleeValueMap`, `nationalityByLevelInputs`, `computeEnrolledNationalityMix`, `type OnRollRow`); `canonicaliseNationality`, `computeNationalityByLevel` (`lib/admissions/insights-funnel.ts`); `getMovementEvents`, `type MovementEvent` (`lib/sis/movements.ts`); `buildRecordsDrillRows`, `type RecordsDrillRow`, `type RecordsDrillTarget` (Task 4.3); Task 4.1 helpers.
- Produces:
  - `ON_ROLL_DRILL_SELECT: string`, `type OnRollDrillSourceRow`
  - `onRollDrillRowsFrom(rows: OnRollDrillSourceRow[], categoryByEnroleeNumber: Map<string, string>, nationalityByEnroleeNumber: Map<string, string>): RecordsDrillRow[]`
  - `retentionDrillRowsFrom(priorRows: OnRollDrillSourceRow[], currentNumbers: ReadonlySet<string>): RecordsDrillRow[]`
  - `movementDrillRowsFrom(events: MovementEvent[], roster: RecordsDrillRow[]): RecordsDrillRow[]`
  - `buildInsightsDrillRows(target: RecordsDrillTarget, ayCode: string, compareAy: string | null): Promise<RecordsDrillRow[]>`

- [ ] **Step 1: Write the failing parity test** — `__tests__/sis/records-insights-drill-parity.test.ts`. Each block runs the loader's own counting function and the drill's builder + filter over one fixture and demands equal counts, for every bar/slice the loader emits.

```ts
import { describe, expect, it } from 'vitest';

import { computeNationalityByLevel } from '@/lib/admissions/insights-funnel';
import { applyTargetFilter, type RecordsDrillRow } from '@/lib/sis/drill';
import {
  encodeInsightsSegment,
  INSIGHTS_MOVEMENT_MONTHS,
  levelShortCode,
} from '@/lib/sis/insights-shared';
import {
  movementDrillRowsFrom,
  onRollDrillRowsFrom,
  retentionDrillRowsFrom,
  type OnRollDrillSourceRow,
} from '@/lib/sis/insights-drill-rows';
import type { MovementEvent } from '@/lib/sis/movements';
import {
  computeEnrolledCategoryMix,
  computeEnrolledNationalityMix,
  enrolledStudentDataFrom,
  headcountFromRows,
  isTerminalLevel,
  monthlyMovementSeries,
  nationalityByLevelInputs,
  retentionByLevelFromCohort,
  retentionCohortFrom,
  retentionFromCohort,
  rollupMovements,
} from '@/lib/sis/records-insights';

const LEVELS = [
  { label: 'Primary One', code: 'P1' },
  { label: 'Primary Two', code: 'P2' },
  { label: 'Youngstarters', code: 'YS' },
  { label: 'Secondary Four', code: 'S4' },
];

function src(
  i: number,
  over: Partial<{
    sn: string | null;
    en: string | null;
    level: number;
    status: string;
  }> = {}
): OnRollDrillSourceRow {
  const lvl = LEVELS[over.level ?? i % 3];
  return {
    id: `ss${i}`,
    enrolee_number: over.en === undefined ? `E${i}` : over.en,
    enrollment_status: over.status ?? 'active',
    enrollment_date: null,
    student: {
      student_number: over.sn === undefined ? `S${i}` : over.sn,
      first_name: `First${i}`,
      middle_name: null,
      last_name: `Last${i}`,
    },
    section: {
      id: `sec-${lvl.code}`,
      name: `${lvl.code} Obedience`,
      academic_year_id: 'ay',
      levels: lvl,
    },
  };
}

// 15 on-roll rows: 11 distinct nationalities once 'Viet Nam' folds into
// 'Vietnam' (so the top-8 pie AND the top-6 by-level bars both fold an
// 'Other'), a row with no enrolee number and one with no nationality
// ('Unspecified'), one student on two live rows, a graduated S4 row, and a
// Youngstarters class (a level the short-code map does not know).
const onRoll: OnRollDrillSourceRow[] = [
  ...Array.from({ length: 12 }, (_, i) => src(i)),
  src(12, { en: null }),
  src(13, { sn: 'S0', en: 'E0', level: 1, status: 'late_enrollee' }),
  src(14, { level: 3, status: 'graduated' }),
];
const nationalityMap = new Map([
  ['E0', 'Philippines'],
  ['E1', 'Philippines'],
  ['E2', 'Singapore'],
  ['E3', 'India'],
  ['E4', 'China'],
  ['E5', 'Japan'],
  ['E6', 'Viet Nam'],
  ['E7', 'Vietnam'],
  ['E8', 'Indonesia'],
  ['E9', 'Malaysia'],
  ['E10', 'Thailand'],
  ['E11', 'Australia'],
  ['E14', 'France'],
]);
const categoryMap = new Map([
  ['E0', 'New'],
  ['E1', 'Current'],
  ['E2', 'VizSchool New'],
  ['E3', 'Bogus'],
  ['E4', 'New'],
]);

const drillRows = onRollDrillRowsFrom(onRoll, categoryMap, nationalityMap);
const count = (
  target: Parameters<typeof applyTargetFilter>[1],
  seg: string | null
) => applyTargetFilter(drillRows, target, seg).length;

describe('enrolled-headcount = getInsightsHeadcount', () => {
  const headcount = headcountFromRows(onRoll);
  it('total', () => {
    expect(count('enrolled-headcount', null)).toBe(headcount.total);
  });
  it('every level, clicked by the code the chart plots', () => {
    expect(headcount.byLevel.map((l) => l.level)).toContain('Youngstarters');
    for (const l of headcount.byLevel) {
      const seg = encodeInsightsSegment({ level: levelShortCode(l.level) });
      expect(count('enrolled-headcount', seg)).toBe(l.count);
    }
  });
});

describe('category = getEnrolledCategoryMix', () => {
  const mix = computeEnrolledCategoryMix(
    onRoll.map((r) => ({ enroleeNumber: r.enrolee_number })),
    categoryMap
  );
  it('every bar, Unspecified included', () => {
    expect(mix.some((m) => m.category === 'Unspecified')).toBe(true);
    for (const m of mix) {
      expect(
        count('category', encodeInsightsSegment({ category: m.category }))
      ).toBe(m.count);
    }
  });
});

describe('nationality = getEnrolledNationalityMix / ByLevel', () => {
  const mix = computeEnrolledNationalityMix(
    onRoll.map((r) => ({ enroleeNumber: r.enrolee_number })),
    nationalityMap
  );
  const byLevel = computeNationalityByLevel(
    nationalityByLevelInputs(onRoll, nationalityMap)
  );
  it('every slice, the folded Other included', () => {
    expect(mix.some((m) => m.nationality === 'Other')).toBe(true);
    for (const m of mix) {
      expect(
        count(
          'nationality',
          encodeInsightsSegment({ nationality: m.nationality })
        )
      ).toBe(m.count);
    }
  });
  it('every level × nationality segment', () => {
    expect(byLevel.legend).toContain('Other');
    for (const r of byLevel.rows) {
      for (const s of r.segments) {
        const seg = encodeInsightsSegment({
          level: r.level,
          nationality: s.nationality,
        });
        expect(count('nationality', seg)).toBe(s.count);
      }
    }
  });
});

describe('retention = getRecordsRetention / ByLevel (comparison-year rows)', () => {
  // The comparison year (AY2025): S1 twice (transfer), S2, S3, and an S4 leaver.
  const prior: OnRollDrillSourceRow[] = [
    src(1, { level: 0 }),
    src(21, { sn: 'S1', level: 1 }),
    src(2, { level: 0 }),
    src(3, { level: 1 }),
    src(4, { level: 3 }),
  ];
  const current = new Set(['S1', 'S3', 'S4']);
  const rows = retentionDrillRowsFrom(prior, current);
  const data = enrolledStudentDataFrom(prior);
  const kpi = retentionFromCohort('AY2025', retentionCohortFrom(data, current));
  const byLevel = retentionByLevelFromCohort(
    retentionCohortFrom(data, current, { includeTerminal: true })
  ).filter((r) => !isTerminalLevel(r.level));

  it('the KPI denominator and numerator', () => {
    expect(applyTargetFilter(rows, 'retention', null)).toHaveLength(
      kpi.priorTotal
    );
    expect(
      applyTargetFilter(rows, 'retention', null).filter((r) => r.returned)
    ).toHaveLength(kpi.returned);
  });
  it('every bar of the chart, by the code it plots', () => {
    for (const r of byLevel) {
      const code = levelShortCode(r.level);
      expect(
        applyTargetFilter(
          rows,
          'retention',
          encodeInsightsSegment({ level: code, outcome: 'returned' })
        )
      ).toHaveLength(r.returned);
      expect(
        applyTargetFilter(
          rows,
          'retention',
          encodeInsightsSegment({ level: code, outcome: 'didNotReturn' })
        )
      ).toHaveLength(r.didNotReturn);
    }
  });
});

describe('movement targets = rollupMovements / monthlyMovementSeries', () => {
  const base = {
    studentName: 'A Child',
    enroleeNumber: 'E1',
    ayCode: 'AY2026',
    termLabel: null,
    actorEmail: null,
  };
  let n = 0;
  const ev = (over: Record<string, unknown>) =>
    ({
      ...base,
      id: `a${(n += 1)}`,
      studentNumber: `S${n}`,
      termNumber: null,
      ...over,
    }) as MovementEvent;
  const events: MovementEvent[] = [
    ev({
      kind: 'late-enrolled',
      level: 'Primary One',
      termNumber: 2,
      date: '2026-03-10',
    }),
    ev({ kind: 'late-enrolled', level: 'Primary One', date: '2026-04-02' }),
    ev({
      kind: 'late-enrolled',
      level: 'Youngstarters',
      termNumber: 3,
      date: '2026-08-02',
    }),
    ev({ kind: 're-enrolled', level: 'Primary Two', date: '2026-03-15' }),
    ev({
      kind: 'withdrawn',
      level: 'Primary One',
      reason: 'financial',
      reasonLabel: 'Financial / non-payment',
      date: '2026-03-20',
    }),
    ev({
      kind: 'withdrawn',
      level: 'Primary Two',
      reason: 'family_relocation',
      reasonLabel: 'Family relocating',
      date: '2026-06-11',
    }),
    ev({
      kind: 'withdrawn',
      level: 'Primary One',
      reason: null,
      reasonLabel: null,
      date: '2026-06-30',
    }),
    ev({
      kind: 'withdrawn',
      level: '',
      reason: 'financial',
      reasonLabel: 'Financial / non-payment',
      date: '2026-12-01',
    }),
    ev({
      kind: 'section-transfer',
      level: 'Primary One',
      fromSection: 'A',
      toSection: 'B',
      date: '2026-03-01',
    }),
  ];
  const rows = movementDrillRowsFrom(events, [] as RecordsDrillRow[]);
  const rollup = rollupMovements(events);
  const monthly = monthlyMovementSeries(events, INSIGHTS_MOVEMENT_MONTHS);
  const c = (t: Parameters<typeof applyTargetFilter>[1], seg: string | null) =>
    applyTargetFilter(rows, t, seg).length;

  it('late enrollees: total, every level, every term', () => {
    expect(c('late-enrollees', null)).toBe(rollup.counts.lateEnrolled);
    for (const l of rollup.lateByLevel)
      expect(
        c('late-enrollees', encodeInsightsSegment({ level: l.level }))
      ).toBe(l.count);
    for (const t of rollup.lateByTerm)
      expect(
        c(
          'late-enrollees',
          encodeInsightsSegment({ term: String(t.termNumber) })
        )
      ).toBe(t.count);
  });
  it('withdrawals: total, every reason, every level, every matrix cell', () => {
    expect(c('withdrawals', null)).toBe(rollup.counts.withdrawn);
    for (const r of rollup.withdrawalsByReason)
      expect(
        c('withdrawals', encodeInsightsSegment({ reason: r.reason }))
      ).toBe(r.count);
    for (const l of rollup.withdrawalsByLevel)
      expect(c('withdrawals', encodeInsightsSegment({ level: l.level }))).toBe(
        l.count
      );
    for (const row of rollup.withdrawalsByReasonAndLevel)
      for (const [reason, cnt] of Object.entries(row.reasonCounts))
        expect(
          c('withdrawals', encodeInsightsSegment({ level: row.level, reason }))
        ).toBe(cnt);
  });
  it('the preventable share is readable off the rows', () => {
    const all = applyTargetFilter(rows, 'withdrawals', null);
    expect(all.filter((r) => r.controllable === 'controllable')).toHaveLength(
      rollup.controllability.controllableCount
    );
    expect(all.filter((r) => r.controllable === 'unspecified')).toHaveLength(
      rollup.controllability.unspecifiedCount
    );
  });
  it('every month × flow bar, zero months included', () => {
    for (const p of monthly) {
      expect(
        c(
          'movement-month',
          encodeInsightsSegment({ flow: 'enrollments', month: p.month })
        )
      ).toBe(p.enrollments);
      expect(
        c(
          'movement-month',
          encodeInsightsSegment({ flow: 'withdrawals', month: p.month })
        )
      ).toBe(p.withdrawals);
    }
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run __tests__/sis/records-insights-drill-parity.test.ts --pool=threads`. Expected: FAIL, `Failed to resolve import "@/lib/sis/insights-drill-rows"`.

- [ ] **Step 3: Create `lib/sis/insights-drill-rows.ts`:**

```ts
import 'server-only';

import { unstable_cache } from 'next/cache';

import {
  canonicaliseNationality,
  computeNationalityByLevel,
} from '@/lib/admissions/insights-funnel';
import {
  buildRecordsDrillRows,
  type RecordsDrillRow,
  type RecordsDrillTarget,
} from '@/lib/sis/drill';
import {
  controllabilityOf,
  enrolledCategoryBucket,
  levelLabelOf,
  movementLevelOf,
  withdrawalReasonLabelOf,
} from '@/lib/sis/insights-shared';
import { getMovementEvents, type MovementEvent } from '@/lib/sis/movements';
import {
  computeEnrolledNationalityMix,
  enrolledStudentDataFrom,
  fetchEnroleeValueMap,
  fetchOnRollRows,
  loadEnrolledStudentData,
  nationalityByLevelInputs,
  resolveAyId,
  retentionCohortFrom,
  sectionOf,
  type OnRollRow,
} from '@/lib/sis/records-insights';
import { createServiceClient } from '@/lib/supabase/service';

// Row builders for the Records Insights drills (KD #229). Each one reads the
// SAME population through the SAME function its Insights loader counts with,
// so a list's row count is the number on the card (KD #82/#124). The pure
// `…From` functions carry the logic and are what the parity tests pin; the
// cached loaders at the bottom only fetch.

const CACHE_TTL_SECONDS = 60;

function drillTags(...ayCodes: string[]): string[] {
  return [
    'records-drill',
    ...ayCodes.flatMap((ay) => [`records-drill:${ay}`, `sis:${ay}`]),
  ];
}

type StudentEmbed = {
  student_number: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
};

export type OnRollDrillSourceRow = OnRollRow & {
  id: string;
  enrolee_number: string | null;
  enrollment_status: string;
  enrollment_date: string | null;
  student: StudentEmbed | StudentEmbed[] | null;
};

/** The on-roll predicate's rows, with what a drill row needs to show them. */
export const ON_ROLL_DRILL_SELECT =
  'id, enrolee_number, enrollment_status, enrollment_date, student:students(student_number, first_name, middle_name, last_name), section:sections!inner(id, name, academic_year_id, levels!inner(label, code))';

function studentOf(r: OnRollDrillSourceRow): StudentEmbed | null {
  return Array.isArray(r.student) ? (r.student[0] ?? null) : r.student;
}

function nameOf(s: StudentEmbed | null, fallback: string): string {
  const name = [s?.first_name, s?.middle_name, s?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  return name || s?.student_number || fallback;
}

function blankRow(): Omit<
  RecordsDrillRow,
  'enroleeNumber' | 'studentNumber' | 'fullName' | 'enrollmentStatus' | 'level'
> {
  return {
    applicationStatus: '',
    sectionId: null,
    sectionName: null,
    pipelineStage: '',
    applicationDate: null,
    enrollmentDate: null,
    withdrawalDate: null,
    daysSinceUpdate: null,
    hasMissingDocs: false,
    expiringDocsCount: 0,
    documentsComplete: 0,
    documentsTotal: 0,
  };
}

function onRollBase(r: OnRollDrillSourceRow): RecordsDrillRow | null {
  const sec = sectionOf(r);
  if (!sec) return null; // the headcount skips it too
  const s = studentOf(r);
  return {
    ...blankRow(),
    enroleeNumber: r.enrolee_number?.trim() || s?.student_number || r.id,
    studentNumber: s?.student_number ?? null,
    fullName: nameOf(s, r.id),
    enrollmentStatus: r.enrollment_status,
    level: levelLabelOf(sec.levels),
    // sectionId is always set here: a null sectionId routes the name link to
    // the unsynced queue (KD #81), which these students are not in.
    sectionId: sec.id ?? r.id,
    sectionName: sec.name ?? null,
    pipelineStage:
      r.enrollment_status === 'graduated' ? 'Graduated' : 'Enrolled',
    enrollmentDate: r.enrollment_date,
  };
}

/** The named slices of a folded mix — everything that is not 'Other'/'Unspecified'. */
function namedNationalities(names: string[]): Set<string> {
  return new Set(names.filter((n) => n !== 'Other' && n !== 'Unspecified'));
}

function nationalityBucket(canon: string | null, named: Set<string>): string {
  if (!canon) return 'Unspecified';
  return named.has(canon) ? canon : 'Other';
}

/**
 * Enrolled headcount / category / nationality rows. The two nationality
 * buckets come from running the loaders' own folding functions over the same
 * inputs, so 'Other' opens exactly the rows the chart folded (Review Focus #3).
 */
export function onRollDrillRowsFrom(
  rows: OnRollDrillSourceRow[],
  categoryByEnroleeNumber: Map<string, string>,
  nationalityByEnroleeNumber: Map<string, string>
): RecordsDrillRow[] {
  const mixNamed = namedNationalities(
    computeEnrolledNationalityMix(
      rows.map((r) => ({ enroleeNumber: r.enrolee_number })),
      nationalityByEnroleeNumber
    ).map((m) => m.nationality)
  );
  const levelNamed = namedNationalities(
    computeNationalityByLevel(
      nationalityByLevelInputs(rows, nationalityByEnroleeNumber)
    ).legend
  );

  const out: RecordsDrillRow[] = [];
  for (const r of rows) {
    const base = onRollBase(r);
    if (!base) continue;
    const en = r.enrolee_number?.trim();
    const canon = canonicaliseNationality(
      (en && nationalityByEnroleeNumber.get(en)) || null
    );
    out.push({
      ...base,
      category: enrolledCategoryBucket(
        r.enrolee_number,
        categoryByEnroleeNumber
      ),
      nationality: canon,
      nationalityMixBucket: nationalityBucket(canon, mixNamed),
      nationalityLevelBucket: nationalityBucket(canon, levelNamed),
    });
  }
  return out;
}

/**
 * The retention cohort as rows: the comparison year's students (one per
 * student number, S4 dropped), each with whether they are on roll now.
 */
export function retentionDrillRowsFrom(
  priorRows: OnRollDrillSourceRow[],
  currentNumbers: ReadonlySet<string>
): RecordsDrillRow[] {
  const data = enrolledStudentDataFrom(priorRows);
  const firstRowBySn = new Map<string, OnRollDrillSourceRow>();
  for (const r of priorRows) {
    const sn = studentOf(r)?.student_number;
    if (sn && !firstRowBySn.has(sn)) firstRowBySn.set(sn, r);
  }
  const out: RecordsDrillRow[] = [];
  for (const m of retentionCohortFrom(data, currentNumbers)) {
    const r = firstRowBySn.get(m.studentNumber);
    const base = r ? onRollBase(r) : null;
    out.push({
      ...(base ?? {
        ...blankRow(),
        enroleeNumber: m.studentNumber,
        studentNumber: m.studentNumber,
        fullName: m.studentNumber,
        enrollmentStatus: '',
        level: 'Unknown',
      }),
      studentNumber: m.studentNumber,
      level: m.level ?? 'Unknown',
      returned: m.returned,
    });
  }
  return out;
}

/**
 * One row per movement event (transfers excluded — they move nobody). Level,
 * reason, term and date are the EVENT's, as the rollup counts them; section
 * and status come from the student's class row this year when there is one
 * (a live row preferred over a withdrawn one).
 */
export function movementDrillRowsFrom(
  events: MovementEvent[],
  roster: RecordsDrillRow[]
): RecordsDrillRow[] {
  const rosterBySn = new Map<string, RecordsDrillRow>();
  for (const r of roster) {
    if (!r.studentNumber) continue;
    const prev = rosterBySn.get(r.studentNumber);
    if (
      !prev ||
      (prev.enrollmentStatus === 'withdrawn' &&
        r.enrollmentStatus !== 'withdrawn')
    ) {
      rosterBySn.set(r.studentNumber, r);
    }
  }
  const out: RecordsDrillRow[] = [];
  for (const e of events) {
    if (e.kind === 'section-transfer') continue;
    const ros = e.studentNumber ? rosterBySn.get(e.studentNumber) : undefined;
    const withdrawn = e.kind === 'withdrawn';
    out.push({
      ...blankRow(),
      enroleeNumber: e.enroleeNumber || e.studentNumber || e.id,
      studentNumber: e.studentNumber,
      fullName: e.studentName,
      enrollmentStatus: ros?.enrollmentStatus ?? '',
      applicationStatus: ros?.applicationStatus ?? '',
      level: movementLevelOf(e),
      sectionId: ros?.sectionId ?? null,
      sectionName: ros?.sectionName ?? null,
      pipelineStage: ros?.pipelineStage ?? '',
      enrollmentDate: ros?.enrollmentDate ?? null,
      withdrawalDate: withdrawn ? e.date : (ros?.withdrawalDate ?? null),
      movementKind: e.kind,
      movementDate: e.date,
      joinedTerm:
        e.kind === 'late-enrolled' && typeof e.termNumber === 'number'
          ? e.termNumber
          : null,
      withdrawalReason: withdrawn ? withdrawalReasonLabelOf(e) : null,
      controllable: withdrawn ? controllabilityOf(e.reason) : null,
    });
  }
  return out;
}

// ── Cached loaders (fetch only) ─────────────────────────────────────────────

async function loadOnRollDrillRowsUncached(
  ayCode: string
): Promise<RecordsDrillRow[]> {
  const service = createServiceClient();
  const ayId = await resolveAyId(service, ayCode);
  if (!ayId) return [];
  const [rows, categoryMap, nationalityMap] = await Promise.all([
    fetchOnRollRows<OnRollDrillSourceRow>(service, ayId, ON_ROLL_DRILL_SELECT),
    fetchEnroleeValueMap(service, ayCode, 'category'),
    fetchEnroleeValueMap(service, ayCode, 'nationality'),
  ]);
  return onRollDrillRowsFrom(rows, categoryMap, nationalityMap);
}

async function loadRetentionDrillRowsUncached(
  currentAy: string,
  priorAy: string
): Promise<RecordsDrillRow[]> {
  const service = createServiceClient();
  const priorAyId = await resolveAyId(service, priorAy);
  if (!priorAyId) return [];
  const [priorRows, current] = await Promise.all([
    fetchOnRollRows<OnRollDrillSourceRow>(
      service,
      priorAyId,
      ON_ROLL_DRILL_SELECT
    ),
    loadEnrolledStudentData(currentAy),
  ]);
  return retentionDrillRowsFrom(priorRows, current.studentNumbers);
}

async function loadMovementDrillRowsUncached(
  ayCode: string
): Promise<RecordsDrillRow[]> {
  const [events, roster] = await Promise.all([
    getMovementEvents(ayCode),
    buildRecordsDrillRows({ ayCode }),
  ]);
  return movementDrillRowsFrom(events, roster);
}

/**
 * The row set behind an Insights target, before its segment is applied
 * (`applyTargetFilter` does that). `compareAy` is required for 'retention'
 * (the cohort is that year's students); every other target ignores it.
 */
export async function buildInsightsDrillRows(
  target: RecordsDrillTarget,
  ayCode: string,
  compareAy: string | null
): Promise<RecordsDrillRow[]> {
  switch (target) {
    case 'enrolled-headcount':
    case 'category':
    case 'nationality':
      return unstable_cache(
        () => loadOnRollDrillRowsUncached(ayCode),
        ['records-drill', 'insights-on-roll', ayCode],
        { revalidate: CACHE_TTL_SECONDS, tags: drillTags(ayCode) }
      )();
    case 'retention':
      if (!compareAy) return [];
      return unstable_cache(
        () => loadRetentionDrillRowsUncached(ayCode, compareAy),
        ['records-drill', 'insights-retention', ayCode, compareAy],
        { revalidate: CACHE_TTL_SECONDS, tags: drillTags(ayCode, compareAy) }
      )();
    case 'late-enrollees':
    case 'withdrawals':
    case 'movement-month':
      return unstable_cache(
        () => loadMovementDrillRowsUncached(ayCode),
        ['records-drill', 'insights-movement', ayCode],
        { revalidate: CACHE_TTL_SECONDS, tags: drillTags(ayCode) }
      )();
    default:
      return [];
  }
}
```

The test also imports `computeEnrolledNationalityMix` and `isTerminalLevel` from `records-insights` — both already exported (the latter via Task 4.1's re-export).

- [ ] **Step 4: Run** — `npx vitest run __tests__/sis/records-insights-drill-parity.test.ts --pool=threads`. Expected: PASS. If any count differs, the builder has drifted from its loader — fix the builder, never the expectation.

- [ ] **Step 5: Commit** — `git add lib/sis/insights-drill-rows.ts __tests__/sis/records-insights-drill-parity.test.ts && git commit -m "feat(records): insights drill rows, pinned to the loaders by parity tests"`

---

### Task 4.5: Route and drill sheet

**Files:**

- Modify: `app/api/records/drill/[target]/route.ts` (lines 1–27 imports + `VALID_TARGETS`; 45–113 `GET`; 144–173 `csvCell`)
- Modify: `lib/query/keys.ts` (lines 10–15 `DrillRange`)
- Modify: `components/sis/drills/records-drill-sheet.tsx` (props lines 44–55; `buildDrillUrl` lines 186–207; `buildColumnDef` switch; `RecordsDrillSheet` lines 460–491 and the CSV href 570–578)
- Test: `__tests__/sis/records-insights-drill-route.test.ts`

**Interfaces:**

- Consumes: `buildInsightsDrillRows` (Task 4.4), `INSIGHTS_DRILL_TARGETS` (Task 4.3).
- Produces: `GET /api/records/drill/<target>?ay=AY2026[&compareAy=AY2025][&segment=…][&format=csv]` — 400 `invalid_compare_ay` for a malformed `compareAy`, 400 `missing_compare_ay` for `retention` without one; response JSON adds `compareAy`. `RecordsDrillSheetProps.compareAy?: string`. `DrillRange.compareAy?: string | null`.

- [ ] **Step 1: Write the failing test** — `__tests__/sis/records-insights-drill-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(async () => ({
    user: { id: 'u1', email: 'registrar@hfse.test' },
    role: 'school_admin',
  })),
}));

const { buildInsightsDrillRows } = vi.hoisted(() => ({
  buildInsightsDrillRows: vi.fn(),
}));
vi.mock('@/lib/sis/insights-drill-rows', () => ({ buildInsightsDrillRows }));

import { GET } from '@/app/api/records/drill/[target]/route';
import type { RecordsDrillRow } from '@/lib/sis/drill';

function row(over: Partial<RecordsDrillRow>): RecordsDrillRow {
  return {
    enroleeNumber: 'E1',
    studentNumber: 'S1',
    fullName: 'Jane Doe',
    enrollmentStatus: 'active',
    applicationStatus: '',
    level: 'Primary One',
    sectionId: 'sec1',
    sectionName: 'P1 Obedience',
    pipelineStage: 'Enrolled',
    applicationDate: null,
    enrollmentDate: null,
    withdrawalDate: null,
    daysSinceUpdate: null,
    hasMissingDocs: false,
    expiringDocsCount: 0,
    documentsComplete: 0,
    documentsTotal: 0,
    ...over,
  };
}

async function get(target: string, query: string): Promise<Response> {
  const res = await GET(
    new Request(`http://localhost/api/records/drill/${target}?${query}`),
    { params: Promise.resolve({ target }) }
  );
  if (!res) throw new Error('no response');
  return res;
}

beforeEach(() => buildInsightsDrillRows.mockReset());

describe('records drill route — insights targets', () => {
  it('asks for the comparison year on retention', async () => {
    const res = await get('retention', 'ay=AY2026');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'missing_compare_ay' });
  });

  it('rejects a malformed comparison year', async () => {
    const res = await get('retention', 'ay=AY2026&compareAy=2025');
    expect(res.status).toBe(400);
  });

  it('builds retention from both years and applies the segment', async () => {
    buildInsightsDrillRows.mockResolvedValue([
      row({ returned: true }),
      row({ returned: false }),
    ]);
    const res = await get(
      'retention',
      `ay=AY2026&compareAy=AY2025&segment=${encodeURIComponent('level:P1|outcome:didNotReturn')}`
    );
    expect(res.status).toBe(200);
    expect(buildInsightsDrillRows).toHaveBeenCalledWith(
      'retention',
      'AY2026',
      'AY2025'
    );
    const json = await res.json();
    expect(json.total).toBe(1);
    expect(json.compareAy).toBe('AY2025');
    expect(json.title).toBe('Primary One · did not come back');
  });

  it('opens the comparison year when the chart asks for it', async () => {
    buildInsightsDrillRows.mockResolvedValue([row({})]);
    await get('enrolled-headcount', 'ay=AY2025&segment=level%3AP1');
    expect(buildInsightsDrillRows).toHaveBeenCalledWith(
      'enrolled-headcount',
      'AY2025',
      null
    );
  });

  it('writes the new columns to the CSV', async () => {
    buildInsightsDrillRows.mockResolvedValue([
      row({
        movementKind: 'withdrawn',
        withdrawalReason: 'Financial / non-payment',
        controllable: 'controllable',
        withdrawalDate: '2026-03-20',
      }),
    ]);
    const res = await get('withdrawals', 'ay=AY2026&format=csv');
    const csv = await res.text();
    expect(csv.split('\n')[0]).toContain('Preventable?');
    expect(csv).toContain('Financial / non-payment');
    expect(csv).toContain('Preventable');
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run __tests__/sis/records-insights-drill-route.test.ts --pool=threads`. Expected: FAIL — `retention` is not a valid target (400 `invalid_target` instead of `missing_compare_ay`).

- [ ] **Step 3: Route.** In `app/api/records/drill/[target]/route.ts`:

  a. Add `INSIGHTS_DRILL_TARGETS,` to the `@/lib/sis/drill` import, and `import { buildInsightsDrillRows } from '@/lib/sis/insights-drill-rows';`.

  b. Append to `VALID_TARGETS`:

  ```ts
    'enrolled-headcount',
    'retention',
    'late-enrollees',
    'withdrawals',
    'movement-month',
    'category',
    'nationality',
  ```

  c. After the `ayCode` check, add:

  ```ts
  const compareAy = url.searchParams.get('compareAy');
  if (compareAy !== null && !/^AY\d{4}$/.test(compareAy)) {
    return NextResponse.json({ error: 'invalid_compare_ay' }, { status: 400 });
  }
  if (target === 'retention' && !compareAy) {
    return NextResponse.json({ error: 'missing_compare_ay' }, { status: 400 });
  }
  ```

  d. Replace

  ```ts
  const all = await buildRecordsDrillRows(
    { ayCode, from, to },
    {
      withDocs: DOC_TARGETS.has(target),
      withDocSlotBuckets: target === 'backlog-by-document',
    }
  );
  const rangeForFilter = from && to ? { from, to } : undefined;
  let rows = applyTargetFilter(all, target, segment, rangeForFilter);
  ```

  with

  ```ts
  const rangeForFilter = from && to ? { from, to } : undefined;
  // Insights targets read their loader's own population (KD #229); every
  // dashboard target keeps the shared class-row set.
  const all = INSIGHTS_DRILL_TARGETS.has(target)
    ? await buildInsightsDrillRows(target, ayCode, compareAy)
    : await buildRecordsDrillRows(
        { ayCode, from, to },
        {
          withDocs: DOC_TARGETS.has(target),
          withDocSlotBuckets: target === 'backlog-by-document',
        }
      );
  let rows = applyTargetFilter(all, target, segment, rangeForFilter);
  ```

  e. Add `compareAy,` after `ayCode,` in the JSON body.

  f. Add to `csvCell` before its closing brace:

  ```ts
      case 'withdrawalReason':
        return row.withdrawalReason ?? '';
      case 'controllable':
        return row.controllable ? CONTROLLABLE_WORDS[row.controllable] : '';
      case 'category':
        return row.category ?? '';
      case 'nationality':
        return row.nationality ?? '';
      case 'returned':
        return row.returned === true ? 'Yes' : row.returned === false ? 'No' : '';
      case 'joinedTerm':
        return row.joinedTerm ? `Term ${row.joinedTerm}` : '';
      case 'movementDate':
        return row.movementDate?.slice(0, 10) ?? '';
  ```

  and above `csvCell`:

  ```ts
  const CONTROLLABLE_WORDS = {
    controllable: 'Preventable',
    structural: 'Structural',
    unspecified: 'Not recorded',
  } as const;
  ```

- [ ] **Step 4: Query key.** In `lib/query/keys.ts` add `compareAy?: string | null;` to `DrillRange` after `segment`.

- [ ] **Step 5: Sheet.** In `components/sis/drills/records-drill-sheet.tsx`:

  a. Props — add after `ayCode: string;`:

  ```ts
    /** Retention only: the comparison year whose students the list holds. */
    compareAy?: string;
  ```

  b. `buildDrillUrl` — add a `compareAy: string | undefined` parameter after `to`, and `if (compareAy) params.set('compareAy', compareAy);` after the `to` line. Pass `compareAy` at both call sites (the `queryFn` and the `csvHref`), and add `compareAy: compareAy ?? null,` to the `queryKeys.sisRecordsDrill` range object. Destructure `compareAy` in `RecordsDrillSheet`'s parameters.

  c. Add two cell components under `DocsCell`:

  ```tsx
  function ControllableBadge({
    value,
  }: {
    value: RecordsDrillRow['controllable'];
  }) {
    if (value === 'controllable')
      return <Badge variant="blocked">Preventable</Badge>;
    if (value === 'structural')
      return <Badge variant="secondary">Structural</Badge>;
    return <Badge variant="secondary">Not recorded</Badge>;
  }

  function ReturnedBadge({
    returned,
  }: {
    returned: boolean | null | undefined;
  }) {
    if (returned === true) return <Badge variant="success">Came back</Badge>;
    if (returned === false)
      return <Badge variant="secondary">Did not come back</Badge>;
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  ```

  d. Add these cases to `buildColumnDef`'s switch, before `default:`:

  ```tsx
      case 'withdrawalReason':
        return {
          id: 'withdrawalReason',
          accessorKey: 'withdrawalReason',
          header,
          cell: ({ row }) => (
            <span className="text-sm text-muted-foreground">
              {row.original.withdrawalReason ?? '—'}
            </span>
          ),
          enableSorting: true,
        };
      case 'controllable':
        return {
          id: 'controllable',
          accessorKey: 'controllable',
          header,
          cell: ({ row }) => (
            <ControllableBadge value={row.original.controllable} />
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
              {row.original.nationality ?? 'Not recorded'}
            </span>
          ),
          enableSorting: true,
        };
      case 'returned':
        return {
          id: 'returned',
          accessorKey: 'returned',
          header,
          cell: ({ row }) => <ReturnedBadge returned={row.original.returned} />,
          enableSorting: true,
        };
      case 'joinedTerm':
        return {
          id: 'joinedTerm',
          accessorKey: 'joinedTerm',
          header,
          cell: ({ row }) => (
            <span className="text-sm tabular-nums text-muted-foreground">
              {row.original.joinedTerm ? `Term ${row.original.joinedTerm}` : '—'}
            </span>
          ),
          enableSorting: true,
        };
      case 'movementDate':
        return {
          id: 'movementDate',
          accessorKey: 'movementDate',
          header,
          cell: ({ row }) => (
            <span className="text-sm tabular-nums text-muted-foreground">
              {formatDate(row.original.movementDate ?? null)}
            </span>
          ),
          enableSorting: true,
        };
  ```

- [ ] **Step 6: Run** — `npx vitest run __tests__/sis/records-insights-drill-route.test.ts __tests__/ui/data-table-column-label-coverage.test.ts --pool=threads`. Expected: PASS.

- [ ] **Step 7: Commit** — `git add "app/api/records/drill/[target]/route.ts" lib/query/keys.ts components/sis/drills/records-drill-sheet.tsx __tests__/sis/records-insights-drill-route.test.ts && git commit -m "feat(records): drill route + sheet serve the insights targets"`

---

### Task 4.6: Client wrappers

**Files:**

- Create: `components/sis/drills/insights-drill-cards.tsx`
- Test: `__tests__/sis/records-insights-drill-cards.test.tsx`

**Interfaces:**

- Consumes: `RecordsDrillSheet` (Task 4.5), `encodeInsightsSegment`, `pickSeriesAy`, `termSegmentFromLabel` (Task 4.1), Phase 1's `onSegmentClick` on each chart.
- Produces (all `'use client'`, props are plain data so an RSC can render them):
  - `PopulationByLevelDrillCard(props: ChartProps<ComposedBarLineChart> & { selectedAy: string; compareAy: string })` → `enrolled-headcount`, `level:<code>`; `'line'` opens `compareAy`
  - `CategoryMixDrillCard(props: ChartProps<GroupedBarChart> & { selectedAy: string; compareAy: string })` → `category`; series `'compare'` opens `compareAy`
  - `NationalityMixDrillCard(props: ChartProps<NationalityMixPie> & { ayCode: string })` → `nationality`
  - `NationalityByLevelDrillCard(props: ChartProps<NationalityByLevelBars> & { ayCode: string })` → `nationality`, `level:<label>|nationality:<name>`
  - `MovementDrillCard(props: ChartProps<GroupedBarChart> & { ayCode: string })` → `movement-month`, `flow:<series>|month:<x>`
  - `RetentionByLevelDrillCard(props: ChartProps<RetentionStackedBarChart> & { ayCode: string; compareAy: string })` → `retention`, `level:<code>|outcome:<returned|didNotReturn>`
  - `LateByLevelDrillCard(props: ChartProps<DonutChart> & { ayCode: string })` → `late-enrollees`, `level:<label>`
  - `LateByTermDrillCard(props: ChartProps<ComparisonBarChart> & { ayCode: string })` → `late-enrollees`, `term:<n>`
  - `WithdrawalReasonsDrillCard(props: ChartProps<DonutChart> & { ayCode: string })` → `withdrawals`, `reason:<label>`
  - `AttritionDrillCard(props: ChartProps<AttritionStackedBarChart> & { ayCode: string })` → `withdrawals`, `level:<label>|reason:<label>`
  - `RecordsSeeAllButton({ target, segment?, ayCode, compareAy?, label?, className? })` — ghost button opening the sheet
  - where `type ChartProps<C> = Omit<React.ComponentProps<C>, 'onSegmentClick'>`

Design: no new visuals. Segments get the pointer + existing hover the Phase 1 charts give them; the only new element is a `ghost` `sm` "See all" button with the same `ChevronsRight` the MetricCard "Details" footer uses. Tokens only.

- [ ] **Step 1: Write the failing test** — `__tests__/sis/records-insights-drill-cards.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/sis/drills/records-drill-sheet', () => ({
  RecordsDrillSheet: (p: {
    target: string;
    segment?: string | null;
    ayCode: string;
    compareAy?: string;
  }) => (
    <div
      data-testid="drill"
      data-target={p.target}
      data-segment={p.segment ?? ''}
      data-ay={p.ayCode}
      data-compare={p.compareAy ?? ''}
    />
  ),
}));
vi.mock('@/components/dashboard/charts/composed-bar-line-chart', () => ({
  ComposedBarLineChart: (p: {
    onSegmentClick?: (c: string, s?: string) => void;
  }) => (
    <>
      <button onClick={() => p.onSegmentClick?.('P1', 'bar')}>bar P1</button>
      <button onClick={() => p.onSegmentClick?.('P1', 'line')}>line P1</button>
    </>
  ),
}));
vi.mock('@/components/dashboard/charts/retention-stacked-bar-chart', () => ({
  RetentionStackedBarChart: (p: {
    onSegmentClick?: (c: string, s?: string) => void;
  }) => (
    <button onClick={() => p.onSegmentClick?.('P2', 'didNotReturn')}>
      left P2
    </button>
  ),
}));
vi.mock('@/components/dashboard/charts/comparison-bar-chart', () => ({
  ComparisonBarChart: (p: { onSegmentClick?: (c: string) => void }) => (
    <button onClick={() => p.onSegmentClick?.('Term 3')}>Term 3</button>
  ),
}));

import {
  LateByTermDrillCard,
  PopulationByLevelDrillCard,
  RecordsSeeAllButton,
  RetentionByLevelDrillCard,
} from '@/components/sis/drills/insights-drill-cards';

const drill = () => screen.getByTestId('drill');

describe('insights drill cards', () => {
  it('a this-year bar opens this year', () => {
    render(
      <PopulationByLevelDrillCard
        data={[]}
        barLabel="AY2026"
        lineLabel="AY2025"
        selectedAy="AY2026"
        compareAy="AY2025"
      />
    );
    fireEvent.click(screen.getByText('bar P1'));
    expect(drill().dataset).toMatchObject({
      target: 'enrolled-headcount',
      segment: 'level:P1',
      ay: 'AY2026',
    });
  });

  it('the comparison line opens the comparison year', () => {
    render(
      <PopulationByLevelDrillCard
        data={[]}
        barLabel="AY2026"
        lineLabel="AY2025"
        selectedAy="AY2026"
        compareAy="AY2025"
      />
    );
    fireEvent.click(screen.getByText('line P1'));
    expect(drill().dataset.ay).toBe('AY2025');
  });

  it('retention carries both years and the outcome', () => {
    render(
      <RetentionByLevelDrillCard data={[]} ayCode="AY2026" compareAy="AY2025" />
    );
    fireEvent.click(screen.getByText('left P2'));
    expect(drill().dataset).toMatchObject({
      target: 'retention',
      segment: 'level:P2|outcome:didNotReturn',
      ay: 'AY2026',
      compare: 'AY2025',
    });
  });

  it('late by term sends the term number', () => {
    render(<LateByTermDrillCard data={[]} ayCode="AY2026" />);
    fireEvent.click(screen.getByText('Term 3'));
    expect(drill().dataset).toMatchObject({
      target: 'late-enrollees',
      segment: 'term:3',
    });
  });

  it('See all opens the whole list only when pressed', () => {
    render(<RecordsSeeAllButton target="withdrawals" ayCode="AY2026" />);
    expect(screen.queryByTestId('drill')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /see all/i }));
    expect(drill().dataset).toMatchObject({
      target: 'withdrawals',
      segment: '',
    });
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run __tests__/sis/records-insights-drill-cards.test.tsx --pool=threads`. Expected: FAIL, `Failed to resolve import "@/components/sis/drills/insights-drill-cards"`.

- [ ] **Step 3: Create `components/sis/drills/insights-drill-cards.tsx`:**

```tsx
'use client';

import * as React from 'react';
import { ChevronsRight } from 'lucide-react';

import { AttritionStackedBarChart } from '@/components/dashboard/charts/attrition-stacked-bar-chart';
import { ComparisonBarChart } from '@/components/dashboard/charts/comparison-bar-chart';
import { ComposedBarLineChart } from '@/components/dashboard/charts/composed-bar-line-chart';
import { DonutChart } from '@/components/dashboard/charts/donut-chart';
import { GroupedBarChart } from '@/components/dashboard/charts/grouped-bar-chart';
import { RetentionStackedBarChart } from '@/components/dashboard/charts/retention-stacked-bar-chart';
import { NationalityByLevelBars } from '@/components/dashboard/insights/nationality-by-level-bars';
import { NationalityMixPie } from '@/components/dashboard/insights/nationality-mix-pie';
import { RecordsDrillSheet } from '@/components/sis/drills/records-drill-sheet';
import { Button } from '@/components/ui/button';
import { Sheet, SheetTrigger } from '@/components/ui/sheet';
import type { RecordsDrillTarget } from '@/lib/sis/drill';
import {
  encodeInsightsSegment,
  pickSeriesAy,
  termSegmentFromLabel,
} from '@/lib/sis/insights-shared';

// Records · Insights drill wrappers (KD #229). The page is a Server Component
// and cannot hand a click handler to a client chart, so each clickable chart
// is wrapped here: the wrapper owns the open drill and turns the chart's
// (category, series) into a target + segment + year. Same pattern as
// chart-drill-cards.tsx; the sheet only mounts once something is clicked, so
// no list is fetched until it is asked for.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChartProps<C extends React.JSXElementConstructor<any>> = Omit<
  React.ComponentProps<C>,
  'onSegmentClick'
>;

type OpenDrill = {
  target: RecordsDrillTarget;
  segment: string | null;
  ayCode: string;
  compareAy?: string;
};

function DrillHost({
  drill,
  onClose,
  children,
}: {
  drill: OpenDrill | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Sheet
      open={drill !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {children}
      {drill && (
        <RecordsDrillSheet
          target={drill.target}
          segment={drill.segment}
          ayCode={drill.ayCode}
          compareAy={drill.compareAy}
        />
      )}
    </Sheet>
  );
}

function useDrill() {
  const [drill, setDrill] = React.useState<OpenDrill | null>(null);
  return { drill, open: setDrill, close: () => setDrill(null) };
}

// ─── Population & growth ────────────────────────────────────────────────────

export function PopulationByLevelDrillCard({
  selectedAy,
  compareAy,
  ...chart
}: ChartProps<typeof ComposedBarLineChart> & {
  selectedAy: string;
  compareAy: string;
}) {
  const { drill, open, close } = useDrill();
  return (
    <DrillHost drill={drill} onClose={close}>
      <ComposedBarLineChart
        {...chart}
        onSegmentClick={(level, series) =>
          open({
            target: 'enrolled-headcount',
            segment: encodeInsightsSegment({ level }),
            ayCode: pickSeriesAy(series, 'line', selectedAy, compareAy),
          })
        }
      />
    </DrillHost>
  );
}

export function CategoryMixDrillCard({
  selectedAy,
  compareAy,
  ...chart
}: ChartProps<typeof GroupedBarChart> & {
  selectedAy: string;
  compareAy: string;
}) {
  const { drill, open, close } = useDrill();
  return (
    <DrillHost drill={drill} onClose={close}>
      <GroupedBarChart
        {...chart}
        onSegmentClick={(category, series) =>
          open({
            target: 'category',
            segment: encodeInsightsSegment({ category }),
            ayCode: pickSeriesAy(series, 'compare', selectedAy, compareAy),
          })
        }
      />
    </DrillHost>
  );
}

export function NationalityMixDrillCard({
  ayCode,
  ...chart
}: ChartProps<typeof NationalityMixPie> & { ayCode: string }) {
  const { drill, open, close } = useDrill();
  return (
    <DrillHost drill={drill} onClose={close}>
      <NationalityMixPie
        {...chart}
        onSegmentClick={(nationality) =>
          open({
            target: 'nationality',
            segment: encodeInsightsSegment({ nationality }),
            ayCode,
          })
        }
      />
    </DrillHost>
  );
}

export function NationalityByLevelDrillCard({
  ayCode,
  ...chart
}: ChartProps<typeof NationalityByLevelBars> & { ayCode: string }) {
  const { drill, open, close } = useDrill();
  return (
    <DrillHost drill={drill} onClose={close}>
      <NationalityByLevelBars
        {...chart}
        onSegmentClick={(level, nationality) =>
          open({
            target: 'nationality',
            segment: encodeInsightsSegment({ level, nationality }),
            ayCode,
          })
        }
      />
    </DrillHost>
  );
}

export function MovementDrillCard({
  ayCode,
  ...chart
}: ChartProps<typeof GroupedBarChart> & { ayCode: string }) {
  const { drill, open, close } = useDrill();
  return (
    <DrillHost drill={drill} onClose={close}>
      <GroupedBarChart
        {...chart}
        onSegmentClick={(month, flow) => {
          if (!flow) return;
          open({
            target: 'movement-month',
            segment: encodeInsightsSegment({ flow, month }),
            ayCode,
          });
        }}
      />
    </DrillHost>
  );
}

// ─── Retention ──────────────────────────────────────────────────────────────

export function RetentionByLevelDrillCard({
  ayCode,
  compareAy,
  ...chart
}: ChartProps<typeof RetentionStackedBarChart> & {
  ayCode: string;
  compareAy: string;
}) {
  const { drill, open, close } = useDrill();
  return (
    <DrillHost drill={drill} onClose={close}>
      <RetentionStackedBarChart
        {...chart}
        onSegmentClick={(level, outcome) =>
          open({
            target: 'retention',
            segment: encodeInsightsSegment({ level, outcome }),
            ayCode,
            compareAy,
          })
        }
      />
    </DrillHost>
  );
}

// ─── Attrition ──────────────────────────────────────────────────────────────

export function LateByLevelDrillCard({
  ayCode,
  ...chart
}: ChartProps<typeof DonutChart> & { ayCode: string }) {
  const { drill, open, close } = useDrill();
  return (
    <DrillHost drill={drill} onClose={close}>
      <DonutChart
        {...chart}
        onSegmentClick={(level) =>
          open({
            target: 'late-enrollees',
            segment: encodeInsightsSegment({ level }),
            ayCode,
          })
        }
      />
    </DrillHost>
  );
}

export function LateByTermDrillCard({
  ayCode,
  ...chart
}: ChartProps<typeof ComparisonBarChart> & { ayCode: string }) {
  const { drill, open, close } = useDrill();
  return (
    <DrillHost drill={drill} onClose={close}>
      <ComparisonBarChart
        {...chart}
        onSegmentClick={(termLabel) => {
          const segment = termSegmentFromLabel(termLabel);
          if (segment) open({ target: 'late-enrollees', segment, ayCode });
        }}
      />
    </DrillHost>
  );
}

export function WithdrawalReasonsDrillCard({
  ayCode,
  ...chart
}: ChartProps<typeof DonutChart> & { ayCode: string }) {
  const { drill, open, close } = useDrill();
  return (
    <DrillHost drill={drill} onClose={close}>
      <DonutChart
        {...chart}
        onSegmentClick={(reason) =>
          open({
            target: 'withdrawals',
            segment: encodeInsightsSegment({ reason }),
            ayCode,
          })
        }
      />
    </DrillHost>
  );
}

export function AttritionDrillCard({
  ayCode,
  ...chart
}: ChartProps<typeof AttritionStackedBarChart> & { ayCode: string }) {
  const { drill, open, close } = useDrill();
  return (
    <DrillHost drill={drill} onClose={close}>
      <AttritionStackedBarChart
        {...chart}
        onSegmentClick={(level, reason) =>
          open({
            target: 'withdrawals',
            segment: encodeInsightsSegment({ level, reason }),
            ayCode,
          })
        }
      />
    </DrillHost>
  );
}

// ─── "See all" for list blocks ──────────────────────────────────────────────

export function RecordsSeeAllButton({
  target,
  segment = null,
  ayCode,
  compareAy,
  label = 'See all',
  className,
}: {
  target: RecordsDrillTarget;
  segment?: string | null;
  ayCode: string;
  compareAy?: string;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className={className}>
          {label}
          <ChevronsRight className="size-3.5" />
        </Button>
      </SheetTrigger>
      {open && (
        <RecordsDrillSheet
          target={target}
          segment={segment}
          ayCode={ayCode}
          compareAy={compareAy}
        />
      )}
    </Sheet>
  );
}
```

- [ ] **Step 4: Run** — `npx vitest run __tests__/sis/records-insights-drill-cards.test.tsx --pool=threads`. Expected: PASS.

- [ ] **Step 5: Commit** — `git add components/sis/drills/insights-drill-cards.tsx __tests__/sis/records-insights-drill-cards.test.tsx && git commit -m "feat(records): clickable insights charts and See all buttons"`

---

### Task 4.7: Wire the page

**Files:**

- Modify: `app/(records)/records/insights/page.tsx` (imports; `InsightChartCard` 156–193; KPIs 627–664; charts 680–686, 699–704, 721–726, 739–742, 758–763, 803, 860–866, 877–882, 899–937, 947–954, 970–974, 1023–1026). Line numbers are pre-Task-4.1; Task 4.1 removed 9 lines above them — find each block by its JSX.

**Interfaces:**

- Consumes: Task 4.6 wrappers, `RecordsDrillSheet` (Task 4.5).
- Produces: every block on `/records/insights` drills; no layout change.

- [ ] **Step 1: Imports.** Add

```ts
import {
  AttritionDrillCard,
  CategoryMixDrillCard,
  LateByLevelDrillCard,
  LateByTermDrillCard,
  MovementDrillCard,
  NationalityByLevelDrillCard,
  NationalityMixDrillCard,
  PopulationByLevelDrillCard,
  RecordsSeeAllButton,
  RetentionByLevelDrillCard,
  WithdrawalReasonsDrillCard,
} from '@/components/sis/drills/insights-drill-cards';
import { RecordsDrillSheet } from '@/components/sis/drills/records-drill-sheet';
```

and remove the now-unused direct imports of `AttritionStackedBarChart`, `ComparisonBarChart` (keep `type ComparisonBarPoint`), `ComposedBarLineChart` (keep `type ComposedBarLinePoint`), `DonutChart` (keep `type DonutSlice`), `GroupedBarChart` (keep `type GroupedBarSeries`), `RetentionStackedBarChart` (keep `type RetentionStackRow`), `NationalityByLevelBars`, `NationalityMixPie`.

- [ ] **Step 2: `InsightChartCard` takes a header action.** Add `action?: ReactNode;` to its props (destructure `action`), and replace its `<CardAction>…</CardAction>` with:

```tsx
<CardAction>
  <div className="flex items-center gap-2">
    {action}
    <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
      <Icon className="size-4" />
    </div>
  </div>
</CardAction>
```

- [ ] **Step 3: KPIs.** Add to the three `MetricCard`s:

  Enrolled —

```tsx
            drillSheet={() => (
              <RecordsDrillSheet target="enrolled-headcount" ayCode={selectedAy} />
            )}
```

Retention rate (a rate opens its denominator — the comparison year's students, with "Came back?") —

```tsx
            drillSheet={
              retentionState === 'ok' && compareAy
                ? () => (
                    <RecordsDrillSheet
                      target="retention"
                      ayCode={selectedAy}
                      compareAy={compareAy}
                    />
                  )
                : undefined
            }
```

Late enrollees —

```tsx
            drillSheet={() => (
              <RecordsDrillSheet target="late-enrollees" ayCode={selectedAy} />
            )}
```

- [ ] **Step 4: Charts → wrappers.** Replace each chart element, keeping every existing prop:

```tsx
<PopulationByLevelDrillCard
  data={populationComposedData}
  barLabel={selectedAy}
  lineLabel={compareAy}
  yFormat="number"
  height={300}
  selectedAy={selectedAy}
  compareAy={compareAy}
/>
```

```tsx
<CategoryMixDrillCard
  series={categoryMixSeries}
  data={categoryMixData}
  yFormat="number"
  height={260}
  selectedAy={selectedAy}
  compareAy={compareAy}
/>
```

```tsx
<NationalityMixDrillCard
  rows={nationalityMix}
  compareRows={priorNationalityMix}
  compareLabel={compareAy}
  unitLabel="enrolled students"
  ayCode={selectedAy}
/>
```

```tsx
<NationalityByLevelDrillCard
  data={nationalityByLevel}
  unitLabel="enrolled students"
  ayCode={selectedAy}
/>
```

```tsx
<MovementDrillCard
  series={MOVEMENT_SERIES}
  data={movementBarData}
  yFormat="number"
  height={260}
  ayCode={selectedAy}
/>
```

```tsx
<RetentionByLevelDrillCard
  data={retentionStackData}
  ayCode={selectedAy}
  compareAy={compareAy!}
/>
```

(`compareAy` is non-null inside this branch — `retentionState === 'ok'` requires it — so the `!` states a fact the narrowing cannot see.)

```tsx
<LateByLevelDrillCard
  data={lateLevelDonutData}
  centerValue={rollup.counts.lateEnrolled.toLocaleString('en-SG')}
  centerLabel="Late"
  ayCode={selectedAy}
/>
```

```tsx
<LateByTermDrillCard
  data={lateTermBarData}
  orientation="horizontal"
  yFormat="number"
  height={200}
  ayCode={selectedAy}
/>
```

```tsx
<WithdrawalReasonsDrillCard
  data={reasonDonutData}
  colors={reasonDonutColors}
  centerValue={rollup.counts.withdrawn.toLocaleString('en-SG')}
  centerLabel="Withdrawn"
  ayCode={selectedAy}
/>
```

```tsx
<AttritionDrillCard
  data={attritionStackedData}
  reasonKeys={rollup.withdrawalReasonKeys}
  ayCode={selectedAy}
/>
```

- [ ] **Step 5: List blocks get "See all".**

  The "By level" withdrawals card — add `action={<RecordsSeeAllButton target="withdrawals" ayCode={selectedAy} />}` to its `InsightChartCard` (cap `"Where withdrawals concentrate"`).

  The controllability banner is a share of all withdrawals, so its list is the denominator with "Preventable?" as a column. Inside the banner `div`, after the `<div className="flex-1 space-y-1 text-sm">…</div>`, add:

```tsx
<RecordsSeeAllButton
  target="withdrawals"
  ayCode={selectedAy}
  className="shrink-0 self-start"
/>
```

- [ ] **Step 6: Run** — `npx tsc --noEmit`. Expected: no errors.

- [ ] **Step 7: Commit** — `git add "app/(records)/records/insights/page.tsx" && git commit -m "feat(records): every insights number opens the students behind it"`

---

### Task 4.8: Phase gate

- [ ] **Step 1:** `npx tsc --noEmit` — expected: clean.
- [ ] **Step 2:** `npx vitest run __tests__/sis --pool=threads` — expected: all pass. Re-run any failure on its own before calling it a regression (threads pool, shared machine).
- [ ] **Step 3:** `npx vitest run __tests__/ui/data-table-column-label-coverage.test.ts --pool=threads` — expected: pass.
- [ ] **Step 4:** `npx prettier --check lib/sis/insights-shared.ts lib/sis/insights-drill-rows.ts lib/sis/records-insights.ts lib/sis/drill.ts lib/query/keys.ts "app/api/records/drill/[target]/route.ts" components/sis/drills/records-drill-sheet.tsx components/sis/drills/insights-drill-cards.tsx "app/(records)/records/insights/page.tsx" __tests__/sis/insights-shared.test.ts __tests__/sis/records-insights-loaders.test.ts __tests__/sis/records-insights-drill-filter.test.ts __tests__/sis/records-insights-drill-parity.test.ts __tests__/sis/records-insights-drill-route.test.ts __tests__/sis/records-insights-drill-cards.test.tsx` — if it lists files, run `--write` on them and commit `git add <those files> && git commit -m "style(records): format insights drill files"`.
- [ ] **Step 5: Open the page (Review Focus #5).** Restart `next dev` (new route targets and files), sign in as a school_admin, open `/records/insights?ay=AY2026&compareAy=AY2025`, and check the dev terminal stays free of "Functions cannot be passed to Client Components". Then click each block and compare the sheet's count with the number clicked:
  - Enrolled KPI = its value; Retention rate KPI = "`N` of `M` students returned" → `M` rows, "Came back?" column; Late enrollees KPI = its value.
  - Distribution: a bar (this year) and the line point (AY2025) of the same level — two different lists, each matching its own value.
  - New vs. returning: an AY2026 bar and an AY2025 bar.
  - Nationalities on roll: a named slice and **Other**; nationality × level: a named segment and an **Other** segment.
  - Who moves in and out: an Enrollments bar and a Withdrawals bar of the same month.
  - Retention by level: the returned and the did-not-return part of one level.
  - Late by level slice (a label); By term bar.
  - Withdrawal reason slice, **Unspecified** included; the banner's See all = the banner's total with "Preventable?" = its preventable count; By level See all = "Total withdrawals this AY"; one attrition cell.
  - A block for a year with nothing recorded (e.g. `?ay=AY2025` without a comparison) renders its empty state, and any sheet opened on an empty segment shows "No rows to show for this filter." rather than an error.
- [ ] **Step 6: Reviewer pass** against the index's Review Focus 1–5 before Phase 5 starts.

## Findings that change the spec

1. **Movement bars need their own target.** Both `enrollments-range` and `withdrawals-range` count something else (roster rows by application date; leavers per student by `withdrawal_date`) than the monthly bars (audit-log events by event date). Added `movement-month`; the dashboard targets are untouched.
2. **Late / withdrawal lists are events, not students.** A student withdrawn twice (or late-tagged, then withdrawn) appears once per event, because that is what the numbers count.
3. **The controllability banner opens all withdrawals, not a `controllable` segment.** It states a share ("X% preventable, n of total"), so the Global Constraint "rates open the denominator" applies; the "Preventable?" column is the numerator. The spec table said `segment controllable`.
4. **Retention needs a second year on the request.** New `compareAy` query parameter (route 400s without it for `retention`), `RecordsDrillSheet.compareAy`, `DrillRange.compareAy`.
5. **Segments are keyed** (`level:P1|outcome:didNotReturn`), not the spec's bare `level|returned`, so a level segment can never be misread as a reason or a nationality. Retention's outcome is `didNotReturn` (Phase 1's real dataKey), not `notReturned`.
6. **`RecordsDrillRow` needs six more fields than the four the spec names** — `returned`, `joinedTerm`, `movementKind`, `movementDate`, `nationalityMixBucket`, `nationalityLevelBucket` — all optional.
7. **The withdrawal reason comes from the audit event**, not `section_students.withdrawal_reason`; the two can differ after an edit, and only the event matches the chart.
8. **Enrolled headcount includes graduated rows** and counts rows (a student with two live rows counts twice), so it cannot reuse `active-enrolled`.
