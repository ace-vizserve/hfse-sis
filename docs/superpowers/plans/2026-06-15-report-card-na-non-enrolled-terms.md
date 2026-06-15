# Report card — N.A. for non-enrolled terms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the report card, a term a student wasn't enrolled for renders **N.A.** (not `0/full-days`), and attendance + the annual grade / General Average prorate over enrolled terms only.

**Architecture:** One pure helper derives, per term, whether the student was enrolled (their `[enrollment_date, withdrawal_date]` coverage overlaps the term window) and the clamped school-day count (calendar dates within coverage). `build-report-card.ts` feeds that into the existing attendance + grade assembly — omitting not-enrolled terms from the attendance list (the document already renders N.A. for a missing record) and forcing not-enrolled grade cells to the `is_na` N.A. cell (which `computeAnnualGrade` already excludes + renormalizes). No document, schema, or compute-signature changes.

**Tech Stack:** TypeScript, Vitest (jsdom env; pure `.test.ts`), Supabase (`@supabase/ssr`).

Spec: `docs/superpowers/specs/2026-06-15-report-card-na-non-enrolled-terms-design.md`. Branch: `feat/report-card-na-non-enrolled-terms`.

---

### Task 1: Enrolment-coverage helper (pure, TDD)

**Files:**

- Create: `lib/report-card/enrolment-coverage.ts`
- Test: `__tests__/report-card/enrolment-coverage.test.ts`

