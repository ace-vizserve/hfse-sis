# Cross-Module Notification Bell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the existing `changeRequests` realtime badge signal (today only visible inside Markbook's own sidebar) as a bell icon in the page header that's already shared across all 7 modules, so change-request approvers see pending items regardless of which module they're browsing.

**Architecture:** A new `getSidebarChangeRequestPreview` data function mirrors the existing `getSidebarChangeRequestCount`'s per-role/per-AY scope exactly, returning rows instead of a count, so the panel list can never disagree with the badge number. A new `useChangeRequestCount` hook is extracted from the existing realtime-badge subscription logic so both the sidebar's badge and the new bell share one implementation of the live-count subscription without a shared client-state provider. A new `<NotificationBell>` client component (bell icon + numeric pill + `Popover` panel, lazy-fetched via TanStack Query on open) mounts in each of the 7 module layouts' existing sticky header bar, next to the sidebar collapse toggle.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + Realtime), TanStack Query v5, shadcn/ui (`Popover`, `Skeleton`), Tailwind v4, Vitest + Testing Library.

## Global Constraints

- Design tokens only from `app/globals.css` — no raw hex/oklch/`slate-*`/`zinc-*`/`gray-*` (Hard Rule #7).
- Client mutations/reads route through TanStack Query via `lib/query/fetcher.ts::apiFetch` (KD #24).
- The panel's row list MUST share the exact same per-role, per-current-AY scope as the badge count — never diverge (KD #124 "count == drill" discipline, restated in the approved spec).
- The bell only renders for roles `teacher | academic_coordinator | school_admin | superadmin` — never for `admissions` or `p_file_officer`.
- Spec: `docs/superpowers/specs/2026-07-28-cross-module-notification-bell-design.md` — read it if anything here is ambiguous.

---

### Task 1: Data layer — `getSidebarChangeRequestPreview`

**Files:**

- Modify: `lib/change-requests/sidebar-counts.ts`
- Test: Create `__tests__/change-requests/sidebar-preview.test.ts`

**Interfaces:**

- Produces: `getSidebarChangeRequestPreview(service: SupabaseClient, role: Role, userId: string, limit: number): Promise<ChangeRequestPreviewRow[]>` where
  ```ts
  export type ChangeRequestPreviewRow = {
    id: string;
    field_changed: string;
    reason_category: string;
    requested_at: string;
    grading_sheet_id: string;
    grade_entry_id: string;
    student_label: string | null;
    sheet_label: string | null;
  };
  ```
- Consumes: `fetchLabels` from `@/lib/change-requests/labels` (existing, signature `(service, sheetId, entryId) => Promise<{ student_label: string | null; sheet_label: string | null }>`).

- [ ] **Step 1: Write the failing test**

Create `__tests__/change-requests/sidebar-preview.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { getSidebarChangeRequestPreview } from '@/lib/change-requests/sidebar-counts';

vi.mock('@/lib/change-requests/labels', () => ({
  fetchLabels: vi.fn(async () => ({
    student_label: 'Tan, Grace (STU-001)',
    sheet_label: 'P4 Obedience · English · Term 1',
  })),
}));

const CURRENT_AY_ID = 'ay-current';

function makeService(rows: Array<Record<string, unknown>>) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    data: rows,
    error: null,
  };
  return {
    from: (table: string) => {
      if (table === 'academic_years') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: CURRENT_AY_ID },
                error: null,
              }),
            }),
          }),
        };
      }
      return chain;
    },
  } as never;
}

const ROW = {
  id: 'cr-1',
  field_changed: 'ww_scores',
  reason_category: 'regrading',
  requested_at: '2026-07-27T00:00:00.000Z',
  grading_sheet_id: 'sheet-1',
  grade_entry_id: 'entry-1',
};

describe('getSidebarChangeRequestPreview', () => {
  it('teacher: returns rows with resolved labels', async () => {
    const service = makeService([ROW]);

    const result = await getSidebarChangeRequestPreview(
      service,
      'teacher',
      'user-1',
      5
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('cr-1');
    expect(result[0].student_label).toBe('Tan, Grace (STU-001)');
    expect(result[0].sheet_label).toBe('P4 Obedience · English · Term 1');
  });

  it('school_admin: returns rows with resolved labels', async () => {
    const service = makeService([ROW]);
    const result = await getSidebarChangeRequestPreview(
      service,
      'school_admin',
      'user-1',
      5
    );
    expect(result).toHaveLength(1);
  });

  it('a role outside the change-request flow returns an empty array', async () => {
    const service = makeService([ROW]);
    const result = await getSidebarChangeRequestPreview(
      service,
      'admissions',
      'user-1',
      5
    );
    expect(result).toEqual([]);
  });

  it('no current AY returns an empty array without querying rows', async () => {
    const service = {
      from: (table: string) => {
        if (table === 'academic_years') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          };
        }
        throw new Error('should not query grade_change_requests');
      },
    } as never;
    const result = await getSidebarChangeRequestPreview(
      service,
      'school_admin',
      'user-1',
      5
    );
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/change-requests/sidebar-preview.test.ts`
Expected: FAIL — `getSidebarChangeRequestPreview` is not exported from `lib/change-requests/sidebar-counts.ts`.

- [ ] **Step 3: Write the implementation**

In `lib/change-requests/sidebar-counts.ts`, add the import and new function (keep the existing `getSidebarChangeRequestCount` untouched):

```ts
import { fetchLabels } from '@/lib/change-requests/labels';
```

Append to the end of the file:

```ts
export type ChangeRequestPreviewRow = {
  id: string;
  field_changed: string;
  reason_category: string;
  requested_at: string;
  grading_sheet_id: string;
  grade_entry_id: string;
  student_label: string | null;
  sheet_label: string | null;
};

// Row-level sibling of getSidebarChangeRequestCount above — same per-role,
// per-current-AY scope, copied rather than re-derived so the notification
// bell's dropdown list can never disagree with the badge count it's paired
// with (KD #124: a card's count and its drill must share one scope). Backs
// GET /api/change-requests/preview.
export async function getSidebarChangeRequestPreview(
  service: SupabaseClient,
  role: Role,
  userId: string,
  limit: number
): Promise<ChangeRequestPreviewRow[]> {
  const { data: ayData } = await service
    .from('academic_years')
    .select('id')
    .eq('is_current', true)
    .maybeSingle();
  const currentAyId = (ayData as { id: string } | null)?.id ?? null;
  if (!currentAyId) return [];

  let query = service
    .from('grade_change_requests')
    .select(
      `id, field_changed, reason_category, requested_at,
       grading_sheet_id, grade_entry_id,
       grading_sheet:grading_sheets!inner(section:sections!inner(academic_year_id))`
    )
    .eq('grading_sheet.section.academic_year_id', currentAyId)
    .order('requested_at', { ascending: false })
    .limit(limit);

  if (role === 'teacher') {
    query = query.eq('requested_by', userId).eq('status', 'pending');
  } else if (role === 'academic_coordinator') {
    query = query.eq('status', 'approved');
  } else if (role === 'school_admin' || role === 'superadmin') {
    query = query
      .eq('status', 'pending')
      .or(
        `primary_approver_id.eq.${userId},secondary_approver_id.eq.${userId},and(primary_approver_id.is.null,secondary_approver_id.is.null)`
      );
  } else {
    return [];
  }

  const { data, error } = await query;
  if (error || !data) return [];

  const rows = data as unknown as Array<{
    id: string;
    field_changed: string;
    reason_category: string;
    requested_at: string;
    grading_sheet_id: string;
    grade_entry_id: string;
  }>;

  const labels = await Promise.all(
    rows.map((r) => fetchLabels(service, r.grading_sheet_id, r.grade_entry_id))
  );

  return rows.map((r, i) => ({
    ...r,
    student_label: labels[i].student_label,
    sheet_label: labels[i].sheet_label,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/change-requests/sidebar-preview.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/change-requests/sidebar-counts.ts __tests__/change-requests/sidebar-preview.test.ts
git commit -m "feat(change-requests): add getSidebarChangeRequestPreview for the notification bell"
```

---

### Task 2: API route — `GET /api/change-requests/preview`

**Files:**

- Create: `app/api/change-requests/preview/route.ts`
- Test: Create `__tests__/change-requests/preview-route.test.ts`

**Interfaces:**

- Consumes: `getSidebarChangeRequestPreview` from Task 1; `requireRole` from `@/lib/auth/require-role` (existing, returns `{ user: { id, email }, role } | { error: NextResponse }`).
- Produces: `GET` handler returning `{ rows: ChangeRequestPreviewRow[] }` as JSON, or 401/403 via `requireRole`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/change-requests/preview-route.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(() =>
    Promise.resolve({
      user: { id: 'user-1', email: 'teacher@hfse.test' },
      role: 'teacher',
    })
  ),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({})),
}));

