# Attendance Module (Daily Attendance)

> **Status:** ✅ **Shipped (Phase 1 + 1.1 live; KD #151 term-sheet redesign shipped 2026-06-26).** The Attendance module owns the daily ledger, the term-sheet grid, the xlsx export, and the rollup write path. Phase 2 (period-level, requires Scheduling) remains deferred.

## Why this doc exists

This doc owns the **module contract** (sole writer, three read-only consumers), the **schema**, and the shipped workflow — including the Phase 1.1 term-sheet redesign (KD #151) that makes the in-system grid recognisable to HFSE staff who know the Excel workbook. The Markbook module's old `/admin/sections/[id]/attendance` grid has been removed; all attendance entry now goes through `/attendance/*`.

## Contract

**Sole writer.** The Attendance module is the only write surface for daily attendance data. Every other module is a read-only consumer:

- **Markbook** reads the term-summary rollup from `attendance_records` for report-card rendering (unchanged from today's shape). Per-section surfaces under `/markbook/sections/[id]` render a compact attendance summary card (current-term counts) with a **"Mark attendance →"** deep-link button to `/attendance/[sectionId]?date=today`. No editable grid inside Markbook.
- **Records** grows a read-only Attendance tab on `/records/students/[enroleeNumber]` — chronological log of daily entries for the selected student across the current AY (cross-AY lookup via `studentNumber`).
- **Parent portal** sees the term-summary on the published report card only (unchanged).

All cross-module links open the Attendance module for edits; none of them embed an editable grid. This keeps one owner per domain — matching KD #31 (P-Files repository), KD #25 (change-request workflow as sole post-lock write path), KD #37 (Records writes admissions; SIS is sole writer of `'Rejected'`). Single audit prefix `attendance.*`, single cache tag, single rollup write path.

## Agreed decisions (do not re-derive)

### 1. Daily-only for Phase 1

One record per student × school-day × status (`present / absent / tardy / excused` at minimum; reason codes TBD from Excel). Period-level attendance (one record per student × day × period) is **Phase 2 at earliest** and requires the Scheduling module as a hard prerequisite (you need to know what periods exist before marking attendance against them).

Schema shape to accommodate later period-level expansion without a breaking migration:

- The daily-attendance table will include a nullable `period_id` column from day one.
- Phase 1 writes `period_id = NULL` on every row (interpreted as "whole-day status").
- Phase 2 (when Scheduling lands) starts writing non-null `period_id` without touching Phase 1 rows.

Status vocabulary and core columns frozen from the Excel reference (see §Data model). Reason codes — `EX` (excused: MC, compassionate leave, school activity) is the only one HFSE tracks at the daily level today; `urgent_compassionate_leave` quota lives on student/section metadata, not here.

### 2. Hybrid placement — entry surface at `/attendance/*`, student-detail tab in Records

Daily entry is inherently **per section** — teachers mark their whole class at once, not student-by-student. So the entry surface is its own route group:

- `/attendance/*` — per-section daily grid, own sidebar entry, module switcher lists it as a fourth module alongside Markbook / P-Files / Records.

Consumption is inherently **per student** — the question "when was Juan absent this term?" is answered on his profile. So the Records student-detail page grows a fifth tab:

- `/records/students/[enroleeNumber]?tab=attendance` — chronological attendance log for this student across the current AY (and optionally cross-AY via `studentNumber`).

Both surfaces read from the same daily-attendance table. Entry writes on the section surface; the student tab is read-only.

### 3. Existing `attendance_records` table stays as a rollup target

Markbook's report card consumes term-summary counts from `attendance_records` today (KD #5 in `03-workflow-and-roles.md`, rendered by `ReportCardDocument`). Retiring that table would touch Markbook's report-card fetch path — we don't want to.

The contract instead: the Attendance module becomes the **feeder** for `attendance_records`. On every daily-attendance write, the module also updates the corresponding term's summary row (or a nightly rollup job does it). Markbook's read path is unchanged.

This updates one row in `15-markbook-module.md` "Planned migrations": attendance entry _moves_ to this module, but the `attendance_records` table _stays_ (consumed by both modules — Attendance writes, Markbook reads for report cards).

**Decision:** write-through. Every daily write (import, live-entry PATCH, correction) recomputes the `attendance_records` row for the same `(term_id, section_student_id)` in the same transaction. Trivial given Phase 1's flat status vocabulary — `days_present = count(P∪L∪EX)`, `days_late = count(L)`, `days_excused = count(EX)`, `days_absent = count(A)`, `school_days = count(status != 'NC')`, `attendance_pct = round(days_present / school_days * 100, 2)`.

### 4. School calendar has five typed day-types (migration 019 — KD #50)

`school_calendar.day_type` replaces the binary is_holiday flag with five values:

| Day type         | Encodable? | Header tint       | Semantics                                                       |
| ---------------- | ---------- | ----------------- | --------------------------------------------------------------- |
| `school_day`     | ✅ yes     | muted             | Regular in-school day. Attendance taken.                        |
| `hbl`            | ✅ yes     | primary (blue)    | Home-based learning. Attendance taken; counts in `school_days`. |
| `public_holiday` | ❌ no      | destructive (red) | National / public closure (e.g. CNY Day 1).                     |
| `school_holiday` | ❌ no      | amber             | School-only closure (staff PD, founder's day).                  |
| `no_class`       | ❌ no      | muted grey        | School-wide no class (typhoon, assembly block).                 |

Writes to `/api/attendance/daily` reject with 409 on any non-encodable day-type. The rollup in §3 is unchanged — `school_days = count(status != 'NC')` naturally collapses to encodable days only because non-encodable days produce no rows (or `NC` rows if a registrar back-fills).

`is_holiday` stays on the column via a BEFORE INSERT/UPDATE trigger (`is_holiday = day_type NOT IN ('school_day','hbl')`) for backwards-compat until every consumer migrates to `day_type`.

"Special events" (Math Week, school photos, PTC) stay on the separate `calendar_events` overlay table — they're labels, not day-types. Rendered as a typed gradient chip on calendar + grid headers.

### 4.1 Audience scope + typed event categories (migration 037 — KD #76)

Both `school_calendar` and `calendar_events` now carry `audience IN ('all', 'primary', 'secondary')` (default `all`). `calendar_events` also carries `category IN ('term_exam', 'term_break', 'start_of_term', 'parents_dialogue', 'subject_week', 'school_event', 'pfe', 'ptc', 'other')` and a `tentative bool` flag. KD #50 day-types are unchanged — new event types (term exam, parents dialogue, PFE, PTC, etc.) live on the overlay layer, never as day-types.

**Audience-precedence rule.** `school_calendar` unique key widened to `(term_id, audience, date)` so primary and secondary can each hold a row for the same date. On read, an audience-specific row beats the matching `'all'` row. Attendance writer at `app/api/attendance/daily/route.ts` resolves the section's level via `lib/sis/levels.ts::levelTypeForAudienceLookup` and queries `audience IN ('all', $level_type)` with `audience = $level_type` taking precedence. Preschool sections (YS-L/J/S) fall back to `audience='all'` (preschool-specific overrides deferred for a later iteration).

**Calendar admin filter** at `/sis/calendar` exposes an `?audience=all|primary|secondary` filter tab. The active filter scopes day-type click-cycles + event-create to the selected audience; `'Reset to All'` removes the override row. Tentative events render dashed/dimmed; "Tentative only" toggle filters the view for a quick review sweep. `'Confirm dates'` action on the Events panel flips `tentative=false`.

**Carry-forward** stays manual via the `Copy from prior AY` dialog (`components/attendance/copy-from-prior-ay-dialog.tsx` — replaces the legacy holiday-only copy dialog). Two tabs (day-type overrides + events) with year-shift; default `markTentative=true` flips every copied row to `tentative=true` so the registrar reviews each before locking. No template table, no auto-copy on AY creation.

## Routes (shipped)

- `/attendance` — analytics dashboard (registrar+ only, KD #55). Aggregate attendance stats, drill-down cards, quota cards (compassionate + vacation leave).
- `/attendance/sections` — section picker (teachers land here and cannot see the analytics dashboard).
- `/attendance/[sectionId]` — per-section attendance surface with **Term sheet | Daily view** toggle (KD #116).
  - **Term sheet** — the HFSE register grid. See §Term-sheet redesign below.
  - **Daily view** (`components/attendance/daily-entry.tsx`) — mark-the-exceptions today-centric surface; roster defaults to Present, teacher flips absences/lates/EX.
- `/attendance/[sectionId]/export?term_id=` — `GET` → `.xlsx` download (SheetJS, `lib/attendance/sheet-export.ts`). Gate: registrar+ or assigned teacher.
- `/attendance/students/[studentNumber]` — per-student attendance detail page. Compassionate leave quota card + vacation leave quota card.
- `/attendance/insights` — Attendance Health Insights (KD #142). Over-time: rate trend, chronic-absentee watchlist, absence causes, leave-quota risk.
- `/attendance/audit-log` — module-scoped audit log (`attendance.*` prefix allowlist).
- `/sis/calendar` — school-calendar admin (SIS Admin, KD #76). Primary/secondary audience tabs; carry-forward dialog. The Attendance sidebar keeps a cross-module link.

## Data model

Two tables: a new append-only raw ledger (`attendance_daily`) and the existing rollup target (`attendance_records`, additively extended). Markbook's existing read path — `term_id`, `section_student_id`, `school_days`, `days_present`, `days_late` — is unchanged.

```sql
-- Raw ledger — one row per student × school-day.
create table public.attendance_daily (
  id                  uuid primary key default gen_random_uuid(),
  section_student_id  uuid not null references public.section_students(id) on delete restrict,
  term_id             uuid not null references public.terms(id) on delete restrict,
  date                date not null,
  status              text not null check (status in ('P','L','EX','A','NC')),
  -- Phase 2 forward-compat hook for period-level attendance. Phase 1 writes NULL.
  period_id           uuid references public.periods(id),
  recorded_by         uuid references auth.users(id),
  recorded_at         timestamptz not null default now(),
  -- Corrections: new row supersedes via recorded_at desc; audit_log carries the diff.
  unique (section_student_id, date, period_id)
);
create index attendance_daily_term_section_idx
  on public.attendance_daily (term_id, section_student_id, date desc);

-- Existing rollup target — ALTER TABLE to add the 3 new columns from Excel.
-- Keeps Markbook's read path (school_days, days_present, days_late) unchanged.
alter table public.attendance_records
  add column if not exists days_excused   smallint default 0,
  add column if not exists days_absent    smallint default 0,
  add column if not exists attendance_pct numeric(5,2);
```

Append-only per Hard Rule #6 — corrections write a new `attendance_daily` row rather than UPDATE the prior one; `audit_log` carries the diff under `attendance.daily.update` / `attendance.daily.correct`. Rollup recomputes on every daily write (see §Agreed decisions §3).

**Out of scope** (not attendance-owned data, even though they appear on the Excel sheet):

- `bus_no` — belongs on `section_students` or a future `transport` domain.
- `classroom_officers` (e.g. `HAPI HAUS` role) — belongs on `section_students` as a role tag.
- `urgent_compassionate_leave` 5-day quota — belongs on student profile as a yearly-quota counter; the attendance module reads it (to warn teachers before approving an EX mark that would exceed quota) but doesn't own the column.
- Monthly breakdown percentages (Jan %, Feb %, Mar %) — derivable from `attendance_daily` at render time; no extra storage.

## Access

- **Teachers** — write own class (via `teacher_assignments` gate, same as Markbook grading). The daily grid for `/attendance/[sectionId]` filters sections to the teacher's assigned sections.
- **Form advisers** — read + write own section across all subjects (attendance is usually the adviser's daily homeroom mark, not per-subject).
- **Registrar** — read/write any section, correct historical entries, audit.
- **Admin / superadmin** — read all; write via audit-logged override (TBD whether admins should routinely write or only correct).
- **Parents** — read attendance on the published report card (existing surface; unchanged).

Role strategy stays consistent with the rest of the SIS — no new role needed.

## Workflows

1. **Excel bulk import** (registrar). `POST /api/attendance/import` with the term's Excel file. Per sheet (one per section — naming convention matches grading sheets: `P1 Patience(G)`, etc.):
   - Match each student row by `index_number` + `section_id` + `term_id`; flag unmatched rows as import errors (don't skip silently).
   - Insert `attendance_daily` rows for every date column in the header (Jan 8 – Mar 13 in the T1 reference), status codes direct from cells.
   - Recompute + upsert `attendance_records` rollup per student in the same transaction.
   - Import summary response: `{ sections, studentsMatched, studentsUnmatched, dailyRowsWritten, errors[] }`.
   - Audit log: one `attendance.import.bulk` row per sheet with `{ section_id, term_id, rows_written, unmatched }` context.
2. **Live daily entry** (teacher / form adviser). Teacher opens `/attendance/[sectionId]`, lands on today's date, sees the roster with status defaulting to "unmarked". Clicks cells to set `P / L / EX / A` (`NC` is reserved for the registrar — used for holidays and not-yet-enrolled rows, not a teacher-facing option). Autosave per cell, mirroring the Markbook grading grid pattern (see `11-performance-patterns.md` §5 for the stale-closure guard). Rollup recomputes on every save.
3. **Historical correction** (adviser / registrar). Same grid, pick a past date via the DatePicker, edit status. Writes a **new** `attendance_daily` row that supersedes the prior by `recorded_at desc` — Hard Rule #6 — and recomputes the rollup. Audit log row is `attendance.daily.correct`.
4. **Per-student review** (registrar + student profile visitors). Records student detail → Attendance tab → chronological log grouped by month, term-summary chips at the top (`Present: N · Late: N · Excused: N · Absent: N · %: NN`).
5. **Report-card consumption** (Markbook). `ReportCardDocument` reads `attendance_records` for the selected term (interim T1–T3) or all four terms (T4 final). Cumulative `attendance_pct` for T4 is computed at render time — `SUM(days_present) / SUM(school_days) × 100` across T1–T4 — not stored.
6. **Rollup.** Write-through on every daily write (see §Agreed decisions §3). No nightly job.

## Term-sheet redesign (KD #151, shipped 2026-06-26)

Makes the in-system Term sheet visually recognisable to staff coming from HFSE's `AY2026 Term 3 Attendance.xlsx` workbook. All data resolves from existing tables — no migration.

### Register masthead

A collapsible header (`components/attendance/sheet-context.tsx`) above the grid:

- **Gradient-tile header** with serif virtue name (term's `virtue_theme`) + course·term eyebrow + school-name + meta strip.
- **Always-visible sheet legend** (`components/attendance/sheet-legend.tsx`, `<SheetLegend canWriteNc>`) — two hairline-split groups: **Cell marks** (P / L / EX / A, plus NC when the viewer can set it) and **Date columns** (school day / PH / SH / HBL / NC / SE / EX). It lived under the grid until 2026-07-28; a teacher reading an unfamiliar colour had to scroll past two months of columns to decode it. The mark swatches read `STATUS_CELL_WASH` and the tag pills read `DAY_TYPE_CHIP_COLOR` / `COLUMN_TAG_COLOR`, so legend and sheet cannot drift (§10.2). Tested in `__tests__/attendance/sheet-legend.test.tsx`.
- **Collapsible term-calendar key** listing the term's dated events under the same SE / SH / PH / EX chips.

### Date-column tags (`components/attendance/column-tags.ts`)

`resolveColumnTag(date, calendarRow, calendarEvents)` derives the header tag for each date column (single source for the grid AND the xlsx export):

- `PH` — `school_calendar.day_type='public_holiday'`
- `SH` — `day_type='school_holiday'` (without HBL overlay)
- `HBL` — `day_type='hbl'` or `school_holiday + hbl_overlay=true`
- `NC` — `day_type='no_class'`
- `EX` — event `category='term_exam'`
- `SE` — any other overlay event (school event, parents dialogue, etc.)
- Blank — regular school day

### Details + Summary toggles

Two collapsible column groups controlled by `SheetContext`:

- **Details** (hidden by default): Bus No. / Student Care columns (from `section_students.bus_no` + `classroom_officer_role`) + Academics / Admin placeholder columns (v1 read-only, pending HFSE definition).
- **Summary** (hidden by default): per-month attendance % + term totals columns, computed live by `lib/attendance/sheet-summary.ts`.

### HFSE summary formula (`lib/attendance/sheet-summary.ts`)

```
Attendance % = (Present + Late + Excused) / TotalDays
```

where `TotalDays` = count of cells with any of P / L / EX / A (i.e. marked days; NC + unmarked excluded). Rounded to 1dp; null when 0 days marked. **This intentionally diverges from the dashboard rollup's `Present ÷ school-days` — do NOT "align" them.** The dashboard measures absence risk; the register formula measures what HFSE reports to parents.

### Marking-palette popover (cell control redesign)

The per-cell native `<select>` / `<optgroup>` was replaced by:

- A plain `<button>` per cell showing the mark letter in the paper palette colour.
- **One shared "marking palette" popover** (`components/attendance/cell-mark-popover.tsx`, `CellMarkPalette`) — single portal, anchored to the active cell. Perf invariant changed from "native select per cell" to **"one shared popover"**.
- Status buttons stamp the cell in the HFSE paper palette (P light-blue · A yellow · EX cyan · L pink, KD #132).
- Excuse rows (MC / Vacation / Compassionate) show **this student's used/allowance inline** at point of entry (Vacation: `0/1 per term`; Compassionate: `0/5 per year`) — replaces the after-the-fact toast.

Shared single-source maps:

- `components/attendance/column-tags.ts` — `COLUMN_TAG_COLOR` (used by grid headers + the context-card key + the legend)
- `components/attendance/status-wash.ts` — `STATUS_CELL_WASH` (used by cells + the palette + the legend)

### xlsx export (`GET /api/attendance/[sectionId]/export?term_id=`)

Built by `lib/attendance/sheet-export.ts::buildAttendanceSheetWorkbook` via SheetJS (`xlsx`). Reproduces the HFSE workbook layout: every date column (including weekends), locale-independent date formatting, column tags, masthead rows, all student rows with status marks. Gate: registrar+ or assigned teacher. An "Export sheet" button in the grid toolbar triggers the download.

## Relationship to other modules

- **Markbook** — consumes the rollup (`attendance_records`) for report-card rendering (unchanged read path: `term_id`, `section_student_id`, `school_days`, `days_present`, `days_late`). Markbook's `/admin/sections/[id]/attendance` grid was removed; all attendance entry goes through `/attendance/*`.
- **Records** — per-student Attendance tab on `/records/students/[studentNumber]` reads from `attendance_daily`.
- **Evaluation** — attendance and leave-quota widgets reuse `lib/attendance/drill.ts` helpers.
- **Scheduling** (future) — Phase 2 prerequisite for period-level attendance. `period_id` column reserved on `attendance_daily`.
- **Audit log** — prefix `attendance.*` (`attendance.daily.update`, `attendance.daily.correct`, etc.). `/attendance/audit-log` uses an explicit `.in('action', allowlist)` filter — never a `.like('attendance.%')` wildcard (KD #9).

## Resolved decisions

- ✅ Status vocabulary: `P / L / EX / A / NC`. NC = school holidays / HBL / public holidays / not-yet-enrolled (non-teacher-selectable; used for column tagging only in the term sheet).
- ✅ Reason codes for EX: `mc` (MC / excuse leave), `compassionate`, `vacation` (migration 070 trimmed `school_activity`). Quotas: vacation 1/term · compassionate 5/year, per-student override on `section_students`.
- ✅ Who enters attendance: **both** — Excel import (registrar, `POST /api/attendance/import`) AND live daily entry (teacher / form adviser). Both paths shipped.
- ✅ School-calendar pre-publication: handled by `/sis/calendar` (registrar pre-marks day types; the term sheet only activates write-enabled cells on encodable days).
- ✅ Paper palette (KD #132): P = light blue · A = yellow · EX = cyan · L = pink.
- ✅ Per-month summary and Bus No. / Student Care columns shipped as Details / Summary collapsible groups (KD #151).
- ✅ `Academics` / `Admin` columns: v1 placeholder (read-only), pending HFSE definition.

## Out of scope

- Period-level attendance (Phase 2, requires Scheduling). `period_id` column reserved on `attendance_daily`.
- Late-minutes granularity (tardy = 10 min vs 45 min) — not tracked; `L` is binary.
- Daily attendance for non-students (staff, visitors).
- Clock-in / clock-out time tracking.
- Automated parent absence notifications.
- Attendance forecasting / ML.
- `Bus Summary` + `Reference - Dropdown` workbook tabs from the HFSE xlsx (deferred, KD #151).

## Appendix: Excel source layout

Preserved from the HFSE reference file so future sprints don't re-derive the layout.

- **Workbook:** `T1_Attendance_Jan-Mar.xlsx`. Term 1 window: January 8 – March 13, 2026 (47 school-days max).
- **Sheets:** one per section. Sheet-name matches the grading-sheet convention: `P1 Patience(G)`, `P1 Obedience`, `P2 Honesty (G)`, … `S4 Excellence`, plus `YS` (Little / Junior Stars pre-school level) and `Reserved` (unused placeholder).

**Per-sheet columns** (left to right):

| Column                          | Content                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `Index No`                      | Student's fixed index number — matches `section_students.index_number`                |
| `Bus No.`                       | School bus assignment (out of scope — see §Data model)                                |
| `Urgent/Compassionate Leave`    | 5-day yearly allowance tracker (out of scope — student-profile quota)                 |
| `Classroom Officers`            | Student role tag e.g. `HAPI HAUS` (out of scope — section-role tag)                   |
| `Full Name`                     | `LASTNAME, First Middle`                                                              |
| `Jan 8` … `Mar 13`              | One column per school-day — daily attendance code                                     |
| `Days present`                  | Excel-computed total (recomputed server-side on import, not trusted)                  |
| `Attendance %`                  | Excel-computed percentage (recomputed server-side)                                    |
| `Days late`                     | Excel-computed total (recomputed server-side)                                         |
| `Excused`                       | Excel-computed total (recomputed server-side)                                         |
| `Days absent`                   | Excel-computed total (recomputed server-side)                                         |
| `Total Days With Class`         | Total school-days applicable to this student (reconciled via `count(status != 'NC')`) |
| `Jan / %`, `Feb / %`, `Mar / %` | Monthly count + percentage — attendance-module dashboard only, not stored             |

**Attendance codes** (sole source of truth for Phase 1):

| Code | Meaning                                              | Counts as present?                              |
| ---- | ---------------------------------------------------- | ----------------------------------------------- |
| `P`  | Present                                              | ✅ Yes                                          |
| `L`  | Late                                                 | ✅ Yes (also counted in `days_late`)            |
| `EX` | Excused — MC / compassionate leave / school activity | ✅ Yes (also counted in `days_excused`)         |
| `A`  | Absent                                               | ❌ No                                           |
| `NC` | No Class — holiday / not yet enrolled                | ❌ Not applicable (excluded from `school_days`) |

**Field mapping (Excel → DB) on import:**

- `Index No` → `section_students.index_number` (match key, with `section_id` + `term_id`).
- Daily cells (`Jan 8` … `Mar 13`) → one `attendance_daily` row per (student, date) with the cell value as `status`.
- Excel-computed totals → **discarded on import**; rollup is recomputed server-side from `attendance_daily` in the same transaction per §Agreed decisions §3.
- Monthly breakdowns, bus*no, classroom_officers, urgent/compassionate-leave quota → \*\*parsed but not written to `attendance*\*` tables\*\* (future modules may claim them).

## See also

- `14-modules-overview.md` — cross-module hub (Attendance listed under Planned modules).
- `15-markbook-module.md` §"Planned migrations" — documents the boundary drift from Markbook to Attendance.
- `11-performance-patterns.md` §5 — autosave grid pattern Attendance should reuse.
- `03-workflow-and-roles.md` — role + access conventions.
- `05-report-card.md` — report-card rendering of term-summary attendance (unchanged).
- `CLAUDE.md` KD #47 — sole-writer contract.
