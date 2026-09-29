# Phase 5 — Markbook Insights drills

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (or superpowers:executing-plans). Steps use `- [ ]`. Index + Global Constraints + Review Focus: `docs/superpowers/plans/2026-09-29-insights-drill-sheets.md` — they bind every task here.

**Goal:** Every block on `/markbook/insights` opens the grade entries, sheets or change requests behind it. A count equals the rows listed. An average equals the same average computed, with the same helper, from the rows listed.

**Depends on:** Phase 1. `GroupedBarChart.onSegmentClick` reports `(row.x, series.key)`. `CategoryLineChart` reports `(x)` from its active dot. `ComparisonBarChart` reports `(category)`. All three use the type `SegmentClickHandler = (category: string, series?: string) => void` from `components/dashboard/charts/chart-primitives.ts`. A bar worth 0 draws nothing, so nothing can be clicked there.

**Architecture:** Task 5.1 adds a pure, client-safe module, `lib/markbook/insights-drill.ts`, holding every rule an Insights figure and its drill must share: which entries count, which term the grade histogram reads, the change-request window and "decided" rule, the lock tally, the level average, and the segment grammar. Task 5.2 makes the loaders use those rules and read every row. Today three of them stop at PostgREST's 1,000-row cap. Tasks 5.3–5.8 add one drill target or segment each, and each is pinned by an end-to-end parity test. The test runs the real Insights loader and the real drill builder against one fake database. Tasks 5.9–5.11 add the sheet's summary line, the client wrappers and the page wiring.

## Findings that change the spec (read before building)

1. **The subject averages are keyed by `subjects.name`, the catalogue name.** They are not keyed by code, and not by the per-year display name the drill rows show (STAR/MAPEH, migration 137). `compare.ts` groups by `subject.name`. So the segments carry the catalogue name, not `subjectCode`, and `GradeEntryRow` gains `subjectCatalogName`.
2. **The level line is not a mean of entries.** Each level point is the unweighted mean of that level's per-subject averages, and each subject average is rounded to 1 dp first (page lines 333–349). The spec's "mean(computedGrade of listed rows) == plotted value" is false whenever the subjects have different entry counts. Parity is therefore defined as: the extracted `levelAveragesForPeriod` helper, run over the listed rows, equals the plotted value. The sheet says in words how the figure is made.
3. **No Markbook chart plots the comparison year.** `buildMultiAyTrend(…, [selectedAy])` plots only the selected year. Comparison-year trend points are loaded and then thrown away. The only comparison element is the hero badge (a percentage-point delta). How this plan covers it:
   - The trend wrapper reads the year from the series key (`"Mathematics · AY2025"`), so a comparison series would open its own year.
   - The parity tests click AY2025.
   - The badge's sheet has a "Show AY2025 instead" button.
4. **The top-band % covers one term, not the whole year.** `getGradeDistribution` picks one term: `is_current`, else the term containing today, else the last finished term, else the last term. That term's number goes into the segment (`top|T2`). `from`/`to` stay omitted.
5. **Three loaders silently undercount today (fixed in Task 5.2, which changes production numbers):**
   - `getSheetLockProgressByTerm` reads **all** `grading_sheets` across every year in one unpaginated request. One year alone has about 1,116 sheets, so the "Sheets locked" bars count an arbitrary subset.
   - Both sheet reads in `compare.ts` are unpaginated. With a comparison year selected, they can pass 1,000 rows and drop sheets from the averages.
   - The drill's change-request loader reads its sheets unpaginated.
6. **The drill's entry loader drops rows the Insights figures count.** `loadEntryRowsUncached` keeps an entry only if some raw score is filled (`hasAnyGrade`). The histogram and the averages count every non-N.A. entry with a `quarterly_grade`, including one imported with a grade but no scores. The new targets and the `top` segment use a `score-or-grade` keep rule. Every other target keeps today's rule.
7. **"Avg decision time" drops decisions whose `reviewed_at` is earlier than `requested_at`.** The dashboard's `decided` segment keeps them. The new windowed segment (`30d:decided`) uses the summary's rule, and the dashboard's `decided` is untouched.
8. **The drill sheet virtualizes rows; it does not paginate them.** Each entry drill makes the server load the whole year's entries (~28K rows), the same as the existing `grade-entries` drill. The list it returns is one subject × term, a few hundred rows.
9. **A 0% bar (a term with every sheet open) draws no bar, so it cannot be clicked** (Phase 1). That term's open sheets stay reachable from the Markbook dashboard's sheet-progress drill.
10. **Scoping.** The Insights page admits academic_coordinator / school_admin / superadmin only. The drill route still admits teachers, row-scoped to their sections. Nothing in the route's scoping changes.
11. **Withdrawn students.** Neither the loaders nor the drill filter on `enrollment_status`. The drills match that on purpose, and the fixture holds a withdrawn student to pin it.

## File map

| File                                                                                                                                                                                     | Change                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `lib/markbook/insights-drill.ts`                                                                                                                                                         | **new**: pure shared rules + segment grammar + sheet summary line                                         |
| `lib/markbook/dashboard.ts`                                                                                                                                                              | distribution term + entry rule shared; lock tally paginated; change-request window + decision rule shared |
| `lib/markbook/compare.ts`                                                                                                                                                                | entry rule shared; both sheet reads paginated                                                             |
| `lib/markbook/drill.ts`                                                                                                                                                                  | 3 targets, keep rule, `subjectCatalogName`, change-request sheet read paginated, headers/columns          |
| `lib/markbook/drill-filter.ts`                                                                                                                                                           | `top` segment, 3 target filters, windowed change-request segments                                         |
| `app/api/markbook/drill/[target]/route.ts`                                                                                                                                               | 3 targets in `VALID_TARGETS`                                                                              |
| `components/markbook/drills/markbook-drill-sheet.tsx`                                                                                                                                    | `description` + `showInsightsSummary` props                                                               |
| `components/dashboard/dashboard-hero.tsx`                                                                                                                                                | export `heroBadgeClassName` (no visual change)                                                            |
| `components/markbook/drills/insights-drill-cards.tsx`                                                                                                                                    | **new**: 6 client wrappers                                                                                |
| `app/(markbook)/markbook/insights/page.tsx`                                                                                                                                              | wiring                                                                                                    |
| `__tests__/markbook/_support/fake-service.ts`                                                                                                                                            | **new**: filtering PostgREST fake with the 1,000-row cap                                                  |
| `__tests__/markbook/_support/insights-fixture.ts`                                                                                                                                        | **new**: two-year fixture                                                                                 |
| `__tests__/markbook/insights-drill.test.ts` · `insights-loaders-read-all.test.ts` · `insights-drill-parity.test.ts` · `insights-drill-summary.test.ts` · `insights-drill-cards.test.tsx` | **new** tests                                                                                             |
| `__tests__/markbook/drill-filter.test.ts`                                                                                                                                                | `makeEntry` gains `subjectCatalogName`                                                                    |

---

## Task 5.1: Shared Insights rules — `lib/markbook/insights-drill.ts`

**Files:**

- Create: `lib/markbook/insights-drill.ts`
- Test: `__tests__/markbook/insights-drill.test.ts`

**Interfaces:**

- Consumes: `GradeBand` (type, `lib/markbook/drill-filter.ts:51`), `TermLockProgress` (type, `lib/markbook/dashboard.ts:271`).
- Produces:
  - `round1(n: number): number`
  - `countsTowardInsightsAverage(isNa: boolean | null, grade: number | null): boolean`
  - `isInsightsAverageRow(r: { isExaminable: boolean; isNa: boolean; computedGrade: number | null }): boolean`
  - `type DistributionTermCandidate = { id: string; term_number: number; is_current: boolean | null; start_date: string | null; end_date: string | null }`
  - `pickGradeDistributionTerm<T extends DistributionTermCandidate>(terms: T[], today: string): T | null`
  - `changeRequestWindowStart(days: number, now?: Date): string`
  - `isInChangeRequestWindow(requestedAt: string, sinceIso: string): boolean`
  - `type DecisionFields = { status: string; requestedAt: string; reviewedAt: string | null }`
  - `decisionMs(r: DecisionFields): number | null`
  - `averageDecisionHours(rows: DecisionFields[]): number | null`
  - `tallySheetLocksByTerm(terms: { id: string; term_number: number }[], sheets: { term_id: string; is_locked: boolean }[]): TermLockProgress[]`
  - `type SubjectAveragePoint = { periodLabel: string; levelCode: string; avgGrade: number | null }`
  - `levelAveragesForPeriod(points: SubjectAveragePoint[], period: string): { levelCode: string; avg: number }[]`
  - `TOP_BAND_KEYS: readonly GradeBand[]` · `isTopBand(b: GradeBand | null): boolean`
  - Segment builders/parsers: `subjectTermSegment`, `parseSubjectTermSegment`, `levelTermSegment`, `parseLevelTermSegment`, `subjectLevelSegment`, `parseSubjectLevelSegment`, `topBandSegment`, `parseTopBandSegment`, `windowedCrSegment`, `parseWindowedCrSegment`, `termNumberFromLabel`, `parseTrendSeriesKey` (signatures in the code below)

- [ ] **Step 1: Write the failing test** — `__tests__/markbook/insights-drill.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import {
  averageDecisionHours,
  changeRequestWindowStart,
  countsTowardInsightsAverage,
  decisionMs,
  isInChangeRequestWindow,
  isInsightsAverageRow,
  isTopBand,
  levelAveragesForPeriod,
  levelTermSegment,
  parseLevelTermSegment,
  parseSubjectLevelSegment,
  parseSubjectTermSegment,
  parseTopBandSegment,
  parseTrendSeriesKey,
  parseWindowedCrSegment,
  pickGradeDistributionTerm,
  round1,
  subjectLevelSegment,
  subjectTermSegment,
  tallySheetLocksByTerm,
  termNumberFromLabel,
  topBandSegment,
  windowedCrSegment,
} from '@/lib/markbook/insights-drill';

describe('entry rule shared by the Insights averages, the histogram and their drills', () => {
  it('counts a real grade on a non-N.A. row, nothing else', () => {
    expect(countsTowardInsightsAverage(false, 80)).toBe(true);
    expect(countsTowardInsightsAverage(null, 0)).toBe(true);
    expect(countsTowardInsightsAverage(true, 95)).toBe(false);
    expect(countsTowardInsightsAverage(false, null)).toBe(false);
  });
  it('a drill row also needs an examinable subject', () => {
    expect(
      isInsightsAverageRow({
        isExaminable: true,
        isNa: false,
        computedGrade: 70,
      })
    ).toBe(true);
    expect(
      isInsightsAverageRow({
        isExaminable: false,
        isNa: false,
        computedGrade: 70,
      })
    ).toBe(false);
    expect(
      isInsightsAverageRow({
        isExaminable: true,
        isNa: true,
        computedGrade: 70,
      })
    ).toBe(false);
  });
  it('round1 rounds half up to one decimal, as the loaders do', () => {
    expect(round1(82.75)).toBe(82.8);
    expect(round1(80)).toBe(80);
  });
});

describe('pickGradeDistributionTerm — the term the grade histogram reads', () => {
  const t = (
    id: string,
    n: number,
    start: string | null,
    end: string | null,
    current = false
  ) => ({
    id,
    term_number: n,
    is_current: current,
    start_date: start,
    end_date: end,
  });

  it('the is_current term wins', () => {
    const terms = [
      t('a', 1, '2026-01-05', '2026-03-13'),
      t('b', 2, '2026-03-23', '2026-06-05', true),
    ];
    expect(pickGradeDistributionTerm(terms, '2026-01-10')?.id).toBe('b');
  });
  it('then the term containing today', () => {
    const terms = [
      t('a', 1, '2026-01-05', '2026-03-13'),
      t('b', 2, '2026-03-23', '2026-06-05'),
    ];
    expect(pickGradeDistributionTerm(terms, '2026-04-01')?.id).toBe('b');
  });
  it('then the most recently finished term', () => {
    const terms = [
      t('a', 1, '2025-01-06', '2025-03-14'),
      t('b', 2, '2025-03-24', '2025-06-06'),
    ];
    expect(pickGradeDistributionTerm(terms, '2026-09-29')?.id).toBe('b');
  });
  it('then the highest term number; none → null', () => {
    const terms = [t('b', 2, null, null), t('a', 1, null, null)];
    expect(pickGradeDistributionTerm(terms, '2026-09-29')?.id).toBe('b');
    expect(pickGradeDistributionTerm([], '2026-09-29')).toBeNull();
  });
});

describe('change-request window and decision rule', () => {
  const now = new Date('2026-09-29T04:00:00.000Z');
  it('the window starts N calendar days before now', () => {
    expect(changeRequestWindowStart(30, now)).toBe('2026-08-30T04:00:00.000Z');
  });
  it('the start instant is inside the window; a moment before is not', () => {
    const since = changeRequestWindowStart(30, now);
    expect(isInChangeRequestWindow('2026-08-30T04:00:00+00:00', since)).toBe(
      true
    );
    expect(isInChangeRequestWindow('2026-08-30T03:59:59Z', since)).toBe(false);
  });
  it('a decision needs a terminal status and a review at or after the request', () => {
    expect(
      decisionMs({
        status: 'pending',
        requestedAt: '2026-09-01T00:00:00Z',
        reviewedAt: null,
      })
    ).toBeNull();
    expect(
      decisionMs({
        status: 'rejected',
        requestedAt: '2026-09-15T00:00:00Z',
        reviewedAt: '2026-09-14T00:00:00Z',
      })
    ).toBeNull();
    expect(
      decisionMs({
        status: 'applied',
        requestedAt: '2026-09-01T00:00:00Z',
        reviewedAt: '2026-09-01T12:00:00Z',
      })
    ).toBe(12 * 3_600_000);
  });
  it('averages decision hours to one decimal; none → null', () => {
    expect(
      averageDecisionHours([
        {
          status: 'approved',
          requestedAt: '2026-09-10T00:00:00Z',
          reviewedAt: '2026-09-11T06:00:00Z',
        },
        {
          status: 'applied',
          requestedAt: '2026-09-01T00:00:00Z',
          reviewedAt: '2026-09-01T12:00:00Z',
        },
        {
          status: 'pending',
          requestedAt: '2026-09-20T00:00:00Z',
          reviewedAt: null,
        },
      ])
    ).toBe(21);
    expect(averageDecisionHours([])).toBeNull();
  });
});

describe('tallySheetLocksByTerm', () => {
  it('counts locked and open per term, in term order, ignoring other years', () => {
    const out = tallySheetLocksByTerm(
      [
        { id: 't1', term_number: 1 },
        { id: 't2', term_number: 2 },
      ],
      [
        { term_id: 't1', is_locked: true },
        { term_id: 't1', is_locked: false },
        { term_id: 't2', is_locked: false },
        { term_id: 'other-year', is_locked: true },
      ]
    );
    expect(out).toEqual([
      { termNumber: 1, termLabel: 'Term 1', locked: 1, open: 1 },
      { termNumber: 2, termLabel: 'Term 2', locked: 0, open: 1 },
    ]);
  });
});

describe('levelAveragesForPeriod — the "Which levels are struggling?" value', () => {
  it('is the unweighted mean of each subject average in that period', () => {
    const out = levelAveragesForPeriod(
      [
        { periodLabel: 'T3', levelCode: 'P1', avgGrade: 80 },
        { periodLabel: 'T3', levelCode: 'P1', avgGrade: 85.5 },
        { periodLabel: 'T3', levelCode: 'P2', avgGrade: 70 },
        { periodLabel: 'T3', levelCode: 'P2', avgGrade: null },
        { periodLabel: 'T2', levelCode: 'P1', avgGrade: 10 },
      ],
      'T3'
    );
    expect(out).toEqual([
      { levelCode: 'P1', avg: 82.8 },
      { levelCode: 'P2', avg: 70 },
    ]);
  });
});

describe('segment grammar', () => {
  it('subject | term — the subject name may itself hold a bar', () => {
    expect(subjectTermSegment('Mathematics', 2)).toBe('Mathematics|T2');
    expect(parseSubjectTermSegment('Mathematics|T2')).toEqual({
      subjectName: 'Mathematics',
      termNumber: 2,
    });
    expect(parseSubjectTermSegment('A|B|T3')).toEqual({
      subjectName: 'A|B',
      termNumber: 3,
    });
    expect(parseSubjectTermSegment('Mathematics|2')).toBeNull();
    expect(parseSubjectTermSegment('')).toBeNull();
  });
  it('level | term', () => {
    expect(levelTermSegment('P3', 2)).toBe('P3|T2');
    expect(parseLevelTermSegment('P3|T2')).toEqual({
      levelCode: 'P3',
      termNumber: 2,
    });
    expect(parseLevelTermSegment('P3')).toBeNull();
  });
  it('subject | level', () => {
    expect(subjectLevelSegment('English', 'S1')).toBe('English|S1');
    expect(parseSubjectLevelSegment('English|S1')).toEqual({
      subjectName: 'English',
      levelCode: 'S1',
    });
    expect(parseSubjectLevelSegment('English')).toBeNull();
  });
  it('top band, with or without a term', () => {
    expect(topBandSegment(2)).toBe('top|T2');
    expect(parseTopBandSegment('top')).toEqual({ termNumber: null });
    expect(parseTopBandSegment('top|T2')).toEqual({ termNumber: 2 });
    expect(parseTopBandSegment('o')).toBeNull();
    expect(isTopBand('vs')).toBe(true);
    expect(isTopBand('o')).toBe(true);
    expect(isTopBand('s')).toBe(false);
    expect(isTopBand(null)).toBe(false);
  });
  it('windowed change requests', () => {
    expect(windowedCrSegment(30)).toBe('30d');
    expect(windowedCrSegment(30, 'pending')).toBe('30d:pending');
    expect(parseWindowedCrSegment('30d')).toEqual({ days: 30, status: null });
    expect(parseWindowedCrSegment('30d:decided')).toEqual({
      days: 30,
      status: 'decided',
    });
    expect(parseWindowedCrSegment('pending')).toBeNull();
  });
  it('term labels and trend series keys', () => {
    expect(termNumberFromLabel('T2')).toBe(2);
    expect(termNumberFromLabel('Term 3')).toBe(3);
    expect(termNumberFromLabel('Latest')).toBeNull();
    expect(parseTrendSeriesKey('English · AY2025')).toEqual({
      subjectName: 'English',
      ayCode: 'AY2025',
    });
    expect(parseTrendSeriesKey('English')).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run __tests__/markbook/insights-drill.test.ts --pool=threads`. Expected: FAIL, `Failed to resolve import "@/lib/markbook/insights-drill"`.

