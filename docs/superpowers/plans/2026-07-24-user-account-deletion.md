# Superadmin User-Account Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a superadmin permanently delete a staff account from `/sis/admin/staff?view=accounts`, but only when that account has zero recorded activity anywhere in the system — historied accounts stay on the existing Disable path.

**Architecture:** A new pure-ish helper (`lib/sis/user-deletion.ts::getUserFootprint`) checks only the tables the account's _current role_ can realistically have written to, grounded in each writer route's actual `requireRole` gate (and, where narrower, the real in-code actor check). A new `DELETE` handler on the existing `app/api/sis/admin/users/[id]/route.ts` wires that helper in behind a self-delete guard and a last-remaining-superadmin guard, then calls `service.auth.admin.deleteUser()` and logs a new `user.delete` audit action. The UI activates an existing disabled "Delete" menu-item stub in `components/sis/staff-accounts-client.tsx` with a real confirm dialog and mutation.

**Tech Stack:** Next.js 16 App Router API routes, Supabase Auth Admin API (`@supabase/supabase-js` service-role client), TanStack Query v5 (`useMutation`), shadcn `AlertDialog`, Vitest.

## Global Constraints

- No schema changes, no migrations — this plan only reads existing tables (spec §3 non-goals).
- The footprint check is scoped to the account's **current** role only (accepted limitation, spec §4) — do not attempt to reconstruct role history.
- `audit_log` is explicitly excluded from the footprint check (spec §4) — never add it.
- Self-delete and deleting the last remaining `superadmin` are always blocked, independent of the footprint result (spec §5 steps 2 and 4).
- Every new/changed file must keep `npx next build` and `npx vitest run` clean before the plan is considered done.
- Spec: `docs/superpowers/specs/2026-07-24-user-account-deletion-design.md` — re-read §4's role→table table if anything here is ambiguous.

---

## File structure

| File                                                | Responsibility                                                                                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/sis/user-deletion.ts` (new)                    | Role→table map + `getUserFootprint()`, the one piece of real business logic, kept pure/testable (only dependency is the Supabase client passed in). |
| `__tests__/sis/user-deletion.test.ts` (new)         | Unit tests for `getUserFootprint` against a mocked Supabase client.                                                                                 |
| `app/api/sis/admin/users/[id]/route.ts` (modify)    | Add the `DELETE` handler alongside the existing `PATCH`.                                                                                            |
| `lib/audit/log-action.ts` (modify)                  | Add `'user.delete'` to the `AuditAction` union.                                                                                                     |
| `lib/audit/humanize.ts` (modify)                    | Add the `'user.delete'` label and fold it into the existing `user.create` context-summary case.                                                     |
| `__tests__/audit/humanize.test.ts` (modify)         | One new assertion for `user.delete`'s label + context summary.                                                                                      |
| `app/(sis)/sis/audit-log/page.tsx` (modify)         | Add `'user.delete'` to `SIS_AUDIT_ALLOWLIST` so deletions are visible in the audit log.                                                             |
| `components/sis/staff-accounts-client.tsx` (modify) | Replace the disabled "Delete" `DropdownMenuItem` stub with a working `DeleteUserMenuItem` + `DeleteUserDialog`.                                     |

---

### Task 1: `getUserFootprint` + `isLastSuperadmin` helpers + tests

**Files:**

- Create: `lib/sis/user-deletion.ts`
- Test: `__tests__/sis/user-deletion.test.ts`

**Interfaces:**

- Produces: `getUserFootprint(service: SupabaseClient, userId: string, role: Role | null): Promise<string[]>` — returns a deduped list of table names that have a row referencing `userId`, scoped to `role`'s relevant tables (or the union of every role's tables when `role` is `null`). Empty array = no footprint = safe to delete.
- Produces: `isLastSuperadmin(users: Array<{ id: string; role: string | null }>, targetId: string): boolean` — pure array logic, no Supabase dependency. Extracted specifically so the last-remaining-superadmin guard (a severe failure mode if it's ever wrong — get it backwards and every superadmin account could be deleted, locking the school out of `/sis/admin` permanently) has a real unit test instead of relying only on manual verification.

- [ ] **Step 1: Write the failing test**

Create `__tests__/sis/user-deletion.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { getUserFootprint, isLastSuperadmin } from '@/lib/sis/user-deletion';

