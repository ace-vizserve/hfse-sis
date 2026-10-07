# Term 4 framework — a grading sheet type

**Date:** 2026-10-07 · **Status:** design approved in conversation, spec awaiting review · **KD:** #230 (to be added on build)

## Why

Secondary Four has only ~2 weeks of Term 4 before O-Level study leave (5 Oct – 10 Nov 2026), so the school replaced the usual WW/PT/exam Term 4 with a fixed framework. HFSE ran it in AY2025 in Excel; AY2026's Sec 4 Term 4 **will be graded in the SIS**. In Excel the 50% means pulling every subject's term grades across many workbooks by name lookup, which is error-prone (a report card went out with wrong grades on 2026-10-06 while grading is still in Excel).

## The rule (agreed with Mr Ace, 2026-10-07)

Sources: the school's "Term 4 Grading Framework for Secondary 4 Students" and the 22 May 2026 parent letter (pasted in conversation, not in the repo).

| Part                      | Weight | What it is                                                                                                                               | Max |
| ------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | --- |
| Best term average         | 50%    | The student's best **term average** of T1, T2, T3 — one number for the whole term, not per subject, the same value in every subject's T4 | 100 |
| Teacher's recommendation  | 20%    | One score, marked by the teacher against the school's rubric (participation, homework, project work, effort)                             | 30  |
| Revision task / Mock exam | 30%    | One score — a revision assignment or a condensed mock exam, by subject                                                                   | 100 |

