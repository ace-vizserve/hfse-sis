# Pre-course inline session-date editing — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let admissions record/correct/clear a pre-course **session date** inline on `/admissions/cohorts/pre-course`, flipping the applicant between "Not yet counselled" and "Counselled." Spec: `docs/superpowers/specs/2026-06-11-precourse-inline-edit-design.md`.

**Architecture:** New `PATCH /api/sis/students/[enroleeNumber]/pre-course` (mirrors the `stp-status` route) writes `preCourseAnswer`+`preCourseDate` together to `ay{YYYY}_enrolment_applications`; an inline `DatePicker` cell on the pre-course cohort column calls it + `router.refresh()`. No migration.

---

## File structure

- **Create** `app/api/sis/students/[enroleeNumber]/pre-course/route.ts` — the PATCH route.
- **Modify** `lib/audit/log-action.ts` — add `'sis.precourse.update'` to the `AuditAction` union.
- **Modify** `lib/audit/humanize.ts` — add a label for it.
- **Modify** `app/(admissions)/admissions/audit-log/page.tsx` — add it to `ADMISSIONS_AUDIT_ACTIONS`.
- **Create** `components/sis/cohorts/pre-course-date-cell.tsx` — the inline editable date cell.
- **Modify** `components/sis/cohorts/cohort-table.tsx` — render the cell in the `preCourseDate` column.
- **Modify** `.claude/rules/key-decisions/admissions.md` + `.claude/rules/key-decisions.md` — KD.

---

## Task 1: PATCH route + audit plumbing

**Files:** Create `app/api/sis/students/[enroleeNumber]/pre-course/route.ts`; modify `lib/audit/log-action.ts`, `lib/audit/humanize.ts`, `app/(admissions)/admissions/audit-log/page.tsx`.

