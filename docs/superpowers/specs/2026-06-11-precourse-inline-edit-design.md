# Pre-course counselling tracker — inline session-date editing — design spec

**Date:** 2026-06-11
**Status:** Design — approved, pending plan
**Scope:** Make the pre-course counselling tracker actionable — let admissions staff record/correct/clear a counselling **session date** inline, flipping the applicant between "Not yet counselled" and "Counselled."

## Context

The pre-course cohort (`/admissions/cohorts/pre-course`) is a regulatory tracker (ICA/CPE pre-course counselling acknowledgement — every applicant, KD #144/cohort work). It is **read-only today**: the data (`preCourseAnswer` / `preCourseDate` / `preCourseAcknowledgedAt` on `ay{YYYY}_enrolment_applications`) originates from the parent portal at application time; there is no SIS write path. The two-bucket model (already shipped): **Counselled** = `preCourseAnswer='Yes'` + a signing `preCourseDate` (the proof); **Not yet counselled** = `'No'` or no answer; a "Yes" without a date is an excluded invalid record.

HFSE counsels applicants and co-signs the acknowledgement form; when they work a "Not yet counselled" applicant, they need to **record the session date** in the SIS. This adds that inline write path.

## Design

### Surface

Inline on the tracker (`/admissions/cohorts/pre-course`), the **"Session date"** cell becomes an editable canonical `DatePicker` (KD #44) — **only** for the `pre-course` cohort kind; the shared `CohortTable` (KD #84) is unchanged for the other kinds.

### Write semantics (date = proof; auto-flip the bucket)

- **Not yet counselled row** → empty picker with a "Record session" affordance. Picking a date sets `preCourseAnswer='Yes'` + `preCourseDate=<date>` → the row flips to **Counselled** (moves out of the default "Not yet counselled" tab).
- **Counselled row** → shows the date, editable to **correct** it (re-PATCH `preCourseDate`).
- **Clear (✕)** → `preCourseDate=null` + `preCourseAnswer=null` → back to **Not yet counselled**.
- **`preCourseAcknowledgedAt` is never written** — it's the parent-portal app-confirmation timestamp; the **date** is the compliance proof.
- **Any date allowed** (incl. future) — registrar discretion; no future-date block.

### Route

New `PATCH /api/sis/students/[enroleeNumber]/pre-course` — mirrors the existing `stp-status` route (KD #61) structure:

- `requireRole(['admissions','registrar','superadmin'])` — the operational-writer set, matching the `stp-status` route (KD #74: `school_admin` views the tracker but is read-only oversight, so it's excluded from the write even though it can see the page).
- zod body `{ sessionDate: string | null }` — `sessionDate` is `YYYY-MM-DD` or `null`; transform `''`→null.
- Resolves the current AY → `ay{YYYY}_enrolment_applications` (the `ay${code.replace(/^AY/i,'').toLowerCase()}` slug pattern, KD #53), updates the row by `enroleeNumber`:
  - non-null date → `preCourseAnswer='Yes'`, `preCourseDate=<date>`.
  - null → `preCourseAnswer=null`, `preCourseDate=null`.
- Audits `sis.precourse.update` (the `sis.*` prefix for admissions-team edits on `ay{YY}_*` tables, KD #70) with before/after in context.
- `revalidateTag('sis:${ayCode}')` so the tracker + the dashboard "Pre-course counselling %" stat (`getPreCourseStats`) refresh.
- 404 if the application row isn't found; 400 on invalid date.

### Client

- A small `'use client'` editable-date cell for the pre-course column (the `CohortTable` column def renders it for `kind==='pre-course'`). It has the row's `enroleeNumber` + the table's `ayCode`.
- Raw `fetch` + `toast` (KD #24); optimistic: on success, update the row's local `preCourseDate`/`preCourseAnswer`/`preCourseStatus` so the status badge + bucket reflect immediately; revert + `toast.error` on failure.
- Uses the canonical `DatePicker` with a clear control.

### Audit action

Add `sis.precourse.update` to the `AuditAction` union + the audit humanizer (`lib/audit/humanize.ts`, KD #121) label ("Pre-course session recorded/updated"), and to the `/admissions/audit-log` allowlist (it's a `sis.*` admissions edit, KD #70).

## Out of scope

- No bulk "mark counselled" action (single-row inline only; add later if the backlog warrants).
- No edit on the applicant detail page (KD #97) — deferred; the tracker is the worklist. (Could add later for completeness.)
- `preCourseAcknowledgedAt` stays read-only/portal-owned.
- No change to the two-bucket model, the loader, or `getPreCourseStats` logic (they already key off answer + date).

## Data safety

- Pre-AY-table write via the service client; pre-course is submitted once by the portal and not re-written post-submission, so SIS edits won't be clobbered.
- The `Yes`-without-date invalid state is never produced (date and answer are written together).

## Verification

- `npx tsc --noEmit` + `npx next build` clean.
- Record a date on a "Not yet counselled" row → flips to Counselled, date shows, persists on reload; dashboard stat ticks. Correct a date → persists. Clear → back to Not yet counselled. Audit row written. Non-admissions roles 403.
- One small branch; `feature-dev:code-reviewer` pass (route role gate + AY-slug + audit + revalidate; optimistic cell revert; KD #44 DatePicker). No migration.