const previewMock = vi.fn(async () => [
  {
    id: 'cr-1',
    field_changed: 'ww_scores',
    reason_category: 'regrading',
    requested_at: '2026-07-27T00:00:00.000Z',
    grading_sheet_id: 'sheet-1',
    grade_entry_id: 'entry-1',
    student_label: 'Tan, Grace (STU-001)',
    sheet_label: 'P4 Obedience · English · Term 1',
  },
]);
vi.mock('@/lib/change-requests/sidebar-counts', () => ({
  getSidebarChangeRequestPreview: (...args: unknown[]) => previewMock(...args),
}));

import { GET } from '@/app/api/change-requests/preview/route';

describe('GET /api/change-requests/preview', () => {
  it('returns rows scoped to the caller role/id, capped at 5', async () => {
    const res = await GET(
      new Request('http://localhost/api/change-requests/preview') as never
    );
    const body = await res.json();

    expect(previewMock).toHaveBeenCalledWith(
      expect.anything(),
      'teacher',
      'user-1',
      5
    );
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].id).toBe('cr-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/change-requests/preview-route.test.ts`
Expected: FAIL — cannot find module `@/app/api/change-requests/preview/route`.

- [ ] **Step 3: Write the implementation**

Create `app/api/change-requests/preview/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { getSidebarChangeRequestPreview } from '@/lib/change-requests/sidebar-counts';

// GET /api/change-requests/preview
// Backs the header notification bell's dropdown panel. Returns up to 5 rows
// scoped identically to the sidebar badge count
// (getSidebarChangeRequestCount) — see that function's doc comment for the
// per-role rules — so the panel's list can never disagree with the number
// shown on the bell.
export async function GET(_request: NextRequest) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const service = createServiceClient();
  const rows = await getSidebarChangeRequestPreview(
    service,
    auth.role,
    auth.user.id,
    5
  );

  return NextResponse.json({ rows });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/change-requests/preview-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/change-requests/preview/route.ts __tests__/change-requests/preview-route.test.ts
git commit -m "feat(change-requests): add GET /api/change-requests/preview route"
```

---

### Task 3: Extract `useChangeRequestCount` hook

**Files:**

- Create: `lib/sidebar/use-change-request-count.ts`
- Modify: `lib/sidebar/use-realtime-badges.ts`
- Test: Existing `__tests__/ui/module-sidebar-group-label.test.tsx` must still pass unmodified (it mocks the whole `use-realtime-badges` module, so this task cannot break it — run it as the verification step).

**Interfaces:**

- Produces: `useChangeRequestCount(role: Role | null, userId: string, initial: number | null): number | null` — a client hook. `initial === null` (or `role` falsy) means "don't subscribe."
- Consumes (unchanged): `Role` from `@/lib/auth/roles`; `createClient` from `@/lib/supabase/client`.

- [ ] **Step 1: Write the new hook (extracted from the existing `subscribeChannels` + first `useEffect` in `use-realtime-badges.ts`)**

Create `lib/sidebar/use-change-request-count.ts`:

```ts
'use client';

import { useEffect, useId, useState } from 'react';

import type { Role } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/client';

// Live count of "change requests actionable by this user right now".
// Extracted out of use-realtime-badges.ts so both the sidebar's
// `changeRequests` nav badge AND the header notification bell can each
// subscribe independently without duplicating this per-role scope SQL in
// two places. Each hook instance opens its own realtime channel (a unique
// name per mounted instance, via useId) — two lightweight subscriptions
// instead of a shared client-state provider; simpler than threading one
// value through two components that aren't parent/child.
//
// Scope MUST mirror
// lib/change-requests/sidebar-counts.ts::getSidebarChangeRequestCount —
// see that function's doc comment for the per-role rules. `initial` is the
// SSR-computed starting value; passing `null` (or a falsy `role`) means
// "there is nothing to subscribe to" and this hook no-ops.
export function useChangeRequestCount(
  role: Role | null,
  userId: string,
  initial: number | null
): number | null {
  const instanceId = useId();
  const [count, setCount] = useState<number | null>(initial);

  useEffect(() => {
    setCount(initial);
  }, [initial]);

  useEffect(() => {
    if (!role || initial == null) return;

    let filter: string | null = null;
    if (role === 'teacher') {
      filter = `requested_by=eq.${userId}`;
    } else if (role === 'academic_coordinator') {
      filter = `status=eq.approved`;
    } else if (role === 'school_admin' || role === 'superadmin') {
      filter = `status=eq.pending`;
    }
    if (!filter) return;

    const supabase = createClient();

    const recount = async (): Promise<number | null> => {
      const { data: ayData } = await supabase
        .from('academic_years')
        .select('id')
        .eq('is_current', true)
        .maybeSingle();
      const currentAyId = (ayData as { id: string } | null)?.id ?? null;
      if (!currentAyId) return 0;

      let query = supabase
        .from('grade_change_requests')
        .select(
          'id, grading_sheet:grading_sheets!inner(section:sections!inner(academic_year_id))',
          { count: 'exact', head: true }
        )
        .eq('grading_sheet.section.academic_year_id', currentAyId);
      if (role === 'teacher') {
        query = query.eq('requested_by', userId).eq('status', 'pending');
      } else if (role === 'academic_coordinator') {
        query = query.eq('status', 'approved');
      } else if (role === 'school_admin') {
        query = query
          .eq('status', 'pending')
          .or(
            `primary_approver_id.eq.${userId},secondary_approver_id.eq.${userId},and(primary_approver_id.is.null,secondary_approver_id.is.null)`
          );
      } else if (role === 'superadmin') {
        query = query.eq('status', 'pending');
      } else {
        return null;
      }
      const { count: fresh } = await query;
      return fresh ?? null;
    };

    const channelName = `change-request-count-${instanceId}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'grade_change_requests',
          filter,
        },
        async () => {
          const fresh = await recount();
          if (fresh != null) setCount(fresh);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'grade_change_requests',
          filter,
        },
        async () => {
          const fresh = await recount();
          if (fresh != null) setCount(fresh);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, userId, instanceId]);

  return count;
}
```

- [ ] **Step 2: Wire `use-realtime-badges.ts` to delegate to the new hook**

In `lib/sidebar/use-realtime-badges.ts`:

1. Delete the `BadgeChannel` type (lines 22–28) and the `subscribeChannels` function (lines 30–102) entirely — both are being replaced by the extracted hook.
2. Add the import:

```ts
import { useChangeRequestCount } from '@/lib/sidebar/use-change-request-count';
```

3. Replace the body of `useRealtimeBadges` (the exported function) so its first `useEffect` — the one that built `channels` via `subscribeChannels` and mapped them into Supabase `.channel()` subscriptions — is replaced with a call to the new hook plus a small merge effect. The **pfile `useEffect` block at the bottom (currently lines 198–223) is untouched** — leave it exactly as-is. The function becomes:

```ts
export function useRealtimeBadges(
  role: Role | null,
  userId: string,
  initial: SidebarBadges
): SidebarBadges {
  const router = useRouter();
  const [badges, setBadges] = useState<SidebarBadges>(initial);

  // Sync with the SSR-provided baseline when its CONTENT changes — not
  // its reference. A caller that passes `badges ?? {}` would otherwise
  // create a fresh object every render and trigger an infinite loop.
  useEffect(() => {
    setBadges((prev) => {
      const keys = new Set<SidebarBadgeKey>([
        ...(Object.keys(prev) as SidebarBadgeKey[]),
        ...(Object.keys(initial) as SidebarBadgeKey[]),
      ]);
      for (const k of keys) {
        if (prev[k] !== initial[k]) return { ...initial };
      }
      return prev;
    });
  }, [initial]);

  const liveChangeRequestCount = useChangeRequestCount(
    role,
    userId,
    initial.changeRequests ?? null
  );

  useEffect(() => {
    if (liveChangeRequestCount == null) return;
    setBadges((prev) =>
      prev.changeRequests === liveChangeRequestCount
        ? prev
        : { ...prev, changeRequests: liveChangeRequestCount }
    );
  }, [liveChangeRequestCount]);

  // pfileAwaitingVerification — SSR-rendered badge; realtime channel fires
  // router.refresh() on document-related audit_log INSERTs so the layout
  // RSC re-fetches countAwaitingVerification from the server.
  // Gated on roles that see the P-Files sidebar (p-file, school_admin, superadmin).
  useEffect(() => {
    if (!role || !PFILE_BADGE_ROLES.includes(role)) return;
    if (initial.pfileAwaitingVerification == null) return;

    const supabase = createClient();
    const filter = `action=in.(${PFILE_VERIFICATION_ACTIONS.join(',')})`;
    const channel = supabase
      .channel('sidebar-badge-pfile-awaiting-verification')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'audit_log', filter },
        () => {
          router.refresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  return badges;
}
```

(`SidebarBadgeKey` import, `createClient` import, `PFILE_VERIFICATION_ACTIONS`, `PFILE_BADGE_ROLES` all stay — only `BadgeChannel`/`subscribeChannels` are removed and the first `useEffect`'s body changes as shown.)

- [ ] **Step 3: Run the existing sidebar test to confirm no regression**

Run: `npx vitest run __tests__/ui/module-sidebar-group-label.test.tsx`
Expected: PASS (unchanged — this test mocks the entire `use-realtime-badges` module, so it cannot observe the internal refactor).

- [ ] **Step 4: Full-repo typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing `lib/sidebar/use-realtime-badges.ts` or `lib/sidebar/use-change-request-count.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/sidebar/use-change-request-count.ts lib/sidebar/use-realtime-badges.ts
git commit -m "refactor(sidebar): extract useChangeRequestCount from use-realtime-badges"
```

---

### Task 4: Query key + `<NotificationBell>` component

**Files:**

- Modify: `lib/query/keys.ts`
- Create: `components/notifications/notification-bell.tsx`
- Test: Create `__tests__/ui/notification-bell.test.tsx`

**Interfaces:**

- Consumes: `useChangeRequestCount` (Task 3); `apiFetch` from `@/lib/query/fetcher`; `Popover`/`PopoverTrigger`/`PopoverContent` from `@/components/ui/popover`; `Skeleton` from `@/components/ui/skeleton`; `Role` from `@/lib/auth/roles`.
- Produces: `<NotificationBell role={role: Role | null} userId={string} initialCount={number | null} />` — a client component, renders `null` when `role` isn't one of `teacher | academic_coordinator | school_admin | superadmin`.

- [ ] **Step 1: Add the query key**

In `lib/query/keys.ts`, add inside the `queryKeys` object (after the existing `pfilesDrill` entry):

```ts
  changeRequestPreview: () => ['change-request-preview'] as const,
```

- [ ] **Step 2: Write the failing component test**

Create `__tests__/ui/notification-bell.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sidebar/use-change-request-count', () => ({
  useChangeRequestCount: (
    _role: unknown,
    _userId: unknown,
    initial: number | null
  ) => initial,
}));

