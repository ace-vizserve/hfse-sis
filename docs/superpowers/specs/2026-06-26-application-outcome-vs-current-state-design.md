# Application Outcome vs Current State — Design Spec

**Date:** 2026-06-26
**Status:** approved design, pre-plan
**Branch:** prod-correctness fix — preferred as a clean branch off `main` (like `fix/movements-row-id`), not buried in the insights branch. (Execution detail; settle in the plan.)

## Goal

Stop overwriting the admissions application **outcome** when an enrolled student withdraws. Preserve `applicationStatus` as append-only history; read the **current** student state from `section_students.enrollment_status`; show both as read-only badges. This dissolves the Admissions-closed-vs-Records-withdrawn discrepancy and prevents a latent data-corruption bug.

## Root cause (why this exists)

`applicationStatus` has always carried **two meanings in one column**: the application _outcome_ (Enrolled / Cancelled / Withdrawn — history) and the person's _current status_ (live). They're identical until a student **enrols then later withdraws** — at which point a single column can't hold both. The Records→Admissions withdrawal cascade (KD #147) resolved this by overwriting `applicationStatus` with the current state (`'Withdrawn'`), **erasing the fact that the application succeeded** — which contradicts KD #147's own "historical truth is append-only" principle.

**Current data is clean:** a population check returned **0** corrupted rows across AY2025/2026/2027 — no enrolled student has been withdrawn through the app's UI yet (AY2025 was loaded via backfill SQL that preserved the outcome). So the corruption is **latent**: it would strike the first UI-driven post-enrolment withdrawal. We fix it go-forward, on clean data — **no backfill**.

## The model

- **`applicationStatus`** = the application **OUTCOME**. Append-only. Set when the application reaches a terminal-ish result (Enrolled / Enrolled (Conditional) / Cancelled / Withdrawn-pre-enrolment). **Never overwritten by a post-enrolment event.**
- **`section_students.enrollment_status`** = the **CURRENT** student state (`active` / `withdrawn` / `late_enrollee`). The single source of truth for "what's happening with this student now."
- A student who enrolled then withdrew: `applicationStatus = 'Enrolled'` (outcome, unchanged) + `enrollment_status = 'withdrawn'` (current).

## Changes (go-forward; no DB migration — both columns already exist)

### 1. Stop the cascade overwrite

`app/api/sections/[id]/students/[enrolmentId]/route.ts:411` currently sets `applicationStatus: 'Withdrawn'` on post-enrolment withdrawal. Remove that write (and the `applicationStatus_after: 'Withdrawn'` audit field at ~:448, or set it to the unchanged outcome). The route continues to set `section_students.enrollment_status = 'withdrawn'` + `withdrawal_date`/`withdrawal_reason` (KD #111). Re-enrol and transfer paths: confirm they likewise never push a terminal value onto `applicationStatus`.
**Unchanged:** the admissions-side **pre-enrolment** terminal flip (an admissions user cancelling/withdrawing a _never-enrolled_ application via the stage route `stage/[stageKey]/route.ts`) — that is a real outcome and stays.

### 2. Consumer audit + classification (the main work + the main risk)

Every reader of `applicationStatus IN ('Withdrawn','Cancelled')` must be classified and handled:

- **Outcome-semantics → leave as-is** (now correctly reflects the outcome):
  - `app/(admissions)/admissions/applications/closed/page.tsx:97-100` — closed archive → becomes cleanly **pre-enrolment-only** (the fix). Confirm that's the intent.
  - `lib/admissions/dashboard.ts:457-990` — cancellation/terminal counts → pre-enrolment-only (more correct: admissions cancellation analysis is about non-enrollers).
- **Current-state-semantics → switch to `section_students.enrollment_status`** (or audit to confirm):
  - `lib/supabase/admissions.ts:42,221` — **parent portal** (`getAllStudentsByParentEmail`): a withdrawn student now stays `'Enrolled'`, so they'd be returned. **Highest risk.** Decide: does the portal exclude currently-withdrawn students, or is report-card visibility already gated by the publication window (KD #10) so returning them is fine? Resolve explicitly.
  - `lib/sis/process.ts:344-348` — lifecycle "withdrawn" rollup: determine if it wants the admissions-funnel outcome (leave) or the live state (switch).
  - `lib/sis/drill.ts:82` — lifecycle drill soft-closed: same determination.
  - `lib/sync/students.ts:397` — sync gate (blocks terminal `applicationStatus`): confirm a still-enrolled-or-withdrawn student syncs correctly (KD #6: withdrawn stay in `section_students`).
- The plan must enumerate **every** `applicationStatus` terminal-reader (not just these greps' hits) and classify each.

### 3. Two-badge read-only display (labels: option C)

Show two badges where a student's status is surfaced:

- **`Application Outcome: {outcome}`** — from `applicationStatus` (Enrolled / Enrolled (Conditional) / Cancelled / Withdrawn).
- **`Current Status: {state}`** — from `section_students.enrollment_status`, humanized: `active → "Enrolled"`, `withdrawn → "Withdrawn"`, `late_enrollee → "Late enrollee"`.
  Surfaces: the **Records student detail** (placement/enrolment section) and the **Admissions applicant detail** (enrolment/lifecycle tab). Read-only. For a normally-active student both read positively; they diverge only for withdrawn/late. Design system 09/09a, semantic tokens (status palette §9.3); invoke `frontend-design` for the badge JSX.

### 4. Seeder

Withdrawn-from-enrolled personas/edge-cases (`lib/sis/seeder/edge-cases.ts` EC3/EC4, `populated.ts`, `admissions-minimal.ts`) must keep `applicationStatus='Enrolled'` + set `enrollment_status='withdrawn'` — so the test env demonstrates the two-badge correctly. **Distinguish** from genuine **pre-enrolment** withdrawn/cancelled personas (no `section_students` row), which keep their terminal `applicationStatus` (unchanged).

## Out of scope

- **No backfill** (0 corrupted rows; if one ever appears, a one-line `WHERE EXISTS(section_students)` repair fixes exactly those — not written now).
- No new DB columns / migration (both columns exist).
- No change to pre-enrolment terminal handling.

## Edge cases

- **Re-enrolment** (withdrawn → active again): `enrollment_status` returns to `active`; `applicationStatus` was never touched, stays `'Enrolled'` throughout. Consistent.
- **Enrolled (Conditional)** then withdraws: outcome stays `'Enrolled (Conditional)'` (preserved — the very nuance the old cascade destroyed).
- **Cancelled pre-enrolment** (never enrolled, no `section_students` row): unchanged — genuine closed application.

## Verification

- `npx tsc --noEmit` clean; `npx vitest run` green (+ a unit/route test that withdrawing an enrolled student leaves `applicationStatus` unchanged and only flips `enrollment_status`).
- After change: an enrolled-then-withdrawn student appears in **Records withdrawn** but **not** the Admissions closed list; the two badges render correctly; the parent-portal decision behaves as resolved.
- `npx next build` clean.
- Manual: confirm the closed list is pre-enrolment-only and the badges read `Application Outcome: Enrolled` · `Current Status: Withdrawn`.
