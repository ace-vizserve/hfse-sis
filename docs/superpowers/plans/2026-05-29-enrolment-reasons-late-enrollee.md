# Enrolment Reasons + Late-Enrollee Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured withdrawal/cancellation reasons to the Records and Admissions modules, and improve the late-enrollee tagging flow so it auto-prompts mid-year with a ticked checkbox and lets registrars correct the joining term.

**Architecture:** One migration adds new nullable columns to `section_students` and all `ay{YYYY}_enrolment_status` tables. Schema constants + Zod schemas are extended in `lib/schemas/`. The two PATCH routes (`/api/sections/[id]/students/[enrolmentId]` and `/api/sis/students/[enroleeNumber]/stage/[stageKey]`) enforce the new validation. Two client components (`<EnrolmentEditSheet>` and `<EditStageDialog>`) are updated for the new UI. Display surfaces (`/records/movements` and `/admissions/applications/closed`) gain a reason column. No new tables; no new routes; no new pages.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres, Zod, shadcn `Select`/`Textarea`/`AlertDialog`, `@tanstack/react-table`, Vitest.

---

## Codebase context (read before implementing)

- **`lib/schemas/enrolment.ts`** — `EnrolmentMetadataSchema` currently has `reason: optionalText(WITHDRAWAL_REASON_MAX).optional()` (freetext). We rename this field to `withdrawal_notes` and add `withdrawal_reason` (enum) + `late_enrollee_term_number` (int 1–4 nullable).
- **`lib/schemas/sis.ts`** — `STAGE_COLUMN_MAP.application.extras` is currently `[]`. We add two entries: `terminalReason` and `terminalNotes`. These map to `applicationTerminalReason` / `applicationTerminalNotes` columns on the AY status table. The stage PATCH route already writes `extras` generically via the column map — adding entries there means the data is persisted automatically; we only need to add validation.
- **`app/api/sections/[id]/students/[enrolmentId]/route.ts`** — The PATCH already handles `enrollment_status` transitions; it cascades `→ Withdrawn` to the admissions status table. We add: require `withdrawal_reason` on the `→ withdrawn` boundary; persist `withdrawal_notes` + `late_enrollee_term_number`; cascade reason to admissions only when `applicationTerminalReason` is currently NULL.
- **`app/api/sis/students/[enroleeNumber]/stage/[stageKey]/route.ts`** — When `stageKey === 'application'` and status ∈ `{Cancelled, Withdrawn}`, validate `extras.terminalReason` required; validate notes required when reason is `'other'`.
- **`components/sis/enrolment-edit-sheet.tsx`** — 448 lines. Upgrade withdrawal `<AlertDialog>` body to include required reason `<Select>` before the existing notes `<Textarea>`. Add "Joined in T{n}" read row + "wrong term?" override picker for `late_enrollee` status rows.
- **`components/sis/edit-stage-dialog.tsx`** — 608 lines. Two changes: (a) new terminal reason section when status flips to `Cancelled`/`Withdrawn`; (b) mid-term enrolment checkbox defaults to **ticked**.
- **`lib/sis/movements.ts`** — `WithdrawnEvent` already has `reason?: string | null` sourced from `context.reason`. We add `reasonLabel: string | null` resolved from the new enum. Both fields read from audit context; no DB query added.
- **`app/(admissions)/admissions/applications/closed/page.tsx`** — 187 lines. Add a Reason column to the TanStack table and 3 filter chips by reason category.
- **`WITHDRAWAL_REASON_MAX`** constant in `lib/schemas/enrolment.ts` is 200 (existing). Notes field max stays 200 for the existing field; plan keeps it the same for `withdrawal_notes`.

---

## Task 1 — Migration 067: add reason + late-term columns

**Files:**

- Create: `supabase/migrations/067_enrolment_reasons_and_late_term.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/067_enrolment_reasons_and_late_term.sql
--
-- Adds:
--   section_students.withdrawal_reason         text nullable
--   section_students.withdrawal_notes          text nullable
--   section_students.late_enrollee_term_number smallint nullable (1–4)
--
--   ay{YYYY}_enrolment_status."applicationTerminalReason" text nullable
--   ay{YYYY}_enrolment_status."applicationTerminalNotes"  text nullable
--
-- Extends create_ay_admissions_tables() so future AYs include these columns.

-- ── section_students ─────────────────────────────────────────────────────────

alter table public.section_students
  add column if not exists withdrawal_reason text,
  add column if not exists withdrawal_notes  text,
  add column if not exists late_enrollee_term_number smallint
    check (late_enrollee_term_number is null or late_enrollee_term_number between 1 and 4);

-- ── All existing ay{YYYY}_enrolment_status tables ────────────────────────────

do $$
declare
  v_ay   record;
  v_slug text;
  v_tbl  text;
begin
  for v_ay in select ay_code from public.academic_years loop
    v_slug := 'ay' || substring(v_ay.ay_code from 3);
    v_tbl  := v_slug || '_enrolment_status';
    if to_regclass('public.' || quote_ident(v_tbl)) is not null then
      execute format(
        'alter table public.%I
           add column if not exists "applicationTerminalReason" text,
           add column if not exists "applicationTerminalNotes"  text',
        v_tbl
      );
    end if;
  end loop;
end;
$$;

-- ── Extend create_ay_admissions_tables() RPC ─────────────────────────────────
-- Copy the full function body from migration 026 and add two columns to the
-- ay{YYYY}_enrolment_status DDL string, after "levelApplied" text null:
--
--   "applicationTerminalReason" text null,
--   "applicationTerminalNotes"  text null,
--
-- The updated CREATE OR REPLACE replaces the existing definition so new AYs
-- created after this migration inherit the columns automatically.
-- [Implementer: copy the full function body from supabase/migrations/026_ay_slug_4digit.sql
--  starting at "create or replace function public.create_ay_admissions_tables",
--  add the two column lines to the format($ddl$...) block for _enrolment_status,
--  and paste the result here.]
```

