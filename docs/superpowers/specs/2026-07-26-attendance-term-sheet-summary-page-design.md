# Attendance Term Sheet Summary — dedicated page (revives the old Show Summary panel)

**Date:** 2026-07-26
**Status:** Approved, pending implementation plan

## Summary

The just-merged "Attendance summary" dialog (`docs/superpowers/specs/2026-07-26-attendance-summary-lookup-merge-design.md`) squeezed a whole-roster table into its default view, trading away genuine Excel-format fidelity for what fit in a `sm:max-w-4xl` modal. This spec pivots that: the dialog reverts to being purely **"Look up student"** (search-first, single-student, unchanged detail view), and the whole-roster view moves to a **dedicated page** that has room to actually replicate the real attendance workbook's wide layout — Term Total block first, then one 6-column block per month, side by side — the exact computation the original `wide-grid.tsx` "Show summary" panel did client-side before it was deleted, now run server-side over the whole roster.

Reachable via a **"View whole term summary"** button in the dialog's search state, opening in a new tab.

## Why not the existing `/attendance/summary` page

That page (`app/(attendance)/attendance/summary/page.tsx`, relocated from Records' Academic Summary in a July 22 redesign) already answers a related-but-different question: level-wide monitoring (AY × level × optional single-class filter) via `AttendanceSummaryView` — stat cards, a rate-distribution donut, per-class comparison bars, and a flat `DataTable` of Present/Late/Absent/Rate. No month breakdown, no Excel-wide-format, coordinator+ audience only.

This new page answers a narrower, different question: _"does this one class's sheet, for this one term, look right"_ — the teacher's own pre-lock audit, not a registrar's cross-class monitoring view. Different audience (includes teachers), different shape (month-by-month, not just a term total), different governing question. Kept as a separate surface with a distinct name — **"Term Sheet Summary"** — to avoid the two being confused.

## Why bespoke, not the shared `DataTable` shell

Investigated directly against the shell's code (`components/ui/data-table/index.tsx:619-636`): it calls TanStack's `table.getHeaderGroups()` (which _can_ model grouped columns) but never applies `colSpan`/`rowSpan` to header cells — grepped the whole file, `colSpan` only appears on empty-state rows. Feeding it a nested "Term Total → [Days, P, L, EX, A, Rate]" column definition would render six separate 1-column header cells, not one spanning label. It also has no sticky-left-column support (only sticky-header-_row_) and defaults to paginated, which this page shouldn't be (a spreadsheet-style summary wants everything visible/scrollable, not "page 1 of 3").

The real alternative — flatten to individually-named columns (`Jun · Days`, `Jun · P`, …) and use the shell as-is — was mocked up and considered seriously: it gets sort-by-any-column, search, and CSV export for free, and is genuine reuse of the shared shell rather than a one-off. Rejected because it loses the actual "looks like the sheet" recognition that's the whole point of this page (Excel has merged month header bands; a flat 24-30-column table with compound labels reads as a spreadsheet-_shaped_ table, not the sheet itself). **Decision: bespoke**, matching `wide-grid.tsx`'s own precedent of going bespoke for the same class of reason (dense, spreadsheet-like, read-heavy tables in this module aren't shell consumers).

## Route & access

`app/(attendance)/attendance/[sectionId]/summary/page.tsx`, query param `?term_id=` (mirrors the section page's own `?term_id=` pattern).

No new `ROUTE_ACCESS` entry needed: the path shape `/attendance/<uuid>/summary` doesn't match the literal string prefix `/attendance/summary` (a section id sits in between), so it falls through to the broader `/attendance` rule — `teacher | academic_coordinator | school_admin | superadmin` — the same roles that can already reach the section's Term sheet and the dialog this page is launched from. Verified in `lib/auth/roles.ts:744-757` (longer-prefix-wins; `/attendance/summary` and `/attendance/calendar` are carved out ahead of the general `/attendance` rule for exactly this reason, and this new path doesn't match either carve-out).

Page title: **"Term Sheet Summary"** (not "Attendance Summary" — avoids confusion with the existing page).

## Data flow

No new database query, no new formula. Reuses exactly what the section page (`app/(attendance)/attendance/[sectionId]/page.tsx`) already fetches for the Term sheet grid:

- `getDedupedSchoolCalendarForTerm(termId, sectionLevelType)` — the term's full school-day range (KD #76 audience precedence already resolved). This matters because a month the term hasn't reached yet should still render as a zeroed block (matching the real workbook — confirmed against the actual `AY2026 Term 3 Attendance.xlsx` earlier this session, where August/September showed as all-zero column blocks ahead of being reached).
- `getDailyForSection(sectionId, termId)` — the actual (deduped, latest-per-day) marks.

New pure function in `lib/attendance/sheet-summary.ts`:

```ts
export function buildTermSummaryRows(
  enrolments: WideGridEnrolment[],
  calendar: SchoolCalendarRow[],
  daily: DailyEntryRow[]
): {
  enrolment: WideGridEnrolment;
  months: MonthlySummary[];
  term: SummaryStat;
}[];
```

This is a direct revival of the `useMemo` that used to live in `wide-grid.tsx` before Task 7 deleted it (KD #151's original client-side `summaryRows` computation) — same idea, moved server-side, run once for the whole roster instead of live-recomputed per keystroke on one open grid. For each enrolment: build a `Mark[]` across every calendar date (`status: null` where no `attendance_daily` row exists for that date), **skip dates before `enrollmentDate`** (the late-enrollee proration fix — the original panel didn't do this because pre-enrollment cells simply stayed unmarked in the live grid; here we're iterating the full calendar directly, so the guard has to be explicit, same lesson as the dialog's Task 8 fix), then feed the array through the existing `summarizeByMonth()`. Formula, rounding (1dp), and "Total Days = count of marked P/L/EX/A days" semantics are all unchanged from what `sheet-summary.ts` has always done.

The page's RSC calls `buildTermSummaryRows` once with data it fetches the same way the section page does (same two loaders, same term resolution via `?term_id=` defaulting through `resolveCurrentTermId`).

## Layout

New component `components/attendance/term-sheet-summary-table.tsx` — a Server Component, no client JS required for the table itself (no search box in v1, see below).

**Masthead:** section + term identity (mirrors `SheetContextCard`'s eyebrow/title conventions), a term-tab switcher (`Link`s to `?term_id=`, same pattern as the section page's own tabs), and a link to the existing `.xlsx` export route (`GET /api/attendance/[sectionId]/export?term_id=`, KD #151 — already built, zero new work, just a link).

**Table:** one `<table>`, two-row `<thead>` — top row: "Term Total" (indigo-tinted, matching the mockup) + one `colSpan={6}` header per month, in chronological order; second row: `Days | P | L | EX | A | Rate` repeated under each group. Student-name column `position: sticky; left: 0` so it stays visible while scrolling right through month blocks. Withdrawn students included with the existing "Withdrawn" `Badge` (consistent with the dialog's roster-table decision) — months after withdrawal render `—` across the row, matching how `buildTermSummaryRows` would naturally produce zero-day blocks with a null rate once a student's active marks stop.

Rate coloring reuses the existing `rateTone()` mint/amber/destructive bands (same thresholds as everywhere else in this dialog/page family) — no new color logic.

**No pagination, no search box (v1).** A section roster tops out at 50 students (Hard Rule #5); the whole table is meant to be scannable/scrollable like the paper sheet it replicates, and browser find-in-page covers search for a table this size. A client-side name filter is a cheap, isolated add later if it turns out to matter — deliberately deferred, not designed around, to keep this page a pure Server Component.

## Changes to the dialog (`StudentLookupSheet`)

This reverts most of the roster-table work from the just-merged spec (`2026-07-26-attendance-summary-lookup-merge-design.md`, Tasks 5 & 7's undo target — flagged explicitly since it's removing code that was reviewed and merged days ago):

- The search/list default state goes back to a flat, searchable list of students (as it was before that merge) rather than the sortable Days/P/L/EX/A/Rate table.
- The list state gains a **"View whole term summary"** button/link, opening `/attendance/[sectionId]/summary?term_id=<the dialog's current termId prop>` in a new tab (`target="_blank"`) — the dialog already receives `termId` as a prop (added in the fix wave for the roster/detail term-mismatch bug), so this is a direct, already-correct link, no new plumbing.
- The per-student detail view (State 2 — hero, trend chart, month table, previous terms, recent absences) is **completely unchanged**. Nothing about the merge that just shipped for that half is touched.
- Trigger button label: reconsider "Attendance summary" → likely back to **"Look up student"**, since the dialog is no longer also the roster-summary surface (the page owns that name/role now). Confirm during planning, not a structural decision.

`lib/attendance/queries.ts`'s `getRollupForSection` export, `presentOnlyCount`/`rollup-math.ts`, and the `student-summary` route's `currentTermMonths` field all stay — none of that was roster-table-specific, all of it still serves the detail view.

## Edge cases

- **Zero students in section:** existing empty-state pattern (mirrors `wide-grid.tsx`'s "No students enrolled" card).
- **No calendar configured for the term:** existing empty-state pattern (mirrors `wide-grid.tsx`'s "No calendar configured" card, same CTA to `/sis/calendar`).
- **A student with zero marks anywhere yet:** every month block renders as a zeroed row (`Days: 0`, rate `—`) — same convention already used elsewhere in this module.
- **Late enrollee:** months/dates before `enrollmentDate` excluded from that student's row entirely (not zeroed — simply not counted), matching the dialog's Task 8 fix.
- **Withdrawn mid-term:** months after the withdrawal date show as zeroed/`—` blocks (no marks exist for those dates for that student), Withdrawn badge on the name.

## Testing

- Unit test `buildTermSummaryRows` in `lib/attendance/sheet-summary.test.ts` (fixtures: a normal student, a late enrollee with pre-enrollment marks that must be excluded, a student with zero marks in a future month, a withdrawn student).
- Component test for `term-sheet-summary-table.tsx`: renders the two-row grouped header correctly (term total + N month groups), renders withdrawn badge, renders `—` for a null-rate month.
- Manual check: numbers on this page for a given student/month should equal what that same student's dialog detail view shows for that month (both now derive from the same `summarizeByMonth`-family formula, so this is a wiring check, not a new formula check).
- No route-level automated test (consistent with this module's existing pattern — RSC pages aren't covered by the current test harness); verified via `npx next build` + manual click-through.

## Out of scope

- No search/filter box in v1 (see Layout).
- No editing — this page is read-only, same as the original Show Summary panel and the dialog's roster table were.
- No change to the `.xlsx` export route itself — this page only links to it.
- No change to the existing `/attendance/summary` (level-wide) page.
- No change to the per-student detail view (dialog State 2) beyond the button addition and prop already in place.
