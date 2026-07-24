# Badge Colors, T3 Import Categorization, and Attendance Details Columns — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three independent issues: (A) every calendar-category badge renders identically indigo instead of its assigned color, due to a shared component dropping its `color`/`className` props; (B) the AY2026 T3 attendance-import generator hardcoded every calendar event to `audience='all'`, so primary sheets show secondary-only events and vice versa; (C) the attendance Term-sheet's "Details" view gets two new editable, role-gated free-text columns (Academics, Admin) alongside making the existing Bus/Student Care fields editable in place, sharing the exact same `section_students` columns Records already edits.

**Architecture:** (A) is a one-file component fix. (B) is a two-part fix: correct the SQL-generator script's audience-derivation logic, then apply a separate, human-reviewed UPDATE to the 15 already-live AY2026 T3 `calendar_events` rows. (C) adds two nullable `text` columns to `section_students` (siblings to the existing `bus_no`/`classroom_officer_role`), extends the existing enrolment-metadata PATCH route with per-field role gating, and adds one shared editor sheet to the attendance grid (matching the grid's existing "one shared popover" performance invariant) plus the same two fields on the app's other enrolment-edit surfaces (Records/SIS/Markbook) so there's one consistent editor, not a second divergent one.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (service-role client for the route + migration), `@tanstack/react-query` (Tier-2 mutation pattern), zod, Vitest + Testing Library.

## Global Constraints

- **Hard Rule #7 (design tokens only):** no raw hex/oklch/slate/zinc/gray/bg-white/bg-black anywhere touched in this plan. All colors already exist as semantic tokens (`chart-1..5`, `brand-*`, `destructive`, `ink-3/4`, `muted`, `foreground`) — verified in `app/globals.css`.
- **Item C role mapping:** `academics_notes` → `academic_coordinator | school_admin | superadmin`; `admin_notes` → `school_admin | superadmin` only. Both columns are **hidden entirely** (not shown-disabled) from viewers who cannot edit them — a genuine visibility gate, not just an input-disable. Bus/Student Care stays visible to everyone unchanged (read-only unless the viewer can edit it), matching today's behavior.
- **Item C is display/notes only** — no reporting, no audit-visible-to-parents implication, no schema change beyond the two new nullable `text` columns.
- **Item B fix is scoped to `calendar_events` only.** `school_calendar` (day-types) has a structurally similar risky merge in the same generator file but is explicitly **out of scope** per this session's decision — do not touch it.
- **Item B Part (b) (the live production data correction) is NOT to be executed autonomously by an implementer subagent.** It requires a human-reviewed PREVIEW diff before any UPDATE runs against production `calendar_events`. Task 6 below produces the reviewable artifacts only; the controller (not a delegated subagent) runs the actual UPDATE after explicit human sign-off.
- Every task ends with `npx tsc --noEmit` clean and the relevant test(s) passing — do not mark a task done otherwise.

---

### Task 1: Fix ChartLegendChip color/className bug (Item A)

**Files:**

- Modify: `components/dashboard/chart-legend-chip.tsx`
- Test: `__tests__/dashboard/chart-legend-chip.test.tsx`

**Interfaces:**

- No signature change — `ChartLegendChipProps` (`color`, `label`, `count?`, `className?`) is unchanged; only the render body changes. Every existing consumer (`components/attendance/calendar/{legend,calendar-cell,calendar-filter-bar,day-action-sheet}.tsx`, `components/attendance/calendar/views/{list-view,day-view}.tsx`, `components/sis/hub-upcoming-events-card.tsx`, `components/attendance/{sheet-context,wide-grid}.tsx`) needs zero changes — they already pass `color` correctly.

- [ ] **Step 1: Write the failing test**

Create `__tests__/dashboard/chart-legend-chip.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ChartLegendChip } from '@/components/dashboard/chart-legend-chip';

describe('ChartLegendChip', () => {
  it('applies the gradient class for the given color', () => {
    render(<ChartLegendChip color="chart-4" label="School event" />);
    const badge = screen.getByText('School event').closest('div');
    expect(badge?.className).toContain('from-chart-4');
    expect(badge?.className).toContain('to-chart-2');
  });

  it('does not fall back to the default indigo gradient', () => {
    render(<ChartLegendChip color="very-stale" label="Term exam" />);
    const badge = screen.getByText('Term exam').closest('div');
    expect(badge?.className).not.toContain('from-brand-indigo');
  });

  it('forwards a caller className alongside the color gradient', () => {
    render(
      <ChartLegendChip
        color="fresh"
        label="Custom"
        className="hidden sm:inline-flex"
      />
    );
    const badge = screen.getByText('Custom').closest('div');
    expect(badge?.className).toContain('hidden');
    expect(badge?.className).toContain('sm:inline-flex');
    expect(badge?.className).toContain('from-chart-5'); // 'fresh' → chart-5→chart-3
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/dashboard/chart-legend-chip.test.tsx`
Expected: FAIL — the rendered `<Badge>` has no `from-*`/`to-*` classes at all (default variant only), so all three assertions on gradient classes fail (or the "does not contain brand-indigo" one may pass/fail depending on exact match — the two positive-gradient assertions are the load-bearing failures).

- [ ] **Step 3: Apply the fix**

In `components/dashboard/chart-legend-chip.tsx`, add the import and update the render body:

```tsx
import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';
```

```tsx
export function ChartLegendChip({
  color,
  label,
  count,
  className,
}: ChartLegendChipProps) {
  return (
    <Badge className={cn(chipGradientByColor[color], className)}>
      <span>{label}</span>
      {count !== undefined && (
        <span className="font-mono text-[10px] tabular-nums text-white/80">
          {count}
        </span>
      )}
    </Badge>
  );
}
```