- [ ] **Step 2: Apply the migration to the local dev database**

```powershell
npx supabase db push
```

Expected: migration 067 applied successfully, no errors.

- [ ] **Step 3: Verify columns exist**

```powershell
npx supabase db execute --sql "select column_name from information_schema.columns where table_name='section_students' and column_name in ('withdrawal_reason','withdrawal_notes','late_enrollee_term_number')"
```

Expected: 3 rows returned.

```powershell
npx supabase db execute --sql "select column_name from information_schema.columns where table_name='ay9999_enrolment_status' and column_name in ('applicationTerminalReason','applicationTerminalNotes')"
```

Expected: 2 rows returned.

---

## Task 2 — Schema constants and Zod schemas

**Files:**

- Modify: `lib/schemas/enrolment.ts`
- Modify: `lib/schemas/sis.ts`

- [ ] **Step 1: Add withdrawal reason enum to `lib/schemas/enrolment.ts`**

Replace the existing content of `lib/schemas/enrolment.ts` with:

```typescript
import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s.length === 0 ? null : s))
    .nullable();

export const ENROLLMENT_STATUS_VALUES = [
  'active',
  'late_enrollee',
  'withdrawn',
] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUS_VALUES)[number];

export const WITHDRAWAL_REASON_VALUES = [
  'transferred_other_school',
  'family_relocation',
  'financial',
  'disciplinary',
  'health',
  'academic_fit',
  'other',
] as const;
export type WithdrawalReason = (typeof WITHDRAWAL_REASON_VALUES)[number];

export const WITHDRAWAL_REASON_LABELS: Record<WithdrawalReason, string> = {
  transferred_other_school: 'Transferred to another school',
  family_relocation: 'Family relocating',
  financial: 'Financial / non-payment',
  disciplinary: 'Disciplinary',
  health: 'Health / medical',
  academic_fit: 'Academic fit / parent decision',
  other: 'Other',
};

// Notes field cap (kept at 200 for backwards compat with existing audit rows).
export const WITHDRAWAL_REASON_MAX = 200;

export const EnrolmentMetadataSchema = z
  .object({
    bus_no: optionalText(40),
    classroom_officer_role: optionalText(80),
    enrollment_status: z.enum(ENROLLMENT_STATUS_VALUES).optional(),
    // Structured withdrawal reason — required on the → withdrawn boundary.
    withdrawal_reason: z.enum(WITHDRAWAL_REASON_VALUES).nullable().optional(),
    // Freetext notes (replaces the old unstructured `reason` field).
    withdrawal_notes: optionalText(WITHDRAWAL_REASON_MAX).optional(),
    // Explicit late-enrollee term override (null = derive from enrollment_date).
    late_enrollee_term_number: z
      .number()
      .int()
      .min(1)
      .max(4)
      .nullable()
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.enrollment_status === 'withdrawn' && !data.withdrawal_reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['withdrawal_reason'],
        message: 'Reason is required when withdrawing a student.',
      });
    }
    if (data.withdrawal_reason === 'other' && !data.withdrawal_notes?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['withdrawal_notes'],
        message: 'Notes are required when reason is "Other".',
      });
    }
  });

export type EnrolmentMetadataInput = z.infer<typeof EnrolmentMetadataSchema>;

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  active: 'Active',
  late_enrollee: 'Late enrollee',
  withdrawn: 'Withdrawn',
};
```

- [ ] **Step 2: Add application terminal reason constants to `lib/schemas/sis.ts`**

After the `STAGE_TERMINAL_STATUS` block (around line 365), add:

```typescript
export const APPLICATION_TERMINAL_REASON_VALUES = [
  'chose_another_school',
  'visa_denied',
  'lost_interest',
  'financial',
  'family_relocation',
  'health',
  'other',
] as const;
export type ApplicationTerminalReason =
  (typeof APPLICATION_TERMINAL_REASON_VALUES)[number];

export const APPLICATION_TERMINAL_REASON_LABELS: Record<
  ApplicationTerminalReason,
  string
> = {
  chose_another_school: 'Chose another school',
  visa_denied: 'Pass / visa application denied',
  lost_interest: 'Lost interest / no response',
  financial: 'Financial reasons',
  family_relocation: 'Family relocating overseas',
  health: 'Health / personal',
  other: 'Other',
};

// Statuses on the application stage that require a terminal reason.
export const APPLICATION_TERMINAL_STATUSES = [
  'Cancelled',
  'Withdrawn',
] as const;
```

- [ ] **Step 3: Add terminal reason extras to `STAGE_COLUMN_MAP.application` in `lib/schemas/sis.ts`**

Find the `application` entry in `STAGE_COLUMN_MAP` (currently `extras: []`) and replace it:

