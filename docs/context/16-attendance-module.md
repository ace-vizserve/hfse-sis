# Attendance Module (Daily Attendance)

> **Status:** ✅ **Sprint-ready.** Excel reference received (`T1_Attendance_Jan-Mar.xlsx`) — status vocabulary frozen (`P / L / EX / A / NC`), daily + rollup DDL specified below, Excel-import flow defined. 3 open questions remain (late-minutes granularity, school-calendar publication, parent daily visibility) — none block the Phase 1 build.

## Why this doc exists

Today the SIS has term-summary attendance only: one `attendance_records` row per student × term with `present / absent / tardy / excused` counts, entered once per term in the Markbook module's `/admin/sections/[id]/attendance` grid. This covers the report card's attendance column and nothing else.

A proper **Attendance module** owns the daily ledger those summaries should roll up from. It's the biggest gap in the SIS's "records connected to the student profile" shape — every other domain (grades, documents, pipeline) has per-event fidelity; attendance doesn't.

This doc owns the **module contract** (sole writer, three read-only consumers), the **concrete schema**, and the **Excel-import workflow** — everything a sprint needs to open. Excel reference landed; schema + status vocabulary frozen.

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

This updates one row in `15-markbook-module.md` "Planned migrations": attendance entry *moves* to this module, but the `attendance_records` table *stays* (consumed by both modules — Attendance writes, Markbook reads for report cards).

**Decision:** write-through. Every daily write (import, live-entry PATCH, correction) recomputes the `attendance_records` row for the same `(term_id, section_student_id)` in the same transaction. Trivial given Phase 1's flat status vocabulary — `days_present = count(P∪L∪EX)`, `days_late = count(L)`, `days_excused = count(EX)`, `days_absent = count(A)`, `school_days = count(status != 'NC')`, `attendance_pct = round(days_present / school_days * 100, 2)`.

## Routes (planned)

Phase 1 route surface, skeletal — actual components + URLs finalise once Excel-driven decisions land:

- `/attendance` — entry surface list (pick a section + date, similar to how Markbook `/grading` lists sheets).
- `/attendance/[sectionId]` — daily grid for a section (default: today). Columns: students; rows: days within the current term; cells: status. Autosave per cell, like the Markbook score grid.
- `/attendance/[sectionId]?date=YYYY-MM-DD` — specific date view (bookmarkable, deep-linkable).
- `/records/students/[enroleeNumber]?tab=attendance` — per-student log (new tab on the existing Records student detail page).
- Optional: `/attendance/audit-log` — module-scoped audit, mirroring `/p-files/audit-log` and `/records/audit-log`.

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

## Relationship to other modules

- **Markbook** — consumes the rollup (`attendance_records`) for report-card rendering. Markbook's `/admin/sections/[id]/attendance` route goes away once Attendance is live (or becomes a thin read-only summary view); `components/admin/attendance-grid.tsx` gets replaced by the Attendance module's daily grid.
- **Records module** — hosts the per-student Attendance tab (new). Reads the same daily-attendance table.
- **Scheduling** (future) — Phase 2 prerequisite for period-level attendance.
- **Audit log** — new action prefix `attendance.*` (e.g. `attendance.daily.update`, `attendance.daily.correct`). Existing Markbook `attendance.update` prefix migrates with the table ownership. `/admin/audit-log` will need to add `attendance.*` to its exclusion list if we want module-scoped separation (same pattern as `pfile.*` / `sis.*`).

## Open questions

Answered by the Excel reference — no longer blocking:

- ✅ Excel columns: `index_number`, `bus_no`, `urgent/compassionate_leave` quota, `classroom_officers`, `full_name`, daily status cells (Jan 8 – Mar 13), computed totals (days present/late/excused/absent), monthly breakdowns (Jan/Feb/Mar %). See §Appendix.
- ✅ Status vocabulary: `P / L / EX / A / NC` (NC = holidays + not-yet-enrolled).
- ✅ Reason codes for excused: single `EX` bucket — MC, compassionate leave, school-activity all fold in. Quota lives on student profile, not attendance.
- ✅ Half-days / early dismissals: not tracked in Phase 1. Any partial-day situation folds to `P` (showed up), `L` (arrived late), or `EX` (excused early leave).
- ✅ Period-level absences: deferred to Phase 2 (needs Scheduling). `period_id` column reserved from day one.

Still open — none blocks the Phase 1 build:

- [ ] **Late-minutes granularity** (tardy = 10 min vs tardy = 45 min). Proposal doesn't answer. If HFSE wants this, add `late_minutes smallint` to `attendance_daily` in Phase 1b.
- [ ] **School-calendar publication.** Needs the registrar to publish the list of school days ahead of time so the daily grid pre-renders only weekdays in session (vs. `NC`-marking every holiday reactively after the fact). Affects grid UX, not schema.
- [ ] **Parent daily visibility.** Today parents only see the report-card rollup. Not needed for Phase 1; revisit if a stakeholder asks.
- [ ] **Who enters attendance today.** Excel reference shows Joann imports centrally; teacher live-entry is *planned* but not confirmed as a current HFSE habit. **Sprint-kickoff decision** — if teachers won't do live entry immediately, ship the import flow first and add the live grid in a 1b bite.

## Out of scope (until explicitly pulled in)

- Period-level attendance (Phase 2, requires Scheduling).
- Daily attendance for non-students (staff, visitors).
- Clock-in / clock-out time tracking (this is attendance, not timesheet).
- Automated absence notifications to parents (email on 3rd consecutive absence, etc.) — Communications-module territory.
- Dashboard analytics over attendance rates — Reports-hub territory.
- Attendance forecasting / ML.

## Appendix: Excel source layout

Preserved from the HFSE reference file so future sprints don't re-derive the layout.

- **Workbook:** `T1_Attendance_Jan-Mar.xlsx`. Term 1 window: January 8 – March 13, 2026 (47 school-days max).
- **Sheets:** one per section. Sheet-name matches the grading-sheet convention: `P1 Patience(G)`, `P1 Obedience`, `P2 Honesty (G)`, … `S4 Excellence`, plus `YS` (Little / Junior Stars pre-school level) and `Reserved` (unused placeholder).

**Per-sheet columns** (left to right):

| Column | Content |
|---|---|
| `Index No` | Student's fixed index number — matches `section_students.index_number` |
| `Bus No.` | School bus assignment (out of scope — see §Data model) |
| `Urgent/Compassionate Leave` | 5-day yearly allowance tracker (out of scope — student-profile quota) |
| `Classroom Officers` | Student role tag e.g. `HAPI HAUS` (out of scope — section-role tag) |
| `Full Name` | `LASTNAME, First Middle` |
| `Jan 8` … `Mar 13` | One column per school-day — daily attendance code |
| `Days present` | Excel-computed total (recomputed server-side on import, not trusted) |
| `Attendance %` | Excel-computed percentage (recomputed server-side) |
| `Days late` | Excel-computed total (recomputed server-side) |
| `Excused` | Excel-computed total (recomputed server-side) |
| `Days absent` | Excel-computed total (recomputed server-side) |
| `Total Days With Class` | Total school-days applicable to this student (reconciled via `count(status != 'NC')`) |
| `Jan / %`, `Feb / %`, `Mar / %` | Monthly count + percentage — attendance-module dashboard only, not stored |

**Attendance codes** (sole source of truth for Phase 1):

| Code | Meaning | Counts as present? |
|---|---|---|
| `P` | Present | ✅ Yes |
| `L` | Late | ✅ Yes (also counted in `days_late`) |
| `EX` | Excused — MC / compassionate leave / school activity | ✅ Yes (also counted in `days_excused`) |
| `A` | Absent | ❌ No |
| `NC` | No Class — holiday / not yet enrolled | ❌ Not applicable (excluded from `school_days`) |

**Field mapping (Excel → DB) on import:**

- `Index No` → `section_students.index_number` (match key, with `section_id` + `term_id`).
- Daily cells (`Jan 8` … `Mar 13`) → one `attendance_daily` row per (student, date) with the cell value as `status`.
- Excel-computed totals → **discarded on import**; rollup is recomputed server-side from `attendance_daily` in the same transaction per §Agreed decisions §3.
- Monthly breakdowns, bus_no, classroom_officers, urgent/compassionate-leave quota → **parsed but not written to `attendance_*` tables** (future modules may claim them).

## See also

- `14-modules-overview.md` — cross-module hub (Attendance listed under Planned modules).
- `15-markbook-module.md` §"Planned migrations" — documents the boundary drift from Markbook to Attendance.
- `11-performance-patterns.md` §5 — autosave grid pattern Attendance should reuse.
- `03-workflow-and-roles.md` — role + access conventions.
- `05-report-card.md` — report-card rendering of term-summary attendance (unchanged).
- `CLAUDE.md` KD #47 — sole-writer contract.
