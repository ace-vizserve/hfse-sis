# Staff Page — Family Cards, Consolidated Row Actions, Assignments Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Accounts cut of `/sis/admin/staff` (`?view=accounts`), add (1) a 3-family (Academics / Admissions & Enrollment / Admin) headcount card row, (2) an Assignments column showing FCA/subject chips for teacher rows, and (3) consolidate the two separate row-action buttons (Edit, Disable/Enable) into a single `⋯` dropdown menu that also gains a "Manage teaching assignments" item for teacher rows and a disabled "Delete" placeholder. Approved via an interactive HTML mockup this session (artifact `0cfc78c0-5dd3-4723-8273-83480c7e63f3`).

**Architecture:** Two tasks. Task 1 is additive-only to the page RSC (`app/(sis)/sis/admin/staff/page.tsx`) — a pure counting helper + a new card grid, rendered only on the Accounts view, using the exact `Card`/`CardHeader`/`CardDescription`/`CardTitle`/`CardAction` idiom the page's own existing Assignments-tab KPI cards already use. Task 2 extends the same page's data-fetch to also load `loadStaffAssignments(ayCode)` (already exists, already cached, already used by the Assignments tab — no new query) and passes it into `StaffAccountsClient`, which gains an Assignments column (reusing the existing `AssignmentChips` component verbatim) and replaces its two separate action buttons with the shared `RowActionsMenu` + `DropdownMenuItem` primitives already used by several other tables in this codebase (e.g. `discount-code-row-actions.tsx`).

**Tech Stack:** Next.js 16 App Router (RSC + client components), `@tanstack/react-table` via the shared `DataTable` shell, shadcn `DropdownMenu`/`Card`, TanStack Query mutations, Vitest.

## Global Constraints

