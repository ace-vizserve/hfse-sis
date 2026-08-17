# Academic Overview — session handoff (2026-08-17)

Read this after `/get-context`. It carries what is built, what is measured, and
what is left. Nothing here is committed yet — it is all in the working tree.

## What this is

`/records/academic-summary` gained a **school-wide view**. Landing with no
`?level` shows the whole school; the four filters (Term / Grade level / Class /
Subject) narrow **the same page in place** rather than navigating away. The
per-level masterfile still exists at `?view=masterfile&level=<id>`, reached by
an explicit button.

Approved mockup (real production figures): <https://claude.ai/code/artifact/db5988be-ab3a-42ae-90c8-088afd3ce929>

## Files

| File                                                                                                                                         | Role                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `lib/markbook/academic-overview-compute.ts`                                                                                                  | All the maths. Pure, no I/O, fully unit-tested.                                                              |
| `lib/markbook/academic-overview.ts`                                                                                                          | One sweep per AY, `unstable_cache` 60s, filters in the cache key.                                            |
| `lib/markbook/academic-overview-export.ts`                                                                                                   | xlsx + CSV of the three summary tables.                                                                      |
| `components/markbook/academic-overview-view.tsx`                                                                                             | The page body.                                                                                               |
| `components/markbook/overview-filter-bar.tsx`                                                                                                | Filters, applied-chips, Clear all, Hide filters.                                                             |
| `components/markbook/band-donut.tsx`, `band-composition-bar.tsx`, `grade-band-colors.ts`, `term-trend-chart.tsx`, `overview-export-menu.tsx` | Presentation pieces.                                                                                         |
| `app/(records)/records/academic-summary/page.tsx`                                                                                            | Wiring + `?view=masterfile` branch.                                                                          |
| `__tests__/markbook/academic-overview.test.ts`                                                                                               | 56 tests.                                                                                                    |
| `__tests__/markbook/academic-summary-scope-optin.test.ts`                                                                                    | Guards the opt-in flag + the empty-state branch.                                                             |
| `lib/attendance/risk.ts`                                                                                                                     | The 90% at-risk threshold, extracted so a pure module can share it. `lib/classroom/health.ts` re-exports it. |

Also touched: `lib/markbook/drill-filter.ts` (added `PASS_MARK`, `isPassingGrade`,
fixed `classifyGradeBucket`), `lib/markbook/academic-summary-scope.ts` (opt-in
`allowAllLevels`), `components/markbook/masterfile-toolbar.tsx`,
`components/markbook/grade-distribution-chart.client.tsx` (band colours hoisted),
`app/api/markbook/masterfile/export/route.ts` (all-levels branch).

## Two bugs found and fixed — both were silent

1. **Unordered pagination.** `fetchAllPages` walks `.range()`; PostgREST gives no
   stable order without `ORDER BY`, so past 1000 rows pages repeat and skip.
   Measured: the same 4,640 AY2026 grade entries yielded **3,534** distinct keys
   unordered. Every read in the new loader is now `.order('id')`.
   ⚠ **`lib/markbook/compare.ts` still paginates unordered** — the shipped
   Markbook Insights figures are probably affected. Not fixed; out of scope.
2. **Band gaps.** `GRADE_BANDS` upper bounds are 74/79/84/89, so a fractional
   _average_ like 89.5 matched no band and the student vanished from the
   distribution — 60 of 371 were missing. `classifyGradeBucket` now matches on
   lower bounds.

## Decisions already made (do not re-litigate)

- **Pass mark is 75**, derived from the FS band's `lo` so it cannot drift.
  `IP_FAILING_QUARTERLY = 80` and compare.ts's `≤79` are left alone deliberately.
- **Five HFSE bands**, not the mockup's four — grades floor at 60, so "below 60"
  is structurally empty.
- **Band colours are an ordinal ramp** (mint → sky → indigo → amber → red),
  shared with the Markbook grade-distribution chart via `GRADE_BAND_FILL`.
- **The grade-level bars sum exactly to the donut** — students are assigned to
  one level (their latest completed term). There is a test for this.
- **Named student lists only when a class is selected.** "Needs support" is
  everyone below 75, not a fixed bottom-N.
- **"Worth a look" decides nothing** — every line restates a figure already on
  the page; the pass mark is the only cutoff used.

## Production facts (measured 2026-08-17, read-only)

- AY2026: 406 students, 21 sections, 10 levels, 17/21 subjects, 260 sheets (240
  locked), 371 students with grades, average **85.8**, passing **91.9%**.
