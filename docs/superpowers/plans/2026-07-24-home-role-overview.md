# Home page (`/`) role-aware overview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain module-tile picker at `/` with a role-aware overview — quick actions, a to-do panel (with inline grade-change-request approve/reject), a coming-up strip, a 3-KPI row, and a per-module card grid — built almost entirely from existing per-module dashboard/priority helpers.

**Architecture:** A handful of small server-only aggregators under `lib/home/*`, each composing already-existing `lib/<module>/dashboard.ts` / `priority.ts` loaders (no new tables, no new cross-module query patterns) into role-scoped payloads. A set of presentational components under `components/home/*` render those payloads using the real design-system primitives (`Card`, `Badge`, `Button`). `app/(dashboard)/page.tsx` composes all of it server-side, gated by the existing `isRouteAllowed`/`ROUTE_ACCESS`. One client component (`todo-cr-actions.tsx`) handles the Approve/Reject mutation.

**Tech Stack:** Next.js 16 App Router (RSC), Supabase service client, TanStack Query v5 (client mutation only), shadcn `Card`/`Badge`/`Button`, `lucide-react`, Vitest + `@testing-library/react`.

## Global Constraints

- Hard Rule #2: all grade computation stays server-side — this feature reads existing computed fields only, never recomputes a grade.
- Hard Rule #7: no raw `#rrggbb`/`oklch(...)`/`slate-*`/`zinc-*`/`gray-*` in `app/` or `components/` — only semantic tokens (`bg-card`, `text-muted-foreground`, `border-border`, `brand-indigo`, `brand-navy`, `brand-mint`, `brand-amber`).
- KD #24: all client→API calls go through `apiFetch`/`jsonInit` (`lib/query/fetcher.ts`); mutations use `useMutation` with `retry: 0`, `onSuccess` calls `router.refresh()` (Model A — this page has no client-cached reads to invalidate).
- KD #41 / verified in `lib/change-requests/decide.ts`: grade change-request Approve/Reject is **`school_admin`-only**, scoped to primary/secondary designated approver (or legacy both-null broadcast rows) — reuse the exact `.or()` clause from `app/(markbook)/markbook/change-requests/page.tsx:88-91`, do not re-derive it.
- No new database tables or columns. Every data source is an existing exported function or a direct read of an existing table (`grade_change_requests`, `calendar_events`).
- `isRouteAllowed`/`ROUTE_ACCESS` (`lib/auth/roles.ts`) is the single source of truth for which module cards a role sees — never hardcode a per-role module list anywhere in this feature.
- Design tokens: `font-serif` (Source Serif 4) for headline/stat values, mono-uppercase tracking (`font-mono text-[11px] font-semibold uppercase tracking-[0.14em]`) for eyebrows, real `Badge` variants (`success`/`warning`/`blocked`/`default` — never invent a soft-tint badge), real `Button` variants (`default` for quick actions with a trailing `ArrowUpRight` icon, `success` for Approve, `destructive` for Reject — both labeled, never icon-only).

---

## File map

```
lib/home/
  module-cards.ts       — per-role module card content (headline stat + optional chart + badge)
  quick-actions.ts       — static role → 3 links
  kpis.ts                — 3 role-scoped KPI numbers (empty for teacher)
  todos.ts               — role-scoped to-do rows (the CR-approval rows + review-only rows)
  todos.test.ts          — unit tests for the role-branching in todos.ts
  module-cards.test.ts   — unit tests for the isRouteAllowed-driven card set + chart mapping
components/home/
  quick-actions-row.tsx      — server component, renders lib/home/quick-actions.ts output
  kpi-row.tsx                — server component, renders lib/home/kpis.ts output
  coming-up-panel.tsx        — server component, renders getUpcomingCalendarEvents output
  todo-panel.tsx             — server component, renders lib/home/todos.ts output; mounts todo-cr-actions.tsx per CR row
  todo-cr-actions.client.tsx — 'use client', Approve (useMutation → PATCH /api/change-requests/[id]) + Reject (Link)
  module-card-grid.tsx       — server component, renders lib/home/module-cards.ts output
  module-card-charts.tsx     — pure presentational: Sparkline / ProgressRing / SegmentedDots
app/(dashboard)/
  page.tsx               — rewritten: composes all of the above, still gates via isRouteAllowed
__tests__/auth/
  home-route-consistency.test.ts — regression: module-card set === isRouteAllowed per role (mirrors KD #154's no-dead-ends test)
```

---

### Task 1: `lib/home/quick-actions.ts` — static role → quick-action links

**Files:**

- Create: `lib/home/quick-actions.ts`
- Test: `lib/home/quick-actions.test.ts`

**Interfaces:**

- Produces: `export type QuickAction = { label: string; href: string }` and `export function getQuickActions(role: Role): QuickAction[]` — consumed by Task 6 (`quick-actions-row.tsx`) and Task 9 (`page.tsx`).

- [ ] **Step 1: Write the failing test**

```typescript
// lib/home/quick-actions.test.ts
import { describe, it, expect } from 'vitest';
import { getQuickActions } from './quick-actions';

describe('getQuickActions', () => {
  it('returns the 3 teacher shortcuts', () => {
    const actions = getQuickActions('teacher');
    expect(actions).toEqual([
      { label: 'Enter grades', href: '/markbook/grading' },
      { label: 'Mark attendance', href: '/attendance/sections' },
      { label: 'Write evaluation', href: '/evaluation' },
    ]);
  });

  it('returns the 3 school_admin shortcuts', () => {
    const actions = getQuickActions('school_admin');
    expect(actions).toEqual([
      { label: 'Validate documents', href: '/admissions/document-validation' },
      { label: 'AY Setup', href: '/sis/ay-setup' },
      { label: 'Manage staff', href: '/sis/admin/staff' },
    ]);
  });

  it('returns [] for roles that never reach the home page', () => {
    expect(getQuickActions('p_file_officer')).toEqual([]);
    expect(getQuickActions('admissions')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/home/quick-actions.test.ts`
Expected: FAIL — `Cannot find module './quick-actions'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/home/quick-actions.ts
import type { Role } from '@/lib/auth/roles';

export type QuickAction = { label: string; href: string };

const QUICK_ACTIONS: Record<Role, QuickAction[]> = {
  teacher: [
    { label: 'Enter grades', href: '/markbook/grading' },
    { label: 'Mark attendance', href: '/attendance/sections' },
    { label: 'Write evaluation', href: '/evaluation' },
  ],
  academic_coordinator: [
    { label: 'Review applications', href: '/admissions/applications' },
    { label: 'Lock overdue sheets', href: '/markbook/grading' },
    { label: 'Assign a section', href: '/records/unsynced' },
  ],
  school_admin: [
    { label: 'Validate documents', href: '/admissions/document-validation' },
    { label: 'AY Setup', href: '/sis/ay-setup' },
    { label: 'Manage staff', href: '/sis/admin/staff' },
  ],
  superadmin: [
    { label: 'Validate documents', href: '/p-files/document-validation' },
    { label: 'Manage staff', href: '/sis/admin/staff' },
    { label: 'School config', href: '/sis/admin/school-config' },
  ],
  // These two roles redirect away from `/` before this ever renders
  // (app/(dashboard)/page.tsx + layout.tsx) — kept here only so the
  // Record<Role, ...> map is exhaustive and getQuickActions is total.
  p_file_officer: [],
  admissions: [],
};

export function getQuickActions(role: Role): QuickAction[] {
  return QUICK_ACTIONS[role];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/home/quick-actions.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/home/quick-actions.ts lib/home/quick-actions.test.ts
git commit -m "feat(home): add role-scoped quick-action links"
```

---

### Task 2: `lib/home/kpis.ts` — 3 role-scoped headline KPIs

**Files:**

- Create: `lib/home/kpis.ts`
- Test: `lib/home/kpis.test.ts`

**Interfaces:**