- [ ] **Step 3: Implement** — create `lib/markbook/insights-drill.ts`:

```ts
import type { TermLockProgress } from '@/lib/markbook/dashboard';
import type { GradeBand } from '@/lib/markbook/drill-filter';

// The rules every Markbook Insights figure shares with the drill behind it
// (KD #229). Each loader in dashboard.ts / compare.ts and each drill filter in
// drill-filter.ts calls THESE functions, so a figure and its list cannot count
// by different rules.
//
// Runtime-pure and client-safe: type-only imports, no Supabase, no
// 'server-only'. drill-filter.ts (bundled into the client drill sheet) imports
// it at runtime.

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Which entries count ─────────────────────────────────────────────────────

/**
 * An entry counts toward an Insights average (and the grade histogram) when it
 * carries a numeric grade and is not N.A. — an N.A. row's grade is a
 * placeholder (Hard Rule #3, KD #148). The examinable-subject rule (KD #95) is
 * applied at the SHEET level by the loaders; drill rows carry it per row.
 */
export function countsTowardInsightsAverage(
  isNa: boolean | null,
  grade: number | null
): boolean {
  return isNa !== true && grade !== null;
}

export function isInsightsAverageRow(r: {
  isExaminable: boolean;
  isNa: boolean;
  computedGrade: number | null;
}): boolean {
  return r.isExaminable && countsTowardInsightsAverage(r.isNa, r.computedGrade);
}

// ── Which term the grade histogram reads ────────────────────────────────────

export type DistributionTermCandidate = {
  id: string;
  term_number: number;
  is_current: boolean | null;
  start_date: string | null;
  end_date: string | null;
};

/**
 * The term `getGradeDistribution` reads when not handed one: the `is_current`
 * term, else the term containing today, else the most recently finished term,
 * else the highest term number. `today` is `yyyy-MM-dd` (sgToday()).
 */
export function pickGradeDistributionTerm<T extends DistributionTermCandidate>(
  terms: T[],
  today: string
): T | null {
  const ordered = [...terms].sort((a, b) => a.term_number - b.term_number);
  const current = ordered.find((t) => t.is_current === true);
  const containingToday = ordered.find(
    (t) =>
      t.start_date && t.end_date && t.start_date <= today && t.end_date >= today
  );
  const lastFinished = [...ordered]
    .filter((t) => t.end_date && t.end_date < today)
    .sort((a, b) => (a.end_date! < b.end_date! ? 1 : -1))[0];
  const fallback = ordered[ordered.length - 1];
  return current ?? containingToday ?? lastFinished ?? fallback ?? null;
}

// ── Change requests ─────────────────────────────────────────────────────────

/** Start of the rolling "last N days" window, as getChangeRequestSummary has always computed it. */
export function changeRequestWindowStart(
  days: number,
  now: Date = new Date()
): string {
  const since = new Date(now.getTime());
  since.setDate(since.getDate() - days);
  return since.toISOString();
}

/** The summary's `.gte('requested_at', since)`, as an instant comparison (formats differ: `Z` vs `+00:00`). */
export function isInChangeRequestWindow(
  requestedAt: string,
  sinceIso: string
): boolean {
  const t = Date.parse(requestedAt);
  return !Number.isNaN(t) && t >= Date.parse(sinceIso);
}

export type DecisionFields = {
  status: string;
  requestedAt: string;
  reviewedAt: string | null;
};

/**
 * Milliseconds from request to decision, or null when the request does not
 * count toward "Avg decision time": not approved/rejected/applied, never
 * reviewed, unparseable, or reviewed before it was requested.
 */
export function decisionMs(r: DecisionFields): number | null {
  if (!r.reviewedAt) return null;
  if (
    r.status !== 'approved' &&
    r.status !== 'rejected' &&
    r.status !== 'applied'
  ) {
    return null;
  }
  const req = Date.parse(r.requestedAt);
  const rev = Date.parse(r.reviewedAt);
  if (Number.isNaN(req) || Number.isNaN(rev) || rev < req) return null;
  return rev - req;
}

export function averageDecisionHours(rows: DecisionFields[]): number | null {
  let count = 0;
  let totalMs = 0;
  for (const r of rows) {
    const ms = decisionMs(r);
    if (ms === null) continue;
    count += 1;
    totalMs += ms;
  }
  return count > 0 ? round1(totalMs / count / (1000 * 60 * 60)) : null;
}

// ── Sheets locked per term ──────────────────────────────────────────────────

export function tallySheetLocksByTerm(
  terms: { id: string; term_number: number }[],
  sheets: { term_id: string; is_locked: boolean }[]
): TermLockProgress[] {
  const counts = new Map<string, { locked: number; open: number }>();
  for (const t of terms) counts.set(t.id, { locked: 0, open: 0 });
  for (const s of sheets) {
    const bucket = counts.get(s.term_id);
    if (!bucket) continue;
    if (s.is_locked) bucket.locked += 1;
    else bucket.open += 1;
  }
  return [...terms]
    .sort((a, b) => a.term_number - b.term_number)
    .map((t) => ({
      termNumber: t.term_number,
      termLabel: `Term ${t.term_number}`,
      locked: counts.get(t.id)!.locked,
      open: counts.get(t.id)!.open,
    }));
}

// ── Level average ───────────────────────────────────────────────────────────

export type SubjectAveragePoint = {
  periodLabel: string;
  levelCode: string;
  avgGrade: number | null;
};

/**
 * "Which levels are struggling?" — per level, the unweighted mean of its
 * subject averages in `period` (each already rounded to 1 dp), rounded to 1 dp.
 * A diagnostic signal, NOT the mean of the level's entries.
 */
export function levelAveragesForPeriod(
  points: SubjectAveragePoint[],
  period: string
): { levelCode: string; avg: number }[] {
  const byLevel = new Map<string, number[]>();
  for (const p of points) {
    if (p.periodLabel !== period || p.avgGrade === null) continue;
    const arr = byLevel.get(p.levelCode) ?? [];
    arr.push(p.avgGrade);
    byLevel.set(p.levelCode, arr);
  }
  return [...byLevel.entries()].map(([levelCode, avgs]) => ({
    levelCode,
    avg: round1(avgs.reduce((a, b) => a + b, 0) / avgs.length),
  }));
}

// ── Top band ────────────────────────────────────────────────────────────────

export const TOP_BAND_KEYS: readonly GradeBand[] = ['vs', 'o'];

export function isTopBand(b: GradeBand | null): boolean {
  return b !== null && TOP_BAND_KEYS.includes(b);
}

// ── Segment grammar ─────────────────────────────────────────────────────────
// `<left>|T<n>` and `<left>|<right>` split on the LAST bar, so a subject name
// holding a bar still parses.

function splitLast(segment: string): [string, string] | null {
  const i = segment.lastIndexOf('|');
  if (i <= 0 || i === segment.length - 1) return null;
  return [segment.slice(0, i), segment.slice(i + 1)];
}

function termToken(token: string): number | null {
  const m = /^T(\d+)$/.exec(token);
  return m ? Number(m[1]) : null;
}

export function subjectTermSegment(
  subjectName: string,
  termNumber: number
): string {
  return `${subjectName}|T${termNumber}`;
}

export function parseSubjectTermSegment(
  segment: string
): { subjectName: string; termNumber: number } | null {
  const parts = splitLast(segment);
  if (!parts) return null;
  const termNumber = termToken(parts[1]);
  return termNumber === null ? null : { subjectName: parts[0], termNumber };
}

export function levelTermSegment(
  levelCode: string,
  termNumber: number
): string {
  return `${levelCode}|T${termNumber}`;
}

export function parseLevelTermSegment(
  segment: string
): { levelCode: string; termNumber: number } | null {
  const parts = splitLast(segment);
  if (!parts) return null;
  const termNumber = termToken(parts[1]);
  return termNumber === null ? null : { levelCode: parts[0], termNumber };
}

export function subjectLevelSegment(
  subjectName: string,
  levelCode: string
): string {
  return `${subjectName}|${levelCode}`;
}

export function parseSubjectLevelSegment(
  segment: string
): { subjectName: string; levelCode: string } | null {
  const parts = splitLast(segment);
  return parts ? { subjectName: parts[0], levelCode: parts[1] } : null;
}

export function topBandSegment(termNumber: number): string {
  return `top|T${termNumber}`;
}

export function parseTopBandSegment(
  segment: string
): { termNumber: number | null } | null {
  if (segment === 'top') return { termNumber: null };
  const m = /^top\|T(\d+)$/.exec(segment);
  return m ? { termNumber: Number(m[1]) } : null;
}

export function windowedCrSegment(days: number, status?: string): string {
  return status ? `${days}d:${status}` : `${days}d`;
}

export function parseWindowedCrSegment(
  segment: string
): { days: number; status: string | null } | null {
  const m = /^(\d+)d(?::([a-z_]+))?$/.exec(segment);
  return m ? { days: Number(m[1]), status: m[2] ?? null } : null;
}

/** 'T2' → 2, 'Term 3' → 3. */
export function termNumberFromLabel(label: string): number | null {
  const m = /(\d+)/.exec(label);
  return m ? Number(m[1]) : null;
}

/** buildMultiAyTrend's series key `"{subjectName} · {ayCode}"`. */
export function parseTrendSeriesKey(
  key: string
): { subjectName: string; ayCode: string } | null {
  const i = key.lastIndexOf(' · ');
  if (i <= 0) return null;
  const ayCode = key.slice(i + 3);
  if (!/^AY\d{4}$/.test(ayCode)) return null;
  return { subjectName: key.slice(0, i), ayCode };
}
```

- [ ] **Step 4: Run** `npx vitest run __tests__/markbook/insights-drill.test.ts --pool=threads`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add lib/markbook/insights-drill.ts __tests__/markbook/insights-drill.test.ts && git commit -m "feat(markbook): shared rules for insights figures and their drills"`

---

## Task 5.2: Loaders read every row and use the shared rules

**Files:**

- Create: `__tests__/markbook/_support/fake-service.ts`
- Test: `__tests__/markbook/insights-loaders-read-all.test.ts`
- Modify: `lib/markbook/dashboard.ts`:
  - `loadGradeDistributionUncached` term pick (~:77–113) and bucket loop (~:196–203)
  - `loadSheetLockProgressByTermUncached` (:287–333)
  - `loadChangeRequestSummaryUncached` (~:314–396)
- Modify: `lib/markbook/compare.ts`:
  - sheet reads at :57–63 and :200–208
  - entry loops at :105–106 and :259–260
- Modify: `lib/markbook/drill.ts` `loadChangeRequestRowsUncached` sheet read (~:742–756)

**Interfaces:**

- Consumes: Task 5.1 `pickGradeDistributionTerm`, `countsTowardInsightsAverage`, `tallySheetLocksByTerm`, `changeRequestWindowStart`, `averageDecisionHours`; `fetchAllPages` (`lib/supabase/paginate.ts`).
- Produces: `makeFakeService(tables: Tables)`, `type Row`, `type Tables`, `ROW_CAP = 1000` from `__tests__/markbook/_support/fake-service.ts`. Loader signatures are unchanged.

- [ ] **Step 1: Write the fake** — `__tests__/markbook/_support/fake-service.ts` (not a `.test` file, so vitest does not collect it)

```ts
// A PostgREST-shaped fake that FILTERS: `.eq` / `.in` / `.not(col,'is',null)` /
// `.gte` are applied to fixture rows, dotted embed paths included
// (`subjects.is_examinable` reads the `subject` embed, as PostgREST's alias
// does). Like the real server it returns at most ROW_CAP rows per request,
// so an unpaginated read of a big table comes back cut short — silently.

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export const ROW_CAP = 1000;

const ALIAS: Record<string, string> = {
  subjects: 'subject',
  sections: 'section',
};

function read(row: Row, path: string): unknown {
  let cur: unknown = row;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    const obj = cur as Row;
    cur = key in obj ? obj[key] : obj[ALIAS[key] ?? key];
    if (Array.isArray(cur)) cur = cur[0];
  }
  return cur;
}

export function makeFakeService(tables: Tables) {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let range: [number, number] | null = null;
      const run = (): Row[] => {
        const all = (tables[table] ?? []).filter((r) =>
          filters.every((f) => f(r))
        );
        const [from, to] = range ?? [0, ROW_CAP - 1];
        return all.slice(from, Math.min(to + 1, from + ROW_CAP));
      };
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        eq: (col: string, val: unknown) => {
          filters.push((r) => read(r, col) === val);
          return q;
        },
        in: (col: string, vals: unknown[]) => {
          filters.push((r) => vals.includes(read(r, col)));
          return q;
        },
        not: (col: string, op: string, val: unknown) => {
          if (op === 'is' && val === null)
            filters.push((r) => read(r, col) != null);
          return q;
        },
        gte: (col: string, val: string) => {
          filters.push((r) => String(read(r, col)) >= val);
          return q;
        },
        order: () => q,
        range: (from: number, to: number) => {
          range = [from, to];
          return q;
        },
        maybeSingle: () =>
          Promise.resolve({ data: run()[0] ?? null, error: null }),
        then: (
          resolve: (v: { data: Row[]; error: null }) => unknown,
          reject?: (e: unknown) => unknown
        ) =>
          Promise.resolve({ data: run(), error: null }).then(resolve, reject),
      });
      return q;
    },
  };
}
```

- [ ] **Step 2: Write the failing test** — `__tests__/markbook/insights-loaders-read-all.test.ts`

```ts
/**
 * One school year holds ~1,116 grading sheets. PostgREST returns at most 1,000
 * rows per request, with no error. Three Insights reads asked once and never
 * paged, so the figures they fed counted a subset. This file gives each read
 * 1,200 sheets and checks that every one is counted.
 */
import { describe, expect, it, vi } from 'vitest';

import { makeFakeService, type Tables } from './_support/fake-service';

let TABLES: Tables = {};

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => makeFakeService(TABLES),
}));
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidateTag: () => undefined,
}));
vi.mock('@/lib/auth/teacher-emails', () => ({
  getTeacherEmailMap: async () => [],
}));
vi.mock('@/lib/auth/staff-list', () => ({
  getStaffDisplayNameById: async () => [],
}));
vi.mock('@/lib/dashboard/ay-id', () => ({
  getAyIdByCode: async (code: string) => (code === 'AY2026' ? 'ay26' : null),
}));

import type { CompareCellResult } from '@/lib/dashboard/compare';
import {
  getSubjectLevelTrend,
  getSubjectPerformanceTrend,
  type MarkbookCompareKpis,
} from '@/lib/markbook/compare';
import { getSheetLockProgressByTerm } from '@/lib/markbook/dashboard';
import {
  buildMarkbookDrillRows,
  type ChangeRequestRow,
} from '@/lib/markbook/drill';

const SHEETS = 1200;

