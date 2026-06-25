# Application Outcome vs Current State — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop overwriting the admissions application **outcome** (`applicationStatus`) when an enrolled student withdraws; read the **current** state from `section_students.enrollment_status`; show both as read-only badges.

**Architecture:** One column stops doing two jobs. `applicationStatus` becomes append-only outcome history; `enrollment_status` is the live state. The post-enrolment withdrawal route stops cascading `applicationStatus`. Every reader of `applicationStatus` terminal values is audited and reclassified (outcome-semantics → leave; current-state-semantics → read `enrollment_status`). A two-badge display surfaces both. The seeder mirrors the model. No DB migration, no backfill (a population check found 0 corrupted rows).

**Tech Stack:** Next.js 16 RSC, TypeScript, Supabase, Vitest (+ jsdom for component tests), Tailwind v4, design system 09/09a.

## Global Constraints

- **No DB migration, no backfill.** Both columns already exist; 0 corrupted rows across AY2025/26/27. (Spec: Out of scope.)
- **`applicationStatus` = append-only OUTCOME — never overwritten by a post-enrolment event.** `section_students.enrollment_status` = current state. (Spec: The model.)
- **Pre-enrolment terminal handling is UNCHANGED** — an admissions user cancelling/withdrawing a _never-enrolled_ application (stage route) still writes the terminal `applicationStatus`. Only the _post-enrolment_ cascade stops.
- **Badge labels (verbatim):** `Application Outcome: {outcome}` · `Current Status: {state}` where state humanizes `active → "Enrolled"`, `withdrawn → "Withdrawn"`, `late_enrollee → "Late enrollee"`.
- **Hard Rule #6:** withdrawn students stay in `section_students` (append-only). **KD #10:** report-card visibility is gated by the publication window. **Hard Rule #7:** semantic tokens only; invoke `frontend-design` before badge JSX.
- **Prod-correctness fix** — implement on a clean branch off `main` (like `fix/movements-row-id`), not the insights branch. (Controller settles branch mechanics at execution; tasks commit only their own files.)
- Per task: `npx tsc --noEmit` clean + relevant `vitest` green; controller runs `next build` at the end.

---

### Task 1: Stop the post-enrolment cascade overwrite

**Files:**

- Modify: `app/api/sections/[id]/students/[enrolmentId]/route.ts` (the withdrawal branch, ~line 405-455 — the block that sets `applicationStatus: 'Withdrawn'` at ~:411 and `applicationStatus_after: 'Withdrawn'` in the audit context at ~:448)
- Test: `__tests__/sis/withdrawal-preserves-outcome.test.ts` (new — test the pure transform if the route extracts one; otherwise see Step 1 note)

**Interfaces — Produces:** the route no longer writes `applicationStatus` on post-enrolment withdrawal; `section_students.enrollment_status='withdrawn'` + `withdrawal_date`/`withdrawal_reason` writes are unchanged.

- [ ] **Step 1: Read the route + write a failing test.** Open `app/api/sections/[id]/students/[enrolmentId]/route.ts`; locate the PATCH/withdrawal branch where `enrollment_status` is set to `'withdrawn'` and `applicationStatus: 'Withdrawn'` is cascaded onto the `ay{YY}_enrolment_status` update (~:411). If the withdrawal logic is inline (not a pure function), **extract the admissions-update payload builder into a small pure helper** in the same file (e.g. `buildWithdrawalAdmissionsPatch(before)` returning the object written to `_enrolment_status`) so it's unit-testable. Write the failing test asserting that helper returns a patch that sets `withdrawal`-related fields/`classStatus` as before **but does NOT contain an `applicationStatus` key** (outcome preserved):

```ts
import { describe, it, expect } from 'vitest';
import { buildWithdrawalAdmissionsPatch } from '@/app/api/sections/[id]/students/[enrolmentId]/route';

describe('post-enrolment withdrawal preserves the application outcome', () => {
  it('does NOT write applicationStatus (outcome is append-only)', () => {
    const patch = buildWithdrawalAdmissionsPatch({
      /* minimal before-state the helper needs */
    });
    expect('applicationStatus' in patch).toBe(false);
  });
});
```

