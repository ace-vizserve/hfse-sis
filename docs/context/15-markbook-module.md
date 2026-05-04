# Markbook Module (Grades, Report Cards, Attendance)

## Overview

The Markbook module is the SIS's academic-records surface. Teachers enter raw scores per subject × section × term; the server computes Performance Scores, Initial Grades, and Quarterly Grades (Hard Rule #2, formula in `lib/compute/quarterly.ts`). The registrar locks sheets on a schedule, publishes report cards via per-section/per-term windows, and applies post-lock edits through the structured change-request workflow (Key Decision #25). Parents reach the published report card via the SSO handoff from the parent portal (no second login).

This is the oldest module and still the heaviest in workflow complexity. It existed before the SIS-as-umbrella framing; the naming-by-module ("Markbook") stuck.

## Routes

All under the `(dashboard)` route group. Auth + role gate via `proxy.ts` + `ROUTE_ACCESS` (`lib/auth/roles.ts`).

### Teacher surface

- `/grading` — "My Sheets" list; filtered by `teacher_assignments`. TanStack data-table with global search, level filter, status tabs (open / locked / all), pagination. Reference for new data-tables (KD #16).
- `/grading/[id]` — the grade-entry grid. Per-cell autosave with stale-closure guard (see `11-performance-patterns.md` §2), status tri-bool (`null` / `0` / raw score), `is_na` toggle, exceeds-max ring, withdrawn student strike-through, plain-text locked-sheet render.
- `/grading/advisory/[id]/comments` — adviser comments per student. Also autosave.
- `/grading/requests` — teacher's own change-request inbox (status, cancel-own-pending).
- `/grading/new` — registrar / admin-only "new sheet" form (RHF + zod).

### Registrar / admin surface

- `/report-cards` — registrar publish list; per-section, per-term publish windows with pre-publish readiness checklist (KD #28).
- `/report-cards/[studentId]` — HTML preview + browser-print; interim (T1–T3) vs final (T4) template switcher (KD #27).
- `/admin/sections` — all sections overview + picker.
- `/admin/sections/[id]` — roster, attendance entry, section-wide comments.
- `/admin/sections/[id]/attendance` — attendance entry grid (term-summary; KD #5 in `03-workflow-and-roles.md`).
- `/admin/sections/[id]/comments` — adviser-level comments (gated by `form_adviser` assignment for teachers; all sections for registrar+).
- `/admin/sync-students` — manual pull from admissions into `students` + `section_students`.
- `/admin/change-requests` — admin inbox with date-range + status filter toolbar, pending-count sidebar badge (realtime via `postgres_changes`), approve / reject with decision note.

### Parent surface

- `/parent` — all children linked by email; one card per child with any currently-published report cards.
- `/parent/enter` — SSO handoff landing (Key Decision #12, see `10-parent-portal.md`).
- `/parent/report-cards/[studentId]` — the published report card with interim/final template auto-derived from active publication windows.

## Tables owned

All in `public` schema in the shared Supabase project. Migrations in `supabase/migrations/`.

| Table | Purpose | Scope |
|---|---|---|
| `students` | Canonical student roster, keyed by `student_number` | Module-owned, cross-module read |
| `academic_years` | AY catalogue; `is_current` flag | Module-owned, cross-module read |
| `terms` | T1–T4 per AY, `is_current` flag | Module-owned |
| `levels`, `subjects`, `subject_configs` | Curriculum setup + weights | Module-owned |
| `sections`, `section_students` | Roster per class; withdrawal via `enrollment_status` | Module-owned |
| `teacher_assignments` | `(user × section × subject × role)` gate | Module-owned |
| `grading_sheets`, `grade_entries` | Raw scores + computed grades | Module-owned |
| `grade_audit_log` | Legacy per-field audit from locked-sheet edits | Module-owned, append-only (Hard Rule #6) |
| `attendance_records` | Term-summary present/absent/tardy/excused counts | Module-owned |
| `report_card_publications` | Per-section, per-term publish window + `notified_at` | Module-owned |
| `grade_change_requests` | Structured change-request state machine (KD #25) | Module-owned |
| `audit_log` | Generic `{actor, action, entity, context}` audit | **Cross-module** (shared with P-Files `pfile.*`, SIS `sis.*`) |

## Access

- **Teacher** — scoped to their own `teacher_assignments` rows. `form_adviser` → one section's adviser comments + attendance; `subject_teacher` → one section × subject's grading sheet.
- **Registrar** — full module access, the primary operator. Locks/unlocks sheets, publishes report cards, applies approved change requests (Path A) or logs a structured data-entry correction (Path B).
- **Admin** — full reads + change-request approvals; does not lock/unlock grading sheets or apply registrar-only operations (see `use-approval-reference.tsx` dialog branches).
- **Superadmin** — everything admin has plus destructive / structural operations (AY rollover, weight config, etc., as those UIs land).
- **Parent** — only reaches `/parent/*`; sees published report cards for their own children.

## Key workflows

Each links out to the detailed spec doc; this module doc is the index, not the source of truth.

1. **Sheet creation** — registrar picks level/section/subject/term in `/grading/new`. `subject_configs` resolves weights (KD #4); `ww_max_slots` + `pt_max_slots` cap the grid (KD #5). See `02-grading-system.md` for the formula contract.
2. **Grade entry** — teacher enters raw scores per cell; server computes PS / Initial / Quarterly on save. Blank ≠ zero (Hard Rule #3); server-side compute only (Hard Rule #2); `is_na` toggle marks a slot permanently blank. See `03-workflow-and-roles.md` for role gating.
3. **Locking** — registrar clicks lock on a sheet; `grading_sheets.is_locked = true`. Locked sheets render plain-text in the grid. All post-lock mutations go through the change-request workflow.
4. **Change-request workflow** — teacher files a typed proposal with reason category + justification (≥20 chars); admin+ approves/rejects with a decision note; registrar applies via Path A (target matches approved proposal) or Path B (structured data-entry correction). Each applied change writes one `grade_audit_log` row with `approval_reference` derived server-side (Hard Rule #5). See KD #25.
5. **Attendance entry** — term-summary (not daily); one record per student × term with counts. Autosave grid under `/admin/sections/[id]/attendance`.
6. **Adviser comments** — per-student narrative; one record per student × term × subject-free category. Autosave.
7. **Publication** — registrar opens `/report-cards`, picks section + term, runs the pre-publish readiness checklist (grading sheets locked, adviser comments written, attendance records entered, T4-only checks; KD #28), sets `publish_from` + `publish_until`. Parents receive a Resend email (idempotent via `notified_at`, KD #17), containing a CTA button linking to `NEXT_PUBLIC_PARENT_PORTAL_URL` — they always re-enter through the SSO handoff.
8. **Report-card rendering** — shared `lib/report-card/build-report-card.ts` assembles the payload (staff + parent both consume it). `ReportCardDocument` switches interim (T1–T3 side by side, no Final Grade) vs final (all 4 terms + Final Grade + General Average + cumulative Attendance %, KD #27).

## Hard rules that live in this module

Authoritative text in `CLAUDE.md`. Pointer list only:

- **#1** — formula returns 93 on the canonical test case (`lib/compute/quarterly.ts` self-test at build time).
- **#2** — all grade computation is server-side.
- **#3** — blank ≠ zero. `null` and `0` are distinct.
- **#5** — post-lock edits require `approval_reference` (now derived from `change_request_id`, KD #25).
- **#6** — grade entries and audit logs are append-only.

## Relationship to other modules

- **Student roster comes from admissions.** `students` is populated by the registrar-triggered sync (`/admin/sync-students` → `lib/sync/students.ts`), pulling from `ay{YY}_enrolment_applications` × `ay{YY}_enrolment_status`. The sync filter is `classSection IS NOT NULL AND applicationStatus NOT IN ('Cancelled', 'Withdrawn')`. See `06-admissions-integration.md`.
- **`classSection` is the liveness signal.** If the Records module ever needs to "withdraw" a student, it goes through `applicationStatus = 'Withdrawn'` — Markbook's sync treats that as withdrawal and flips `section_students.enrollment_status` on next run. See `14-modules-overview.md` §Cross-module data contract.
- **Mid-year section transfer is single-source through SIS Admin** (KD #67). The dedicated `POST /api/sis/students/[enroleeNumber]/transfer-section` route is the only path for moving an enrolled student between sections within the same level — Markbook never mutates `section_students` directly. The transfer runs an atomic withdraw-old-row + insert-new-row pair, so a teacher's grading-sheet roster scope (filtered by `enrollment_status='active'`) reflects the move on the next page load with no per-section migration needed. Audit context captures `{fromSection, toSection, transferDate, termLabel}`; cross-AY history surfaces on the Records detail page via `lib/sis/section-history.ts`.
- **Parent reach is via admissions `motherEmail` / `fatherEmail`.** The parent module's `/parent` landing resolves every `studentNumber` linked to the parent's auth-verified email and renders one card per child. Full details: `10-parent-portal.md`.
- **Audit log is shared.** Markbook's audit rows use prefixes `grade.*`, `attendance.*`, `publication.*`, `change_request.*`, `lock.*`, `unlock.*`. P-Files uses `pfile.*`, SIS uses `sis.*`. `/admin/audit-log` shows everything except `pfile.*` and `sis.*` (KD #10, #30).

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

| Markbook surface today | Destination module | Why the boundary drifts |
|---|---|---|
| `/admin/sync-students` route + `lib/sync/students.ts` | **Records module** (Records) | The sync is about student records, not academics. Markbook consumes its output (`students`, `section_students`) but doesn't own the domain. When the Records module takes it over, Markbook just reads the synced roster. |
| `/markbook/sections` list + section CRUD (create via `NewSectionButton`) | **SIS Admin** — partially moved 2026-04-22 (Bite 3) | Section structure is config. The SIS surface at `/sis/sections` (+ `/sis/sections/[id]` overview) owns creation; the Markbook list stays as an operational launcher into per-section grading / attendance / report cards. Teacher-assignment move to `/sis/sections/[id]` follows in Bite 4. |
| `teacher_assignments` table + `/api/teacher-assignments` CRUD + `components/admin/teacher-assignments-panel.tsx` | **Scheduling** (planned) | "Who teaches what" is a scheduling concern. Today it's a simple `(user × section × subject × role)` gate for grading access — when Scheduling lands with periods + timetable + substitutes, the assignment naturally lives there and Markbook reads it as upstream data. |
| Term-summary attendance **entry** (`/admin/sections/[id]/attendance` route + `components/admin/attendance-grid.tsx`). **Table `attendance_records` stays** — consumed by Markbook for report cards, written by Attendance as the rollup target. | **Attendance** module (planned, daily-level) | Daily attendance will own the raw ledger; term-summary is a rollup. Markbook keeps the *report-card rendering* of attendance (totals on the card) plus a compact read-only **summary card** on `/markbook/sections/[id]` with a "Mark attendance →" deep-link button to `/attendance/[sectionId]?date=today` — teachers stay in Markbook for grade context, jump to Attendance only when marking. No editable grid inside Markbook post-migration. See `16-attendance-module.md` §Contract. |
| Shared reference tables: `academic_years`, `terms`, `levels`, `subjects`, `subject_configs` | **Cross-module / SIS infrastructure** (not a specific module) | These aren't academic data; they're curriculum/config that the whole system depends on (P-Files reads AY, SIS reads levels/subjects, Attendance will read terms). Markbook is the de-facto home because it was first. When the Records module grows an admin/config surface, these migrate there. |

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
