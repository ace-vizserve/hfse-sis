# Convert Late Enrollee → Normal Enrollee — design

**Date:** 2026-06-12
**Status:** approved (pending spec review)

## Problem

Switching a student's `enrollment_status` from `late_enrollee` back to `active` is currently a **silent, unguarded save** (no confirm, no tracking). In the real world this transition is not a routine workflow step — a student who joined mid-year _is_ a late enrollee. Its only legitimate purpose is **correcting a misclassification**.

**That correction is T1-only.** A student who joined in **T2–T4 is unambiguously a late enrollee** (the school year is firmly underway — no grey zone), so they can never revert to normal. The only ambiguous case is a **T1 late enrollee**: the school year has technically started but "hasn't really started yet" (orientation / first days), and the registrar may judge such a student was effectively on-time. So the convert action is **gated to late enrollees whose joining term is T1**.

## Governing principle

- **`enrollment_date` = source of truth.** Attendance proration (KD #113), term eligibility, academic records, audits, and retention metrics derive from it.
- **`late_enrollee` = a classification label** layered on top of that truth.

Because `enrollment_date` is required and immutable in this flow, flipping the _label_ is **low-risk**: it cannot corrupt history. The damage surface of a wrong label is reporting / analytics / badges / filters — never core academic calculation. This is what makes the feature small.

## Scope

**In scope:** a tracked, confirmed `late_enrollee → active` ("Convert to Normal Enrollee") action in the enrolment editors, **only for T1 late enrollees**. For T2–T4 late enrollees the revert is disallowed (hard-disabled).

**Gating signal:** the late enrollee's joining term is T1 — `late_enrollee_term_number === 1` (the explicit override, KD #111), falling back to the `enrollment_date`-derived term when the column is null. This is the same "term 1" that the masterfile / Academic Summary renders as **"late enrolment - term 1"**.

**Explicitly out of scope (this flow never does it):** changing `enrollment_date`, attendance records, grades, or report cards.

**Future / not now:**

- A dedicated guard that locks `enrollment_date` from editing once attendance/grades exist (no direct date editor exists today — KD #130 — so nothing edits it; worth adding when/if one is built).
- KD #144 C1 — derive the "late" label from `enrollment_date` across the ~8 enum sites (the enum is redundant with the date). Deferred hardening, independent of this.
- Encoding HFSE's T1-boundary policy ("is early-T1 late?") into the schema. **Deliberately not done** — the registrar decides per student; the audit captures the decision; the system supports both.

## UX

The behavior splits by the late enrollee's joining term:

- **T1 late enrollee** → "Active" stays selectable; **saving** it opens the convert confirm dialog (below).
- **T2/T3/T4 late enrollee** → "Active" is **disabled** in the status dropdown with a short reason (tooltip/helper: _"Joined mid-year (T{n}) — a late enrollee can't be converted to normal"_). They can still go → Withdrawn; just never → Active.

For a T1 late enrollee, saving "Active" opens a confirm dialog (same pattern as the existing withdraw / re-enrol confirms — `AlertDialog`):

> **Convert to Normal Enrollee?**
>
> This **will**:
>
> - Remove the late-enrollee classification
> - Clear the late-enrollee term
>
> This will **not**:
>
> - Change the enrollment date
> - Change attendance records
> - Change grades
> - Change report cards
>
> **Reason** (required): `____________________`

- The **Reason** field is **required** — Confirm is disabled until it's non-empty (trimmed). Mirrors the change-request reject-reason pattern (KD #25/#88).
- The "will / will not" lists use clear, distinct visual treatment (semantic icons, not colour-only — design-system §9 / Hard Rule #7): the "will" items read as changes, the "will not" items as preserved guarantees.
- For a **T1** late enrollee this is a **soft block** — the transition is allowed, just confirmed + reasoned (the server only 422s a missing reason). The hard 422 (`late_revert_not_t1`) applies only to the **T2–T4** rows, which the UI already disables.

## Server behavior

In the section-students PATCH (`app/api/sections/[id]/students/[enrolmentId]/route.ts`), on the boundary `before.enrollment_status === 'late_enrollee' && incoming enrollment_status === 'active'`:

- **T1 gate (defense in depth):** if the row's joining term is **not T1** (`late_enrollee_term_number !== 1`, with the `enrollment_date`-derived fallback when null) → **422** (`{ code: 'late_revert_not_t1' }`). The UI already hides this for T2–T4, so this is the server backstop.
- **Require the reason:** the PATCH body carries `lateRevertReason` (string). Missing/blank → **422** (`{ code: 'reason_required' }`). The reason is **audit-only** — not persisted as a column.
- On a valid T1 revert: set `enrollment_status = 'active'`, clear `late_enrollee_term_number = null` (the late-only override; no longer classified late).
- **Leave `enrollment_date` untouched** (non-negotiable).
- **No `recompute_attendance_rollup`** — `enrollment_date` didn't change, so proration is unchanged (the recompute already only fires on a real `enrollment_date` change, KD #130).

## Audit (tracked)

Reuse the existing `enrolment.metadata.update` action (lighter than a new enum value, still fully searchable):

- Add to context: `lateEnrolleeReverted: true` + `revertReason: <text>` (alongside the existing `before`/`after` enrollment_status, which already capture `late_enrollee → active`).
- `lib/audit/humanize.ts` (KD #121) renders a distinct line — e.g. **"Late enrollee reverted to active — {reason}"** — so it's unmistakable in the audit log rather than buried in a generic metadata edit. Tone `warning`.
- Surfaces on the existing Records/SIS audit-log pages (the `enrolment.metadata.update` action is already in their allowlists — no allowlist change).

## Effect on grading & attendance

The convert changes only `enrollment_status` + `late_enrollee_term_number`. Because both grading and attendance key off `section_student_id` (the unchanged row) and `enrollment_date` (deliberately untouched), there is **no effect on stored academic or attendance data** — only on the classification label.

**Attendance — no data change, fully automatic.** Proration is a pure function of `enrollment_date`, recomputed every time `recompute_attendance_rollup` runs (KD #113):

- `enrollment_date IS NULL` → counts the full term (true on-time student).
- `enrollment_date` set → counts only school days on/after that date (prorated).

The `late_enrollee` label plays **no part** — the date _is_ the switch, detected by the system automatically with no manual flag. The convert keeps `enrollment_date`, so the rollup is **byte-for-byte identical** and continues to auto-prorate from the real join date; the convert **fires no recompute** (recompute only runs on a real `enrollment_date` change, KD #130). The grid's "Before enrolment date" dimming is also `enrollment_date`-driven → unchanged.

**Grading — no change.** Grade entries key on `section_student_id` (Hard Rule #6) and compute from scores → quarterly/annual/report cards identical. Publish-readiness's per-term roster requirement (`rosterRequiredForTerm`, KD #129) keys on `enrollment_date`, not the label → unchanged.

**Only change = cosmetic classification.** The masterfile / Academic Summary stops rendering **"late enrolment - term 1"** and shows the student as a normal enrollee. That is the intended effect.

**Clear-eyed caveat (the flip side of keeping the date):** a converted student is **not** identical to a born-on-time student. On-time = `enrollment_date NULL` (full term); converted = keeps the real mid-T1 date (still prorated). So "normal" means _the label_, while attendance still honors _when they actually walked in_. Likewise, a future "Generate class index" would still bottom-pin them if their `enrollment_date` is after T1-start (KD #144 ordering uses the date, not the label). This is correct given the immutable-date rule: the date is the truth; the convert only fixes the classification. Giving them full-year attendance/ordering would require editing `enrollment_date`, which is off-limits once history exists.

## Edge cases

- **Early-T1 join the registrar considers on-time** → handled by this exact flow (convert to normal, with a reason). The T1-boundary _policy_ (is early-T1 late?) is not encoded — the registrar decides per student.
- **T2/T3/T4 late enrollee** → cannot revert. "Active" is disabled in the UI and the server 422s the transition. They genuinely joined mid-year; the only out is Withdraw.
- **Idempotency** — covered by the existing `meaningfulChange` no-op guard (shipped 2026-06-11): re-saving `active` on an already-active row writes nothing. The convert only fires on a genuine `late_enrollee → active` change.
- **`active → late_enrollee`** (the opposite direction) is unchanged — it keeps its existing joining-term suggestion flow (KD #117).
- **`withdrawn → active`** (re-enrolment) is unchanged — its own confirm (`confirmReEnrol`) still applies; this new confirm is gated specifically on `before === 'late_enrollee'`.

## Scope of files

- **UI:** every enrolment editor exposing the `enrollment_status` dropdown — `components/sis/enrolment-edit-sheet.tsx` and `components/markbook/enrolment-edit-sheet.tsx` (verify both at implementation; the admissions stage dialog edits a _different_ field and is untouched).
- **Server:** `app/api/sections/[id]/students/[enrolmentId]/route.ts` (+ its zod body schema for `lateRevertReason`).
- **Audit:** `lib/audit/humanize.ts`.

## Testing

- Unit: humanizer renders the revert line with the reason.
- Manual (test AY): a **T1** `late_enrollee` row → select Active → save → confirm dialog appears with the will/won't list; Confirm disabled until a reason is typed; on confirm the status flips to active, `late_enrollee_term_number` clears, **`enrollment_date` and the attendance rollup are byte-for-byte unchanged**; the audit log shows the reverted line + reason. Missing-reason API call → 422.
- Manual: a **T2/T3/T4** `late_enrollee` row → "Active" is disabled with the tooltip; a direct API `late→active` for such a row → 422 (`late_revert_not_t1`).
- Regression: `active → late_enrollee` suggestion flow and `withdrawn → active` re-enrol confirm both still work.

## No migration.
