# Attendance — Daily Entry View (mark-the-exceptions)

**Date:** 2026-05-31
**Module:** Attendance
**Status:** Design — pending implementation plan

## Context

The section attendance page (`app/(attendance)/attendance/[sectionId]/page.tsx`) renders an
Excel-style **whole-term grid** (`components/attendance/wide-grid.tsx`): rows = students,
columns = every encodable school day in the term. It is excellent for reviewing/correcting a
term, but clunky for the **recurring daily task** a form class adviser actually performs each
morning: "mark everyone present except the few who aren't." In the grid you must locate
today's column (a tall thin strip) and tap down it cell by cell.

This adds a focused **Daily entry view** as an additive, faster on-ramp to the _same_
`attendance_daily` table. Nothing about the term sheet, the grid, or the write semantics
changes. It is opt-in behind a toggle.

**Decisions locked during brainstorming:**

1. **Problem** — taking _today's_ attendance is clunky in the wide grid.
2. **Interaction** — _mark-the-exceptions_: everyone assumed Present; teacher taps only the
   Late / Absent / Excused students; one **Submit** writes `P` for the rest.
3. **Surfacing** — a **"Term sheet | Daily" toggle** on the existing page; **Term sheet stays
   the default** (non-disruptive; Daily is discovered/opt-in).
4. **Date scope** — **any encodable school day in the selected term**, defaulting to today,
   via a constrained date stepper (so a forgotten day can be back-filled in the fast view
   instead of bouncing to the grid).

## Non-goals

- Weekly / monthly views (rejected during brainstorming — those are just column-window
  filters of the existing grid, not a distinct layout; YAGNI).
- Changing the term sheet, the per-cell write path, the rollup logic, or the default landing.
- Any new attendance status, `ex_reason`, or schema change. No migration.

## Architecture

### Surface

- **View toggle** lives in the page header actions row (a small segmented control / `Tabs`),
  **separate from the existing term switcher**. Daily always operates within the
  currently-selected term (`selectedTermId`). Term sheet is the default value.
- View state is **URL-driven** for deep-linkability and to survive the term-switch `<Link>`
  navigations the page already uses: `?view=daily` (absence/`?view=sheet` = the default grid).
  The term switcher links must preserve `view` when set.
- The Daily view is a new client component `components/attendance/daily-entry.tsx`, mounted by
  the page when `view=daily`. It receives the same already-fetched data the grid uses
  (`enrolments`, `calendar`, `events`, `initialDaily`) plus the selected `termId` — **no extra
  server fetch** for the common path.

### Daily view layout (`daily-entry.tsx`)

- **Date strip** — `‹ Mon, 2 Jun ›` stepper. Steps only across the term's **encodable** days
  (`isEncodableDayType`, KD #50/#98 — `school_day` + `hbl` + `school_holiday` w/
  `hbl_overlay`). Default selected date = today if encodable & in-term, else the nearest
  encodable day `≤ today` within the term, else the first encodable day. Beside it a live
  tally chip: **Present N · Late N · Absent N · Excused N · M unmarked**.
- **Roster** — one row per **active + late-enrollee** student (withdrawn excluded). Left:
  index number + name (design-system row styling). Right: a **P / L / A / EX** segmented
  control. Every row initializes to **P in a muted "default/untouched" state**, visually
  distinct from an explicitly-set mark, so the teacher sees at a glance which rows they've
  actually touched.
- **EX reason** — selecting EX expands an inline reason picker
  (`MC / Compassionate / School activity / Vacation`, from `lib/schemas/attendance.ts`
  `ExReason`). An EX mark is **incomplete until a reason is chosen** — Submit is blocked (or
  that row flagged) while any EX row lacks a reason.
- **Late-enrollee gate** — a late-enrollee whose `enrollment_date` is **after** the selected
  date renders dimmed + non-interactive with a "Before enrolment date" tooltip (mirrors the
  grid, KD #113). Excluded from the Submit write set.
- **Non-encodable / out-of-term date** — the roster is replaced by an empty state
  ("No school day to mark on this date") — same gate the writer enforces server-side.
- **Sticky Submit bar** — primary `Button` "Submit attendance for {date}" + one-line summary
  ("23 present · 3 exceptions"). Disabled while saving or while an EX row is missing a reason.

### Pre-load (re-opening a day already done)

On mount and on each date change, the view derives existing marks for the selected date from
the daily data already on the page (`initialDaily`, latest-per-`(student,date)`). Students
with an existing mark show their **real status** (as an explicit, non-default mark); the rest
sit on default-Present. So re-opening a completed day shows prior marks, not a blank slate.
(Backfilling a date not represented in `initialDaily` — e.g. far past day not in the page's
loaded window — falls back to all-default-Present; acceptable for v1 since `initialDaily`
covers the term window the grid already loads.)

### Submit — `POST /api/attendance/daily/batch` (new route)

Request: `{ sectionId, termId, date, marks: Array<{ sectionStudentId, status, exReason }> }`
where `marks` is the **full write set the client computed**: for every active/late-enrollee
student whose `date ≥ enrollment_date`, the explicit mark if set else `P`.

Server behaviour:

1. **Auth** — `requireRole` matching the per-cell route's gate (teacher row-scoped +
   registrar/school_admin/superadmin); a teacher may only write sections they're assigned to.
