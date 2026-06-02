# Compare Feature Redesign — Design Spec

**Date:** 2026-05-30
**Status:** Approved
**Sprint:** 48

---

## Problem

The Compare feature across all 5 modules (Admissions, Attendance, Records, Markbook, Evaluation) has two problems:

1. **Unreadable table.** The CompareGrid applies mint/red heatmap gradients to every cell. When values are similar, every cell gets a color and the user reads color instead of data. Column grouping by AY is absent, so T1 T2 T3 T4 T1 T2 T3 T4 is visually ambiguous. The metric label column is not sticky, so it scrolls off screen.

2. **Missing analytical view for Markbook.** The "subject performance trend" — average grade per subject per term — is something school leaders actively need but doesn't exist anywhere in the system yet.

**Scope decision:** Table redesign affects all 5 modules via one shared component. The subject performance trend chart is added to Markbook only. Other module-specific charts are deferred post-go-live.

---

## Design

### 1. CompareGrid table redesign

**File:** `components/dashboard/compare-grid.tsx`

#### Remove

- `bucketOf()` function and all heatmap bucketing logic
- `best` / `good` / `bad` / `worst` CSS variants (mint/red backgrounds on cells)
- `highlightExtremes` prop (was already `@deprecated` — remove entirely)
- `lowerIsBetter` prop on `CompareGridMetric` — replaced by `direction`

#### Add / Change

**`CompareGridMetric` type** (updated):

```typescript
type CompareGridMetric<T> = {
  key: string;
  label: string;
  format?: 'number' | 'percent' | 'days';
  getValue: (data: T) => number | null;
  direction?: 'higherIsBetter' | 'lowerIsBetter'; // omit for neutral/ambiguous metrics
};
```

**Cell rendering:**

- Every data cell: `bg-card` background. No conditional tinting.
- Value: `font-semibold text-foreground` — full-size, own line.
- Delta (`↑ 3.2%` / `↓ 2pp`): `text-xs` on the line below the value.
  - Default color: `text-muted-foreground` (neutral — no direction judgment)
  - If `direction === 'higherIsBetter'`: positive delta → `text-brand-mint`, negative → `text-destructive`
  - If `direction === 'lowerIsBetter'`: positive delta → `text-destructive`, negative → `text-brand-mint`
  - Baseline cell (leftmost): shows no delta
- Baseline cell when value is 0: show `—` for delta

**Min/max row indicator:**

- Per row, identify the best-value cell (highest if `higherIsBetter`, lowest if `lowerIsBetter`, skip if no direction)
- Append a `•` dot to the metric label in the left column: `text-brand-mint` for best, `text-destructive` for worst
- Only one dot per row, on the label — never on the data cell itself
- If `direction` is omitted: no dot

**Column / header layout:**

- Two header rows:
  1. AY group row: `<th colspan={N}>` spanning each AY's columns. Bold AY label (`font-semibold text-foreground`). `border-t-2 border-brand-indigo/30` on the group `<th>` to visually separate AY groups.
  2. Period sub-label row: per-cell `<th>` with `font-mono text-[10px] text-muted-foreground` showing T1/T2 or "Apr 26".
- `border-b border-border` below both header rows.

**Sticky first column:**

- Metric label `<td>` / `<th>`: `sticky left-0 z-10 bg-card` with a `border-r border-border` separator.
- Table wrapper: `overflow-x-auto` so data columns scroll while the metric column stays fixed.

**Footer note** (keep, update copy):

- Remove references to color shading. Update to: "Delta shows change vs. the first selected period. Colored delta and • indicator only appear when a metric has a defined direction."

#### Module metric updates

Every compare page (`admissions`, `attendance`, `records`, `markbook`, `evaluation`) updates its `CompareGridMetric[]` definitions:

- Replace `lowerIsBetter: true` → `direction: 'lowerIsBetter'`
- Replace `lowerIsBetter: false` (or absent with no semantic) → `direction: 'higherIsBetter'` if genuinely directional, or omit `direction` entirely for ambiguous metrics
- Remove all `highlightExtremes` references

**Per-module direction audit:**