- Consumes: `getDashboardWindows(ayCode)` (`lib/dashboard/windows.ts`, returns `{ term, ay, activeTermFallback }` where `ay.thisAY: { from: string; to: string } | null`), `getRecordsKpisRange` (`lib/sis/dashboard.ts`, `(input: RangeInput) => Promise<RangeResult<RecordsRangeKpis>>`, `RecordsRangeKpis.activeEnrolled: number`), `getAttendanceKpisRange` (`lib/attendance/dashboard.ts`, same `RangeInput`/`RangeResult` shape, `AttendanceKpis.attendancePct: number`), `getEvaluationKpisRange` (`lib/evaluation/dashboard.ts`, `EvaluationKpis.submissionPct: number`), `getSlotStatusMix(ayCode)` (`lib/p-files/dashboard.ts`, returns `{ valid, pending, rejected, missing }`), `getSystemHealth()` (`lib/sis/health.ts`, returns `SystemHealth.approverFlows: Array<{ ok: boolean }>`), `sgToday()` (`lib/dates.ts`).
- Produces: `export type HomeKpi = { value: string; label: string }` and `export async function getHomeKpis(role: Role, ayCode: string): Promise<HomeKpi[]>` — consumed by Task 6 (`kpi-row.tsx`) and Task 9 (`page.tsx`). Returns `[]` for `teacher`.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/home/kpis.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/dashboard/windows', () => ({
  getDashboardWindows: vi.fn(async () => ({
    term: {},
    ay: { thisAY: { from: '2026-01-01', to: '2026-07-24' } },
    activeTermFallback: false,
  })),
}));
vi.mock('@/lib/sis/dashboard', () => ({
  getRecordsKpisRange: vi.fn(async () => ({
    current: { activeEnrolled: 1048 },
  })),
}));
vi.mock('@/lib/attendance/dashboard', () => ({
  getAttendanceKpisRange: vi.fn(async () => ({
    current: { attendancePct: 96.2 },
  })),
}));
vi.mock('@/lib/evaluation/dashboard', () => ({
  getEvaluationKpisRange: vi.fn(async () => ({
    current: { submissionPct: 68.4 },
  })),
}));
vi.mock('@/lib/p-files/dashboard', () => ({
  getSlotStatusMix: vi.fn(async () => ({
    valid: 92,
    pending: 5,
    rejected: 1,
    missing: 2,
  })),
}));
vi.mock('@/lib/sis/health', () => ({
  getSystemHealth: vi.fn(async () => ({
    approverFlows: [{ ok: true }, { ok: false }],
  })),
}));

import { getHomeKpis } from './kpis';