2. **Encodable-date gate** — reject (409) if `date` is not an encodable day for the term, same
   check as `POST /api/attendance/daily`.
3. **Per-mark write** — reuse a **shared helper** (`lib/attendance/write-daily.ts`, factored
   out of the existing per-cell route so the two surfaces cannot drift): append-only insert
   (KD #6), validate status/exReason, skip late-enrollee-before-enrollment rows defensively,
   and **skip a row whose latest stored status+reason already equals the incoming value**
   (idempotent — re-submits don't pile up duplicate ledger rows).
4. **Rollup** — `recompute_attendance_rollup(termId, sectionStudentId)` per student that
   changed (skip unchanged) so `attendance_records` mirrors the ledger.
5. **Cache** — `invalidateAllOperationalDrills(ayCode)` / `invalidateDrillTags('attendance', …)`
   per KD #80, once after the batch.
6. **Response** — `{ written, skipped, exceptions }` counts for the success toast.

Audit: `attendance.*` prefix per KD #47 (one batch event, or per-row consistent with the
per-cell route — match whatever the per-cell route does today).

### After Submit

Success toast with the counts; `router.refresh()` so the term sheet, the four stat cards, and
the student-lookup dialog all reflect the new data immediately (they read from the same
server-fetched `initialDaily` / `summary`).

## Reused infrastructure

| Concern               | Reuse                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Encodable-day gate    | `isEncodableDayType` (`lib/schemas/attendance.ts`), `getEncodableDatesForTerm` / calendar helpers (`lib/attendance/calendar.ts`)                                         |
| Per-mark write logic  | **new** `lib/attendance/write-daily.ts` shared helper, extracted from `app/api/attendance/daily/route.ts` and consumed by both the per-cell PATCH and the new batch POST |
| Rollup                | `recompute_attendance_rollup` RPC                                                                                                                                        |
| Late-enrollee gate    | `section_students.enrollment_date` (KD #113)                                                                                                                             |
| EX reasons            | `ExReason` union (`lib/schemas/attendance.ts`)                                                                                                                           |
| VL quota soft-warning | optional parity with the grid's KD #94 toast (defer if not trivial)                                                                                                      |
| Drill cache           | `lib/cache/invalidate-drill-tags.ts` (KD #80)                                                                                                                            |
| Toggle state          | URL param `?view=`, same `<Link>`-preserving pattern as the term switcher                                                                                                |

## Components / files

- **New** `components/attendance/daily-entry.tsx` — the daily roster client component.
- **New** `app/api/attendance/daily/batch/route.ts` — batch submit endpoint.
- **New** `lib/attendance/write-daily.ts` — shared per-mark write helper.
- **Edit** `app/(attendance)/attendance/[sectionId]/page.tsx` — add the view toggle, read
  `?view=`, branch between `<AttendanceWideGrid>` and `<DailyEntry>`; preserve `view` in the
  term-switcher links.
- **Edit** `app/api/attendance/daily/route.ts` — refactor its write body to call the new
  shared helper (behaviour unchanged).
- **Edit** `lib/schemas/attendance.ts` — add a `BatchDailySchema` (zod) for the new route.

## Edge cases

- Day not encodable / outside term → roster replaced by empty state; server also 409s.
- Late-enrollee before `enrollment_date` → dimmed, excluded from write set + server-skipped.
- Withdrawn students → excluded entirely.
- EX without reason → Submit blocked; offending rows flagged.
- Double-submit / re-open + resubmit → idempotent (unchanged rows skipped server-side).
- VL exceeding per-term quota → soft warning toast (parity with grid, KD #94) — optional v1.
- No active students in section → empty state.

## Testing / verification

1. `npx next build` clean.
2. Manual happy path on a seeded section: open Daily, confirm everyone defaults to Present,
   mark 2 absent + 1 late + 1 EX(MC), Submit → toast counts correct; switch to Term sheet and
   confirm those four marks + the rest-present landed on that date's column; stat cards update.
3. Re-open the same date in Daily → prior marks shown (not blank); re-submit with no changes →
   "0 written" (idempotent), no duplicate ledger rows.
4. Step the date back to a prior encodable day, mark, Submit → lands on the correct column.
5. Pick a holiday/weekend (shouldn't be reachable via the stepper) and a far-future term →
   empty state.
6. Late-enrollee row dimmed before its enrollment date; withdrawn excluded.
7. Teacher-role row-scoping respected; registrar+ can submit any section.

## Open questions (resolve in plan, low-risk)

- Audit granularity: one batch event vs per-row — match the per-cell route's current pattern.
- Whether to surface the VL soft-warning in v1 or defer.
