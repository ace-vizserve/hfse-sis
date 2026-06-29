# Markbook Module (Grades, Report Cards)

## Overview

The Markbook module is the SIS's academic-records surface. Teachers enter raw scores per subject × section × term; the server computes Performance Scores, Initial Grades, and Quarterly Grades (Hard Rule #2, formula in `lib/compute/quarterly.ts`). The registrar locks sheets on a schedule (including bulk lock, KD #131), publishes report cards via per-section/per-term windows, and applies post-lock edits through the structured change-request workflow (Key Decision #25). Parents reach published report cards through the external parent portal SPA (`enrol.hfse.edu.sg`), which consumes `/api/parent/v2/*` via Bearer auth — there are no in-SIS parent pages.

This is the oldest module and still the heaviest in workflow complexity. It existed before the SIS-as-umbrella framing; the naming-by-module ("Markbook") stuck.

## Routes

All under the `(markbook)` route group. Auth + role gate via `proxy.ts` + `ROUTE_ACCESS` (`lib/auth/roles.ts`).

### Teacher surface

- `/markbook/grading` — "My Sheets" list; filtered by `teacher_assignments`. TanStack data-table with url-state (`namespace:'grading'`), level/section facets, status tabs (open / locked / all). Registrar sees all sheets in the AY.
- `/markbook/grading/[id]` — the grade-entry grid. TanStack Query mutations per cell (KD #24), status tri-bool (`null` / `0` / raw score), `is_na` toggle, non-examinable override dropdown (UG / E / N/A, KD #104), slot-metadata labels + dates (KD #105), plain-text locked-sheet render.
- `/markbook/sections` — sections picker (teacher entry point; also the DataTable for registrar section list, KD #84).
- `/markbook/change-requests` — combined teacher + registrar change-request surface. Teacher: own inbox with status + cancel-own-pending. Registrar/school_admin: full approval / rejection / apply flow.
- `/markbook/grading/new` — registrar / school_admin-only "new sheet" form (RHF + zod).

### Registrar / school_admin surface

- `/records/academic-summary` — Academic Summary hub (relocated from `/markbook/masterfile` per KD #127). Cross-subject grade view per level; XLSX + CSV export via `GET /api/markbook/masterfile/export`. Child routes: `/awards` (award tier distribution), `/attendance` (per-student summary), `/comments` (FCA submission tracker). Registrar / school_admin / superadmin only.
- `/markbook/report-cards` — publish list; per-section, per-term publish windows with pre-publish readiness checklist (KD #28). Includes bulk-publish dialog with per-section concern links (KD #145). Comments + virtue-theme are hard-gated (KD #129/#138).
- `/markbook/report-cards/section/[sectionId]/print` — batch browser-print of all report cards for a section (KD #7).
- `/markbook/report-cards/[studentId]` — HTML preview + browser-print; interim (T1–T3) vs final (T4) template switcher (KD #27).
- `/markbook/audit-log` — module-scoped audit log (grade + change-request + lock + publication actions).
- `/markbook/insights` — Academic Performance Insights (KD #143): subject trend chart, grade distribution, grading throughput.

## Tables owned

All in `public` schema in the shared Supabase project. Migrations in `supabase/migrations/`.

| Table                                     | Purpose                                                                                                                     | Scope                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `students`                                | Canonical student roster, keyed by `student_number`                                                                         | Module-owned, cross-module read                                                    |
| `academic_years`                          | AY catalogue; `is_current` flag                                                                                             | Module-owned, cross-module read                                                    |
| `terms`                                   | T1–T4 per AY, `is_current` flag                                                                                             | Module-owned                                                                       |
| `levels`, `subjects`, `subject_configs`   | Curriculum setup + weights                                                                                                  | Module-owned                                                                       |
| `sections`, `section_students`            | Roster per class; withdrawal via `enrollment_status`                                                                        | Module-owned                                                                       |
| `teacher_assignments`                     | `(user × section × subject × role)` gate                                                                                    | Module-owned                                                                       |
| `grading_sheets`, `grade_entries`         | Raw scores + computed grades                                                                                                | Module-owned                                                                       |
| `grade_audit_log`                         | Legacy per-field audit from locked-sheet edits                                                                              | Module-owned, append-only (Hard Rule #6)                                           |
| `school_config` (award threshold columns) | Configurable Subject / Overall Award thresholds (KD #95, migration 049): `subject_award_bronze_min/silver_min/gold_min/max` | **Cross-module** (singleton row, also holds report-card signatures + leave quotas) |
| `attendance_records`                      | Term-summary present/absent/tardy/excused counts                                                                            | **Attendance-owned** (Markbook reads for report cards; KD #47)                     |
| `report_card_publications`                | Per-section, per-term publish window + `notified_at`                                                                        | Module-owned                                                                       |
| `grade_change_requests`                   | Structured change-request state machine (KD #25)                                                                            | Module-owned                                                                       |
| `audit_log`                               | Generic `{actor, action, entity, context}` audit                                                                            | **Cross-module** (shared with P-Files `pfile.*`, SIS `sis.*`)                      |

## Access

- **Teacher** — scoped to their own `teacher_assignments` rows. `form_adviser` → one section's adviser-comment flow (redirects to Evaluation, KD #49); `subject_teacher` → one section × subject's grading sheet.
- **Registrar** — full module access, the primary operator. Locks/unlocks sheets (including **bulk lock**, KD #131), publishes report cards, applies approved change requests (Path A) or logs a structured data-entry correction (Path B).
- **School_admin** — full reads + change-request approvals; does not lock/unlock grading sheets or apply registrar-only operations.
- **Superadmin** — everything school_admin has plus structural operations (AY rollover, weight config, etc.).
- **Parent** — external SPA (`/api/parent/v2/*` with Bearer auth); sees published report cards gated by publication windows (KD #10). No in-SIS parent pages.

## Key workflows

Each links out to the detailed spec doc; this module doc is the index, not the source of truth.

1. **Sheet creation** — registrar picks level/section/subject/term in `/markbook/grading/new`. `subject_configs` resolves weights (KD #4); `ww_max_slots` + `pt_max_slots` cap the grid (KD #5). See `02-grading-system.md` for the formula contract.
2. **Grade entry** — teacher enters raw scores per cell; server computes PS / Initial / Quarterly on save. Blank ≠ zero (Hard Rule #3); server-side compute only (Hard Rule #2); `is_na` toggle marks a slot permanently blank. Non-examinable subjects show UG/E/N/A override dropdown (KD #104). See `03-workflow-and-roles.md` for role gating.
3. **Locking** — registrar clicks lock on a sheet (or selects multiple in the grading list → **"Lock selected"** bulk action, KD #131). Locked sheets render plain-text in the grid. All post-lock mutations go through the change-request workflow.
4. **Change-request workflow** — teacher files a typed proposal with reason category + justification (≥20 chars); school_admin approves/rejects via email one-click link (KD #123) or in-app dialog; registrar applies via Path A (target matches approved proposal) or Path B (structured data-entry correction). Each applied change writes one `grade_audit_log` row with `approval_reference` derived server-side (Hard Rule #5). See KD #25.
5. **Attendance (read-only)** — the Attendance module owns daily entry and writes the `attendance_records` rollup; Markbook reads the rollup for report-card rendering only. No editable attendance grid exists in Markbook (KD #47).
6. **Adviser comments** — form-adviser comments are owned by the Evaluation module (`/evaluation/sections/[id]`). Markbook's grading surface deep-links there for advisers (KD #49).
7. **Publication** — registrar opens `/markbook/report-cards`, picks section + term, runs the pre-publish readiness checklist (KD #28). FCA comments + virtue theme are **hard-blocked** until complete (KD #129/#138); grading sheets locked / attendance / letterhead are soft warnings ("publish anyway"). `publish_from` + `publish_until` set the window; parents receive a Resend email linking to the external parent portal.
8. **Report-card rendering** — shared `lib/report-card/build-report-card.ts` assembles the payload (staff + external parent SPA both consume it). `ReportCardDocument` switches interim (T1–T3, cumulative FCA comments per KD #129) vs final (T4, all 4 terms + Final Grade + General Average + cumulative attendance, KD #27). N.A. for terms the student wasn't enrolled in (KD #148).
9. **Academic Summary** — registrar / school_admin opens `/records/academic-summary`, sees award tiers + attendance rollup + FCA comment status across the entire level/class. Exports the masterfile as `.xlsx`/`.csv` via `GET /api/markbook/masterfile/export` (KD #127/#134/#95). Award thresholds live on `school_config` (editable from `/sis/admin/school-config`).

## Hard rules that live in this module

Authoritative text in `CLAUDE.md`. Pointer list only:

- **#1** — formula returns 93 on the canonical test case (`lib/compute/quarterly.ts` self-test at build time).
- **#2** — all grade computation is server-side.
- **#3** — blank ≠ zero. `null` and `0` are distinct.
- **#5** — post-lock edits require `approval_reference` (now derived from `change_request_id`, KD #25).
- **#6** — grade entries and audit logs are append-only.

## Relationship to other modules

- **Student roster comes from admissions.** `students` is populated by the registrar-triggered sync (`/records/students` → "Sync from Admissions" → `lib/sync/students.ts`), pulling from `ay{YY}_enrolment_applications` × `ay{YY}_enrolment_status`. The sync filter excludes `applicationStatus IN ('Cancelled')` and currently-withdrawn rows (`section_students.enrollment_status='withdrawn'`) per KD #150. See `06-admissions-integration.md`.
- **`applicationStatus` = outcome, `enrollment_status` = current state (KD #150).** An enrolled-then-withdrawn student keeps `applicationStatus='Enrolled'` (outcome) on `section_students.enrollment_status='withdrawn'` (current state). Markbook and attendance filter on `enrollment_status`, not `applicationStatus`. The sync excludes currently-withdrawn rows so re-syncing doesn't reactivate a withdrawn student.
- **Mid-year section transfer is single-source through SIS Admin** (KD #67). The dedicated `POST /api/sis/students/[enroleeNumber]/transfer-section` route is the only path for moving an enrolled student — Markbook never mutates `section_students` directly. The transfer runs an atomic withdraw-old-row + insert-new-row pair; cross-AY history surfaces on the Records detail page via `lib/sis/section-history.ts`.
- **Parent reach is via the external SPA.** The parent portal (`enrol.hfse.edu.sg`) authenticates against the shared Supabase project, then calls `/api/parent/v2/*` (Bearer auth) — `getAllStudentsByParentEmail` resolves studentNumbers across all AYs. No in-SIS parent pages. Full details: `10-parent-portal.md`.
- **Audit log is shared.** Markbook's audit rows use prefixes `grade.*`, `publication.*`, `change_request.*`, `sheet.*`. Attendance uses `attendance.*`; P-Files uses `pfile.*`; SIS uses `sis.*`. `/markbook/audit-log` shows only the Markbook-scoped allowlist (KD #9).

## Cross-module concerns

### Audit log action prefixes

Every Markbook mutation writes an `audit_log` row. The actions currently in use (see `lib/audit/log-action.ts`):

- `grade.*` — `grade.update`, `grade.bulk_update`, etc.
- `attendance.update`, `attendance.bulk_update`
- `publication.create`, `publication.update`
- `change_request.create`, `change_request.approve`, `change_request.reject`, `change_request.cancel`, `change_request.apply`
- `lock.*`, `unlock.*`
- `comment.update`, `totals.update`
- `roster.sync`, `section.add_student`, `section.withdraw_student`

### Exports

Superadmin-only CSVs via `/api/audit-log/export` (shared helper `lib/csv.ts`). Other modules (`/api/admissions/export`) use the same helper.

### Shared tables

- `audit_log`, `academic_years`, `auth.users` are read by every module.
- `students` + `section_students` are Markbook-owned but read by the Records module's student-detail enrollment-history chip strip (via `getEnrollmentHistory()` in `lib/sis/queries.ts`).

## Planned migrations

Markbook shipped first, so several responsibilities landed here by default that really belong to other modules — existing or planned. None of this is scheduled today (pre-migration would be churn with no payoff), but it's captured here so future sprint planning doesn't re-derive the drift when Attendance / Scheduling / an expanded SIS lands.

| Markbook surface today                                                                                                                                                                                                                | Destination module                                                            | Why the boundary drifts                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/sync-students` route + `lib/sync/students.ts`                                                                                                                                                                                 | ✅ **Records module** (shipped, `/records/students` → "Sync from Admissions") | The sync is about student records, not academics. Markbook consumes its output (`students`, `section_students`) but doesn't own the domain.                                                                                                   |
| `/markbook/sections` list + section CRUD (create via `NewSectionButton`)                                                                                                                                                              | ✅ **SIS Admin** (shipped, `/sis/sections` DataTable, KD #84)                 | Section structure is config. The SIS surface at `/sis/sections` (+ `/sis/sections/[id]` overview) owns creation; the Markbook sections list is now an operational picker/launcher (DataTable, `components/markbook/sections-data-table.tsx`). |
| `teacher_assignments` table + `teacher-assignments-panel.tsx`                                                                                                                                                                         | **Scheduling** (not yet built)                                                | "Who teaches what" is a scheduling concern. Today it's a simple `(user × section × subject × role)` gate for grading access.                                                                                                                  |
| Term-summary attendance **entry** (the `/admin/sections/[id]/attendance` route + `components/admin/attendance-grid.tsx` are **deleted**). **`attendance_records` stays** — Attendance writes rollup, Markbook reads for report cards. | ✅ **Attendance** module (shipped — KD #47, #151, `/attendance/*`)            | Complete. Markbook has no editable attendance grid. Report-card rendering reads `attendance_records`. The Attendance module owns daily entry, term-sheet grid, and xlsx export. See `16-attendance-module.md`.                                |
| Shared reference tables: `academic_years`, `terms`, `levels`, `subjects`, `subject_configs`                                                                                                                                           | **SIS Admin** (partially — `/sis/ay-setup`, `/sis/admin/subjects`)            | These are curriculum/config. SIS Admin owns AY setup + subject catalog; Markbook is still the de-facto host for the rest. Long-term: full migration to SIS Admin config surface.                                                              |

**Contract: move with the module, don't pre-migrate.** When a planned module (Attendance, Scheduling, an SIS admin-config surface) gets scoped in a future sprint, its spec should explicitly pull the relevant row out of this table, update the ownership columns in `14-modules-overview.md` §"Cross-module data contract," and note the migration in the sprint's Definition of Done.

## See also

- `02-grading-system.md` — formula spec, transmutation, PS / IG / QG.
- `03-workflow-and-roles.md` — role matrix, lock rules, adviser vs subject-teacher split.
- `04-database-schema.md` — full DDL.
- `05-report-card.md` — report-card structure + print CSS.
- `07-api-routes.md` — API route contracts.
- `11-performance-patterns.md` — `getSessionUser()` vs `getUser()`, autosave grid, parallel queries.
- `14-modules-overview.md` — cross-module hub + data contract.
- `CLAUDE.md` — authoritative hard rules + key decisions.