Dates are date-only SGT `yyyy-mm-dd` strings (KD #32) → lexicographic string compare, no `Date` math.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/report-card/enrolment-coverage.test.ts
import { describe, it, expect } from 'vitest';
import {
  isEnrolledForTerm,
  dateInCoverage,
  termEnrolment,
  type EnrolmentInterval,
} from '@/lib/report-card/enrolment-coverage';

const T1 = { start_date: '2026-01-05', end_date: '2026-03-13' };
const T3 = { start_date: '2026-06-29', end_date: '2026-09-04' };
const T3_DATES = ['2026-06-29', '2026-06-30', '2026-07-01']; // sample teaching days

describe('isEnrolledForTerm', () => {
  it('normal student (null/null) is enrolled for every term', () => {
    const cov: EnrolmentInterval[] = [{ start: null, end: null }];
    expect(isEnrolledForTerm(cov, T1.start_date, T1.end_date)).toBe(true);
    expect(isEnrolledForTerm(cov, T3.start_date, T3.end_date)).toBe(true);
  });

  it('late enrollee (joins T3) is NOT enrolled for T1, IS for T3', () => {
    const cov: EnrolmentInterval[] = [{ start: '2026-06-29', end: null }];
    expect(isEnrolledForTerm(cov, T1.start_date, T1.end_date)).toBe(false);
    expect(isEnrolledForTerm(cov, T3.start_date, T3.end_date)).toBe(true);
  });

  it('withdrawal (ends in T1) is enrolled for T1, NOT for T3', () => {
    const cov: EnrolmentInterval[] = [{ start: null, end: '2026-03-13' }];
    expect(isEnrolledForTerm(cov, T1.start_date, T1.end_date)).toBe(true);
    expect(isEnrolledForTerm(cov, T3.start_date, T3.end_date)).toBe(false);
  });

  it('transfer (two abutting intervals) stays continuously enrolled', () => {
    const cov: EnrolmentInterval[] = [
      { start: '2026-01-05', end: '2026-04-15' },
      { start: '2026-04-15', end: null },
    ];
    expect(isEnrolledForTerm(cov, T1.start_date, T1.end_date)).toBe(true);
    expect(isEnrolledForTerm(cov, T3.start_date, T3.end_date)).toBe(true);
  });
});

describe('dateInCoverage', () => {
  const cov: EnrolmentInterval[] = [{ start: '2026-07-01', end: null }];
  it('excludes dates before the start, includes on/after', () => {
    expect(dateInCoverage('2026-06-30', cov)).toBe(false);
    expect(dateInCoverage('2026-07-01', cov)).toBe(true);
    expect(dateInCoverage('2026-07-02', cov)).toBe(true);
  });
});

describe('termEnrolment', () => {
  it('not-enrolled term → enrolled false, 0 school days', () => {
    const cov: EnrolmentInterval[] = [{ start: '2026-06-29', end: null }];
    expect(termEnrolment(cov, T1, ['2026-01-06', '2026-01-07'])).toEqual({
      enrolled: false,
      enrolledSchoolDays: 0,
    });
  });

  it('full term → enrolled true, all calendar days counted', () => {
    const cov: EnrolmentInterval[] = [{ start: null, end: null }];
    expect(termEnrolment(cov, T3, T3_DATES)).toEqual({
      enrolled: true,
      enrolledSchoolDays: 3,
    });
  });

  it('join term → enrolled true, denominator clamped to days from join date', () => {
    const cov: EnrolmentInterval[] = [{ start: '2026-07-01', end: null }];
    expect(termEnrolment(cov, T3, T3_DATES)).toEqual({
      enrolled: true,
      enrolledSchoolDays: 1, // only 2026-07-01
    });
  });

  it('enrolled but empty calendar → enrolled true, 0 (caller falls back)', () => {
    const cov: EnrolmentInterval[] = [{ start: null, end: null }];
    expect(termEnrolment(cov, T3, [])).toEqual({
      enrolled: true,
      enrolledSchoolDays: 0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/report-card/enrolment-coverage.test.ts`
Expected: FAIL — `Cannot find module '@/lib/report-card/enrolment-coverage'`.

- [ ] **Step 3: Write the helper**

```ts
// lib/report-card/enrolment-coverage.ts
// Per-term enrolment derivation for the report card. A student's coverage is the
// union of their section_students [enrollment_date, withdrawal_date] intervals in
// the AY (a transfer = two abutting rows → continuous; active row = open end; null
// enrollment_date = open start). Drives N.A. for terms the student wasn't enrolled
// in, and the clamped attendance denominator for the term they joined/left mid-way.
//
// All dates are date-only SGT 'yyyy-mm-dd' strings (KD #32): lexicographic compare,
// no Date/timezone math.

export type EnrolmentInterval = { start: string | null; end: string | null };

// True when any interval overlaps the term window [termStart, termEnd].
// null start = -infinity, null end = +infinity.
export function isEnrolledForTerm(
  coverage: EnrolmentInterval[],
  termStart: string,
  termEnd: string
): boolean {
  return coverage.some((iv) => {
    const endsAtOrAfterTermStart = iv.end == null || iv.end >= termStart;
    const startsAtOrBeforeTermEnd = iv.start == null || iv.start <= termEnd;
    return endsAtOrAfterTermStart && startsAtOrBeforeTermEnd;
  });
}

// True when the date falls inside any interval (inclusive both ends).
export function dateInCoverage(
  date: string,
  coverage: EnrolmentInterval[]
): boolean {
  return coverage.some(
    (iv) =>
      (iv.start == null || iv.start <= date) &&
      (iv.end == null || date <= iv.end)
  );
}

// enrolled = the coverage overlaps the term window (date-based, so an unconfigured
// calendar does NOT falsely mark an enrolled term N.A.). enrolledSchoolDays = the
// calendar teaching days that fall inside coverage (the clamped denominator); 0
// when not enrolled or when the calendar is empty (caller falls back).
export function termEnrolment(
  coverage: EnrolmentInterval[],
  term: { start_date: string; end_date: string },
  calendarDates: string[]
): { enrolled: boolean; enrolledSchoolDays: number } {
  const enrolled = isEnrolledForTerm(coverage, term.start_date, term.end_date);
  const enrolledSchoolDays = enrolled
    ? calendarDates.filter((d) => dateInCoverage(d, coverage)).length
    : 0;
  return { enrolled, enrolledSchoolDays };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/report-card/enrolment-coverage.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/report-card/enrolment-coverage.ts __tests__/report-card/enrolment-coverage.test.ts
git commit -m "feat(report-card): add enrolment-coverage helper for per-term N.A."
```

---

### Task 2: Thread enrolment dates + term dates through `build-report-card.ts`

**Files:**

- Modify: `lib/report-card/build-report-card.ts` (terms select + `Term` type ~43-54, ~124-127; enrolments select + `Enrolment` type + filter ~132-179)

No behaviour change yet — this only makes the data available. Verify with `tsc`.

- [ ] **Step 1: Add `start_date, end_date` to the terms select and `Term` type**

In the `Term` type (around line 43), add the two fields after `virtue_theme`:

```ts
export type Term = {
  id: string;
  term_number: number;
  label: string;
  virtue_theme: string | null;
  start_date: string;
  end_date: string;
};
```

In the terms query (around line 124), add the columns:

```ts
const { data: terms } = await supabase
  .from('terms')
  .select('id, term_number, label, virtue_theme, start_date, end_date')
  .eq('academic_year_id', ay.id)
  .order('term_number');
```

- [ ] **Step 2: Add `enrollment_date, withdrawal_date` to the enrolments select, `Enrolment` type, and the filter predicate**

In the enrolments query (around line 132):

```ts
const { data: enrolments } = await supabase
  .from('section_students')
  .select(
    `id, enrollment_status, created_at, enrollment_date, withdrawal_date,
       section:sections!inner(id, name, form_class_adviser, academic_year_id,
         level:levels(id, code, label, level_type))`
  )
  .eq('student_id', studentId);
```

In the `Enrolment` type (around line 154):

```ts
type Enrolment = {
  id: string;
  enrollment_status: string;
  created_at: string | null;
  enrollment_date: string | null;
  withdrawal_date: string | null;
  section: SectionLite | SectionLite[] | null;
};
```

In the `ayEnrolments` filter predicate (around line 170), add the two fields to the narrowed type so they survive the `is` guard:

```ts
      ): e is {
        id: string;
        enrollment_status: string;
        created_at: string | null;
        enrollment_date: string | null;
        withdrawal_date: string | null;
        section: SectionLite;
      } => !!e.section && e.section.academic_year_id === ay.id
```

- [ ] **Step 3: Build `coverage` + `enrolledByTermNumber` after `ayEnrolments` is finalized**

Immediately after the `if (ayEnrolments.length === 0) { ... }` block (around line 185, before the `primary` selection is fine; place it right after that guard), add:

```ts
// Per-term enrolment coverage (KD #67 transfer-safe: union of all rows).
// Drives N.A. for terms the student wasn't enrolled in (late enrollee pre-join
// / post-withdrawal) on both attendance and grades.
const coverage = ayEnrolments.map((e) => ({
  start: e.enrollment_date,
  end: e.withdrawal_date,
}));
const enrolledByTermNumber = new Map<number, boolean>();
for (const t of termList) {
  enrolledByTermNumber.set(
    t.term_number,
    isEnrolledForTerm(coverage, t.start_date, t.end_date)
  );
}
```

Add the import at the top of the file (with the other `@/lib/report-card` / local imports). Import only `isEnrolledForTerm` here — Task 4 expands this import to add `termEnrolment` when it's first used:

```ts
import { isEnrolledForTerm } from '@/lib/report-card/enrolment-coverage';
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/report-card/build-report-card.ts
git commit -m "feat(report-card): thread enrolment + term dates, derive per-term coverage"
```

---

### Task 3: Grade side — N.A. for not-enrolled terms

**Files:**

- Modify: `lib/report-card/build-report-card.ts` (subject `byTerm` assembly ~305-338)

- [ ] **Step 1: Override not-enrolled term cells to the N.A. cell**

Inside `subjects.map((sub) => { ... })`, **after** the `for (const t of termList) { ... }` loop that fills `byTerm` (immediately before the `const annual_letter_derived = ...` line, ~338), add:

```ts
// Terms the student wasn't enrolled for → N.A., so computeAnnualGrade (and
// the non-exam annual) exclude them and renormalize the remaining weights to
// 100% instead of treating a missing term as incomplete. quarterly forced
// null guards the rare stray-grade-on-a-non-enrolled-term case.
for (const t of termList) {
  if (enrolledByTermNumber.get(t.term_number) === false) {
    byTerm[t.term_number] = { quarterly: null, letter: null, is_na: true };
  }
}
```

This needs no other change: the display already renders `'N.A.'` for `cell.is_na` (`report-card-document.tsx:405`), `computeAnnualGrade` already excludes `null + is_na` terms and renormalizes, and `deriveAnnualLetterForNonExam` already treats `isNa` terms as N.A.

- [ ] **Step 2: Add a composition test (helper → naFlags → computeAnnualGrade), proving proration end-to-end without a DB**

Append to `__tests__/report-card/enrolment-coverage.test.ts`:

```ts
import { computeAnnualGrade } from '@/lib/compute/annual';

describe('coverage drives annual-grade proration', () => {
  const TERMS = [
    { term_number: 1, start_date: '2026-01-05', end_date: '2026-03-13' },
    { term_number: 2, start_date: '2026-03-30', end_date: '2026-05-29' },
    { term_number: 3, start_date: '2026-06-29', end_date: '2026-09-04' },
    { term_number: 4, start_date: '2026-09-21', end_date: '2026-11-27' },
  ];
  // Quarterly grades as if entered for every term.
  const Q = { 1: 80, 2: 80, 3: 85, 4: 90 } as Record<number, number>;

  function annualFor(cov: EnrolmentInterval[]): number | null {
    const na = TERMS.map(
      (t) => !isEnrolledForTerm(cov, t.start_date, t.end_date)
    ) as [boolean, boolean, boolean, boolean];
    const q = TERMS.map((t, i) => (na[i] ? null : Q[t.term_number]));
    return computeAnnualGrade(q[0], q[1], q[2], q[3], na);
  }

  it('late enrollee (joins T3) → annual over T3+T4 renormalized', () => {
    // 85*.2 + 90*.4 = 17 + 36 = 53; weightSum 0.6; 53/0.6 = 88.33
    expect(annualFor([{ start: '2026-06-29', end: null }])).toBe(88.33);
  });

  it('withdrawal after T2 → annual over T1+T2 renormalized', () => {
    // 80*.2 + 80*.2 = 32; weightSum 0.4; 32/0.4 = 80
    expect(annualFor([{ start: null, end: '2026-05-29' }])).toBe(80);
  });

  it('full year → standard weighted annual', () => {
    // 80*.2+80*.2+85*.2+90*.4 = 16+16+17+36 = 85
    expect(annualFor([{ start: null, end: null }])).toBe(85);
  });
});
```

- [ ] **Step 3: Run the test + type-check**

Run: `npx vitest run __tests__/report-card/enrolment-coverage.test.ts`
Expected: PASS (all, including the 3 new cases).
Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/report-card/build-report-card.ts __tests__/report-card/enrolment-coverage.test.ts
git commit -m "feat(report-card): grade cells + annual/GA prorate over enrolled terms"
```

---

### Task 4: Attendance side — clamp denominator, omit not-enrolled terms

**Files:**

- Modify: `lib/report-card/build-report-card.ts` (calendar fetch ~431-438; attendance assembly ~462-478)

- [ ] **Step 1: Store the calendar dates per term (not just the count)**

Replace the `calendarSchoolDaysByTerm` block (around line 432-438) with a dates map:

```ts
const levelType = levelTypeForAudienceLookup(level.code);
const calendarDatesByTerm = new Map<string, string[]>();
await Promise.all(
  termList.map(async (t) => {
    const dates = await getEncodableDatesForTerm(t.id, levelType);
    calendarDatesByTerm.set(t.id, dates);
  })
);
```

(The `recordedSchoolDaysByTerm` fallback block immediately below stays unchanged.)

- [ ] **Step 2: Rebuild the `attendance` array using coverage — clamp denominator, omit not-enrolled terms**

Replace the `const attendance: AttendanceRecord[] = termList.map((t) => { ... });` block (around line 462-478) with:

```ts
const attendance: AttendanceRecord[] = [];
for (const t of termList) {
  const { enrolled, enrolledSchoolDays } = termEnrolment(
    coverage,
    t,
    calendarDatesByTerm.get(t.id) ?? []
  );
  // Not enrolled this term → omit the record. The document renders N.A. for a
  // missing term record, and computeAttendancePercentage then sums only
  // enrolled terms (do NOT push a null-school_days record — that nulls the
  // whole cumulative %).
  if (!enrolled) continue;
  const studentDays = studentDaysByTerm.get(t.id) ?? {
    days_present: null,
    days_late: null,
  };
  // Clamped calendar count; fall back to the recorded (already prorated)
  // rollup count only when the calendar is unconfigured for the term.
  const schoolDays =
    enrolledSchoolDays > 0
      ? enrolledSchoolDays
      : (recordedSchoolDaysByTerm.get(t.id) ?? null);
  attendance.push({
    term_id: t.id,
    school_days: schoolDays,
    days_present: studentDays.days_present,
    days_late: studentDays.days_late,
  });
}
```

Expand the existing import from `@/lib/report-card/enrolment-coverage` (added in Task 2) to include `termEnrolment`:

```ts
import {
  isEnrolledForTerm,
  termEnrolment,
} from '@/lib/report-card/enrolment-coverage';
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors (no remaining references to `calendarSchoolDaysByTerm`).

- [ ] **Step 4: Run the full report-card-adjacent suites**

Run: `npx vitest run __tests__/report-card __tests__/markbook`
Expected: PASS. (`lib/compute/annual.ts` self-test runs on import; the new helper suite passes.)

- [ ] **Step 5: Commit**

```bash
git add lib/report-card/build-report-card.ts
git commit -m "feat(report-card): attendance N.A. + prorated denominator for non-enrolled terms"
```

---

### Task 5: Full build + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Clean type-check + full unit run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc exit 0; all suites pass.

- [ ] **Step 2: Production build**

Run: `npx next build`
Expected: clean compile (no type/route errors).

- [ ] **Step 3: Manual happy-path (per workflow.md)**

With a seeded test AY (or the real late enrollee E990114, late T3):

1. Open the student's report card (interim T1–T3 and final T4).
2. **Attendance:** pre-join terms (T1, T2) show **N.A.** across School Days / Present / Late; the join term (T3) shows present over the **clamped** denominator (days from `enrollment_date`); cumulative % excludes the N.A. terms.
3. **Grades:** pre-join term cells show **N.A.**; the annual per examinable subject = the enrolled terms renormalized (T3·0.2 + T4·0.4 → /0.6); General Average present (not blank/incomplete).
4. Spot-check a **normal** active student (no `enrollment_date`) is unchanged — full terms, no N.A.
5. Spot-check a **withdrawn-mid-year** student — terms after `withdrawal_date` show N.A.; annual prorates over completed terms.

- [ ] **Step 4: Update the spec status + finish the branch**

Mark the spec `Status:` line as implemented, then use `superpowers:finishing-a-development-branch` to decide merge/PR.

```bash
git add docs/superpowers/specs/2026-06-15-report-card-na-non-enrolled-terms-design.md
git commit -m "docs(report-card): mark non-enrolled-term N.A. spec implemented"
```

---

## Notes for the implementer

- **Do not touch** `report-card-document.tsx` — N.A. rendering already exists for a missing attendance record (`val ?? 'N.A.'`, line 254) and for an `is_na` grade cell (line 405).
- **Do not change** `computeAnnualGrade` / `computeGeneralAverage` / `computeAttendancePercentage` signatures — only what `build-report-card.ts` feeds them.
- The working tree contains a large unrelated in-progress TanStack Query migration; stage **only** the files named per task.
