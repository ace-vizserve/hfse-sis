# Late-Enrollee Detection & Joining-Term Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make late-enrollee detection objective and term-aware — fire for T1 and during breaks, suggest a joining term (current vs next), and let the registrar confirm — reusing the existing `enrollment_status` + `late_enrollee_term_number` columns (no migration).

**Architecture:** A pure `resolveEnrolmentPosition(terms, today)` helper computes activeTerm / nextTerm / isLateEnrollee / canDeferToNext / daysLeft. A server wrapper `getEnrolmentPosition(ayCode)` feeds the `today-term` API and the re-enrolment path. The section-students PATCH derives `enrollment_date` from the chosen term (today for "join current", the term's start for "start next"). The enrolment edit sheets render a position-aware Join/Start-next decision with a near-end warning.

**Tech Stack:** Next.js 16 RSC + client components, TypeScript, zod, vitest, shadcn primitives.

---

## Reference: existing shapes

```ts
// lib/sis/terms.ts (existing)
type TermWindow = { termNumber: number; startDate: string; endDate: string };
export function loadTermsForAY(ayCode: string): Promise<TermWindow[]>;     // cached, service-role
export async function getTermForDate(date, ayCode): Promise<TermInfo|null>; // keep as-is
export async function detectMidTermEnrolment(ayCode): Promise<TermInfo|null>; // REPLACED by this plan

// section_students columns (existing): enrollment_status ('active'|'late_enrollee'|'withdrawn'),
//   late_enrollee_term_number (smallint 1-4 null), enrollment_date (date null)
// lib/schemas/enrolment.ts EnrolmentMetadataSchema already accepts late_enrollee_term_number.

// GET /api/sis/today-term?ay= currently returns { midTerm: TermInfo|null } via detectMidTermEnrolment.
// PATCH /api/sections/[id]/students/[enrolmentId] stamps enrollment_date = today on the
//   active -> late_enrollee boundary and persists late_enrollee_term_number.
```

---

## Task 1: Pure position resolver + tests

**Files:**
- Create: `lib/sis/enrolment-position.ts`
- Test: `__tests__/sis/enrolment-position.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/sis/enrolment-position.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  resolveEnrolmentPosition,
  type TermWindow,
} from '@/lib/sis/enrolment-position';

// AY9999-shaped windows.
const TERMS: TermWindow[] = [
  { termNumber: 1, startDate: '2026-01-08', endDate: '2026-03-13' },
  { termNumber: 2, startDate: '2026-03-24', endDate: '2026-05-29' },
  { termNumber: 3, startDate: '2026-06-29', endDate: '2026-09-06' },
  { termNumber: 4, startDate: '2026-09-14', endDate: '2026-11-21' },
];

describe('resolveEnrolmentPosition', () => {
  it('mid-T1: late, can defer to T2', () => {
    const p = resolveEnrolmentPosition(TERMS, '2026-01-15');
    expect(p.activeTerm?.termNumber).toBe(1);
    expect(p.nextTerm?.termNumber).toBe(2);
    expect(p.joiningTerm?.termNumber).toBe(1);
    expect(p.isLateEnrollee).toBe(true);
    expect(p.canDeferToNext).toBe(true);
  });

  it('mid-T3: late, defer to T4', () => {
    const p = resolveEnrolmentPosition(TERMS, '2026-07-10');
    expect(p.activeTerm?.termNumber).toBe(3);
    expect(p.nextTerm?.termNumber).toBe(4);
    expect(p.isLateEnrollee).toBe(true);
    expect(p.canDeferToNext).toBe(true);
  });

  it('mid-T4: late, no next term to defer to', () => {
    const p = resolveEnrolmentPosition(TERMS, '2026-10-01');
    expect(p.activeTerm?.termNumber).toBe(4);
    expect(p.nextTerm).toBeNull();
    expect(p.isLateEnrollee).toBe(true);
    expect(p.canDeferToNext).toBe(false);
  });

  it('break before T3: not late, joining T3 on time', () => {
    const p = resolveEnrolmentPosition(TERMS, '2026-06-01');
    expect(p.activeTerm).toBeNull();
    expect(p.nextTerm?.termNumber).toBe(3);
    expect(p.joiningTerm?.termNumber).toBe(3);
    expect(p.isLateEnrollee).toBe(false);
    expect(p.daysLeftInActiveTerm).toBeNull();
  });

  it('before T1: not late, joining T1', () => {
    const p = resolveEnrolmentPosition(TERMS, '2025-12-20');
    expect(p.activeTerm).toBeNull();
    expect(p.nextTerm?.termNumber).toBe(1);
    expect(p.isLateEnrollee).toBe(false);
  });

  it('after T4: out of scope (no joining term)', () => {
    const p = resolveEnrolmentPosition(TERMS, '2026-12-01');
    expect(p.activeTerm).toBeNull();
    expect(p.nextTerm).toBeNull();
    expect(p.joiningTerm).toBeNull();
    expect(p.isLateEnrollee).toBe(false);
  });

  it('computes days left in the active term', () => {
    const p = resolveEnrolmentPosition(TERMS, '2026-09-06'); // T3 last day
    expect(p.activeTerm?.termNumber).toBe(3);
    expect(p.daysLeftInActiveTerm).toBe(0);
    const q = resolveEnrolmentPosition(TERMS, '2026-08-30'); // 7 days before T3 end
    expect(q.daysLeftInActiveTerm).toBe(7);
  });

  it('returns all-null for an empty term list', () => {
    const p = resolveEnrolmentPosition([], '2026-06-01');
    expect(p.activeTerm).toBeNull();
    expect(p.nextTerm).toBeNull();
    expect(p.isLateEnrollee).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/sis/enrolment-position.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sis/enrolment-position'`.

- [ ] **Step 3: Write the implementation**

Create `lib/sis/enrolment-position.ts`:

```ts
// Pure enrolment-position resolver. Given the AY's term windows and a date,
// determines whether enrolling on that date makes a late enrollee and which
// term they join. "Late" iff a term was in session on the date (activeTerm).
// See docs/superpowers/specs/2026-06-01-late-enrollee-detection-design.md.

export type TermWindow = {
  termNumber: number;
  startDate: string; // yyyy-MM-dd
  endDate: string; // yyyy-MM-dd
};

export type EnrolmentPosition = {
  activeTerm: TermWindow | null; // term containing `today`
  nextTerm: TermWindow | null; // earliest term starting after `today`
  joiningTerm: TermWindow | null; // activeTerm ?? nextTerm
  isLateEnrollee: boolean; // activeTerm != null
  canDeferToNext: boolean; // activeTerm != null && nextTerm != null
  daysLeftInActiveTerm: number | null; // whole days from today to activeTerm.endDate
};

function daysBetween(fromIso: string, toIso: string): number {
  const u = (iso: string) =>
    Date.UTC(
      Number(iso.slice(0, 4)),
      Number(iso.slice(5, 7)) - 1,
      Number(iso.slice(8, 10))
    );
  return Math.round((u(toIso) - u(fromIso)) / 86_400_000);
}

export function resolveEnrolmentPosition(
  terms: TermWindow[],
  today: string
): EnrolmentPosition {
  const activeTerm =
    terms.find((t) => t.startDate <= today && today <= t.endDate) ?? null;
  const nextTerm =
    [...terms]
      .filter((t) => t.startDate > today)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null;
  const joiningTerm = activeTerm ?? nextTerm;
  return {
    activeTerm,
    nextTerm,
    joiningTerm,
    isLateEnrollee: activeTerm !== null,
    canDeferToNext: activeTerm !== null && nextTerm !== null,
    daysLeftInActiveTerm: activeTerm
      ? daysBetween(today, activeTerm.endDate)
      : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/sis/enrolment-position.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/sis/enrolment-position.ts __tests__/sis/enrolment-position.test.ts
git commit -m "feat(sis): pure enrolment-position resolver (late-enrollee detection)"
```
(End the commit body with `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.)

---

## Task 2: Server resolver + today-term API + re-enrolment path

**Files:**
- Modify: `lib/sis/terms.ts`
- Modify: `app/api/sis/today-term/route.ts`
- Modify: `app/api/sections/[id]/students/[enrolmentId]/route.ts`

- [ ] **Step 1: Add `getEnrolmentPosition` to `lib/sis/terms.ts`**

After the `detectMidTermEnrolment` function, add (and import the resolver at the top of the file):

```ts
// at top with the other imports:
import {
  resolveEnrolmentPosition,
  type EnrolmentPosition,
} from '@/lib/sis/enrolment-position';

// new export (place near detectMidTermEnrolment):
// Loads the AY's term windows and resolves the enrolment position for today
// (UTC date — matches the enrollment_date stamp in the section-students PATCH).
export async function getEnrolmentPosition(
  ayCode: string
): Promise<EnrolmentPosition> {
  const terms = await loadTermsForAY(ayCode);
  const today = new Date().toISOString().slice(0, 10);
  return resolveEnrolmentPosition(
    terms.map((t) => ({
      termNumber: t.termNumber,
      startDate: t.startDate,
      endDate: t.endDate,
    })),
    today
  );
}
```

- [ ] **Step 2: Update `GET /api/sis/today-term` to return the position**

Replace the body of `app/api/sis/today-term/route.ts`'s GET with:

```ts
import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { getEnrolmentPosition } from '@/lib/sis/terms';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireRole([
    'registrar',
    'school_admin',
    'superadmin',
    'admissions',
    'teacher',
  ]);
  if (auth instanceof NextResponse) return auth;

  const ayCode = req.nextUrl.searchParams.get('ay');
  if (!ayCode)
    return NextResponse.json({ error: 'ay required' }, { status: 400 });

  const position = await getEnrolmentPosition(ayCode);
  return NextResponse.json({ position });
}
```

- [ ] **Step 3: Update the re-enrolment mid-term detection in the section-students PATCH**

In `app/api/sections/[id]/students/[enrolmentId]/route.ts`, change the import:

```ts
// was: import { detectMidTermEnrolment, getTermForDate } from '@/lib/sis/terms';
import { getEnrolmentPosition, getTermForDate, loadTermsForAY } from '@/lib/sis/terms';
```

Find the re-enrolment detection block (the `if (isReEnrolment && !lateEnrolleeTransition && ayCodeForInvalidate)` block that calls `detectMidTermEnrolment`) and replace it with:

```ts
  let midTermEnrolment: {
    termNumber: number;
    termLabel: string;
    sectionId: string;
    sectionStudentId: string;
  } | null = null;
  if (isReEnrolment && !lateEnrolleeTransition && ayCodeForInvalidate) {
    const pos = await getEnrolmentPosition(ayCodeForInvalidate);
    if (pos.isLateEnrollee && pos.activeTerm) {
      midTermEnrolment = {
        termNumber: pos.activeTerm.termNumber,
        termLabel: `T${pos.activeTerm.termNumber}`,
        sectionId,
        sectionStudentId: enrolmentId,
      };
    }
  }
```

- [ ] **Step 4: Remove the now-unused `detectMidTermEnrolment`**

Run: `git grep -n "detectMidTermEnrolment"`
Expected: only its definition in `lib/sis/terms.ts` remains. Delete the `detectMidTermEnrolment` function definition. (If any other caller appears, leave it and note it instead.)

- [ ] **Step 5: Build**

Run: `npx next build`
Expected: clean compile, 0 TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add lib/sis/terms.ts "app/api/sis/today-term/route.ts" "app/api/sections/[id]/students/[enrolmentId]/route.ts"
git commit -m "feat(sis): getEnrolmentPosition wraps the resolver; today-term + re-enrolment use it"
```

---

## Task 3: PATCH derives enrollment_date from the chosen term

**Files:**
- Modify: `app/api/sections/[id]/students/[enrolmentId]/route.ts`

**Why:** "Join current" stamps `enrollment_date = today`; "Start next" stamps the chosen term's start date so attendance proration excludes the skipped active term.

- [ ] **Step 1: Resolve the section's AY before building the patch**

In the PATCH handler, immediately after the `before` row is loaded and validated (after the `if (before.section_id !== sectionId)` guard), add an AY lookup so the late branch can resolve term dates:

```ts
  // Section AY (used by the late-enrollee enrollment_date derivation + audit).
  const { data: secAyRow } = await service
    .from('sections')
    .select('academic_year:academic_years!inner(ay_code)')
    .eq('id', sectionId)
    .maybeSingle();
  const secAy = (
    secAyRow as {
      academic_year: { ay_code: string } | { ay_code: string }[];
    } | null
  )?.academic_year;
  const sectionAyCode =
    (Array.isArray(secAy) ? secAy[0]?.ay_code : secAy?.ay_code) ?? null;
```

- [ ] **Step 2: Replace the late-boundary enrollment_date stamp**

Find the late-enrollee boundary block:

```ts
    if (parsed.data.enrollment_status === 'late_enrollee') {
      if (before.enrollment_status !== 'late_enrollee') {
        patch.enrollment_date = new Date().toISOString().slice(0, 10);
        lateEnrolleeTransition = true;
      }
      // Always persist an explicit term override if provided (null clears it).
      if (parsed.data.late_enrollee_term_number !== undefined) {
        patch.late_enrollee_term_number =
          parsed.data.late_enrollee_term_number ?? null;
      }
    }
```

Replace with:

```ts
    if (parsed.data.enrollment_status === 'late_enrollee') {
      if (parsed.data.late_enrollee_term_number !== undefined) {
        patch.late_enrollee_term_number =
          parsed.data.late_enrollee_term_number ?? null;
      }
      if (before.enrollment_status !== 'late_enrollee') {
        // Derive the joining date from the chosen term: today when the chosen
        // term contains today ("join current"), else that term's start date
        // ("start next term" — they begin fresh, attendance prorates from there).
        const today = new Date().toISOString().slice(0, 10);
        let stampDate = today;
        const chosenTermN = parsed.data.late_enrollee_term_number ?? null;
        if (chosenTermN != null && sectionAyCode) {
          const terms = await loadTermsForAY(sectionAyCode);
          const chosen = terms.find((t) => t.termNumber === chosenTermN);
          if (chosen && chosen.startDate > today) stampDate = chosen.startDate;
        }
        patch.enrollment_date = stampDate;
        lateEnrolleeTransition = true;
      }
    }
```

- [ ] **Step 3: Build**

Run: `npx next build`
Expected: clean compile. (`loadTermsForAY` is already imported from Task 2.)

- [ ] **Step 4: Commit**

```bash
git add "app/api/sections/[id]/students/[enrolmentId]/route.ts"
git commit -m "feat(sis): derive late-enrollee enrollment_date from chosen joining term"
```

---

## Task 4: Position-aware decision in the SIS enrolment edit sheet

**Files:**
- Modify: `components/sis/enrolment-edit-sheet.tsx`

**Context:** The sheet already lets the registrar change `enrollment_status` to `late_enrollee` and has a "Joining term" correction block (shown only when the student is *already* late). Extend it so that when the registrar selects `late_enrollee` in this edit, the sheet fetches the position and presents Join-current / Start-next with the near-end warning, writing the chosen term into the existing `lateTermOverride` state (sent as `late_enrollee_term_number` on save). Verification is manual (no React harness; logic is covered by Task 1).

- [ ] **Step 1: Add state + a position fetch when `late_enrollee` is selected**

Near the other `useState` hooks in `EnrolmentEditSheet`, add:

```tsx
  type Position = {
    activeTerm: { termNumber: number } | null;
    nextTerm: { termNumber: number } | null;
    isLateEnrollee: boolean;
    canDeferToNext: boolean;
    daysLeftInActiveTerm: number | null;
  };
  const [position, setPosition] = useState<Position | null>(null);
```

Add an effect (import `useEffect`) that fetches the position the first time the registrar switches this edit to `late_enrollee` (and the student wasn't already one). `ayCode` is available on the component via the `initial`/props — if not already passed, add an `ayCode: string` prop and thread it from the caller (the section roster row already knows the AY):

```tsx
  useEffect(() => {
    if (
      status === 'late_enrollee' &&
      initial.enrollment_status !== 'late_enrollee' &&
      position === null
    ) {
      fetch(`/api/sis/today-term?ay=${encodeURIComponent(ayCode)}`)
        .then((r) => r.json())
        .then((d) => setPosition(d.position ?? null))
        .catch(() => setPosition(null));
    }
  }, [status, initial.enrollment_status, position, ayCode]);
```

- [ ] **Step 2: Render the decision when newly tagging late**

Directly above the existing `{initial.enrollment_status === 'late_enrollee' && ( ... Joining term ... )}` block, add a sibling block for the *new-tag* case:

```tsx
              {status === 'late_enrollee' &&
                initial.enrollment_status !== 'late_enrollee' &&
                position?.activeTerm && (
                  <div className="space-y-2">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Joining term
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      Enrolled after T{position.activeTerm.termNumber} started —
                      choose how this student joins.
                    </p>
                    <div className="space-y-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setLateTermOverride(position.activeTerm!.termNumber)
                        }
                        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                          lateTermOverride === position.activeTerm.termNumber
                            ? 'border-primary bg-accent text-foreground'
                            : 'border-hairline text-foreground hover:bg-muted/50'
                        }`}
                      >
                        Join T{position.activeTerm.termNumber} now
                        {position.daysLeftInActiveTerm !== null &&
                          position.daysLeftInActiveTerm < 14 && (
                            <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-brand-amber">
                              ends in {position.daysLeftInActiveTerm}d
                            </span>
                          )}
                      </button>
                      {position.canDeferToNext && position.nextTerm && (
                        <button
                          type="button"
                          onClick={() =>
                            setLateTermOverride(position.nextTerm!.termNumber)
                          }
                          className={`flex w-full items-center rounded-lg border px-3 py-2 text-left text-sm ${
                            lateTermOverride === position.nextTerm.termNumber
                              ? 'border-primary bg-accent text-foreground'
                              : 'border-hairline text-foreground hover:bg-muted/50'
                          }`}
                        >
                          Start in T{position.nextTerm.termNumber} instead
                        </button>
                      )}
                    </div>
                  </div>
                )}
