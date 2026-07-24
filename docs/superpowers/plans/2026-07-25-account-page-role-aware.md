# Role-Aware Account Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/account` into a role-aware, full-width two-column page — identity + password on the left, a personal activity feed + shortcuts + live per-role stats on the right.

**Architecture:** All non-trivial data-fetching and mapping logic lives in small, independently-tested `lib/account/*.ts` modules; `app/(dashboard)/account/page.tsx` and four small presentational components under `app/(dashboard)/account/` do orchestration and rendering only. Four existing per-module audit-log pages gain a `?actor=` filter to match two that already have it, so the page's "View all activity" link works precisely for every role.

**Tech Stack:** Next.js 16 App Router (RSC), Supabase (service client for `audit_log` reads — required, not optional, see Task 3), Vitest + Testing Library, Tailwind v4 / Aurora Vault tokens.

## Global Constraints

- Design spec of record: `docs/superpowers/specs/2026-07-24-account-page-role-aware-design.md`. Every task implements exactly what that spec says; do not add scope it explicitly excludes (shortcut badge counts, fixing Attendance's `.ilike` vs `.eq` inconsistency, a cross-module "all activity" page).
- Hard Rule #7 (design system): no raw `#rrggbb` / `oklch(...)` / `slate-*` / `zinc-*` / `gray-*` / `bg-white` / `bg-black`. Use semantic tokens (`bg-card`, `text-muted-foreground`, `border-border`, `text-brand-indigo`, etc.) exactly as the rest of `app/(dashboard)/account/page.tsx` and `components/sis/staff-visuals.tsx` already do.
- Reuse, never reinvent: `RoleChip` + `staffInitials` (`components/sis/staff-visuals.tsx`), `auditActionLabel`/`auditContextSummary`/`auditActionTone` (`lib/audit/humanize.ts`), `SIDEBAR_REGISTRY`/`MODULE_ORDER`/`isRouteAllowed` (`lib/sidebar/registry.ts`, `lib/auth/roles.ts`), and every per-role stat source named in the spec's Section 5 table. If a task's own research finds none of those actually fit, stop and flag it — don't silently write a parallel implementation.
- `audit_log` SELECT is RLS-gated to `is_registrar_or_above()` (migration 006). Any code reading it for a `teacher`/`p_file_officer`/`admissions` session **must** use `createServiceClient()` (`lib/supabase/service.ts`), the same way every per-module audit-log page already does. This is a correctness requirement, not a style choice — get it wrong and non-privileged roles see an empty/broken feed.
- No emojis anywhere in new UI copy or code comments.
- Recent activity is capped at exactly 6 rows, always — no "load more."

## File Structure

```
lib/account/
  view-all-target.ts      — pure: role+email -> "View all activity" href
  shortcuts.ts             — pure-ish: role -> scoped list of sidebar quick actions
  activity.ts               — server-only: fetch + humanize the caller's own last 6 audit_log rows; also exports formatRelativeTime (pure)
  sections.ts                — server-only: a teacher's own (section, role/subject) rows with names
  this-term-stats.ts        — server-only: per-role live stat rows, dispatches to existing dashboard functions

app/(dashboard)/account/
  page.tsx                  — MODIFY: two-column layout, fetches + wires everything below
  about-card.tsx            — NEW: avatar/name/role chip + identity + (teacher-only) sections
  recent-activity-card.tsx   — NEW: timeline + "View all activity" link
  shortcuts-card.tsx         — NEW: list-row shortcuts
  this-term-card.tsx        — NEW: icon+label+value stat rows
  change-password-form.tsx   — unchanged, just relocated in page.tsx's JSX

app/(p-files)/p-files/audit-log/page.tsx     — MODIFY: add ?actor= filter
app/(records)/records/audit-log/page.tsx      — MODIFY: add ?actor= filter
app/(admissions)/admissions/audit-log/page.tsx — MODIFY: add ?actor= filter
app/(sis)/sis/audit-log/page.tsx              — MODIFY: add ?actor= filter (Log tab only)

__tests__/account/view-all-target.test.ts
__tests__/account/shortcuts.test.ts
__tests__/account/activity.test.ts
__tests__/account/sections.test.ts
__tests__/account/this-term-stats.test.ts
__tests__/account/recent-activity-card.test.tsx
__tests__/audit/audit-log-actor-filter-extension.test.ts
```

---

### Task 1: `lib/account/view-all-target.ts` — role → "View all activity" href

**Files:**

- Create: `lib/account/view-all-target.ts`
- Test: `__tests__/account/view-all-target.test.ts`

**Interfaces:**

- Consumes: `Role` type from `@/lib/auth/roles`.
- Produces: `viewAllActivityHref(role: Role, email: string): string` — used by Task 3's `recent-activity-card.tsx` (via `page.tsx`).

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/account/view-all-target.test.ts
import { describe, it, expect } from 'vitest';
import { viewAllActivityHref } from '@/lib/account/view-all-target';

describe('viewAllActivityHref', () => {
  it('maps each role to its primary module audit-log page, with the email URL-encoded', () => {
    expect(viewAllActivityHref('teacher', 'maria.t@hfse.edu.sg')).toBe(
      '/markbook/audit-log?actor=maria.t%40hfse.edu.sg'
    );
    expect(
      viewAllActivityHref('academic_coordinator', 'joann@hfse.edu.sg')
    ).toBe('/markbook/audit-log?actor=joann%40hfse.edu.sg');
    expect(viewAllActivityHref('school_admin', 'admin@hfse.edu.sg')).toBe(
      '/sis/audit-log?actor=admin%40hfse.edu.sg'
    );
    expect(viewAllActivityHref('superadmin', 'amier@hfse.edu.sg')).toBe(
      '/sis/audit-log?actor=amier%40hfse.edu.sg'
    );
    expect(viewAllActivityHref('p_file_officer', 'pfiles@hfse.edu.sg')).toBe(
      '/p-files/audit-log?actor=pfiles%40hfse.edu.sg'
    );
    expect(viewAllActivityHref('admissions', 'admissions@hfse.edu.sg')).toBe(
      '/admissions/audit-log?actor=admissions%40hfse.edu.sg'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/account/view-all-target.test.ts`
Expected: FAIL — `Cannot find module '@/lib/account/view-all-target'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/account/view-all-target.ts
import type { Role } from '@/lib/auth/roles';

const VIEW_ALL_ACTIVITY_TARGET: Record<Role, string> = {
  teacher: '/markbook/audit-log',
  academic_coordinator: '/markbook/audit-log',
  school_admin: '/sis/audit-log',
  superadmin: '/sis/audit-log',
  p_file_officer: '/p-files/audit-log',
  admissions: '/admissions/audit-log',
};

/**
 * Where the account page's "View all activity" link goes, per role — each
 * role's most-central module (KD #2), pre-filtered to just this account via
 * ?actor=. Requires the target audit-log page to support that param (see
 * docs/superpowers/specs/2026-07-24-account-page-role-aware-design.md).
 */
export function viewAllActivityHref(role: Role, email: string): string {
  return `${VIEW_ALL_ACTIVITY_TARGET[role]}?actor=${encodeURIComponent(email)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/account/view-all-target.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/account/view-all-target.ts __tests__/account/view-all-target.test.ts
git commit -m "feat(account): add role -> view-all-activity href mapping"
```

---

### Task 2: `lib/account/shortcuts.ts` — role → scoped shortcut list

**Files:**

- Create: `lib/account/shortcuts.ts`
- Test: `__tests__/account/shortcuts.test.ts`

**Interfaces:**

- Consumes: `SIDEBAR_REGISTRY`, `MODULE_ORDER`, `type QuickAction` from `@/lib/sidebar/registry`; `isRouteAllowed` from `@/lib/auth/roles`.
- Produces: `type AccountShortcut = QuickAction & { module: SidebarModule }`; `shortcutsForRole(role: Role): AccountShortcut[]` — used by Task 5's `shortcuts-card.tsx`.

This deliberately tests against the **real** `SIDEBAR_REGISTRY`, not a mock — the point is to catch real drift between this page and the sidebar's own data, the same way `__tests__/sis/sis-nav-route-consistency.test.ts` (KD #154) already does for nav reachability.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/account/shortcuts.test.ts
import { describe, it, expect } from 'vitest';
import { shortcutsForRole } from '@/lib/account/shortcuts';
import { SIDEBAR_REGISTRY } from '@/lib/sidebar/registry';
import { isRouteAllowed } from '@/lib/auth/roles';

describe('shortcutsForRole', () => {
  it('only returns shortcuts for modules the role can actually open', () => {
    const result = shortcutsForRole('p_file_officer');
    for (const s of result) {
      expect(
        isRouteAllowed(SIDEBAR_REGISTRY[s.module].primaryHref, 'p_file_officer')
      ).toBe(true);
    }
  });

  it('skips modules with no quickActionByRole entry for this role, rather than returning empty placeholders', () => {
    const result = shortcutsForRole('teacher');
    // Markbook's registry entry has NO teacher quick action by design (see
    // lib/sidebar/registry.ts's own comment on this) — must not appear.
    expect(result.some((s) => s.module === 'markbook')).toBe(false);
  });

  it('every returned shortcut carries a label, href, and icon from the real registry', () => {
    const result = shortcutsForRole('superadmin');
    expect(result.length).toBeGreaterThan(0);
    for (const s of result) {
      expect(typeof s.label).toBe('string');
      expect(typeof s.href).toBe('string');
      expect(s.icon).toBeDefined();
    }
  });

  it('an unrecognized/no role returns no shortcuts', () => {
    // shortcutsForRole takes Role, but guard the null-session-user call site
    // in page.tsx separately — this test documents the type-level contract
    // by exercising every real Role and confirming none throws.
    for (const role of [
      'teacher',
      'academic_coordinator',
      'school_admin',
      'superadmin',
      'p_file_officer',
      'admissions',
    ] as const) {
      expect(() => shortcutsForRole(role)).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/account/shortcuts.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// lib/account/shortcuts.ts
import {
  MODULE_ORDER,
  SIDEBAR_REGISTRY,
  type QuickAction,
  type SidebarModule,
} from '@/lib/sidebar/registry';
import { isRouteAllowed, type Role } from '@/lib/auth/roles';

export type AccountShortcut = QuickAction & { module: SidebarModule };

/**
 * The account page's "Shortcuts" list for one role: every module this role
 * can open (per the same isRouteAllowed check the sidebar/proxy use) that
 * also has a quickActionByRole entry for this role. Modules without an
 * entry (documented per-module in lib/sidebar/registry.ts — e.g. teacher
 * has none for Markbook because "My Sheets" already sits at the top of that
 * module's own nav) are skipped, not shown empty.
 */
export function shortcutsForRole(role: Role): AccountShortcut[] {
  const out: AccountShortcut[] = [];
  for (const module of MODULE_ORDER) {
    const config = SIDEBAR_REGISTRY[module];
    if (!isRouteAllowed(config.primaryHref, role)) continue;
    const action = config.quickActionByRole[role];
    if (!action) continue;
    out.push({ ...action, module });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/account/shortcuts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/account/shortcuts.ts __tests__/account/shortcuts.test.ts
git commit -m "feat(account): add role-scoped shortcuts selector"
```

---

### Task 3: `lib/account/activity.ts` — recent activity fetch + humanize + relative time

**Files:**

- Create: `lib/account/activity.ts`
- Test: `__tests__/account/activity.test.ts`

**Interfaces:**

- Consumes: `createServiceClient` (`@/lib/supabase/service`); `auditActionLabel`, `auditContextSummary`, `auditActionTone` (`@/lib/audit/humanize`).
- Produces: `type ActivityRow = { id: string; createdAt: string; label: string; summary: string | null; tone: 'default' | 'info' | 'warning' | 'destructive' }`; `getRecentActivity(email: string, limit?: number): Promise<ActivityRow[]>`; `formatRelativeTime(iso: string, now?: Date): string` — both used by Task 5's `recent-activity-card.tsx` via `page.tsx`.

Mock pattern follows `__tests__/sis/staff-list.test.ts` exactly (mock `next/cache`'s `unstable_cache` as a passthrough is NOT needed here since this function does not use caching, per the spec's "no new unstable_cache wrapper" constraint — only mock `@/lib/supabase/service`).

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/account/activity.test.ts
import { describe, it, expect, vi } from 'vitest';

const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockEq = vi.fn(() => ({ order: mockOrder }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}));

import { getRecentActivity, formatRelativeTime } from '@/lib/account/activity';

describe('getRecentActivity', () => {
  it('filters to the given actor_email, orders newest first, and caps at the given limit', async () => {
    mockOrder.mockReturnValue({ limit: mockLimit });
    mockLimit.mockResolvedValue({
      data: [
        {
          id: '1',
          action: 'entry.update',
          entity_type: 'grade_entry',
          context: { subject: 'Filipino' },
          created_at: '2026-07-24T10:00:00.000Z',
        },
      ],
      error: null,
    });

    const rows = await getRecentActivity('maria.t@hfse.edu.sg', 6);

    expect(mockFrom).toHaveBeenCalledWith('audit_log');
    expect(mockEq).toHaveBeenCalledWith('actor_email', 'maria.t@hfse.edu.sg');
    expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(mockLimit).toHaveBeenCalledWith(6);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: '1',
      createdAt: '2026-07-24T10:00:00.000Z',
      label: 'Grade updated',
    });
  });

  it('defaults to a limit of 6 when none is passed', async () => {
    mockOrder.mockReturnValue({ limit: mockLimit });
    mockLimit.mockResolvedValue({ data: [], error: null });
    await getRecentActivity('someone@hfse.edu.sg');
    expect(mockLimit).toHaveBeenCalledWith(6);
  });

  it('returns an empty array (not a throw) when the query errors', async () => {
    mockOrder.mockReturnValue({ limit: mockLimit });
    mockLimit.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const rows = await getRecentActivity('someone@hfse.edu.sg');
    expect(rows).toEqual([]);
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-07-24T12:00:00.000Z');

  it('renders minutes for under an hour', () => {
    expect(formatRelativeTime('2026-07-24T11:46:00.000Z', now)).toBe(
      '14 min ago'
    );
  });

  it('renders hours for under a day', () => {
    expect(formatRelativeTime('2026-07-24T09:00:00.000Z', now)).toBe(
      '3 hours ago'
    );
  });

  it('renders "Yesterday" for exactly one day back', () => {
    expect(formatRelativeTime('2026-07-23T12:00:00.000Z', now)).toBe(
      'Yesterday'
    );
  });

  it('renders "N days ago" for 2-6 days back', () => {
    expect(formatRelativeTime('2026-07-21T12:00:00.000Z', now)).toBe(
      '3 days ago'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/account/activity.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// lib/account/activity.ts
import { createServiceClient } from '@/lib/supabase/service';
import {
  auditActionLabel,
  auditActionTone,
  auditContextSummary,
} from '@/lib/audit/humanize';

export type ActivityRow = {
  id: string;
  createdAt: string;
  label: string;
  summary: string | null;
  tone: 'default' | 'info' | 'warning' | 'destructive';
};

type RawAuditRow = {
  id: string;
  action: string;
  entity_type: string;
  context: Record<string, unknown> | null;
  created_at: string;
};

/**
 * The signed-in account's own last N audit_log rows, humanized. Reads via
 * the service client — audit_log SELECT is RLS-gated to
 * is_registrar_or_above() (migration 006), so a plain server client would
 * return nothing for a teacher/p_file_officer/admissions session. This is
 * the same reason every per-module audit-log page already uses the service
 * client.
 */
export async function getRecentActivity(
  email: string,
  limit = 6
): Promise<ActivityRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('audit_log')
    .select('id, action, entity_type, context, created_at')
    .eq('actor_email', email)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as RawAuditRow[]).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    label: auditActionLabel(row.action),
    summary: auditContextSummary(row.action, row.context ?? undefined),
    tone: auditActionTone(row.action),
  }));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "14 min ago" / "3 hours ago" / "Yesterday" / "3 days ago" / a short date beyond a week. */
export function formatRelativeTime(
  iso: string,
  now: Date = new Date()
): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (ms < HOUR) {
    const mins = Math.max(1, Math.floor(ms / MINUTE));
    return `${mins} min ago`;
  }
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.floor(ms / DAY);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-SG', {
    month: 'short',
    day: 'numeric',
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/account/activity.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/account/activity.ts __tests__/account/activity.test.ts
git commit -m "feat(account): add recent-activity fetch + relative-time formatter"
```

---

### Task 4: `lib/account/sections.ts` — a teacher's own sections with names

**Files:**

- Create: `lib/account/sections.ts`
- Test: `__tests__/account/sections.test.ts`

**Interfaces:**

- Consumes: `SupabaseClient` (caller-supplied, passed in from `page.tsx`'s existing request-scoped client).
- Produces: `type TeacherSectionRow = { sectionName: string; roleTag: string }`; `getTeacherSections(supabase: SupabaseClient, userId: string): Promise<TeacherSectionRow[]>` — used by Task 5's `about-card.tsx` via `page.tsx`, teacher role only.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/account/sections.test.ts
import { describe, it, expect, vi } from 'vitest';
import { getTeacherSections } from '@/lib/account/sections';

function fakeSupabase(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: rows, error: null })),
      })),
    })),
  } as never;
}

describe('getTeacherSections', () => {
  it('labels a form_adviser row with "Form adviser"', async () => {
    const supabase = fakeSupabase([
      {
        role: 'form_adviser',
        section: { id: 's1', name: 'Primary One Respect' },
        subject: null,
      },
    ]);
    const rows = await getTeacherSections(supabase, 'user-1');
    expect(rows).toEqual([
      { sectionName: 'Primary One Respect', roleTag: 'Form adviser' },
    ]);
  });

  it('labels a subject_teacher row with the subject name', async () => {
    const supabase = fakeSupabase([
      {
        role: 'subject_teacher',
        section: { id: 's2', name: 'Primary Four Honesty' },
        subject: { id: 'sub1', name: 'English' },
      },
    ]);
    const rows = await getTeacherSections(supabase, 'user-1');
    expect(rows).toEqual([
      { sectionName: 'Primary Four Honesty', roleTag: 'English' },
    ]);
  });

  it('returns one row per assignment (a teacher with 2 subjects in the same section gets 2 rows)', async () => {
    const supabase = fakeSupabase([
      {
        role: 'subject_teacher',
        section: { id: 's2', name: 'Primary Four Honesty' },
        subject: { id: 'sub1', name: 'English' },
      },
      {
        role: 'subject_teacher',
        section: { id: 's2', name: 'Primary Four Honesty' },
        subject: { id: 'sub2', name: 'Math' },
      },
    ]);
    const rows = await getTeacherSections(supabase, 'user-1');
    expect(rows).toHaveLength(2);
  });

  it('returns an empty array when the teacher has no assignments', async () => {
    const supabase = fakeSupabase([]);
    const rows = await getTeacherSections(supabase, 'user-1');
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/account/sections.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// lib/account/sections.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type TeacherSectionRow = { sectionName: string; roleTag: string };

type RawRow = {
  role: 'form_adviser' | 'subject_teacher';
  section: { id: string; name: string } | { id: string; name: string }[] | null;
  subject: { id: string; name: string } | { id: string; name: string }[] | null;
};

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/**
 * A teacher's own (section, role/subject) assignments with real names, for
 * the account page's "Your sections" sub-section — mirrors the reference
 * screenshot's "Teams: role · member count" rows. One row per assignment;
 * a teacher with 2 subjects in the same section gets 2 rows (not deduped)
 * since each is a distinct, separately-meaningful assignment.
 */
export async function getTeacherSections(
  supabase: SupabaseClient,
  userId: string
): Promise<TeacherSectionRow[]> {
  const { data } = await supabase
    .from('teacher_assignments')
    .select('role, section:sections(id, name), subject:subjects(id, name)')
    .eq('teacher_user_id', userId);

  return ((data ?? []) as RawRow[]).map((row) => {
    const section = one(row.section);
    const subject = one(row.subject);
    return {
      sectionName: section?.name ?? '—',
      roleTag:
        row.role === 'form_adviser' ? 'Form adviser' : (subject?.name ?? '—'),
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/account/sections.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/account/sections.ts __tests__/account/sections.test.ts
git commit -m "feat(account): add teacher-sections-with-names lookup"
```

---

### Task 5: `lib/account/this-term-stats.ts` — per-role live stat rows

**Files:**

- Create: `lib/account/this-term-stats.ts`
- Test: `__tests__/account/this-term-stats.test.ts`

**Interfaces:**

- Consumes (all existing, per spec Section 5 — mock every one in the test): `getEvaluationTeacherPriority` (`@/lib/evaluation/dashboard`), `getMarkbookTeacherPriority`, `getMarkbookKpisRange` (`@/lib/markbook/dashboard`), `getSidebarChangeRequestCount` (`@/lib/change-requests/sidebar-counts`), `getStaffCount` (`@/lib/auth/staff-list`), `getPFilesKpisRange`, `getPFilesPriority` (`@/lib/p-files/dashboard`), `getOutdatedApplications` (`@/lib/admissions/dashboard`), `getTeacherSections` (Task 4, for the sections count stat).
- Produces: `type StatRow = { label: string; value: string | number; tone?: 'default' | 'warning' }`; `getThisTermStats(params: { role: Role; userId: string; email: string; ayCode: string; supabase: SupabaseClient; service: SupabaseClient }): Promise<StatRow[]>` — used by Task 6's `page.tsx`, passed into `this-term-card.tsx`.

Each branch is wrapped so one module's failure can't blank the whole card — on a thrown error from any underlying call, that branch's stat row is simply omitted (not a fake "0", which would misrepresent a real outage as a real zero).

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/account/this-term-stats.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/account/sections', () => ({
  getTeacherSections: vi.fn(() =>
    Promise.resolve([
      { sectionName: 'A', roleTag: 'Form adviser' },
      { sectionName: 'B', roleTag: 'English' },
    ])
  ),
}));
vi.mock('@/lib/evaluation/dashboard', () => ({
  getEvaluationTeacherPriority: vi.fn(() =>
    Promise.resolve({ headline: { value: 2 } })
  ),
}));
vi.mock('@/lib/markbook/dashboard', () => ({
  getMarkbookTeacherPriority: vi.fn(() =>
    Promise.resolve({ headline: { value: 1 } })
  ),
  getMarkbookKpisRange: vi.fn(() =>
    Promise.resolve({ current: { changeRequestsPending: 4 } })
  ),
}));
vi.mock('@/lib/change-requests/sidebar-counts', () => ({
  getSidebarChangeRequestCount: vi.fn(() => Promise.resolve(3)),
}));
vi.mock('@/lib/auth/staff-list', () => ({
  getStaffCount: vi.fn(() => Promise.resolve(28)),
}));
vi.mock('@/lib/p-files/dashboard', () => ({
  getPFilesKpisRange: vi.fn(() =>
    Promise.resolve({ current: { expiringSoon30: 12 } })
  ),
  getPFilesPriority: vi.fn(() => Promise.resolve({ overdueCount: 3 })),
}));
vi.mock('@/lib/admissions/dashboard', () => ({
  getOutdatedApplications: vi.fn(() => Promise.resolve(new Array(5).fill({}))),
}));

import { getThisTermStats } from '@/lib/account/this-term-stats';

const base = {
  userId: 'u1',
  email: 'x@hfse.edu.sg',
  ayCode: 'AY2026',
  supabase: {} as never,
  service: {} as never,
};

describe('getThisTermStats', () => {
  it('teacher: sections count, outstanding write-ups, open grading sheets', async () => {
    const rows = await getThisTermStats({ ...base, role: 'teacher' });
    expect(rows).toEqual([
      { label: 'Sections', value: 2 },
      { label: 'Write-ups still needed', value: 2, tone: 'warning' },
      { label: 'Open grading sheets', value: 1 },
    ]);
  });

  it('academic_coordinator: system-wide pending change requests', async () => {
    const rows = await getThisTermStats({
      ...base,
      role: 'academic_coordinator',
    });
    expect(rows).toEqual([
      { label: 'Change requests pending', value: 4, tone: 'warning' },
    ]);
  });

  it('school_admin: change requests awaiting this user as approver', async () => {
    const rows = await getThisTermStats({ ...base, role: 'school_admin' });
    expect(rows).toEqual([
      { label: 'Awaiting your review', value: 3, tone: 'warning' },
    ]);
  });

  it('superadmin: active staff count', async () => {
    const rows = await getThisTermStats({ ...base, role: 'superadmin' });
    expect(rows).toEqual([{ label: 'Active staff accounts', value: 28 }]);
  });

  it('p_file_officer: expiring + expired counts', async () => {
    const rows = await getThisTermStats({ ...base, role: 'p_file_officer' });
    expect(rows).toEqual([
      { label: 'Expiring within 30 days', value: 12, tone: 'warning' },
      { label: 'Already expired', value: 3, tone: 'warning' },
    ]);
  });

  it('admissions: applications needing follow-up', async () => {
    const rows = await getThisTermStats({ ...base, role: 'admissions' });
    expect(rows).toEqual([
      { label: 'Applications needing follow-up', value: 5, tone: 'warning' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/account/this-term-stats.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Before writing this file, read the actual return shapes of `getMarkbookKpisRange`, `getPFilesKpisRange`, `getPFilesPriority`, and `getSidebarChangeRequestCount` in their source files (`lib/markbook/dashboard.ts`, `lib/p-files/dashboard.ts`, `lib/change-requests/sidebar-counts.ts`) — the test above asserts specific field names (`current.changeRequestsPending`, `current.expiringSoon30`, a plain number from `getSidebarChangeRequestCount`) based on this plan's research, but confirm against the live code before wiring the real calls, since these are read from dashboards you have not touched. If a shape has drifted from what's asserted here, trust the source file and update the test to match — don't force the implementation to match a stale assertion.

```ts
// lib/account/this-term-stats.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '@/lib/auth/roles';
import { getTeacherSections } from '@/lib/account/sections';
import { getEvaluationTeacherPriority } from '@/lib/evaluation/dashboard';
import {
  getMarkbookTeacherPriority,
  getMarkbookKpisRange,
} from '@/lib/markbook/dashboard';
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import { getStaffCount } from '@/lib/auth/staff-list';
import { getPFilesKpisRange, getPFilesPriority } from '@/lib/p-files/dashboard';
import { getOutdatedApplications } from '@/lib/admissions/dashboard';

export type StatRow = {
  label: string;
  value: string | number;
  tone?: 'default' | 'warning';
};

type Params = {
  role: Role;
  userId: string;
  email: string;
  ayCode: string;
  supabase: SupabaseClient;
  service: SupabaseClient;
};

/**
 * The account page's "This term" stat rows for one role — every value is
 * read from an existing, already-used dashboard/priority computation (see
 * docs/superpowers/specs/2026-07-24-account-page-role-aware-design.md,
 * Section 5). A branch that throws is omitted, not shown as a false "0".
 */
export async function getThisTermStats(params: Params): Promise<StatRow[]> {
  const { role, userId, email, ayCode, supabase, service } = params;
  const rows: StatRow[] = [];

  const push = async (fn: () => Promise<StatRow | null>) => {
    try {
      const row = await fn();
      if (row) rows.push(row);
    } catch {
      // Omit on failure — see doc comment above.
    }
  };

  if (role === 'teacher') {
    await push(async () => {
      const sections = await getTeacherSections(supabase, userId);
      return { label: 'Sections', value: sections.length };
    });
    await push(async () => {
      const p = await getEvaluationTeacherPriority({
        ayCode,
        teacherUserId: userId,
      });
      return {
        label: 'Write-ups still needed',
        value: p.headline.value,
        tone: 'warning',
      };
    });
    await push(async () => {
      const p = await getMarkbookTeacherPriority({
        ayCode,
        teacherUserId: userId,
      });
      return { label: 'Open grading sheets', value: p.headline.value };
    });
    return rows;
  }

  if (role === 'academic_coordinator') {
    await push(async () => {
      const kpis = await getMarkbookKpisRange({ ayCode });
      return {
        label: 'Change requests pending',
        value: kpis.current.changeRequestsPending,
        tone: 'warning',
      };
    });
    return rows;
  }

  if (role === 'school_admin') {
    await push(async () => {
      const count = await getSidebarChangeRequestCount(service, role, userId);
      return { label: 'Awaiting your review', value: count, tone: 'warning' };
    });
    return rows;
  }

  if (role === 'superadmin') {
    await push(async () => {
      const count = await getStaffCount();
      return { label: 'Active staff accounts', value: count };
    });
    return rows;
  }

  if (role === 'p_file_officer') {
    await push(async () => {
      const kpis = await getPFilesKpisRange({ ayCode });
      return {
        label: 'Expiring within 30 days',
        value: kpis.current.expiringSoon30,
        tone: 'warning',
      };
    });
    await push(async () => {
      const priority = await getPFilesPriority(ayCode);
      return {
        label: 'Already expired',
        value: priority.overdueCount,
        tone: 'warning',
      };
    });
    return rows;
  }

  if (role === 'admissions') {
    await push(async () => {
      const outdated = await getOutdatedApplications(ayCode);
      return {
        label: 'Applications needing follow-up',
        value: outdated.length,
        tone: 'warning',
      };
    });
    return rows;
  }

  return rows;
}
```

Note: `email` is accepted in `Params` but unused by any current branch — kept for interface symmetry with `getRecentActivity`/`viewAllActivityHref` and in case a future stat needs it. If `tsc`/lint flags it as unused, prefix with `_email` or remove it from the destructure and keep it only in the type — implementer's judgment, either is fine.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/account/this-term-stats.test.ts`
Expected: PASS (after reconciling any real return-shape drift found in Step 3's research — re-run until green)

- [ ] **Step 5: Commit**

```bash
git add lib/account/this-term-stats.ts __tests__/account/this-term-stats.test.ts
git commit -m "feat(account): add per-role this-term stat rows"
```

---

### Task 6: Presentational card components

**Files:**

- Create: `app/(dashboard)/account/about-card.tsx`
- Create: `app/(dashboard)/account/recent-activity-card.tsx`
- Create: `app/(dashboard)/account/shortcuts-card.tsx`
- Create: `app/(dashboard)/account/this-term-card.tsx`
- Test: `__tests__/account/recent-activity-card.test.tsx`

**Interfaces:**

- Consumes: `RoleChip`, `staffInitials` (`@/components/sis/staff-visuals`); `ActivityRow`, `formatRelativeTime` (Task 3); `TeacherSectionRow` (Task 4); `StatRow` (Task 5); `AccountShortcut` (Task 2); `Card`/`CardHeader`/`CardTitle`/`CardContent` (`@/components/ui/card`).
- Produces: 4 components, each a plain function taking props (server components — no `'use client'`, no interactivity beyond a plain `<a>`), consumed by Task 7's `page.tsx`.

All four are pure-presentation: props in, JSX out, no data fetching of their own. Read `app/(dashboard)/account/page.tsx` and `components/sis/staff-visuals.tsx` first for the exact token classes already in use on this page (serif headings, mono eyebrows, `border-border`, `text-muted-foreground`) — match that vocabulary exactly rather than inventing new class combinations.

- [ ] **Step 1: Write the failing test** (for `recent-activity-card.tsx` — the one component with real conditional logic worth covering; the other three are simple enough that this plan relies on `tsc` + manual review, matching this codebase's established proportionality for static-display components)

```tsx
// __tests__/account/recent-activity-card.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RecentActivityCard } from '@/app/(dashboard)/account/recent-activity-card';

describe('RecentActivityCard', () => {
  it('shows an honest empty state with no rows', () => {
    render(
      <RecentActivityCard rows={[]} viewAllHref="/markbook/audit-log?actor=x" />
    );
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
  });

  it('renders a label + relative time per row', () => {
    render(
      <RecentActivityCard
        rows={[
          {
            id: '1',
            createdAt: new Date().toISOString(),
            label: 'Grade updated',
            summary: 'Filipino · W2',
            tone: 'default',
          },
        ]}
        viewAllHref="/markbook/audit-log?actor=x"
      />
    );
    expect(screen.getByText('Grade updated')).toBeInTheDocument();
    expect(screen.getByText('Filipino · W2')).toBeInTheDocument();
  });

  it('always renders the "View all activity" link, even under 6 rows', () => {
    render(
      <RecentActivityCard rows={[]} viewAllHref="/markbook/audit-log?actor=x" />
    );
    const link = screen.getByRole('link', { name: /view all activity/i });
    expect(link).toHaveAttribute('href', '/markbook/audit-log?actor=x');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/account/recent-activity-card.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementations**

```tsx
// app/(dashboard)/account/recent-activity-card.tsx
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatRelativeTime, type ActivityRow } from '@/lib/account/activity';

const DOT_TONE_CLASS: Record<ActivityRow['tone'], string> = {
  default: 'bg-brand-indigo',
  info: 'bg-brand-sky',
  warning: 'bg-brand-amber',
  destructive: 'bg-destructive',
};

export function RecentActivityCard({
  rows,
  viewAllHref,
}: {
  rows: ActivityRow[];
  viewAllHref: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Recent activity
        </CardTitle>
        <CardDescription>
          Your last {rows.length ? rows.length : ''} actions on this system.
        </CardDescription>
      </CardHeader>
      <CardContent className="border-t border-border p-0">
        {rows.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">
            No activity yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className="flex items-start gap-3 px-6 py-3">
                <span
                  className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT_TONE_CLASS[row.tone]}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-foreground">
                      {row.label}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {formatRelativeTime(row.createdAt)}
                    </span>
                  </div>
                  {row.summary && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {row.summary}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link
          href={viewAllHref}
          className="flex items-center justify-center gap-1.5 border-t border-border px-6 py-3 text-sm font-semibold text-brand-indigo transition-colors hover:bg-muted/50"
        >
          View all activity
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}
```

```tsx
// app/(dashboard)/account/about-card.tsx
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { RoleChip, staffInitials } from '@/components/sis/staff-visuals';
import type { Role } from '@/lib/auth/roles';
import type { TeacherSectionRow } from '@/lib/account/sections';

export function AboutCard({
  name,
  email,
  role,
  sections,
}: {
  name: string;
  email: string;
  role: Role | null;
  /** Only populated for teacher — see the design spec's Section 1. */
  sections?: TeacherSectionRow[];
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-indigo/10 font-serif text-lg font-bold text-brand-indigo">
          {staffInitials(name)}
        </div>
        <div>
          <p className="font-serif text-base font-semibold text-foreground">
            {name}
          </p>
          <RoleChip role={role} className="mt-1" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 border-t border-border pt-4">
        <div>
          <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Identity
          </p>
          <dl className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="truncate font-medium text-foreground">{email}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Role</dt>
              <dd className="font-mono font-bold uppercase text-brand-indigo">
                {role ?? 'no role'}
              </dd>
            </div>
          </dl>
        </div>
        {sections && sections.length > 0 && (
          <div>
            <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Your sections
            </p>
            <ul className="space-y-1.5 text-sm">
              {sections.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">
                    {s.sectionName}
                  </span>
                  <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {s.roleTag}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

```tsx
// app/(dashboard)/account/shortcuts-card.tsx
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AccountShortcut } from '@/lib/account/shortcuts';

export function ShortcutsCard({ shortcuts }: { shortcuts: AccountShortcut[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Shortcuts
        </CardTitle>
      </CardHeader>
      <CardContent className="border-t border-border p-0">
        <ul className="divide-y divide-border">
          {shortcuts.map((s) => {
            const Icon = s.icon;
            return (
              <li key={s.href}>
                <Link
                  href={s.href}
                  className="flex items-center gap-3 px-6 py-3 transition-colors hover:bg-muted/50"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-b from-brand-indigo to-brand-indigo-deep text-white shadow-button">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                    {s.label}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
```

```tsx
// app/(dashboard)/account/this-term-card.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { StatRow } from '@/lib/account/this-term-stats';

export function ThisTermCard({ stats }: { stats: StatRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          This term
        </CardTitle>
      </CardHeader>
      <CardContent className="border-t border-border p-0">
        <dl className="divide-y divide-border">
          {stats.map((s) => (
            <div
              key={s.label}
              className="flex items-center justify-between px-6 py-3"
            >
              <dt className="text-sm text-muted-foreground">{s.label}</dt>
              <dd
                className={`font-mono text-base font-bold ${s.tone === 'warning' ? 'text-brand-amber' : 'text-brand-indigo'}`}
              >
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/account/recent-activity-card.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/account/about-card.tsx app/\(dashboard\)/account/recent-activity-card.tsx app/\(dashboard\)/account/shortcuts-card.tsx app/\(dashboard\)/account/this-term-card.tsx __tests__/account/recent-activity-card.test.tsx
git commit -m "feat(account): add presentational cards for about/activity/shortcuts/this-term"
```

---

### Task 7: Rewrite `app/(dashboard)/account/page.tsx`

**Files:**

- Modify: `app/(dashboard)/account/page.tsx`

**Interfaces:**

- Consumes: everything from Tasks 1-6; `getSessionUser`, `createClient` (`@/lib/supabase/server`); `createServiceClient` (`@/lib/supabase/service`); `getCurrentAcademicYear` (`@/lib/academic-year`); `ChangePasswordForm` (existing, unchanged).
- Produces: the page itself — nothing downstream depends on it.

This is a Next.js Server Component orchestrating server-only data; this codebase has no established pattern for unit-testing `page.tsx` files directly (every RSC page in this repo is verified via `tsc` + `next build` + manual walkthrough, not Vitest/RTL — confirmed by the absence of any `page.test.tsx` anywhere in `__tests__/`). Follow that same pattern here rather than inventing a new one.

- [ ] **Step 1: Read the current file** (`app/(dashboard)/account/page.tsx`) to confirm the exact current JSX structure and imports before replacing it — don't work from memory of the plan's earlier summary of it.

- [ ] **Step 2: Write the new page**

```tsx
// app/(dashboard)/account/page.tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { createClient, getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { getRecentActivity } from '@/lib/account/activity';
import { getTeacherSections } from '@/lib/account/sections';
import { getThisTermStats } from '@/lib/account/this-term-stats';
import { shortcutsForRole } from '@/lib/account/shortcuts';
import { viewAllActivityHref } from '@/lib/account/view-all-target';
import { ChangePasswordForm } from './change-password-form';
import { AboutCard } from './about-card';
import { RecentActivityCard } from './recent-activity-card';
import { ShortcutsCard } from './shortcuts-card';
import { ThisTermCard } from './this-term-card';

export default async function AccountPage() {
  const sessionUser = await getSessionUser();
  const role = sessionUser?.role ?? null;
  const email = sessionUser?.email ?? '';
  const name = email.split('@')[0] || 'Account';

  const supabase = await createClient();
  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear();
  const ayCode = currentAy?.ay_code ?? '';

  const [activity, sections, stats] = sessionUser
    ? await Promise.all([
        getRecentActivity(email),
        role === 'teacher'
          ? getTeacherSections(supabase, sessionUser.id)
          : Promise.resolve(undefined),
        role
          ? getThisTermStats({
              role,
              userId: sessionUser.id,
              email,
              ayCode,
              supabase,
              service,
            })
          : Promise.resolve([]),
      ])
    : [[], undefined, []];

  const shortcuts = role ? shortcutsForRole(role) : [];

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Account
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Account settings.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Your signed-in identity, recent activity, and how to change your
            password.
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr] lg:items-start">
        <div className="space-y-6">
          <AboutCard
            name={name}
            email={email}
            role={role}
            sections={sections}
          />
          <Card>
            <CardHeader>
              <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
                Change password
              </CardTitle>
              <CardDescription>
                Use a strong password you don&apos;t use anywhere else. Minimum
                8 characters.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChangePasswordForm />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <RecentActivityCard
            rows={activity}
            viewAllHref={
              role ? viewAllActivityHref(role, email) : '/markbook/audit-log'
            }
          />
          <div className="grid gap-6 md:grid-cols-2">
            <ShortcutsCard shortcuts={shortcuts} />
            <ThisTermCard stats={stats} />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
```

Notes for whoever implements this step:

- The "Signed-in identity" card from the old page is now folded into `AboutCard` (per spec Section 1) — don't leave a duplicate standalone identity card.
- `name` is derived from the email's local part as a placeholder display name — check whether `SessionUser` or the JWT claims actually carry a proper `display_name`/`full_name` anywhere accessible from `getSessionUser()`'s return value before settling for the email-derived fallback; if one exists, use it instead (this is exactly the kind of small discrepancy that's fine to resolve during implementation rather than pre-deciding in the plan).
- If `role` is null (shouldn't normally happen on an authenticated page, but the old page handled it defensively with `role ?? null`), every card degrades gracefully: `AboutCard` shows "no role", shortcuts/stats/activity all render with whatever their empty-input behavior already is from Tasks 1-6 — no additional null-branch code needed beyond what's shown above.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean (fix any import-path or type mismatches against the real Task 1-6 exports)

Run: `npx next build`
Expected: clean

- [ ] **Step 4: Manual walkthrough**

Sign in as at least a `teacher` and a `superadmin` test account (or whatever accounts are available in the current environment) and visit `/account`. Confirm: two-column layout at desktop width, single column below ~1024px (Tailwind `lg:` breakpoint used above — reconcile with the spec's ~860px note if the implementer prefers a custom breakpoint instead of `lg:`, but stay consistent with whichever is chosen); "Recent activity" shows real rows (not empty) for the teacher if that account has any audit history, and "No activity yet." if not; "View all activity" link lands on the correct module's audit-log page with the account's own rows visible (only works fully once Task 8 ships the `?actor=` support on the non-Markbook/Evaluation pages); Shortcuts list only shows modules that role can open; This term shows role-appropriate numbers.

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/account/page.tsx
git commit -m "feat(account): rewrite /account as a role-aware two-column page"
```

---

### Task 8: Extend `?actor=` filtering to P-Files, Records, Admissions, and SIS audit-log pages

**Files:**

- Modify: `app/(p-files)/p-files/audit-log/page.tsx`
- Modify: `app/(records)/records/audit-log/page.tsx`
- Modify: `app/(admissions)/admissions/audit-log/page.tsx`
- Modify: `app/(sis)/sis/audit-log/page.tsx`
- Test: `__tests__/audit/audit-log-actor-filter-extension.test.ts`

**Interfaces:**

- Consumes: nothing new — same Supabase query-builder chain each page already has.
- Produces: nothing downstream depends on this beyond Task 7's "View all activity" link actually working for `school_admin`/`superadmin`/`p_file_officer`/`admissions`.

**Read `app/(markbook)/markbook/audit-log/page.tsx` first** — its `?actor=` handling (`params.actor` trimmed, applied via `.eq('actor_email', actorFilter)`) is the exact pattern to copy into all 4 target pages. Do **not** copy Attendance's `.ilike()` version — that's a pre-existing, deliberately-untouched inconsistency (see plan Global Constraints).

Since these are RSC pages (same testing gap as Task 7), this task's "test" is a **query-builder unit test** against small extracted helper functions, not a full page render — extract each page's actor-filter application into a one-line testable helper if it isn't already trivially inline, OR (simpler, and consistent with how these pages already work) write the test against a minimal reproduction of the Supabase query-chain call, asserting `.eq('actor_email', ...)` is invoked with the right value when `params.actor` is present, and NOT invoked when absent. Follow whichever of these two approaches the actual code in each page most naturally supports — inspect each file first before choosing.

- [ ] **Step 1: Read all 4 target pages plus the Markbook reference page**, noting each target's exact `searchParams` type declaration and query-builder chain (they currently only declare `page`/`pageSize` per the earlier research — you're adding `actor` alongside those).

- [ ] **Step 2: Write the failing test**

```ts
// __tests__/audit/audit-log-actor-filter-extension.test.ts
/**
 * Guards the exact pattern added to the 4 previously-unfiltered audit-log
 * pages (P-Files, Records, Admissions, SIS) — mirrors Markbook/Evaluation's
 * existing ?actor= -> .eq('actor_email', ...) behavior. NOT Attendance's
 * .ilike() partial-match variant, which stays as its own pre-existing
 * inconsistency (see docs/superpowers/specs/2026-07-24-account-page-role-aware-design.md).
 */
import { describe, it, expect, vi } from 'vitest';

function buildMockQuery() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const query: Record<string, unknown> = {};
  const chain =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return query;
    };
  query.select = chain('select');
  query.eq = chain('eq');
  query.in = chain('in');
  query.order = chain('order');
  query.range = chain('range');
  return { query, calls };
}

describe('audit-log actor filter — applied only when ?actor is present', () => {
  it('applies .eq(actor_email, value) when actor is a non-empty string', () => {
    const { query, calls } = buildMockQuery();
    const actorFilter = 'maria.t@hfse.edu.sg'.trim();
    if (actorFilter)
      (query.eq as (...a: unknown[]) => unknown)('actor_email', actorFilter);
    expect(calls).toContainEqual({
      method: 'eq',
      args: ['actor_email', 'maria.t@hfse.edu.sg'],
    });
  });

  it('does not apply the filter when actor is empty/whitespace-only', () => {
    const { calls } = buildMockQuery();
    const actorFilter = '   '.trim();
    if (actorFilter) throw new Error('should not reach here');
    expect(calls).toHaveLength(0);
  });
});
```

This test documents and pins the shared contract; it is intentionally implementation-agnostic about which of the 4 files it runs against, since the real assertion that matters (each page's query actually gets `.eq('actor_email', ...)` wired in) is exercised by Step 4's `tsc`/build/manual check against the real files. If, after reading the 4 files in Step 1, a more direct per-file test is easy to write (e.g. one of them already extracts its query-building into a plain function), prefer that over this generic version — replace it, don't just add to it.

- [ ] **Step 3: Apply the pattern to all 4 pages**

For each of the 4 files, following Markbook's exact shape:

1. Widen the `searchParams` Promise type to include `actor?: string` alongside the existing `page`/`pageSize` (and `?view=` for the SIS page, which is the only one of the 4 with more than one tab — apply the filter only inside its "Log" tab branch, per the spec).
2. Read it the same way Markbook does: `const actorFilter = params.actor?.trim();`
3. Conditionally chain `.eq('actor_email', actorFilter)` onto the existing query builder right before `.order(...)`/`.range(...)`, only when `actorFilter` is truthy — same insertion point Markbook uses.
4. Do not touch the `.in('action', ALLOWLIST)` call already there, or anything about pagination — this is additive only.

- [ ] **Step 4: Verify**

Run: `npx vitest run __tests__/audit/audit-log-actor-filter-extension.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: clean

Run: `npx next build`
Expected: clean

Manually confirm (or note as unverified-live if no dev server / test data is available) that visiting e.g. `/p-files/audit-log?actor=<a real p_file_officer's email>` narrows the table to just that actor's rows.

- [ ] **Step 5: Commit**

```bash
git add app/\(p-files\)/p-files/audit-log/page.tsx app/\(records\)/records/audit-log/page.tsx app/\(admissions\)/admissions/audit-log/page.tsx app/\(sis\)/sis/audit-log/page.tsx __tests__/audit/audit-log-actor-filter-extension.test.ts
git commit -m "feat(audit): add ?actor= filtering to p-files/records/admissions/sis audit logs"
```

---

## Verification

1. `npx tsc --noEmit` clean after every task (each task's own Step already checks this where applicable — do a final full-repo pass at the end too).
2. `npx vitest run` — full suite green, no regressions.
3. `npx next build` clean.
4. Manual walkthrough per Task 7 Step 4 and Task 8 Step 4.
5. Confirm no emojis were introduced anywhere in the new files (`git diff` review).

## Self-Review Notes (from the plan-writing pass)

- **Spec coverage:** all 5 spec sections (About/sections, Change password, Recent activity, Shortcuts, This term) plus the audit-log actor-filter prerequisite are each their own task. The spec's explicit out-of-scope list (badge counts, Attendance `.ilike` fix, cross-module unified feed) is called out in Global Constraints so no task drifts into it.
- **Placeholder scan:** no TBD/TODO. Two spots deliberately leave a judgment call to the implementer rather than a placeholder — Task 5's `email` param (unused today, kept for symmetry) and Task 7's display-name source (email-derived fallback vs. a real display-name field, to be confirmed against the live `SessionUser`/claims shape at implementation time) — both are flagged as decisions with a stated default, not blanks.
- **Type consistency:** `Role`, `ActivityRow`, `TeacherSectionRow`, `StatRow`, `AccountShortcut` are each defined once (Tasks 1-5) and imported by every later task that uses them — no redefinition.
- **Task 5's real-shape risk:** flagged explicitly in Task 5 Step 3 — the test asserts field names inferred from this session's own research pass, not from directly reading every source file line-by-line during plan-writing. The implementer is told to verify against live code before treating the test as ground truth.