- [ ] **Step 1: AuditAction + humanizer + allowlist**
  - `lib/audit/log-action.ts`: add `| 'sis.precourse.update'` to the `AuditAction` union (next to `'sis.stp.update'`, line ~62).
  - `lib/audit/humanize.ts`: add `'sis.precourse.update': 'Pre-course session recorded',` (next to the `'sis.stp.update'` label, line ~117).
  - `app/(admissions)/admissions/audit-log/page.tsx`: add `'sis.precourse.update'` to the `ADMISSIONS_AUDIT_ACTIONS` array (it's a `sis.*` admissions edit, KD #70).

- [ ] **Step 2: Write the route** (mirror `app/api/sis/students/[enroleeNumber]/stp-status/route.ts` exactly — read it first):

```ts
import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/sis/students/[enroleeNumber]/pre-course?ay=AY2026
// Records the pre-course counselling SESSION DATE (the ICA/CPE acknowledgement
// proof) on ay{YY}_enrolment_applications. A date ⇒ counselled (answer 'Yes');
// clearing ⇒ not-yet (answer + date null). preCourseAcknowledgedAt is the
// parent-portal app timestamp — never written here. Role: operational writers
// only (KD #74) — school_admin sees the tracker but is read-only oversight.

// Accepts 'YYYY-MM-DD' or null; '' → null.
const PreCourseBodySchema = z.object({
  sessionDate: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(''), z.null()])
    .transform((v) => (v ? v : null)),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string }> }
) {
  const auth = await requireRole(['admissions', 'registrar', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { enroleeNumber } = await params;
  if (!enroleeNumber.trim()) {
    return NextResponse.json(
      { error: 'Missing enroleeNumber' },
      { status: 400 }
    );
  }

  const url = new URL(request.url);
  const ayCode = (url.searchParams.get('ay') ?? '').trim();
  if (!/^AY\d{4}$/i.test(ayCode)) {
    return NextResponse.json(
      { error: 'Invalid or missing ay query param' },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = PreCourseBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'sessionDate must be YYYY-MM-DD or null.',
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }
  const date = parsed.data.sessionDate; // string | null
  const nextAnswer = date ? 'Yes' : null;

  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  const admissions = createAdmissionsClient();

  const { data: beforeRow, error: beforeErr } = await admissions
    .from(`${prefix}_enrolment_applications`)
    .select('enroleeNumber, preCourseAnswer, preCourseDate')
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (beforeErr) {
    return NextResponse.json({ error: beforeErr.message }, { status: 500 });
  }
  if (!beforeRow) {
    return NextResponse.json(
      { error: 'No application row for this enrolee in this AY' },
      { status: 404 }
    );
  }
  const before = beforeRow as {
    preCourseAnswer: string | null;
    preCourseDate: string | null;
  };

  if (
    (before.preCourseDate ?? null) === date &&
    (before.preCourseAnswer ?? null) === nextAnswer
  ) {
    return NextResponse.json({ ok: true, changed: false });
  }

  const { error: updateErr } = await admissions
    .from(`${prefix}_enrolment_applications`)
    .update({ preCourseAnswer: nextAnswer, preCourseDate: date })
    .eq('enroleeNumber', enroleeNumber);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const service = createServiceClient();
  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'sis.precourse.update',
    entityType: 'enrolment_application',
    entityId: enroleeNumber,
    context: {
      ay_code: ayCode,
      changes: [
        { field: 'preCourseDate', from: before.preCourseDate, to: date },
        {
          field: 'preCourseAnswer',
          from: before.preCourseAnswer,
          to: nextAnswer,
        },
      ],
    },
  });

  revalidateTag(`sis:${ayCode}`, 'max');
  invalidateDrillTags('admissions', ayCode);

  return NextResponse.json({ ok: true, changed: true });
}
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit 2>&1 | grep -v validator.ts | grep "error TS"` → none.
- [ ] **Step 4: Commit**

```bash
git add "app/api/sis/students/[enroleeNumber]/pre-course/route.ts" lib/audit/log-action.ts lib/audit/humanize.ts "app/(admissions)/admissions/audit-log/page.tsx"
git commit -m "feat(admissions): PATCH pre-course session-date route + audit action"
```

---

## Task 2: Inline editable date cell + wire into the cohort table

**Files:** Create `components/sis/cohorts/pre-course-date-cell.tsx`; modify `components/sis/cohorts/cohort-table.tsx`.

- [ ] **Step 1: Build the cell** — `'use client'`. Props: `{ enroleeNumber: string; ayCode: string; value: string | null }`. Renders the canonical `DatePicker` (`components/ui/date-picker`, KD #44) seeded from `value`, with a clear (✕) control. On change/clear:
  - optimistic: set local displayed date immediately;
  - `fetch('/api/sis/students/${enroleeNumber}/pre-course?ay=${ayCode}', { method:'PATCH', body: JSON.stringify({ sessionDate: nextOrNull }) })`;
  - on `res.ok` → `toast.success('Session date saved')` + `router.refresh()` (re-fetches the cohort RSC so the status badge, the Not-yet/Counselled tab membership, and the dashboard stat reconcile);
  - on failure → revert local + `toast.error(...)`.
  - Use `useRouter` from `next/navigation`, `toast` from `'sonner'` (KD #21), raw fetch (KD #24). Keep a `pending` state to disable during the request. Tokens only.

- [ ] **Step 2: Wire into the column** — in `components/sis/cohorts/cohort-table.tsx`, `buildPreCourseColumns(ayCode)` `preCourseDate` column: replace the static cell

```tsx
cell: ({ row }) => (
  <span className="text-sm tabular-nums text-foreground">
    {formatDate(row.original.preCourseDate)}
  </span>
),
```

with

```tsx
cell: ({ row }) => (
  <PreCourseDateCell
    enroleeNumber={row.original.enroleeNumber}
    ayCode={ayCode}
    value={row.original.preCourseDate ?? null}
  />
),
```

Import `PreCourseDateCell`. (`ayCode` is already a `buildPreCourseColumns` param; `enroleeNumber` is on the row.)

- [ ] **Step 3: Verify** — `npx tsc --noEmit …` (none) + `npx next build` ("Compiled successfully").
- [ ] **Step 4: Manual (test AY)** — on `/admissions/cohorts/pre-course`: a Not-yet row → pick a date → row moves to Counselled, date shows, dashboard "Pre-course counselling %" ticks; correct a date → persists; clear → back to Not-yet. As a non-writer role (school_admin) the PATCH 403s (cell can stay visible but the write fails with a toast) — acceptable; or hide the editable affordance for read-only roles if the table receives the viewer role (only if trivially available — otherwise leave, the route is the gate).
- [ ] **Step 5: Commit**

```bash
git add components/sis/cohorts/pre-course-date-cell.tsx components/sis/cohorts/cohort-table.tsx
git commit -m "feat(admissions): inline pre-course session-date editing on the tracker"
```

---

## Task 3: KD + verify

- [ ] **Step 1:** Append a KD to `.claude/rules/key-decisions/admissions.md` (next number) — "Pre-course tracker inline session-date editing. `/admissions/cohorts/pre-course` 'Session date' is an editable `DatePicker`; setting a date writes `preCourseAnswer='Yes'`+`preCourseDate` (→ Counselled), clearing nulls both (→ Not yet); `preCourseAcknowledgedAt` untouched (portal-owned). `PATCH /api/sis/students/[enroleeNumber]/pre-course?ay=` (operational writers admissions/registrar/superadmin per KD #74; mirrors stp-status), audits `sis.precourse.update`, revalidates `sis:${ay}`. Inline cell + `router.refresh()` reconciles status/tab/dashboard. No migration." Add the index row + quick-lookup entry.
- [ ] **Step 2: Commit** + `/sync-docs` if needed.

---

## Self-review (against spec)

- Inline editable date on the tracker (Task 2). ✓
- Set→Yes+date / clear→null+null auto-flip; any date allowed; acknowledgedAt untouched (route Step 2). ✓
- Route mirrors stp-status: operational-writer roles, AY-slug, audit, revalidate (Task 1). ✓
- Audit action + humanizer + admissions allowlist (Task 1). ✓
- router.refresh() reconciles status badge + tab + dashboard stat (Task 2). ✓

## Verification (whole feature)

- `npx tsc --noEmit` + `npx next build` green.
- Manual happy path on test AY (record / correct / clear; dashboard ticks; audit row).
- One branch `feat/precourse-inline-edit`; `feature-dev:code-reviewer` (route role gate + AY-slug + the date-zod + revalidate; optimistic-cell revert + router.refresh; DatePicker canonical). No migration.
