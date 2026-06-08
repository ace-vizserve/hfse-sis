# Evaluation dashboard — replace vanity metrics with chase metrics

## Context

The Evaluation module is narrowly FCA write-ups (T1–T3 report-card comments, KD #49/#114). Its dashboard had two weak KPI cards — **"Time to submit / Median time-to-submit"** and **"Late submissions (>14d)"** — both computed as `submitted_at − created_at` (draft-dwell time). They mislead: `created_at` is just when the adviser first saved the row, so a submit-without-drafting reads ~0 days, and "late" has **no real deadline** behind it (the PTC/deadline machinery was removed, KD #114). Replace them with two **chase** metrics a registrar can act on to get every FCA comment finished before report cards publish.

## Design — two live-state, term-scoped cards (replace the two weak ones)

Both are **live state** (the current gap), **scoped to the picker's resolved current term** (KD #124 `resolveCurrentTerm`) — NOT date-windowed. Count == drill (KD #82). **Registrar/oversight view only** — mount on the dashboard's existing oversight branch (KD #57); a teacher's own-progress view is unchanged.

**1. Outstanding write-ups** — count of students in the term's **active roster** who lack a **submitted, non-empty** write-up.

- Roster resolved by current `section_students` (`enrollment_status != 'withdrawn'`), tallied by `student_id` (KD #120 — transfer-safe; never the denormalized `evaluation_writeups.section_id`).
- "Has a write-up" = a row with `submitted = true` AND non-empty `writeup` content (matches the KD #120 submitted-count rule).
- **Drill** (`outstanding-writeups`): one row per outstanding student — student name (link → `/records/students/[studentNumber]`, KD #81) · section · form adviser. The registrar's worklist.

**2. Advisers behind** — count of **form advisers** with ≥1 outstanding write-up in their advisory section(s) this term.

- Attribution: a section's outstanding write-ups roll up to that section's **form adviser** (`teacher_assignments` role `form_adviser`). FCA write-ups are the form adviser's responsibility (KD #49).
- **Sections with no form adviser assigned** are surfaced separately (a "Unassigned section" bucket / flag), not silently dropped.
- **Drill** (`advisers-behind`): one row per behind adviser — adviser name · outstanding count · their section(s), **sorted by biggest gap first**.

## Scope & edge cases

- **Current term only** (the picker's resolved term). **T4 → no FCA write-ups** (KD #49) → both cards read "—" (skip the query, like the publish-readiness virtue-theme gate).
- Live-state → no date window → count == drill regardless of the picker's date range.
- Empty/healthy state: 0 outstanding / 0 advisers behind → mint "all caught up".

## Removed

`medianTimeToSubmitDays` + `lateSubmissions` (computation `lib/evaluation/dashboard.ts` ~L124–169; the `medianDays` helper if now unused) + their two MetricCards on the eval dashboard page + any drill target/handling they used. **Keep** submission % + submitted count + the velocity sparkline + the existing drills.

## Build

- `lib/evaluation/dashboard.ts` — add `outstandingWriteups: number` + `advisersBehind: number` (+ unassignedSections flag) to the range KPIs, computed from the roster + write-ups + form-adviser join, term-scoped; remove the two old fields.
- `lib/evaluation/drill.ts` — two new targets `outstanding-writeups` (student rows) + `advisers-behind` (adviser rows), reusing the roster-based resolution the sections-picker / priority loaders already use (KD #120) + the linkified-identifier pattern (KD #81). No date scoping (live-state).
- `app/(evaluation)/evaluation/page.tsx` — swap the two cards (oversight branch only); wire the two drill sheets.
- Reuse: `resolveCurrentTerm`, the roster/write-up resolution from `lib/evaluation/queries.ts`, `teacher_assignments` form-adviser lookup, `<MarkbookDrillSheet>`-style eval drill sheet.

## Verification

- `npx tsc --noEmit` + `npx vitest run` + `npx next build` clean.
- Manual (re-seed test AY first): Outstanding count == its drill row count; Advisers-behind count == its drill row count; both reflect the current term and change when you submit a missing write-up; T4 reads "—"; teacher view unchanged; sections with no adviser show in the "unassigned" flag, not dropped.
- Execute via subagent-driven development + a `feature-dev:code-reviewer` pass.