```typescript
  application: {
    statusCol: 'applicationStatus',
    remarksCol: 'applicationRemarks',
    updatedDateCol: 'applicationUpdatedDate',
    updatedByCol: 'applicationUpdatedBy',
    extras: [
      {
        fieldKey: 'terminalReason',
        columnName: 'applicationTerminalReason',
        kind: 'text',
        label: 'Reason',
      },
      {
        fieldKey: 'terminalNotes',
        columnName: 'applicationTerminalNotes',
        kind: 'text',
        label: 'Notes',
      },
    ],
  },
```

- [ ] **Step 4: Verify TypeScript**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```powershell
git add lib/schemas/enrolment.ts lib/schemas/sis.ts
git commit -m "feat(schemas): withdrawal reason enum + admissions terminal reason constants"
```

---

## Task 3 — `resolveLateEnrolleeTerm` helper + unit tests

**Files:**

- Modify: `lib/sis/terms.ts`
- Modify: `lib/sis/terms.test.ts` (create if absent)

- [ ] **Step 1: Add `resolveLateEnrolleeTerm` to `lib/sis/terms.ts`**

Append after the last export in the file:

```typescript
export type ResolvedLateEnrolleeTerm = {
  termNumber: number;
  termLabel: string;
  source: 'override' | 'derived';
} | null;

/**
 * Determines a late-enrollee's joining term.
 * If `late_enrollee_term_number` is set, that is the registrar's explicit
 * correction (source='override'). Otherwise derives from `enrollment_date`
 * via `getTermForDate` (source='derived'). Returns null when neither is
 * available or the date falls outside all term windows.
 */
export async function resolveLateEnrolleeTerm(
  row: {
    enrollment_date: string | null;
    late_enrollee_term_number: number | null;
  },
  ayCode: string
): Promise<ResolvedLateEnrolleeTerm> {
  if (row.late_enrollee_term_number !== null) {
    const n = row.late_enrollee_term_number;
    return { termNumber: n, termLabel: `T${n}`, source: 'override' };
  }
  if (!row.enrollment_date) return null;
  const term = await getTermForDate(row.enrollment_date, ayCode);
  if (!term) return null;
  return {
    termNumber: term.termNumber,
    termLabel: term.termLabel,
    source: 'derived',
  };
}
```

- [ ] **Step 2: Write unit tests**

Create (or open) `lib/sis/terms.test.ts` and add:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { resolveLateEnrolleeTerm } from './terms';

// Stub getTermForDate so the tests don't need a live Supabase connection.
vi.mock('./terms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./terms')>();
  return {
    ...actual,
    getTermForDate: vi.fn(async (date: string) => {
      if (date === '2026-04-01') return { termNumber: 2, termLabel: 'T2' };
      return null;
    }),
    resolveLateEnrolleeTerm: actual.resolveLateEnrolleeTerm,
  };
});