| Module     | Metric                | Direction        |
| ---------- | --------------------- | ---------------- |
| Admissions | Applications received | `higherIsBetter` |
| Admissions | Enrolled in range     | `higherIsBetter` |
| Admissions | Conversion %          | `higherIsBetter` |
| Admissions | Avg days to enroll    | `lowerIsBetter`  |
| Admissions | Sample size           | omit             |
| Attendance | Attendance %          | `higherIsBetter` |
| Attendance | Present               | `higherIsBetter` |
| Attendance | Late                  | `lowerIsBetter`  |
| Attendance | Absent                | `lowerIsBetter`  |
| Attendance | Excused               | omit             |
| Attendance | School days           | omit             |
| Records    | Active enrolled       | omit             |
| Records    | Enrollments in range  | `higherIsBetter` |
| Records    | Late enrolees         | omit             |
| Records    | Withdrawals in range  | `lowerIsBetter`  |
| Records    | Expiring soon         | `lowerIsBetter`  |
| Markbook   | Grade entries         | omit             |
| Markbook   | Sheets locked         | `higherIsBetter` |
| Markbook   | Lock %                | `higherIsBetter` |
| Markbook   | CRs pending           | `lowerIsBetter`  |
| Markbook   | Avg decision (hrs)    | `lowerIsBetter`  |
| Evaluation | Submission %          | `higherIsBetter` |
| Evaluation | Submitted             | `higherIsBetter` |
| Evaluation | Expected              | omit             |
| Evaluation | Median time to submit | `lowerIsBetter`  |
| Evaluation | Late submissions      | `lowerIsBetter`  |

---

### 2. Markbook subject performance trend

**New function:** `getSubjectPerformanceTrend` in `lib/markbook/compare.ts`

```typescript
export type SubjectTrendPoint = {
  periodLabel: string; // "T1", "T2", "T3", "T4"
  ayCode: string;
  subjectName: string;
  avgGrade: number | null;
};

export async function getSubjectPerformanceTrend(
  cells: CompareCellResult<MarkbookCompareKpis>[]
): Promise<SubjectTrendPoint[]>;
```

**Query logic:**

- For each cell, query `grade_entries` → `grading_sheets` → `subjects`
- Filter: `gs.term_id = cell.termId`, `s.is_examinable = true`
- Aggregate: `AVG(ge.quarterly_grade)` grouped by `(s.name, gs.term_id)`
- Exclude NULL `quarterly_grade` from average
- Return one `SubjectTrendPoint` per `(cell, subject)` combination

**Note on term resolution:** Each `CompareCellResult` for a term-kind cell already carries `cell.range` (start/end dates). Add `termId?: string` to `CompareCell` in `lib/dashboard/compare.ts` and populate it in `buildCompareCells` when `kind === 'term'` (the term UUID is already fetched there — just include it in the cell object). Use `cell.termId` to filter `grading_sheets.term_id` directly.

**Caching:** Wrap in `unstable_cache` with tag `markbook-drill:${ayCode}`, 60s TTL — same pattern as the rest of `lib/markbook/compare.ts`.

---

**Chart rendering:** `app/(markbook)/markbook/compare/page.tsx`

- Call `getSubjectPerformanceTrend(result.cells)` in the RSC alongside the existing `buildCompareCells` call (parallel via `Promise.all`)
- Group points by `ayCode` → one chart per AY
- Each chart uses `<MultiSeriesTrendChart>` (already exists at `components/dashboard/charts/multi-series-trend-chart.tsx`)
  - `data`: array of period label objects keyed by subject names
  - `series`: one entry per subject (name + color from the chart's existing cycle)
  - `xAxisKey`: `"periodLabel"`
  - `yDomain`: `[0, 100]`
  - Title: `"Subject Performance — {ayCode}"` in `font-serif` with `font-mono text-[10px]` eyebrow "Average quarterly grade"
- Charts rendered in `grid grid-cols-1 md:grid-cols-2 gap-6` above `<CompareGrid>`
- Empty state when no grade entries exist for the selected cells: omit the chart section entirely (no empty chart)

---

## Files changed

| File                                           | Change                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `components/dashboard/compare-grid.tsx`        | Full redesign — remove heatmap, add sticky col, AY group headers, directional delta |
| `app/(admissions)/admissions/compare/page.tsx` | Update metric `direction` fields                                                    |
| `app/(attendance)/attendance/compare/page.tsx` | Update metric `direction` fields                                                    |
| `app/(records)/records/compare/page.tsx`       | Update metric `direction` fields                                                    |
| `app/(markbook)/markbook/compare/page.tsx`     | Update metric `direction` fields + add subject trend chart                          |
| `app/(evaluation)/evaluation/compare/page.tsx` | Update metric `direction` fields                                                    |
| `lib/markbook/compare.ts`                      | Add `getSubjectPerformanceTrend()` + `SubjectTrendPoint` type                       |
| `lib/dashboard/compare.ts`                     | Add `termId?: string` to `CompareCell` type if not present                          |

**Not changed:** All compare toolbar, URL contract, `buildCompareCells`, per-module KPI query functions, MultiSeriesTrendChart component.

---

## Out of scope (post-go-live)

- Admissions monthly trend chart (applications + enrolments over time)
- Attendance rate trend chart
- Records movement trend chart
- Markbook grade distribution chart
- Evaluation submission trend chart
- P-Files compare page (not listed in user request)