(If extracting a helper is genuinely infeasible without restructuring the route, instead delete the `applicationStatus` write directly and add a comment-anchored note; document in the report that a route-level integration test wasn't added and why.)

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run __tests__/sis/withdrawal-preserves-outcome.test.ts` → FAIL (patch still contains `applicationStatus`, or helper missing).
- [ ] **Step 3: Remove the cascade.** Delete the `applicationStatus: 'Withdrawn'` write from the post-enrolment withdrawal update. In the audit context, change `applicationStatus_after: 'Withdrawn'` → record the unchanged outcome (or drop that field) so the audit truthfully reflects "outcome unchanged." Leave `enrollment_status='withdrawn'`, `withdrawal_date`, `withdrawal_reason`, and `classStatus` (if it tracks placement, not outcome) intact. Add a comment: `// applicationStatus is the application OUTCOME (append-only) — current state lives on section_students.enrollment_status. Do NOT cascade a terminal status here.`
- [ ] **Step 4: Run it, verify it passes** — `npx vitest run __tests__/sis/withdrawal-preserves-outcome.test.ts` → PASS.
- [ ] **Step 5: Check re-enrol + transfer.** Grep this route + `lib/sis/section-transfer.ts` for any other write of a terminal `applicationStatus` on a post-enrolment path; if found, remove similarly (a transfer/re-enrol must never push a terminal outcome). Note findings in the commit body.
- [ ] **Step 6: `npx tsc --noEmit` + commit** — `git add app/api/sections/[id]/students/[enrolmentId]/route.ts __tests__/sis/withdrawal-preserves-outcome.test.ts` → `git commit -m "fix(records): withdrawal preserves application outcome (no applicationStatus cascade)"`

---

### Task 2: Audit every `applicationStatus` terminal-reader + classify (discovery, no code change)

**Files:**

- Create (scratch): `.superpowers/sdd/applicationstatus-consumer-audit.md` (the classification — NOT committed; informs Task 3)

**Interfaces — Produces:** a definitive table: each reader of `applicationStatus IN ('Withdrawn','Cancelled')` → **OUTCOME-semantics (leave)** or **CURRENT-STATE (switch to `enrollment_status`)**, with the resolved parent-portal decision.

- [ ] **Step 1: Enumerate.** Run and read every hit:
      `grep -rnE "applicationStatus.*(===|==|\.eq\(|\.in\(|!==|not\().*('Withdrawn'|'Cancelled'|Withdrawn|Cancelled)" app/ lib/` (exclude tests + seeders). Also grep `OPTIONAL_DOCUMENT`, `isStudentEnrolled`, P-Files/Records "enrolled" gates that key on `applicationStatus IN ('Enrolled','Enrolled (Conditional)')` — those are the _inverse_ (enrolled-gate) readers and must be checked too (a withdrawn student now stays `'Enrolled'`, so an enrolled-gate that should exclude current-withdrawn needs the `enrollment_status` check).
- [ ] **Step 2: Classify each** against this rule: does the reader want _"how did the application end"_ (OUTCOME — leave; now correct) or _"is this person currently enrolled/withdrawn"_ (CURRENT STATE — must read `section_students.enrollment_status`)? Record the verdict + the exact fix for each. Expected from the spec (confirm against code):
  - `app/(admissions)/admissions/applications/closed/page.tsx` (Cancelled/Withdrawn filter) → **OUTCOME, leave** (becomes pre-enrolment-only — the desired fix).
  - `lib/admissions/dashboard.ts` (terminal/cancellation counts) → **OUTCOME, leave** (pre-enrolment-only is more correct).
  - `lib/sis/process.ts`, `lib/sis/drill.ts` (lifecycle "withdrawn") → classify by what the lifecycle view means (likely OUTCOME — the funnel succeeded; but verify it isn't used to drive a "currently withdrawn" badge/count).
  - `lib/sync/students.ts` (sync gate) → confirm a now-`'Enrolled'` withdrawn student still syncs correctly and the gate's intent holds.
  - `lib/supabase/admissions.ts::getAllStudentsByParentEmail` (parent portal) → **CURRENT STATE.** See Step 3.
- [ ] **Step 3: Resolve the parent-portal decision (the one real product call).** Today the portal filters `applicationStatus NOT IN ('Cancelled','Withdrawn')`, so a withdrawn student is **excluded**. After Task 1 they stay `'Enrolled'` → they'd be **included**. **Plan decision: preserve current behavior — keep currently-withdrawn students excluded** (no surprise for withdrawn families; the portal is for current students; their already-published cards are independently window-gated per KD #10). Implement by excluding students whose current `section_students.enrollment_status='withdrawn'` (a `section_students` lookup keyed by `student_number`/`enrolee_number`), replacing the now-ineffective `applicationStatus` exclusion. **Record this + the alternative** ("include withdrawn, rely on the publication window" — simpler, but a parent-facing behavior change) in the audit doc; the controller surfaces it to the user before Task 3 ships the portal change.
- [ ] **Step 4: Write the audit doc** with the final table + the parent-portal resolution + any stragglers found. Commit nothing (scratch). Return the classification to the controller.

---

### Task 3: Apply current-state consumer fixes

**Files:** (exact set determined by Task 2; expected below)

- Modify: `lib/supabase/admissions.ts` (`getAllStudentsByParentEmail` — exclude current-withdrawn)
- Modify (if Task 2 classifies them CURRENT-STATE): `lib/sis/process.ts`, `lib/sis/drill.ts`, `lib/sync/students.ts`
- Test: extend the nearest existing suites (`__tests__/sis/*`, `__tests__/admissions/*`) for any reader that gets a pure-logic change

**Interfaces — Consumes:** Task 2's classification (`.superpowers/sdd/applicationstatus-consumer-audit.md`). **Produces:** every CURRENT-STATE reader sources withdrawal from `enrollment_status`; OUTCOME readers untouched.

- [ ] **Step 1: Parent portal.** In `getAllStudentsByParentEmail`, after assembling the candidate students, exclude any whose current `section_students.enrollment_status='withdrawn'` (lookup by the student's `student_number`/`enrolee_number` in the relevant AY). Keep the existing `applicationStatus NOT IN ('Cancelled','Withdrawn')` filter — it still correctly drops genuine pre-enrolment terminals — and ADD the current-withdrawn exclusion. Add a test (or extend an admissions test) proving: an enrolled-then-withdrawn student (`applicationStatus='Enrolled'`, `enrollment_status='withdrawn'`) is **not** returned; an active enrolled student **is**.
- [ ] **Step 2: Other current-state readers** (only those Task 2 flagged): switch their withdrawal detection from `applicationStatus==='Withdrawn'` to the student's `enrollment_status`. For each, add/extend a unit test asserting an enrolled-then-withdrawn student is detected as currently withdrawn via `enrollment_status`, not `applicationStatus`. **Do NOT touch** the readers Task 2 classified OUTCOME (closed page, dashboard counts, etc.).
- [ ] **Step 3: `npx tsc --noEmit` + `npx vitest run __tests__/sis __tests__/admissions __tests__/dashboard`** green.
- [ ] **Step 4: Commit** — `git commit -m "fix(consumers): read current withdrawal state from enrollment_status, not the application outcome"`

---

### Task 4: Two-badge read-only display

**Files:**

- Create: `components/sis/student-status-badges.tsx` (a small read-only `<StudentStatusBadges outcome={applicationStatus} state={enrollmentStatus} />`)
- Modify: the Records student detail placement/enrolment section (`app/(records)/records/students/[studentNumber]/*` or its placement component) + the Admissions applicant detail enrolment/lifecycle tab (`app/(admissions)/admissions/applications/[enroleeNumber]/*`) to render the badges
- Test: `__tests__/sis/student-status-badges.test.tsx`

**Interfaces — Consumes:** `applicationStatus` (outcome) + `section_students.enrollment_status` (state) already loaded on those detail pages. **Produces:** `<StudentStatusBadges>`.

- [ ] **Step 1: Invoke `frontend-design`** (mandatory before JSX). Ground in design system 09/09a §9.3 status palette; map state→tone (active=mint, withdrawn=destructive, late_enrollee=amber) and outcome→tone (Enrolled=mint, Conditional=amber, Cancelled/Withdrawn=destructive). Semantic tokens only (Hard Rule #7); icon+text, never colour-only.
- [ ] **Step 2: Write a failing component test** — render `<StudentStatusBadges outcome="Enrolled" state="withdrawn" />`; assert it shows `Application Outcome: Enrolled` and `Current Status: Withdrawn` (humanized) as two distinct read-only badges (`@testing-library/react` under jsdom, pattern in existing `__tests__/`).
- [ ] **Step 3: Implement `StudentStatusBadges`** — two badges, labels verbatim from Global Constraints, the humanize map (`active→"Enrolled"`, `withdrawn→"Withdrawn"`, `late_enrollee→"Late enrollee"`), tones per Step 1. Read-only (no interaction).
- [ ] **Step 4: Run the test, verify pass.** Then wire it into the Records student detail + Admissions applicant detail where the status is shown (replace/augment any single-status badge there).
- [ ] **Step 5: `npx tsc --noEmit` + commit** — `git commit -m "feat(records,admissions): two-badge outcome+current-status display"`

---

### Task 5: Seeder mirrors the model

**Files:**

- Modify: `lib/sis/seeder/edge-cases.ts` (EC3/EC4 withdrawn-from-enrolled), `lib/sis/seeder/populated.ts` + `lib/sis/seeder/admissions-minimal.ts` (any withdrawn persona that ALSO gets a `section_students` row)

**Interfaces — Consumes:** the model. **Produces:** test-AY data where enrolled-then-withdrawn students carry `applicationStatus='Enrolled'` + `enrollment_status='withdrawn'`.

- [ ] **Step 1: Find the withdrawn-from-enrolled seed paths.** Identify every persona/edge-case that sets BOTH `enrollment_status='withdrawn'` (or a withdrawn `section_students` row) AND `applicationStatus='Withdrawn'`. (Grep `applicationStatus: 'Withdrawn'` in the seeder, cross-ref which of those rows also get a `section_students` row.)
- [ ] **Step 2: For enrolled-then-withdrawn personas, set `applicationStatus='Enrolled'`** (keep `enrollment_status='withdrawn'`). **Leave genuine pre-enrolment withdrawn/cancelled personas** (no `section_students` row) with their terminal `applicationStatus` — those are real closed applications and must stay to keep the Admissions closed list populated. Keep the seeder idempotent (existing skip-guards).
- [ ] **Step 3: `npx tsc --noEmit` + `npx vitest run __tests__/sis`** green (adjust any seeder-shape test asserting the old withdrawn `applicationStatus`).
- [ ] **Step 4: Commit** — `git commit -m "feat(seeder): enrolled-then-withdrawn keep Enrolled outcome (two-badge model)"`

---

## Self-Review (plan vs spec)

- **Spec coverage:** stop cascade (T1) ✓; consumer audit + classify + parent-portal resolution (T2) ✓; current-state fixes (T3) ✓; two-badge display (T4) ✓; seeder (T5) ✓; no migration/backfill (Global Constraints) ✓; pre-enrolment terminals unchanged (T1 Step 3 + T5 Step 2) ✓.
- **The risk** (parent portal) is resolved with a default (preserve behavior) + a controller checkpoint before T3 ships it — matching the spec's "resolve explicitly."
- **Placeholder note:** T2 is a deliberate discovery task (the audit IS the work); it carries the classification rule + the known verdicts + the parent-portal decision, and feeds T3's concrete file set. T1/T4/T5 carry concrete tests + code.
- **Type/label consistency:** badge labels + the `enrollment_status` humanize map are identical across Global Constraints, T4, and the spec.