describe('resolveLateEnrolleeTerm', () => {
  it('returns override when late_enrollee_term_number is set', async () => {
    const result = await resolveLateEnrolleeTerm(
      { enrollment_date: '2026-04-01', late_enrollee_term_number: 3 },
      'AY2026'
    );
    expect(result).toEqual({
      termNumber: 3,
      termLabel: 'T3',
      source: 'override',
    });
  });

  it('falls back to derived when override is null', async () => {
    const result = await resolveLateEnrolleeTerm(
      { enrollment_date: '2026-04-01', late_enrollee_term_number: null },
      'AY2026'
    );
    expect(result).toEqual({
      termNumber: 2,
      termLabel: 'T2',
      source: 'derived',
    });
  });

  it('returns null when no enrollment_date and no override', async () => {
    const result = await resolveLateEnrolleeTerm(
      { enrollment_date: null, late_enrollee_term_number: null },
      'AY2026'
    );
    expect(result).toBeNull();
  });

  it('returns null when enrollment_date falls outside term windows', async () => {
    const result = await resolveLateEnrolleeTerm(
      { enrollment_date: '2026-06-01', late_enrollee_term_number: null },
      'AY2026'
    );
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests**

```powershell
npx vitest run lib/sis/terms.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 4: Verify TypeScript**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```powershell
git add lib/sis/terms.ts lib/sis/terms.test.ts
git commit -m "feat(sis): resolveLateEnrolleeTerm helper with override > derived fallback"
```

---

## Task 4 — Records PATCH route: withdrawal reason + late-term override

**Files:**

- Modify: `app/api/sections/[id]/students/[enrolmentId]/route.ts`

- [ ] **Step 1: Update the schema parse and status-transition block**

The route already calls `EnrolmentMetadataSchema.safeParse(body)`. Because the schema now has `withdrawal_reason`, `withdrawal_notes`, and `late_enrollee_term_number`, and the `superRefine` enforces required-on-boundary, the parse will automatically 422 invalid inputs. No change needed to the parse call — just ensure the parsed values are used.

Find the `→ withdrawn` boundary block (where `withdrawal_date = today` is set). It will look like:

```typescript
if (
  patch.enrollment_status === 'withdrawn' &&
  before.enrollment_status !== 'withdrawn'
) {
  updates.withdrawal_date = today;
  // ... existing cascade code
}
```

Extend it to:

```typescript
if (
  patch.enrollment_status === 'withdrawn' &&
  before.enrollment_status !== 'withdrawn'
) {
  updates.withdrawal_date = today;
  updates.withdrawal_reason = patch.withdrawal_reason ?? null;
  updates.withdrawal_notes = patch.withdrawal_notes ?? null;
}
```

Add the `late_enrollee_term_number` update alongside the existing `enrollment_date` refresh on the `→ late_enrollee` boundary:

```typescript
if (patch.enrollment_status === 'late_enrollee') {
  // existing: refresh enrollment_date only on boundary
  if (before.enrollment_status !== 'late_enrollee') {
    updates.enrollment_date = today;
    lateEnrolleeTransition = true;
  }
  // always persist an explicit term override (null clears it)
  if (patch.late_enrollee_term_number !== undefined) {
    updates.late_enrollee_term_number = patch.late_enrollee_term_number ?? null;
  }
}
```

Also handle a standalone term correction (no status change, just `late_enrollee_term_number` present):

```typescript
if (
  patch.late_enrollee_term_number !== undefined &&
  patch.enrollment_status === undefined &&
  before.enrollment_status === 'late_enrollee'
) {
  updates.late_enrollee_term_number = patch.late_enrollee_term_number ?? null;
}
```

- [ ] **Step 2: Update the audit context to mirror DB columns exactly**

Find the `logAction` call (near the end of the PATCH handler). Extend `context`:

```typescript
await logAction({
  // ... existing fields ...
  context: {
    section_id,
    before: {
      enrollment_status: before.enrollment_status /* other before fields */,
    },
    after: patch,
    // Mirror new DB columns exactly so audit-derived surfaces stay in sync:
    ...(patch.withdrawal_reason !== undefined && {
      withdrawalReason: patch.withdrawal_reason,
      withdrawalNotes: patch.withdrawal_notes ?? null,
    }),
    ...(lateEnrolleeTransition && { lateEnrolleeTransition: true }),
    ...(patch.late_enrollee_term_number !== undefined && {
      lateEnrolleeTermOverride: patch.late_enrollee_term_number,
    }),
    ...(isReEnrolment && { reEnrolment: true }),
  },
});
```

- [ ] **Step 3: Fix cascade precedence — only overwrite admissions reason when NULL**

Find the `withdrawalCascade` block that updates `ay{YYYY}_enrolment_status`. Currently it sets `applicationStatus = 'Withdrawn'`. Add cascading the reason, but **only if the admissions terminal reason is currently null**:

```typescript
// Fetch current admissions terminal reason before overwriting.
const { data: currentAdmissionsRow } = await service
  .from(`${aySlug}_enrolment_status` as 'ay9999_enrolment_status')
  .select('"applicationTerminalReason"')
  .eq('"enroleeNumber"', enroleeNumber)
  .maybeSingle();

const admissionsAlreadyTerminal =
  (currentAdmissionsRow as { applicationTerminalReason: string | null } | null)
    ?.applicationTerminalReason != null;

const statusUpdate: Record<string, unknown> = {
  applicationStatus: 'Withdrawn',
  applicationUpdatedDate: today,
  applicationUpdatedBy: actorEmail,
};
if (!admissionsAlreadyTerminal && patch.withdrawal_reason) {
  statusUpdate.applicationTerminalReason = patch.withdrawal_reason;
  statusUpdate.applicationTerminalNotes = patch.withdrawal_notes ?? null;
}

await service
  .from(`${aySlug}_enrolment_status` as 'ay9999_enrolment_status')
  .update(statusUpdate)
  .eq('"enroleeNumber"', enroleeNumber);

// Log cascade skip if applicable.
if (admissionsAlreadyTerminal) {
  auditContext.terminalCascadeSkipped = 'admissions-already-terminal';
}
```

Note: The table name cast (`as 'ay9999_enrolment_status'`) follows the existing pattern in the route — copy the pattern you see in the file.

- [ ] **Step 4: DO NOT null out withdrawal_reason on reactivation**

Find the `withdrawn → other` boundary where `withdrawal_date = null` is cleared. Ensure `withdrawal_reason` and `withdrawal_notes` are **not** added to `updates` here. The route should leave them in place.

The reactivation block should only contain:

```typescript
if (
  before.enrollment_status === 'withdrawn' &&
  patch.enrollment_status !== 'withdrawn'
) {
  updates.withdrawal_date = null;
  // Do NOT add: updates.withdrawal_reason = null
  // Do NOT add: updates.withdrawal_notes = null
  isReEnrolment = true;
}
```

- [ ] **Step 5: Verify TypeScript**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```powershell
git add "app/api/sections/[id]/students/[enrolmentId]/route.ts"
git commit -m "feat(records): withdrawal_reason + withdrawal_notes + late_enrollee_term_number on PATCH"
```

---

## Task 5 — Admissions stage PATCH route: terminal reason validation

**Files:**

- Modify: `app/api/sis/students/[enroleeNumber]/stage/[stageKey]/route.ts`

- [ ] **Step 1: Import new constants**

At the top of the route file, add to the imports from `@/lib/schemas/sis`:

```typescript
import {
  // ... existing imports ...
  APPLICATION_TERMINAL_REASON_VALUES,
  APPLICATION_TERMINAL_STATUSES,
} from '@/lib/schemas/sis';
```

- [ ] **Step 2: Add terminal reason validation when status is Cancelled/Withdrawn**

After the section that parses the body and validates prerequisites (before executing the DB update), add:

```typescript
// When the application stage flips to a terminal status, require a reason.
if (
  stageKey === 'application' &&
  APPLICATION_TERMINAL_STATUSES.includes(
    patch.status as (typeof APPLICATION_TERMINAL_STATUSES)[number]
  )
) {
  const reason = patch.extras?.terminalReason as string | undefined;
  const notes = patch.extras?.terminalNotes as string | undefined;

  if (
    !reason ||
    !APPLICATION_TERMINAL_REASON_VALUES.includes(
      reason as (typeof APPLICATION_TERMINAL_REASON_VALUES)[number]
    )
  ) {
    return NextResponse.json(
      {
        error:
          'Reason is required when cancelling or withdrawing an application.',
      },
      { status: 422 }
    );
  }
  if (reason === 'other' && !notes?.trim()) {
    return NextResponse.json(
      { error: 'Notes are required when reason is "Other".' },
      { status: 422 }
    );
  }
}
```

The extras are already written generically by the route's column-map loop because we added `terminalReason` and `terminalNotes` to `STAGE_COLUMN_MAP.application.extras` in Task 2. No additional DB write code is needed.

- [ ] **Step 3: Add terminal fields to audit context**

In the `logAction` call for the application stage, add the new fields to context:

```typescript
// In the logAction call, inside context (only for application stage):
...(stageKey === 'application' && {
  terminalReason: patch.extras?.terminalReason ?? null,
  terminalNotes: patch.extras?.terminalNotes ?? null,
}),
```

- [ ] **Step 4: Verify TypeScript**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```powershell
git add "app/api/sis/students/[enroleeNumber]/stage/[stageKey]/route.ts"
git commit -m "feat(admissions): require terminal reason when cancelling or withdrawing application"
```

---

## Task 6 — `<EnrolmentEditSheet>` UI updates

**Files:**

- Modify: `components/sis/enrolment-edit-sheet.tsx`

This component has 448 lines. Two distinct changes: (A) upgrade withdrawal dialog with required reason `<Select>` and (B) add late-enrollee term display + override picker.

- [ ] **Step 1: Extend imports**

Add to the imports at the top:

```typescript
import {
  WITHDRAWAL_REASON_VALUES,
  WITHDRAWAL_REASON_LABELS,
  type WithdrawalReason,
} from '@/lib/schemas/enrolment';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
```

- [ ] **Step 2: Extend the `initial` prop and internal state**

The `initial` prop currently has `bus_no`, `classroom_officer_role`, `enrollment_status`. Extend it:

```typescript
initial: {
  bus_no: string | null;
  classroom_officer_role: string | null;
  enrollment_status: EnrollmentStatus;
  withdrawal_reason: string | null; // add
  withdrawal_notes: string | null; // add (replaces the old freetext `reason`)
  late_enrollee_term_number: number | null; // add
}
```

Extend the component's internal state (find where `reason` state is declared and rename/add):

```typescript
// Replace existing `const [reason, setReason] = useState(...)` with:
const [withdrawalReason, setWithdrawalReason] = useState<WithdrawalReason | ''>(
  (initial.withdrawal_reason as WithdrawalReason) ?? ''
);
const [withdrawalNotes, setWithdrawalNotes] = useState(
  initial.withdrawal_notes ?? ''
);
const [lateTermOverride, setLateTermOverride] = useState<number | null>(
  initial.late_enrollee_term_number
);
const [showTermOverride, setShowTermOverride] = useState(false);
```

- [ ] **Step 3: Update withdrawal `<AlertDialog>` body (change A)**

Find the withdrawal confirmation `<AlertDialog>` (the one that fires when `enrollment_status` changes to `'withdrawn'`). Its description/body currently has an optional notes textarea. Replace that section with:

```tsx
{
  /* Required reason picker */
}
<div className="space-y-1.5">
  <label className="text-sm font-medium text-foreground">
    Reason <span className="text-destructive">*</span>
  </label>
  <Select
    value={withdrawalReason}
    onValueChange={(v) => setWithdrawalReason(v as WithdrawalReason)}
  >
    <SelectTrigger className="w-full">
      <SelectValue placeholder="Select a reason..." />
    </SelectTrigger>
    <SelectContent>
      {WITHDRAWAL_REASON_VALUES.map((v) => (
        <SelectItem key={v} value={v}>
          {WITHDRAWAL_REASON_LABELS[v]}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>;

{
  /* Optional notes — required when reason is 'other' */
}
<div className="space-y-1.5">
  <label className="text-sm font-medium text-foreground">
    Notes
    {withdrawalReason === 'other' && (
      <span className="text-destructive"> *</span>
    )}
  </label>
  <Textarea
    value={withdrawalNotes}
    onChange={(e) => setWithdrawalNotes(e.target.value)}
    placeholder="Additional context..."
    maxLength={200}
    rows={3}
  />
</div>;
```

Update the Confirm button's `disabled` condition:

```tsx
disabled={
  !withdrawalReason ||
  (withdrawalReason === 'other' && !withdrawalNotes.trim()) ||
  saving
}
```

Update the PATCH body sent on confirm to include the new fields:

```typescript
body: JSON.stringify({
  enrollment_status: 'withdrawn',
  withdrawal_reason: withdrawalReason || null,
  withdrawal_notes: withdrawalNotes.trim() || null,
}),
```

- [ ] **Step 4: Add late-enrollee term display + override (change B)**

Find the section in the rendered JSX where `enrollment_status` label/select is shown. Immediately after the status field, add (conditionally when current status is `late_enrollee`):

```tsx
{
  initial.enrollment_status === 'late_enrollee' && (
    <div className="space-y-1.5">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Joining term
      </p>
      {!showTermOverride ? (
        <div className="flex items-center justify-between rounded-lg border border-hairline px-3 py-2">
          <span className="text-sm text-foreground">
            {lateTermOverride !== null
              ? `T${lateTermOverride} (corrected)`
              : 'Derived from enrolment date'}
          </span>
          <button
            type="button"
            onClick={() => setShowTermOverride(true)}
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Wrong term?
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Select
            value={String(lateTermOverride ?? '')}
            onValueChange={(v) => {
              const n = Number(v);
              setLateTermOverride(n);
              setShowTermOverride(false);
              // Fire immediate PATCH — no confirm needed for a metadata correction.
              void handleTermOverride(n);
            }}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select term..." />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  T{n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => setShowTermOverride(false)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
```

Where `derivedTermLabel` is derived at the top of the component from `initial.enrollment_date` and the existing `lateEnrolleeTerm` response field (if the sheet receives it). For simplicity in v1, default to `initial.late_enrollee_term_number !== null ? 'T' + initial.late_enrollee_term_number : '(derive from enrollment date)'`.

Add the `handleTermOverride` function:

```typescript
async function handleTermOverride(termNumber: number) {
  setSaving(true);
  try {
    const res = await fetch(
      `/api/sections/${sectionId}/students/${enrolmentId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ late_enrollee_term_number: termNumber }),
      }
    );
    if (!res.ok) {
      const e = (await res.json()) as { error?: string };
      toast.error(e.error ?? 'Failed to update joining term');
      setLateTermOverride(initial.late_enrollee_term_number); // revert
    } else {
      toast.success(`Joining term updated to T${termNumber}`);
      router.refresh();
    }
  } finally {
    setSaving(false);
  }
}
```

- [ ] **Step 5: Update all call sites to pass the three new `initial` fields**

Search for every usage of `<EnrolmentEditSheet`:

```powershell
grep -r "EnrolmentEditSheet" app/ components/ --include="*.tsx" -l
```

For each call site, the query that fetches the `section_students` row must `select` the new columns, and the component must receive them in `initial`. The pattern is:

```tsx
<EnrolmentEditSheet
  sectionId={row.section_id}
  enrolmentId={row.id}
  initial={{
    bus_no: row.bus_no,
    classroom_officer_role: row.classroom_officer_role,
    enrollment_status: row.enrollment_status,
    withdrawal_reason: row.withdrawal_reason ?? null, // add
    withdrawal_notes: row.withdrawal_notes ?? null, // add
    late_enrollee_term_number: row.late_enrollee_term_number ?? null, // add
  }}
  studentName={row.studentName}
  indexNumber={row.index_number}
>
  ...
</EnrolmentEditSheet>
```

For each call site, update the Supabase `select()` call to include `withdrawal_reason, withdrawal_notes, late_enrollee_term_number`.

- [ ] **Step 6: Verify TypeScript**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```powershell
git add components/sis/enrolment-edit-sheet.tsx
git commit -m "feat(records): withdrawal reason picker + late-enrollee term correction in EnrolmentEditSheet"
```

---

## Task 7 — `<EditStageDialog>` updates: terminal reason section + mid-term default

**Files:**

- Modify: `components/sis/edit-stage-dialog.tsx`

- [ ] **Step 1: Import new constants and components**

Add to existing imports:

```typescript
import {
  APPLICATION_TERMINAL_REASON_VALUES,
  APPLICATION_TERMINAL_REASON_LABELS,
  APPLICATION_TERMINAL_STATUSES,
  type ApplicationTerminalReason,
} from '@/lib/schemas/sis';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
```

- [ ] **Step 2: Add terminal reason state**

Inside the component function (after existing state declarations), add:

```typescript
const isTerminalStatus = APPLICATION_TERMINAL_STATUSES.includes(
  status as (typeof APPLICATION_TERMINAL_STATUSES)[number]
);

const [terminalReason, setTerminalReason] = useState<
  ApplicationTerminalReason | ''
>('');
const [terminalNotes, setTerminalNotes] = useState('');
```

Reset these when `status` changes away from a terminal value:

```typescript
useEffect(() => {
  if (!isTerminalStatus) {
    setTerminalReason('');
    setTerminalNotes('');
  }
}, [isTerminalStatus]);
```

- [ ] **Step 3: Render the terminal reason section**

Find the form body section that renders remarks / extras. After the existing fields for the `application` stage, add conditionally:

```tsx
{
  stageKey === 'application' && isTerminalStatus && (
    <div className="space-y-4 rounded-lg border border-hairline p-4">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Reason for ending the application
      </p>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">
          Category <span className="text-destructive">*</span>
        </label>
        <Select
          value={terminalReason}
          onValueChange={(v) =>
            setTerminalReason(v as ApplicationTerminalReason)
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a reason..." />
          </SelectTrigger>
          <SelectContent>
            {APPLICATION_TERMINAL_REASON_VALUES.map((v) => (
              <SelectItem key={v} value={v}>
                {APPLICATION_TERMINAL_REASON_LABELS[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">
          Notes
          {terminalReason === 'other' && (
            <span className="text-destructive"> *</span>
          )}
        </label>
        <Textarea
          value={terminalNotes}
          onChange={(e) => setTerminalNotes(e.target.value)}
          placeholder="Optional additional context..."
          maxLength={200}
          rows={2}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Include terminal reason in the PATCH body**

Find the `fetch('/api/sis/students/...')` call in the save handler. Include the new extras:

```typescript
const extrasPayload = {
  ...extras, // existing extras (classAY, classLevel, etc.)
  ...(stageKey === 'application' && isTerminalStatus && {
    terminalReason: terminalReason || undefined,
    terminalNotes: terminalNotes.trim() || undefined,
  }),
};

body: JSON.stringify({
  status,
  remarks,
  extras: extrasPayload,
}),
```

- [ ] **Step 5: Disable Save when terminal reason missing**

Find the Save button's `disabled` prop. Add the terminal reason condition:

```typescript
disabled={
  saving ||
  (stageKey === 'application' && isTerminalStatus && (
    !terminalReason ||
    (terminalReason === 'other' && !terminalNotes.trim())
  ))
}
```

- [ ] **Step 6: Default mid-term checkbox to ticked**

Find the `midTermEnrolment` view section (the pivot view shown after a successful enrolment when `midTermEnrolment` is returned). Currently the checkbox is rendered with `checked={false}` (or uncontrolled). Change the default state to `true`:

```typescript
// Find the useState that controls the late-enrollee checkbox in the mid-term view.
// Change from: const [markAsLate, setMarkAsLate] = useState(false);
// Change to:
const [markAsLate, setMarkAsLate] = useState(true);
```

Update the copy to include a hint:

```tsx
<label className="flex items-start gap-2 text-sm">
  <Checkbox
    checked={markAsLate}
    onCheckedChange={(v) => setMarkAsLate(Boolean(v))}
    className="mt-0.5"
  />
  <span>
    The system detected this student is enrolling in{' '}
    <strong>{midTermEnrolment.termLabel}</strong> — they will be tagged as a
    late enrollee.{' '}
    <span className="text-muted-foreground">
      Untick only if this is not a late enrolment.
    </span>
  </span>
</label>
```

- [ ] **Step 7: Pass the detected term number through the follow-up PATCH**

When the "Confirm" button fires in the mid-term view, it currently sends:

```typescript
{
  enrollment_status: 'late_enrollee';
}
```

Update to include the term number:

```typescript
body: JSON.stringify({
  enrollment_status: 'late_enrollee',
  late_enrollee_term_number: midTermEnrolment.termNumber,
}),
```

- [ ] **Step 8: Verify TypeScript**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9: Commit**

```powershell
git add components/sis/edit-stage-dialog.tsx
git commit -m "feat(admissions): terminal reason section + mid-term late-enrollee prompt defaults ticked"
```

---

## Task 8 — Enrich `WithdrawnEvent` with `reasonLabel` + update movements table

**Files:**

- Modify: `lib/sis/movements.ts`
- Modify: `app/(records)/records/movements/page.tsx` (or its table component if extracted)

- [ ] **Step 1: Import label map in `lib/sis/movements.ts`**

```typescript
import {
  WITHDRAWAL_REASON_LABELS,
  type WithdrawalReason,
} from '@/lib/schemas/enrolment';
```

- [ ] **Step 2: Extend `WithdrawnEvent` type**

In the `MovementEvent` union, find the `withdrawn` variant and add `reasonLabel`:

```typescript
  | {
      id: string;
      kind: 'withdrawn';
      studentNumber: string | null;
      studentName: string;
      enroleeNumber: string;
      level: string;
      ayCode: string;
      termNumber: number | null;
      termLabel: string | null;
      date: string;
      actorEmail: string | null;
      reason: string | null;       // existing freetext (backwards compat with old audit rows)
      reasonLabel: string | null;  // add: resolved label from enum, null for old rows
    }
```

- [ ] **Step 3: Resolve `reasonLabel` in the enrichment pass**

Find where `withdrawn` events are built in `getMovementEvents` (the section that reads `context.reason` from audit rows). After resolving `reason`, add:

```typescript
const reasonRaw = (row.context as Record<string, unknown>)?.withdrawalReason as
  | string
  | null;
const reasonFallback = (row.context as Record<string, unknown>)?.reason as
  | string
  | null;
const resolvedReason = reasonRaw ?? reasonFallback ?? null;

const reasonLabel =
  resolvedReason && resolvedReason in WITHDRAWAL_REASON_LABELS
    ? WITHDRAWAL_REASON_LABELS[resolvedReason as WithdrawalReason]
    : null;
```

Then include in the event object:

```typescript
reason: resolvedReason,
reasonLabel,
```

- [ ] **Step 4: Add Reason column to the movements table**

Find the TanStack columns definition in the movements table component (likely in `app/(records)/records/movements/page.tsx` or a `MovementsTable` component). Add after the existing columns:

```typescript
{
  id: 'reason',
  header: 'Reason',
  cell: ({ row }) => {
    if (row.original.kind !== 'withdrawn') return null;
    const label = (row.original as Extract<MovementEvent, { kind: 'withdrawn' }>).reasonLabel;
    if (!label) return <span className="text-sm text-muted-foreground">—</span>;
    return <span className="text-sm">{label}</span>;
  },
},
```

- [ ] **Step 5: Verify TypeScript**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```powershell
git add lib/sis/movements.ts "app/(records)/records/movements/page.tsx"
git commit -m "feat(records): reasonLabel on WithdrawnEvent + Reason column on movements page"
```

---

## Task 9 — Admissions closed page: reason column + filter chips

**Files:**

- Modify: `app/(admissions)/admissions/applications/closed/page.tsx`

The closed page has 187 lines and currently shows Cancelled/Withdrawn applicants. The AY status table now has `applicationTerminalReason` and `applicationTerminalNotes` after migration 067.

- [ ] **Step 1: Import label map**

```typescript
import {
  APPLICATION_TERMINAL_REASON_LABELS,
  APPLICATION_TERMINAL_REASON_VALUES,
  type ApplicationTerminalReason,
} from '@/lib/schemas/sis';
```

- [ ] **Step 2: Add reason fields to the data query**

Find the Supabase query that fetches `ay{YYYY}_enrolment_status` rows for the closed page. Extend `select()` to include the new columns:

```typescript
.select('..., "applicationTerminalReason", "applicationTerminalNotes"')
```

- [ ] **Step 3: Add reason filter chip state**

The page currently has status-bucket filter chips (All / Cancelled / Withdrawn). Add a reason filter alongside. Since this is an RSC page, the simplest approach is URL-based: add a `?reason=<key>` search param that the loader uses to filter.

In the page's loader, extract:

```typescript
const reasonFilter = (await searchParams).reason as
  | ApplicationTerminalReason
  | undefined;
```

Apply to the query:

```typescript
if (reasonFilter && APPLICATION_TERMINAL_REASON_VALUES.includes(reasonFilter)) {
  q = q.eq('"applicationTerminalReason"', reasonFilter);
}
```

- [ ] **Step 4: Add reason filter chip UI**

Below the existing status-bucket chips, add a second row of reason chips for the 3 most common pre-enrolment reasons:

```tsx
{
  /* Reason quick-filter chips */
}
<div className="flex flex-wrap items-center gap-2">
  <span className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
    Reason
  </span>
  {(['chose_another_school', 'visa_denied', 'financial'] as const).map(
    (key) => (
      <Link
        key={key}
        href={`?${new URLSearchParams({
          ...(statusFilter ? { status: statusFilter } : {}),
          reason: currentReason === key ? '' : key,
        })}`}
        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          currentReason === key
            ? 'bg-foreground text-background'
            : 'bg-muted text-muted-foreground hover:text-foreground'
        }`}
      >
        {APPLICATION_TERMINAL_REASON_LABELS[key]}
      </Link>
    )
  )}
</div>;
```

- [ ] **Step 5: Add Reason column to the TanStack table**

Find the columns array for the closed-page table. Add:

```typescript
{
  id: 'terminalReason',
  header: 'Reason',
  cell: ({ row }) => {
    const raw = row.original.applicationTerminalReason as string | null;
    const label =
      raw && raw in APPLICATION_TERMINAL_REASON_LABELS
        ? APPLICATION_TERMINAL_REASON_LABELS[raw as ApplicationTerminalReason]
        : raw ?? null;
    const notes = row.original.applicationTerminalNotes as string | null;
    if (!label) return <span className="text-sm text-muted-foreground">—</span>;
    return (
      <div>
        <span className="text-sm">{label}</span>
        {notes && (
          <p className="text-xs text-muted-foreground line-clamp-1">{notes}</p>
        )}
      </div>
    );
  },
},
```

- [ ] **Step 6: Verify TypeScript**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```powershell
git add "app/(admissions)/admissions/applications/closed/page.tsx"
git commit -m "feat(admissions): terminal reason column + filter chips on closed applications page"
```

---

## Task 10 — Final build verification

- [ ] **Step 1: Run all tests**

```powershell
npx vitest run
```

Expected: all 77+ tests green (73 existing + 4 new from Task 3).

- [ ] **Step 2: Full TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Production build**

```powershell
npx next build
```

Expected: clean compile, 114 pages (no new routes added).

- [ ] **Step 4: Manual happy path**

1. Open `/sis/admin/settings` → Switch to test environment.
2. **Withdrawal reason**: Open a P6 student in `/sis/sections/[id]` → `<EnrolmentEditSheet>` → set status to `Withdrawn` → confirm dialog requires reason; submit disabled until a category is picked; pick "Family relocating" → toast success. Check `/records/movements` — withdrawn row shows "Family relocating" in the Reason column.
3. **Late-enrollee term correction**: Open a late-enrollee student → `<EnrolmentEditSheet>` → "Joined in T2" row visible → click "Wrong term?" → pick T1 → label updates to "T1 (corrected)". Reload — persisted.
4. **Admissions terminal reason**: Open an applicant → Application stage → `<EditStageDialog>` → set status to `Cancelled` → reason section appears, Save disabled until a category is picked → pick "Chose another school" → save. Check `/admissions/applications/closed` — Reason column shows "Chose another school".
5. **Mid-year enrolment prompt**: Enrol a new applicant (test AY must be past T1 start date) → `<EditStageDialog>` application stage → set to `Enrolled` → mid-term pivot view appears → checkbox is **ticked by default** → confirm. Verify `section_students` row has `enrollment_status='late_enrollee'` AND `late_enrollee_term_number` set to the current term number.
6. **`other` validation**: In either dialog, pick "Other" as reason and attempt to save without notes — Save button stays disabled.

- [ ] **Step 5: Final commit if any cleanup needed**

```powershell
git add -A
git commit -m "chore: enrolment reasons + late-enrollee detection — build verification pass"
```
