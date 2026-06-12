# Convert Late Enrollee → Normal Enrollee — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a registrar convert a **T1** late enrollee back to a normal (`active`) enrollee through a confirmed, reasoned, audit-tracked action — while never touching `enrollment_date` (the immutable source of truth); T2–T4 late enrollees cannot be converted.

**Architecture:** A soft-confirm in the two enrolment edit sheets (T1 late enrollee → confirm dialog with a required reason; T2–T4 → "Active" disabled). The section-students PATCH route gates the `late_enrollee → active` transition to T1 + a required reason, clears `late_enrollee_term_number`, leaves `enrollment_date` + the attendance rollup untouched, and records a distinct `lateEnrolleeReverted` flag + reason on the existing `enrolment.metadata.update` audit row. The audit humanizer renders a clear line.

**Tech Stack:** Next.js 16 (App Router), Supabase, zod, shadcn (`Select` / `AlertDialog` / `Textarea`), vitest.

**Spec:** `docs/superpowers/specs/2026-06-12-late-enrollee-convert-to-normal-design.md`

---

## File structure

- `lib/schemas/enrolment.ts` — add the optional `lateRevertReason` field to `EnrolmentMetadataSchema`.
- `app/api/sections/[id]/students/[enrolmentId]/route.ts` — the convert gate (T1-only + reason-required + clear term + audit flags).
- `lib/audit/humanize.ts` — render the revert line in the `enrolment.metadata.update` summary.
- `__tests__/audit/humanize.test.ts` — unit test for the revert line.
- `components/sis/enrolment-edit-sheet.tsx` — disable "Active" for T2–T4 late enrollees + the convert confirm dialog + reason + send `lateRevertReason`.
- `components/markbook/enrolment-edit-sheet.tsx` — the same four edits (twin component).

No migration. No new audit-action enum value (reuses `enrolment.metadata.update`).

---

## Task 1: Schema — add `lateRevertReason`

**Files:**

- Modify: `lib/schemas/enrolment.ts`

The reason is **audit-only** and its _required-ness_ depends on the row's current status (`before`), which the schema doesn't see — so the schema only declares the optional field; the route enforces "required on the convert boundary" (Task 2).

- [ ] **Step 1: Add the field to `EnrolmentMetadataSchema`**

In `lib/schemas/enrolment.ts`, inside the `z.object({ ... })` (after the `late_enrollee_term_number` field, before the closing `})` that precedes `.superRefine`), add:

```ts
    // Audit-only reason captured when a late enrollee is converted back to a
    // normal (active) enrollee. Required-ness is enforced in the route (it
    // depends on the row's current status). optionalText: '' → null.
    lateRevertReason: optionalText(WITHDRAWAL_REASON_MAX).optional(),
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (the field flows into `EnrolmentMetadataInput`).

- [ ] **Step 3: Commit**

```bash
git add lib/schemas/enrolment.ts
git commit -m "feat(enrolment): add optional lateRevertReason to the metadata schema"
```

---

## Task 2: Server — convert gate (T1-only, reason-required, clear term, audit)

**Files:**

- Modify: `app/api/sections/[id]/students/[enrolmentId]/route.ts`

Behavior on `before.enrollment_status === 'late_enrollee' && incoming enrollment_status === 'active'`:

1. resolve joining term (`before.late_enrollee_term_number` ?? derive from `before.enrollment_date`); if not T1 → **422 `late_revert_not_t1`**.
2. require `lateRevertReason`; missing/blank → **422 `reason_required`**.
3. clear `late_enrollee_term_number = null`; **never** set `enrollment_date` (so no recompute — the guard at line ~223 requires `'enrollment_date' in patch`).
4. record `lateEnrolleeReverted: true` + `revertReason` on the audit context.

- [ ] **Step 1: Declare the flags**

Find (near line 104):

```ts
let terminalCascadeSkipped = false;
```

Add immediately below:

```ts
// Set when a T1 late enrollee is converted back to a normal (active) enrollee
// — drives the audit context line. revertReason is audit-only.
let lateEnrolleeReverted = false;
let revertReason: string | null = null;
```

- [ ] **Step 2: Add the convert gate block**

Find the standalone term-correction block (it begins with this comment, ~line 162):

```ts
// Standalone late_enrollee_term_number correction: the registrar is correcting
```

Insert the following block **immediately above** that comment (i.e. right after the `if (parsed.data.enrollment_status !== undefined) { ... }` block closes):

```ts
// Convert late enrollee → normal (active). T1-only, requires a reason, clears
// the late-term tag, and NEVER touches enrollment_date (KD #117 / spec
// 2026-06-12). enrollment_date staying put means the attendance rollup is
// unchanged + no recompute fires (the guard below requires 'enrollment_date'
// in patch). For T2–T4 the UI disables this; this is the server backstop.
if (
  before.enrollment_status === 'late_enrollee' &&
  parsed.data.enrollment_status === 'active'
) {
  let lateTermNumber =
    (before.late_enrollee_term_number as number | null) ?? null;
  if (lateTermNumber == null && before.enrollment_date && sectionAyCode) {
    const derived = await getTermForDate(
      before.enrollment_date as string,
      sectionAyCode,
      service
    );
    lateTermNumber = derived?.termNumber ?? null;
  }
  if (lateTermNumber !== 1) {
    return NextResponse.json(
      {
        error: 'Only a Term 1 late enrollee can be converted to normal.',
        code: 'late_revert_not_t1',
      },
      { status: 422 }
    );
  }
  revertReason = parsed.data.lateRevertReason ?? null;
  if (!revertReason) {
    return NextResponse.json(
      {
        error: 'A reason is required to convert a late enrollee to normal.',
        code: 'reason_required',
      },
      { status: 422 }
    );
  }
  // Drop the late-only classification tag. enrollment_status is already staged
  // to 'active' above; enrollment_date is intentionally left untouched.
  patch.late_enrollee_term_number = null;
  lateEnrolleeReverted = true;
}
```

- [ ] **Step 3: Add the flag to the audit context**

Find this line inside the primary `logAction({ ... context: { ... } })` call (~line 518):

```ts
      ...(isReEnrolment ? { reEnrolment: true } : {}),