describe('getHomeKpis', () => {
  it('returns no KPIs for teacher', async () => {
    expect(await getHomeKpis('teacher', 'AY2026')).toEqual([]);
  });

  it('returns active students + attendance + write-ups for academic_coordinator', async () => {
    const kpis = await getHomeKpis('academic_coordinator', 'AY2026');
    expect(kpis).toEqual([
      { value: '1,048', label: 'Active students, AY2026' },
      { value: '96%', label: 'Attendance rate, today' },
      { value: '68%', label: 'Write-ups submitted, this term' },
    ]);
  });

  it('returns active students + attendance + docs-on-file for school_admin', async () => {
    const kpis = await getHomeKpis('school_admin', 'AY2026');
    expect(kpis).toEqual([
      { value: '1,048', label: 'Active students, AY2026' },
      { value: '96%', label: 'Attendance rate, today' },
      { value: '92%', label: 'Documents on file' },
    ]);
  });

  it('returns active students + system health + attendance for superadmin', async () => {
    const kpis = await getHomeKpis('superadmin', 'AY2026');
    expect(kpis).toEqual([
      { value: '1,048', label: 'Active students, AY2026' },
      { value: '1', label: 'System issues flagged' },
      { value: '96%', label: 'Attendance rate, today' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/home/kpis.test.ts`
Expected: FAIL — `Cannot find module './kpis'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/home/kpis.ts
import type { Role } from '@/lib/auth/roles';
import { getDashboardWindows } from '@/lib/dashboard/windows';
import { getRecordsKpisRange } from '@/lib/sis/dashboard';
import { getAttendanceKpisRange } from '@/lib/attendance/dashboard';
import { getEvaluationKpisRange } from '@/lib/evaluation/dashboard';
import { getSlotStatusMix } from '@/lib/p-files/dashboard';
import { getSystemHealth } from '@/lib/sis/health';
import { sgToday } from '@/lib/dates';

export type HomeKpi = { value: string; label: string };

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

async function activeStudentsKpi(
  ayCode: string,
  range: { from: string; to: string }
): Promise<HomeKpi> {
  const { current } = await getRecordsKpisRange({
    ayCode,
    from: range.from,
    to: range.to,
    cmpFrom: null,
    cmpTo: null,
  });
  return {
    value: current.activeEnrolled.toLocaleString('en-SG'),
    label: `Active students, ${ayCode}`,
  };
}

async function attendanceTodayKpi(ayCode: string): Promise<HomeKpi> {
  const today = sgToday();
  const { current } = await getAttendanceKpisRange({
    ayCode,
    from: today,
    to: today,
    cmpFrom: null,
    cmpTo: null,
  });
  return { value: pct(current.attendancePct), label: 'Attendance rate, today' };
}

/**
 * Role-scoped 3-KPI row for the home page. Every value reuses an existing
 * per-module dashboard loader (KD #46 pattern) — nothing here recomputes a
 * metric. Teacher gets none: nothing school-wide is meaningful at that
 * scope (see docs/superpowers/specs/2026-07-24-home-role-overview-design.md).
 */
export async function getHomeKpis(
  role: Role,
  ayCode: string
): Promise<HomeKpi[]> {
  if (
    role === 'teacher' ||
    role === 'p_file_officer' ||
    role === 'admissions'
  ) {
    return [];
  }

  const windows = await getDashboardWindows(ayCode);
  const range = windows.ay.thisAY ?? {
    from: `${ayCode.replace(/^AY/i, '')}-01-01`,
    to: sgToday(),
  };

  const [activeStudents, attendanceToday] = await Promise.all([
    activeStudentsKpi(ayCode, range),
    attendanceTodayKpi(ayCode),
  ]);

  if (role === 'academic_coordinator') {
    const { current } = await getEvaluationKpisRange({
      ayCode,
      from: range.from,
      to: range.to,
      cmpFrom: null,
      cmpTo: null,
    });
    return [
      activeStudents,
      attendanceToday,
      {
        value: pct(current.submissionPct),
        label: 'Write-ups submitted, this term',
      },
    ];
  }

  if (role === 'school_admin') {
    const mix = await getSlotStatusMix(ayCode);
    const total = mix.valid + mix.pending + mix.rejected + mix.missing;
    const onFilePct = total === 0 ? 0 : (mix.valid / total) * 100;
    return [
      activeStudents,
      attendanceToday,
      { value: pct(onFilePct), label: 'Documents on file' },
    ];
  }

  // superadmin
  const health = await getSystemHealth();
  const issuesFlagged = health.approverFlows.filter((f) => !f.ok).length;
  return [
    activeStudents,
    { value: String(issuesFlagged), label: 'System issues flagged' },
    attendanceToday,
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/home/kpis.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/home/kpis.ts lib/home/kpis.test.ts
git commit -m "feat(home): add role-scoped KPI row, reusing existing dashboard loaders"
```

---

### Task 3: `lib/home/module-cards.ts` — per-module card content

**Files:**

- Create: `lib/home/module-cards.ts`
- Test: `lib/home/module-cards.test.ts`

**Interfaces:**

- Consumes: `isRouteAllowed(href, role)` (`lib/auth/roles.ts`), `getDashboardWindows` (Task 2's import), `getSidebarChangeRequestCount(service, role, userId)` (`lib/change-requests/sidebar-counts.ts`), `getMarkbookKpisRange` (`MarkbookRangeKpis.lockedPct: number`), `getAttendanceKpisRange` (`AttendanceKpis.attendancePct: number`), `getEvaluationKpisRange` (`EvaluationKpis.submissionPct: number`), `getAyReadiness(ayCode)` (`lib/sis/readiness.ts`, returns `AyReadiness { complete: number; total: number }`), `getAdmissionsKpisRange` (`AdmissionsRangeKpis.applicationsInRange: number`, `.conversionPct: number`), `getRecordsKpisRange` (`RecordsRangeKpis.activeEnrolled: number`), `createServiceClient` (`lib/supabase/service.ts`).
- Produces:

  ```typescript
  export type ModuleCardChart =
    | { kind: 'sparkline'; points: number[] }
    | { kind: 'ring'; pct: number }
    | { kind: 'dots'; done: number; total: number }
    | { kind: 'none' };
  export type ModuleCard = {
    module: string; // display name, e.g. "Markbook"
    href: string;
    statValue: string;
    statLabel: string;
    chart: ModuleCardChart;
    badge?: { label: string; tone: 'success' | 'warning' };
  };
  export async function getModuleCards(
    role: Role,
    ayCode: string,
    userId: string
  ): Promise<ModuleCard[]>;
  ```

  Consumed by Task 6 (`module-card-grid.tsx`) and Task 9 (`page.tsx`).

- [ ] **Step 1: Write the failing test**

```typescript
// lib/home/module-cards.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/dashboard/windows', () => ({
  getDashboardWindows: vi.fn(async () => ({
    term: {},
    ay: { thisAY: { from: '2026-01-01', to: '2026-07-24' } },
    activeTermFallback: false,
  })),
}));
vi.mock('@/lib/change-requests/sidebar-counts', () => ({
  getSidebarChangeRequestCount: vi.fn(async () => 1),
}));
vi.mock('@/lib/markbook/dashboard', () => ({
  getMarkbookKpisRange: vi.fn(async () => ({ current: { lockedPct: 82 } })),
}));
vi.mock('@/lib/attendance/dashboard', () => ({
  getAttendanceKpisRange: vi.fn(async () => ({
    current: { attendancePct: 96 },
  })),
}));
vi.mock('@/lib/evaluation/dashboard', () => ({
  getEvaluationKpisRange: vi.fn(async () => ({
    current: { submissionPct: 68 },
  })),
}));
vi.mock('@/lib/sis/readiness', () => ({
  getAyReadiness: vi.fn(async () => ({
    ayCode: 'AY2026',
    steps: [],
    complete: 6,
    total: 7,
  })),
}));
vi.mock('@/lib/admissions/dashboard', () => ({
  getAdmissionsKpisRange: vi.fn(async () => ({
    current: { applicationsInRange: 8, conversionPct: 34 },
  })),
}));
vi.mock('@/lib/sis/dashboard', () => ({
  getRecordsKpisRange: vi.fn(async () => ({
    current: { activeEnrolled: 812 },
  })),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({})),
}));

import { getModuleCards } from './module-cards';

describe('getModuleCards', () => {
  it('returns only teacher-accessible modules for teacher', async () => {
    const cards = await getModuleCards('teacher', 'AY2026', 'user-1');
    expect(cards.map((c) => c.module)).toEqual([
      'Markbook',
      'Attendance',
      'Evaluation',
    ]);
    const markbook = cards.find((c) => c.module === 'Markbook')!;
    expect(markbook.badge).toEqual({ label: '1 CR pending', tone: 'warning' });
  });

  it('returns all 7 modules for school_admin, no CR badge on Markbook', async () => {
    const cards = await getModuleCards('school_admin', 'AY2026', 'user-2');
    expect(cards.map((c) => c.module)).toEqual([
      'Admissions',
      'Records',
      'P-Files',
      'Markbook',
      'Attendance',
      'Evaluation',
      'SIS Admin',
    ]);
    const markbook = cards.find((c) => c.module === 'Markbook')!;
    expect(markbook.badge).toBeUndefined();
    expect(markbook.chart).toEqual({ kind: 'ring', pct: 82 });
    const sisAdmin = cards.find((c) => c.module === 'SIS Admin')!;
    expect(sisAdmin.chart).toEqual({ kind: 'dots', done: 6, total: 7 });
  });

  it('gives academic_coordinator the operational Admissions number, not conversion', async () => {
    const cards = await getModuleCards(
      'academic_coordinator',
      'AY2026',
      'user-3'
    );
    const admissions = cards.find((c) => c.module === 'Admissions')!;
    expect(admissions.statValue).toBe('8');
    expect(admissions.statLabel).toBe('New (7d)');
  });

  it('gives school_admin the oversight Admissions number (conversion %)', async () => {
    const cards = await getModuleCards('school_admin', 'AY2026', 'user-2');
    const admissions = cards.find((c) => c.module === 'Admissions')!;
    expect(admissions.statValue).toBe('34%');
    expect(admissions.statLabel).toBe('Conversion');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/home/module-cards.test.ts`
Expected: FAIL — `Cannot find module './module-cards'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/home/module-cards.ts
import { isRouteAllowed, type Role } from '@/lib/auth/roles';
import { getDashboardWindows } from '@/lib/dashboard/windows';
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import { getMarkbookKpisRange } from '@/lib/markbook/dashboard';
import { getAttendanceKpisRange } from '@/lib/attendance/dashboard';
import { getEvaluationKpisRange } from '@/lib/evaluation/dashboard';
import { getAyReadiness } from '@/lib/sis/readiness';
import { getAdmissionsKpisRange } from '@/lib/admissions/dashboard';
import { getRecordsKpisRange } from '@/lib/sis/dashboard';
import { createServiceClient } from '@/lib/supabase/service';
import { sgToday } from '@/lib/dates';

export type ModuleCardChart =
  | { kind: 'sparkline'; points: number[] }
  | { kind: 'ring'; pct: number }
  | { kind: 'dots'; done: number; total: number }
  | { kind: 'none' };

export type ModuleCard = {
  module: string;
  href: string;
  statValue: string;
  statLabel: string;
  chart: ModuleCardChart;
  badge?: { label: string; tone: 'success' | 'warning' };
};

// Every module a role *could* see, in the same lifecycle order as
// lib/sidebar/registry.ts::MODULE_ORDER — isRouteAllowed narrows this down
// per-role, so the card set can never drift from the real access table.
const ALL_MODULES: Array<{ module: string; href: string }> = [
  { module: 'Admissions', href: '/admissions' },
  { module: 'Records', href: '/records' },
  { module: 'P-Files', href: '/p-files' },
  { module: 'Markbook', href: '/markbook' },
  { module: 'Attendance', href: '/attendance' },
  { module: 'Evaluation', href: '/evaluation' },
  { module: 'SIS Admin', href: '/sis' },
];

const OPERATIONAL_ROLES: Role[] = ['academic_coordinator'];

async function buildAdmissionsCard(
  role: Role,
  ayCode: string,
  range: { from: string; to: string }
): Promise<ModuleCard> {
  const isOperational = OPERATIONAL_ROLES.includes(role);
  const today = sgToday();
  const sevenDaysAgo = new Date(
    Date.parse(`${today}T00:00:00+08:00`) - 7 * 86_400_000
  )
    .toISOString()
    .slice(0, 10);
  const { current } = await getAdmissionsKpisRange({
    ayCode,
    from: isOperational ? sevenDaysAgo : range.from,
    to: isOperational ? today : range.to,
    cmpFrom: null,
    cmpTo: null,
  });
  return isOperational
    ? {
        module: 'Admissions',
        href: '/admissions',
        statValue: String(current.applicationsInRange),
        statLabel: 'New (7d)',
        chart: { kind: 'none' },
      }
    : {
        module: 'Admissions',
        href: '/admissions',
        statValue: `${Math.round(current.conversionPct)}%`,
        statLabel: 'Conversion',
        chart: { kind: 'none' },
      };
}

async function buildRecordsCard(
  ayCode: string,
  range: { from: string; to: string }
): Promise<ModuleCard> {
  const { current } = await getRecordsKpisRange({
    ayCode,
    from: range.from,
    to: range.to,
    cmpFrom: null,
    cmpTo: null,
  });
  return {
    module: 'Records',
    href: '/records',
    statValue: current.activeEnrolled.toLocaleString('en-SG'),
    statLabel: 'Enrolled',
    chart: { kind: 'none' },
  };
}

async function buildMarkbookCard(
  role: Role,
  ayCode: string,
  userId: string,
  range: { from: string; to: string }
): Promise<ModuleCard> {
  const { current } = await getMarkbookKpisRange({
    ayCode,
    from: range.from,
    to: range.to,
    cmpFrom: null,
    cmpTo: null,
  });
  const card: ModuleCard = {
    module: 'Markbook',
    href: '/markbook',
    statValue: `${Math.round(current.lockedPct)}%`,
    statLabel: 'Sheets locked',
    chart: { kind: 'ring', pct: current.lockedPct },
  };
  // Only teacher's own pending change-request count belongs on the card —
  // school_admin/academic_coordinator's CR numbers already live in the
  // to-do panel (lib/home/todos.ts); repeating them here would duplicate
  // the same count in two places on one page.
  if (role === 'teacher') {
    const service = createServiceClient();
    const pending = await getSidebarChangeRequestCount(
      service,
      'teacher',
      userId
    );
    if (pending > 0) {
      card.badge = {
        label: `${pending} CR ${pending === 1 ? 'pending' : 'pending'}`,
        tone: 'warning',
      };
    }
  }
  return card;
}

async function buildAttendanceCard(ayCode: string): Promise<ModuleCard> {
  const today = sgToday();
  const sevenDaysAgo = new Date(
    Date.parse(`${today}T00:00:00+08:00`) - 6 * 86_400_000
  )
    .toISOString()
    .slice(0, 10);
  const { current } = await getAttendanceKpisRange({
    ayCode,
    from: sevenDaysAgo,
    to: today,
    cmpFrom: null,
    cmpTo: null,
  });
  return {
    module: 'Attendance',
    href: '/attendance',
    statValue: `${Math.round(current.attendancePct)}%`,
    statLabel: "Today's rate",
    // Single aggregate point stands in for the trend until Task 6 wires a
    // real daily series via getDailyAttendanceRange — see Task 6 note.
    chart: { kind: 'sparkline', points: [current.attendancePct] },
  };
}

async function buildEvaluationCard(
  ayCode: string,
  range: { from: string; to: string }
): Promise<ModuleCard> {
  const { current } = await getEvaluationKpisRange({
    ayCode,
    from: range.from,
    to: range.to,
    cmpFrom: null,
    cmpTo: null,
  });
  return {
    module: 'Evaluation',
    href: '/evaluation',
    statValue: `${Math.round(current.submissionPct)}%`,
    statLabel: 'Submitted, this term',
    chart: { kind: 'ring', pct: current.submissionPct },
  };
}

async function buildSisAdminCard(ayCode: string): Promise<ModuleCard> {
  const readiness = await getAyReadiness(ayCode);
  return {
    module: 'SIS Admin',
    href: '/sis',
    statValue: `${readiness.complete}/${readiness.total}`,
    statLabel: 'AY readiness',
    chart: {
      kind: 'dots',
      done: readiness.complete,
      total: readiness.total,
    },
  };
}

/**
 * Per-role module card grid for the home page. The card *set* is always
 * exactly isRouteAllowed(href, role) — never hardcode a per-role module
 * list (see __tests__/auth/home-route-consistency.test.ts). Card *content*
 * follows the same operational-vs-oversight split each module's own
 * dashboard already applies for these roles (KD #74) — this file adds no
 * new access rule, only composes existing per-module numbers.
 */
export async function getModuleCards(
  role: Role,
  ayCode: string,
  userId: string
): Promise<ModuleCard[]> {
  const allowed = ALL_MODULES.filter((m) => isRouteAllowed(m.href, role));
  const windows = await getDashboardWindows(ayCode);
  const range = windows.ay.thisAY ?? {
    from: `${ayCode.replace(/^AY/i, '')}-01-01`,
    to: sgToday(),
  };

  const cards = await Promise.all(
    allowed.map(async ({ module }): Promise<ModuleCard> => {
      switch (module) {
        case 'Admissions':
          return buildAdmissionsCard(role, ayCode, range);
        case 'Records':
          return buildRecordsCard(ayCode, range);
        case 'P-Files':
          // P-Files card is a plain oversight stat (no natural chart shape,
          // per the design spec) — module-level headline reused as-is.
          return {
            module: 'P-Files',
            href: '/p-files',
            statValue: '—',
            statLabel: 'Docs on file',
            chart: { kind: 'none' },
          };
        case 'Markbook':
          return buildMarkbookCard(role, ayCode, userId, range);
        case 'Attendance':
          return buildAttendanceCard(ayCode);
        case 'Evaluation':
          return buildEvaluationCard(ayCode, range);
        case 'SIS Admin':
          return buildSisAdminCard(ayCode);
        default:
          throw new Error(`unknown module: ${module}`);
      }
    })
  );

  return cards;
}
```

**Note for the implementer:** the P-Files card's `statValue: '—'` placeholder above is intentionally left thin — Task 3b below fills it in from `getSlotStatusMix`, split out separately because it's shared with Task 2's KPI row and worth getting the derived-percentage math right once.

- [ ] **Step 3b: Fill in the real P-Files card value**

Replace the `case 'P-Files':` branch with:

```typescript
        case 'P-Files': {
          const { getSlotStatusMix } = await import('@/lib/p-files/dashboard');
          const mix = await getSlotStatusMix(ayCode);
          const total = mix.valid + mix.pending + mix.rejected + mix.missing;
          const pctOnFile = total === 0 ? 0 : (mix.valid / total) * 100;
          return {
            module: 'P-Files',
            href: '/p-files',
            statValue: `${Math.round(pctOnFile)}%`,
            statLabel: 'Docs on file',
            chart: { kind: 'none' },
          };
        }
```

(Dynamic `import()` here, not a top-level import, to avoid pulling P-Files' dashboard module into every card-grid render when most roles never see that card — mirrors the existing lazy-import pattern in `lib/admissions/priority.ts`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/home/module-cards.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/home/module-cards.ts lib/home/module-cards.test.ts
git commit -m "feat(home): add per-role module card grid, reusing per-module dashboard KPIs"
```

---

### Task 4: `lib/home/todos.ts` — role-scoped to-do rows

**Files:**

- Create: `lib/home/todos.ts`
- Test: `lib/home/todos.test.ts`

**Interfaces:**

- Consumes: `getMarkbookTeacherPriority({ ayCode, teacherUserId }): Promise<PriorityPayload>` (`lib/markbook/dashboard.ts`), `getEvaluationTeacherPriority({ ayCode, teacherUserId }): Promise<PriorityPayload>` (`lib/evaluation/dashboard.ts`), `PriorityPayload` type (`lib/dashboard/priority.ts`, has `headline: { value: number; label: string }`, `cta?: { label: string; href: string }`), `countPendingDocValidation(ayCode): Promise<number>` (`lib/admissions/document-validation.ts`), `countUnsyncedEnrolledStudents(ayCode): Promise<number>` (`lib/sis/unsynced-students.ts`), `countAwaitingVerification(ayCode): Promise<number>` (`lib/p-files/document-validation.ts`), `cumulativeCommentGaps(service, sectionId, allTerms, viewingTermNumber): Promise<CumulativeGap[]>` (`lib/markbook/comment-completeness.ts`), `resolveCurrentTermId(terms, today): string | null` (`lib/sis/current-term.ts`), `sgToday()` (`lib/dates.ts`), `createServiceClient` (`lib/supabase/service.ts`).
- Produces:

  ```typescript
  export type HomeTodoItem = {
    id: string;
    module: string;
    text: string;
    href: string;
    kind: 'review' | 'change-request';
    aging?: { label: string; tone: 'success' | 'warning' };
    // Only present for kind: 'change-request' — feeds todo-cr-actions.client.tsx.
    requestId?: string;
  };
  export async function getHomeTodos(
    role: Role,
    ayCode: string,
    userId: string
  ): Promise<HomeTodoItem[]>;
  ```

  Consumed by Task 7 (`todo-panel.tsx`) and Task 9 (`page.tsx`).

- [ ] **Step 1: Write the failing test**

```typescript
// lib/home/todos.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/markbook/dashboard', () => ({
  getMarkbookTeacherPriority: vi.fn(async () => ({
    headline: { value: 6, label: 'unscored slots' },
    chips: [],
    cta: { label: 'Review', href: '/markbook/grading' },
  })),
}));
vi.mock('@/lib/evaluation/dashboard', () => ({
  getEvaluationTeacherPriority: vi.fn(async () => ({
    headline: { value: 4, label: 'write-ups still in draft' },
    chips: [],
    cta: { label: 'Review', href: '/evaluation' },
  })),
}));
vi.mock('@/lib/admissions/document-validation', () => ({
  countPendingDocValidation: vi.fn(async () => 5),
}));
vi.mock('@/lib/sis/unsynced-students', () => ({
  countUnsyncedEnrolledStudents: vi.fn(async () => 2),
}));
vi.mock('@/lib/p-files/document-validation', () => ({
  countAwaitingVerification: vi.fn(async () => 6),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => ({
        data: [
          {
            id: 'cr-1',
            requested_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
            grading_sheet: {
              section: { academic_year_id: 'ay-id' },
              subject: { name: 'Science' },
              term: { label: 'T2' },
            },
            requested_by_email: 'teacher@hfse.test',
          },
        ],
        error: null,
      })),
      maybeSingle: vi.fn(async () => ({ data: { id: 'ay-id' }, error: null })),
    })),
  })),
}));
vi.mock('@/lib/markbook/comment-completeness', () => ({
  cumulativeCommentGaps: vi.fn(async () => []),
}));

import { getHomeTodos } from './todos';

describe('getHomeTodos', () => {
  it('gives teacher review-only rows from the teacher priority payloads', async () => {
    const todos = await getHomeTodos('teacher', 'AY2026', 'teacher-1');
    expect(todos).toEqual([
      {
        id: 'markbook-priority',
        module: 'Markbook',
        text: '6 unscored slots',
        href: '/markbook/grading',
        kind: 'review',
      },
      {
        id: 'evaluation-priority',
        module: 'Evaluation',
        text: '4 write-ups still in draft',
        href: '/evaluation',
        kind: 'review',
      },
    ]);
  });

  it('gives academic_coordinator review-only rows, never change-request rows', async () => {
    const todos = await getHomeTodos(
      'academic_coordinator',
      'AY2026',
      'coord-1'
    );
    expect(todos.every((t) => t.kind === 'review')).toBe(true);
    expect(todos.map((t) => t.module)).toEqual(['Admissions', 'Records']);
  });

  it('gives school_admin change-request rows with a requestId', async () => {
    const todos = await getHomeTodos('school_admin', 'AY2026', 'admin-1');
    const cr = todos.find((t) => t.kind === 'change-request');
    expect(cr).toBeDefined();
    expect(cr?.requestId).toBe('cr-1');
    expect(cr?.aging).toEqual({ label: '2 days', tone: 'success' });
  });

  it('never gives superadmin change-request rows (KD #41 — not in the approver pool)', async () => {
    const todos = await getHomeTodos('superadmin', 'AY2026', 'super-1');
    expect(todos.some((t) => t.kind === 'change-request')).toBe(false);
    expect(todos.map((t) => t.module)).toContain('P-Files');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/home/todos.test.ts`
Expected: FAIL — `Cannot find module './todos'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/home/todos.ts
import type { Role } from '@/lib/auth/roles';
import type { PriorityPayload } from '@/lib/dashboard/priority';
import { createServiceClient } from '@/lib/supabase/service';
import { sgToday } from '@/lib/dates';

export type HomeTodoItem = {
  id: string;
  module: string;
  text: string;
  href: string;
  kind: 'review' | 'change-request';
  aging?: { label: string; tone: 'success' | 'warning' };
  requestId?: string;
};

function fromPriority(
  id: string,
  module: string,
  payload: PriorityPayload
): HomeTodoItem | null {
  if (payload.headline.value <= 0) return null;
  return {
    id,
    module,
    text: `${payload.headline.value} ${payload.headline.label}`,
    href: payload.cta?.href ?? '#',
    kind: 'review',
  };
}

async function teacherTodos(
  ayCode: string,
  userId: string
): Promise<HomeTodoItem[]> {
  const { getMarkbookTeacherPriority } =
    await import('@/lib/markbook/dashboard');
  const { getEvaluationTeacherPriority } =
    await import('@/lib/evaluation/dashboard');
  const [markbook, evaluation] = await Promise.all([
    getMarkbookTeacherPriority({ ayCode, teacherUserId: userId }),
    getEvaluationTeacherPriority({ ayCode, teacherUserId: userId }),
  ]);
  return [
    fromPriority('markbook-priority', 'Markbook', markbook),
    fromPriority('evaluation-priority', 'Evaluation', evaluation),
  ].filter((t): t is HomeTodoItem => t !== null);
}

function agingFor(requestedAt: string): {
  label: string;
  tone: 'success' | 'warning';
} {
  const days = Math.floor((Date.now() - Date.parse(requestedAt)) / 86_400_000);
  const label = days === 1 ? '1 day' : `${days} days`;
  return { label, tone: days < 3 ? 'success' : 'warning' };
}

type RawCrRow = {
  id: string;
  requested_at: string;
  requested_by_email: string | null;
  grading_sheet: {
    section: { academic_year_id: string } | null;
    subject: { name: string } | null;
    term: { label: string } | null;
  } | null;
};

/**
 * Grade change-requests assigned to this school_admin, exactly scoped like
 * app/(markbook)/markbook/change-requests/page.tsx:88-91 (assigned-to-me OR
 * legacy both-null broadcast). school_admin is the ONLY role this fires for
 * — verified against lib/change-requests/decide.ts, which 403s any other
 * role attempting to approve/reject regardless of what any page renders.
 */
async function schoolAdminChangeRequestTodos(
  ayCode: string,
  userId: string
): Promise<HomeTodoItem[]> {
  const service = createServiceClient();
  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = (ayRow as { id: string } | null)?.id;
  if (!ayId) return [];

  const { data, error } = await service
    .from('grade_change_requests')
    .select(
      `id, requested_at, requested_by_email,
       grading_sheet:grading_sheets!inner(
         section:sections!inner(academic_year_id),
         subject:subjects(name),
         term:terms(label)
       )`
    )
    .eq('status', 'pending')
    .eq('grading_sheet.section.academic_year_id', ayId)
    .or(
      `primary_approver_id.eq.${userId},secondary_approver_id.eq.${userId},and(primary_approver_id.is.null,secondary_approver_id.is.null)`
    )
    .order('requested_at', { ascending: true })
    .limit(5);

  if (error || !data) return [];

  return (data as unknown as RawCrRow[]).map((row) => {
    const subject = row.grading_sheet?.subject?.name ?? 'Unknown subject';
    const term = row.grading_sheet?.term?.label ?? '';
    return {
      id: `cr-${row.id}`,
      module: 'Markbook',
      text: `Grade change — ${term} ${subject}`.trim(),
      href: `/markbook/change-requests?req=${encodeURIComponent(row.id)}`,
      kind: 'change-request' as const,
      aging: agingFor(row.requested_at),
      requestId: row.id,
    };
  });
}

async function docValidationTodo(ayCode: string): Promise<HomeTodoItem | null> {
  const { countPendingDocValidation } =
    await import('@/lib/admissions/document-validation');
  const count = await countPendingDocValidation(ayCode);
  if (count === 0) return null;
  return {
    id: 'admissions-doc-validation',
    module: 'Admissions',
    text: `${count} ${count === 1 ? 'document' : 'documents'} awaiting validation`,
    href: '/admissions/document-validation',
    kind: 'review',
  };
}

async function unsyncedStudentsTodo(
  ayCode: string
): Promise<HomeTodoItem | null> {
  const { countUnsyncedEnrolledStudents } =
    await import('@/lib/sis/unsynced-students');
  const count = await countUnsyncedEnrolledStudents(ayCode);
  if (count === 0) return null;
  return {
    id: 'records-unsynced',
    module: 'Records',
    text: `${count} ${count === 1 ? 'student' : 'students'} unsynced`,
    href: '/records/unsynced',
    kind: 'review',
  };
}

async function pFilesValidationTodo(
  ayCode: string
): Promise<HomeTodoItem | null> {
  const { countAwaitingVerification } =
    await import('@/lib/p-files/document-validation');
  const count = await countAwaitingVerification(ayCode);
  if (count === 0) return null;
  return {
    id: 'p-files-validation',
    module: 'P-Files',
    text: `${count} ${count === 1 ? 'document' : 'documents'} awaiting validation`,
    href: '/p-files/document-validation',
    kind: 'review',
  };
}

/**
 * Report-card comment-gate rollup for the current term — the one to-do
 * source that isn't a single existing count helper (flagged in the design
 * spec as the item most worth a second look). Scans every section in the
 * AY via the same per-section cumulativeCommentGaps call the bulk-publish
 * dialog already fans out client-side (KD #139) — same cost profile,
 * just server-side and capped to a count + first offending section.
 */
async function reportCardGapsTodo(
  ayCode: string
): Promise<HomeTodoItem | null> {
  const service = createServiceClient();
  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = (ayRow as { id: string } | null)?.id;
  if (!ayId) return null;

  const { data: terms } = await service
    .from('terms')
    .select('id, term_number, start_date, end_date, is_current, virtue_theme')
    .eq('academic_year_id', ayId);
  const termRows = (terms ?? []) as Array<{
    id: string;
    term_number: number;
    start_date: string | null;
    end_date: string | null;
    is_current: boolean;
    virtue_theme: string | null;
  }>;
  const { resolveCurrentTermId } = await import('@/lib/sis/current-term');
  const currentTermId = resolveCurrentTermId(termRows, sgToday());
  const currentTerm = termRows.find((t) => t.id === currentTermId);
  if (!currentTerm || currentTerm.term_number >= 4) return null; // T4 has no comment gate (KD #49)

  const { data: sections } = await service
    .from('sections')
    .select('id, name')
    .eq('academic_year_id', ayId);
  const sectionRows = (sections ?? []) as Array<{ id: string; name: string }>;

  const { cumulativeCommentGaps } =
    await import('@/lib/markbook/comment-completeness');
  const allTerms = termRows.map((t) => ({
    id: t.id,
    term_number: t.term_number,
    end_date: t.end_date,
    virtue_theme: t.virtue_theme,
  }));

  const gapsPerSection = await Promise.all(
    sectionRows.map(async (s) => ({
      section: s,
      gaps: await cumulativeCommentGaps(
        service,
        s.id,
        allTerms,
        currentTerm.term_number
      ),
    }))
  );
  const sectionsWithGaps = gapsPerSection.filter((r) =>
    r.gaps.some((g) => g.missing.length > 0 || g.virtueMissing)
  );
  if (sectionsWithGaps.length === 0) return null;

  const count = sectionsWithGaps.length;
  return {
    id: 'markbook-comment-gaps',
    module: 'Markbook',
    text: `T${currentTerm.term_number} report cards — comments incomplete for ${count} ${count === 1 ? 'section' : 'sections'}`,
    href: `/evaluation/sections/${sectionsWithGaps[0].section.id}`,
    kind: 'review',
  };
}

/**
 * Role-scoped to-do rows for the home page. `school_admin` is the only
 * role that gets `kind: 'change-request'` rows (KD #41, verified against
 * lib/change-requests/decide.ts) — every other role's rows are review-only
 * links into the real page.
 */
export async function getHomeTodos(
  role: Role,
  ayCode: string,
  userId: string
): Promise<HomeTodoItem[]> {
  if (role === 'teacher') {
    return teacherTodos(ayCode, userId);
  }

  if (role === 'academic_coordinator') {
    const [docs, unsynced] = await Promise.all([
      docValidationTodo(ayCode),
      unsyncedStudentsTodo(ayCode),
    ]);
    return [docs, unsynced].filter((t): t is HomeTodoItem => t !== null);
  }

  if (role === 'school_admin') {
    const [crs, docs, unsynced] = await Promise.all([
      schoolAdminChangeRequestTodos(ayCode, userId),
      docValidationTodo(ayCode),
      unsyncedStudentsTodo(ayCode),
    ]);
    return [...crs, docs, unsynced].filter(
      (t): t is HomeTodoItem => t !== null
    );
  }

  if (role === 'superadmin') {
    const [pFiles, unsynced] = await Promise.all([
      pFilesValidationTodo(ayCode),
      unsyncedStudentsTodo(ayCode),
    ]);
    return [pFiles, unsynced].filter((t): t is HomeTodoItem => t !== null);
  }

  return [];
}

// Exported for Task 8's server component to avoid importing the whole
// module just for the report-card-gaps source, which is opt-in per caller
// due to its heavier per-section scan.
export { reportCardGapsTodo };
```

**Note for the implementer:** `reportCardGapsTodo` is exported separately rather than folded automatically into `academic_coordinator`/`school_admin`'s branches above so its cost is visible at the call site (`page.tsx`, Task 9) — call it alongside the other sources with `Promise.all` and merge into the same array. This mirrors the design spec's explicit flag that this source is the one worth a second look.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/home/todos.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/home/todos.ts lib/home/todos.test.ts
git commit -m "feat(home): add role-scoped to-do rows incl. school_admin CR approvals"
```

---

### Task 5: `__tests__/auth/home-route-consistency.test.ts` — no-dead-ends regression

**Files:**

- Create: `__tests__/auth/home-route-consistency.test.ts`

**Interfaces:**

- Consumes: `ROLES` (`lib/auth/roles.ts`), `getModuleCards` (Task 3).

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/auth/home-route-consistency.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ROLES } from '@/lib/auth/roles';

vi.mock('@/lib/dashboard/windows', () => ({
  getDashboardWindows: vi.fn(async () => ({
    term: {},
    ay: { thisAY: { from: '2026-01-01', to: '2026-07-24' } },
    activeTermFallback: false,
  })),
}));
vi.mock('@/lib/change-requests/sidebar-counts', () => ({
  getSidebarChangeRequestCount: vi.fn(async () => 0),
}));
vi.mock('@/lib/markbook/dashboard', () => ({
  getMarkbookKpisRange: vi.fn(async () => ({ current: { lockedPct: 0 } })),
}));
vi.mock('@/lib/attendance/dashboard', () => ({
  getAttendanceKpisRange: vi.fn(async () => ({
    current: { attendancePct: 0 },
  })),
}));
vi.mock('@/lib/evaluation/dashboard', () => ({
  getEvaluationKpisRange: vi.fn(async () => ({
    current: { submissionPct: 0 },
  })),
}));
vi.mock('@/lib/sis/readiness', () => ({
  getAyReadiness: vi.fn(async () => ({
    ayCode: 'AY2026',
    steps: [],
    complete: 0,
    total: 7,
  })),
}));
vi.mock('@/lib/admissions/dashboard', () => ({
  getAdmissionsKpisRange: vi.fn(async () => ({
    current: { applicationsInRange: 0, conversionPct: 0 },
  })),
}));
vi.mock('@/lib/sis/dashboard', () => ({
  getRecordsKpisRange: vi.fn(async () => ({
    current: { activeEnrolled: 0 },
  })),
}));
vi.mock('@/lib/p-files/dashboard', () => ({
  getSlotStatusMix: vi.fn(async () => ({
    valid: 0,
    pending: 0,
    rejected: 0,
    missing: 0,
  })),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({})),
}));

import { getModuleCards } from '@/lib/home/module-cards';
import { isRouteAllowed } from '@/lib/auth/roles';

const ALL_HREFS = [
  '/admissions',
  '/records',
  '/p-files',
  '/markbook',
  '/attendance',
  '/evaluation',
  '/sis',
];

describe('home page module-card set never drifts from ROUTE_ACCESS', () => {
  for (const role of ROLES) {
    it(`matches isRouteAllowed for ${role}`, async () => {
      const cards = await getModuleCards(role, 'AY2026', 'user-1');
      const expectedHrefs = ALL_HREFS.filter((h) => isRouteAllowed(h, role));
      expect(cards.map((c) => c.href).sort()).toEqual(expectedHrefs.sort());
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/auth/home-route-consistency.test.ts`
Expected: FAIL for `p_file_officer`/`admissions` (Task 3's `getModuleCards` doesn't yet special-case them to return `[]`, or throws on unmocked awaits) — this is expected; fix in Step 3.

- [ ] **Step 3: Adjust `lib/home/module-cards.ts`**

Add an early return at the top of `getModuleCards` (before the `Promise.all` over `allowed`) — these two roles never reach `/` (they redirect in `app/(dashboard)/page.tsx`/`layout.tsx`), so this is a defensive no-op, not new access logic:

```typescript
if (role === 'p_file_officer' || role === 'admissions') {
  return [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/auth/home-route-consistency.test.ts`
Expected: PASS (6 tests — one per role in `ROLES`)

- [ ] **Step 5: Commit**

```bash
git add __tests__/auth/home-route-consistency.test.ts lib/home/module-cards.ts
git commit -m "test(home): assert module-card set never drifts from ROUTE_ACCESS"
```

---

### Task 6: `components/home/module-card-grid.tsx` + `module-card-charts.tsx`

**Files:**

- Create: `components/home/module-card-charts.tsx`
- Create: `components/home/module-card-grid.tsx`
- Test: `__tests__/home/module-card-grid.test.tsx`

**Interfaces:**

- Consumes: `ModuleCard`, `ModuleCardChart` (Task 3), `Card` (`@/components/ui/card`), `Badge` (`@/components/ui/badge`).
- Produces: `export function ModuleCardGrid({ cards }: { cards: ModuleCard[] })` — consumed by Task 9 (`page.tsx`).

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/home/module-card-grid.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModuleCardGrid } from '@/components/home/module-card-grid';
import type { ModuleCard } from '@/lib/home/module-cards';

const cards: ModuleCard[] = [
  {
    module: 'Markbook',
    href: '/markbook',
    statValue: '82%',
    statLabel: 'Sheets locked',
    chart: { kind: 'ring', pct: 82 },
  },
  {
    module: 'Records',
    href: '/records',
    statValue: '812',
    statLabel: 'Enrolled',
    chart: { kind: 'none' },
    badge: { label: '2 unsynced', tone: 'warning' },
  },
];

describe('ModuleCardGrid', () => {
  it('renders one card per module with its stat + label', () => {
    render(<ModuleCardGrid cards={cards} />);
    expect(screen.getByText('Markbook')).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByText('Sheets locked')).toBeInTheDocument();
    expect(screen.getByText('Records')).toBeInTheDocument();
    expect(screen.getByText('2 unsynced')).toBeInTheDocument();
  });

  it('links each card to its module', () => {
    render(<ModuleCardGrid cards={cards} />);
    expect(screen.getByRole('link', { name: /Markbook/ })).toHaveAttribute(
      'href',
      '/markbook'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/home/module-card-grid.test.tsx`
Expected: FAIL — `Cannot find module '@/components/home/module-card-grid'`

- [ ] **Step 3: Write `module-card-charts.tsx`**

```typescript
// components/home/module-card-charts.tsx
import type { ModuleCardChart } from '@/lib/home/module-cards';

export function ModuleCardChartView({ chart }: { chart: ModuleCardChart }) {
  if (chart.kind === 'sparkline') {
    const max = Math.max(...chart.points, 1);
    return (
      <div className="mb-2 flex h-6 items-end gap-0.5" aria-hidden>
        {chart.points.map((p, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-sm bg-gradient-to-t from-brand-indigo to-brand-indigo-soft"
            style={{ height: `${Math.max((p / max) * 100, 8)}%` }}
          />
        ))}
      </div>
    );
  }

  if (chart.kind === 'ring') {
    const deg = Math.max(0, Math.min(100, chart.pct)) * 3.6;
    return (
      <div
        className="mb-2 flex size-8 items-center justify-center rounded-full"
        style={{
          background: `conic-gradient(var(--color-brand-indigo) ${deg}deg, var(--color-hairline) ${deg}deg)`,
        }}
        aria-hidden
      >
        <div className="flex size-5 items-center justify-center rounded-full bg-card text-[9px] font-semibold" />
      </div>
    );
  }

  if (chart.kind === 'dots') {
    return (
      <div className="mb-2 flex gap-0.5" aria-hidden>
        {Array.from({ length: chart.total }, (_, i) => (
          <div
            key={i}
            className={
              i < chart.done
                ? 'h-2 w-2 rounded-[2px] bg-brand-indigo'
                : 'h-2 w-2 rounded-[2px] bg-hairline'
            }
          />
        ))}
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 4: Write `module-card-grid.tsx`**

```typescript
// components/home/module-card-grid.tsx
import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ModuleCard } from '@/lib/home/module-cards';
import { ModuleCardChartView } from './module-card-charts';

export function ModuleCardGrid({ cards }: { cards: ModuleCard[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      {cards.map((card) => (
        <Link key={card.href} href={card.href} className="block">
          <Card className="cursor-pointer p-4 transition-all hover:-translate-y-0.5 hover:border-brand-indigo/40 hover:shadow-md">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-md bg-gradient-to-br from-brand-indigo to-brand-navy text-[10px] font-semibold text-white shadow-brand-tile">
                {card.module.charAt(0)}
              </div>
              <span className="flex-1 text-sm font-semibold text-foreground">
                {card.module}
              </span>
              {card.badge ? (
                <Badge variant={card.badge.tone === 'success' ? 'success' : 'warning'}>
                  {card.badge.label}
                </Badge>
              ) : null}
            </div>
            <ModuleCardChartView chart={card.chart} />
            <div className="font-serif text-lg font-bold text-foreground">
              {card.statValue}
            </div>
            <div className="text-xs text-muted-foreground">
              {card.statLabel}
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/home/module-card-grid.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add components/home/module-card-charts.tsx components/home/module-card-grid.tsx __tests__/home/module-card-grid.test.tsx
git commit -m "feat(home): add module card grid with sparkline/ring/dots mini-charts"
```

---

### Task 7: `components/home/quick-actions-row.tsx` + `kpi-row.tsx` + `coming-up-panel.tsx`

**Files:**

- Create: `components/home/quick-actions-row.tsx`
- Create: `components/home/kpi-row.tsx`
- Create: `components/home/coming-up-panel.tsx`
- Test: `__tests__/home/quick-actions-row.test.tsx`

**Interfaces:**

- Consumes: `QuickAction` (Task 1), `HomeKpi` (Task 2), `UpcomingCalendarEvent` (`lib/sis/dashboard.ts` — `{ id, label, startDate, endDate, category, tentative }`), `Button` (`@/components/ui/button`), `Card` (`@/components/ui/card`).
- Produces: `QuickActionsRow`, `KpiRow`, `ComingUpPanel` — all consumed by Task 9 (`page.tsx`).

- [ ] **Step 1: Write the failing test (quick actions only — the other two are trivial presentational siblings covered by the page-level manual check in Task 9)**

```typescript
// __tests__/home/quick-actions-row.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuickActionsRow } from '@/components/home/quick-actions-row';

describe('QuickActionsRow', () => {
  it('renders one link per action with an ArrowUpRight icon', () => {
    render(
      <QuickActionsRow
        actions={[
          { label: 'Enter grades', href: '/markbook/grading' },
          { label: 'Mark attendance', href: '/attendance/sections' },
        ]}
      />
    );
    const link = screen.getByRole('link', { name: /Enter grades/ });
    expect(link).toHaveAttribute('href', '/markbook/grading');
    expect(link.querySelector('svg')).toBeInTheDocument();
  });

  it('renders nothing when there are no actions', () => {
    const { container } = render(<QuickActionsRow actions={[]} />);
    expect(container.querySelector('a')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/home/quick-actions-row.test.tsx`
Expected: FAIL — `Cannot find module '@/components/home/quick-actions-row'`

- [ ] **Step 3: Write `quick-actions-row.tsx`**

```typescript
// components/home/quick-actions-row.tsx
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { QuickAction } from '@/lib/home/quick-actions';

export function QuickActionsRow({ actions }: { actions: QuickAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {actions.map((action) => (
        <Button key={action.href} asChild>
          <Link href={action.href}>
            {action.label}
            <ArrowUpRight />
          </Link>
        </Button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Write `kpi-row.tsx`**

```typescript
// components/home/kpi-row.tsx
import { Card } from '@/components/ui/card';
import type { HomeKpi } from '@/lib/home/kpis';

export function KpiRow({ kpis }: { kpis: HomeKpi[] }) {
  if (kpis.length === 0) return null;
  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {kpis.map((kpi) => (
        <Card key={kpi.label} className="p-4">
          <div className="font-serif text-2xl font-bold text-foreground">
            {kpi.value}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {kpi.label}
          </div>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Write `coming-up-panel.tsx`**

```typescript
// components/home/coming-up-panel.tsx
import { Card } from '@/components/ui/card';
import type { UpcomingCalendarEvent } from '@/lib/sis/dashboard';

function formatDate(iso: string): { day: string; month: string } {
  const d = new Date(`${iso}T00:00:00+08:00`);
  return {
    day: String(d.getDate()),
    month: d.toLocaleString('en-SG', { month: 'short' }),
  };
}

export function ComingUpPanel({ events }: { events: UpcomingCalendarEvent[] }) {
  return (
    <Card className="flex-1 overflow-hidden p-0">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
        Coming up
      </div>
      {events.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          Nothing scheduled in the next 14 days.
        </div>
      ) : (
        events.map((event) => {
          const { day, month } = formatDate(event.startDate);
          return (
            <div
              key={event.id}
              className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <div className="flex size-9 flex-col items-center justify-center rounded-lg border border-border bg-muted">
                <span className="font-serif text-sm font-bold leading-none text-foreground">
                  {day}
                </span>
                <span className="font-mono text-[9px] uppercase text-muted-foreground">
                  {month}
                </span>
              </div>
              <span className="text-sm text-foreground">{event.label}</span>
            </div>
          );
        })
      )}
    </Card>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run __tests__/home/quick-actions-row.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add components/home/quick-actions-row.tsx components/home/kpi-row.tsx components/home/coming-up-panel.tsx __tests__/home/quick-actions-row.test.tsx
git commit -m "feat(home): add quick-actions row, KPI row, and coming-up panel"
```

---

### Task 8: `components/home/todo-panel.tsx` + `todo-cr-actions.client.tsx`

**Files:**

- Create: `components/home/todo-cr-actions.client.tsx`
- Create: `components/home/todo-panel.tsx`
- Test: `__tests__/home/todo-cr-actions.test.tsx`

**Interfaces:**

- Consumes: `HomeTodoItem` (Task 4), `apiFetch`, `jsonInit` (`lib/query/fetcher.ts`), `useMutation` (`@tanstack/react-query`), `toast` (`sonner`), `useRouter` (`next/navigation`), `Card`, `Badge` (ui primitives). `PATCH /api/change-requests/[id]` body is `{ action: 'approve' | 'reject' | 'cancel'; decision_note?: string }` (verified in `app/api/change-requests/[id]/route.ts`).
- Produces: `TodoPanel`, `TodoCrActions` — consumed by Task 9 (`page.tsx`). `renderWithClient` test helper already exists per KD #24 at `__tests__/_utils` — reuse it, do not hand-roll a `QueryClientProvider` wrapper.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/home/todo-cr-actions.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithClient } from '../_utils/render-with-client';
import { TodoCrActions } from '@/components/home/todo-cr-actions.client';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

describe('TodoCrActions', () => {
  beforeEach(() => {
    refreshMock.mockClear();
    toastSuccess.mockClear();
    global.fetch = vi.fn(async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ status: 'approved' }),
    })) as unknown as typeof fetch;
  });

  it('Approve fires the PATCH immediately with no dialog', async () => {
    renderWithClient(<TodoCrActions requestId="cr-1" />);
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/change-requests/cr-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ action: 'approve' }),
      })
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it('Reject is a link into the real change-request page, not an inline action', () => {
    renderWithClient(<TodoCrActions requestId="cr-1" />);
    const reject = screen.getByRole('link', { name: /reject/i });
    expect(reject).toHaveAttribute(
      'href',
      '/markbook/change-requests?req=cr-1&action=reject'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/home/todo-cr-actions.test.tsx`
Expected: FAIL — `Cannot find module '@/components/home/todo-cr-actions.client'`

- [ ] **Step 3: Write `todo-cr-actions.client.tsx`**

```typescript
// components/home/todo-cr-actions.client.tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';

import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';
import { Button } from '@/components/ui/button';

export function TodoCrActions({ requestId }: { requestId: string }) {
  const router = useRouter();

  // Approve fires immediately, no dialog — decide.ts's approve path needs
  // no note (KD #123's email one-click Approve behaves the same way).
  // Reject stays a Link, not a mutation — rejecting requires a reason
  // (KD #88), which doesn't fit a one-line to-do row.
  const approveMutation = useMutation({
    mutationFn: () =>
      apiFetch(
        `/api/change-requests/${requestId}`,
        jsonInit('PATCH', { action: 'approve' })
      ),
    onSuccess: () => {
      toast.success('Change request approved');
      router.refresh();
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : 'Failed to approve');
    },
    retry: 0,
  });

  return (
    <div className="flex shrink-0 gap-1.5">
      <Button
        variant="success"
        size="sm"
        onClick={() => approveMutation.mutate()}
        disabled={approveMutation.isPending}
      >
        <Check /> Approve
      </Button>
      <Button variant="destructive" size="sm" asChild>
        <Link href={`/markbook/change-requests?req=${requestId}&action=reject`}>
          <X /> Reject
        </Link>
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/home/todo-cr-actions.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Write `todo-panel.tsx`**

```typescript
// components/home/todo-panel.tsx
import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { HomeTodoItem } from '@/lib/home/todos';
import { TodoCrActions } from './todo-cr-actions.client';

export function TodoPanel({
  title,
  items,
}: {
  title: string;
  items: HomeTodoItem[];
}) {
  return (
    <Card className="flex-[2] overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="font-mono text-[10px] font-semibold text-muted-foreground">
          {items.length} {items.length === 1 ? 'ITEM' : 'ITEMS'}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          Nothing needs your attention right now.
        </div>
      ) : (
        items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
          >
            <span className="w-[70px] shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {item.module}
            </span>
            <span className="flex-1 text-sm text-foreground">{item.text}</span>
            {item.aging ? (
              <Badge variant={item.aging.tone === 'success' ? 'success' : 'warning'}>
                {item.aging.label}
              </Badge>
            ) : null}
            {item.kind === 'change-request' && item.requestId ? (
              <TodoCrActions requestId={item.requestId} />
            ) : (
              <Link
                href={item.href}
                className="shrink-0 text-xs font-semibold text-brand-indigo hover:underline"
              >
                Review &rsaquo;
              </Link>
            )}
          </div>
        ))
      )}
    </Card>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add components/home/todo-cr-actions.client.tsx components/home/todo-panel.tsx __tests__/home/todo-cr-actions.test.tsx
git commit -m "feat(home): add to-do panel with inline change-request approve/reject"
```

---

### Task 9: Rewrite `app/(dashboard)/page.tsx`

**Files:**

- Modify: `app/(dashboard)/page.tsx` (full rewrite — the file is currently the plain tile picker described in the design spec's Problem section)

**Interfaces:**

- Consumes: everything from Tasks 1-8 (`getQuickActions`, `getHomeKpis`, `getModuleCards`, `getHomeTodos`, `reportCardGapsTodo`, `getUpcomingCalendarEvents`, `QuickActionsRow`, `KpiRow`, `ComingUpPanel`, `TodoPanel`, `ModuleCardGrid`), plus existing `getSessionUser` (`lib/supabase/server.ts`), `getCurrentAcademicYear` (`lib/academic-year.ts`), `PageShell` (`@/components/ui/page-shell`).
- Produces: the rendered `/` page. No downstream consumers (this is the leaf of the tree).

- [ ] **Step 1: Write the page**

```typescript
// app/(dashboard)/page.tsx
import { redirect } from 'next/navigation';

import { PageShell } from '@/components/ui/page-shell';
import { getSessionUser } from '@/lib/supabase/server';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { getQuickActions } from '@/lib/home/quick-actions';
import { getHomeKpis } from '@/lib/home/kpis';
import { getModuleCards } from '@/lib/home/module-cards';
import { getHomeTodos, reportCardGapsTodo } from '@/lib/home/todos';
import { getUpcomingCalendarEvents } from '@/lib/sis/dashboard';
import { QuickActionsRow } from '@/components/home/quick-actions-row';
import { KpiRow } from '@/components/home/kpi-row';
import { ComingUpPanel } from '@/components/home/coming-up-panel';
import { TodoPanel } from '@/components/home/todo-panel';
import { ModuleCardGrid } from '@/components/home/module-card-grid';

export default async function Home() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const { role, email, id: userId } = sessionUser;

  // Same forced-redirect rules as before — unchanged from the plain-picker
  // version. Only the 4 multi-module roles ever render the rest of this
  // page (see docs/superpowers/specs/2026-07-24-home-role-overview-design.md).
  if (!role) redirect('/login');
  if (role === 'p_file_officer') redirect('/p-files');
  if (role === 'admissions') redirect('/admissions');

  const ay = await getCurrentAcademicYear();

  // No current AY configured — render the header + quick actions + an empty
  // module grid rather than throwing a 500 on the very first page most
  // roles land on after login.
  if (!ay) {
    return (
      <PageShell>
        <Header email={email} />
        <QuickActionsRow actions={getQuickActions(role)} />
        <p className="text-sm text-muted-foreground">
          No current academic year is set yet — ask a superadmin to
          configure one in SIS Admin.
        </p>
      </PageShell>
    );
  }

  const todoTitle =
    role === 'teacher'
      ? 'Needs your attention'
      : role === 'school_admin'
        ? 'To-do — approvals assigned to you'
        : 'To-do';

  const [quickActions, kpis, moduleCards, baseTodos, reportCardGaps, events] =
    await Promise.all([
      Promise.resolve(getQuickActions(role)),
      getHomeKpis(role, ay.ay_code),
      getModuleCards(role, ay.ay_code, userId),
      getHomeTodos(role, ay.ay_code, userId),
      role === 'academic_coordinator' ||
      role === 'school_admin' ||
      role === 'superadmin'
        ? reportCardGapsTodo(ay.ay_code)
        : Promise.resolve(null),
      getUpcomingCalendarEvents(ay.ay_code, 2, 14),
    ]);

  const todos = reportCardGaps ? [...baseTodos, reportCardGaps] : baseTodos;

  return (
    <PageShell>
      <Header email={email} />
      <QuickActionsRow actions={quickActions} />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-stretch">
        <TodoPanel title={todoTitle} items={todos} />
        <ComingUpPanel events={events} />
      </div>
      <KpiRow kpis={kpis} />
      <ModuleCardGrid cards={moduleCards} />
    </PageShell>
  );
}

function Header({ email }: { email: string }) {
  return (
    <header className="mb-5">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        HFSE · Student Information System
      </p>
      <h1 className="font-serif text-[28px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[32px]">
        Good morning, {email}.
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Here&apos;s where things stand across your modules today.
      </p>
    </header>
  );
}
```

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: all suites PASS, including every `lib/home/*` and `__tests__/home/*` test from Tasks 1-8.

- [ ] **Step 3: Run the production build**

Run: `npx next build`
Expected: clean compile, no type errors. Pay attention to any prop-type mismatch between what `getHomeTodos`/`getModuleCards`/`getHomeKpis` return and what the components expect — fix any drift found here rather than casting with `as`.

- [ ] **Step 4: Manual happy-path check per role**

In the browser, sign in as one account per role (`teacher`, `academic_coordinator`, `school_admin`, `superadmin`) and confirm for each:

- The module-card set matches what that role could already reach via the module switcher.
- The to-do panel shows the right kind of rows (review links vs. `school_admin`'s Approve/Reject).
- Clicking **Approve** on a real pending change request (as `school_admin`) actually flips its status and the row disappears after `router.refresh()`.
- `p_file_officer` and `admissions` still redirect immediately, unchanged.

- [ ] **Step 5: Commit**

```bash
git add app/\(dashboard\)/page.tsx
git commit -m "feat(home): replace the plain module picker with a role-aware overview"
```

---

## Self-Review

**Spec coverage:** Header/eyebrow (Task 9) · Quick actions (Task 1, 7) · To-do + Coming up row (Task 4, 7, 8, 9) · KPI row incl. teacher-omitted (Task 2) · Module card grid incl. chart mapping + KD #74 flavor split (Task 3, 6) · CR-approver correctness note (Task 4, verified against `decide.ts`) · route-consistency regression (Task 5) · Recent-activity table — explicitly out of scope per the spec, not built here. All spec sections have a task.

**Placeholder scan:** no TBD/TODO remain; the one intentionally thin stub (P-Files card's `'—'` in Task 3 Step 3) is filled in by the very next step (3b) in the same task, not left dangling.

**Type consistency:** `HomeTodoItem`, `ModuleCard`, `HomeKpi`, `QuickAction` are each defined once (Tasks 1-4) and imported by name everywhere else — checked every later task's import statements against those definitions. `PriorityPayload`'s `headline.value`/`headline.label`/`cta.href` (Task 4) match the real type in `lib/dashboard/priority.ts`. The `grade_change_requests` select list in Task 4 mirrors the exact columns already selected in `app/(markbook)/markbook/change-requests/page.tsx`.