function bigYear(): Tables {
  const sheets = Array.from({ length: SHEETS }, (_, i) => {
    const english = i >= 1000;
    return {
      id: `sh-${String(i).padStart(4, '0')}`,
      term_id: 't26-1',
      section_id: 'sec-a',
      subject_id: english ? 'sub-eng' : 'sub-math',
      qa_total: 30,
      is_locked: i < 700,
      locked_at: i < 700 ? '2026-03-01T00:00:00Z' : null,
      teacher_name: null,
      subject: {
        name: english ? 'English' : 'Mathematics',
        is_examinable: true,
      },
      section: { level: { code: 'P1' } },
    };
  });
  return {
    academic_years: [{ id: 'ay26', ay_code: 'AY2026' }],
    terms: [
      {
        id: 't26-1',
        term_number: 1,
        academic_year_id: 'ay26',
        label: 'Term 1',
        start_date: '2026-01-05',
        end_date: '2026-03-13',
        is_current: true,
      },
    ],
    sections: [
      {
        id: 'sec-a',
        name: 'Patience',
        academic_year_id: 'ay26',
        level_id: 'lv-p1',
      },
    ],
    levels: [{ id: 'lv-p1', code: 'P1' }],
    subjects: [
      {
        id: 'sub-math',
        code: 'MATH',
        name: 'Mathematics',
        is_examinable: true,
      },
      { id: 'sub-eng', code: 'ENG', name: 'English', is_examinable: true },
    ],
    subject_configs: [],
    grading_sheets: sheets,
    grade_entries: sheets.map((s, i) => ({
      id: `ge-${s.id}`,
      grading_sheet_id: s.id,
      section_student_id: 'ss-1',
      ww_scores: [8],
      pt_scores: [9],
      qa_score: 25,
      quarterly_grade: i >= 1000 ? 90 : 80,
      letter_grade: null,
      is_na: false,
      created_at: '2026-02-01T00:00:00Z',
    })),
    grade_change_requests: [
      {
        id: 'cr-late',
        grading_sheet_id: 'sh-1150',
        field_changed: 'ww_scores',
        reason_category: 'data_entry_error',
        status: 'pending',
        requested_by_email: 't@hfse.test',
        requested_at: '2026-09-20T00:00:00Z',
        reviewed_at: null,
        applied_at: null,
        grading_sheets: { sections: { academic_year_id: 'ay26' } },
      },
    ],
    teacher_assignments: [],
    section_students: [
      {
        id: 'ss-1',
        section_id: 'sec-a',
        student_id: 'st-1',
        enrollment_status: 'active',
      },
    ],
    students: [
      {
        id: 'st-1',
        student_number: 'H260001',
        first_name: 'Ana',
        last_name: 'Reyes',
      },
    ],
    report_card_publications: [],
  };
}

const T1_CELL = [
  {
    cell: {
      ayCode: 'AY2026',
      label: 'AY2026 · T1',
      kind: 'term',
      termNumber: 1,
      termId: 't26-1',
      range: { from: '2026-01-05', to: '2026-03-13' },
    },
    data: null,
  },
] as unknown as CompareCellResult<MarkbookCompareKpis>[];

describe('Insights loaders read past 1,000 sheets', () => {
  it('sheets locked per term counts all 1,200 sheets', async () => {
    TABLES = bigYear();
    expect(await getSheetLockProgressByTerm('ay26', 'AY2026')).toEqual([
      { termNumber: 1, termLabel: 'Term 1', locked: 700, open: 500 },
    ]);
  });

  it('the subject trend sees the sheets past the first 1,000', async () => {
    TABLES = bigYear();
    const points = await getSubjectPerformanceTrend(T1_CELL);
    expect(points.find((p) => p.subjectName === 'English')?.avgGrade).toBe(90);
    expect(points.find((p) => p.subjectName === 'Mathematics')?.avgGrade).toBe(
      80
    );
  });

  it('the subject × level trend sees them too', async () => {
    TABLES = bigYear();
    const raw = await getSubjectLevelTrend(T1_CELL);
    expect(raw.find((p) => p.subjectName === 'English')?.count).toBe(200);
  });

  it('the change-request drill sees a request on sheet #1,150', async () => {
    TABLES = bigYear();
    const rows = (await buildMarkbookDrillRows({
      ayCode: 'AY2026',
      target: 'change-requests',
    })) as ChangeRequestRow[];
    expect(rows.map((r) => r.requestId)).toContain('cr-late');
  });
});
```

- [ ] **Step 3: Run** `npx vitest run __tests__/markbook/insights-loaders-read-all.test.ts --pool=threads`. Expected: 4 FAIL:
  - lock: `locked: 700, open: 300`
  - subject trend: English `undefined`
  - subject × level: English count `undefined`
  - change-request drill: `cr-late` missing

- [ ] **Step 4: Implement — `lib/markbook/dashboard.ts`**

Add to the imports (after the `fetchAllPages, fetchInChunks` import line):

```ts
import {
  averageDecisionHours,
  changeRequestWindowStart,
  countsTowardInsightsAverage,
  pickGradeDistributionTerm,
  tallySheetLocksByTerm,
  type DistributionTermCandidate,
} from '@/lib/markbook/insights-drill';
```

In `loadGradeDistributionUncached`, replace the whole `if (!effectiveTermId) { … }` block (from `const today = sgToday();` down to the closing `}` after `null;`) with:

```ts
if (!effectiveTermId) {
  // The rule lives in pickGradeDistributionTerm so the Insights top-band
  // drill opens the SAME term this histogram counts (KD #229).
  const { data: termRows } = await service
    .from('terms')
    .select('id, term_number, is_current, start_date, end_date')
    .eq('academic_year_id', academicYearId)
    .order('term_number', { ascending: true });
  effectiveTermId =
    pickGradeDistributionTerm(
      (termRows ?? []) as DistributionTermCandidate[],
      sgToday()
    )?.id ?? null;
}
```

In the same function's bucket loop, replace

```ts
if (row.is_na === true) continue;
const g = row.quarterly_grade as number | null;
if (g == null) continue;
```

with

```ts
if (!countsTowardInsightsAverage(row.is_na, row.quarterly_grade)) continue;
const g = row.quarterly_grade as number;
```

Replace the whole body of `loadSheetLockProgressByTermUncached` with:

```ts
async function loadSheetLockProgressByTermUncached(
  academicYearId: string
): Promise<TermLockProgress[]> {
  const service = createServiceClient();

  const termsRes = await service
    .from('terms')
    .select('id, term_number')
    .eq('academic_year_id', academicYearId)
    .order('term_number', { ascending: true });
  if (termsRes.error) {
    console.error(
      '[markbook] getSheetLockProgressByTerm fetch failed:',
      termsRes.error.message
    );
    return [];
  }
  type TermRow = { id: string; term_number: number };
  const terms = (termsRes.data ?? []) as TermRow[];
  if (terms.length === 0) return [];

  // This year's sheets only, paged. The old read took every grading_sheets
  // row in the database in ONE request; PostgREST stops at 1,000 rows with no
  // error, and one year alone holds ~1,116 sheets, so the bars counted an
  // arbitrary subset.
  type SheetRow = { term_id: string; is_locked: boolean };
  let sheets: SheetRow[];
  try {
    sheets = await fetchAllPages<SheetRow>((from, to) =>
      service
        .from('grading_sheets')
        .select('term_id, is_locked')
        .in(
          'term_id',
          terms.map((t) => t.id)
        )
        .range(from, to)
    );
  } catch (err) {
    console.error('[markbook] getSheetLockProgressByTerm fetch failed:', err);
    return [];
  }
  return tallySheetLocksByTerm(terms, sheets);
}
```

In `loadChangeRequestSummaryUncached`, replace

```ts
const since = new Date();
since.setDate(since.getDate() - days);
const sinceIso = since.toISOString();
```

with

```ts
// Shared with the Insights change-request drill (KD #229).
const sinceIso = changeRequestWindowStart(days);
```

In the same function, replace everything from `let total = 0;` through the `const avgDecisionHours = … : null;` statement with:

```ts
for (const r of rows) {
  if (r.status in byStatus) byStatus[r.status] += 1;
}
const total = rows.length;
// Shared with the drill's windowed 'decided' segment (KD #229).
const avgDecisionHours = averageDecisionHours(
  rows.map((r) => ({
    status: r.status,
    requestedAt: r.requested_at,
    reviewedAt: r.reviewed_at,
  }))
);
```

- [ ] **Step 5: Implement — `lib/markbook/compare.ts`**

Add after the `createServiceClient` import:

```ts
import { countsTowardInsightsAverage } from '@/lib/markbook/insights-drill';
```

In `loadSubjectPerformanceTrendUncached`, replace

```ts
const { data: sheets, error: sheetsErr } = await service
  .from('grading_sheets')
  .select('id, term_id, subject:subjects!inner(name, is_examinable)')
  .in('term_id', termIds)
  .eq('subjects.is_examinable', true);

