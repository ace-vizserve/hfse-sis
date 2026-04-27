# Process Flow & Lifecycle Gates

> **Status:** ✅ **v1 shipped 2026-04-27 (observability layer); auto-completion deferred to v2 pending audit-log evidence per the binding "simplify, don't change business flow" principle.** See KD #59-62 for the four design decisions surfaced during this build.

## What landed in v1 (Sprint 27, 2026-04-27)

- **Per-student lifecycle composite** — `<StudentLifecycleTimeline>` dual-mounted on `/admissions/applications/[enroleeNumber]?tab=lifecycle` (6th tab) and `/records/students/[studentNumber]` (4th section). Reads from new `lib/sis/process.ts::getStudentLifecycle(ayCode, enroleeNumber)`. Renders the 9 admissions stages + 5 downstream Markbook/Attendance/Parent stages with bucket-coloured rail dots, severity chip per row, withdrawn-state branch (terminal pill + grayed timeline), and cross-AY chip strip via `getEnrollmentHistory()`.
- **Aggregate per-blocker dashboard widget on `/sis`** — `<LifecycleAggregateCard>` with 8 buckets: Awaiting fee payment · Awaiting document revalidation (Rejected + Expired) · Awaiting document validation (NEW — Uploaded) · Awaiting assessment schedule · Awaiting contract signature · Missing class assignment · Ungated to enroll · New applications. Each row drill-target prepared (drill API wiring deferred to a later iteration). Fed by `lib/sis/process.ts::getLifecycleAggregate(ayCode)`.
- **Soft-gate visual checklist on `EditStageDialog`** — when admin selects `Enrolled` (or `Enrolled (Conditional)`) on the application stage, a checklist of the 5 prereq stages renders above the dropdown with ✓/⚠ per stage. Purely advisory — server still 422s on missing prereqs (the outer `ENROLLED_PREREQ_STAGES` gate is preserved). Surfaces blockers before submit instead of after.
- **Removed the per-stage sequential prerequisite chain** (`PREREQ_STAGE_PREDECESSOR`) — was forcing fake-serial order on parallel admissions work. The outer `applicationStatus='Enrolled'` flip gate stays.
- **New-applications PriorityPanel on `/admissions`** — `<NewApplicationsPriority>` at top-of-fold (operational archetype per KD #57). Reads `lib/admissions/priority.ts::getNewApplicationsPriority(ayCode)`. Counts `applicationStatus='Submitted'` rows.
- Cache: 60s `unstable_cache` per call, tag `sis:${ayCode}` per KD #46.

**Auto-completion deferred to v2.** No PATCH-route auto-flip hooks were added. After 1 term of using the lifecycle view, audit-log evidence will tell us where intra-stage auto-flips are safe (e.g. `feePaymentDate` populated → `feeStatus='Paid'`).

## Why this doc exists

After the SIS-first docs realignment, the product's shape is clear: four modules, one student record, lifecycle implicit in the existing admissions stage pipeline. What's missing is **observability** (seeing where a student is across all modules in one view) and **gentle guidance** (checklist-style hints on what needs to happen before advancing a stage). This is different from Records, P-Files, Markbook, or Attendance — it's not a new module, it's how the modules **connect as a process**.

Positioning: cross-cutting design concern, similar in spirit to `11-performance-patterns.md`. Not its own route group; enhances Records + adds one cross-module view.

## The end-to-end lifecycle (today's reality)

| # | Stage | Surface today | Module |
|---|---|---|---|
| 0 | **Inquiry** | Tracked outside the SIS (admissions' own workflow) | — (Records Phase 4 SharePoint sync was dropped 2026-04-24) |
| 1 | **Application** | `enrol.hfse.edu.sg` form → `ay{YY}_enrolment_applications` row | Parent portal → Admissions |
| 2 | **Registration** | Records Stage tab → `registrationStatus` | Records |
| 3 | **Documents** | Parent upload on enrolment portal + P-Files staff upload + Records validation (`{slotKey}Status = Valid / Rejected`) | P-Files + Records |
| 4 | **Assessment** | Records Stage tab → `assessmentStatus` + math/english grades + medical | Records |
| 5 | **Contract** | Records Stage tab → `contractStatus` | Records |
| 6 | **Fees** | Records Stage tab → `feeStatus` + invoice + payment date + start date | Records |
| 7 | **Class assignment** | Records Stage tab → `classStatus` + `classAY` + `classLevel` + `classSection` | Records |
| 8 | **Supplies** | Records Stage tab → `suppliesStatus` + claimed date | Records |
| 9 | **Orientation** | Records Stage tab → `orientationStatus` + schedule date | Records |
| 10 | **Markbook sync** | Registrar clicks `/admin/sync-students` → populates `students` + `section_students` | Markbook |
| 11 | **Grading** | Teacher enters scores per term; registrar locks sheets | Markbook |
| 12 | **Attendance** | Term-summary entry today; planned daily in Attendance module | Markbook → Attendance |
| 13 | **Report card publication** | Registrar sets `publish_from` / `publish_until`, parents emailed via Resend | Markbook |
| 14 | **Parent view** | SSO handoff from parent portal → `/parent/report-cards/[studentId]` | Markbook (parent surface) |
| 15 | **Re-enrolment** | Next AY cycle — new application row, same `studentNumber` (Hard Rule #4) | Records |
| 15b | **Withdrawal** | Records Stage tab → `applicationStatus='Withdrawn'`; Markbook sync flips `section_students.enrollment_status='withdrawn'` | Records + Markbook |

**Join-key spine:** `studentNumber` (stable cross-AY) threads through every row. `enroleeNumber` joins within a single AY's admissions tables. See `14-modules-overview.md` §"Shared student identity."

## Current state: what's missing

1. **No unified lifecycle view.** Nothing answers "where is this student in the process?" in one glance. The 9-stage Stage tab shows admissions stages but stops at stage 9; stages 10–14 (Markbook sync onward) are in different surfaces.
2. **No stage prerequisites.** The Records Stage PATCH route lets admins set any status on any stage in any order. "`fees=Paid` requires `contract=Signed`" is a convention, not enforced.
3. **No auto-completions.** `{slotKey}Status` turning all-`Valid` doesn't auto-advance the `documents` stage. Fee `paymentDate` being populated doesn't auto-advance the `fees` stage. All transitions are manual.
4. **No downstream triggers.** `classStatus='Finished'` doesn't auto-sync the student into Markbook's `students` + `section_students` tables; the registrar clicks sync.
5. **Rejected-document loop is open-ended.** When Records sets `{slotKey}Status='Rejected'`, the parent-portal side isn't notified. No "please re-upload" email, no visible flag on enrolment portal.
6. **No transition history.** `audit_log` captures mutations (`sis.stage.update` with `context.changes`) but not lifecycle milestones as a timeline. Reconstructing "when was Juan enrolled?" requires scanning audit rows.

## Agreed design direction (soft-first)

The recommendation from the earlier discussion, captured here so it's not re-derived:

### 1. Lifecycle view — **visibility first, no schema changes**

A new tab on the Records student detail page (`/records/students/[enroleeNumber]?tab=lifecycle`) rendering the full 15-stage timeline derived from existing tables:

- Stages 1–9 from `ay{YY}_enrolment_status`
- Stage 3 document detail from `ay{YY}_enrolment_documents.{slotKey}Status`
- Stage 10 from `students` + `section_students` existence
- Stages 11–13 from `grading_sheets.is_locked`, `attendance_records` presence, `report_card_publications.publish_from/until`
- Stage 14 from parent auth events (optional)

Rendered as a vertical timeline with per-stage badges (`done` / `in progress` / `blocked` / `not started`). Read-only composite; writes still go through each stage's existing surface.

Also surfaced as a **dashboard widget** on `/sis` (aggregate: "12 students pending fees", "3 students awaiting document revalidation", etc.).

**Schema impact: zero.** Query helpers in `lib/sis/queries.ts::getStudentLifecycle(enroleeNumber)` + `getLifecycleAggregate(ayCode)`.

### 2. Soft gates — **checklist hints on the Stage edit dialog**

When opening the Records Stage edit dialog for, say, `fees`, show a checklist at the top:

- ✓ `contract.status = Signed` — (from current row)
- ✓ `registration.status = Paid`
- ⚠ `documents.status ≠ Valid` — consider completing documents first
- (proceed anyway)

Admins can still set any status; the checklist is advisory. Each stage has a prerequisite rule defined in `lib/sis/process.ts::STAGE_PREREQUISITES` (new file).

**Schema impact: zero.**

### 3. Auto-completions — **opt-in per stage, triggered by downstream mutations**

When the condition for a stage is objectively met (e.g. all expected document slots are `Valid`), the Records PATCH route that flipped the last underlying field also upserts the containing stage's status to `Finished`. Examples:

- Last `{slotKey}Status='Valid'` in the expected set → `documentStatus='Valid'`
- `feePaymentDate` populated + non-null + in the past → `feeStatus='Paid'`
- All `grading_sheets.is_locked=true` for current term → optional flag on the Markbook side (not a Records stage, but feeds the lifecycle widget)

Admins can override auto-set statuses; the rule is "auto-complete is a floor, admin decides the ceiling."

**Schema impact: zero** (pure routing logic). Auditable via new audit action `sis.stage.auto_complete`.

### 4. Downstream triggers — **opt-in automation, out of v1 scope**

"`classStatus='Finished'` → auto-run student sync" is the kind of cross-module trigger that's valuable but has real blast-radius risk (bad admissions data → corrupt Markbook roster). Out of scope for v1. Revisit after observability layers (lifecycle view + soft gates) have been in use for a term.

### 5. Lifecycle event log — **deferred**

An append-only `lifecycle_events` table (one row per `student × ay × stage × transition`) would make the timeline queryable as history, not just current-state. Not needed for v1 — the existing `audit_log` suffices for forensics. Revisit if the registrar asks "when did X happen?" questions regularly.

## Scope boundaries

| In scope (v1) | Out of scope (v1, revisit later) |
|---|---|
| Lifecycle view (read-only, derived from existing tables) | New `lifecycle_events` append-only table |
| Dashboard aggregate widget on `/sis` | Per-student lifecycle PDF export |
| Soft gates (advisory checklist) on Stage edit | Hard gates (route returns 400 if prerequisites unmet) |
| Auto-completion on `documents` stage (all slots Valid) | Auto-completion chain triggering downstream stages |
| Auto-completion on `fees` stage (payment date populated) | Auto-trigger Markbook sync when `classStatus=Finished` |
| Audit action `sis.stage.auto_complete` | Webhook / Edge Function / DB trigger infra |

## Data model

**No new tables for v1.** Everything derives from:
- `ay{YY}_enrolment_status` (primary stage pipeline)
- `ay{YY}_enrolment_documents.{slotKey}Status` (documents stage detail)
- `students`, `section_students` (enrolment handoff signal)
- `grading_sheets.is_locked`, `attendance_records`, `report_card_publications` (academic stages)
- `audit_log` (forensics, existing)

`lib/sis/process.ts` (new file) holds:
- `STAGE_PREREQUISITES: Record<StageKey, PrerequisiteRule[]>` — checklist data
- `AUTO_COMPLETE_RULES: Record<StageKey, AutoCompleteRule>` — which stages auto-flip
- `getStudentLifecycle(enroleeNumber)` — composite read
- `getLifecycleAggregate(ayCode)` — dashboard rollup

`components/sis/student-lifecycle-timeline.tsx` (new) renders the timeline. Uses the same `StageStatusBadge` / `ApplicationStatusBadge` from `components/sis/status-badge.tsx`.

## Placement

- **Lifecycle timeline** — new 5th tab on `/records/students/[enroleeNumber]` (Profile / Family / Enrollment / Documents / **Lifecycle**). Replaces nothing; sits alongside.
- **Dashboard widget** — new card on `/sis` showing counts by stage-blocked bucket. Cached via `unstable_cache` on the `sis:${ayCode}` tag.
- **Soft-gate checklist** — rendered inside the existing `components/sis/edit-stage-dialog.tsx`.
- **Auto-completion logic** — extends the existing Stage / Profile / Document PATCH routes; no new routes.

## Access

Same as Records today — `registrar`, `admin`, `superadmin`. No new role. Teachers never see this (lifecycle is a records concern).

## Open questions

- [ ] **Stage prerequisite rules** — what's the canonical ordering? Does `contract` really require `assessment=Passed`, or can contract precede assessment for returning students? Need HFSE input.
- [ ] **Auto-completion scope** — which stages should auto-flip in v1? Candidates: `documents` (all slots Valid), `fees` (payment date populated). Anything else that's objectively derivable?
- [ ] **Lifecycle view for withdrawn students** — timeline still renders, but with a terminal "Withdrawn on {date}" stage?
- [ ] **Cross-AY lifecycle** — does the view show the current AY only, or chip-strip the prior years too (returning student)? Defer to the existing enrollment-history chip strip pattern.
- [ ] **Dashboard widget granularity** — aggregate counts per stage, or per-blocker ("3 students awaiting medical assessment", "5 awaiting fee payment")? Latter is more actionable.
- [ ] **Rejected-document re-upload loop** — does this doc own that, or does it defer to a separate Communications module later?
- [ ] **Soft-gate copy** — should warnings block with `AlertDialog`, or render inline above the form? Lean inline.

## See also

- `13-sis-module.md` §"Phase 2 — Stage pipeline" — the current stage pipeline the gates layer over.
- `14-modules-overview.md` §"Shared student identity" + §"Cross-module data contract" — the data-model foundation this builds on.
- `15-markbook-module.md` §"Relationship to other modules" — documents the Markbook sync handoff (stage 10).
- `16-attendance-module.md` — attendance rollup feeds lifecycle stage 12.
- `06-admissions-integration.md` — admissions-table ownership + sync query.
- `CLAUDE.md` KD #38 — modules share one student identity.