// Records every (table, column) pair queried, and lets each test decide
// which (table, column) pairs should report an existing row.
const queryCalls: Array<{ table: string; column: string }> = [];
const hits = new Set<string>(); // `${table}.${column}` keys that should "match"

function mockClient() {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: (column: string) => ({
          limit: (_n: number) => {
            queryCalls.push({ table, column });
            const matched = hits.has(`${table}.${column}`);
            return Promise.resolve({
              data: matched ? [{ id: 'row-1' }] : [],
              error: null,
            });
          },
        }),
      }),
    }),
  };
}

describe('getUserFootprint', () => {
  beforeEach(() => {
    queryCalls.length = 0;
    hits.clear();
  });

  it('teacher role only queries teacher-relevant tables', async () => {
    const client = mockClient();
    await getUserFootprint(client as never, 'user-1', 'teacher');
    const queriedTables = new Set(queryCalls.map((c) => c.table));
    expect(queriedTables).toEqual(
      new Set([
        'teacher_assignments',
        'grade_change_requests',
        'attendance_daily',
        'evaluation_writeups',
      ])
    );
  });

  it('p_file_officer role only queries its 2 tables', async () => {
    const client = mockClient();
    await getUserFootprint(client as never, 'user-1', 'p_file_officer');
    const queriedTables = new Set(queryCalls.map((c) => c.table));
    expect(queriedTables).toEqual(
      new Set(['p_file_revisions', 'p_file_outreach'])
    );
  });

  it('admissions role only queries p_file_outreach', async () => {
    const client = mockClient();
    await getUserFootprint(client as never, 'user-1', 'admissions');
    const queriedTables = new Set(queryCalls.map((c) => c.table));
    expect(queriedTables).toEqual(new Set(['p_file_outreach']));
  });

  it('returns an empty array when nothing matches', async () => {
    const client = mockClient();
    const result = await getUserFootprint(client as never, 'user-1', 'teacher');
    expect(result).toEqual([]);
  });

  it('returns the matching table name when a row exists', async () => {
    hits.add('evaluation_writeups.created_by');
    const client = mockClient();
    const result = await getUserFootprint(client as never, 'user-1', 'teacher');
    expect(result).toEqual(['evaluation_writeups']);
  });

  it('dedupes when multiple columns on the same table match', async () => {
    hits.add('grade_change_requests.requested_by');
    hits.add('grade_change_requests.reviewed_by');
    const client = mockClient();
    const result = await getUserFootprint(
      client as never,
      'user-1',
      'school_admin'
    );
    expect(result).toEqual(['grade_change_requests']);
  });

  it("a null role checks the union of every role's tables", async () => {
    // level_aliases is only in academic_coordinator/school_admin/superadmin's
    // lists, never teacher's or p_file_officer's/admissions' — proves the
    // null-role fallback is broader than any single role's list.
    hits.add('level_aliases.created_by');
    const client = mockClient();
    const result = await getUserFootprint(client as never, 'user-1', null);
    expect(result).toEqual(['level_aliases']);
  });

  it('treats a query error as a match (fails closed, never silently allows delete)', async () => {
    const erroringClient = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            limit: () =>
              Promise.resolve({ data: null, error: { message: 'boom' } }),
          }),
        }),
      }),
    };
    const result = await getUserFootprint(
      erroringClient as never,
      'user-1',
      'p_file_officer'
    );
    expect(result.sort()).toEqual(['p_file_outreach', 'p_file_revisions']);
  });
});