```

- [ ] **Step 3: Default the chosen term + send it on save**

When the position loads, default the selection to the active term if nothing chosen yet. Add to the effect's `.then` (after `setPosition`):

```tsx
        .then((d) => {
          const pos = d.position ?? null;
          setPosition(pos);
          if (pos?.activeTerm && lateTermOverride === null) {
            setLateTermOverride(pos.activeTerm.termNumber);
          }
        })
```

In `doSave`, ensure the chosen term is included in the PATCH body for the new-tag case (the body already sends `enrollment_status`; add the term):

```tsx
      if (
        status === 'late_enrollee' &&
        initial.enrollment_status !== 'late_enrollee' &&
        lateTermOverride !== null
      ) {
        body.late_enrollee_term_number = lateTermOverride;
      }
```

- [ ] **Step 4: Build**

Run: `npx next build`
Expected: clean compile. If `ayCode` wasn't already a prop, the caller (`components/sis/section-roster-table.tsx`) must pass it — update that usage and its props type. Report the exact edit made.

- [ ] **Step 5: Commit**

```bash
git add components/sis/enrolment-edit-sheet.tsx components/sis/section-roster-table.tsx
git commit -m "feat(sis): position-aware late-enrollee Join/Start-next decision in edit sheet"
```

---

## Task 5: Mirror the decision in the Markbook enrolment edit sheet

**Files:**
- Modify: `components/markbook/enrolment-edit-sheet.tsx` (+ its caller if it needs `ayCode`)

- [ ] **Step 1: Apply the same changes as Task 4 to the Markbook variant**

Repeat Task 4 Steps 1–3 verbatim in `components/markbook/enrolment-edit-sheet.tsx` (same state, effect, decision JSX, and `doSave` term inclusion). If the Markbook sheet's prop names differ, adapt the `ayCode`/`status`/`lateTermOverride`/`initial.enrollment_status` references to its local equivalents (read the file first to confirm the names).

- [ ] **Step 2: Build**

Run: `npx next build`
Expected: clean compile. Thread `ayCode` from the Markbook caller (`app/(markbook)/markbook/sections/[id]/roster-table.tsx`) if needed; report the edit.

- [ ] **Step 3: Commit**

```bash
git add components/markbook/enrolment-edit-sheet.tsx "app/(markbook)/markbook/sections/[id]/roster-table.tsx"
git commit -m "feat(markbook): position-aware late-enrollee decision in enrolment edit sheet"
```

---

## Task 6: Full verification

- [ ] **Step 1: Unit + suite**

Run: `npx vitest run`
Expected: all green (existing + the new enrolment-position tests).

- [ ] **Step 2: Build**

Run: `npx next build`
Expected: clean compile, page count unchanged.

- [ ] **Step 3: Manual happy paths** (AY9999; adjust a term's dates so "today" sits where needed)

  1. **Mid-term:** today inside T3 → edit a student to Late enrollee → sheet shows "Join T3 now" + "Start in T4 instead"; default selected = T3. Save with T3 → `enrollment_status='late_enrollee'`, `late_enrollee_term_number=3`, `enrollment_date=today`. Save with T4 → still `late_enrollee`, `late_enrollee_term_number=4`, `enrollment_date=T4 start`.
  2. **Mid-T4:** only "Join T4 now" shown (no defer). Near-end warning appears when <14 days remain.
  3. **Break:** today between T2 and T3 → no Join/Start decision appears (position.activeTerm is null); the student stays a normal active enrolment.
  4. **Re-enrolment:** re-enrol a withdrawn student while today is mid-term → the re-enrolment response surfaces the mid-term prompt.

- [ ] **Step 4: Commit any verification fixups**

```bash
git add -A
git commit -m "test(sis): verify late-enrollee detection end-to-end"
```

---

## Self-review notes (coverage vs spec)

- **Term position + late determination** → Task 1 (`resolveEnrolmentPosition`).
- **T1 included / breaks fire correctly / T4 no-defer / after-T4 out of scope** → Task 1 tests + Task 4 gating on `position.activeTerm` / `canDeferToNext`.
- **Suggestion is non-blocking, registrar confirms** → Task 4/5 (selecting Late enrollee + choosing a term; not selecting it = on-time).
- **Storage reuses existing columns, no migration** → Tasks 3–5 write `enrollment_status` + `late_enrollee_term_number` + derived `enrollment_date`.
- **"Start next" stamps next term's start; "Join current" stamps today** → Task 3.
- **Break needs no special handling** → no code path; the student is a normal `active` enrolment (Task 1 returns `isLateEnrollee=false`).
- **Near-end warning (~14 days, UI-only)** → Task 4/5 render gate on `daysLeftInActiveTerm < 14`.
- **today-term API + re-enrolment path use the resolver; detectMidTermEnrolment removed** → Task 2.
