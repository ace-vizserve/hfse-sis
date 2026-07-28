# Classroom — a section × term workspace for staff

**Date:** 2026-07-28
**Status:** Approved. Phase 1 in progress; later phases planned per-phase, not all upfront.

## Context

**The problem.** HFSE's teaching work is organised around a class, but the app is organised around modules. To do one day's work for P4 Obedience a form adviser opens Attendance for the register, Markbook for the sheets, and Evaluation for the write-ups — three modules, three section lists, no single place that means "this class."

**Evidence this is a real gap, not a preference:**

1. **Four separate section-list surfaces exist** — `/sis/sections`, `/markbook/sections`, `/attendance/sections`, `/evaluation/sections` — four independent implementations of the same entity.
2. **The data model already agrees.** `grading_sheets` is unique on `(term_id, section_id, subject_id)`; `attendance_records` on `(section_student_id, term_id)`; `evaluation_writeups` on `(term_id, student_id)` via the section roster. The schema is already section × term shaped; only the navigation isn't.
3. **Someone already patched around it** — `components/sections/section-row-actions.tsx` gives _Markbook_ rows one-way "Open attendance" / "Open write-ups" shortcuts.
4. **Per-section setup state is computed then discarded.** `lib/sis/readiness.ts::fetchAdvisers` builds a `Set` of which sections lack an adviser and collapses it to `.size`. The readiness pill says "advisers 8/10" — nobody can see _which two_. Same for `section_subjects` and `grading_sheets`.

**Scope correction (2026-07-28).** An earlier feature vision assumed students and parents are system users. **They are not.** Students have no login at all; parents only reach a read-only report-card Bearer API on the external admissions portal (`/api/parent/v2/*`). Every feature premised on a student/parent consumer — resource/worksheet libraries, announcements, assignments, parent messaging, seating charts, behaviour records — has **no audience in this system and is not in scope, now or later**. The classroom is a **staff workspace**.

## Who it is actually for

Settled by RLS (`supabase/migrations/005_rls_teacher_scoping.sql`), not preference:

| Role                               | Value                               | Why                                                                                                                                                                                                           |
| ---------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **teacher — form adviser**         | **High — this is their daily home** | Sole writer of attendance; owns FCA write-ups; owns the roster. `attendance_records` and `report_card_comments` are gated `is_adviser_for_section` — adviser only.                                            |
| **teacher — subject-teacher only** | **Low — do not force them here**    | Cannot read the section's attendance or write-ups at all. Their unit of work is the grading sheet, and `/markbook/grading/[id]` is _already_ section × subject × term. They keep `/markbook/grading` as home. |
| **academic_coordinator**           | Medium — drill-down, not home       | Works _across_ sections (school-wide sheets, attendance workbooks, report cards, monitoring FCA completion). Module dashboards stay her home. The genuinely new value is per-section readiness detail.        |
| **school_admin / superadmin**      | Medium — oversight drill-down       | school_admin is also the grade-change approver pool (KD #41).                                                                                                                                                 |
| **p_file_officer / admissions**    | **None — must be excluded**         | No teaching role. See constraint 1.                                                                                                                                                                           |

## Shape (settled)

- **Classroom = section × term.** Subject is a dimension _inside_ a classroom, never part of its identity. A section × subject classroom would show attendance to a subject teacher who cannot read it, and would give that teacher one classroom per section — more destinations, not fewer.
- **Classroom is a peer module, not a parent.** Markbook/Attendance/Evaluation keep everything they own; much of each is not section-scoped (report cards, change requests, analytics, bulk import, virtue themes, and a subject teacher's cross-section sheet list). Two axes over the same data: module = "attendance across all classes"; classroom = "everything about P4 Obedience, Term 2". Precedent: Records already has `/records/students` and `/records/students/[id]`.

## Explicitly NOT built (and why)

These came from the vision doc and must not be implemented as described:

| Proposed                                                | Why not                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Default Score 0"                                       | **Violates Hard Rule #3** (Blank ≠ Zero). `null` = not taken, excluded from numerator _and_ denominator; `0` = took it, scored zero. Defaulting to 0 corrupts every average.                                                                                                          |
| "Round Grades", "Auto Calculate ON/OFF"                 | **Violates Hard Rules #1 + #2.** `transmute()` hardcodes `Math.floor` ("Always floor — never round-to-nearest", DepEd spec) and `lib/compute/quarterly.ts` throws on import unless the canonical case returns 93. A per-teacher toggle means identical scores yield different grades. |
| Custom excused reasons ("Competition")                  | DB CHECK is exactly `mc \| compassionate \| vacation`, mirrored in a zod enum, and drives the leave quotas (vacation 1/term, compassionate 5/yr). Needs a migration, and it's school policy — SIS Admin's job per KD #48.                                                             |
| "Late after 8:15 AM"                                    | No check-in time exists. `attendance_daily` stores a manually-chosen status (`P/L/EX/A/NC`) and no timestamp. Nothing to compute from.                                                                                                                                                |
| "Show Rank"                                             | No rank anywhere in schema or code, and HFSE does not use honor tiers.                                                                                                                                                                                                                |
| Timetable / "Today, 8:00–9:00"                          | No scheduling model. `attendance_daily.period_id` is a bare uuid, no FK, always NULL, commented _"Reserved for Phase 2 once the Scheduling module ships a periods table."_ `sections.schedule` is only `morning \| afternoon \| whole_day`.                                           |
| Resources / file uploads                                | No student or parent consumer exists. The only storage bucket (`parent-portal`) is hardwired to P-Files' fixed document slots.                                                                                                                                                        |
| Write-up approval (Pending/Approved/Returned/Published) | Today it is a single `submitted` boolean. No reviewer, return, or publish state.                                                                                                                                                                                                      |
| Sidebar regroup under "Teaching/Academics"              | You reverted exactly this kind of regrouping recently (`08d97c60`). Leave nav labels alone.                                                                                                                                                                                           |

## Reuse — do not rebuild

**`app/(markbook)/markbook/sections/[id]/page.tsx` is already ~70% of the class page** (hero, roster, stat cards, `SectionAttendanceSummary`, cross-module buttons). It lacks the term axis and per-term artifact lists. Phase 4 is an evolution of this file, not a new build.

| Reuse                                                 | Where                                                | For                                                                                                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computePublishReadiness(service, sectionId, termId)` | `lib/markbook/publish-readiness.ts`                  | Richest per-(section × term) state that exists: unlocked sheets, missing write-ups, missing attendance, `form_adviser.assigned`, hard/soft gaps. Backs Overview + Health. |
| `resolveCurrentTerm` / `resolveCurrentTermId`         | `lib/sis/current-term.ts`                            | The term axis. Canonical ladder: date-window → `is_current` → most-recently-ended → earliest.                                                                             |
| `listFormAdviserSectionIds(userId)`                   | `lib/evaluation/queries.ts:205`                      | Adviser scoping.                                                                                                                                                          |
| `loadAssignmentsForUser` / `subjectTeacherPairs`      | `lib/auth/teacher-assignments.ts`                    | Subject-teacher scoping.                                                                                                                                                  |
| `loadFormAdvisersBySection(sectionIds, ayCode)`       | `lib/sis/staff.ts:174`                               | Adviser names on the list (cached).                                                                                                                                       |
| `getSectionRoster(sectionId, termId)`                 | `lib/evaluation/queries.ts:61`                       | Roster + write-up state, transfer-safe.                                                                                                                                   |
| `getSectionAttendanceSummary`                         | `lib/attendance/queries.ts:269`                      | Attendance rollup.                                                                                                                                                        |
| `<SectionAttendanceSummary>`                          | `components/markbook/section-attendance-summary.tsx` | Reuse as-is.                                                                                                                                                              |
| `audit_log` + `lib/audit/humanize.ts`                 | —                                                    | Timeline is a filtered audit view; the humanizer already renders plain-English labels + context.                                                                          |
| `<DataTable>` shell, `SectionRowActions`              | `components/ui/data-table`, `components/sections/`   | Class list. Namespace its url-state (KD #84).                                                                                                                             |

## Constraints that will bite

1. **`isRouteAllowed` defaults to ALLOW.** A route with no matching `ROUTE_ACCESS` prefix is open to every authenticated role. The `/classroom` row is **mandatory** or admissions and p_file_officer get in.
2. **`evaluation_writeups.section_id` is denormalized and does not follow mid-year transfers** (KD #67/#120). Always resolve via the live `section_students` roster by `student_id`.
3. **`attendance_records` has no `section_id`** — reach it through `section_student_id → section_students.section_id`.
4. **One form adviser per section** (partial unique index); subject teachers may co-teach.
5. **`Module` is a closed union** and `ModuleSidebar`'s `module` prop is required/non-nullable. `Module`, `MODULE_ORDER`, `SIDEBAR_REGISTRY`, `NAV_BY_MODULE` must change together.
6. **Sidebar nav is static config** — "the sidebar becomes the class you're in" needs a `ModuleSidebar` contract change. Out of scope.
7. **No per-teacher/per-section settings table exists** — only the `school_config` singleton. Classroom notes need one small additive table (Phase 6).

## Phases

Each phase ends green (`npm test` + `npx next build`) and is reviewed before the next begins.

**Phase 1 — Foundation (no UI).** `lib/classroom/scope.ts` — the helper that does not exist: "which sections can this user see, and in what capacity" → `{ sectionIds, capabilityBySection: 'adviser' | 'subject' | 'oversight' }`, composing `listFormAdviserSectionIds` + `loadAssignmentsForUser`; coordinator+ gets all. `lib/classroom/queries.ts` — the missing single loader (section + roster + teachers + term artifacts), replacing the duplicated inline fetches in the two existing `[id]` pages. Unit-tested across all six roles; a subject-teacher capability must never claim attendance.

**Phase 2 — Module shell.** Add `'classroom'` to the four registries; **`ROUTE_ACCESS` row** = `teacher | academic_coordinator | school_admin | superadmin`; `app/(classroom)/layout.tsx` mirroring the existing per-module layouts. `__tests__/auth/nav-route-consistency-all-modules.test.ts` must stay green — it covers Classroom automatically once registered.

**Phase 3 — Class list (`/classroom`).** `<DataTable>`, namespaced url-state. Columns: Class, Level, Adviser, Students, plus **setup state** (adviser? subjects attached? sheets created?) — the detail `readiness.ts` discards. Scoped per Phase 1. This deliberately tightens `/markbook/sections`, which today shows every user every section.

**Phase 4 — Class page (`/classroom/[sectionId]`).** Port and evolve the Markbook section detail page. Term selector via `resolveCurrentTerm` with `?term_id=`. Sub-routes rather than in-page tabs, following the Academic Summary hub pattern (KD #134), so each is deep-linkable: **Overview**, **Attendance** (adviser/oversight only), **Grades** (sheets by subject + lock state), **Write-ups** (adviser/oversight only), **Students**. Each links out to the existing full-width editors — the attendance grid and score-entry grid are **not** embedded (they assume full viewport: sticky columns, marking palette, 50-student rosters). A subject-teacher-only viewer sees Overview + Students + their own subject's sheet, and no attendance/write-up routes at all.

**Phase 5 — Health + Timeline.** **Health** on Overview: attendance %, missing scores, pending FCA, students at risk — composed from `computePublishReadiness` + the attendance rollup, no new queries of substance. **Timeline**: `audit_log` filtered to this section's entities, rendered through `lib/audit/humanize.ts`. Both read-only, no schema change.

**Phase 6 — Settings (reduced).** Display-only preferences (student order, show grade colours, show running average) — client-persisted, no schema. **Classroom notes** (private to the teacher) need one small additive table + a route; this is the plan's only migration. Nothing policy-shaped goes here.

**Phase 7 — Repoint, then retire.** Point the three teaching modules' section-list nav entries at `/classroom`; make `/markbook/sections/[id]` a redirect stub (add to `REDIRECT_STUBS` in the nav test). `/sis/sections` **stays** — structural/destructive config (create, rename, delete, change level) does not belong beside "take attendance." Retire the three list pages only after the classroom list demonstrably covers their use.

## Verification

- `npm test` green each phase; `npx next build` clean; `npx tsc --noEmit` clean.
- New unit tests: scope-per-role; term resolution; transfer-safe write-up attribution; subject-teacher capability never includes attendance.
- Nav consistency test green (Classroom covered in both directions automatically).
- **Manual, per role** — form adviser sees their class with every panel; subject-teacher-only sees the narrowed page with no attendance/write-up routes; coordinator sees all classes with correct setup state; **`admissions` and `p_file_officer` are bounced from `/classroom`** (proves constraint 1).
- Cross-check one class's per-term numbers against the module surfaces (attendance rollup, grading list, evaluation progress). The classroom must never disagree with them — same discipline as count==drill (KD #124).
