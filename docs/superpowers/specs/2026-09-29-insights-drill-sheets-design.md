# Insights pages — drill sheets on every number and chart

**Date:** 2026-09-29 · **Status:** design approved in chat, spec awaiting review · **Follow-up:** filters (separate spec, after this ships)

## Why

The four Insights pages (`/admissions/insights`, `/attendance/insights`, `/markbook/insights`, `/records/insights`) are read-only: no card or chart opens anything (the only links are student names on Attendance Insights). Mr Ace: _"no drill sheet no filters, its basically a dashboard but with much more detailed data"_. The module dashboards — the simpler pages — already drill (KD #56). An Insights number that looks wrong is a dead end: you cannot see who is behind it.

## Goal and success criteria

1. **Every number and every chart on the four pages opens the list behind it.** KPI cards open via `MetricCard.drillSheet`; a chart opens the part clicked (a slice, a bar, a point). Blocks that are themselves lists (the attendance watchlist, the leave-quota lists, "top reason per level", "withdrawals by level") get a "See all" that opens the full list.
2. **The list's row count equals the number shown** (KD #82/#124). Where today's nearest drill counts differently, this work closes the gap — never an "approximately".
3. **A click on the comparison year's series opens that year's rows** (the drill takes that series' `ayCode`).
4. Nothing on the module dashboards changes behaviour; nothing changes visually on the Insights pages beyond the cards and charts becoming clickable.

## Out of scope

Filters (next spec — the row fields added here are what filters will need). The module dashboards. New charts or layout changes. Migrations — every list is built from tables the Insights loaders already read.

## Design

### 1. Shared charts learn to report a click

Today only `ComparisonBarChart`, `DonutChart` and `LabeledPieChart` take `onSegmentClick`. Add the same optional prop, same behaviour (pointer cursor + hover emphasis only when the prop is set), to:

| Chart                      | Callback                                                           |
| -------------------------- | ------------------------------------------------------------------ |
| `GroupedBarChart`          | `(category, series)` — e.g. `('T2', 'AY2026')`, `('Math', 'fail')` |
| `TrendChart`               | `(x, series)` — the point's month and which year                   |
| `CategoryLineChart`        | `(x)`                                                              |
| `ComposedBarLineChart`     | `(category, 'bar' \| 'line')`                                      |
| `RetentionStackedBarChart` | `(level, 'returned' \| 'notReturned')`                             |
| `AttritionStackedBarChart` | `(level, reason)`                                                  |
| `NationalityMixPie`        | `(nationality)`                                                    |
| `NationalityByLevelBars`   | `(level, nationality)`                                             |

The second argument is optional in the type, so the existing `(segment: string) => void` handlers still fit. `SparklineChart` stays unclickable — it is decoration beside the "withdrawals by level" list, which drills.

A Server Component cannot pass a function to a client chart, so each clickable Insights chart gets a `'use client'` wrapper in `components/<module>/drills/insights-drill-cards.tsx` (the existing `chart-drill-cards.tsx` pattern: local `segment` state → `<Sheet>` → the module's drill sheet). Records' drill code lives under `components/sis/drills/` and `lib/sis/drill.ts`; its wrappers go there.

### 2. Rules every drill follows

- **Same predicate as the number.** Each new drill target filters with the same function (or the same exported predicate) the Insights loader counts with. Where a loader counts inline, the predicate is extracted to a shared export first.
- **Same window as the page.** Admissions / Markbook / Records Insights are whole-year: drills omit `from`/`to`. Attendance Insights is per term: drills get the selected term's window, and the vacation-leave drill gets the **selected** term (today `buildAllRowSets` is handed the `is_current` term — fixed here so the list matches the term on screen).
- **Rates open the denominator.** A rate card (conversion, retention, attendance rate, % locked) opens the population it is a rate _of_, with the outcome as a column (Enrolled? Returned? Status?). The numerator is then a sort or read, not a second list.
- **Dashboard drills stay as they are.** Where an existing target counts differently from the Insights number (e.g. Admissions `referral` drops Cancelled/Withdrawn, the Insights chart keeps them), add a new target rather than changing the dashboard's.
- KD #81 linkified identifiers, KD #80 cache headers and `invalidateDrillTags`, `meta.label` on every column (KD #161) — as every existing drill.

### 3. Per page — what each block opens

**Attendance** (`lib/attendance/drill.ts`; closest to done)

| Block                                          | Opens                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| Attendance rate · Days absent · Late incidents | `attendance-summary` · `absent` · `lates`, term window                        |
| Over their leave quota                         | **new** `over-leave-quota` — over only, both leave types, a Leave type column |
| Attendance mix slices                          | `lates` / `excused` / `absent`; **new** `present`                             |
| Term-by-term rate bars                         | `attendance-summary`, that term's window, that bar's year                     |
| Composition by term                            | the status's target, that term's window                                       |
| Watchlist card (per term) → See all            | `top-absent`, that term's window                                              |
| Compassionate "Over quota" → See all           | `over-leave-quota` segment `compassionate`                                    |
| Vacation leave → See all                       | `vacation-leave-quota` with the selected term                                 |

**Admissions** (`lib/admissions/drill.ts`; `DrillRow` gains `terminalReason`, `category`, `nationality`)

| Block                                               | Opens                                                                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Applications received                               | `funnel-stage` segment `Submitted` (excludes terminal, as the count does)                                                               |
| Conversion rate                                     | the same Submitted list, with Status                                                                                                    |
| Avg. days to enrol                                  | `avg-time`                                                                                                                              |
| Applications per month (point)                      | `applications`, that month, that year — predicate matched to `getIntakeTrendByAy` (all statuses, `created_at`)                          |
| Application experience (★ bar)                      | **new** `feedback-rating` segment `1`–`5` — its own row kind (applicant, rating, comment, date), read from `lib/admissions/feedback.ts` |
| Withdrawn by level (slice)                          | **new** `withdrawn-by-level` segment level                                                                                              |
| Entrance assessment (bar)                           | **new** `assessment-all` segment `math:pass` / `eng:notAssessed` … — includes terminal, as the chart does                               |
| Cancellation reasons (slice) · Top reason per level | **new** `terminal-reason` segment reason (`__other__` for the overflow bucket), optionally `level\|reason`                              |
| By source (slice)                                   | **new** `referral-all` — includes terminal                                                                                              |
| By category (bar)                                   | **new** `category` segment category, that bar's year                                                                                    |
| Nationality mix · nationality × level               | **new** `nationality` segment nationality, optionally `level\|nationality`                                                              |

**Records** (`lib/sis/drill.ts`; `RecordsDrillRow` gains `withdrawalReason`, `controllable`, `category`, `nationality`)

| Block                                                                                                   | Opens                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Enrolled · Distribution by level                                                                        | **new** `enrolled-headcount` (the `getInsightsHeadcount` predicate: non-withdrawn `section_students` rows), segment level code             |
| Retention rate · Retention by level                                                                     | **new** `retention` — last year's students, a Returned column; segment `level\|returned`                                                   |
| Late enrollees · Late by level · Late by term                                                           | **new** `late-enrollees`, segment level or term — the `rollupMovements` predicate                                                          |
| Who moves in and out (bar)                                                                              | `enrollments-range` / `withdrawals-range`, that month — each checked against `monthlyMovementSeries` and a new target added if they differ |
| Withdrawal reasons (slice) · controllability banner · Attrition (cell) · Withdrawals by level → See all | **new** `withdrawals` segment reason / `controllable` / `level\|reason` / level — the `rollup` predicate                                   |
| By category · Nationality mix · nationality × level                                                     | **new** `category`, `nationality` as Admissions, over enrolled students                                                                    |

**Markbook** (`lib/markbook/drill.ts`; rows are grade entries, not students — most new work)

| Block                                               | Opens                                                                                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top-band badge                                      | `grade-bucket-entries`, **new** segment `top` (vs + o together)                                                                                     |
| Performance across terms (bar)                      | **new** `subject-term-entries` segment `subjectCode\|T2`, that bar's year                                                                           |
| Subjects to watch (bar)                             | `subject-term-entries`, that subject, the latest term                                                                                               |
| Which levels are struggling (point)                 | **new** `level-term-entries` segment `levelCode\|T<n>` — the `getSubjectLevelTrend` predicate                                                       |
| Term-over-term movement (bar)                       | **new** `subject-level-entries` segment `subjectCode\|levelCode`, first + latest term, a Term column                                                |
| Change requests (30d) · Pending · Avg decision time | `change-requests` (all / `pending` / `decided`) — the drill's window becomes the summary's own rolling 30 days on `requested_at`, one shared helper |
| Sheets locked per term (bar)                        | `term-sheet-status` segment `T<n>` — every sheet in the term, a Locked column                                                                       |

Every average shown (subject, level, term) must equal the mean of the listed entries' `computedGrade` under the loader's own inclusion rules (whatever `lib/markbook/compare.ts` and `insights-level.ts` include or skip — read, not assumed) — the parity tests pin this.

## Build order — phased, each phase gated by tests + a review pass

1. **Shared charts** — the 8 click props; unit tests that the callback fires with the right arguments and the chart is unchanged without it.
2. **Attendance Insights** — `present`, `over-leave-quota`, selected-term vacation fix; wrappers; wiring.
3. **Admissions Insights** — row fields, 7 new targets, wiring.
4. **Records Insights** — row fields, new targets, wiring.
5. **Markbook Insights** — entry targets, change-request window, wiring.
6. **Docs** — a new KD (dashboards topic) recording "Insights pages drill, count = rows, rates open the denominator", plus `20-dashboards.md`.

## Testing

- **Parity test per new target**: on a fixture, the Insights loader's figure equals the drill's row count (or, for averages, the mean of its rows). This is the test that enforces goal 2.
- Chart click-prop tests (phase 1).
- `__tests__/ui/data-table-column-label-coverage.test.ts` passes for every new column.
- tsc + the module's test folder per phase; `next build` at the end; a browser pass over each page's clickable blocks before calling a phase done (open the page — RSC prop errors only fire at render, `next build` misses them).

## Risks

- **Markbook entry volume.** A subject × term list can be hundreds of rows; the drill sheet already paginates and lazy-fetches — confirm on AY2025 data before calling phase 5 done.
- **Loader predicates that are inline today** have to be extracted before they can be shared; that touches the Insights loaders, so their existing tests must stay green.
- **Feedback rows** may not carry an enrolee number for every response; if not, the rating list links what it can and shows the rest unlinked.
