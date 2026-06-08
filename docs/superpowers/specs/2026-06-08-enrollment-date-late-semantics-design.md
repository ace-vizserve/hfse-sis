# Enrollment-date as the single source of truth for late-enrollee semantics

**Date:** 2026-06-08
**Status:** Partially shipped (2026-06-08). **C3 shipped** (migration 072 — Generate-index buckets by section-tenure so transfers bottom-pin; KD #136 update). **C2 dropped** — a same-section reactivation reuses the row that already carries pre-withdrawal attendance, so re-stamping `enrollment_date` would prorate that real history out (`recompute_attendance_rollup` filters `date >= enrollment_date`); proper multi-interval proration is a known limitation, out of scope. **C1 deferred** — the `enrollment_status` enum already labels transfers `active` (not late), so deriving the label from earliest-enrollment across ~8 sites is single-source hardening, not a bug fix.
**Module:** Records / SIS (section_students lifecycle)
**Cross-refs:** KD #67 (transfer), KD #68 (late-enrollee term detection), KD #111 (late_enrollee_term_number), KD #113 (proration), KD #117 (position-aware late-enrollee), KD #130 (recompute on enrollment_date edit), KD #135/#136 (index + Generate), KD #85 (index permanence)

## Context / problem

`enrollment_date` on `section_students` is already the de-facto source of truth for **attendance proration** (KD #113: `enrollment_date IS NULL OR date >= enrollment_date`) and for the **position resolver** (`resolveEnrolmentPosition`, KD #117). The seeder stamps the founding cohort `enrollment_date = T1 start` so they read as on-time.

But the **"late enrollee" concept is overloaded** — it conflates two different facts:

1. **Joined _this section_ mid-year** — true for a genuine late enrollee _and_ for a transfer of an on-time student. Drives **attendance proration** + **roster ordering**.
2. **Joined the _school_ late** — new to HFSE after the year started. This is what "late enrollee" should _mean_ (the badge, the registrar's signal).

A naive rule ("the row's `enrollment_date` > T1 start ⟹ late") breaks case 2: **a transfer of an on-time student gets a mid-year `enrollment_date` on the new section's row**, so it would be wrongly labelled a late enrollee even though they were never late to the school.

Two concrete gaps surfaced via edge-case review:

- **Transfer:** `transferStudentSection` correctly inserts the destination row as `active` (not `late_enrollee`) — so today the _label_ is right by luck of the manual tag. But any move to "derive late from the row's date" would regress it.
- **Same-section reactivation** (withdraw → re-enrol same section, via the sync): flips `withdrawn→active` but does **not** re-stamp `enrollment_date`, so proration doesn't restart from the comeback date and the student keeps their original section-tenure.

## Principle

> **`enrollment_date` drives everything — but split by purpose:**
>
> - **Section-tenure** = the _section row's_ `enrollment_date` → **attendance proration** + **Generate-index ordering** (bottom-pin anyone who joined _this section_ mid-year).
> - **School-tenure** = the student's _earliest_ `enrollment_date` across all their `section_students` rows this AY → the **"late enrollee" label/badge** (new to the _school_ mid-year).

So: a transfer prorates + sorts to the bottom of the new section (section-tenure) but is **not** labelled late (school-tenure = on-time). A genuine late enrollee is both. A returning student (withdraw→re-enrol) is on-time school-tenure with a gap → **"returning," not late**.

## Changes

### C1. Derive the late-enrollee label from earliest school-enrollment (not the per-row enum)

- Add a helper (e.g. `lib/sis/enrolment-tenure.ts::isLateToSchool(studentEnrollmentDates, t1Start)`): a student is a **late enrollee** iff `min(enrollment_date across their non-withdrawn AY rows) > T1 start`. `null`/`≤ T1 start` ⟹ on-time.
- Use it wherever the **label/badge** is shown (Records placement badge "late · Tn", masterfile/Academic Summary status, any "late enrollee" filter) instead of reading the per-row `enrollment_status === 'late_enrollee'`.
- Keep `enrollment_status` as-is for `withdrawn` (essential) and `active`; the `late_enrollee` enum value becomes **derived/cosmetic** — not the decider. (Full retirement of the enum value is a separate, larger cleanup — out of scope here.)

### C2. Same-section reactivation re-stamps `enrollment_date`

- When the sync reactivates a withdrawn row (`enrollment_status_changes`, `withdrawn→active` in `lib/sync/students.ts`), also set `enrollment_date = sgToday()` (the comeback date) — mirroring the new-insert + transfer paths.
- Effect: attendance proration restarts from the re-enrol date (section-tenure correct); school-tenure (earliest across rows) still reflects their original on-time join, so they read **returning, not late** (C1).
- Fire `recompute_attendance_rollup` for the affected terms (KD #130 already does this on a real `enrollment_date` change via the section-students PATCH; ensure the sync reactivation path triggers it too).

### C3. Generate-index orders by section-tenure, not the status enum

- The `generate_section_index_numbers` RPC (migration 071, KD #136) currently buckets `active` (alphabetical) vs `late_enrollee` (appended). Change the bucket to **section-tenure**: `enrollment_date > T1 start` ⟹ "mid-year arrival" bucket (appended by `enrollment_date` then existing index), else alphabetical.
- Effect: a **transfer** (active, but mid-year `enrollment_date`) is correctly **bottom-pinned** in the new section without needing a `late_enrollee` tag — matching the user's Edge-1 expectation while keeping the label honest (C1). Requires joining `terms` for the T1 start inside the RPC (or passing it in).
- Withdrawn rows stay retired/burned (unchanged).

### C4. (Decision, low-effort) "Returning" vs "late" surfacing

- A withdraw→re-enrol student is on-time school-tenure with a gap. Decide whether to show a distinct **"returning"** indicator or simply _not-late_. Recommend: not-late (no special badge) for v1; revisit if HFSE wants a returning marker. No data change either way.

## Edge-case matrix (target behavior)

| Scenario                                       | Section row `enrollment_date`        | Proration / ordering                                                | Late-enrollee label          |
| ---------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------- | ---------------------------- |
| On-time founding                               | T1 start (or null)                   | from year start / alphabetical                                      | No                           |
| Genuine late enrollee (new to school mid-year) | mid-year                             | from join date / bottom                                             | **Yes**                      |
| Transfer of on-time student → new section      | transfer date (mid-year)             | from transfer date / bottom of new section                          | **No** (earliest = T1 start) |
| Withdraw → re-enrol **same** section           | **re-stamped** to comeback date (C2) | from comeback date / (reactivated row keeps its index — KD restore) | No (returning)               |
| Withdraw → re-enrol **different** section      | new-section join date                | from join date / bottom of new section                              | No (returning)               |

## Files likely touched

- `lib/sis/enrolment-tenure.ts` (new) — `isLateToSchool` + earliest-enrollment helper (pure, unit-tested).
- `lib/sync/students.ts` — reactivation re-stamps `enrollment_date` + triggers recompute (C2).
- `supabase/migrations/0XX_generate_index_section_tenure.sql` — amend the Generate RPC's bucket to section-tenure (C3). (New migration; don't edit 071 in place if already applied to prod.)
- Label/badge consumers: Records placement section (`lateTermResult`/badge), masterfile/Academic Summary status, any late-enrollee filter — switch to the derived helper (C1).
- Tests: tenure helper unit tests + the edge-case matrix as integration-ish assertions where feasible.

## Non-goals

- Retiring the `enrollment_status = 'late_enrollee'` enum value entirely (larger sweep; here it just stops being the decider).
- Changing transfer/withdrawal mechanics (KD #67) beyond the reactivation re-stamp.
- Any change to the index permanence / Generate tool's withdrawn-retired rule (KD #85/#136).

## Verification

- `npx tsc --noEmit` + `npx vitest run` + `npx next build` clean.
- Walk the edge-case matrix on a seeded AY: transfer an on-time student → bottom of new section, prorates from transfer date, **not** badged late; create a genuine mid-year enrollee → badged late; withdraw→re-enrol same section → index restored, prorates from comeback, not badged late.
- Confirm the masterfile/Academic Summary status + Records badge read identically (single derivation).
- Build via subagent-driven development + a `feature-dev:code-reviewer` pass.
