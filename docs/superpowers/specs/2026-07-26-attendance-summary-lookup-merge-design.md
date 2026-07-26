# Merge attendance "Show summary" into "Look up student"

**Date:** 2026-07-26
**Status:** Implemented

## Summary

`/attendance/[sectionId]`'s Term sheet currently carries two overlapping
attendance-stat surfaces:

- **Show Summary** (`wide-grid.tsx`, KD #151) — an inline, always-in-page
  toggle showing every student's per-month + term-total breakdown for the
  currently-open term sheet. Computed client-side from the live in-memory
  grid (`cells` Map), so it reflects a just-clicked mark instantly.
- **Look up student** (`student-lookup-sheet.tsx`, KD #116) — a toolbar
  `Dialog` that searches one student and shows a rate ring, P/L/A/EX
  breakdown, cross-term history, recent absences, and a link to their full
  attendance page. Fetches from the canonical `attendance_records` rollup via
  `/api/attendance/student-summary`.

Investigation (this session) confirmed both use the **same underlying
formula** — `(Present + Late + Excused) / (Present + Late + Excused +
Absent)`, marked-days-only denominator — verified against
`recompute_attendance_rollup` (migration 068) and `sheet-summary.ts`
directly. They differ only in scope (one term vs. all terms), timing (live
unsaved grid state vs. last-saved DB rollup), and rounding precision (1dp vs
2dp). They are not two different metrics; Show Summary is effectively "Look
up student's current-term row, computed live instead of fetched."

Given that, and given Show Summary's inline panel gets long with a large
roster, this merges the two into one surface: `StudentLookupSheet` gains a
roster-table default view (replacing its flat name list), and Show Summary's
inline panel is removed from `wide-grid.tsx` entirely.

## Interaction model

One `Dialog` (evolves `StudentLookupSheet`, not a new component), widened
from `sm:max-w-2xl` to `sm:max-w-4xl`, with the same two-state pattern it
already has today — only the first state's content changes:

- **State 1 — Roster table (new default).** Every student in the section,
  current term, one row: `# | Student | Days | P | L | EX | A | Rate`.
  Existing search box filters by name. Column headers are click-to-sort
  (lightweight — not the full `@tanstack/react-table` `DataTable` shell; this
  is a compact in-dialog view, not a page-level data surface). Withdrawn
  students are included with the existing "Withdrawn" badge (matches today's
  list behavior — a canonical, saved rollup for a withdrawn student is still
  a real, meaningful frozen number). Clicking a row moves to State 2.
- **State 2 — Student detail (existing view, extended).** Unchanged: identity
  header, P/L/A/EX breakdown tiles, previous-terms table, recent absences,
  "View full attendance details" link. Two changes:
  1. The rate ring is replaced by a small `TrendChart` (see Visual design
     below) plotting current-term attendance rate by month.
  2. A new "This term by month" table is inserted between the hero and the
     previous-terms table — the exact granularity Show Summary provided,
     carried over.
- Trigger button renamed from "Look up student" to **"Attendance summary"**
  (it now also carries the roster-summary role). Dialog title stays dynamic:
  "Attendance summary" in State 1, "Attendance record" in State 2.

`wide-grid.tsx` loses: the `showSummary` state, its toggle button, the inline
`<Card>` summary panel, and the `SummaryStudentRows` component. The "Show
details" toggle (Bus/Student Care/Academics/Admin columns) is unrelated and
stays untouched. `lib/attendance/sheet-summary.ts` (`summarizeMarks` /
`summarizeByMonth`) is **not** deleted — it's still the formula source for
the `.xlsx` export (KD #151) and is now also reused by the detail view's
month table (see Data flow).

## Data flow

**Roster table (State 1)** — server-fetched, no client request:

- Export `getRollupForSection(sectionId, termId)` from
  `lib/attendance/queries.ts` (currently private; already computes exactly
  the per-student `RollupRow[]` needed — it's what `getSectionAttendanceSummary`
  aggregates for the page's existing stat cards).
- Call it once in `app/(attendance)/attendance/[sectionId]/page.tsx`'s
  existing `Promise.all` batch (alongside `getSectionAttendanceSummary`,
  `getSchoolConfig`), pass the rows down as a new `rollups` prop to
  `StudentLookupSheet`.
- Table rows = `enrolments` (existing prop) joined to `rollups` by
  `sectionStudentId`. No new API route.

**Student detail (State 2)** — unchanged fetch, extended response:

- `GET /api/attendance/student-summary` already fetches the student's raw
  `attendance_daily` rows (for "recent absences"). Extend the response with
  `currentTermMonths: MonthlySummary[]`, computed by feeding those same rows
  (deduped latest-per-`(date, period_id)`, filtered to the current term) into
  the existing `summarizeByMonth()` from `sheet-summary.ts`. No new
  calculation logic — reuses the formula Show Summary already trusted.
- `TermStat` (existing per-term row) is unchanged; `currentTermMonths` is
  additive.

Net new server code: one exported query function, one field added to one
existing route, zero new formulas, zero new API routes.

## Visual design — replacing the rate ring

The circular gauge-with-a-number-inside in State 2's hero is replaced with a
`TrendChart` (`components/dashboard/charts/trend-chart.tsx`, the existing
`next/dynamic`-wrapped Recharts `AreaChart`, KD #80) plotting the current
term's monthly attendance rate:

```
current: currentTermMonths.map(m => ({ x: m.label, y: m.stat.attendancePct ?? 0 }))
```

- `height` prop set small (~90-100px) to fit the compact hero — the default
  220px is for full dashboard panels, not a dialog hero.
- `yFormat="percent"`.
- No `comparison` series (single line only).
- Tooltip is the wrapper's existing built-in `Recharts <Tooltip>` (dashed
  cursor line, token-styled card) — no custom tooltip work. Confirmed via
  `trend-chart.client.tsx`: every chart wrapper in this codebase ships this
  tooltip already.
- The big percentage (e.g. "100%") + tone label ("Excellent"/"Watch"/"At
  risk") moves out of the ring and sits as plain text next to the student's
  name/number — same rate-band thresholds and colors the ring used
  (`rateTone()`, unchanged).
- P/L/A/EX breakdown tiles below the chart are unchanged from today.

**Edge cases:**

- Fewer than 2 months of current-term data (e.g. term just started): the
  chart renders with 1 point (a single dot, no line) — not specially
  handled; recharts degrades gracefully and this is a narrow, self-resolving
  window (next month's data fixes it).
- Zero months of current-term data (no marks yet at all): render the
  existing "no data" treatment instead of an empty chart box (matches how
  the detail view already degrades when a query returns nothing).

## Testing

- Unit test the new `currentTermMonths` branch in the `student-summary`
  route (dedup + monthly grouping against fixtures) — mirrors the existing
  coverage pattern for `sheet-summary.ts`.
- Component test: `StudentLookupSheet` roster table renders/sorts/searches,
  row click transitions to State 2, month table + trend chart render with
  the extended API response.
- Manual sanity check on a real section: roster-table current-term numbers
  should equal what the old Show Summary showed for that term (the formula
  equivalence is proven; this just confirms the wiring), and the month table
  in State 2 should match the roster row it was opened from.

## Out of scope

- No change to the "Show details" toggle or the `.xlsx` export path.
- No change to `sheet-summary.ts`'s formulas.
- No full `DataTable` shell adoption for the roster table (KD #84) — the
  in-dialog table stays lightweight/bespoke, consistent with its size (one
  section's roster, not a page-level surface).
- No changes to previous-terms display, recent absences, or the "view full
  history" link in State 2.
