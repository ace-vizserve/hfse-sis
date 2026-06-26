# Attendance sheet — HFSE template fidelity

**Date:** 2026-06-25
**Status:** Design — approved sections, pending written-spec review
**Source artifact:** `AY2026 Term 3 Attendance.xlsx` (HFSE's current Term 3 attendance workbook)

## Goal

HFSE records attendance in an Excel workbook (one sheet per section). We want the in-system
attendance surface to feel like a **seamless transition** from that workbook — staff recognize it
immediately and don't feel they're learning a new tool — while the live experience is genuinely
**easier** (modern UI, progressive disclosure, autosave). A separate `.xlsx` export reproduces the
workbook **literally** so the artifact they print/share is unchanged.

Governing principle: **capture every component of the template, present it the modern way on screen,
reproduce it literally on export.** The on-screen Term sheet and the export read from the **same data**
so the screen-version and the printed-version can never drift.

## The template (what we are matching)

`AY2026 Term 3 Attendance.xlsx` contains 23 sheets:

- **`Bus Summary`** — cross-section bus roster with a live "fetched today?" lookup. _(Out of scope, v1.)_
- **One sheet per section**, named `<Level> <Virtue>` (e.g. `P1 Obedience`, `S1 Discipline - 1`) —
  matches the official virtue-section list (KD #144).
- **`Reference - Dropdown`** — Excel data-validation helper (`PH`/`SH`/`SE`/`EX` day-type codes).
  _(Out of scope — not a deliverable.)_

Each section sheet is a full-term register matrix:

- **Title band**: "HFSE INTERNATIONAL SCHOOL" / "STUDENT ATTENDANCE SHEET" (YS reads "HFSE YOUNGSTARTERS").
- **Header band** of labelled boxes: **Class Information** (Term · Course · Section · Form Class Adviser),
  **Legend** (`P` Present · `A` Absent · `EX` Excused (MC or Excuse Leave) · `L` Late — our KD #132 four
  statuses), and dated lists for **School Events · School Holiday · Public Holiday · Examination**.
- **Grid columns**: `Index No` · `Bus No. / Student Care` · `Academics` · `Admin` · `Full Name` · then
  one column per **calendar date** (full term window, incl. weekends), with `SH/SE/PH/EX` tags over the
  relevant date columns.
- **Summary blocks** after the dates: 5 repeating blocks (per calendar **month** June/July/Aug/Sep + a
  term total), each = Total Days With Class · Present · Late · Excused · Absent · Attendance %.
- **Student rows**: index number, bus/student-care label ("HAPI Haus", "BUS 5", "BUS 2/\*\*HAPI Haus", or
  "Withdrawn"), and daily P/A/EX/L marks.

### HFSE's exact summary formula (read from the workbook cells)

```
Total Days With Class = COUNTA(date range)          ; days carrying ANY mark (blank/holiday/weekend excluded)
Present  = COUNTIF(range, "P")
Late     = COUNTIF(range, "L")
Excused  = COUNTIF(range, "EX")
Absent   = COUNTIF(range, "A")
Attendance % = (Present + Late + Excused) / Total Days With Class
             = (Total Days − Absent) / Total Days
```

- **Only `A` (Absent) lowers the %.** Late and Excused both count as in-attendance.
- The denominator is **marked days**, not calendar school-days. Unmarked days (holidays, weekends, not-
  yet-encoded) are excluded.
- Monthly blocks apply the same formula via `COUNTIFS` bounded to each month
  (`>= DATE(y,m,1)` and `< DATE(y,m+1,1)`).

## Approach (chosen: A — one enhanced sheet with collapsible bands)

The existing `Term sheet | Daily` toggle stays. The **Term sheet** becomes the modern, template-faithful
encoding surface. The **Daily view** is untouched (fast "mark today's exceptions", KD #116).

## Surfaces

1. **Term sheet** — `app/(attendance)/attendance/[sectionId]/page.tsx` + `components/attendance/wide-grid.tsx`.
   The modern, template-faithful encoding surface. Bulk of the work.
2. **Daily view** — untouched.
3. **Export** — new `GET /api/attendance/[sectionId]/export?term_id=…` returning `.xlsx` (SheetJS), one
   worksheet per section, literal template reproduction. Triggered by an **"Export sheet"** button on the
   Term sheet.

## The live Term sheet (modern, Approach A)

Top-to-bottom, progressive disclosure so daily marking stays fast:

- **Context card** (top): Term · Course (level word-form) · Section (virtue) · Schedule · **Form Class
  Adviser**. Clean header card, not Excel boxes.
- **"Term calendar" disclosure** (collapsed by default): the four dated lists — School Events · School
  Holidays · Public Holidays · Examinations — as a tidy grouped list from calendar data.
- **Marking grid** (core; mechanics unchanged — native `<select>`, single `cells` Map, autosave per cell,
  perf invariants in `wide-grid.tsx` preserved): column tags extended from today's `PH/SH/HBL/NC` to also
  surface **`SE`** (school event) and **`EX`** (examination), derived from calendar events landing on the
  date; tooltip shows the event label. P/A/EX/L marking in the HFSE palette unchanged.
- **"Details" toggle** (off by default): reveals extra roster columns in the roster pane — `Bus No. /
Student Care`, `Academics`, `Admin`. Off by default so daily marking stays lean. Built **column-driven**
  (a small config array of roster-detail columns) so wiring real fields later is a config change, not a
  re-layout.
- **"Summary" toggle** (off by default): reveals per-student per-month + term stats (Total Days · P · L ·
  EX · A · %) computed in-browser from the `initialDaily` marks already loaded, using HFSE's formula above.

## Data mapping (everything resolves from existing tables — no v1 migration)

| Template element                 | Source (exists today)                                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Term                             | `terms.label`                                                                                                                                                                                                                         |
| Course                           | `levels.label` (word-form via `lib/sis/levels.ts`)                                                                                                                                                                                    |
| Section                          | `sections.name` (virtue, KD #144)                                                                                                                                                                                                     |
| Schedule                         | `sections.schedule` (KD #144, migration 074)                                                                                                                                                                                          |
| **Form Class Adviser name**      | resolve existing `adviserUserId` → email (`getTeacherEmailMap`) → display name (`getStaffDisplayEntries`, KD #126). **New wiring, no schema change** — the page fetches the adviser user-id today but stops short of the name.        |
| Legend P/A/EX/L                  | static (KD #132)                                                                                                                                                                                                                      |
| Public / School Holidays (PH/SH) | `school_calendar.day_type` (KD #50)                                                                                                                                                                                                   |
| School Events (SE)               | `calendar_events.category` ∈ {`school_event`,`start_of_term`,`parents_dialogue`,`subject_week`,`pfe`,`ptc`,`other`} (KD #76)                                                                                                          |
| Examinations (EX)                | `calendar_events.category = 'term_exam'` (KD #76)                                                                                                                                                                                     |
| Column tags `PH/SH/SE/EX`        | derived from the above; both already loaded on the page (`getDedupedSchoolCalendarForTerm`, `getCalendarEventsForTerm`)                                                                                                               |
| Attendance marks                 | `attendance_daily`                                                                                                                                                                                                                    |
| Index No · Full Name             | `section_students.index_number`, `students`                                                                                                                                                                                           |
| **Bus No. / Student Care**       | `section_students.bus_no` **+** `classroom_officer_role` — **already exist** (migration 015; its comment literally names `classroom_officer_role` = _'Student role tag (e.g. "HAPI HAUS")'_). Already rendered as badges in the grid. |
| Summary blocks                   | computed from `attendance_daily` (no storage)                                                                                                                                                                                         |

**Column tag priority:** a date can carry both a day-type and an SE/EX event. Resolve to the most
informative tag (exam/event over plain school day; a holiday day-type still wins its PH/SH tag).

**NC handling:** `NC` (no-class, registrar-only status) is **excluded from both numerator and
denominator** of the summary so it behaves like the template's blank cell (otherwise NC would wrongly
deflate the %).

## The export (`.xlsx` only)

- **Route:** `GET /api/attendance/[sectionId]/export?term_id=…`, SheetJS (the masterfile-export pattern,
  `!merges` for the title/group-header bands).
- **Gate:** `registrar | school_admin | superadmin` + the section's own teachers (mirrors the attendance
  read gate).
- **Output:** literal template reproduction — title band, Class-Info / Legend / Events / Holiday / PH /
  Examination header boxes, **every calendar date across the term window** (incl. weekends, tagged),
  P/A/EX/L marks, and the monthly + term summary blocks computed with HFSE's formula.
- One worksheet for the requested section (v1). Print-to-PDF is the user's own step from the `.xlsx`.

## The deferred `Academics` / `Admin` columns

Meaning is TBD (HFSE academics/admin to confirm); both are empty in every sheet of the file.

- **v1 (now):** both render as **labeled, read-only placeholder columns** in the "Details" toggle —
  present so the sheet looks complete and recognizable, but no encode and no persistence. The export
  includes the two empty columns in the layout (matching the template). **No migration.**
- **When HFSE answers:** a follow-up adds encode + persistence. Likely shape (to confirm): two `text`
  columns on `section_students` mirroring the migration-015 `bus_no` pattern, edited via the same per-
  student "Details" editor as Bus/Student Care. Small additive migration, isolated to that follow-up — it
  does not block v1.

## Out of scope (v1)

- The cross-section **`Bus Summary`** tab (separate artifact with a live "fetched today?" lookup) —
  candidate future export.
- The **`Reference - Dropdown`** sheet (Excel validation helper).
- `Academics` / `Admin` **encode + persistence** (deferred above).
- The **Daily view** (untouched).
- Multi-section "export all sheets in one workbook" — v1 is per-section; can extend later.

## Open confirmations (do not block starting)

1. ~~Attendance-% formula~~ — **RESOLVED** from the workbook: `(P + L + EX) / marked-days`. (Diverges
   deliberately from the dashboard's `Present ÷ school days`; dashboard rollup is **not** changed.)
2. ~~Summary granularity~~ — **CONFIRMED**: per calendar month (June/July/Aug/Sep) + term total.
3. `Academics` / `Admin` meaning + whether persisted (the deferred follow-up).

## Risks / notes

- **On-screen density:** the Term sheet is already a wide horizontal-scroll grid on Chromebooks. The
  context card, calendar disclosure, Details and Summary additions are all **collapsible / off by default**
  to protect the fast-encode path and the `wide-grid.tsx` render-perf invariants.
- **Formula divergence from the dashboard is intentional** and documented here so it isn't "fixed" later.
- **Export date range:** the export enumerates every date in the term window (incl. weekends) to match the
  template; the live grid continues to render only calendar-configured rows (cleaner on screen).

```

```