```

Add immediately below it:

```ts
      ...(lateEnrolleeReverted
        ? { lateEnrolleeReverted: true, revertReason }
        : {}),
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add "app/api/sections/[id]/students/[enrolmentId]/route.ts"
git commit -m "feat(enrolment): gate late->active to T1 + reason, clear term tag, track revert"
```

---

## Task 3: Humanizer — render the revert line (TDD)

**Files:**

- Modify: `lib/audit/humanize.ts`
- Test: `__tests__/audit/humanize.test.ts`

- [ ] **Step 1: Write the failing test**

In `__tests__/audit/humanize.test.ts`, add (near the other `auditContextSummary` cases — make sure `auditContextSummary` is in the file's import from `@/lib/audit/humanize`):

```ts
describe('auditContextSummary — late enrollee reverted', () => {
  it('renders the revert line with the reason', () => {
    const out = auditContextSummary('enrolment.metadata.update', {
      lateEnrolleeReverted: true,
      revertReason: 'Joined day 2 of T1 — effectively on-time',
      before: { enrollment_status: 'late_enrollee' },
      after: { enrollment_status: 'active' },
    });
    expect(out).toBe(
      'Late enrollee reverted to active — Joined day 2 of T1 — effectively on-time'
    );
  });

  it('renders the revert line without a reason', () => {
    const out = auditContextSummary('enrolment.metadata.update', {
      lateEnrolleeReverted: true,
    });
    expect(out).toBe('Late enrollee reverted to active');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/audit/humanize.test.ts`
Expected: FAIL — the two new cases return the generic status-diff (`Late enrollee → Active`), not the revert line.

- [ ] **Step 3: Implement**

In `lib/audit/humanize.ts`, find the start of the `enrolment.metadata.update` case (~line 435):

```ts
    case 'enrolment.metadata.update': {
      const before = isRecord(ctx.before) ? ctx.before : null;
```

Insert these lines **immediately after** the `case 'enrolment.metadata.update': {` line, before `const before = ...`:

```ts
if (ctx.lateEnrolleeReverted === true) {
  const reason = str(ctx.revertReason);
  return reason
    ? `Late enrollee reverted to active — ${reason}`
    : 'Late enrollee reverted to active';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/audit/humanize.test.ts`
Expected: PASS (all cases, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add lib/audit/humanize.ts __tests__/audit/humanize.test.ts
git commit -m "feat(audit): humanize late-enrollee revert in the metadata-update summary"
```

---

## Task 4: SIS enrolment edit sheet — disable T2–T4 + convert confirm

**Files:**

- Modify: `components/sis/enrolment-edit-sheet.tsx`

The component already imports `AlertDialog*`, `Textarea`, `Select*`, `ENROLLMENT_STATUS_VALUES`, `ENROLLMENT_STATUS_LABELS`, and exposes `status`/`setStatus`, `initial.enrollment_status`, `initial.late_enrollee_term_number`, `confirmWithdraw`/`confirmReEnrol`, `handleSubmit`, `doSave`, `saving`, `studentName`.

- [ ] **Step 1: Add convert state**

Find (~line 100):

```ts
const [confirmReEnrol, setConfirmReEnrol] = useState(false);
```

Add below:

```ts
const [confirmConvert, setConfirmConvert] = useState(false);
const [revertReason, setRevertReason] = useState('');
```

- [ ] **Step 2: Add the convert-detection derived flag**

Find (~line 166):

```ts
const isReEnrolling =
  status !== 'withdrawn' && initial.enrollment_status === 'withdrawn';
```

Add below:

```ts
// Convert is offered only for a T1 late enrollee (T2–T4 keep "Active"
// disabled). The server re-checks with an enrollment_date fallback.
const isConvertingLate =
  status === 'active' &&
  initial.enrollment_status === 'late_enrollee' &&
  initial.late_enrollee_term_number === 1;
```

- [ ] **Step 3: Route the submit through the confirm**

Find (inside `handleSubmit`, ~line 175):

```ts
if (isReEnrolling) {
  setConfirmReEnrol(true);
  return;
}
void doSave();
```

Replace with:

```ts
if (isReEnrolling) {
  setConfirmReEnrol(true);
  return;
}
if (isConvertingLate) {
  setConfirmConvert(true);
  return;
}
void doSave();
```

- [ ] **Step 4: Reset the convert dialog + send the reason in `doSave`**

Find the top of `doSave` (~line 183):

```ts
setConfirmWithdraw(false);
setConfirmReEnrol(false);
setSaving(true);
```

Replace with:

```ts
setConfirmWithdraw(false);
setConfirmReEnrol(false);
setConfirmConvert(false);
setSaving(true);
```

Then find (inside `doSave`, ~line 213, right after the `late_enrollee_term_number` block):

```ts
        body.late_enrollee_term_number = lateTermOverride;
      }
```

Add immediately below:

```ts
// Convert late enrollee → normal — send the required reason (audit-only).
if (isConvertingLate) {
  body.lateRevertReason = revertReason.trim();
}
```

- [ ] **Step 5: Add a success toast branch for the convert**

Find (~line 245):

```ts
      } else if (status === 'late_enrollee') {
        toast.success(`Tagged ${studentName} as late enrollee · between terms`);
```

Add this branch **above** that `else if` (so it's checked first):

```ts
      } else if (isConvertingLate) {
        toast.success(`Converted ${studentName} to a normal enrollee`);
```

- [ ] **Step 6: Disable "Active" for a T2–T4 late enrollee in the status dropdown**

Find the status `Select` options (~line 350):

```tsx
{
  ENROLLMENT_STATUS_VALUES.map((s) => (
    <SelectItem key={s} value={s}>
      {ENROLLMENT_STATUS_LABELS[s]}
    </SelectItem>
  ));
}
```

Replace with:

```tsx
{
  ENROLLMENT_STATUS_VALUES.map((s) => {
    // A late enrollee who joined in T2–T4 is unambiguously
    // late — block reverting them to Active (spec 2026-06-12).
    const blockActive =
      s === 'active' &&
      initial.enrollment_status === 'late_enrollee' &&
      initial.late_enrollee_term_number !== 1;
    return (
      <SelectItem key={s} value={s} disabled={blockActive}>
        {ENROLLMENT_STATUS_LABELS[s]}
        {blockActive ? ' — joined mid-year' : ''}
      </SelectItem>
    );
  });
}
```

- [ ] **Step 7: Add the convert confirm dialog**

Find the closing of the re-enrol AlertDialog (the `</AlertDialog>` that closes `confirmReEnrol`, ~line 641 onward — it's the last `</AlertDialog>` before the component's closing tags). Add this **after** that closing `</AlertDialog>`:

```tsx
<AlertDialog open={confirmConvert} onOpenChange={setConfirmConvert}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Convert to normal enrollee?</AlertDialogTitle>
      <AlertDialogDescription asChild>
        <div className="space-y-3 text-sm">
          <div>
            <p className="font-medium text-foreground">This will</p>
            <ul className="mt-1 space-y-1 text-muted-foreground">
              <li>• Remove the late-enrollee classification</li>
              <li>• Clear the late-enrollee term</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-foreground">This will not</p>
            <ul className="mt-1 space-y-1 text-muted-foreground">
              <li>• Change the enrollment date</li>
              <li>• Change attendance records</li>
              <li>• Change grades or report cards</li>
            </ul>
          </div>
        </div>
      </AlertDialogDescription>
    </AlertDialogHeader>
    <div className="space-y-1.5">
      <label
        htmlFor="revert-reason"
        className="text-xs font-medium text-foreground"
      >
        Reason <span className="text-destructive">*</span>
      </label>
      <Textarea
        id="revert-reason"
        value={revertReason}
        onChange={(e) => setRevertReason(e.target.value)}
        placeholder="Why is the late-enrollee tag being removed?"
        rows={3}
      />
    </div>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        disabled={saving || revertReason.trim().length === 0}
        onClick={(e) => {
          e.preventDefault();
          void doSave();
        }}
      >
        Convert
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add components/sis/enrolment-edit-sheet.tsx
git commit -m "feat(records): convert-to-normal confirm + disable Active for T2-T4 late enrollees"
```

---

## Task 5: Markbook enrolment edit sheet — same four edits

**Files:**

- Modify: `components/markbook/enrolment-edit-sheet.tsx`

This is the twin of the SIS sheet (same `status`/`setStatus`, `initial.enrollment_status`, `initial.late_enrollee_term_number`, `confirmWithdraw`, `handleSubmit`, `doSave`, `saving`, `studentName`, same `ENROLLMENT_STATUS_VALUES.map` status `Select`). Apply the identical changes. First confirm the imports.

- [ ] **Step 1: Ensure imports**

Confirm `components/markbook/enrolment-edit-sheet.tsx` imports `Textarea` (`@/components/ui/textarea`) and the `AlertDialog*` family (`@/components/ui/alert-dialog`). If `Textarea` is missing, add:

```ts
import { Textarea } from '@/components/ui/textarea';
```

- [ ] **Step 2: Add convert state**

Find:

```ts
const [confirmWithdraw, setConfirmWithdraw] = useState(false);
```

Add below (note: this sheet may not have `confirmReEnrol` — add convert state regardless):

```ts
const [confirmConvert, setConfirmConvert] = useState(false);
const [revertReason, setRevertReason] = useState('');
```

- [ ] **Step 3: Add the convert-detection flag**

Find the `isWithdrawing` derived flag (~line 152):

```ts
const isWithdrawing =
  status === 'withdrawn' && initial.enrollment_status !== 'withdrawn';
```

Add below:

```ts
const isConvertingLate =
  status === 'active' &&
  initial.enrollment_status === 'late_enrollee' &&
  initial.late_enrollee_term_number === 1;
```

- [ ] **Step 4: Route the submit through the confirm**

In `handleSubmit` (~line 154), find the body that ends with `void doSave();`. Add the convert branch right before `void doSave();` (and after any existing `isWithdrawing`/`confirmWithdraw` branch):

```ts
if (isConvertingLate) {
  setConfirmConvert(true);
  return;
}
void doSave();
```

- [ ] **Step 5: Reset the dialog + send the reason in `doSave`**

At the top of `doSave`, add alongside the existing `setConfirm...(false)` calls:

```ts
setConfirmConvert(false);
```

Then, right after the existing `requestBody.late_enrollee_term_number = lateTermOverride;` block (~line 182), add:

```ts
if (isConvertingLate) {
  requestBody.lateRevertReason = revertReason.trim();
}
```

(Use the body-variable name this file already uses — it is `requestBody` in the markbook sheet.)

- [ ] **Step 6: Add a success toast branch**

Find the success toast `else if (status === 'late_enrollee')` branch (~line 210) and add **above** it:

```ts
      } else if (isConvertingLate) {
        toast.success(`Converted ${studentName} to a normal enrollee`);
```

- [ ] **Step 7: Disable "Active" for a T2–T4 late enrollee**

Find the status `Select` options (the `ENROLLMENT_STATUS_VALUES.map(...)` block, ~line 302+) and replace it with the same disabled-aware map used in Task 4 Step 6:

```tsx
{
  ENROLLMENT_STATUS_VALUES.map((s) => {
    const blockActive =
      s === 'active' &&
      initial.enrollment_status === 'late_enrollee' &&
      initial.late_enrollee_term_number !== 1;
    return (
      <SelectItem key={s} value={s} disabled={blockActive}>
        {ENROLLMENT_STATUS_LABELS[s]}
        {blockActive ? ' — joined mid-year' : ''}
      </SelectItem>
    );
  });
}
```

- [ ] **Step 8: Add the convert confirm dialog**

After the last `</AlertDialog>` in the component (the `confirmWithdraw` one), add the same `confirmConvert` `<AlertDialog>...</AlertDialog>` block shown in Task 4 Step 7 (identical — same state names `confirmConvert`/`setConfirmConvert`/`revertReason`/`setRevertReason`/`saving`/`doSave`).

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 10: Commit**

```bash
git add components/markbook/enrolment-edit-sheet.tsx
git commit -m "feat(markbook): convert-to-normal confirm + disable Active for T2-T4 late enrollees"
```

---

## Task 6: Build + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `npx next build`
Expected: `Compiled successfully`.

- [ ] **Step 2: Full test run**

Run: `npx vitest run`
Expected: all pass (incl. the new humanize cases).

- [ ] **Step 3: Manual (test AY9999)**

- A **T1** late enrollee (masterfile shows "late enrolment - term 1") → open the enrolment edit sheet → set status **Active** → Save → the **Convert to normal enrollee?** dialog appears with the will/won't lists; **Convert is disabled until a reason is typed**; on Convert: status → active, the late-term tag clears, and on the attendance page the student's **rollup + the "Before enrolment date" dimming are unchanged** (enrollment_date intact). The Records/SIS audit log shows **"Late enrollee reverted to active — {reason}"**.
- A **T2/T3/T4** late enrollee → "Active" is **disabled** in the dropdown ("— joined mid-year"). A direct `PATCH` sending `enrollment_status: 'active'` for that row → **422 `late_revert_not_t1`**. A T1 convert `PATCH` with no `lateRevertReason` → **422 `reason_required`**.

- [ ] **Step 4: Regression check**

- `active → late_enrollee` still shows the joining-term suggestion (KD #117).
- `withdrawn → active` still shows its re-enrol confirm.
- A plain bus-no / officer edit on any row still saves with no convert dialog.

---

## Self-review notes

- **Spec coverage:** T1-only gate (Task 2 + Task 4/5 disable) ✓; required reason (Task 2 server + Task 4/5 UI) ✓; clear `late_enrollee_term_number`, keep `enrollment_date`, no recompute (Task 2; recompute guard already requires `'enrollment_date' in patch`) ✓; tracked audit + humanizer (Task 2 + Task 3) ✓; both editors (Task 4 + Task 5) ✓; masterfile classification flips automatically (no code — it derives from `enrollment_status`/`late_enrollee_term_number`) ✓.
- **Type consistency:** `lateRevertReason` (schema body field) ↔ route `parsed.data.lateRevertReason` ↔ UI `body.lateRevertReason`/`requestBody.lateRevertReason`; audit `lateEnrolleeReverted` + `revertReason` ↔ humanizer `ctx.lateEnrolleeReverted`/`ctx.revertReason`. Consistent.
- **No placeholders:** every code step shows full code; the markbook dialog (Task 5 Step 8) references the identical block from Task 4 Step 7 (same symbol names) — repeat it verbatim when implementing.
