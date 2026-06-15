# Report card — N.A. for terms a student wasn't enrolled in (enrolment-coverage proration)

**Date:** 2026-06-15
**Status:** Design approved, pending implementation plan

## Context / problem

On the report card, a student who was not enrolled for a full term currently shows misleading
data instead of "not applicable":

- **Attendance is not prorated.** `build-report-card.ts` overrides each term's `school_days` with
  the **full** school-calendar teaching-day count (so the denominator is correct when attendance
  hasn't been fully entered yet), while `days_present` comes from the prorated rollup (`= 0` for a
  term the student wasn't there for). Result: a late enrollee's pre-join term shows `0 present /
full-term-days` — reading as "absent all term" — and those `0/full` terms also **deflate** the
  cumulative attendance % (`computeAttendancePercentage` sums every term). The same happens, mirrored,
  for terms **after** a mid-year withdrawal.
- **Grades prorate, but with a hole.** `computeAnnualGrade(t1..t4, naFlags)` already excludes a term
  that is `null` **and** flagged `is_na`, renormalizing the remaining weights to 100%. Late-enrollee
  entries are auto-flagged `is_na` at sheet creation (`app/api/grading-sheets/route.ts:201`). But when
  a pre-join term has **no grade entry at all** (the term's sheet predated the student), the cell is
  blank, `is_na` is false, and `computeAnnualGrade` returns `null` (incomplete) instead of prorating.

The enrolment dates needed to fix both are already stored: `section_students.enrollment_date` (the
join date, date-precise, derived from the chosen joining term per KD #117) and
`section_students.withdrawal_date`. The report card simply ignores them for these computations.

## The rule (single source of truth)

A student's **enrolment coverage** in the AY = the union of `[enrollment_date, withdrawal_date]`
intervals across their `section_students` rows for that AY. A transfer (KD #67) contributes two
abutting rows → continuous coverage; an active row is open-ended (`withdrawal_date = null`); a null
`enrollment_date` means "from the start of the year."

For each term:

> **enrolled-school-days(term)** = count of school-calendar teaching days in `[term.start, term.end]`
> that fall inside the student's enrolment coverage.
> **enrolled = enrolled-school-days > 0.** The term is **N.A.** when the count is 0.

A day `d` counts as enrolled when, for any of the student's rows,
`enrollment_date <= d <= withdrawal_date` (open-ended end when `withdrawal_date` is null; open-ended
start when `enrollment_date` is null). Inclusive end-boundary is a deliberate minor choice. Dates are
date-only SGT (KD #32) and compared as `yyyy-mm-dd` strings (lexicographic — no timezone math).

This one count drives every case uniformly:

| Case                                   | Behaviour                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Normal active (`enrollment_date` null) | Full terms, unchanged.                                                                          |
| Late enrollee                          | Pre-join terms = 0 days → N.A.; join term clamped to days from `enrollment_date`.               |
| Withdrawal                             | Post-withdrawal terms = 0 days → N.A.; withdrawal term clamped to days up to `withdrawal_date`. |
| Transfer                               | Union is continuous → full terms, unchanged.                                                    |

## Components

### 1. Shared pure helper (new)

A small, unit-testable function — e.g. `lib/report-card/enrolment-coverage.ts`:

- Input: the student's enrolment intervals `Array<{ start: string | null; end: string | null }>`, a
  term `{ start_date; end_date }`, and the set/list of school-calendar teaching dates for that term
  (or a predicate to test a date).
- Output: `{ enrolledSchoolDays: number; enrolled: boolean }`.
- `enrolled = enrolledSchoolDays > 0`. Null start → from term start; null end → through term end.

Keep it pure (no DB) so the caller supplies the calendar dates; this mirrors how `build-report-card`
already pulls per-term school-calendar data.

### 2. Attendance — `build-report-card.ts` + `report-card-document.tsx`

- For **enrolled** terms, replace the full-term `school_days` override with the **clamped** count from
  the helper (`enrolled-school-days` per term, per the student's coverage). For a normal full term the
  clamped count equals the full count, so behaviour is unchanged.
- For **not-enrolled** terms (count = 0), **omit the attendance record entirely** for that term. This
  single mechanism drives both outcomes:
  - **Display:** the document does `attendance.find(a => a.term_id === t.id)` per term
    (`report-card-document.tsx:245`); a missing record → `val ?? 'N.A.'` renders **N.A.** across all
    three rows (School Days / Present / Late).
  - **Cumulative %:** `computeAttendancePercentage` receives only the enrolled-term records, so it sums
    over enrolled terms only. No signature change. (Do **not** pass a not-enrolled term with
    `school_days: null` — that would null the entire cumulative %.)
- `build-report-card.ts` must also **select `withdrawal_date`** (alongside `enrollment_date`) on the
  enrolment-row query used to derive coverage.

### 3. Grades — `build-report-card.ts`

After assembling each subject's `byTerm` cells, **post-process**: for any term where `!enrolled`,
replace the cell with the N.A. cell `{ quarterly: null, letter: null, is_na: true }`. Then existing
logic handles the rest with no further change:

- **Display:** grade cell already renders `'N.A.'` when `cell.is_na` (`report-card-document.tsx:405`).
- **Annual:** `computeAnnualGrade` sees `quarterly = null` + `is_na = true` → excludes the term and
  renormalizes weights to 100%. Forcing `quarterly = null` also guards the rare stray-grade case.
- **General Average:** unchanged — averages the now-prorated examinable annuals; only a genuinely
  incomplete _enrolled_ term (enrolled but ungraded) still yields `null`, which is correct.

Result: a T3 joiner's annual = `T3·0.2 + T4·0.4` renormalized; a student withdrawn after T2 = `T1·0.2

- T2·0.2` renormalized; GA averages those prorated annuals.

## Edge cases

- **Transfers (KD #67):** coverage is the union across the student's rows → continuous → no spurious
  N.A. `build-report-card` already unions attendance/grades across `allEnrolmentIds`.
- **Null `enrollment_date`** (normal active): fully enrolled; behaviour unchanged.
- **Interim (T1–T3) vs final (T4) card:** the rule applies to whichever terms are displayed; on the
  final card it also drives the prorated annual + GA.
- **SGT dates (KD #32):** compare date-only `yyyy-mm-dd` strings; no `Date`/timezone math.
- **Withdrawal-term grades:** if the student was graded for the partial withdrawal term, that grade is
  real (term is enrolled, count > 0); only fully-after terms go N.A.

## Testing

- **Helper unit tests:** null start → full window; start before term → full; start mid-term →
  clamped; start after term end → empty + `enrolled:false`; end (withdrawal) before term → empty;
  end mid-term → clamped; transfer (two abutting intervals) → continuous coverage.
- **Clamped school-day count** over a small fixture calendar (verifies the calendar intersection).
- **`computeAnnualGrade`** proration is already self-tested; add a build-level assertion that pre-join
  / post-withdrawal terms drive N.A. → renormalized annual.
- **Manual:** E990114 (late T3) — T1/T2 N.A. on both attendance + grades, T3 prorated denominator,
  annual = T3/T4 renormalized, GA present. Plus a withdrawn-after-T2 fixture — T3/T4 N.A., annual over
  T1/T2.

## Out of scope

- No schema change (uses existing `enrollment_date` + `withdrawal_date`).
- No change to the attendance rollup RPC or `computeAnnualGrade`/`computeGeneralAverage`/
  `computeAttendancePercentage` signatures — only how `build-report-card` feeds them.
- The auto-`is_na`-on-late-enrollee behaviour at sheet creation (`grading-sheets/route.ts:201`) is left
  as-is; the report card now derives N.A. from dates independently, so it no longer relies on that flag
  for pre-join terms.