if (sheetsErr || !sheets || sheets.length === 0) return [];
```

with

```ts
// Paged: with a comparison year the examinable sheets for two years pass
// PostgREST's 1,000-row cap, which cut this read short with no error.
let sheets: SheetRow[];
try {
  sheets = await fetchAllPages<SheetRow>((from, to) =>
    service
      .from('grading_sheets')
      .select('id, term_id, subject:subjects!inner(name, is_examinable)')
      .in('term_id', termIds)
      .eq('subjects.is_examinable', true)
      .range(from, to)
  );
} catch {
  return [];
}
if (sheets.length === 0) return [];
```

and change the loop header `for (const s of sheets as SheetRow[]) {` in that function to `for (const s of sheets) {`.

In `loadSubjectLevelTrendUncached`, replace

```ts
const { data: sheets, error: sheetsErr } = await service
  .from('grading_sheets')
  .select(
    'id, term_id, subject:subjects!inner(name, is_examinable), section:sections!inner(level:levels!inner(code))'
  )
  .in('term_id', termIds)
  .eq('subjects.is_examinable', true);

if (sheetsErr || !sheets || sheets.length === 0) return [];
```

with

```ts
// Paged, as in loadSubjectPerformanceTrendUncached above.
let sheets: LevelSheetRow[];
try {
  sheets = await fetchAllPages<LevelSheetRow>((from, to) =>
    service
      .from('grading_sheets')
      .select(
        'id, term_id, subject:subjects!inner(name, is_examinable), section:sections!inner(level:levels!inner(code))'
      )
      .in('term_id', termIds)
      .eq('subjects.is_examinable', true)
      .range(from, to)
  );
} catch {
  return [];
}
if (sheets.length === 0) return [];
```

and change `for (const s of sheets as LevelSheetRow[]) {` to `for (const s of sheets) {`.

In **both** Step C loops, replace

```ts
if (entry.is_na === true) continue;
if (entry.quarterly_grade === null) continue;
```

with

```ts
// Shared with the Insights drills (KD #229): non-N.A. with a grade.
if (!countsTowardInsightsAverage(entry.is_na, entry.quarterly_grade)) continue;
```

and in each loop, change the later `slot.sum += entry.quarterly_grade;` to `slot.sum += entry.quarterly_grade as number;`. In the level loop, also change the two `entry.quarterly_grade` reads in the failing-band `if` to `(entry.quarterly_grade as number)`.

- [ ] **Step 6: Implement — `lib/markbook/drill.ts` `loadChangeRequestRowsUncached`.** Replace

```ts
const { data: sheetsData } = await service
  .from('grading_sheets')
  .select('id, term_id, section_id, subject_id')
  .in('term_id', ctx.termIds);
type SheetLite = {
  id: string;
  term_id: string;
  section_id: string;
  subject_id: string;
};
const sheets = (sheetsData ?? []) as SheetLite[];
```

with

```ts
type SheetLite = {
  id: string;
  term_id: string;
  section_id: string;
  subject_id: string;
};
// Paged — one year holds ~1,116 sheets, and an unpaged read stopped at
// 1,000, so requests on the rest never reached the list.
const sheets = await fetchAllPages<SheetLite>((from, to) =>
  service
    .from('grading_sheets')
    .select('id, term_id, section_id, subject_id')
    .in('term_id', ctx.termIds)
    .range(from, to)
);
```

- [ ] **Step 7: Run** `npx vitest run __tests__/markbook/insights-loaders-read-all.test.ts __tests__/markbook/grade-distribution.test.ts __tests__/markbook/insights-level.test.ts __tests__/cache --pool=threads`. Expected: all PASS.
- [ ] **Step 8: Commit** — `git add __tests__/markbook/_support/fake-service.ts __tests__/markbook/insights-loaders-read-all.test.ts lib/markbook/dashboard.ts lib/markbook/compare.ts lib/markbook/drill.ts && git commit -m "fix(markbook): insights loaders read every sheet and share the drill's rules"`

---

## Task 5.3: Top-band badge → `grade-bucket-entries` segment `top|T<n>`

**Files:**

- Create: `__tests__/markbook/_support/insights-fixture.ts`
- Test: `__tests__/markbook/insights-drill-parity.test.ts` (created here; later tasks append `describe` blocks)
- Modify: `lib/markbook/drill.ts`:
  - `isTermScopedEntryTarget` (:61–63)
  - `loadEntryRowsUncached` signature (:295) + `gradedEntries` (~:437)
  - `loadEntryRows` (~:822)
  - `buildMarkbookDrillRows` (:1033)
  - `drillHeaderForTarget` `grade-bucket-entries` case
- Modify: `lib/markbook/drill-filter.ts` `grade-bucket-entries` case (:204–220)

**Interfaces:**

- Consumes: Task 5.1 `parseTopBandSegment`, `isTopBand`, `topBandSegment`, `pickGradeDistributionTerm`; Task 5.2 fake.
- Produces:
  - `export type EntryKeepRule = 'any-score' | 'score-or-grade'`
  - `export function entryKeepRuleFor(target: MarkbookDrillTarget, segment?: string | null): EntryKeepRule`
  - `const INSIGHTS_ENTRY_TARGETS: Set<MarkbookDrillTarget>` (module-private, empty here, filled by Tasks 5.4–5.6)
  - fixture exports `NOW`, `AY_CODE`, `TERMS`, `buildInsightsFixture()`, `termCells(ayCodes)`, `expectedIds(entries, pred)`, `mean1(values)`, `type FixtureEntry`

- [ ] **Step 1: Write the fixture** — `__tests__/markbook/_support/insights-fixture.ts`

```ts
// Two school years, the same fixture for every Insights parity test.
//
// AY2026: terms 1-3; T2 is_current, so the grade histogram reads T2.
//   Sections: Patience (P1), Courage (P2), Unlevelled (a level_id the
//   `levels` table lacks — the subject chart counts its sheets, the level
//   charts cannot).
// AY2025: terms 1-2, both finished, so the histogram reads T2.
//   Section: Honesty (P1).
// Subjects: Mathematics + English (examinable), Music (not examinable).
// Three students a section; Patience's third is withdrawn and keeps grades.
// Four entries are special (OVERRIDES) — each is a rule the drills must share.

import type { CompareCellResult } from '@/lib/dashboard/compare';
import type { MarkbookCompareKpis } from '@/lib/markbook/compare';

import type { Row, Tables } from './fake-service';

export const NOW = new Date('2026-09-29T04:00:00.000Z');

export const AY_CODE: Record<string, string> = {
  ay25: 'AY2025',
  ay26: 'AY2026',
};

const LEVELS = [
  { id: 'lv-p1', code: 'P1' },
  { id: 'lv-p2', code: 'P2' },
];
const LEVEL_CODE = new Map(LEVELS.map((l) => [l.id, l.code]));

const SUBJECTS = [
  { id: 'sub-math', code: 'MATH', name: 'Mathematics', is_examinable: true },
  { id: 'sub-eng', code: 'ENG', name: 'English', is_examinable: true },
  { id: 'sub-mus', code: 'MUS', name: 'Music', is_examinable: false },
];

export const TERMS = [
  {
    id: 't25-1',
    term_number: 1,
    academic_year_id: 'ay25',
    label: 'Term 1',
    start_date: '2025-01-06',
    end_date: '2025-03-14',
    is_current: false,
  },
  {
    id: 't25-2',
    term_number: 2,
    academic_year_id: 'ay25',
    label: 'Term 2',
    start_date: '2025-03-24',
    end_date: '2025-06-06',
    is_current: false,
  },
  {
    id: 't26-1',
    term_number: 1,
    academic_year_id: 'ay26',
    label: 'Term 1',
    start_date: '2026-01-05',
    end_date: '2026-03-13',
    is_current: false,
  },
  {
    id: 't26-2',
    term_number: 2,
    academic_year_id: 'ay26',
    label: 'Term 2',
    start_date: '2026-03-23',
    end_date: '2026-06-05',
    is_current: true,
  },
  {
    id: 't26-3',
    term_number: 3,
    academic_year_id: 'ay26',
    label: 'Term 3',
    start_date: '2026-06-29',
    end_date: '2026-09-04',
    is_current: false,
  },
];

const SECTIONS = [
  {
    id: 'sec26-a',
    name: 'Patience',
    academic_year_id: 'ay26',
    level_id: 'lv-p1',
  },
  {
    id: 'sec26-b',
    name: 'Courage',
    academic_year_id: 'ay26',
    level_id: 'lv-p2',
  },
  {
    id: 'sec26-x',
    name: 'Unlevelled',
    academic_year_id: 'ay26',
    level_id: 'lv-gone',
  },
  {
    id: 'sec25-a',
    name: 'Honesty',
    academic_year_id: 'ay25',
    level_id: 'lv-p1',
  },
];

const STUDENTS_PER_SECTION = 3;

type Override = {
  quarterly_grade?: number | null;
  is_na?: boolean;
  ww_scores?: (number | null)[];
  pt_scores?: (number | null)[];
  qa_score?: number | null;
};

const OVERRIDES: Record<string, Override> = {
  // N.A. — not enrolled that term; its 95 is a placeholder, never counted.
  'ge-sh-sec26-a-MATH-T2-0': { is_na: true, quarterly_grade: 95 },
  // A grade with no raw scores behind it (imported) — every figure counts it.
  'ge-sh-sec26-a-MATH-T2-1': {
    quarterly_grade: 91,
    ww_scores: [null, null],
    pt_scores: [null],
    qa_score: null,
  },
  // Partly entered — no grade yet.
  'ge-sh-sec26-b-ENG-T3-2': {
    quarterly_grade: null,
    ww_scores: [7, null],
    pt_scores: [null],
    qa_score: null,
  },
  // Auto-seeded and untouched.
  'ge-sh-sec26-b-MATH-T3-2': {
    quarterly_grade: null,
    ww_scores: [null, null],
    pt_scores: [null],
    qa_score: null,
  },
};

export function gradeFor(
  sectionIdx: number,
  subjectIdx: number,
  termNumber: number,
  studentIdx: number
): number {
  return (
    60 +
    ((studentIdx * 13 + subjectIdx * 7 + termNumber * 5 + sectionIdx * 3) % 40)
  );
}

export type FixtureEntry = {
  id: string;
  ayCode: string;
  termNumber: number;
  subjectName: string;
  examinable: boolean;
  levelCode: string | null;
  isNa: boolean;
  grade: number | null;
};

export function buildInsightsFixture(): {
  tables: Tables;
  entries: FixtureEntry[];
} {
  const students: Row[] = [];
  const sectionStudents: Row[] = [];
  const sheets: Row[] = [];
  const gradeEntries: Row[] = [];
  const entries: FixtureEntry[] = [];

  SECTIONS.forEach((sec, secIdx) => {
    for (let i = 0; i < STUDENTS_PER_SECTION; i++) {
      const studentId = `st-${sec.id}-${i}`;
      students.push({
        id: studentId,
        student_number: `H${secIdx}${i}0001`,
        first_name: `Student ${i + 1}`,
        last_name: sec.name,
      });
      sectionStudents.push({
        id: `ss-${sec.id}-${i}`,
        section_id: sec.id,
        student_id: studentId,
        enrollment_status:
          sec.id === 'sec26-a' && i === 2 ? 'withdrawn' : 'active',
      });
    }
    const levelCode = LEVEL_CODE.get(sec.level_id) ?? null;
    const terms = TERMS.filter(
      (t) => t.academic_year_id === sec.academic_year_id
    );
    SUBJECTS.forEach((sub, subIdx) => {
      for (const term of terms) {
        const sheetId = `sh-${sec.id}-${sub.code}-T${term.term_number}`;
        const isLocked =
          term.term_number === 1 ||
          (sec.id === 'sec26-a' &&
            sub.code === 'MATH' &&
            term.term_number === 2);
        sheets.push({
          id: sheetId,
          term_id: term.id,
          section_id: sec.id,
          subject_id: sub.id,
          qa_total: 30,
          is_locked: isLocked,
          locked_at: isLocked ? '2026-04-01T00:00:00Z' : null,
          teacher_name: null,
          subject: { name: sub.name, is_examinable: sub.is_examinable },
          section: { level: levelCode ? { code: levelCode } : null },
        });
        for (let i = 0; i < STUDENTS_PER_SECTION; i++) {
          const id = `ge-${sheetId}-${i}`;
          const o = OVERRIDES[id] ?? {};
          const grade =
            o.quarterly_grade === undefined
              ? gradeFor(secIdx, subIdx, term.term_number, i)
              : o.quarterly_grade;
          const isNa = o.is_na ?? false;
          gradeEntries.push({
            id,
            grading_sheet_id: sheetId,
            section_student_id: `ss-${sec.id}-${i}`,
            ww_scores: o.ww_scores ?? [8, 9],
            pt_scores: o.pt_scores ?? [9],
            qa_score: o.qa_score === undefined ? 25 : o.qa_score,
            quarterly_grade: grade,
            letter_grade: null,
            is_na: isNa,
            created_at: '2026-02-01T00:00:00Z',
          });
          entries.push({
            id,
            ayCode: AY_CODE[sec.academic_year_id],
            termNumber: term.term_number,
            subjectName: sub.name,
            examinable: sub.is_examinable,
            levelCode,
            isNa,
            grade,
          });
        }
      }
    });
  });

  const cr = (
    id: string,
    sheet: string,
    ay: string,
    status: string,
    requestedAt: string,
    reviewedAt: string | null = null,
    appliedAt: string | null = null
  ): Row => ({
    id,
    grading_sheet_id: sheet,
    field_changed: 'ww_scores',
    reason_category: 'data_entry_error',
    status,
    requested_by_email: 'teacher@hfse.test',
    requested_at: requestedAt,
    reviewed_at: reviewedAt,
    applied_at: appliedAt,
    grading_sheets: { sections: { academic_year_id: ay } },
  });

  return {
    entries,
    tables: {
      academic_years: [
        { id: 'ay25', ay_code: 'AY2025' },
        { id: 'ay26', ay_code: 'AY2026' },
      ],
      terms: TERMS,
      sections: SECTIONS,
      levels: LEVELS,
      subjects: SUBJECTS,
      subject_configs: [],
      students,
      section_students: sectionStudents,
      grading_sheets: sheets,
      grade_entries: gradeEntries,
      teacher_assignments: [],
      report_card_publications: [],
      // NOW = 2026-09-29T04:00Z → the 30-day window opens 2026-08-30T04:00Z.
      grade_change_requests: [
        cr(
          'cr-1',
          'sh-sec26-a-MATH-T1',
          'ay26',
          'pending',
          '2026-09-20T02:00:00Z'
        ),
        cr(
          'cr-2',
          'sh-sec26-a-ENG-T1',
          'ay26',
          'approved',
          '2026-09-10T00:00:00Z',
          '2026-09-11T06:00:00Z'
        ),
        cr(
          'cr-3',
          'sh-sec26-b-MATH-T1',
          'ay26',
          'applied',
          '2026-09-01T00:00:00Z',
          '2026-09-01T12:00:00Z',
          '2026-09-03T00:00:00Z'
        ),
        // Reviewed "before" it was requested — the average skips it.
        cr(
          'cr-4',
          'sh-sec26-b-ENG-T1',
          'ay26',
          'rejected',
          '2026-09-15T00:00:00Z',
          '2026-09-14T00:00:00Z'
        ),
        // Outside the window.
        cr(
          'cr-5',
          'sh-sec26-a-MATH-T1',
          'ay26',
          'pending',
          '2026-08-20T00:00:00Z'
        ),
        cr(
          'cr-7',
          'sh-sec26-x-MATH-T1',
          'ay26',
          'cancelled',
          '2026-09-25T00:00:00Z'
        ),
        // The comparison year.
        cr(
          'cr-6',
          'sh-sec25-a-MATH-T1',
          'ay25',
          'approved',
          '2026-09-21T00:00:00Z',
          '2026-09-21T10:00:00Z'
        ),
      ],
    },
  };
}

/** The Insights page's term cells for these years (getSubjectPerformanceTrend input). */
export function termCells(
  ayCodes: string[]
): CompareCellResult<MarkbookCompareKpis>[] {
  return TERMS.filter((t) => ayCodes.includes(AY_CODE[t.academic_year_id])).map(
    (t) => ({
      cell: {
        ayCode: AY_CODE[t.academic_year_id],
        label: `${AY_CODE[t.academic_year_id]} · T${t.term_number}`,
        range: { from: t.start_date, to: t.end_date },
        kind: 'term',
        termNumber: t.term_number,
        termId: t.id,
      },
      data: null,
    })
  ) as unknown as CompareCellResult<MarkbookCompareKpis>[];
}

/** Ids of the entries an Insights average counts, narrowed by `pred` — computed from the fixture, independent of any loader. */
export function expectedIds(
  entries: FixtureEntry[],
  pred: (e: FixtureEntry) => boolean
): string[] {
  return entries
    .filter((e) => e.examinable && !e.isNa && e.grade !== null && pred(e))
    .map((e) => e.id)
    .sort();
}

export function mean1(values: number[]): number {
  return (
    Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
  );
}
```

- [ ] **Step 2: Write the failing test** — `__tests__/markbook/insights-drill-parity.test.ts`

```ts
/**
 * Markbook Insights parity (KD #229). Every test runs the REAL Insights
 * loader and the REAL drill builder against ONE fake database and checks:
 *   - a count equals the rows listed;
 *   - an average equals the same average, computed by the same helper, from
 *     the rows listed.
 * The comparison year (AY2025) is clicked too.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { makeFakeService, type Tables } from './_support/fake-service';
import {
  NOW,
  TERMS,
  buildInsightsFixture,
  expectedIds,
  mean1,
  termCells,
  type FixtureEntry,
} from './_support/insights-fixture';

let TABLES: Tables = {};

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => makeFakeService(TABLES),
}));
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidateTag: () => undefined,
}));
vi.mock('@/lib/auth/teacher-emails', () => ({
  getTeacherEmailMap: async () => [],
}));
vi.mock('@/lib/auth/staff-list', () => ({
  getStaffDisplayNameById: async () => [],
}));
vi.mock('@/lib/dashboard/ay-id', () => ({
  getAyIdByCode: async (code: string) =>
    code === 'AY2026' ? 'ay26' : code === 'AY2025' ? 'ay25' : null,
}));

import { sgToday } from '@/lib/dates';
import { getGradeDistribution } from '@/lib/markbook/dashboard';
import {
  buildMarkbookDrillRows,
  type GradeEntryRow,
} from '@/lib/markbook/drill';
import {
  pickGradeDistributionTerm,
  topBandSegment,
} from '@/lib/markbook/insights-drill';

let fx: { tables: Tables; entries: FixtureEntry[] };

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(() => {
  fx = buildInsightsFixture();
  TABLES = fx.tables;
});

async function entryRows(
  ayCode: string,
  target: Parameters<typeof buildMarkbookDrillRows>[0]['target'],
  segment: string
) {
  return (await buildMarkbookDrillRows({
    ayCode,
    target,
    segment,
  })) as GradeEntryRow[];
}

describe('top-band badge → grade-bucket-entries top|T<n>', () => {
  it.each([
    ['AY2026', 'ay26', 2],
    ['AY2025', 'ay25', 2], // the comparison year, read at its own term
  ])(
    '%s: the list is exactly what the histogram counts at 85 and above',
    async (ayCode, ayId, expectedTerm) => {
      const buckets = await getGradeDistribution(ayId, ayCode);
      const topCount = buckets
        .filter((b) => b.key === 'vs' || b.key === 'o')
        .reduce((s, b) => s + b.count, 0);
      const term = pickGradeDistributionTerm(
        TERMS.filter((t) => t.academic_year_id === ayId),
        sgToday()
      );
      expect(term?.term_number).toBe(expectedTerm);

      const rows = await entryRows(
        ayCode,
        'grade-bucket-entries',
        topBandSegment(term!.term_number)
      );
      expect(topCount).toBeGreaterThan(0);
      expect(rows.length).toBe(topCount);
      expect(rows.map((r) => r.entryId).sort()).toEqual(
        expectedIds(
          fx.entries,
          (e) =>
            e.ayCode === ayCode &&
            e.termNumber === expectedTerm &&
            (e.grade as number) >= 85
        )
      );
    }
  );

  it('keeps a grade with no raw scores and drops the N.A. placeholder', async () => {
    const ids = (
      await entryRows('AY2026', 'grade-bucket-entries', 'top|T2')
    ).map((r) => r.entryId);
    expect(ids).toContain('ge-sh-sec26-a-MATH-T2-1');
    expect(ids).not.toContain('ge-sh-sec26-a-MATH-T2-0');
  });

  it('a band segment keeps its dashboard behaviour (scored entries only)', async () => {
    const ids = (await entryRows('AY2026', 'grade-bucket-entries', 'o')).map(
      (r) => r.entryId
    );
    expect(ids).not.toContain('ge-sh-sec26-a-MATH-T2-1');
  });
});
```

- [ ] **Step 3: Run** `npx vitest run __tests__/markbook/insights-drill-parity.test.ts --pool=threads`. Expected: FAIL. Today `top|T2` matches no band, so the filter returns every examinable row in every term, and the length is larger than `topCount`. The grade-only row is also missing.

- [ ] **Step 4: Implement — `lib/markbook/drill.ts`**

Add to the imports (after the `drill-filter` import):

```ts
import { parseTopBandSegment } from '@/lib/markbook/insights-drill';
```

Replace `isTermScopedEntryTarget`:

```ts
// Entry targets behind a Markbook Insights figure (KD #229). Tasks 5.4–5.6 add
// to it. Each loads whole-year entries (no from/to) and keeps a grade that has
// no raw scores behind it, as the Insights averages do.
const INSIGHTS_ENTRY_TARGETS = new Set<MarkbookDrillTarget>();

export function isTermScopedEntryTarget(t: MarkbookDrillTarget): boolean {
  return (
    t === 'grade-entries' ||
    t === 'grade-bucket-entries' ||
    INSIGHTS_ENTRY_TARGETS.has(t)
  );
}

// Which entries the loader keeps. 'any-score' is the dashboard's "grade
// entered" rule (some raw score filled). 'score-or-grade' also keeps a
// quarterly grade with no scores behind it — the grade histogram and the
// Insights averages count those, so the drills behind them must too.
export type EntryKeepRule = 'any-score' | 'score-or-grade';

export function entryKeepRuleFor(
  target: MarkbookDrillTarget,
  segment?: string | null
): EntryKeepRule {
  if (INSIGHTS_ENTRY_TARGETS.has(target)) return 'score-or-grade';
  if (
    target === 'grade-bucket-entries' &&
    segment &&
    parseTopBandSegment(segment)
  ) {
    return 'score-or-grade';
  }
  return 'any-score';
}
```

Change the signature of `loadEntryRowsUncached`:

```ts
async function loadEntryRowsUncached(
  ayCode: string,
  from?: string,
  to?: string,
  keep: EntryKeepRule = 'any-score'
): Promise<GradeEntryRow[]> {
```

and replace `const gradedEntries = entries.filter(hasAnyGrade);` with:

```ts
const keepEntry =
  keep === 'score-or-grade'
    ? (e: EntryLite) => hasAnyGrade(e) || e.quarterly_grade !== null
    : hasAnyGrade;
const gradedEntries = entries.filter(keepEntry);
```

Replace `loadEntryRows`:

```ts
async function loadEntryRows(
  ayCode: string,
  from?: string,
  to?: string,
  keep: EntryKeepRule = 'any-score'
): Promise<GradeEntryRow[]> {
  return loadEntryRowsUncached(ayCode, from, to, keep);
}
```

In `buildMarkbookDrillRows`, replace the term-scoped branch's call

```ts
rows = (await loadEntryRows(
  input.ayCode,
  input.from,
  input.to
)) as MarkbookDrillRow[];
```

with

```ts
rows = (await loadEntryRows(
  input.ayCode,
  input.from,
  input.to,
  entryKeepRuleFor(input.target, input.segment)
)) as MarkbookDrillRow[];
```

In `drillHeaderForTarget`, replace the `grade-bucket-entries` case:

```ts
    case 'grade-bucket-entries': {
      const top = segment ? parseTopBandSegment(segment) : null;
      if (top) {
        return {
          eyebrow: 'Drill · Top grades',
          title:
            top.termNumber === null
              ? 'Grades of 85 and above'
              : `Grades of 85 and above · Term ${top.termNumber}`,
        };
      }
      return {
        eyebrow: 'Drill · Grade band',
        title: segment ? `Band: ${segment}` : 'Grade band',
      };
    }
```

- [ ] **Step 5: Implement — `lib/markbook/drill-filter.ts`.** Add the import after the `import type` block:

```ts
import { isTopBand, parseTopBandSegment } from '@/lib/markbook/insights-drill';
```

In the `grade-bucket-entries` case, insert after `if (!segment) return examinable as MarkbookDrillRow[];`:

```ts
// Insights top-band badge: VS + O together, in the one term the
// histogram reads (`top|T2`), or every term (`top`).
const top = parseTopBandSegment(segment);
if (top) {
  return examinable.filter(
    (r) =>
      isTopBand(r.gradeBucket) &&
      (top.termNumber === null || r.termNumber === top.termNumber)
  ) as MarkbookDrillRow[];
}
```

- [ ] **Step 6: Run** `npx vitest run __tests__/markbook/insights-drill-parity.test.ts __tests__/markbook/drill-filter.test.ts --pool=threads`. Expected: PASS.
- [ ] **Step 7: Commit** — `git add __tests__/markbook/_support/insights-fixture.ts __tests__/markbook/insights-drill-parity.test.ts lib/markbook/drill.ts lib/markbook/drill-filter.ts && git commit -m "feat(markbook): top-band drill lists exactly the histogram's term"`

---

## Task 5.4: `subject-term-entries` — performance-trend bars and subjects to watch

**Files:**

- Modify: `lib/markbook/drill.ts`:
  - `MarkbookDrillTarget` union (:43)
  - `rowKindForTarget` (:65)
  - `INSIGHTS_ENTRY_TARGETS`
  - `GradeEntryRow` (:89)
  - `resolveAyContext` (:227)
  - entry push (~:517)
  - `defaultColumnsForTarget`
  - `drillHeaderForTarget`
- Modify: `lib/markbook/drill-filter.ts` (new case)
- Modify: `app/api/markbook/drill/[target]/route.ts:21` (`VALID_TARGETS`)
- Modify: `__tests__/markbook/drill-filter.test.ts:87` (`makeEntry`)
- Test: append to `__tests__/markbook/insights-drill-parity.test.ts`

**Interfaces:**

- Consumes: Task 5.1 `parseSubjectTermSegment`, `subjectTermSegment`, `isInsightsAverageRow`.
- Produces: target `'subject-term-entries'`, segment `"<catalogue subject name>|T<n>"`, ayCode = the bar's year; `GradeEntryRow.subjectCatalogName: string`.

- [ ] **Step 1: Write the failing test** — append to `__tests__/markbook/insights-drill-parity.test.ts`. Add `getSubjectPerformanceTrend` from `@/lib/markbook/compare` and `subjectTermSegment` (to the existing `insights-drill` import) at the top.

```ts
describe('subject-term-entries — trend bars and subjects to watch', () => {
  it.each([
    ['AY2026', 'Mathematics', 2],
    ['AY2026', 'English', 3],
    ['AY2025', 'Mathematics', 1], // a comparison-year bar opens AY2025
  ])(
    '%s %s T%s: the plotted average is the mean of the listed grades',
    async (ayCode, subject, term) => {
      const points = await getSubjectPerformanceTrend(
        termCells(['AY2026', 'AY2025'])
      );
      const point = points.find(
        (p) =>
          p.ayCode === ayCode &&
          p.subjectName === subject &&
          p.periodLabel === `T${term}`
      );
      const rows = await entryRows(
        ayCode,
        'subject-term-entries',
        subjectTermSegment(subject, term)
      );

      expect(rows.map((r) => r.entryId).sort()).toEqual(
        expectedIds(
          fx.entries,
          (e) =>
            e.ayCode === ayCode &&
            e.subjectName === subject &&
            e.termNumber === term
        )
      );
      expect(mean1(rows.map((r) => r.computedGrade as number))).toBe(
        point?.avgGrade
      );
    }
  );

  it('counts the unlevelled section and the withdrawn student, as the chart does', async () => {
    const ids = (
      await entryRows('AY2026', 'subject-term-entries', 'Mathematics|T3')
    ).map((r) => r.entryId);
    expect(ids).toContain('ge-sh-sec26-x-MATH-T3-0');
    expect(ids).toContain('ge-sh-sec26-a-MATH-T3-2');
  });

  it('a subject the chart does not plot (not examinable) opens an empty list', async () => {
    expect(
      await entryRows('AY2026', 'subject-term-entries', 'Music|T2')
    ).toEqual([]);
  });

  it('a malformed segment opens an empty list, not every row', async () => {
    expect(
      await entryRows('AY2026', 'subject-term-entries', 'Mathematics')
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run __tests__/markbook/insights-drill-parity.test.ts --pool=threads`. Expected: FAIL, `unreachable target: subject-term-entries` (thrown by `rowKindForTarget`).

- [ ] **Step 3: Implement — `lib/markbook/drill.ts`**

- In the union, add `| 'subject-term-entries'` after `| 'teacher-entry-velocity'` (and move the terminating `;`).
- In `rowKindForTarget`, add `case 'subject-term-entries':` directly under `case 'teacher-entry-velocity':` (the `'entry'` group).
- Change `const INSIGHTS_ENTRY_TARGETS = new Set<MarkbookDrillTarget>();` to `const INSIGHTS_ENTRY_TARGETS = new Set<MarkbookDrillTarget>(['subject-term-entries']);`.
- In `GradeEntryRow`, after `subjectName: string;`, add:

```ts
/**
 * `subjects.name` — the catalogue name, NOT this year's display name. The
 * Insights subject averages (lib/markbook/compare.ts) group by it, so the
 * drills behind them filter by it (KD #229). Never shown; identity only.
 */
subjectCatalogName: string;
```

- In `resolveAyContext`'s return type, add `subjectCatalogNames: Map<string, string>;`. In the early `if (!ayId)` return, add `subjectCatalogNames: new Map(),`. After `const subjectExaminable = new Map<string, boolean>();`, add `const subjectCatalogNames = new Map<string, string>();`. Inside the `for (const s of subjectRows)` loop, add `subjectCatalogNames.set(s.id, s.name);`. In the final return, add `subjectCatalogNames,`.
- In the entry `out.push({ … })`, after `subjectName,`, add `subjectCatalogName: ctx.subjectCatalogNames.get(sheet.subject_id) ?? subjectCode,`.
- In `defaultColumnsForTarget`, before `case 'teacher-entry-velocity':`, add:

```ts
    case 'subject-term-entries':
      return ['studentName', 'subjectCode', 'sectionName', 'level', 'computedGrade'];
```

- Add the import `parseSubjectTermSegment` to the `@/lib/markbook/insights-drill` import. In `drillHeaderForTarget`, before `case 'teacher-entry-velocity':`, add:

```ts
    case 'subject-term-entries': {
      const seg = segment ? parseSubjectTermSegment(segment) : null;
      return {
        eyebrow: 'Drill · Subject average',
        title: seg ? `${seg.subjectName} · Term ${seg.termNumber}` : 'Subject average',
      };
    }
```

- [ ] **Step 4: Implement — `lib/markbook/drill-filter.ts`.** Extend the `insights-drill` import to `import { isInsightsAverageRow, isTopBand, parseSubjectTermSegment, parseTopBandSegment } from '@/lib/markbook/insights-drill';`, and add before `default:`:

```ts
    case 'subject-term-entries': {
      // Insights trend bar / subject-to-watch bar: the entries
      // getSubjectPerformanceTrend averages — examinable, not N.A., with a
      // grade — for one catalogue subject in one term, every section.
      const seg = segment ? parseSubjectTermSegment(segment) : null;
      if (!seg) return [];
      return (rows as GradeEntryRow[]).filter(
        (r) =>
          isInsightsAverageRow(r) &&
          r.subjectCatalogName === seg.subjectName &&
          r.termNumber === seg.termNumber
      ) as MarkbookDrillRow[];
    }
```

- [ ] **Step 5: Implement — route.** In `app/api/markbook/drill/[target]/route.ts` `VALID_TARGETS`, add `'subject-term-entries',` after `'teacher-entry-velocity',`.

- [ ] **Step 6: Fix the existing fixture.** In `__tests__/markbook/drill-filter.test.ts` `makeEntry`, add `subjectCatalogName: 'English',` after `subjectName: 'English',`.

- [ ] **Step 7: Run** `npx vitest run __tests__/markbook/insights-drill-parity.test.ts __tests__/markbook/drill-filter.test.ts --pool=threads`. Expected: PASS.
- [ ] **Step 8: Commit** — `git add lib/markbook/drill.ts lib/markbook/drill-filter.ts "app/api/markbook/drill/[target]/route.ts" __tests__/markbook/drill-filter.test.ts __tests__/markbook/insights-drill-parity.test.ts && git commit -m "feat(markbook): subject-term drill behind the insights subject averages"`

---

## Task 5.5: `level-term-entries` — "Which levels are struggling?"

**Files:**

- Modify: `lib/markbook/insights-drill.ts` (add `levelAverageFromEntryRows`)
- Modify: `lib/markbook/drill.ts` (union, `rowKindForTarget`, `INSIGHTS_ENTRY_TARGETS`, `defaultColumnsForTarget`, `drillHeaderForTarget`)
- Modify: `lib/markbook/drill-filter.ts`
- Modify: `app/api/markbook/drill/[target]/route.ts`
- Test: append to `__tests__/markbook/insights-drill-parity.test.ts`

**Interfaces:**

- Consumes: `getSubjectLevelTrend` (compare.ts:302), `buildSubjectLevelPoints` (insights-level.ts:96), Task 5.1 `levelAveragesForPeriod`, `parseLevelTermSegment`, `levelTermSegment`.
- Produces:
  - `levelAverageFromEntryRows(rows: GradeEntryRow[], levelCode: string, termNumber: number): number | null`
  - target `'level-term-entries'`, segment `"<levelCode>|T<n>"`

- [ ] **Step 1: Write the failing test** — append; add `getSubjectLevelTrend` (compare), `buildSubjectLevelPoints` (`@/lib/markbook/insights-level`), and `levelAverageFromEntryRows`, `levelAveragesForPeriod`, `levelTermSegment` (insights-drill) to the imports.

```ts
describe('level-term-entries — "Which levels are struggling?" point', () => {
  it('each point equals the mean of its subject averages over the listed grades', async () => {
    const plotted = levelAveragesForPeriod(
      buildSubjectLevelPoints(
        await getSubjectLevelTrend(termCells(['AY2026']))
      ),
      'T3'
    );
    expect(plotted.map((p) => p.levelCode).sort()).toEqual(['P1', 'P2']);
    for (const { levelCode, avg } of plotted) {
      const rows = await entryRows(
        'AY2026',
        'level-term-entries',
        levelTermSegment(levelCode, 3)
      );
      expect(rows.map((r) => r.entryId).sort()).toEqual(
        expectedIds(
          fx.entries,
          (e) =>
            e.ayCode === 'AY2026' &&
            e.levelCode === levelCode &&
            e.termNumber === 3
        )
      );
      expect(levelAverageFromEntryRows(rows, levelCode, 3)).toBe(avg);
    }
  });

  it('the unlevelled section is in no level, as on the chart', async () => {
    const all = [
      ...(await entryRows('AY2026', 'level-term-entries', 'P1|T3')),
      ...(await entryRows('AY2026', 'level-term-entries', 'P2|T3')),
    ];
    expect(all.some((r) => r.sectionName === 'Unlevelled')).toBe(false);
  });

  it('a level with nothing that term opens an empty list', async () => {
    expect(await entryRows('AY2026', 'level-term-entries', 'S4|T3')).toEqual(
      []
    );
  });
});
```

- [ ] **Step 2: Run** `npx vitest run __tests__/markbook/insights-drill-parity.test.ts --pool=threads`. Expected: FAIL, `levelAverageFromEntryRows` is not exported.

- [ ] **Step 3: Implement — `lib/markbook/insights-drill.ts`.** Add `import type { GradeEntryRow } from '@/lib/markbook/drill';` to the type imports, and append:

```ts
/**
 * The level point, recomputed from drill rows with the chart's own rule: each
 * catalogue subject's average (1 dp), then levelAveragesForPeriod.
 */
export function levelAverageFromEntryRows(
  rows: GradeEntryRow[],
  levelCode: string,
  termNumber: number
): number | null {
  const bySubject = new Map<string, number[]>();
  for (const r of rows) {
    if (r.level !== levelCode || r.termNumber !== termNumber) continue;
    if (!isInsightsAverageRow(r)) continue;
    const arr = bySubject.get(r.subjectCatalogName) ?? [];
    arr.push(r.computedGrade as number);
    bySubject.set(r.subjectCatalogName, arr);
  }
  const period = `T${termNumber}`;
  const points: SubjectAveragePoint[] = [...bySubject.values()].map(
    (grades) => ({
      periodLabel: period,
      levelCode,
      avgGrade: round1(grades.reduce((a, b) => a + b, 0) / grades.length),
    })
  );
  return levelAveragesForPeriod(points, period)[0]?.avg ?? null;
}
```

- [ ] **Step 4: Implement — `lib/markbook/drill.ts`**

- Add `| 'level-term-entries'` to the union.
- Add `case 'level-term-entries':` under `case 'subject-term-entries':` in `rowKindForTarget`.
- Change the set to `new Set<MarkbookDrillTarget>(['subject-term-entries', 'level-term-entries'])`.
- In `defaultColumnsForTarget`, change `case 'subject-term-entries':` to two stacked labels `case 'subject-term-entries':` / `case 'level-term-entries':` sharing the same return.
- Add `parseLevelTermSegment` to the insights-drill import. Before `case 'teacher-entry-velocity':` in `drillHeaderForTarget`, add:

```ts
    case 'level-term-entries': {
      const seg = segment ? parseLevelTermSegment(segment) : null;
      return {
        eyebrow: 'Drill · Level average',
        title: seg ? `${seg.levelCode} · Term ${seg.termNumber}` : 'Level average',
      };
    }
```

- [ ] **Step 5: Implement — `lib/markbook/drill-filter.ts`.** Add `parseLevelTermSegment` to the insights-drill import, and add before `default:`:

```ts
    case 'level-term-entries': {
      // Insights level point: the entries getSubjectLevelTrend sums for one
      // level in one term (a section whose level is unknown is in none).
      const seg = segment ? parseLevelTermSegment(segment) : null;
      if (!seg) return [];
      return (rows as GradeEntryRow[]).filter(
        (r) =>
          isInsightsAverageRow(r) &&
          r.level === seg.levelCode &&
          r.termNumber === seg.termNumber
      ) as MarkbookDrillRow[];
    }
```

- [ ] **Step 6: Implement — route.** Add `'level-term-entries',` to `VALID_TARGETS`.
- [ ] **Step 7: Run** `npx vitest run __tests__/markbook/insights-drill-parity.test.ts __tests__/markbook/drill-filter.test.ts --pool=threads`. Expected: PASS.
- [ ] **Step 8: Commit** — `git add lib/markbook/insights-drill.ts lib/markbook/drill.ts lib/markbook/drill-filter.ts "app/api/markbook/drill/[target]/route.ts" __tests__/markbook/insights-drill-parity.test.ts && git commit -m "feat(markbook): level-term drill behind the insights level averages"`

---

## Task 5.6: `subject-level-entries` — term-over-term movement

**Files:**

- Modify: `lib/markbook/drill.ts` (union, `rowKindForTarget`, set, columns, header)
- Modify: `lib/markbook/drill-filter.ts`
- Modify: route
- Test: append to parity file

**Interfaces:**

- Consumes: `computeTermDelta` (insights-level.ts:130), Task 5.1 `parseSubjectLevelSegment`, `subjectLevelSegment`.
- Produces: target `'subject-level-entries'`, segment `"<catalogue subject name>|<levelCode>"`. It lists the rows in the pair's earliest and latest term with grades, and the Term column is on by default.

- [ ] **Step 1: Write the failing test** — append; add `computeTermDelta` (insights-level) and `subjectLevelSegment` (insights-drill) to the imports.

```ts
describe('subject-level-entries — term-over-term movement bars', () => {
  it('lists the first and latest term, each matching its plotted average', async () => {
    const deltas = computeTermDelta(
      buildSubjectLevelPoints(await getSubjectLevelTrend(termCells(['AY2026'])))
    );
    expect(deltas.length).toBeGreaterThan(0);
    for (const d of deltas) {
      const rows = await entryRows(
        'AY2026',
        'subject-level-entries',
        subjectLevelSegment(d.subjectName, d.levelCode)
      );
      const first = rows.filter((r) => `T${r.termNumber}` === d.fromPeriod);
      const last = rows.filter((r) => `T${r.termNumber}` === d.toPeriod);
      expect(new Set(rows.map((r) => `T${r.termNumber}`))).toEqual(
        new Set([d.fromPeriod, d.toPeriod])
      );
      expect(first.length + last.length).toBe(rows.length);
      expect(mean1(first.map((r) => r.computedGrade as number))).toBe(
        d.firstAvg
      );
      expect(mean1(last.map((r) => r.computedGrade as number))).toBe(d.lastAvg);
    }
  });

  it('leaves out the terms between first and latest', async () => {
    const rows = await entryRows(
      'AY2026',
      'subject-level-entries',
      'Mathematics|P1'
    );
    expect(rows.some((r) => r.termNumber === 2)).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run __tests__/markbook/insights-drill-parity.test.ts --pool=threads`. Expected: FAIL, `unreachable target: subject-level-entries`.

- [ ] **Step 3: Implement — `lib/markbook/drill.ts`**

- Add `| 'subject-level-entries'` to the union.
- Add `case 'subject-level-entries':` under `case 'level-term-entries':` in `rowKindForTarget`.
- Change the set to `new Set<MarkbookDrillTarget>(['subject-term-entries', 'level-term-entries', 'subject-level-entries'])`.
- In `defaultColumnsForTarget`, before `case 'teacher-entry-velocity':`, add:

```ts
    case 'subject-level-entries':
      return ['studentName', 'sectionName', 'termNumber', 'computedGrade'];
```

- Add `parseSubjectLevelSegment` to the insights-drill import. In `drillHeaderForTarget`, before `case 'teacher-entry-velocity':`, add:

```ts
    case 'subject-level-entries': {
      const seg = segment ? parseSubjectLevelSegment(segment) : null;
      return {
        eyebrow: 'Drill · First term vs latest',
        title: seg ? `${seg.subjectName} · ${seg.levelCode}` : 'Term-over-term movement',
      };
    }
```

- [ ] **Step 4: Implement — `lib/markbook/drill-filter.ts`.** Add `parseSubjectLevelSegment` to the import, and add before `default:`:

```ts
    case 'subject-level-entries': {
      // Insights movement pair: computeTermDelta compares the EARLIEST and
      // LATEST term holding grades for this subject × level. List those two
      // terms' entries only; the Term column tells them apart.
      const seg = segment ? parseSubjectLevelSegment(segment) : null;
      if (!seg) return [];
      const matching = (rows as GradeEntryRow[]).filter(
        (r) =>
          isInsightsAverageRow(r) &&
          r.subjectCatalogName === seg.subjectName &&
          r.level === seg.levelCode
      );
      if (matching.length === 0) return [];
      const terms = matching.map((r) => r.termNumber);
      const first = Math.min(...terms);
      const last = Math.max(...terms);
      return matching.filter(
        (r) => r.termNumber === first || r.termNumber === last
      ) as MarkbookDrillRow[];
    }
```

- [ ] **Step 5: Implement — route.** Add `'subject-level-entries',` to `VALID_TARGETS`.
- [ ] **Step 6: Run** `npx vitest run __tests__/markbook/insights-drill-parity.test.ts __tests__/markbook/drill-filter.test.ts --pool=threads`. Expected: PASS.
- [ ] **Step 7: Commit** — `git add lib/markbook/drill.ts lib/markbook/drill-filter.ts "app/api/markbook/drill/[target]/route.ts" __tests__/markbook/insights-drill-parity.test.ts && git commit -m "feat(markbook): first-vs-latest term drill behind the insights movement chart"`

---

## Task 5.7: Change requests (30d) · Pending · Avg decision time — windowed segments

**Files:**

- Modify: `lib/markbook/drill-filter.ts` `change-requests` case (:174–190)
- Modify: `lib/markbook/drill.ts` `drillHeaderForTarget` `change-requests` case
- Test: append to parity file

**Interfaces:**

- Consumes: `getChangeRequestSummary(ayCode, days)` (dashboard.ts); Task 5.1 `parseWindowedCrSegment`, `changeRequestWindowStart`, `isInChangeRequestWindow`, `decisionMs`, `averageDecisionHours`, `windowedCrSegment`.
- Produces: segments `'<N>d'` (every request in the window), `'<N>d:pending'` / `'<N>d:<status>'`, and `'<N>d:decided'` (the requests the average is over). The dashboard's plain segments are unchanged.

- [ ] **Step 1: Write the failing test** — append; add `getChangeRequestSummary` (dashboard), `ChangeRequestRow` (drill), and `averageDecisionHours`, `windowedCrSegment` (insights-drill) to the imports.

```ts
describe('change-requests — the 30-day cards', () => {
  const crRows = async (ayCode: string, segment: string) =>
    (await buildMarkbookDrillRows({
      ayCode,
      target: 'change-requests',
      segment,
    })) as ChangeRequestRow[];

  it('Change requests (30d) = every request in the window', async () => {
    const s = await getChangeRequestSummary('AY2026', 30);
    const rows = await crRows('AY2026', windowedCrSegment(30));
    expect(s.total).toBe(5);
    expect(rows.length).toBe(s.total);
    expect(rows.map((r) => r.requestId).sort()).toEqual([
      'cr-1',
      'cr-2',
      'cr-3',
      'cr-4',
      'cr-7',
    ]);
  });

  it("Pending decisions = the window's pending requests", async () => {
    const s = await getChangeRequestSummary('AY2026', 30);
    expect(
      (await crRows('AY2026', windowedCrSegment(30, 'pending'))).length
    ).toBe(s.byStatus.pending);
  });

  it('Avg decision time = the average over exactly the listed requests', async () => {
    const s = await getChangeRequestSummary('AY2026', 30);
    const rows = await crRows('AY2026', windowedCrSegment(30, 'decided'));
    expect(rows.map((r) => r.requestId).sort()).toEqual(['cr-2', 'cr-3']);
    expect(averageDecisionHours(rows)).toBe(s.avgDecisionHours);
    expect(s.avgDecisionHours).toBe(21);
  });

  it('the comparison year counts its own requests', async () => {
    const s = await getChangeRequestSummary('AY2025', 30);
    expect((await crRows('AY2025', windowedCrSegment(30))).length).toBe(
      s.total
    );
  });

  it('the dashboard\'s plain "decided" segment is unchanged', async () => {
    const ids = (await crRows('AY2026', 'decided'))
      .map((r) => r.requestId)
      .sort();
    expect(ids).toEqual(['cr-2', 'cr-3', 'cr-4']);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run __tests__/markbook/insights-drill-parity.test.ts --pool=threads`. Expected: FAIL. Today `30d` is compared to `status`, so every windowed list has 0 rows.

- [ ] **Step 3: Implement — `lib/markbook/drill-filter.ts`.** Add `changeRequestWindowStart, decisionMs, isInChangeRequestWindow, parseWindowedCrSegment` to the insights-drill import. Replace the whole `case 'change-requests':` block (from `case 'change-requests':` down to the `) as MarkbookDrillRow[];` that closes the status filter) with:

```ts
    case 'change-requests': {
      if (!segment) return rows;
      // Insights cards: '30d' / '30d:pending' / '30d:decided' — the rolling
      // window getChangeRequestSummary counts over, and for 'decided' the
      // requests its average decision time is taken over (KD #229).
      const windowed = parseWindowedCrSegment(segment);
      if (windowed) {
        const since = changeRequestWindowStart(windowed.days);
        const inWindow = (rows as ChangeRequestRow[]).filter((r) =>
          isInChangeRequestWindow(r.requestedAt, since)
        );
        if (windowed.status === null) return inWindow as MarkbookDrillRow[];
        if (windowed.status === 'decided') {
          return inWindow.filter((r) => decisionMs(r) !== null) as MarkbookDrillRow[];
        }
        return inWindow.filter(
          (r) => r.status === windowed.status
        ) as MarkbookDrillRow[];
      }
      // 'decided' = the set the avg-decision-time KPI averages over: any
      // request with a reviewed_at AND a terminal status. Keeps the drill
      // aligned with the headline number when the user clicks it.
      if (segment === 'decided') {
        return (rows as ChangeRequestRow[]).filter(
          (r) =>
            r.reviewedAt != null &&
            (r.status === 'approved' ||
              r.status === 'rejected' ||
              r.status === 'applied')
        ) as MarkbookDrillRow[];
      }
      return (rows as ChangeRequestRow[]).filter(
        (r) => r.status === segment
      ) as MarkbookDrillRow[];
    }
```

- [ ] **Step 4: Implement — `lib/markbook/drill.ts` header.** Add `parseWindowedCrSegment` to the insights-drill import, and replace the `change-requests` case of `drillHeaderForTarget` with:

```ts
    case 'change-requests': {
      const windowed = segment ? parseWindowedCrSegment(segment) : null;
      if (windowed) {
        const what =
          windowed.status === null
            ? 'Change requests'
            : windowed.status === 'decided'
              ? 'Decided requests'
              : `${windowed.status.charAt(0).toUpperCase()}${windowed.status.slice(1)} requests`;
        return {
          eyebrow: 'Drill · Change requests',
          title: `${what} · last ${windowed.days} days`,
        };
      }
      return {
        eyebrow: 'Drill · Change requests',
        title: segment ? `Change requests · ${segment}` : 'Change requests',
      };
    }
```

- [ ] **Step 5: Run** `npx vitest run __tests__/markbook/insights-drill-parity.test.ts __tests__/markbook/drill-filter.test.ts --pool=threads`. Expected: PASS.
- [ ] **Step 6: Commit** — `git add lib/markbook/drill-filter.ts lib/markbook/drill.ts __tests__/markbook/insights-drill-parity.test.ts && git commit -m "feat(markbook): change-request drills use the summary's 30-day window"`

---

## Task 5.8: Sheets locked per term — pin `term-sheet-status` `T<n>` parity

**Files:**

- Test: append to parity file

**Interfaces:**

- Consumes: `getSheetLockProgressByTerm` (dashboard.ts, fixed in Task 5.2); the existing `term-sheet-status` compact `T<n>` branch (drill-filter.ts:229).
- Produces: nothing new. The Insights bar's label `Term 1` is turned into `T1` in the wrapper (Task 5.10), because the filter's labelled form needs `· Locked|Open`, and a bare `Term 1` would fall through to every sheet.

- [ ] **Step 1: Write the test** — append; add `getSheetLockProgressByTerm` (dashboard) and `SheetRow` (drill) to the imports.

```ts
describe('term-sheet-status T<n> — "Sheets locked · per term" bars', () => {
  it.each([
    ['AY2026', 'ay26'],
    ['AY2025', 'ay25'],
  ])(
    '%s: every sheet in the term, and the locked share matches the bar',
    async (ayCode, ayId) => {
      const progress = await getSheetLockProgressByTerm(ayId, ayCode);
      expect(progress.length).toBeGreaterThan(0);
      for (const t of progress) {
        const rows = (await buildMarkbookDrillRows({
          ayCode,
          target: 'term-sheet-status',
          segment: `T${t.termNumber}`,
        })) as SheetRow[];
        expect(rows.length).toBe(t.locked + t.open);
        expect(rows.filter((r) => r.isLocked).length).toBe(t.locked);
      }
    }
  );
});
```

- [ ] **Step 2: Run** `npx vitest run __tests__/markbook/insights-drill-parity.test.ts --pool=threads`. Expected: PASS on the first run. This pins an existing target whose loader Task 5.2 already fixed. To confirm the test can fail, temporarily change `segment: \`T${t.termNumber}\``to`segment: \`Term ${t.termNumber}\``, see it FAIL (every sheet is returned), then revert.
- [ ] **Step 3: Commit** — `git add __tests__/markbook/insights-drill-parity.test.ts && git commit -m "test(markbook): sheets-locked bars match their drill"`

---

## Task 5.9: The drill sheet says what the figure is

**Files:**

- Modify: `lib/markbook/insights-drill.ts` (add `insightsDrillSummary`)
- Modify: `components/markbook/drills/markbook-drill-sheet.tsx`:
  - props (:46)
  - body (after `const rows = drillQuery.data ?? EMPTY_ROWS;`, ~:735)
  - `DrillDownSheet` call (~:900)
- Test: `__tests__/markbook/insights-drill-summary.test.ts`

**Interfaces:**

- Produces:
  - `insightsDrillSummary(target: MarkbookDrillTarget, segment: string | null, rows: MarkbookDrillRow[]): string | null`
  - `MarkbookDrillSheetProps.description?: React.ReactNode`
  - `MarkbookDrillSheetProps.showInsightsSummary?: boolean` (default off, so dashboard drills look exactly as today)

- [ ] **Step 1: Write the failing test** — `__tests__/markbook/insights-drill-summary.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import type {
  ChangeRequestRow,
  GradeEntryRow,
  SheetRow,
} from '@/lib/markbook/drill';
import { insightsDrillSummary } from '@/lib/markbook/insights-drill';

function entry(over: Partial<GradeEntryRow>): GradeEntryRow {
  return {
    entryId: 'e',
    studentId: 's',
    studentName: 'Doe, Jane',
    studentNumber: 'H1',
    enroleeNumber: 'H1',
    level: 'P1',
    sectionId: 'sec',
    sectionName: 'Patience',
    subjectCode: 'MATH',
    subjectName: 'Mathematics',
    subjectCatalogName: 'Mathematics',
    termNumber: 2,
    termId: 't2',
    wwScores: [],
    ptScores: [],
    qaScore: null,
    qaMax: 30,
    letterGrade: null,
    rawScore: null,
    maxScore: 30,
    computedGrade: 80,
    gradeBucket: 's',
    isExaminable: true,
    isNa: false,
    isLocked: false,
    enteredAt: '2026-02-01T00:00:00Z',
    enteredBy: null,
    enteredById: null,
    ...over,
  };
}

describe('insightsDrillSummary', () => {
  it('subject × term: count and average', () => {
    expect(
      insightsDrillSummary('subject-term-entries', 'Mathematics|T2', [
        entry({ computedGrade: 80 }),
        entry({ computedGrade: 85 }),
      ])
    ).toBe('2 grades · average 82.5');
  });

  it('level × term: says the level figure averages the subject averages', () => {
    const rows = [
      entry({ computedGrade: 80 }),
      entry({ computedGrade: 90, subjectCatalogName: 'English' }),
      entry({ computedGrade: 70, subjectCatalogName: 'English' }),
    ];
    expect(insightsDrillSummary('level-term-entries', 'P1|T2', rows)).toBe(
      "3 grades across 2 subjects · level average 80.0 (each subject's average, averaged)"
    );
  });

  it('subject × level: first and latest term side by side', () => {
    const rows = [
      entry({ termNumber: 1, computedGrade: 90 }),
      entry({ termNumber: 3, computedGrade: 80 }),
      entry({ termNumber: 3, computedGrade: 70 }),
    ];
    expect(
      insightsDrillSummary('subject-level-entries', 'Mathematics|P1', rows)
    ).toBe('Term 1: average 90.0 (1 grade) → Term 3: average 75.0 (2 grades)');
  });

  it('windowed decided change requests: the average decision time', () => {
    const cr = (over: Partial<ChangeRequestRow>): ChangeRequestRow => ({
      requestId: 'r',
      status: 'approved',
      sheetId: 'sh',
      sectionId: 'sec',
      sectionName: 'Patience',
      subjectCode: 'MATH',
      subjectName: 'Mathematics',
      termNumber: 1,
      termId: 't1',
      fieldChanged: 'ww_scores',
      reasonCategory: 'data_entry_error',
      requestedBy: 't@hfse.test',
      requestedAt: '2026-09-10T00:00:00Z',
      resolvedAt: null,
      reviewedAt: '2026-09-11T06:00:00Z',
      ...over,
    });
    expect(
      insightsDrillSummary('change-requests', '30d:decided', [cr({})])
    ).toBe('1 decision · average 30 hours from request to decision');
    expect(
      insightsDrillSummary('change-requests', '30d', [cr({}), cr({})])
    ).toBe('2 requests in the last 30 days');
    expect(
      insightsDrillSummary('change-requests', 'pending', [cr({})])
    ).toBeNull();
  });

  it('term sheet status: the locked share', () => {
    const sheet = (isLocked: boolean) => ({ isLocked }) as SheetRow;
    expect(
      insightsDrillSummary('term-sheet-status', 'T2', [
        sheet(true),
        sheet(false),
        sheet(false),
      ])
    ).toBe('1 of 3 sheets locked (33%)');
  });

  it('an empty list says so', () => {
    expect(
      insightsDrillSummary('subject-term-entries', 'Mathematics|T2', [])
    ).toBe('No grades in this list.');
  });

  it('other targets get no summary', () => {
    expect(insightsDrillSummary('grade-entries', null, [entry({})])).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run __tests__/markbook/insights-drill-summary.test.ts --pool=threads`. Expected: FAIL, `insightsDrillSummary` is not exported.

- [ ] **Step 3: Implement — `lib/markbook/insights-drill.ts`.** Widen the drill type import to `import type { ChangeRequestRow, GradeEntryRow, MarkbookDrillRow, MarkbookDrillTarget, SheetRow } from '@/lib/markbook/drill';`, and append:

```ts
function plural(n: number, word: string): string {
  return `${n.toLocaleString('en-SG')} ${word}${n === 1 ? '' : 's'}`;
}

function meanGrade(rows: GradeEntryRow[]): number | null {
  const grades = rows
    .map((r) => r.computedGrade)
    .filter((g): g is number => g !== null);
  return grades.length > 0
    ? round1(grades.reduce((a, b) => a + b, 0) / grades.length)
    : null;
}

/**
 * One plain sentence under an Insights drill's title, computed from the rows
 * listed with the same helpers the figure used — so the reader can see the
 * list and the figure agree. Null for targets that need no summary.
 */
export function insightsDrillSummary(
  target: MarkbookDrillTarget,
  segment: string | null,
  rows: MarkbookDrillRow[]
): string | null {
  switch (target) {
    case 'subject-term-entries': {
      const avg = meanGrade(rows as GradeEntryRow[]);
      return avg === null
        ? 'No grades in this list.'
        : `${plural(rows.length, 'grade')} · average ${avg.toFixed(1)}`;
    }
    case 'level-term-entries': {
      const seg = segment ? parseLevelTermSegment(segment) : null;
      const entries = rows as GradeEntryRow[];
      const avg = seg
        ? levelAverageFromEntryRows(entries, seg.levelCode, seg.termNumber)
        : null;
      if (avg === null) return 'No grades in this list.';
      const subjects = new Set(entries.map((r) => r.subjectCatalogName)).size;
      return `${plural(rows.length, 'grade')} across ${plural(subjects, 'subject')} · level average ${avg.toFixed(1)} (each subject's average, averaged)`;
    }
    case 'subject-level-entries': {
      const byTerm = new Map<number, GradeEntryRow[]>();
      for (const r of rows as GradeEntryRow[]) {
        const arr = byTerm.get(r.termNumber) ?? [];
        arr.push(r);
        byTerm.set(r.termNumber, arr);
      }
      if (byTerm.size === 0) return 'No grades in this list.';
      return [...byTerm.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(
          ([term, list]) =>
            `Term ${term}: average ${(meanGrade(list) ?? 0).toFixed(1)} (${plural(list.length, 'grade')})`
        )
        .join(' → ');
    }
    case 'change-requests': {
      const windowed = segment ? parseWindowedCrSegment(segment) : null;
      if (!windowed) return null;
      if (windowed.status === 'decided') {
        const hours = averageDecisionHours(rows as ChangeRequestRow[]);
        return hours === null
          ? `No decisions in the last ${windowed.days} days.`
          : `${plural(rows.length, 'decision')} · average ${hours} hours from request to decision`;
      }
      return `${plural(rows.length, 'request')} in the last ${windowed.days} days`;
    }
    case 'term-sheet-status': {
      const sheets = rows as SheetRow[];
      const locked = sheets.filter((s) => s.isLocked).length;
      const pct =
        sheets.length > 0 ? Math.round((locked / sheets.length) * 100) : 0;
      return `${locked} of ${plural(sheets.length, 'sheet')} locked (${pct}%)`;
    }
    default:
      return null;
  }
}
```

- [ ] **Step 4: Implement — `components/markbook/drills/markbook-drill-sheet.tsx`**

- Add `import { insightsDrillSummary } from '@/lib/markbook/insights-drill';` after the `drill-filter` import.
- In `MarkbookDrillSheetProps`, after `initialChangeRequests?: ChangeRequestRow[];`, add:

```ts
  /** A line under the title. Wins over the automatic Insights summary. */
  description?: React.ReactNode;
  /**
   * Show the plain-English line that ties the list to the Insights figure it
   * opened from ("312 grades · average 84.3"). Off on the module dashboards,
   * which keep their current look.
   */
  showInsightsSummary?: boolean;
```

- Add `description,` and `showInsightsSummary,` to the props destructure.
- After `const rows = drillQuery.data ?? EMPTY_ROWS;`, add:

```ts
const insightsSummary = React.useMemo(
  () =>
    showInsightsSummary
      ? insightsDrillSummary(target, segment ?? null, rows)
      : null,
  [showInsightsSummary, target, segment, rows]
);
```

- In the `<DrillDownSheet … />` call, after `count={preFiltered.length}`, add `description={description ?? insightsSummary ?? undefined}`.

- [ ] **Step 5: Run** `npx vitest run __tests__/markbook/insights-drill-summary.test.ts --pool=threads` then `npx tsc --noEmit`. Expected: PASS; tsc clean.
- [ ] **Step 6: Commit** — `git add lib/markbook/insights-drill.ts components/markbook/drills/markbook-drill-sheet.tsx __tests__/markbook/insights-drill-summary.test.ts && git commit -m "feat(markbook): insights drills say how the list makes the figure"`

---

## Task 5.10: Client wrappers — `components/markbook/drills/insights-drill-cards.tsx`

Run `frontend-design:frontend-design` first (always-do-first rule). This task adds no new visual pattern. Clickable marks reuse the Phase 1 pointer/hover treatment. The badge button keeps `HeroBadgeChip`'s exact classes and adds only a focus ring and a pointer.

**Files:**

- Modify: `components/dashboard/dashboard-hero.tsx:75–99` (extract `heroBadgeClassName`)
- Create: `components/markbook/drills/insights-drill-cards.tsx`
- Test: `__tests__/markbook/insights-drill-cards.test.tsx`

**Interfaces:**

- Consumes: Phase 1 `GroupedBarChartProps.onSegmentClick` (`(x, seriesKey)`), `CategoryLineChartProps.onSegmentClick` (`(x)`), `ComparisonBarChartProps.onSegmentClick` (`(category)`); Task 5.9 props; Task 5.1 segment builders.
- Produces (each takes serializable props only, so an RSC page can render it):
  - `SubjectTrendDrillChart(props: Omit<GroupedBarChartProps, 'onSegmentClick'>)`
  - `SubjectsToWatchDrillChart(props: Omit<ComparisonBarChartProps, 'onSegmentClick'> & { ayCode: string; termNumber: number })`
  - `LevelAverageDrillChart(props: Omit<CategoryLineChartProps, 'onSegmentClick'> & { ayCode: string; termNumber: number })`
  - `TermMovementDrillChart(props: Omit<ComparisonBarChartProps, 'onSegmentClick'> & { ayCode: string; segmentByCategory: Record<string, string> })`
  - `SheetLockDrillChart(props: Omit<GroupedBarChartProps, 'onSegmentClick'> & { ayCode: string })`
  - `type TopBandYear = { ayCode: string; termNumber: number; topCount: number; total: number }`
  - `TopBandBadgeDrill(props: { badge: HeroBadge; years: TopBandYear[] })`
  - `heroBadgeClassName(tone: NonNullable<HeroBadge['tone']>): string` from dashboard-hero

- [ ] **Step 1: Write the failing test** — `__tests__/markbook/insights-drill-cards.test.tsx`

```tsx
/**
 * The Insights wrappers turn a click into the right drill: target, segment,
 * and — for a comparison series — that series' year. Charts are next/dynamic
 * (ssr:false) and never draw in jsdom, so each is replaced by buttons that
 * call onSegmentClick the way Phase 1's charts do.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const opened: Record<string, unknown>[] = [];

vi.mock('@/components/markbook/drills/markbook-drill-sheet', () => ({
  MarkbookDrillSheet: (props: Record<string, unknown>) => {
    opened.push(props);
    return (
      <div data-testid="drill">{props.description as React.ReactNode}</div>
    );
  },
}));
vi.mock('@/components/dashboard/charts/grouped-bar-chart', () => ({
  GroupedBarChart: (p: {
    onSegmentClick?: (c: string, s?: string) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => p.onSegmentClick?.('T2', 'Mathematics · AY2025')}
      >
        trend bar
      </button>
      <button
        type="button"
        onClick={() => p.onSegmentClick?.('Term 3', 'locked')}
      >
        lock bar
      </button>
    </div>
  ),
}));
vi.mock('@/components/dashboard/charts/comparison-bar-chart', () => ({
  ComparisonBarChart: (p: {
    onSegmentClick?: (c: string) => void;
    data: Array<{ category: string }>;
  }) => (
    <div>
      {p.data.map((d) => (
        <button
          key={d.category}
          type="button"
          onClick={() => p.onSegmentClick?.(d.category)}
        >
          {d.category}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('@/components/dashboard/charts/category-line-chart', () => ({
  CategoryLineChart: (p: {
    onSegmentClick?: (x: string) => void;
    data: Array<{ x: string }>;
  }) => (
    <div>
      {p.data.map((d) => (
        <button key={d.x} type="button" onClick={() => p.onSegmentClick?.(d.x)}>
          {d.x}
        </button>
      ))}
    </div>
  ),
}));

import {
  LevelAverageDrillChart,
  SheetLockDrillChart,
  SubjectTrendDrillChart,
  SubjectsToWatchDrillChart,
  TermMovementDrillChart,
  TopBandBadgeDrill,
} from '@/components/markbook/drills/insights-drill-cards';

const last = () => opened[opened.length - 1];

beforeEach(() => {
  opened.length = 0;
});

describe('Markbook Insights drill wrappers', () => {
  it('a trend bar opens its subject, term and the SERIES year', async () => {
    render(<SubjectTrendDrillChart series={[]} data={[]} />);
    await userEvent.click(screen.getByText('trend bar'));
    expect(last()).toMatchObject({
      target: 'subject-term-entries',
      segment: 'Mathematics|T2',
      ayCode: 'AY2025',
      showInsightsSummary: true,
    });
  });

  it('a subject-to-watch bar opens that subject in the latest term', async () => {
    render(
      <SubjectsToWatchDrillChart
        data={[{ category: 'English', current: 78.2 }]}
        ayCode="AY2026"
        termNumber={3}
      />
    );
    await userEvent.click(screen.getByText('English'));
    expect(last()).toMatchObject({
      target: 'subject-term-entries',
      segment: 'English|T3',
      ayCode: 'AY2026',
    });
  });

  it('a level point opens that level in the latest term', async () => {
    render(
      <LevelAverageDrillChart
        data={[{ x: 'P2', y: 80 }]}
        ayCode="AY2026"
        termNumber={3}
      />
    );
    await userEvent.click(screen.getByText('P2'));
    expect(last()).toMatchObject({
      target: 'level-term-entries',
      segment: 'P2|T3',
    });
  });

  it('a movement pair opens its subject × level', async () => {
    render(
      <TermMovementDrillChart
        data={[{ category: 'Mathematics · P1', current: 80, comparison: 85 }]}
        ayCode="AY2026"
        segmentByCategory={{ 'Mathematics · P1': 'Mathematics|P1' }}
      />
    );
    await userEvent.click(screen.getByText('Mathematics · P1'));
    expect(last()).toMatchObject({
      target: 'subject-level-entries',
      segment: 'Mathematics|P1',
    });
  });

  it('a lock bar labelled "Term 3" opens T3, not every sheet', async () => {
    render(<SheetLockDrillChart series={[]} data={[]} ayCode="AY2026" />);
    await userEvent.click(screen.getByText('lock bar'));
    expect(last()).toMatchObject({
      target: 'term-sheet-status',
      segment: 'T3',
      ayCode: 'AY2026',
    });
  });

  it('the top-band badge opens this year, then the comparison year on request', async () => {
    render(
      <TopBandBadgeDrill
        badge={{ label: '▲ 4pp vs AY2025', tone: 'mint' }}
        years={[
          { ayCode: 'AY2026', termNumber: 2, topCount: 40, total: 100 },
          { ayCode: 'AY2025', termNumber: 2, topCount: 27, total: 90 },
        ]}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /85 and above/ }));
    expect(last()).toMatchObject({
      target: 'grade-bucket-entries',
      segment: 'top|T2',
      ayCode: 'AY2026',
    });
    expect(
      screen.getByText(
        /40 of 100 graded marks in Term 2 of AY2026 are 85 or above \(40%\)/
      )
    ).toBeTruthy();

    await userEvent.click(
      screen.getByRole('button', { name: 'Show AY2025 instead' })
    );
    expect(last()).toMatchObject({ segment: 'top|T2', ayCode: 'AY2025' });
  });

  it('with nothing graded the badge is plain text', () => {
    render(
      <TopBandBadgeDrill
        badge={{ label: 'Building history', tone: 'muted' }}
        years={[]}
      />
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Building history')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run __tests__/markbook/insights-drill-cards.test.tsx --pool=threads`. Expected: FAIL, `Failed to resolve import "@/components/markbook/drills/insights-drill-cards"`.

- [ ] **Step 3: Implement — `components/dashboard/dashboard-hero.tsx`.** Replace `HeroBadgeChip` with:

```tsx
/**
 * The hero badge's classes, exported so a clickable badge (the Markbook
 * Insights top-band badge, KD #229) looks exactly like a static one.
 */
export function heroBadgeClassName(
  tone: NonNullable<HeroBadge['tone']>
): string {
  // Mint/amber carry a real semantic ("good"/"watch") — gradient wash, same
  // recipe as MetricCard's delta chip and every other state-bearing tint in
  // the app (KD #84's flat→gradient sweep: no semantic tint is ever flat).
  // Muted is a genuine de-emphasis state (e.g. "Historical", "Building
  // history") and stays flat — same reasoning as bg-muted elsewhere for a
  // true absence/non-signal. Default carries no color signal at all — a
  // light brand wash (matching the scopeNote chip below) reads as
  // "informational" without competing with the semantic tones.
  return cn(
    'h-7 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]',
    tone === 'mint' &&
      'border-brand-mint bg-gradient-to-b from-brand-mint/35 to-brand-mint/15 text-ink',
    tone === 'amber' &&
      'border-brand-amber bg-gradient-to-b from-brand-amber/35 to-brand-amber/15 text-ink',
    tone === 'muted' && 'border-border bg-muted text-muted-foreground',
    tone === 'default' &&
      'border-brand-indigo-soft/50 bg-gradient-to-b from-brand-indigo/12 to-brand-indigo/4 text-brand-indigo-deep'
  );
}

function HeroBadgeChip({ badge }: { badge: HeroBadge }) {
  return (
    <Badge
      variant="outline"
      className={heroBadgeClassName(badge.tone ?? 'default')}
    >
      {badge.label}
    </Badge>
  );
}
```

- [ ] **Step 4: Implement — create `components/markbook/drills/insights-drill-cards.tsx`**

```tsx
'use client';

import * as React from 'react';

import {
  CategoryLineChart,
  type CategoryLineChartProps,
} from '@/components/dashboard/charts/category-line-chart';
import {
  ComparisonBarChart,
  type ComparisonBarChartProps,
} from '@/components/dashboard/charts/comparison-bar-chart';
import {
  GroupedBarChart,
  type GroupedBarChartProps,
} from '@/components/dashboard/charts/grouped-bar-chart';
import {
  heroBadgeClassName,
  type HeroBadge,
} from '@/components/dashboard/dashboard-hero';
import { MarkbookDrillSheet } from '@/components/markbook/drills/markbook-drill-sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetTrigger } from '@/components/ui/sheet';
import type { MarkbookDrillTarget } from '@/lib/markbook/drill';
import {
  levelTermSegment,
  parseTrendSeriesKey,
  subjectTermSegment,
  termNumberFromLabel,
  topBandSegment,
} from '@/lib/markbook/insights-drill';
import { cn } from '@/lib/utils';

// Markbook Insights (KD #229): each wrapper holds the clicked segment and
// opens the Markbook drill for it. A Server Component cannot hand a chart a
// function, so the page renders these instead of the bare charts. Every
// average they open is pinned to its figure by
// __tests__/markbook/insights-drill-parity.test.ts.

type OpenDrill = {
  target: MarkbookDrillTarget;
  segment: string;
  ayCode: string;
};

function InsightsDrillHost({
  open,
  onClose,
  children,
}: {
  open: OpenDrill | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Sheet
      open={open !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      {children}
      {open && (
        <MarkbookDrillSheet
          key={`${open.target}:${open.ayCode}:${open.segment}`}
          target={open.target}
          segment={open.segment}
          ayCode={open.ayCode}
          showInsightsSummary
        />
      )}
    </Sheet>
  );
}

// ─── How does performance move across terms? ────────────────────────────────
// Bars are subjects (series key "{subject} · {ayCode}") per term (x "T2"). The
// year comes from the SERIES, so a comparison-year series opens that year.

export function SubjectTrendDrillChart(
  props: Omit<GroupedBarChartProps, 'onSegmentClick'>
) {
  const [open, setOpen] = React.useState<OpenDrill | null>(null);
  return (
    <InsightsDrillHost open={open} onClose={() => setOpen(null)}>
      <GroupedBarChart
        {...props}
        onSegmentClick={(category, series) => {
          const termNumber = termNumberFromLabel(category);
          const parsed = series ? parseTrendSeriesKey(series) : null;
          if (termNumber === null || !parsed) return;
          setOpen({
            target: 'subject-term-entries',
            segment: subjectTermSegment(parsed.subjectName, termNumber),
            ayCode: parsed.ayCode,
          });
        }}
      />
    </InsightsDrillHost>
  );
}

// ─── Subjects to watch ──────────────────────────────────────────────────────

export function SubjectsToWatchDrillChart({
  ayCode,
  termNumber,
  ...chart
}: Omit<ComparisonBarChartProps, 'onSegmentClick'> & {
  ayCode: string;
  termNumber: number;
}) {
  const [open, setOpen] = React.useState<OpenDrill | null>(null);
  return (
    <InsightsDrillHost open={open} onClose={() => setOpen(null)}>
      <ComparisonBarChart
        {...chart}
        onSegmentClick={(subjectName) =>
          setOpen({
            target: 'subject-term-entries',
            segment: subjectTermSegment(subjectName, termNumber),
            ayCode,
          })
        }
      />
    </InsightsDrillHost>
  );
}

// ─── Which levels are struggling? ───────────────────────────────────────────

export function LevelAverageDrillChart({
  ayCode,
  termNumber,
  ...chart
}: Omit<CategoryLineChartProps, 'onSegmentClick'> & {
  ayCode: string;
  termNumber: number;
}) {
  const [open, setOpen] = React.useState<OpenDrill | null>(null);
  return (
    <InsightsDrillHost open={open} onClose={() => setOpen(null)}>
      <CategoryLineChart
        {...chart}
        onSegmentClick={(levelCode) =>
          setOpen({
            target: 'level-term-entries',
            segment: levelTermSegment(levelCode, termNumber),
            ayCode,
          })
        }
      />
    </InsightsDrillHost>
  );
}

// ─── Term-over-term movement ────────────────────────────────────────────────
// The category is display text ("Mathematics · P1"); the page passes the
// segment for each category so no display string is ever parsed back.

export function TermMovementDrillChart({
  ayCode,
  segmentByCategory,
  ...chart
}: Omit<ComparisonBarChartProps, 'onSegmentClick'> & {
  ayCode: string;
  segmentByCategory: Record<string, string>;
}) {
  const [open, setOpen] = React.useState<OpenDrill | null>(null);
  return (
    <InsightsDrillHost open={open} onClose={() => setOpen(null)}>
      <ComparisonBarChart
        {...chart}
        onSegmentClick={(category) => {
          const segment = segmentByCategory[category];
          if (!segment) return;
          setOpen({ target: 'subject-level-entries', segment, ayCode });
        }}
      />
    </InsightsDrillHost>
  );
}

// ─── Sheets locked · per term ───────────────────────────────────────────────
// Bars are labelled "Term 1"; term-sheet-status wants "T1" (a bare "Term 1"
// matches no pattern and would list every sheet).

export function SheetLockDrillChart({
  ayCode,
  ...chart
}: Omit<GroupedBarChartProps, 'onSegmentClick'> & { ayCode: string }) {
  const [open, setOpen] = React.useState<OpenDrill | null>(null);
  return (
    <InsightsDrillHost open={open} onClose={() => setOpen(null)}>
      <GroupedBarChart
        {...chart}
        onSegmentClick={(category) => {
          const termNumber = termNumberFromLabel(category);
          if (termNumber === null) return;
          setOpen({
            target: 'term-sheet-status',
            segment: `T${termNumber}`,
            ayCode,
          });
        }}
      />
    </InsightsDrillHost>
  );
}

// ─── Top-band hero badge ────────────────────────────────────────────────────
// The badge compares two years' share of grades at 85 and above, each in the
// term its histogram reads. It opens this year's list; the sheet offers the
// comparison year's list in place (no second dialog).

export type TopBandYear = {
  ayCode: string;
  termNumber: number;
  topCount: number;
  total: number;
};

export function TopBandBadgeDrill({
  badge,
  years,
}: {
  badge: HeroBadge;
  years: TopBandYear[];
}) {
  const [open, setOpen] = React.useState(false);
  const [index, setIndex] = React.useState(0);
  const className = heroBadgeClassName(badge.tone ?? 'default');

  if (years.length === 0) {
    return (
      <Badge variant="outline" className={className}>
        {badge.label}
      </Badge>
    );
  }

  const year = years[index % years.length];
  const other = years.length > 1 ? years[(index + 1) % years.length] : null;
  const pct =
    year.total > 0 ? Math.round((year.topCount / year.total) * 100) : 0;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setIndex(0);
      }}
    >
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={`${badge.label} — see the grades of 85 and above`}
          className="cursor-pointer rounded-md transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Badge
            variant="outline"
            className={cn(className, 'pointer-events-none')}
          >
            {badge.label}
          </Badge>
        </button>
      </SheetTrigger>
      {open && (
        <MarkbookDrillSheet
          key={year.ayCode}
          target="grade-bucket-entries"
          segment={topBandSegment(year.termNumber)}
          ayCode={year.ayCode}
          description={
            <span className="inline-flex flex-wrap items-center gap-2">
              <span>
                {year.topCount.toLocaleString('en-SG')} of{' '}
                {year.total.toLocaleString('en-SG')} graded marks in Term{' '}
                {year.termNumber} of {year.ayCode} are 85 or above ({pct}%).
              </span>
              {other && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIndex((i) => i + 1)}
                >
                  Show {other.ayCode} instead
                </Button>
              )}
            </span>
          }
        />
      )}
    </Sheet>
  );
}
```

- [ ] **Step 5: Run** `npx vitest run __tests__/markbook/insights-drill-cards.test.tsx --pool=threads`. Expected: PASS.
- [ ] **Step 6: Commit** — `git add components/dashboard/dashboard-hero.tsx components/markbook/drills/insights-drill-cards.tsx __tests__/markbook/insights-drill-cards.test.tsx && git commit -m "feat(markbook): insights chart and badge drill wrappers"`

---

## Task 5.11: Wire `/markbook/insights`

**Files:**

- Modify: `app/(markbook)/markbook/insights/page.tsx`:
  - imports :18–26, :46–75
  - the loader `Promise.all` :227–243
  - top band :245–264
  - level average :333–349
  - hero :477–490
  - the charts at :525, :550, :576, :599, :663
  - the metric cards :623–649

**Interfaces:**

- Consumes: Task 5.10 wrappers; Task 5.1 `levelAveragesForPeriod`, `pickGradeDistributionTerm`, `subjectLevelSegment`, `termNumberFromLabel`, `windowedCrSegment`; `MarkbookDrillSheet`; `sgToday`.
- Produces: the page (no exports).

No unit test. The RSC prop check only happens at render (Review Focus 5), so this task is verified by opening the page in Task 5.12.

- [ ] **Step 1: Imports.** Replace the three chart imports (lines 18–26) with type-only imports:

```ts
import type { CategoryLinePoint } from '@/components/dashboard/charts/category-line-chart';
import type { ComparisonBarPoint } from '@/components/dashboard/charts/comparison-bar-chart';
```

and after the `MetricCard` import add:

```ts
import {
  LevelAverageDrillChart,
  SheetLockDrillChart,
  SubjectTrendDrillChart,
  SubjectsToWatchDrillChart,
  TermMovementDrillChart,
  TopBandBadgeDrill,
  type TopBandYear,
} from '@/components/markbook/drills/insights-drill-cards';
import { MarkbookDrillSheet } from '@/components/markbook/drills/markbook-drill-sheet';
```

After the `getCurrentAcademicYear` import add `import { sgToday } from '@/lib/dates';`. After the `insights-level` import block add:

```ts
import {
  levelAveragesForPeriod,
  pickGradeDistributionTerm,
  subjectLevelSegment,
  termNumberFromLabel,
  windowedCrSegment,
  type DistributionTermCandidate,
} from '@/lib/markbook/insights-drill';
```

- [ ] **Step 2: Load the distribution terms.** In the loader `Promise.all`, add `distTermsRes,` after `rawLevelPoints,` in the destructure, and add this as the last array element (after `getSubjectLevelTrend(levelTrendCellResults),`):

```ts
    // The term each year's grade histogram reads — the top-band drill opens
    // that same term (KD #229).
    ayId
      ? service
          .from('terms')
          .select('id, term_number, is_current, start_date, end_date, academic_year_id')
          .in('academic_year_id', compareAyId ? [ayId, compareAyId] : [ayId])
      : Promise.resolve({ data: [] }),
```

- [ ] **Step 3: Top-band years.** After `const growthBadge = topBandBadge(topBandPct, compareTopBandPct, compareAy);`, add:

```ts
type DistTermRow = DistributionTermCandidate & { academic_year_id: string };
const distTerms = ((distTermsRes as { data: DistTermRow[] | null }).data ??
  []) as DistTermRow[];
const today = sgToday();
const distTermNumber = (id: string | null): number | null =>
  id
    ? (pickGradeDistributionTerm(
        distTerms.filter((t) => t.academic_year_id === id),
        today
      )?.term_number ?? null)
    : null;
const countTop = (dist: typeof gradeDist) => ({
  topCount: (dist ?? [])
    .filter((b) => TOP_BAND_KEYS.has(b.key))
    .reduce((s, b) => s + b.count, 0),
  total: (dist ?? []).reduce((s, b) => s + b.count, 0),
});
const topBandYears: TopBandYear[] = [];
const selectedDistTerm = distTermNumber(ayId);
if (selectedDistTerm !== null && totalGraded > 0) {
  topBandYears.push({
    ayCode: selectedAy,
    termNumber: selectedDistTerm,
    ...countTop(gradeDist),
  });
}
const compareDistTerm = distTermNumber(compareAyId);
if (
  compareAy &&
  compareDistTerm !== null &&
  countTop(compareGradeDist).total > 0
) {
  topBandYears.push({
    ayCode: compareAy,
    termNumber: compareDistTerm,
    ...countTop(compareGradeDist),
  });
}
```

- [ ] **Step 4: Level average via the shared helper.** Replace the whole `const levelAvgByLevel = (() => { … })();` IIFE (lines 333–349) with:

```ts
// Unweighted mean of each subject's average per level — the rule is shared
// with the level drill so its list reproduces this value (KD #229).
const levelAvgByLevel = latestPeriodWithData
  ? levelAveragesForPeriod(levelPoints, latestPeriodWithData)
  : [];
const latestTermNumber = latestPeriodWithData
  ? termNumberFromLabel(latestPeriodWithData)
  : null;
```

- [ ] **Step 5: Movement segments.** After the `regressionPairData` declaration, add:

```ts
const regressionSegments: Record<string, string> = Object.fromEntries(
  regressionMovers.map((d) => [
    `${d.subjectName} · ${d.levelCode}`,
    subjectLevelSegment(d.subjectName, d.levelCode),
  ])
);
```

- [ ] **Step 6: Hero.** In `<DashboardHero>`, delete `growthBadge,` from `badges`, and change `actions={<ExportCsvButton data={exportData} />}` to:

```tsx
        actions={
          <>
            <TopBandBadgeDrill badge={growthBadge} years={topBandYears} />
            <ExportCsvButton data={exportData} />
          </>
        }
```

(The badges and the actions share one flex row, so the badge keeps its place: after "Current", before Export.)

- [ ] **Step 7: Charts.** Replace, in order:

1. The trend `<GroupedBarChart … />` (line 525) → `<SubjectTrendDrillChart series={trendBarSeries} data={trendBarData} yFormat="number" yDomain={[60, 100]} height={280} highlightX={overallTrendSummary.periodLabel ?? undefined} />`
2. The watch `<ComparisonBarChart … />` (line 550). Replace the fragment's chart with `{latestTermNumber !== null ? (<SubjectsToWatchDrillChart data={watchBarData} orientation="horizontal" yFormat="number" height={Math.max(200, watchBarData.length * 42 + 40)} ayCode={selectedAy} termNumber={latestTermNumber} />) : null}`. `watchBarData` is only non-empty when `latestPeriodWithData` is set, so the `null` branch never renders in practice.
3. The level `<CategoryLineChart … />` (line 576) → `{latestTermNumber !== null ? (<LevelAverageDrillChart data={levelLineData} seriesLabel="Average grade" yFormat="number" referenceValue={schoolAvgAcrossLevels} referenceLabel={`School avg ${schoolAvgAcrossLevels}`} height={280} ayCode={selectedAy} termNumber={latestTermNumber} />) : null}`
4. The movement `<ComparisonBarChart … />` (line 599) → `<TermMovementDrillChart data={regressionPairData} orientation="horizontal" yFormat="number" height={Math.max(220, regressionPairData.length * 48 + 48)} ayCode={selectedAy} segmentByCategory={regressionSegments} />`
5. The lock `<GroupedBarChart … />` (line 663) → `<SheetLockDrillChart series={LOCK_SERIES} data={lockBarData} yFormat="percent" yDomain={[0, 100]} showValueLabels height={220} highlightX={highlightTermLabel} ayCode={selectedAy} />`

- [ ] **Step 8: Metric cards.** Add a `drillSheet` to each of the three cards. It opens the summary's own rolling window, with no `from`/`to`.

```tsx
              drillSheet={() => (
                <MarkbookDrillSheet
                  target="change-requests"
                  segment={windowedCrSegment(crs.windowDays)}
                  ayCode={selectedAy}
                  showInsightsSummary
                />
              )}
```

For "Pending decisions" use `segment={windowedCrSegment(crs.windowDays, 'pending')}`. For "Avg decision time" use `segment={windowedCrSegment(crs.windowDays, 'decided')}`.

- [ ] **Step 9: Type-check** `npx tsc --noEmit`. Expected: clean (`ComparisonBarChart`, `CategoryLineChart` and `GroupedBarChart` are no longer used as values on this page).
- [ ] **Step 10: Commit** — `git add "app/(markbook)/markbook/insights/page.tsx" && git commit -m "feat(markbook): every insights card and chart opens its list"`

---

## Task 5.12: Phase gate

- [ ] **Step 1:** `npx tsc --noEmit`. Expected: clean.
- [ ] **Step 2:** `npx vitest run __tests__/markbook --pool=threads`. Expected: all pass. Re-run any failure alone before calling it a regression (the vitest-forks memory note).
- [ ] **Step 3:** `npx vitest run __tests__/ui/data-table-column-label-coverage.test.ts __tests__/cache --pool=threads`. Expected: pass. Markbook drill columns use string headers from `DRILL_COLUMN_LABELS`; no render-function header was added.
- [ ] **Step 4: Open the page (Review Focus 5).** Restart `npm run dev` (new route files and imports do not always reach a running server). Sign in as a school_admin or superadmin and open `/markbook/insights?ay=AY2026&compareAy=AY2025`. Check the dev terminal for "Functions cannot be passed to Client Components". Then click each block and check what opens:

| Block                                               | Opens                              | Must match                                                                                                                                                                |
| --------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hero badge "▲/▼ Npp vs AY2025"                      | "Grades of 85 and above · Term n"  | The row badge equals the sheet line's "X of Y" count. "Show AY2025 instead" swaps to AY2025's list, and its % minus AY2026's % equals the badge delta (±1 from rounding). |
| Performance trend bar                               | "{Subject} · Term n"               | The summary line's average equals the bar's tooltip value.                                                                                                                |
| Subjects to watch bar                               | the same kind of list, latest term | The average equals the bar's value label.                                                                                                                                 |
| Levels line point                                   | "{Level} · Term n"                 | "level average" equals the point's tooltip value.                                                                                                                         |
| Movement bar                                        | "{Subject} · {Level}"              | "Term a: average x → Term b: average y" equals the two bars.                                                                                                              |
| Change requests (30d) / Pending / Avg decision time | "… · last 30 days"                 | The row count equals the card. The decided line's hours equal the card.                                                                                                   |
| Sheets locked bar                                   | "Sheets · T n"                     | "k of n sheets locked (p%)" equals the bar label.                                                                                                                         |

Also check:

- A 0% lock bar draws nothing and cannot be clicked (finding 9).
- Close and re-open each sheet.
- Switch to `?ay=AY2025` with no comparison year; the badge reads "Building history" and still opens AY2025's list.

- [ ] **Step 5: Volume check.** On `?ay=AY2025`, open the largest subject in the trend chart. Confirm:
  - it loads in a few seconds (whole-year entry read, finding 8);
  - it scrolls smoothly (the sheet virtualizes);
  - the CSV download holds the same number of rows as the badge.
- [ ] **Step 6: Dashboards unchanged.** Open `/markbook`. The grade-distribution bars, sheet-progress bars and the three change-request cards still open their existing lists. No summary line appears (`showInsightsSummary` is off there).
- [ ] **Step 7: Report the production shift from Task 5.2 (for Mr Ace, plain English).** "Sheets locked per term" now counts every sheet; before, it counted at most 1,000 across all years. The subject averages can move slightly where a comparison year was selected. Note the before/after lock percentages seen in Step 4.
- [ ] **Step 8: Reviewer pass** (superpowers:requesting-code-review) against the index's Review Focus 1–5 and this file's findings. Fix what it finds before Phase 6.