describe('isLastSuperadmin', () => {
  it('true when the target is the only superadmin', () => {
    const users = [
      { id: 'a', role: 'superadmin' },
      { id: 'b', role: 'teacher' },
    ];
    expect(isLastSuperadmin(users, 'a')).toBe(true);
  });

  it('false when another superadmin exists besides the target', () => {
    const users = [
      { id: 'a', role: 'superadmin' },
      { id: 'b', role: 'superadmin' },
    ];
    expect(isLastSuperadmin(users, 'a')).toBe(false);
  });

  it('false when the target itself is not even a superadmin (guard only fires for superadmin targets)', () => {
    const users = [
      { id: 'a', role: 'teacher' },
      { id: 'b', role: 'superadmin' },
    ];
    expect(isLastSuperadmin(users, 'a')).toBe(false);
  });

  it('true when the users list is otherwise empty of superadmins besides the target', () => {
    const users = [{ id: 'a', role: 'superadmin' }];
    expect(isLastSuperadmin(users, 'a')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/sis/user-deletion.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sis/user-deletion'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `lib/sis/user-deletion.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '@/lib/auth/roles';

// Which tables a user-deletion check should query, scoped to the account's
// CURRENT role (spec §4, docs/superpowers/specs/2026-07-24-user-account-deletion-design.md).
// Grounded in each writer route's real requireRole gate — or, where the
// route's gate is broader than the actual writer logic, the narrower
// in-code check (e.g. lib/change-requests/decide.ts only ever lets a
// school_admin land in reviewed_by/primary_reviewed_by/secondary_reviewed_by,
// regardless of that route's 4-role requireRole array).
//
// Deliberately excludes `audit_log` — a brand-new mistake account will
// almost always have a `user.login`/`user.create` row there, and blocking
// on that would defeat this feature's purpose. `audit_log.actor_email` is a
// plain text column with no real FK, so a dangling actor_id is harmless.
const ROLE_FOOTPRINT_COLUMNS: Record<
  Role,
  Array<{ table: string; column: string }>
> = {
  teacher: [
    { table: 'teacher_assignments', column: 'teacher_user_id' },
    { table: 'grade_change_requests', column: 'requested_by' },
    { table: 'attendance_daily', column: 'recorded_by' },
    { table: 'evaluation_writeups', column: 'created_by' },
  ],
  academic_coordinator: [
    { table: 'grade_change_requests', column: 'requested_by' },
    { table: 'grade_change_requests', column: 'applied_by' },
    { table: 'p_file_outreach', column: 'created_by_user_id' },
    { table: 'attendance_daily', column: 'recorded_by' },
    { table: 'school_calendar', column: 'created_by' },
    { table: 'calendar_events', column: 'created_by' },
    { table: 'evaluation_writeups', column: 'created_by' },
    { table: 'level_aliases', column: 'created_by' },
  ],
  school_admin: [
    { table: 'grade_change_requests', column: 'requested_by' },
    { table: 'grade_change_requests', column: 'reviewed_by' },
    { table: 'grade_change_requests', column: 'applied_by' },
    { table: 'grade_change_requests', column: 'primary_approver_id' },
    { table: 'grade_change_requests', column: 'secondary_approver_id' },
    { table: 'grade_change_requests', column: 'primary_reviewed_by' },
    { table: 'grade_change_requests', column: 'secondary_reviewed_by' },
    { table: 'approver_assignments', column: 'user_id' },
    { table: 'p_file_outreach', column: 'created_by_user_id' },
    { table: 'school_config', column: 'updated_by' },
    { table: 'attendance_daily', column: 'recorded_by' },
    { table: 'school_calendar', column: 'created_by' },
    { table: 'calendar_events', column: 'created_by' },
    { table: 'evaluation_writeups', column: 'created_by' },
    { table: 'level_aliases', column: 'created_by' },
  ],
  superadmin: [
    { table: 'approver_assignments', column: 'created_by' },
    { table: 'grade_change_requests', column: 'applied_by' },
    { table: 'grade_change_requests', column: 'requested_by' },
    { table: 'p_file_revisions', column: 'replaced_by_user_id' },
    { table: 'p_file_outreach', column: 'created_by_user_id' },
    { table: 'school_config', column: 'updated_by' },
    { table: 'attendance_daily', column: 'recorded_by' },
    { table: 'school_calendar', column: 'created_by' },
    { table: 'calendar_events', column: 'created_by' },
    { table: 'evaluation_writeups', column: 'created_by' },
    { table: 'level_aliases', column: 'created_by' },
  ],
  p_file_officer: [
    { table: 'p_file_revisions', column: 'replaced_by_user_id' },
    { table: 'p_file_outreach', column: 'created_by_user_id' },
  ],
  admissions: [{ table: 'p_file_outreach', column: 'created_by_user_id' }],
};

// Union of every role's columns, deduped — used when a role can't be
// resolved (shouldn't happen in practice; fail toward checking more, not
// less, per spec §5 step 5).
const ALL_FOOTPRINT_COLUMNS: Array<{ table: string; column: string }> = (() => {
  const seen = new Set<string>();
  const out: Array<{ table: string; column: string }> = [];
  for (const cols of Object.values(ROLE_FOOTPRINT_COLUMNS)) {
    for (const c of cols) {
      const key = `${c.table}.${c.column}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(c);
      }
    }
  }
  return out;
})();

// Returns the deduped list of table names that have at least one row
// referencing `userId`, scoped to `role`'s relevant tables. Empty array
// means the account has zero recorded activity and is safe to delete.
//
// Fails closed: a query error counts as a match (blocks deletion) rather
// than being silently ignored — a destructive action should never proceed
// on an inconclusive check.
export async function getUserFootprint(
  service: SupabaseClient,
  userId: string,
  role: Role | null
): Promise<string[]> {
  const columns = role ? ROLE_FOOTPRINT_COLUMNS[role] : ALL_FOOTPRINT_COLUMNS;

  const results = await Promise.all(
    columns.map(async ({ table, column }) => {
      const { data, error } = await service
        .from(table)
        .select('id')
        .eq(column, userId)
        .limit(1);
      if (error) return table; // fail closed
      return data && data.length > 0 ? table : null;
    })
  );

  return Array.from(new Set(results.filter((t): t is string => t !== null)));
}

// True when `targetId` is a superadmin AND no OTHER superadmin exists in
// `users`. Pure array logic — no Supabase dependency — so the one guard
// that must never be wrong (get it backwards and every superadmin account
// becomes deletable, locking the school out of /sis/admin permanently) has
// a real unit test.
export function isLastSuperadmin(
  users: Array<{ id: string; role: string | null }>,
  targetId: string
): boolean {
  const target = users.find((u) => u.id === targetId);
  if (!target || target.role !== 'superadmin') return false;
  return !users.some((u) => u.id !== targetId && u.role === 'superadmin');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/sis/user-deletion.test.ts`
Expected: PASS — all 12 tests green (8 for `getUserFootprint`, 4 for `isLastSuperadmin`).

- [ ] **Step 5: Commit**

```bash
git add lib/sis/user-deletion.ts __tests__/sis/user-deletion.test.ts
git commit -m "feat(sis): add role-scoped user-footprint + last-superadmin checks for account deletion"
```

---

### Task 2: Audit plumbing for `user.delete`

**Files:**

- Modify: `lib/audit/log-action.ts:135` (insert after `'user.enable'`)
- Modify: `lib/audit/humanize.ts:196` (label) and `lib/audit/humanize.ts:577-584` (context summary)
- Modify: `__tests__/audit/humanize.test.ts` (add assertions)
- Modify: `app/(sis)/sis/audit-log/page.tsx:138` (allowlist)

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces: the `AuditAction` union includes `'user.delete'` — Task 3's `logAction({ action: 'user.delete', ... })` call will not type-check until this task is done.

- [ ] **Step 1: Add `'user.delete'` to the `AuditAction` union**

In `lib/audit/log-action.ts`, find:

```ts
  | 'user.disable'
  | 'user.enable';
```

Replace with:

```ts
  | 'user.disable'
  | 'user.enable'
  | 'user.delete';
```

- [ ] **Step 2: Write the failing humanizer test**

In `__tests__/audit/humanize.test.ts`, inside the existing `describe('auditActionLabel', ...)` block, add:

```ts
it('user.delete → "User deleted"', () => {
  expect(auditActionLabel('user.delete')).toBe('User deleted');
});
```

Inside the existing `describe('auditActionTone', ...)` block, add:

```ts
it('user.delete → destructive (generic "delete" match)', () => {
  expect(auditActionTone('user.delete')).toBe('destructive');
});
```

Inside the existing `describe('auditContextSummary — per-action templates', ...)` block, add:

```ts
it('user.delete reports email + role, same shape as user.create', () => {
  const out = auditContextSummary('user.delete', {
    email: 'exteacher@hfse.edu.sg',
    role: 'teacher',
  });
  expect(out).toContain('exteacher@hfse.edu.sg');
  expect(out).toContain('Teacher');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run __tests__/audit/humanize.test.ts`
Expected: FAIL — `auditActionLabel('user.delete')` falls through to `prettify('user.delete')` (not `'User deleted'`), and `auditContextSummary('user.delete', ...)` returns `null` (no case matches yet).

- [ ] **Step 4: Add the label and fold into the context-summary case**

In `lib/audit/humanize.ts`, find:

```ts
  'user.disable': 'User disabled',
  'user.enable': 'User enabled',
```

Replace with:

```ts
  'user.disable': 'User disabled',
  'user.enable': 'User enabled',
  'user.delete': 'User deleted',
```

Then find:

```ts
    case 'user.create': {
      const parts: string[] = [];
      const email = str(ctx.email);
      if (email) parts.push(email);
      const role = str(ctx.role);
      if (role) parts.push(humanizeKey(role));
      return joinParts(parts);
    }
```

Replace with:

```ts
    case 'user.create':
    case 'user.delete': {
      const parts: string[] = [];
      const email = str(ctx.email);
      if (email) parts.push(email);
      const role = str(ctx.role);
      if (role) parts.push(humanizeKey(role));
      return joinParts(parts);
    }
```

(No change needed to `auditActionTone` — it already returns `'destructive'` for any action whose lowercased string contains `'delete'`, which `user.delete` does.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run __tests__/audit/humanize.test.ts`
Expected: PASS.

- [ ] **Step 6: Add `'user.delete'` to the SIS audit-log allowlist**

In `app/(sis)/sis/audit-log/page.tsx`, find:

```ts
  'user.invite',
  'user.create',
  'user.role.update',
  'user.disable',
  'user.enable',
```

Replace with:

```ts
  'user.invite',
  'user.create',
  'user.role.update',
  'user.disable',
  'user.enable',
  'user.delete',
```

- [ ] **Step 7: Commit**

```bash
git add lib/audit/log-action.ts lib/audit/humanize.ts __tests__/audit/humanize.test.ts "app/(sis)/sis/audit-log/page.tsx"
git commit -m "feat(audit): add user.delete action, label, and audit-log allowlist entry"
```

---

### Task 3: `DELETE /api/sis/admin/users/[id]` route handler

**Files:**

- Modify: `app/api/sis/admin/users/[id]/route.ts`

**Interfaces:**

- Consumes: `getUserFootprint(service, userId, role)` from Task 1; the `'user.delete'` `AuditAction` member from Task 2.
- Produces: `DELETE /api/sis/admin/users/[id]` — `200 { ok: true }` on success; `403` self-delete; `404` unknown id; `409 { error, tables? }` last-superadmin or has-activity; `500` on a genuine Supabase delete failure.

- [ ] **Step 1: Add the imports**

At the top of `app/api/sis/admin/users/[id]/route.ts`, alongside the existing imports, add:

```ts
import { getUserFootprint, isLastSuperadmin } from '@/lib/sis/user-deletion';
import type { Role } from '@/lib/auth/roles';
```

- [ ] **Step 2: Append the `DELETE` handler**

At the end of `app/api/sis/admin/users/[id]/route.ts` (after the existing `PATCH` function's closing brace), add:

```ts
// DELETE /api/sis/admin/users/[id] — permanently remove a user account.
//
// Only succeeds when the account has zero recorded activity anywhere the
// system tracks (lib/sis/user-deletion.ts::getUserFootprint, scoped to the
// account's current role — see the design spec's known limitation on role
// changes over time). Historied accounts stay on Disable (the PATCH route
// above) — this is deliberately not a general-purpose delete.
//
// Superadmin only. Always blocks self-delete and deleting the last
// remaining superadmin, independent of the footprint check.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const { id } = await params;
  if (id === auth.user.id) {
    return NextResponse.json(
      { error: 'You cannot delete your own account.' },
      { status: 403 }
    );
  }

  const service = createServiceClient();

  const { data: beforeRes, error: beforeErr } =
    await service.auth.admin.getUserById(id);
  if (beforeErr || !beforeRes?.user) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 });
  }
  const before = beforeRes.user;
  const role: Role | null =
    (before.app_metadata as { role?: Role } | null)?.role ??
    (before.user_metadata as { role?: Role } | null)?.role ??
    null;

  if (role === 'superadmin') {
    const { data: listData } = await service.auth.admin.listUsers({
      perPage: 1000,
    });
    const usersForCheck = (listData?.users ?? []).map((u) => ({
      id: u.id,
      role:
        (u.app_metadata as { role?: string } | null)?.role ??
        (u.user_metadata as { role?: string } | null)?.role ??
        null,
    }));
    if (isLastSuperadmin(usersForCheck, id)) {
      return NextResponse.json(
        {
          error:
            'This is the last superadmin account — promote another account first.',
        },
        { status: 409 }
      );
    }
  }

  const footprint = await getUserFootprint(service, id, role);
  if (footprint.length > 0) {
    return NextResponse.json(
      {
        error: `Can't delete — this account has activity in: ${footprint.join(', ')}. Use Disable instead.`,
        tables: footprint,
      },
      { status: 409 }
    );
  }

  const { error: deleteErr } = await service.auth.admin.deleteUser(id);
  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'user.delete',
    entityType: 'user_account',
    entityId: id,
    context: { email: before.email, role },
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors. (If `'user.delete'` isn't recognized as a valid `AuditAction`, Task 2 wasn't completed first — go back and finish it.)

- [ ] **Step 4: Commit**

```bash
git add "app/api/sis/admin/users/[id]/route.ts"
git commit -m "feat(sis): add DELETE /api/sis/admin/users/[id] with footprint + safety guards"
```

---

### Task 4: Wire up the Staff Accounts UI

**Files:**

- Modify: `components/sis/staff-accounts-client.tsx`

**Interfaces:**

- Consumes: `DELETE /api/sis/admin/users/[id]` from Task 3 (via `apiFetch`/`jsonInit('DELETE')`).
- Produces: a working "Delete" row action replacing the disabled stub.

- [ ] **Step 1: Add the `AlertDialog` imports**

In `components/sis/staff-accounts-client.tsx`, alongside the existing `Dialog`-family import, add a new import block for `AlertDialog`:

```ts
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
```

- [ ] **Step 2: Add `DeleteUserMenuItem` + `DeleteUserDialog`**

In `components/sis/staff-accounts-client.tsx`, immediately after the closing brace of `EditUserDialog` (before the `// ─── Main client component ───` divider comment), add:

```tsx
// ─── Delete user ──────────────────────────────────────────────────────────────

function DeleteUserMenuItem({
  user,
  isSelf,
  canManage,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenuItem
        disabled={isSelf || !canManage}
        className="text-destructive focus:text-destructive"
        onSelect={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
        title={
          !canManage
            ? 'Only superadmins can delete staff accounts'
            : isSelf
              ? 'You cannot delete your own account'
              : `Delete ${user.display_name}`
        }
      >
        <Trash2 className="size-3.5" />
        Delete
      </DropdownMenuItem>
      <DeleteUserDialog open={open} onOpenChange={setOpen} user={user} />
    </>
  );
}

function DeleteUserDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: AdminUserRow;
}) {
  const router = useRouter();

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/sis/admin/users/${user.id}`, jsonInit('DELETE')),
    onSuccess: () => {
      toast.success(`Deleted: ${user.email}`);
      onOpenChange(false);
      router.refresh();
    },
    onError: (e) => {
      // The route's has_activity / last-superadmin messages are precise —
      // never flatten them into a generic message (KD #24).
      toast.error(e instanceof Error ? e.message : 'delete failed');
    },
  });
  const busy = deleteMutation.isPending;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onOpenChange(false);
        else onOpenChange(o);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this account?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes <strong>{user.email}</strong>. It only
            succeeds if the account has never done anything the system tracks —
            if it has, you&apos;ll see exactly where, and should use Disable
            instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              deleteMutation.mutate();
            }}
            disabled={busy}
            variant="destructive"
          >
            {busy && <Loader2 className="mr-1 size-3.5 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 3: Replace the disabled stub with the real action**

In `components/sis/staff-accounts-client.tsx`, find the disabled stub inside `buildColumns`'s `actions` column:

```tsx
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled
              className="text-destructive focus:text-destructive"
              title="Deleting accounts isn't available yet — use Disable instead, or ask for this to be added."
            >
              <Trash2 className="size-3.5" />
              Delete
            </DropdownMenuItem>
```

Replace with:

```tsx
            <DropdownMenuSeparator />
            <DeleteUserMenuItem
              user={row.original}
              isSelf={row.original.id === currentUserId}
              canManage={canManage}
            />
```

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add components/sis/staff-accounts-client.tsx
git commit -m "feat(sis): activate Delete action on Staff Accounts with confirm dialog"
```

---

### Task 5: Manual verification pass

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server and sign in as a superadmin**

Run: `npm run dev`, sign in at `/login` with a superadmin account, go to `/sis/admin/staff?view=accounts`.

- [ ] **Step 2: Reproduce and resolve the original trigger**

Create a throwaway account (e.g. `deleteme.test@hfse.edu.sg`, any role, no assignments). Open its row menu → Delete → confirm. Expect a success toast and the row disappears after refresh. Then create a new account reusing that same email — it should succeed (proves the exact "amier already exists" scenario is now recoverable).

- [ ] **Step 3: Confirm a historied account is correctly blocked**

Pick any real teacher account that has at least one grading sheet, attendance entry, or write-up. Attempt Delete. Expect a toast reading something like "Can't delete — this account has activity in: evaluation_writeups. Use Disable instead." and the account must still exist afterward.

- [ ] **Step 4: Confirm the always-on guards**

Attempt to delete your own (currently signed-in) account — expect the menu item itself to be disabled with a tooltip, matching the existing self-edit pattern (this specific check has no dedicated test, same as the identical existing self-edit guard on the `PATCH` handler — consistent with this codebase's established practice). The last-remaining-superadmin guard itself is unit-tested in Task 1 (`isLastSuperadmin`); this manual step only needs to confirm the route actually calls it and surfaces the 409 correctly — if there are 2+ superadmin accounts in the environment, this step can be skipped safely (no need to manufacture a single-superadmin environment just to exercise it end-to-end).

- [ ] **Step 5: Confirm the audit trail**

After Step 2's successful delete, check `/sis/admin/audit-log` (Log view) — a `User deleted` row should appear for the deleted email, tagged destructive-toned.

- [ ] **Step 6: Full test suite + build**

Run: `npx vitest run`
Expected: all pass, no regressions.

Run: `npx next build`
Expected: clean compile.