- Zero change to any existing permission gate. `canManage` (superadmin-only) continues to gate Edit User / Disable-Enable / Delete exactly as it does today.
- "Manage teaching assignments" is gated differently — available to whoever can reach the Accounts view at all (`school_admin` and `superadmin`; `academic_coordinator` never reaches this view per the page's own `canSeeAccounts` check), matching `POST /api/teacher-assignments`'s real role gate (`academic_coordinator | school_admin | superadmin`), NOT the narrower `canManage`.
- "Delete" is a visual placeholder only — disabled, with an explanatory title/tooltip. Do not wire it to any route; no such route exists.
- Family cards, the Assignments column, and its menu item appear **only on the Accounts view** (`view === 'accounts'`). The Assignments tab (`view === 'assignments'`) is untouched.
- Reuse existing components verbatim where they exist: `AssignmentChips` (`components/sis/staff-visuals.tsx`), `StaffAssignmentSheet` (`components/sis/staff-assignment-sheet.tsx`), `RowActionsMenu` (`components/ui/data-table`), `loadStaffAssignments` (`lib/sis/staff.ts`). Do not fork or duplicate them.
- Design system compliance (Hard Rule #7): no raw hex/oklch/slate/zinc/gray/bg-white/bg-black; gradient icon tiles use `from-brand-indigo to-brand-navy shadow-brand-tile` (matching every other icon tile already on this page); shadcn primitives only, no raw `<select>`/`<button>` dropdowns.

---

### Task 1: Family-grouped account cards on the Accounts view

**Files:**

- Create: `lib/sis/staff-families.ts`
- Modify: `app/(sis)/sis/admin/staff/page.tsx`

**Interfaces:**

- Consumes: `accounts: AdminUserRow[]` (already fetched at line ~88 when `view === 'accounts'`; `AdminUserRow.role: Role | null` per `lib/sis/users/queries.ts`).
- Produces: `computeStaffFamilies(accounts: { role: Role | null }[]): StaffFamily[]` — a pure function, exported from `lib/sis/staff-families.ts` (not from the page file — this codebase's established pattern keeps pure logic testable in `lib/`, page files import it). Not consumed by later tasks; this task is self-contained.

- [ ] **Step 1: Add a pure family-count helper**

Create `lib/sis/staff-families.ts`:

```ts
import type { Role } from '@/lib/auth/roles';

export type StaffFamily = {
  key: string;
  label: string;
  total: number;
  roles: { role: Role; label: string; count: number }[];
};

// Display-only grouping (KD #155) — not a schema/access concept. Each role
// appears in exactly one family; order within a family matches ROLES'
// declaration order in lib/auth/roles.ts.
export function computeStaffFamilies(
  accounts: { role: Role | null }[]
): StaffFamily[] {
  const countByRole = new Map<Role, number>();
  for (const a of accounts) {
    if (!a.role) continue;
    countByRole.set(a.role, (countByRole.get(a.role) ?? 0) + 1);
  }

  const families: StaffFamily[] = [
    {
      key: 'academics',
      label: 'Academics',
      total: 0,
      roles: [
        { role: 'teacher', label: 'Teacher', count: 0 },
        {
          role: 'academic_coordinator',
          label: 'Academic Coordinator',
          count: 0,
        },
      ],
    },
    {
      key: 'admissions-enrollment',
      label: 'Admissions & Enrollment',
      total: 0,
      roles: [
        { role: 'admissions', label: 'Admissions', count: 0 },
        { role: 'p_file_officer', label: 'P-File Officer', count: 0 },
      ],
    },
    {
      key: 'admin',
      label: 'Admin',
      total: 0,
      roles: [
        { role: 'school_admin', label: 'School Admin', count: 0 },
        { role: 'superadmin', label: 'Superadmin', count: 0 },
      ],
    },
  ];

  for (const family of families) {
    for (const r of family.roles) {
      r.count = countByRole.get(r.role) ?? 0;
      family.total += r.count;
    }
  }

  return families;
}
```

- [ ] **Step 2: Write a unit test for the helper**

Create `__tests__/sis/staff-families.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

import { computeStaffFamilies } from '@/lib/sis/staff-families';
import type { Role } from '@/lib/auth/roles';

describe('computeStaffFamilies', () => {
  it('groups all 6 roles into exactly 3 families with correct counts', () => {
    const accounts: { role: Role | null }[] = [
      { role: 'teacher' },
      { role: 'teacher' },
      { role: 'academic_coordinator' },
      { role: 'admissions' },
      { role: 'p_file_officer' },
      { role: 'school_admin' },
      { role: 'school_admin' },
      { role: 'superadmin' },
    ];

    const families = computeStaffFamilies(accounts);

    expect(families).toHaveLength(3);

    const academics = families.find((f) => f.key === 'academics')!;
    expect(academics.total).toBe(3);
    expect(academics.roles.find((r) => r.role === 'teacher')!.count).toBe(2);
    expect(
      academics.roles.find((r) => r.role === 'academic_coordinator')!.count
    ).toBe(1);

    const admissionsEnrollment = families.find(
      (f) => f.key === 'admissions-enrollment'
    )!;
    expect(admissionsEnrollment.total).toBe(2);

    const admin = families.find((f) => f.key === 'admin')!;
    expect(admin.total).toBe(3);
    expect(admin.roles.find((r) => r.role === 'school_admin')!.count).toBe(2);
    expect(admin.roles.find((r) => r.role === 'superadmin')!.count).toBe(1);
  });

  it('ignores accounts with a null role', () => {
    const accounts: { role: Role | null }[] = [
      { role: null },
      { role: 'teacher' },
    ];
    const families = computeStaffFamilies(accounts);
    const total = families.reduce((sum, f) => sum + f.total, 0);
    expect(total).toBe(1);
  });

  it('returns zero counts for an empty roster', () => {
    const families = computeStaffFamilies([]);
    expect(families.every((f) => f.total === 0)).toBe(true);
    expect(families.every((f) => f.roles.every((r) => r.count === 0))).toBe(
      true
    );
  });
});
```

- [ ] **Step 3: Run the test and verify it passes**

```bash
npx vitest run __tests__/sis/staff-families.test.ts
```

Expected: PASS (3/3) — the helper (Step 1) and the test (Step 2) were written together, so this confirms the implementation is correct rather than following strict red-green. If you prefer strict TDD, write the test first, run it to confirm it fails (`Cannot find module '@/lib/sis/staff-families'`), then write the implementation and re-run to confirm it passes.

- [ ] **Step 4: Render the family-card grid**

In `app/(sis)/sis/admin/staff/page.tsx`, add the import near the other `lib/sis/*` imports:

```tsx
import { computeStaffFamilies } from '@/lib/sis/staff-families';
```

Then, inside the `view === 'accounts' && accounts` branch (the `<Card>` currently titled "Directory"), insert a new grid **above** that `<Card>`, using the exact icon-tile gradient (`from-brand-indigo to-brand-navy`) already used by every other tile on this page:

```tsx
) : view === 'accounts' && accounts ? (
  <>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {computeStaffFamilies(accounts).map((family) => (
        <Card key={family.key} data-slot="card" className="gap-0 py-0">
          <CardHeader className="border-b border-border py-5">
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              {family.label}
            </CardDescription>
            <CardTitle className="font-serif text-3xl tabular-nums text-foreground">
              {family.total}
            </CardTitle>
            <CardAction>
              <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <Users2 className="size-4" />
              </div>
            </CardAction>
          </CardHeader>
          <div className="flex flex-col gap-2 px-6 py-4">
            {family.roles.map((r) => (
              <div
                key={r.role}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-muted-foreground">{r.label}</span>
                <span className="font-mono tabular-nums text-foreground">
                  {r.count}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>

    <Card>
      <CardHeader>
        {/* ...existing "Directory" CardHeader, unchanged... */}
```

`Users2` is already imported at the top of this file (used by the Assignments-tab KPI card). Do not re-style or vary the icon per family per the plan's design decision (approved mockup) — all three cards use the identical gradient tile; differentiation is via label + icon-less breakdown rows only. Wrap the existing `<Card>` (Directory) and the new grid in the `<>...</>` fragment shown above — the closing `</>` replaces the old bare `<Card>...</Card>` return for this branch.

- [ ] **Step 5: Manual verification**

Since there's no browser access in an automated execution environment, do a careful static read-through: confirm the JSX braces balance, confirm `computeStaffFamilies(accounts)` is called with the already-loaded `accounts` array (not re-fetched), and confirm the new grid is inside the `view === 'accounts' && accounts` conditional (never rendered on the Assignments view). If you do have browser access, load `/sis/admin/staff?view=accounts` as a superadmin and visually confirm 3 cards render above the Directory table with counts that sum to the page's own "{accounts.length} staff users" line.

- [ ] **Step 6: Run typecheck and the full test suite**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: both clean; test count increased by 3 (the new `staff-families.test.ts` file).

- [ ] **Step 7: Commit**

```bash
git add lib/sis/staff-families.ts "app/(sis)/sis/admin/staff/page.tsx" __tests__/sis/staff-families.test.ts
git commit -m "feat(sis): add 3-family headcount card row to the Accounts view of Staff"
```

---

### Task 2: Assignments column + consolidated row-actions menu

**Files:**

- Modify: `app/(sis)/sis/admin/staff/page.tsx` (extend the data-fetch)
- Modify: `components/sis/staff-accounts-client.tsx` (new column, menu consolidation, assignment sheet wiring)

**Interfaces:**

- Consumes: `loadStaffAssignments(ayCode): Promise<StaffRow[]>` from `lib/sis/staff.ts` (`StaffRow = { userId, email, name, disabled, fcaSection, subjectAssignments }` — already defined, already used by `StaffTable` on the Assignments view of this same page).
- Consumes: `AssignmentChips` from `components/sis/staff-visuals.tsx` (props: `fcaSection: AssignmentChipFca`, `subjectAssignments: AssignmentChipSubject[]`, `maxSubjects?`, `align?`, `className?`).
- Consumes: `StaffAssignmentSheet` from `components/sis/staff-assignment-sheet.tsx` (props: `teacher: StaffSheetTeacher | null`, `ayCode: string`, `open: boolean`, `onOpenChange: (open: boolean) => void`; `StaffSheetTeacher = { userId, name, email }`).
- Consumes: `RowActionsMenu` from `components/ui/data-table` (props: `align?: 'start'|'center'|'end'`, `children: ReactNode`) and `DropdownMenuItem`/`DropdownMenuSeparator` from `components/ui/dropdown-menu`.
- Produces: `StaffAccountsClient` gains a new required prop `assignmentsByUserId: Record<string, { fcaSection: AssignmentChipFca; subjectAssignments: AssignmentChipSubject[] }>` and a new required prop `ayCode: string`.

- [ ] **Step 1: Extend the page's data-fetch**

In `app/(sis)/sis/admin/staff/page.tsx`, find the existing `Promise.all` that loads `[assignments, accounts, staffCount, teacherList]`. Add a fifth entry that loads staff assignments **only when the Accounts view is active** (mirroring the existing `view === 'assignments' ? ... : null` / `view === 'accounts' ? ... : null` pattern already used for the other two conditional fetches):

```tsx
const [assignments, accounts, staffCount, teacherList, accountAssignments] =
  await Promise.all([
    view === 'assignments'
      ? Promise.all([
          loadStaffAssignments(ayCode),
          getSectionStaffingCoverage(ayCode),
        ])
      : null,
    view === 'accounts' ? listStaffUsers() : null,
    getStaffCount(),
    getTeacherList(),
    view === 'accounts' ? loadStaffAssignments(ayCode) : null,
  ]);
```

Below that, build a lookup map (place this right after the existing `const [rows, coverage] = assignments ?? [[], null];` line):

```tsx
const assignmentsByUserId = new Map(
  (accountAssignments ?? []).map((r) => [
    r.userId,
    { fcaSection: r.fcaSection, subjectAssignments: r.subjectAssignments },
  ])
);
```

`loadStaffAssignments` is already imported at the top of this file (used by the Assignments view) — no new import needed for it.

- [ ] **Step 2: Pass the new props to `StaffAccountsClient`**

Find the existing `<StaffAccountsClient users={accounts} currentUserId={sessionUser.id} canManage={canManageAccounts} />` call and add the two new props:

```tsx
<StaffAccountsClient
  users={accounts}
  currentUserId={sessionUser.id}
  canManage={canManageAccounts}
  ayCode={ayCode}
  assignmentsByUserId={Object.fromEntries(assignmentsByUserId)}
/>
```

(`Object.fromEntries` because Server Components cannot pass a `Map` as a prop to a Client Component — only plain serializable JSON. `ayCode` is already in scope in this function.)

- [ ] **Step 3: Update `StaffAccountsClient`'s props + imports**

In `components/sis/staff-accounts-client.tsx`, update the component signature and imports:

```tsx
import {
  AssignmentChips,
  StaffAvatar,
  type AssignmentChipFca,
  type AssignmentChipSubject,
} from '@/components/sis/staff-visuals';
import {
  StaffAssignmentSheet,
  type StaffSheetTeacher,
} from '@/components/sis/staff-assignment-sheet';
import { RowActionsMenu } from '@/components/ui/data-table';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

type AssignmentSummary = {
  fcaSection: AssignmentChipFca;
  subjectAssignments: AssignmentChipSubject[];
};

export function StaffAccountsClient({
  users,
  currentUserId,
  canManage,
  ayCode,
  assignmentsByUserId,
}: {
  users: AdminUserRow[];
  currentUserId: string;
  canManage: boolean;
  ayCode: string;
  assignmentsByUserId: Record<string, AssignmentSummary>;
}) {
```

- [ ] **Step 4: Add the Assignments column**

In `buildColumns` (which needs a new parameter — see Step 6 below for the full call-site update), insert a new column definition right after the `role` column and before `user_status`:

```tsx
{
  id: 'assignments',
  accessorFn: (row) => {
    const a = assignmentsByUserId[row.id];
    if (row.role !== 'teacher') return '';
    if (!a || (!a.fcaSection && a.subjectAssignments.length === 0))
      return 'No assignments';
    const parts: string[] = [];
    if (a.fcaSection) parts.push(`FCA: ${a.fcaSection.name}`);
    for (const s of a.subjectAssignments) {
      parts.push(`${s.subjectCode}: ${s.sectionName}`);
    }
    return parts.join('; ');
  },
  header: 'Assignments',
  cell: ({ row }) => {
    if (row.original.role !== 'teacher') {
      return <span className="text-sm text-muted-foreground">—</span>;
    }
    const a = assignmentsByUserId[row.original.id];
    return (
      <AssignmentChips
        fcaSection={a?.fcaSection ?? null}
        subjectAssignments={a?.subjectAssignments ?? []}
      />
    );
  },
},
```

This follows the same dual `accessorFn` (plain-text, drives search/export/sort) + `cell` (rich JSX) pattern already used by the `role` and `user_status` columns in this same file. Non-teacher rows return `''` from `accessorFn` (not `'—'`) so they sort/group before any teacher row's real text and never pollute a text search for an assignment.

`buildColumns` needs to become a function of `assignmentsByUserId` too — update its signature:

```tsx
function buildColumns(
  currentUserId: string,
  canManage: boolean,
  ayCode: string,
  assignmentsByUserId: Record<string, AssignmentSummary>,
  onManageAssignments: (teacher: StaffSheetTeacher) => void
): ColumnDef<AdminUserRow>[] {
```

(The `ayCode` param is threaded through for Step 5's menu item, not used directly in the column body above.)

- [ ] **Step 5: Replace the actions column with a consolidated `RowActionsMenu`**

Replace the existing `actions` column's `cell` (currently rendering `<EditUserButton>` + `<ToggleDisabledButton>` side by side) with:

```tsx
{
  id: 'actions',
  header: '',
  cell: ({ row }) => (
    <div className="flex justify-end">
      <RowActionsMenu>
        <EditUserMenuItem user={row.original} isSelf={row.original.id === currentUserId} />
        {row.original.role === 'teacher' && (
          <DropdownMenuItem
            onSelect={() =>
              onManageAssignments({
                userId: row.original.id,
                name: row.original.display_name,
                email: row.original.email,
              })
            }
          >
            <GraduationCap className="size-3.5" />
            Manage teaching assignments
          </DropdownMenuItem>
        )}
        <ToggleDisabledMenuItem
          user={row.original}
          isSelf={row.original.id === currentUserId}
          canManage={canManage}
        />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled
          className="text-destructive focus:text-destructive"
          title="Not built yet — no route exists to delete a staff account. Disable instead, or ask for this to be built."
        >
          <Trash2 className="size-3.5" />
          Delete
        </DropdownMenuItem>
      </RowActionsMenu>
    </div>
  ),
  enableSorting: false,
  enableHiding: false,
},
```

Add `GraduationCap` and `Trash2` to the existing `lucide-react` import list at the top of the file (alongside `Ban, CheckCircle2, Copy, KeyRound, Loader2, Pencil, RefreshCw, Shield, UserPlus, Users`).

Note the permission split per this plan's Global Constraints: "Manage teaching assignments" has **no `canManage` gate** (every viewer of this page who reaches the Accounts tab — `school_admin` or `superadmin` — may open it), while Edit/Disable/Delete stay behind `canManage` exactly as today.

- [ ] **Step 6: Rework `EditUserButton`/`ToggleDisabledButton` into `DropdownMenuItem`-shaped components**

The existing `EditUserButton` component (lines ~329-358) renders a standalone `<Button>` that opens `<EditUserDialog>`. Change it to render a `DropdownMenuItem` instead, following the exact `discount-code-row-actions.tsx` pattern (`onSelect={(e) => e.preventDefault()}` so the menu doesn't close before the dialog opens):

```tsx
function EditUserMenuItem({
  user,
  isSelf,
}: {
  user: AdminUserRow;
  isSelf: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenuItem
        disabled={isSelf}
        onSelect={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
        title={
          isSelf
            ? 'Edit your own account at /account'
            : `Edit ${user.display_name}`
        }
      >
        <Pencil className="size-3.5" />
        Edit User
      </DropdownMenuItem>
      <EditUserDialog open={open} onOpenChange={setOpen} user={user} />
    </>
  );
}
```

`EditUserDialog` itself is unchanged — it's already a controlled `open`/`onOpenChange` component, no edits needed there.

Similarly, rework `ToggleDisabledButton` (lines ~266-325) into `ToggleDisabledMenuItem`, keeping its `useMutation` logic identical, only changing the rendered element:

```tsx
function ToggleDisabledMenuItem({
  user,
  isSelf,
  canManage,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  canManage: boolean;
}) {
  const router = useRouter();

  const toggleMutation = useMutation({
    mutationFn: (next: boolean) =>
      apiFetch(
        `/api/sis/admin/users/${user.id}`,
        jsonInit('PATCH', { disabled: next })
      ),
    onSuccess: (_data, next) => {
      toast.success(
        next ? `Disabled: ${user.email}` : `Enabled: ${user.email}`
      );
      router.refresh();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'update failed');
    },
  });
  const busy = toggleMutation.isPending;

  function toggleDisabled(e: Event) {
    e.preventDefault();
    toggleMutation.mutate(!user.disabled);
  }

  return (
    <DropdownMenuItem
      disabled={busy || isSelf || !canManage}
      onSelect={toggleDisabled}
      className={
        user.disabled ? undefined : 'text-destructive focus:text-destructive'
      }
      title={
        !canManage
          ? 'Only superadmins can enable or disable accounts'
          : isSelf
            ? 'You cannot disable your own account here'
            : undefined
      }
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : user.disabled ? (
        <CheckCircle2 className="size-3.5" />
      ) : (
        <Ban className="size-3.5" />
      )}
      {user.disabled ? 'Enable' : 'Disable'}
    </DropdownMenuItem>
  );
}
```

Delete the old `EditUserButton` and `ToggleDisabledButton` function definitions entirely (replaced by the two above) — do not leave both versions in the file.

- [ ] **Step 7: Wire the assignment sheet into the main component**

In the `StaffAccountsClient` function body, add the sheet's state and mount it, and update the `buildColumns` call site:

```tsx
export function StaffAccountsClient({
  users,
  currentUserId,
  canManage,
  ayCode,
  assignmentsByUserId,
}: {
  users: AdminUserRow[];
  currentUserId: string;
  canManage: boolean;
  ayCode: string;
  assignmentsByUserId: Record<string, AssignmentSummary>;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectedTeacher, setSelectedTeacher] =
    useState<StaffSheetTeacher | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  function handleManageAssignments(teacher: StaffSheetTeacher) {
    setSelectedTeacher(teacher);
    setSheetOpen(true);
  }

  const columns = buildColumns(
    currentUserId,
    canManage,
    ayCode,
    assignmentsByUserId,
    handleManageAssignments
  );

  // ...existing toolbarTrailing / return <DataTable ...> unchanged...
```

Immediately before the component's closing `return (...)` for `<DataTable>`, or right after it inside the same fragment, mount the sheet (`DataTable` currently returns a single element with no wrapping fragment — wrap it):

```tsx
  return (
    <>
      <DataTable<AdminUserRow>
        {/* ...all existing props unchanged... */}
      />
      <StaffAssignmentSheet
        teacher={selectedTeacher}
        ayCode={ayCode}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </>
  );
}
```

- [ ] **Step 8: Update the page's `<StaffAccountsClient>` call site type-check**

Run `npx tsc --noEmit` — this will surface any prop-shape mismatch between what `page.tsx` passes (Step 2) and what the component now expects (Step 3/7). Fix any reported error before proceeding — do not silently `as any` past a type error.

- [ ] **Step 9: Run the full test suite**

```bash
npx vitest run
```

Expected: no new failures. This task adds no new test file (it's a presentational + wiring change reusing already-tested components: `AssignmentChips`, `StaffAssignmentSheet`, `RowActionsMenu`, and the toggle/edit mutations are byte-identical logic just moved to a different rendered element).

- [ ] **Step 10: Manual verification**

Static read-through (no browser access assumed): confirm every `DropdownMenuItem`'s `onSelect` calls `e.preventDefault()` where it opens a dialog/sheet (Edit, Manage assignments) — omitting this closes the menu and can steal focus from the opening dialog, a known Radix footgun already worked around in `discount-code-row-actions.tsx`. Confirm the Assignments column's `cell` correctly falls back to `'—'` text for every non-`teacher` role (re-check against the `Role` union: `teacher | academic_coordinator | school_admin | superadmin | p_file_officer | admissions` — only `teacher` gets chips). If browser access is available, load `/sis/admin/staff?view=accounts` as superadmin, open a teacher row's `⋯` menu, confirm all 4 items render, click "Manage teaching assignments" and confirm the same Sheet used by the Assignments tab opens with that teacher pre-selected.

- [ ] **Step 11: Commit**

```bash
git add "app/(sis)/sis/admin/staff/page.tsx" components/sis/staff-accounts-client.tsx
git commit -m "feat(sis): add Assignments column + consolidate Staff Accounts row actions into one menu"
```

---

## Notes

- No migration, no new API route, no new permission model beyond the one documented split (Manage-assignments vs. canManage-gated actions).
- The Assignments-tab (`StaffTable`, `view === 'assignments'`) is completely untouched by this plan — it already has its own `StaffAssignmentSheet` wiring, unaffected by these changes to the Accounts cut.
- Out of scope, deferred per the approved mockup discussion: making "Delete" a real capability (would need a new backend route + a decision on what happens to a deleted user's historical audit-log/grade-entry attribution) — flag to the user before ever building it, don't infer it from this plan.