(Only the `ChartLegendChip` function body changes — `chipGradientByColor`, `chartLegendContent`, and everything else in the file stays as-is.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/dashboard/chart-legend-chip.test.tsx`
Expected: PASS (3/3)

- [ ] **Step 5: Manual visual verification**

Run `npx next build` (or `npm run dev` and open `/sis/calendar`). Confirm: the Legend card's 9 event-category chips + 5 day-type chips render in visually distinct colors (not all indigo); the SIS hub "Coming up" card's category chips are colored per category and the `hidden sm:inline-flex` responsive behavior works again; the attendance Term-sheet's date-column header tags (PH/SH/SE/EX/HBL) are distinctly colored.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all passing, no regressions (this is a pure additive className fix — no consumer's assertions on chip _text_ content change, only their rendered color, which existing tests likely don't assert on).

- [ ] **Step 7: Commit**

```bash
git add components/dashboard/chart-legend-chip.tsx __tests__/dashboard/chart-legend-chip.test.tsx
git commit -m "fix(dashboard): apply the color/className props ChartLegendChip was silently dropping"
```

---

### Task 2: Schema migration + API route for Academics/Admin notes (Item C, part 1)

**Files:**

- Create: `supabase/migrations/093_section_students_academics_admin_notes.sql`
- Modify: `lib/schemas/enrolment.ts`
- Modify: `app/api/sections/[id]/students/[enrolmentId]/route.ts`
- Test: `__tests__/api/sections-students-enrolment-notes.test.ts` (or extend an existing route test file if one already covers this route — check `__tests__/` for an existing test targeting `app/api/sections/[id]/students/[enrolmentId]/route.ts` first; if found, add cases there instead of a new file)

**Interfaces:**

- Produces: `EnrolmentMetadataSchema` gains `academics_notes?: string | null` and `admin_notes?: string | null` (both `optionalText(200).optional()`, matching the existing `withdrawal_notes` pattern — empty string → `null`, max 200 chars, trimmed).
- Produces: the PATCH route accepts and persists both fields when present, rejecting `admin_notes` with `403 { error, code: 'field_forbidden' }` for any role other than `school_admin`/`superadmin` (the existing route-level `requireRole(['academic_coordinator','school_admin','superadmin'])` union already excludes teachers from everything, including `academics_notes`, so no extra check is needed for that field).
- Consumes (Task 3 and Task 4 depend on this): the two new `section_students` columns and the two new schema fields.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/093_section_students_academics_admin_notes.sql`:

```sql
-- 093_section_students_academics_admin_notes.sql
--
-- Two free-text note columns for the attendance-sheet Details view, siblings
-- to bus_no / classroom_officer_role (migration 015). Display + notes only;
-- no reporting impact. Per-field write gating lives in the PATCH route
-- (app/api/sections/[id]/students/[enrolmentId]/route.ts), not RLS:
--   academics_notes -> academic_coordinator | school_admin | superadmin
--   admin_notes     -> school_admin | superadmin only
--
-- MUST be applied BEFORE deploying the code that selects these columns — the
-- attendance page + enrolment PATCH route reference them. Apply after 092.
-- Safe to re-run (IF NOT EXISTS).

alter table public.section_students
  add column if not exists academics_notes text,
  add column if not exists admin_notes     text;

comment on column public.section_students.academics_notes is
  'Free-text academic notes shown in the attendance sheet Details view. Editable by academic_coordinator / school_admin / superadmin.';
comment on column public.section_students.admin_notes is
  'Free-text admin notes shown in the attendance sheet Details view. Editable by school_admin / superadmin only.';
```

- [ ] **Step 2: Apply the migration**

Apply it via the project's normal migration-apply path (the Supabase SQL console / CLI against the dev database used by this repo — same mechanism every other `supabase/migrations/*.sql` file in this repo is applied with; there is no local migration-runner script in this project). Confirm success by checking `section_students` now has `academics_notes`/`admin_notes` columns (e.g. `select column_name from information_schema.columns where table_name = 'section_students' and column_name in ('academics_notes','admin_notes');` should return both rows).

- [ ] **Step 3: Extend the schema**

In `lib/schemas/enrolment.ts`, add two fields to `EnrolmentMetadataSchema`'s object (alongside `withdrawal_notes`):

```ts
    academics_notes: optionalText(200).optional(),
    admin_notes: optionalText(200).optional(),
```

(No change to `WITHDRAWAL_REASON_MAX` or any other export — these two fields reuse the existing `optionalText` helper with their own literal `200`.)

- [ ] **Step 4: Extend the PATCH route**

In `app/api/sections/[id]/students/[enrolmentId]/route.ts`:

1. Add the two columns to the `before` select (currently `'id, section_id, bus_no, classroom_officer_role, enrollment_status, enrollment_date, withdrawal_date, withdrawal_reason, withdrawal_notes, late_enrollee_term_number'`):

```ts
    .select(
      'id, section_id, bus_no, classroom_officer_role, academics_notes, admin_notes, enrollment_status, enrollment_date, withdrawal_date, withdrawal_reason, withdrawal_notes, late_enrollee_term_number'
    )
```

2. Add the per-field gate immediately after `const parsed = EnrolmentMetadataSchema.safeParse(body); if (!parsed.success) { ... }` succeeds (it needs `parsed.data` to inspect) and BEFORE the `patch` staging block (`if ('bus_no' in parsed.data) ...`), so a forbidden field never reaches the update:

```ts
const isAdminRole = auth.role === 'school_admin' || auth.role === 'superadmin';
if ('admin_notes' in parsed.data && !isAdminRole) {
  return NextResponse.json(
    {
      error: 'admin_notes is editable by school_admin only',
      code: 'field_forbidden',
    },
    { status: 403 }
  );
}
```

`auth` here is the object returned by `requireRole([...])` earlier in the handler (`{ user, role }` — confirmed in `lib/auth/require-role.ts`), so `auth.role` is already in scope; no new variable needs threading in from the top of the function.

3. Stage both fields into `patch` alongside the existing `bus_no`/`classroom_officer_role` staging:

```ts
if ('academics_notes' in parsed.data)
  patch.academics_notes = parsed.data.academics_notes;
if ('admin_notes' in parsed.data) patch.admin_notes = parsed.data.admin_notes;
```

4. Add both fields to the audit-log `before` block (currently only lists `bus_no`, `classroom_officer_role`, `enrollment_status`):

```ts
      before: {
        bus_no: before.bus_no ?? null,
        classroom_officer_role: before.classroom_officer_role ?? null,
        academics_notes: before.academics_notes ?? null,
        admin_notes: before.admin_notes ?? null,
        enrollment_status: before.enrollment_status,
      },
```

(`after: patch` already captures whatever was staged — no change needed there.)

- [ ] **Step 5: Write the test**

Check first whether `__tests__/` already has a file testing this route directly (e.g. search for `students/[enrolmentId]/route` or `buildWithdrawalAdmissionsPatch` imports). If one exists, add these cases to it; otherwise create `__tests__/api/sections-students-enrolment-notes.test.ts` following this repo's established API-route test pattern (mock `requireRole`, mock the Supabase service client, call the route handler directly). At minimum, cover:

- An `academic_coordinator` PATCHing `{ academics_notes: 'Needs extra support in Math' }` succeeds and the value round-trips into the update payload sent to `section_students`.
- An `academic_coordinator` PATCHing `{ admin_notes: 'Fee arrears' }` receives `403` with `code: 'field_forbidden'`, and the Supabase update is never called.
- A `school_admin` PATCHing `{ admin_notes: 'Fee arrears' }` succeeds.
- Empty string for either field is stored as `null` (matches `optionalText`'s `'' → null` transform — this is schema-level behavior; a schema-only unit test suffices if a full route test is heavy to set up: `EnrolmentMetadataSchema.parse({ academics_notes: '' }).academics_notes === null`).

- [ ] **Step 6: Run the tests**

Run: `npx vitest run` (or the targeted new/updated test file first, then the full suite)
Expected: new tests passing, no regressions in the existing enrolment-route test coverage (if any).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/093_section_students_academics_admin_notes.sql lib/schemas/enrolment.ts app/api/sections/\[id\]/students/\[enrolmentId\]/route.ts __tests__/
git commit -m "feat(sis): add academics_notes/admin_notes to section_students with per-field write gating"
```

---

### Task 3: Attendance grid UI — editable, role-visible Bus/Academics/Admin (Item C, part 2)

**Files:**

- Modify: `components/attendance/wide-grid.tsx`
- Create: `components/attendance/enrolment-meta-editor.tsx`
- Modify: `app/(attendance)/attendance/[sectionId]/page.tsx`

**Interfaces:**

- Consumes: `academics_notes`/`admin_notes` columns and the PATCH route's per-field gating from Task 2.
- Produces: `WideGridEnrolment` gains `academicsNotes: string | null; adminNotes: string | null`. `AttendanceWideGrid` gains three new required boolean props: `canEditBusCare`, `canEditAcademics`, `canEditAdmin`.

**Read first, before editing:** `components/attendance/wide-grid.tsx` lines ~129-148 (`WideGridEnrolment` type), ~460-636 (the roster pane: `<colgroup>`, header rows, body rows for the Details columns — note the CURRENT code hardcodes exactly 3 detail columns via `showDetails && (<>...</>)`, with the header `colSpan={showDetails ? 5 : 2}` and a 3-entry `<colgroup>` block (`120`, `90`, `90` widths) — **this plan changes the detail-column COUNT to be conditional per-capability, so the colgroup entry count, the header colSpan, and the body `<TableCell>` count must all move from "always 3 when showDetails" to "1 (Bus/Care, always-on) + (canEditAcademics ? 1 : 0) + (canEditAdmin ? 1 : 0)" and stay in lockstep — a mismatch here breaks column alignment.** Also read `components/attendance/cell-mark-popover.tsx` in full — it's the established "shared popover is pure presentation, the PARENT owns the mutation and passes a callback" pattern (`onPick`) this task's new editor should mirror, rather than a self-contained `useMutation` inside the new component (which would diverge from this file's established architecture).

- [ ] **Step 1: Extend the `WideGridEnrolment` type and compute a dynamic detail-column count**

In `components/attendance/wide-grid.tsx`, add to `WideGridEnrolment`:

```ts
academicsNotes: string | null;
adminNotes: string | null;
```

Add to `AttendanceWideGrid`'s props (alongside `canWriteNc`):

```ts
canEditBusCare: boolean;
canEditAcademics: boolean;
canEditAdmin: boolean;
```

Inside the component body, compute:

```ts
const detailColCount = showDetails
  ? 1 + (canEditAcademics ? 1 : 0) + (canEditAdmin ? 1 : 0)
  : 0;
```

(The Bus/Student Care column is always the "+1" — it stays visible to everyone whenever Details is toggled on; only its EDIT affordance depends on `canEditBusCare`. Academics/Admin columns are entirely present-or-absent based on their own capability flag — this is the "hidden entirely, not shown-disabled" requirement.)

- [ ] **Step 2: Make the colgroup/header/colSpan dynamic**

Replace the hardcoded 3-entry `<colgroup>` detail block:

```tsx
{
  showDetails && <col style={{ width: 120 }} />;
}
{
  showDetails && <col style={{ width: 90 }} />;
}
{
  showDetails && <col style={{ width: 90 }} />;
}
```

with:

```tsx
{
  showDetails && <col style={{ width: 120 }} />;
}
{
  showDetails && canEditAcademics && <col style={{ width: 90 }} />;
}
{
  showDetails && canEditAdmin && <col style={{ width: 90 }} />;
}
```

Replace the "Roster" banner `colSpan={showDetails ? 5 : 2}` with `colSpan={2 + detailColCount}`.

Replace the header-row detail block:

```tsx
                      {showDetails && (
                        <>
                          <TableHead ...>Bus / Student Care</TableHead>
                          <TableHead ...>Academics</TableHead>
                          <TableHead ...>Admin</TableHead>
                        </>
                      )}
```

with:

```tsx
{
  showDetails && (
    <TableHead className="h-auto border-b border-l border-border bg-muted/60 px-2 py-1 text-left font-mono text-[10px] font-semibold text-muted-foreground">
      Bus / Student Care
    </TableHead>
  );
}
{
  showDetails && canEditAcademics && (
    <TableHead className="h-auto border-b border-l border-border bg-muted/60 px-2 py-1 text-left font-mono text-[10px] font-semibold text-muted-foreground">
      Academics
    </TableHead>
  );
}
{
  showDetails && canEditAdmin && (
    <TableHead className="h-auto border-b border-l border-border bg-muted/60 px-2 py-1 text-left font-mono text-[10px] font-semibold text-muted-foreground">
      Admin
    </TableHead>
  );
}
```

- [ ] **Step 3: Make the body cells dynamic and clickable when editable**

Add local state near the other grid state (`activeCell`, etc.):

```ts
const [activeMetaEnrolmentId, setActiveMetaEnrolmentId] = useState<
  string | null
>(null);
```

Replace the hardcoded 3-cell body block:

```tsx
                        {showDetails && (
                          <>
                            <TableCell ...>{busCareLabel(e)}</TableCell>
                            <TableCell ...>—</TableCell>
                            <TableCell ...>—</TableCell>
                          </>
                        )}
```

with (Bus/Care becomes a clickable button when `canEditBusCare`; Academics/Admin cells are only rendered when their capability is true, and are always clickable within that render since presence already implies edit rights):

```tsx
{
  showDetails && (
    <TableCell className="overflow-hidden border-l border-border px-2 py-1 text-[11px] text-foreground">
      {canEditBusCare ? (
        <button
          type="button"
          className="w-full truncate text-left hover:underline"
          onClick={() => setActiveMetaEnrolmentId(e.enrolmentId)}
        >
          {busCareLabel(e)}
        </button>
      ) : (
        busCareLabel(e)
      )}
    </TableCell>
  );
}
{
  showDetails && canEditAcademics && (
    <TableCell className="border-l border-border px-2 py-1 text-[11px] text-foreground">
      <button
        type="button"
        className="w-full truncate text-left hover:underline"
        onClick={() => setActiveMetaEnrolmentId(e.enrolmentId)}
      >
        {e.academicsNotes ?? '—'}
      </button>
    </TableCell>
  );
}
{
  showDetails && canEditAdmin && (
    <TableCell className="border-l border-border px-2 py-1 text-[11px] text-foreground">
      <button
        type="button"
        className="w-full truncate text-left hover:underline"
        onClick={() => setActiveMetaEnrolmentId(e.enrolmentId)}
      >
        {e.adminNotes ?? '—'}
      </button>
    </TableCell>
  );
}
```

- [ ] **Step 4: Add the shared editor Sheet + its mutation**

Near the grid's other `useMutation` (the attendance-cell write mutation), add a sibling mutation for enrolment metadata:

```ts
const metaMutation = useMutation({
  mutationFn: (vars: {
    enrolmentId: string;
    patch: Record<string, string | null>;
  }) =>
    apiFetch(
      `/api/sections/${sectionId}/students/${vars.enrolmentId}`,
      jsonInit('PATCH', vars.patch)
    ),
  onSuccess: () => {
    toast.success('Saved.');
    router.refresh();
    setActiveMetaEnrolmentId(null);
  },
  onError: (e) => {
    toast.error(e instanceof Error ? e.message : 'Could not save.');
  },
});
```

`useMutation` (from `@tanstack/react-query`), `apiFetch`/`jsonInit` (from `@/lib/query/fetcher`), and `toast` (from `sonner`) are already imported in this file (used by the existing cell-write mutation) — reuse those imports as-is. `useRouter` is **not** currently imported in `wide-grid.tsx` (the cell-write mutation deliberately skips `router.refresh()` for performance — see the file's header comment on render-perf invariants — but that concern is about the HIGH-FREQUENCY cell-marking action, not this LOW-FREQUENCY metadata edit, so `router.refresh()` here is fine and consistent with how `enrolments`/`calendar` are documented to update). Add `import { useRouter } from 'next/navigation';` fresh, and call `const router = useRouter();` near the component's other hooks.

Mount ONE shared `<Sheet>` at the grid root (sibling to the existing shared `<Popover>` for cell-marking — same "one portal for the whole grid" principle), open when `activeMetaEnrolmentId != null`:

```tsx
<Sheet
  open={activeMetaEnrolmentId != null}
  onOpenChange={(o) => {
    if (!o) setActiveMetaEnrolmentId(null);
  }}
>
  {activeMetaEnrolmentId && (
    <EnrolmentMetaEditor
      enrolment={
        enrolments.find((e) => e.enrolmentId === activeMetaEnrolmentId)!
      }
      canEditBusCare={canEditBusCare}
      canEditAcademics={canEditAcademics}
      canEditAdmin={canEditAdmin}
      saving={metaMutation.isPending}
      onSave={(patch) =>
        metaMutation.mutate({ enrolmentId: activeMetaEnrolmentId, patch })
      }
    />
  )}
</Sheet>
```

- [ ] **Step 5: Create the presentational editor component**

Create `components/attendance/enrolment-meta-editor.tsx` (sibling to `cell-mark-popover.tsx`, same "pure presentation, parent owns the mutation" pattern — no `useMutation` inside this file):

```tsx
'use client';

import { useState } from 'react';

import {
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { WideGridEnrolment } from '@/components/attendance/wide-grid';

// Shared editor for the attendance sheet's Details-view roster metadata.
// One instance mounted per grid (single portal, matches the cell-mark
// popover's perf invariant) — this file is pure presentation; the parent
// (wide-grid.tsx) owns the PATCH mutation and passes it in via `onSave`.
// Each field's visibility is gated by its own capability boolean — Academics
// and Admin are omitted entirely (not disabled) for a viewer who can't edit
// them, matching this feature's "hidden, not shown-disabled" requirement.
export function EnrolmentMetaEditor({
  enrolment,
  canEditBusCare,
  canEditAcademics,
  canEditAdmin,
  saving,
  onSave,
}: {
  enrolment: WideGridEnrolment;
  canEditBusCare: boolean;
  canEditAcademics: boolean;
  canEditAdmin: boolean;
  saving: boolean;
  onSave: (patch: Record<string, string | null>) => void;
}) {
  const [busNo, setBusNo] = useState(enrolment.busNo ?? '');
  const [officerRole, setOfficerRole] = useState(
    enrolment.classroomOfficerRole ?? ''
  );
  const [academicsNotes, setAcademicsNotes] = useState(
    enrolment.academicsNotes ?? ''
  );
  const [adminNotes, setAdminNotes] = useState(enrolment.adminNotes ?? '');

  function handleSave() {
    const patch: Record<string, string | null> = {};
    if (canEditBusCare) {
      patch.bus_no = busNo.trim() || null;
      patch.classroom_officer_role = officerRole.trim() || null;
    }
    if (canEditAcademics) patch.academics_notes = academicsNotes.trim() || null;
    if (canEditAdmin) patch.admin_notes = adminNotes.trim() || null;
    onSave(patch);
  }

  return (
    <SheetContent className="flex flex-col gap-4">
      <SheetHeader>
        <SheetTitle>{enrolment.studentName}</SheetTitle>
      </SheetHeader>
      <div className="flex flex-col gap-4 px-4">
        {canEditBusCare && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="meta-bus-no">Bus number</Label>
              <Input
                id="meta-bus-no"
                value={busNo}
                maxLength={40}
                onChange={(e) => setBusNo(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meta-officer-role">Classroom officer role</Label>
              <Input
                id="meta-officer-role"
                value={officerRole}
                maxLength={80}
                onChange={(e) => setOfficerRole(e.target.value)}
              />
            </div>
          </>
        )}
        {canEditAcademics && (
          <div className="space-y-1.5">
            <Label htmlFor="meta-academics-notes">Academics notes</Label>
            <Textarea
              id="meta-academics-notes"
              value={academicsNotes}
              maxLength={200}
              onChange={(e) => setAcademicsNotes(e.target.value)}
            />
          </div>
        )}
        {canEditAdmin && (
          <div className="space-y-1.5">
            <Label htmlFor="meta-admin-notes">Admin notes</Label>
            <Textarea
              id="meta-admin-notes"
              value={adminNotes}
              maxLength={200}
              onChange={(e) => setAdminNotes(e.target.value)}
            />
          </div>
        )}
      </div>
      <SheetFooter>
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </SheetFooter>
    </SheetContent>
  );
}
```

(Verify `components/ui/sheet.tsx`, `components/ui/textarea.tsx`, `components/ui/label.tsx` exist with these exact exports before writing this file — they're standard shadcn primitives already used elsewhere in this codebase, e.g. `enrolment-edit-sheet.tsx` for `Sheet`/`Label`; confirm `Textarea` separately since notes fields are new to this specific form.)

- [ ] **Step 6: Wire the attendance page**

In `app/(attendance)/attendance/[sectionId]/page.tsx`:

1. Extend the `section_students` select (currently `'id, index_number, enrollment_status, enrollment_date, bus_no, classroom_officer_role, student:students(...)'`) to include `academics_notes, admin_notes`.
2. Add both fields to the row-shape type used for that select.
3. Map them into each `WideGridEnrolment`:

```ts
      academicsNotes: e.academics_notes,
      adminNotes: e.admin_notes,
```

4. Compute the three capability booleans from the already-resolved `role` (same variable `canWriteNc` is derived from):

```ts
const canEditBusCare =
  role === 'academic_coordinator' ||
  role === 'school_admin' ||
  role === 'superadmin';
const canEditAcademics = canEditBusCare; // same gate as bus_no/classroom_officer_role
const canEditAdmin = role === 'school_admin' || role === 'superadmin';
```

5. Pass all three to `<AttendanceWideGrid ... canWriteNc={canWriteNc} canEditBusCare={canEditBusCare} canEditAcademics={canEditAcademics} canEditAdmin={canEditAdmin} />`.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Manual verification (no automated test for this step — dense grid UI, verify by hand per the plan's role matrix)**

As `school_admin`: open a section's attendance sheet → Show details → Admin column visible, click any Bus/Academics/Admin cell → sheet opens with all four fields → edit + Save → cell text updates after `router.refresh()`.
As `academic_coordinator`: Admin column is **absent** from the header row and body rows entirely (column count is 2 total detail columns, not 3) — confirm via browser inspection that no "Admin" header exists, not just that it's disabled.
As `teacher`: Academics and Admin columns absent; Bus/Student Care cell renders as plain text (no click affordance, matches today's behavior).

- [ ] **Step 9: Run the full test suite + build**

Run: `npx vitest run` then `npx next build`
Expected: both clean, no regressions.

- [ ] **Step 10: Commit**

```bash
git add components/attendance/wide-grid.tsx components/attendance/enrolment-meta-editor.tsx "app/(attendance)/attendance/[sectionId]/page.tsx"
git commit -m "feat(attendance): editable, role-gated Bus/Academics/Admin columns in the sheet Details view"
```

---

### Task 4: Extend Records/SIS/Markbook's shared enrolment-edit sheet (Item C, part 3)

**Files:**

- Modify: `components/sis/enrolment-edit-sheet.tsx`
- Modify: `components/markbook/enrolment-edit-sheet.tsx`
- Modify: `components/sis/placement-edit-button.tsx`
- Modify: `components/sis/section-roster-table.tsx`

**Interfaces:**

- Consumes: the same `academics_notes`/`admin_notes` fields + PATCH route from Task 2.
- Produces: no new exported interface — both sheets gain two more form fields in their existing `initial`/save-body shape.

- [ ] **Step 1: Read both sheet files fully**

`components/sis/enrolment-edit-sheet.tsx` and `components/markbook/enrolment-edit-sheet.tsx` are near-duplicates (per this session's Item C investigation). Confirm the exact `initial` prop shape, the Bus Number input's existing pattern (around the line noted in this session's investigation as ~360-367 in the `sis` copy), and the `doSave`/mutation body construction, in BOTH files before editing either — they must stay structurally parallel.

- [ ] **Step 2: Add the two fields to both sheets**

In each file: add `academics_notes: string | null` and `admin_notes: string | null` to the `initial` prop type; add two new form inputs (a `Textarea`, matching Task 3's field choice, `maxLength={200}`) following the exact layout/spacing convention the existing Bus Number field uses in that file; include both fields in the PATCH body construction (`doSave`/`saveMutation`) using the same `'' → null` pattern already used for the existing text fields in that file (do not send the field at all if unchanged — check whether the existing pattern sends all fields unconditionally or only changed ones, and match it exactly for consistency within each file).

**Do not add role-based show/hide logic inside these sheets** — Task 2's 403 on `admin_notes` is the actual enforcement backstop, and these sheets' callers (Records/SIS) are already registrar+ gated pages, unlike the attendance grid which spans teacher/academic_coordinator/school_admin viewers. (If a future caller of these sheets needs per-field visibility, that's a separate follow-up — out of scope here.)

- [ ] **Step 3: Update the callers**

`components/sis/placement-edit-button.tsx` and `components/sis/section-roster-table.tsx` both construct the `initial` prop passed into `EnrolmentEditSheet` — extend whatever data-fetch/prop each already performs to also pass `academics_notes`/`admin_notes` through (they should already have `section_students` row data in scope; add the two columns to any select they perform, or thread them from an existing parent fetch if the values are already available higher up the tree — read each file to determine which applies).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Manual verification**

From Records → a student's detail page → placement/enrolment edit → confirm both new fields are present, editable, and save correctly (round-trips with what Task 3's attendance-sheet editor shows for the same student). Same check from the SIS section roster table's edit entry point.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: no regressions.

- [ ] **Step 7: Commit**

```bash
git add components/sis/enrolment-edit-sheet.tsx components/markbook/enrolment-edit-sheet.tsx components/sis/placement-edit-button.tsx components/sis/section-roster-table.tsx
git commit -m "feat(sis): surface academics/admin notes on the shared enrolment-edit sheet"
```

---

### Task 5: Fix the AY2026 T3 import generator's audience derivation (Item B, part a)

**Files:**

- Modify: `lib/sis/backfill/attendance/build-attendance-import-t3.ts`
- Test: `__tests__/sis/backfill/build-attendance-import-t3-audience.test.ts` (new — targets the pure audience-derivation logic in isolation; do not attempt to test the whole file's Excel-parsing pipeline)

**Interfaces:**

- Produces: an `audienceFor(isoDate, category)` function (or equivalent) usable by `buildApplyFiles`'s `calendar_events` row construction, resolving to `'all' | 'primary' | 'secondary'`.
- Consumes: `LEVEL_TYPE_BY_CODE` from `lib/sis/levels.ts` (existing export — read that file first to confirm the exact export name/shape before importing it).

**Read first:** the full `lib/sis/backfill/attendance/build-attendance-import-t3.ts` file — specifically the `coreSections` construction (~lines 139-155, confirm each entry carries a `levelCode` and a `parsed.dateTags` map keyed by raw date strings), the `tagByDate`/`legendLabelByDate` merge (~lines 156-182), and the `calendar_events` block inside `buildApplyFiles` (~lines 442-500, confirm the exact current hardcoded `'all'` literal and the surrounding VALUES-row/insert-statement construction so the new `audience` column threads through correctly). Also read `lib/sis/levels.ts` for the exact `LEVEL_TYPE_BY_CODE` export.

- [ ] **Step 1: Write the failing test for the pure derivation logic**

Since `audienceFor` depends on data shapes internal to this file, either (a) export `audienceFor` (and the `eventLevelTypes` builder, or a combined pure function taking `coreSections`-shaped input) so it's independently testable, or (b) extract the derivation into a small new pure module (e.g. `lib/sis/backfill/attendance/event-audience.ts`) that both the generator and the test import. Prefer (b) — cleaner isolation, matches this codebase's general preference for small testable pure modules. Create:

`lib/sis/backfill/attendance/event-audience.ts`:

```ts
import { LEVEL_TYPE_BY_CODE, type LevelCode } from '../../levels';

export type EventCategory = 'term_exam' | 'school_event';
export type Audience = 'all' | 'primary' | 'secondary';

export type SectionDateTag = {
  levelCode: LevelCode;
  dateTagsByRawDate: Record<string, string | undefined>;
};

const TAG_TO_CATEGORY: Record<string, EventCategory> = {
  EX: 'term_exam',
  SE: 'school_event',
};

/**
 * For each date+category, determine which level TYPES (primary/secondary)
 * actually carried that tag across the parsed section sheets, then resolve:
 * both types present -> 'all'; only primary -> 'primary'; only secondary ->
 * 'secondary'; neither locatable -> 'all' (defensive fallback).
 */
export function buildEventAudienceMap(
  sections: SectionDateTag[],
  datesByRaw: Record<string, string> // rawDate -> isoDate
): Map<string, Audience> {
  const levelTypesByKey = new Map<string, Set<'primary' | 'secondary'>>();
  for (const [rawDate, isoDate] of Object.entries(datesByRaw)) {
    for (const section of sections) {
      const tag = (section.dateTagsByRawDate[rawDate] ?? '').trim();
      const category = TAG_TO_CATEGORY[tag];
      if (!category) continue;
      const lt = LEVEL_TYPE_BY_CODE[section.levelCode];
      if (lt !== 'primary' && lt !== 'secondary') continue;
      const key = `${isoDate}::${category}`;
      const set =
        levelTypesByKey.get(key) ?? new Set<'primary' | 'secondary'>();
      set.add(lt);
      levelTypesByKey.set(key, set);
    }
  }
  const resolved = new Map<string, Audience>();
  for (const [key, types] of levelTypesByKey) {
    const hasP = types.has('primary');
    const hasS = types.has('secondary');
    resolved.set(key, hasP && hasS ? 'all' : hasP ? 'primary' : 'secondary');
  }
  return resolved;
}

export function audienceFor(
  map: Map<string, Audience>,
  isoDate: string,
  category: EventCategory
): Audience {
  return map.get(`${isoDate}::${category}`) ?? 'all';
}
```

Create `__tests__/sis/backfill/build-attendance-import-t3-audience.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildEventAudienceMap,
  audienceFor,
} from '@/lib/sis/backfill/attendance/event-audience';

describe('buildEventAudienceMap / audienceFor', () => {
  const datesByRaw = { '20-Aug': '2026-08-20', '13-Jul': '2026-07-13' };

  it('resolves to secondary when only secondary sections carry the tag', () => {
    const map = buildEventAudienceMap(
      [
        { levelCode: 'S1', dateTagsByRawDate: { '20-Aug': 'EX' } },
        { levelCode: 'P3', dateTagsByRawDate: {} },
      ],
      datesByRaw
    );
    expect(audienceFor(map, '2026-08-20', 'term_exam')).toBe('secondary');
  });

  it('resolves to primary when only primary sections carry the tag', () => {
    const map = buildEventAudienceMap(
      [{ levelCode: 'P3', dateTagsByRawDate: { '20-Aug': 'EX' } }],
      datesByRaw
    );
    expect(audienceFor(map, '2026-08-20', 'term_exam')).toBe('primary');
  });

  it("resolves to 'all' when both level types carry the same tag", () => {
    const map = buildEventAudienceMap(
      [
        { levelCode: 'P3', dateTagsByRawDate: { '13-Jul': 'SE' } },
        { levelCode: 'S2', dateTagsByRawDate: { '13-Jul': 'SE' } },
      ],
      datesByRaw
    );
    expect(audienceFor(map, '2026-07-13', 'school_event')).toBe('all');
  });

  it("defaults to 'all' for a date/category with no locatable tag owner", () => {
    const map = buildEventAudienceMap([], datesByRaw);
    expect(audienceFor(map, '2026-08-20', 'term_exam')).toBe('all');
  });

  it('keeps two categories on the same date independent', () => {
    const map = buildEventAudienceMap(
      [
        { levelCode: 'P3', dateTagsByRawDate: { '20-Aug': 'SE' } },
        { levelCode: 'S1', dateTagsByRawDate: { '20-Aug': 'EX' } },
      ],
      datesByRaw
    );
    expect(audienceFor(map, '2026-08-20', 'school_event')).toBe('primary');
    expect(audienceFor(map, '2026-08-20', 'term_exam')).toBe('secondary');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/sis/backfill/build-attendance-import-t3-audience.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Create the module and verify it passes**

Create `lib/sis/backfill/attendance/event-audience.ts` with the exact content from Step 1 (adjust the relative import path `../../levels` to whatever's correct from that file's actual location — verify against `lib/sis/levels.ts`'s real path).

Run: `npx vitest run __tests__/sis/backfill/build-attendance-import-t3-audience.test.ts`
Expected: PASS (5/5).

- [ ] **Step 4: Wire it into `build-attendance-import-t3.ts`**

1. Import: `import { buildEventAudienceMap, audienceFor } from './event-audience';` (adjust path to match this file's actual location relative to the new module).
2. After `coreSections` is built, construct the `datesByRaw` map (rawDate → isoDate) from whatever array already holds this correspondence in the file (`allDatesRaw`/`allDatesISO` or equivalent — confirm exact variable names from the Step-0 read), and each section's `{ levelCode, dateTagsByRawDate: parsed.dateTags }`:

```ts
const eventAudienceMap = buildEventAudienceMap(
  coreSections.map((s) => ({
    levelCode: s.levelCode,
    dateTagsByRawDate: s.parsed.dateTags,
  })),
  datesByRaw
);
```

3. In the `calendar_events` row-building logic inside `buildApplyFiles` (~line 442-500), replace the hardcoded `'all'` with `audienceFor(eventAudienceMap, isoDate, category)` for each event row, and thread an `audience` column through both the temp-table VALUES list and the final `insert into calendar_events (..., audience, ...) select ..., e.audience, ...` statement.
4. **Do not** add `audience` to the existing `not exists` idempotency guard (keyed on `term_id, start_date, end_date, category`) — leave that guard exactly as-is. This is deliberate: adding audience to the guard would let a future re-run insert a duplicate row when live data's audience differs from a freshly-computed value.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all passing, including the new audience tests.

- [ ] **Step 7: Do NOT run the generator against the real workbook or apply anything to production in this task** — that's Task 6, and it requires explicit human sign-off. This task only fixes the code so that a _future_ run (Task 6's Step 1) produces correct output.

- [ ] **Step 8: Commit**

```bash
git add lib/sis/backfill/attendance/build-attendance-import-t3.ts lib/sis/backfill/attendance/event-audience.ts __tests__/sis/backfill/build-attendance-import-t3-audience.test.ts
git commit -m "fix(backfill): derive calendar_events audience from per-section level instead of hardcoding 'all'"
```

---

### Task 6: Correct the live AY2026 T3 `calendar_events` rows (Item B, part b)

**⚠️ This task is NOT for a delegated implementer subagent to run autonomously.** It touches live production data (`calendar_events` for the current operational academic year) and has an explicit human sign-off gate. If executing this plan via subagent-driven-development, the controller (main session, with Mr Ace) performs this task directly — do not dispatch it as a normal implementer task.

**Files:**

- Run (not commit as code, but the generator's own output file, already tracked): `scripts/backfill/ay2026-t3-attendance-apply/02-events.sql` (regenerated)
- Create: `scripts/backfill/ay2026-t3-events-audience-fix.sql`

- [ ] **Step 1: Regenerate the corrected output**

Run: `npx tsx --env-file=.env.local scripts/backfill/gen-ay2026-t3-attendance.ts`

This reads the real `AY2026/T3/...xlsx` workbook and, with Task 5's fix applied, regenerates `scripts/backfill/ay2026-t3-attendance-apply/02-events.sql` with correct per-event `audience` values. This step performs **no database writes** — it's a pure file-generation script (confirmed in this session's investigation).

- [ ] **Step 2: Extract the corrected (date, category, audience) triples**

Read the regenerated `02-events.sql` and list all 15 events' `(start_date, category, audience)` triples.

- [ ] **Step 3: Write the correction script**

Create `scripts/backfill/ay2026-t3-events-audience-fix.sql`:

```sql
-- ay2026-t3-events-audience-fix.sql
--
-- Corrects the 15 AY2026 T3 calendar_events rows that were originally
-- imported with audience hardcoded to 'all' (fixed at the source in
-- lib/sis/backfill/attendance/build-attendance-import-t3.ts). UPDATE-only —
-- touches no other column, no other row. Run the PREVIEW select first and
-- review the diff before running the UPDATE.

begin;

with tgt as (
  select t.id as term_id
  from terms t
  join academic_years ay on ay.id = t.academic_year_id
  where ay.ay_code = 'AY2026' and t.term_number = 3
),
corrected(start_date, category, audience) as (values
  -- <all 15 rows go here, transcribed verbatim from the regenerated
  --  02-events.sql, e.g.:>
  (date '2026-08-20', 'term_exam', 'secondary')
  -- ...
)
-- PREVIEW — run this SELECT ALONE first:
select ce.start_date, ce.category, ce.label,
       ce.audience as current_audience, c.audience as new_audience
from calendar_events ce
join tgt on tgt.term_id = ce.term_id
join corrected c
  on c.start_date = ce.start_date and ce.end_date = ce.start_date
 and c.category = ce.category
where ce.audience <> c.audience
order by ce.start_date;

-- Then, ONLY after reviewing the preview output, run:
-- update calendar_events ce
-- set audience = c.audience
-- from tgt, corrected c
-- where ce.term_id = tgt.term_id
--   and ce.start_date = c.start_date and ce.end_date = c.start_date
--   and ce.category = c.category
--   and ce.audience <> c.audience;

commit;
```

Note the UPDATE is commented out in the checked-in file — this is intentional. The controller uncomments and runs it manually, once, after the preview has been reviewed.

- [ ] **Step 4: Run the PREVIEW select only**

Execute just the `with ... select ...` portion (everything before the commented-out `update`) via the service-role SQL console (same access path as every other file under `scripts/backfill/` — `calendar_events` RLS blocks authenticated writes, per this codebase's deny-writes policy).

**Report the full preview output to Mr Ace before proceeding** — every row's `start_date`, `category`, `label`, `current_audience`, `new_audience`. This is the human sign-off gate.

- [ ] **Step 5: Run the UPDATE only after explicit go-ahead**

Once Mr Ace confirms the preview diff looks correct, uncomment and run the `update` statement (still inside the same `begin`/`commit` transaction). Re-run the PREVIEW select afterward — expect 0 rows.

- [ ] **Step 6: Functional verification**

Open a **primary** section's AY2026 T3 attendance sheet and a **secondary** section's side by side. Confirm secondary-only exam/event dates no longer appear on the primary sheet's date columns, and vice versa.

- [ ] **Step 7: Commit the correction script (the SQL file, not a code change)**

```bash
git add scripts/backfill/ay2026-t3-events-audience-fix.sql
git commit -m "fix(backfill): correct AY2026 T3 calendar_events audience for 15 miscategorized rows"
```

(The regenerated `scripts/backfill/ay2026-t3-attendance-apply/02-events.sql` is also now correct for any future from-scratch environment rebuild — commit it too if it changed.)

---

## Notes

- Tasks 1 and 5 have no dependency on each other or on Tasks 2-4 — can run in any order, or in parallel via separate subagents.
- Tasks 2 → 3 → 4 are sequential (3 and 4 both depend on Task 2's schema/route; 4 doesn't depend on 3, so 3 and 4 could run in parallel once Task 2 is done).
- Task 6 depends on Task 5 (needs the fixed generator) and must be run last, directly by the controller with Mr Ace, never delegated.
