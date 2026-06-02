# Late-Enrollee Detection & Joining-Term Flow

**Date:** 2026-06-01
**Module:** Records / SIS (enrolment lifecycle)
**Status:** Design — pending implementation plan

## Context

Late-enrollee tagging today is gated by `detectMidTermEnrolment` (`lib/sis/terms.ts`), which
only suggests "late enrollee?" when **today falls inside T2/T3/T4**. Two problems:

1. **T1 is excluded** ("on-time by definition") — but a student joining mid-T1 (after T1
   started) is objectively late.
2. **Break dates return null** — `getTermForDate` returns null when today isn't inside any
   term window, so the prompt silently doesn't fire when enrolling between terms (the "current
   date isn't a school day" case).

This redesign makes late-enrollee an **objective fact the system surfaces and the registrar
confirms**, working for every term and during breaks — no T1 special case, no grace period,
no attendance-based inference.

**Guiding principle (registrar-controlled):** the system states the objective fact and
suggests; the registrar decides. "Late enrollee" is an academic interpretation, not a
system-determined truth.

## The model

### Term position (computed from today)

- **activeTerm** = the term whose window contains today (`start ≤ today ≤ end`), or none.
- **nextTerm** = the earliest term whose `start > today`, or none.
- **joiningTerm** = `activeTerm ?? nextTerm`.

### Late determination — _was a term in session on the enrollment day?_

- **activeTerm exists** → the student enrolled mid-term → **late enrollee**. The joining-term
  choice (below) does **not** change this; both choices are late.
- **No activeTerm** (break, before T1, after T4) → **not** a late enrollee. They start the
  next term from its natural beginning (on time), or it's out of scope (after T4).

### Prompt & options (non-blocking)

Shown when `activeTerm` exists (and the student is being enrolled / re-enrolled / status-edited):

> Enrolled after {activeTerm} started — this is a late enrollee. Which term will they begin?
> ● Join {activeTerm} now
> ○ Start in {nextTerm} instead
> [Confirm] [Not late]

- **● Join {activeTerm} now** → attends the rest of the current term (prorated).
- **○ Start in {nextTerm} instead** → defers; still a late enrollee, joining nextTerm.
  Only shown when `nextTerm` exists.
- **[Not late]** → registrar override: leave `active` (no late flag). Registrar's call.
- **Near-end warning:** when `activeTerm` has fewer than ~14 days remaining, the "Join now"
  option shows _"{activeTerm} ends in N days — only a few attendance days will count."_
  UI-only; does not change classification. Threshold is a sensible default, configurable later.

### Edge cases by position

| Today's position                              | Behavior                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| Inside active term, next term exists          | Late. Choose Join-current or Start-next (or Not-late).                           |
| Inside active term, **no** next term (**T4**) | Late. **Join-current only** (no defer) or Not-late. Near-end warning likely.     |
| Break / before a term starts                  | **No late prompt.** Normal enrolment; they start nextTerm on time (`active`).    |
| After T4 ends                                 | **No prompt — out of scope.** Next-academic-year intake, handled in the next AY. |

## Storage — reuse existing columns (NO migration)

The two facts already exist on `section_students`:

- **Late-enrollee flag** = `enrollment_status = 'late_enrollee'` (enum: `active | late_enrollee
| withdrawn`). The registrar's confirm/decline toggles this.
- **Joining term** = `late_enrollee_term_number` (smallint 1–4, migration 067 / KD #111).

| Scenario                     | `enrollment_status` | `late_enrollee_term_number` | `enrollment_date`                                               |
| ---------------------------- | ------------------- | --------------------------- | --------------------------------------------------------------- |
| Active → Join current        | `late_enrollee`     | activeTerm.n                | today                                                           |
| Active → Start next          | `late_enrollee`     | nextTerm.n                  | nextTerm.startDate                                              |
| Active → Not late (override) | `active`            | null                        | unchanged                                                       |
| Break / before term          | `active`            | null                        | null (empty earlier terms arise naturally — no attendance rows) |

No new `joining_term_number` column — it's derivable, and the override column already records
it for the late case. Keeping the existing name (`late_enrollee_term_number`) avoids churn
across migrations + surfaces; rename is out of scope.

> Why the break case needs no special handling: an `active` student with no attendance rows in
> earlier terms naturally rolls up to 0/0 there (no entries), so they read as "started in
> nextTerm" without setting `enrollment_date`. KD #113 proration only matters for the defer
> case, where `enrollment_date = nextTerm.start` excludes the active term they skipped.

## Architecture & files

### New pure helper — `lib/sis/enrolment-position.ts` (testable, no I/O)

```ts
export type TermWindow = {
  termNumber: number;
  startDate: string;
  endDate: string;
};
export type EnrolmentPosition = {
  activeTerm: TermWindow | null;
  nextTerm: TermWindow | null;
  joiningTerm: TermWindow | null;
  isLateEnrollee: boolean; // activeTerm != null
  canDeferToNext: boolean; // activeTerm != null && nextTerm != null
  daysLeftInActiveTerm: number | null; // for the near-end warning
};
export function resolveEnrolmentPosition(
  terms: TermWindow[],
  today: string
): EnrolmentPosition;
```

Tests: `__tests__/sis/enrolment-position.test.ts` — mid-T1; mid-T3 with next; mid-T4 (no
next); break before T3; before T1; after T4; near-end day-count.

### Server

- **`lib/sis/terms.ts`** — replace `detectMidTermEnrolment` with a richer resolver that loads
  the AY's terms and returns `resolveEnrolmentPosition(terms, today)` (keep `getTermForDate`
  as-is for other callers). Late-enrollee callers move to the new resolver.
- **`GET /api/sis/today-term`** — return the full `EnrolmentPosition` payload (activeTerm,
  nextTerm, isLateEnrollee, canDeferToNext, daysLeftInActiveTerm) instead of `{ midTerm }`.
- **`PATCH /api/sections/[id]/students/[enrolmentId]`** — on the `→ late_enrollee` boundary,
  derive `enrollment_date` from the chosen `late_enrollee_term_number`: today when the chosen
  term contains today (Join current), else that term's `start_date` (Start next). Audit
  context records the joining term + whether deferred. (Existing boundary-stamp logic extends;
  the schema already accepts `late_enrollee_term_number`.)

### UI

- **`components/sis/enrolment-edit-sheet.tsx`** (+ **`components/markbook/enrolment-edit-sheet.tsx`**)
  — replace the single "mark as late enrollee" affordance with the position-aware prompt:
  the Join/Start-next radio (gated by `canDeferToNext`), the near-end warning, and a Not-late
  dismiss. Submits the chosen `enrollment_status` + `late_enrollee_term_number`.
- The re-enrolment path (PATCH already returns a mid-term payload) surfaces the same prompt.

## Out of scope

- Cross-AY "start next academic year" enrolment (after-T4 case) — handled by the next AY's intake.
- Renaming `late_enrollee_term_number` → `joining_term_number`.
- Configurable near-end threshold (hardcode a sensible default for v1).
- Surfacing the prompt in every add-student entry point — wire the edit sheet + re-enrolment
  first; other entry points can adopt the same component later.

## Testing / verification

1. `npx vitest run __tests__/sis/enrolment-position.test.ts` — resolver unit tests pass.
2. `npx vitest run` — full suite green.
3. `npx next build` — clean compile.
4. Manual (AY9999): set a term's dates so today is mid-term, enrol/edit a student → prompt
   offers Join-current + Start-next; choosing Start-next stamps the next term + its start date;
   both land `late_enrollee`. With today in the T2→T3 break → no late prompt. With today mid-T4
   → Join-only, no defer. Confirm the joining-term badge + attendance proration match.