- Spread: O 99 / VS 122 / S 97 / FS 40 / DNM 13.
- Terms: T1 + T2 completed, **T3 in progress**, **no T4 row exists** — a data gap
  for Mr Ace to fix in SIS Admin, not a code problem.
- `terms.is_current` is `false` on every AY2026 row; use `resolveCurrentTerm`.
- AY2025 holds **51 examinable grades stored as 0**, which `transmute()` cannot
  produce. Surfaced on the page as a warning; not repaired.
- Attendance: **98.7%** present. Per-student rates are a spike, not a spread —
  348 of 371 sit at 95–100%, only **8 students below 90%**, **none below 70%**.

## The attendance report — BUILT (2026-08-17, second session)

Mr Ace supplied mockups adding an attendance trend, an attendance donut, two
tiles, and attendance columns on the student tables. The measurement above
killed the donut and confirmed the rest. All five items are built:

1. **Average attendance tile** — `attendance.presentRate`, with the movement
   between the first and latest reported term as its footer.
2. **Attendance trend** — `AttendanceTrendChart`, in `term-trend-chart.tsx`
   beside the grade one. Fed by `attendance.terms`.
3. **Students below 90% — a named table**, `attendance.concerns`.
4. **"Below 90%" count per grade level** on the ladder,
   `levels[].attendanceBelowThreshold`.
5. **`Attendance` column** on both class student tables,
   `studentLists[].attendanceRate`.

The four-band attendance donut was **not** built, for the reasons measured
above: 94% of students fall in one band, "below 70%" is empty in both years,
and "Late / Excused (80–89%)" labels a rate range with mark names. It would
also mint thresholds the school owns — the handbook rule is theirs to maintain
(the warning letter says 80%).

### Decisions taken while building it

- **The threshold moved to `lib/attendance/risk.ts`.** It lived in
  `lib/classroom/health.ts`, which carries `server-only` + a service client —
  the compute module is deliberately runtime-pure and cannot import it. A
  second copy of a threshold is the drift its own comment warns about, so it
  was extracted and `health.ts` re-exports it. Nothing else moved.
- **Both trend charts keep the same 60–100 axis.** Attendance sits at
  98-point-something, so a zoomed axis would turn a 0.8-point move into a
  dramatic climb — the same exaggeration that got the donut cut. The **90%
  reference line** does the work instead, drawn over the gridline it replaces
  and labelled in the legend as a reading aid, not a rule.
- **A term still being taught IS plotted on the attendance trend**, unlike the
  grade trend where partial marking drags the average. `school_days` on the
  rollup counts only days actually MARKED (migration 014 excludes `NC`), so a
  running term reports a true running rate. It is still withheld below the same
  20% cohort-coverage floor.
- **A concern is measured across all reported terms, not term by term** — a
  student who missed a stretch in Term 1 and has been in since is judged on the
  whole year, and appears once.
- **The named list appears at EVERY scope**, unlike the academic student lists,
  which stay class-only. The academic list is withheld school-wide because it
  is unbounded — at a pass mark of 75 it names every struggling child. This one
  is bounded by an explicit threshold (8 students school-wide) and naming them
  is the point: an attendance shortfall is an administrative fact the office
  acts on, and today finding out who means asking whoever keeps the register.
  The reasoning is written on `AttendanceHealth.concerns`, not just here.
- **The export carries the per-level count but NOT the names.** A workbook gets
  forwarded; a file naming children by attendance should be produced on
  purpose. `overviewScopeLines` says so in the file itself. Reverse this only
  if the school asks for it.
- **`buildOverviewHighlights` was left alone.** Nothing asked for attendance
  lines in "Worth a look", and that card's whole rule is that it invents
  nothing.

## State of the build (re-verified 2026-08-17, after the attendance work)

- `npx tsc --noEmit` — **clean**.
- `npx vitest run` — **3,039 passing across 331 files, no failures.** The three
  the other session was carrying (`data-table-advanced-export-*`,
  `country-combobox`) are green now.
- `npx next build` — **succeeds.** The `export-sheet-advanced.tsx` breakage
  noted below is resolved.
- If a build fails on `.next/dev/types/routes.d.ts`, it is the dev server and the
  build both writing `.next`: `rm -rf .next/dev/types .next/lock` and rebuild.

New tests: 12 in `__tests__/markbook/academic-overview.test.ts`, under
`attendance over the year` and `attendance concerns`.

## Not done

- Browser pass at 375 / 768 / 1024 / 1440 and a keyboard pass on the ladder rows.
  The ladder now carries **11 columns** — it is inside `overflow-x-auto`, but
  nothing has looked at it on a narrow screen.
- Nothing is committed; no KD written; `CLAUDE.md` and the dev plan are not synced.