const fetchMock = vi.fn(async () => ({
  rows: [
    {
      id: 'cr-1',
      field_changed: 'ww_scores',
      reason_category: 'regrading',
      requested_at: new Date().toISOString(),
      grading_sheet_id: 'sheet-1',
      grade_entry_id: 'entry-1',
      student_label: 'Tan, Grace (STU-001)',
      sheet_label: 'P4 Obedience · English · Term 1',
    },
  ],
}));
vi.mock('@/lib/query/fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/query/fetcher')>();
  return { ...actual, apiFetch: (...args: unknown[]) => fetchMock(...args) };
});

import { NotificationBell } from '@/components/notifications/notification-bell';
import { renderWithClient } from '../_utils/render-with-client';

describe('NotificationBell', () => {
  it('renders nothing for a role outside the change-request flow', () => {
    const { container } = render(
      <NotificationBell role="admissions" userId="u-1" initialCount={0} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the count pill only when count > 0', () => {
    const { rerender } = render(
      <NotificationBell role="teacher" userId="u-1" initialCount={0} />
    );
    expect(screen.queryByText('0')).not.toBeInTheDocument();

    rerender(<NotificationBell role="teacher" userId="u-1" initialCount={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('opens the panel, lazy-fetches, and renders a row on click', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <NotificationBell role="school_admin" userId="u-1" initialCount={1} />
    );

    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /notifications/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/change-requests/preview',
      expect.objectContaining({ credentials: 'include' })
    );
    expect(
      await screen.findByText(/Tan, Grace \(STU-001\)/)
    ).toBeInTheDocument();
  });
});
```

Check `__tests__/_utils/render-with-client.tsx` exists (it's referenced by KD #24's test helpers). If it doesn't already export a `renderWithClient` helper that wraps a component in a `QueryClientProvider`, add it:

```tsx
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

export function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
}
```

(Only add this file if it does not already exist — check first with `Read` or `Glob` on `__tests__/_utils/`; several existing tests reference "helpers `renderWithClient`/`mockFetch` in `__tests__/_utils/`" per KD #24, so it likely already exists — reuse it, don't create a duplicate.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run __tests__/ui/notification-bell.test.tsx`
Expected: FAIL — cannot find module `@/components/notifications/notification-bell`.

- [ ] **Step 4: Write the implementation**

Create `components/notifications/notification-bell.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import type { Role } from '@/lib/auth/roles';
import { useChangeRequestCount } from '@/lib/sidebar/use-change-request-count';
import { apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';

const GATE_ROLES: Role[] = [
  'teacher',
  'academic_coordinator',
  'school_admin',
  'superadmin',
];

type PreviewRow = {
  id: string;
  field_changed: string;
  reason_category: string;
  requested_at: string;
  student_label: string | null;
  sheet_label: string | null;
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type NotificationBellProps = {
  role: Role | null;
  userId: string;
  initialCount: number | null;
};

// Surfaces the changeRequests realtime signal outside Markbook's own
// sidebar (KD #41/#88 approvers) — see
// docs/superpowers/specs/2026-07-28-cross-module-notification-bell-design.md.
// Mounted in every module layout's header, next to <SidebarTrigger>.
export function NotificationBell({
  role,
  userId,
  initialCount,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const count = useChangeRequestCount(role, userId, initialCount);

  const previewQuery = useQuery({
    queryKey: queryKeys.changeRequestPreview(),
    queryFn: async ({ signal }) => {
      const json = await apiFetch<{ rows: PreviewRow[] }>(
        '/api/change-requests/preview',
        { credentials: 'include', signal }
      );
      return json.rows;
    },
    enabled: open,
  });

  if (!role || !GATE_ROLES.includes(role)) return null;

  const rows = previewQuery.data ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            count && count > 0
              ? `Notifications (${count} pending)`
              : 'Notifications'
          }
          className="relative flex size-8 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell className="size-4" aria-hidden />
          {count != null && count > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold tabular-nums text-white">
              {count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Notifications
          </span>
          {count != null && count > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {count} pending
            </span>
          )}
        </div>
        {previewQuery.isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            Nothing pending
          </div>
        ) : (
          <ul>
            {rows.map((row) => (
              <li key={row.id} className="border-b border-border last:border-0">
                <Link
                  href={`/markbook/change-requests?req=${row.id}`}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2.5 transition-colors hover:bg-accent"
                >
                  <div className="text-xs font-medium text-foreground">
                    {row.student_label ?? '(student)'} —{' '}
                    {row.field_changed.replace(/_/g, ' ')}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    Requested {relativeTime(row.requested_at)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/ui/notification-bell.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/query/keys.ts components/notifications/notification-bell.tsx __tests__/ui/notification-bell.test.tsx
git commit -m "feat(notifications): add NotificationBell component"
```

---

### Task 5: Mount the bell in all 7 module layouts

**Files:**

- Modify: `app/(markbook)/layout.tsx`
- Modify: `app/(attendance)/layout.tsx`
- Modify: `app/(records)/layout.tsx`
- Modify: `app/(sis)/layout.tsx`
- Modify: `app/(p-files)/layout.tsx`
- Modify: `app/(evaluation)/layout.tsx`
- Modify: `app/(admissions)/layout.tsx`

**Interfaces:**

- Consumes: `<NotificationBell role userId initialCount />` (Task 4); `getSidebarChangeRequestCount` (existing, `lib/change-requests/sidebar-counts.ts`).

Each layout gets the same shape of change: import `NotificationBell`; ensure a `createServiceClient()` instance and a `getSidebarChangeRequestCount(service, role, id)` call exist; render `<NotificationBell role={role} userId={id} initialCount={changeRequestCount} />` inside the existing `<header>`, after `<SidebarTrigger>`. This is independent of each layout's existing `<ModuleSidebar badges={...}>` call — **do not** add `changeRequests` to any layout's `sidebarBadges`/`badges` object; the bell gets its count as its own separate prop.

- [ ] **Step 1: Markbook — already computes the count, just wire the prop**

In `app/(markbook)/layout.tsx`, add the import:

```ts
import { NotificationBell } from '@/components/notifications/notification-bell';
```

Change the header block from:

```tsx
<header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md print:hidden">
  <SidebarTrigger className="-ml-1" />
</header>
```

to:

```tsx
<header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md print:hidden">
  <SidebarTrigger className="-ml-1" />
  <div className="ml-auto">
    <NotificationBell
      role={role}
      userId={id}
      initialCount={sidebarBadges.changeRequests ?? null}
    />
  </div>
</header>
```

(`sidebarBadges.changeRequests` is already computed a few lines above via `getSidebarChangeRequestCount` — no new query here.)

- [ ] **Step 2: Attendance**

In `app/(attendance)/layout.tsx`, add imports:

```ts
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import { createServiceClient } from '@/lib/supabase/service';
import { NotificationBell } from '@/components/notifications/notification-bell';
```

After the `const cookieStore = await cookies();` / `defaultOpen` lines and before the `return (`, add:

```tsx
const service = createServiceClient();
const changeRequestCount = await getSidebarChangeRequestCount(
  service,
  role,
  id
);
```

Change the header block from:

```tsx
<header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
  <SidebarTrigger className="-ml-1" />
</header>
```

to:

```tsx
<header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
  <SidebarTrigger className="-ml-1" />
  <div className="ml-auto">
    <NotificationBell
      role={role}
      userId={id}
      initialCount={changeRequestCount}
    />
  </div>
</header>
```

- [ ] **Step 3: Records**

In `app/(records)/layout.tsx`, add imports:

```ts
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import { createServiceClient } from '@/lib/supabase/service';
import { NotificationBell } from '@/components/notifications/notification-bell';
```

After `const currentAy = await getCurrentAcademicYear();` (before the existing `Promise.all` for `unsyncedCount`/`levelMismatchCount`), add a service client and fetch it alongside the existing `Promise.all` rather than a second sequential round-trip:

```tsx
const service = createServiceClient();
const [unsyncedCount, levelMismatchCount, changeRequestCount] =
  await Promise.all([
    currentAy ? countUnsyncedEnrolledStudents(currentAy.ay_code) : 0,
    countUnmatchedLevelLabels(),
    getSidebarChangeRequestCount(service, role, id),
  ]);
```

(This replaces the existing 2-item `Promise.all` — remove the old `const [unsyncedCount, levelMismatchCount] = await Promise.all([...])` block entirely and use the 3-item version above in its place.)

Change the header block from:

```tsx
<header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
  <SidebarTrigger className="-ml-1" />
</header>
```

to:

```tsx
<header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
  <SidebarTrigger className="-ml-1" />
  <div className="ml-auto">
    <NotificationBell
      role={role}
      userId={id}
      initialCount={changeRequestCount}
    />
  </div>
</header>
```

- [ ] **Step 4: SIS**

In `app/(sis)/layout.tsx`, add imports:

```ts
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import { createServiceClient } from '@/lib/supabase/service';
import { NotificationBell } from '@/components/notifications/notification-bell';
```

After the existing `sectionsCount`/`staffCount` block and before `const sidebarCounts: SidebarCounts = {};`, add (this role gate mirrors the file's own existing `canSeeYearNav` pattern — `admissions` never queries or renders the bell):

```tsx
const service = createServiceClient();
const changeRequestCount =
  role === 'academic_coordinator' ||
  role === 'school_admin' ||
  role === 'superadmin'
    ? await getSidebarChangeRequestCount(service, role, id)
    : null;
```

Change the header block from:

```tsx
<header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
  <SidebarTrigger className="-ml-1" />
</header>
```

to:

```tsx
<header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
  <SidebarTrigger className="-ml-1" />
  <div className="ml-auto">
    <NotificationBell
      role={role}
      userId={id}
      initialCount={changeRequestCount}
    />
  </div>
</header>
```

- [ ] **Step 5: P-Files**

In `app/(p-files)/layout.tsx`, add imports:

```ts
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import { createServiceClient } from '@/lib/supabase/service';
import { NotificationBell } from '@/components/notifications/notification-bell';
```

After the existing `const badges: SidebarBadges = ...` block, add (role is `p_file_officer | school_admin | superadmin` here — only the latter two are gate roles):

```tsx
const service = createServiceClient();
const changeRequestCount =
  role === 'school_admin' || role === 'superadmin'
    ? await getSidebarChangeRequestCount(service, role, id)
    : null;
```

Change the header block from:

```tsx
<header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
  <SidebarTrigger className="-ml-1" />
</header>
```

to:

```tsx
<header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
  <SidebarTrigger className="-ml-1" />
  <div className="ml-auto">
    <NotificationBell
      role={role}
      userId={id}
      initialCount={changeRequestCount}
    />
  </div>
</header>
```

- [ ] **Step 6: Evaluation**

In `app/(evaluation)/layout.tsx`, add imports:

```ts
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import { createServiceClient } from '@/lib/supabase/service';
import { NotificationBell } from '@/components/notifications/notification-bell';
```

After the `const cookieStore = await cookies();` / `defaultOpen` lines and before the `return (`, add (this layout's `allowed` array is already exactly the 4 gate roles, so no conditional needed):

```tsx
const service = createServiceClient();
const changeRequestCount = await getSidebarChangeRequestCount(
  service,
  role,
  id
);
```

Change the header block from:

```tsx
<header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
  <SidebarTrigger className="-ml-1" />
</header>
```

to:

```tsx
<header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
  <SidebarTrigger className="-ml-1" />
  <div className="ml-auto">
    <NotificationBell
      role={role}
      userId={id}
      initialCount={changeRequestCount}
    />
  </div>
</header>
```

- [ ] **Step 7: Admissions**

In `app/(admissions)/layout.tsx`, add imports:

```ts
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import { createServiceClient } from '@/lib/supabase/service';
import { NotificationBell } from '@/components/notifications/notification-bell';
```

After the existing `const badges: SidebarBadges = ...` block, add (role is `admissions | academic_coordinator | school_admin | superadmin` here — `admissions` is not a gate role):

```tsx
const service = createServiceClient();
const changeRequestCount =
  role === 'academic_coordinator' ||
  role === 'school_admin' ||
  role === 'superadmin'
    ? await getSidebarChangeRequestCount(service, role, id)
    : null;
```

Change the header block from:

```tsx
<header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
  <SidebarTrigger className="-ml-1" />
</header>
```

to:

```tsx
<header className="sticky top-0 z-50 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
  <SidebarTrigger className="-ml-1" />
  <div className="ml-auto">
    <NotificationBell
      role={role}
      userId={id}
      initialCount={changeRequestCount}
    />
  </div>
</header>
```

- [ ] **Step 8: Typecheck all 7**

Run: `npx tsc --noEmit`
Expected: no errors in any of the 7 layout files.

- [ ] **Step 9: Commit**

```bash
git add "app/(markbook)/layout.tsx" "app/(attendance)/layout.tsx" "app/(records)/layout.tsx" "app/(sis)/layout.tsx" "app/(p-files)/layout.tsx" "app/(evaluation)/layout.tsx" "app/(admissions)/layout.tsx"
git commit -m "feat(notifications): mount NotificationBell in every module header"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all tests pass, including the 3 new files from Tasks 1/2/4 and the untouched `module-sidebar-group-label.test.tsx` from Task 3.

- [ ] **Step 2: Full typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npx next build`
Expected: clean compile, all 7 module route groups build successfully.

- [ ] **Step 4: Manual browser smoke test**

Start the dev server (`npm run dev`), log in as a `school_admin` or `superadmin` test user with at least one pending change request, and confirm:

- The bell renders in the header on at least 3 different modules (e.g. Records, Attendance, SIS) with a numeric badge matching the count already shown on `/markbook/change-requests`.
- Clicking the bell opens the panel, shows a loading skeleton briefly, then the row list with real student names.
- Clicking a row navigates to `/markbook/change-requests?req=<id>` and closes the panel.
- Logging in as an `admissions` or `p_file_officer` test user shows no bell anywhere.

Report the result of this manual check explicitly — do not claim it passed without actually running it in a browser.

- [ ] **Step 5: Final commit (if any fixes were needed during verification)**

```bash
git add -A
git commit -m "fix(notifications): address issues found during verification"
```

(Skip this step if Steps 1–4 passed clean with no changes needed.)