- **Term average** = mean of the student's `quarterly_grade` across **examinable subjects only** for that term (same set as the General Average).
- **Late enrollees: prorate.** A term average counts only the subjects that have a grade for that term (`is_na` rows and missing grades skipped); a term with no grades at all is not a candidate. The term the student joined is already prorated by the registrar's "Counted assessments" (KD #225).
- **Conversion:** the 50/20/30 total is the initial grade and goes through the **same DepEd transmutation** as every term. Same rounding as every sheet.
- **Final Grade unchanged:** `T1×20% + T2×20% + T3×20% + T4×40%` (the doc: "preserve the overall 40% Term 4 weighting"; AY2025's report book confirms).
- **Non-examinable (letter) subjects are untouched.**
- **O-Level vs non-O-Level:** not an SIS concern. The school creates the sheets and attaches them to sections.

Worked example: averages T1 86 / T2 84 / T3 84.5 → best 86. Rec 24/30, task 70/100.
`86×0.5 + 80×0.2 + 70×0.3 = 43 + 16 + 21 = 80` → transmuted **87**.

## Name

**Term 4 framework** (the school's own title for it). Key `term4_framework`; every existing sheet is `standard`. Named for what the school calls it, not for "Sec 4" — any level could be given one.

## Approach: a sheet type that reuses the three components

Every sheet already has three components with per-sheet weights (migration 159). A `term4_framework` sheet is a standard sheet with a fixed shape and relabelled components:

| Component | On a Term 4 framework sheet                             | Slots | Max | Weight |
| --------- | ------------------------------------------------------- | ----- | --- | ------ |
| WW        | Best term average — **filled by the system, read-only** | 1     | 100 | 0.50   |
| PT        | Teacher's recommendation                                | 1     | 30  | 0.20   |
| QA        | Revision task / Mock exam                               | —     | 100 | 0.30   |

So `computeQuarterly` (`lib/compute/quarterly.ts`) and the database's `compute_quarterly` / `grade_entries_derive()` are **not changed**. Report card, Masterfile, publish readiness, change requests, locking and the audit trail all read `quarterly_grade` as they do today. Hard Rule #1's 93 test is untouched.

Rejected: a new formula branch carrying the best-term rule inside the computation — rewrites both formula copies and touches every consumer for the same result.

## Components

### 1. Schema (migration 183)

- `grading_sheets.sheet_type text not null default 'standard' check (sheet_type in ('standard','term4_framework'))`.
- A CHECK (or trigger guard) that a `term4_framework` sheet has `ww_totals = '{100}'`, `pt_totals = '{30}'`, `qa_total = 100`, weights `0.50/0.20/0.30`.
- Grade-entry guard: on a `term4_framework` sheet, `ww_scores` may only be written by the best-term function (service path), never by a teacher's score PATCH. Raise a named error (pattern of `HFEXC`) otherwise.
- Excusing slots (KD #225) is refused on this sheet type — there is nothing to prorate inside a single score.

### 2. Creating the sheet

> **Superseded 2026-10-08: sheets are switched, not created.** Mr Ace: a sheet becomes a Term 4 framework sheet by switching an existing sheet ("Switch sheet type", migration 185); new sheets are always Standard. See KD #230's update.

- Single create (`app/(markbook)/markbook/grading/new/new-sheet-form.tsx` → `POST app/api/grading-sheets`): a **Sheet type** choice, Standard / Term 4 framework. Choosing Term 4 framework hides the slot/max/weight inputs and sends the fixed shape; the server sets it regardless of what the client sends.
- Bulk create is unchanged — it only makes Standard sheets. Term 4 framework sheets are created one at a time for the sections that use them.
- On create, the best term average is filled for every seeded entry immediately.
- The totals/weights route refuses a `term4_framework` sheet before it reaches `isSubjectTermSplit`, so that gate needs no exemption. The totals editor is hidden on this type; the per-subject term-weights route and the config sync skip these sheets.

### 3. Best term average

- **SQL:** `public.student_best_term_average(p_student_id, p_academic_year_id) returns (best numeric, term_number int)` — per term T1–T3, mean of examinable `quarterly_grade` over non-N/A entries the student has; returns the highest, ties to the later term (value is identical either way; the term shown is the only difference). Rounded like the General Average (1 decimal, `computeGeneralAverage`).
- **SQL only — no TS copy.** The grid reads the value and its source term through `public.best_term_averages_for_sheet(p_sheet_id)`; one copy of the rule cannot drift from another.

### 4. Keeping it live

- Trigger on `grade_entries` AFTER INSERT/UPDATE (not `UPDATE OF` — `quarterly_grade` is set by the BEFORE derive trigger, never in the caller's SET list, so a column-filtered trigger would never fire), acting only when `quarterly_grade` or `is_na` actually changed on a T1–T3 entry: recompute that student's best term average and write it into the WW slot of each of their `term4_framework` entries in the same AY. `grade_entries_derive()` then re-derives the T4 grade as usual.
- **Locked T4 sheets update too.** A locked T1–T3 grade only changes through an approved change request, so T4 follows it (Mr Ace: "of course update if approved"). Each cascaded change writes a `grade_audit_log` row naming the source change; no new `approval_reference` is asked for — the source edit carried it.
- Recursion guard: the trigger fires only for T1–T3 rows and only writes T4 rows.

### 5. The grid

- `components/grading/score-entry-grid.tsx` takes the sheet type. Headers on `term4_framework`: **Best term average (50%) · Teacher's recommendation (20%) · Revision task / Mock exam (30%)** — never WW/PT/QA, desktop and mobile.
- The best-term-average cell is read-only and shows which term it came from ("T2 average · 86.4").
- A student with **no T1–T3 grades at all** (joined in T4): the cell stays blank and reads "No earlier grades". The row never counts as fully graded (the slot is blank, `lib/grading/row-complete.ts`), so it is not judged; any interim grade shown lacks the 50% and is for the registrar to resolve.
- Report card and Masterfile show T4 as one number, as today. No change.

## Error handling

- Teacher writes to the best-term cell → server refuses with a plain message ("The best term average is filled in by the system").
- Shape or weight edit on a `term4_framework` sheet → refused.
- Cascade failure must not block the source T1–T3 save from being audited — run inside the same transaction so both commit or neither does.

## Testing

- Hard Rule #1: 93 test unchanged (both copies).
- Worked example: best 86, rec 24/30, task 70/100 → initial 80 → quarterly **87** (the existing TS and SQL formulas, fed the fixed shape).
- Term average: examinable only; N/A and missing subjects skipped; late enrollee with no T1 picks from T2/T3; no grades → null and flagged.
- Cascade: change a student's T2 grade → their T4 grade moves in every subject, locked sheets included, with audit rows.
- Guards: teacher write to the best-term cell refused; shape/weight edit refused; excusing refused.
- Create: a Term 4 framework sheet gets the fixed shape whatever the client sends.
- DataTable column labels (KD #161) for any new column.

## Out of scope

- A general grading-sheet template creator (Mr Ace floated it, "just proposing").
- The rubric content behind the 30 marks (teacher guidance, not stored).
- Any change to the Final Grade or General Average formulas.
