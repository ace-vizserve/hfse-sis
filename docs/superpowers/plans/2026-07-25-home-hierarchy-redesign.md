# Home page (`/`) hierarchy & content redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the already-shipped home-page overview (`app/(dashboard)/page.tsx` + `lib/home/*` + `components/home/*`) so it reads as a page with real visual hierarchy — a timeline-style to-do hero, a quiet sidebar, a unified 3-column module grid — and pair every lone percentage shown anywhere on the page with the real fraction it's computed from.

**Architecture:** Presentation-layer-only changes to already-shipped, already-tested code. `lib/home/module-cards.ts`/`kpis.ts`/`todos.ts` keep their exact external signatures (`getModuleCards`, `getHomeKpis`, `getHomeTodos`, `reportCardGapsTodo` — all consumed as-is by the already-committed `app/(dashboard)/page.tsx`); only their _internal_ chart-shape/copy logic changes, plus two small additive type fields (`HomeKpi.fraction`, `HomeTodoItem.requestedBy`) populated from data these functions already fetch. `components/home/kpi-row.tsx` is retired and replaced by a new `components/home/snapshot-card.tsx`; `todo-panel.tsx` and `module-card-grid.tsx`/`module-card-charts.tsx` get real layout rewrites; `quick-actions-row.tsx` swaps `Button` for plain links.

**Tech Stack:** Next.js 16 App Router (RSC), Tailwind v4 (Aurora Vault tokens), shadcn `Card`/`Badge`, Vitest + `@testing-library/react`.

## Global Constraints

- No new database tables/columns, no new Supabase queries — every fraction added in this plan is computed from a field the relevant loader already returns (verified against real source during the design spec, not guessed):
  - Markbook: `MarkbookRangeKpis.sheetsLocked` / `.sheetsTotal`
  - Evaluation: `EvaluationKpis.submitted` / `.expected`
  - P-Files: `SlotStatusMix.valid` / `(valid+pending+rejected+missing)`
  - Attendance: `AttendanceKpis.present + .late + .excused` / `.encodedDays` — **the numerator is `present+late+excused`, NOT `present` alone** (verified against `lib/attendance/dashboard.ts:169-171`: `attendancePct = (present+late+excused)/encoded × 100`)
  - Admissions: `AdmissionsRangeKpis.enrolledInRange` / `.applicationsInRange` — **NOT `.sampleSize`**, a different, unrelated field (verified against `lib/admissions/dashboard.ts:664`)
  - Todo's `requestedBy`: `requested_by_email` — already selected by `schoolAdminChangeRequestTodos`'s existing query, currently fetched but never included in the returned object
- Hard Rule #7: no raw hex/`slate-*`/`gray-*`/`zinc-*` — only semantic tokens / Aurora Vault brand tokens.
- `TodoCrActions` (`components/home/todo-cr-actions.client.tsx`) is **unchanged** — the timeline's change-request sub-card reuses it exactly as-is; the `school_admin`-only authorization boundary (KD #41) is untouched by this plan.
- The `getModuleCards`/`getHomeKpis`/`getHomeTodos`/`getQuickActions`/`reportCardGapsTodo`/`getUpcomingCalendarEvents` call sites in `app/(dashboard)/page.tsx` keep their exact signatures — only the JSX composition around them changes.
- **Correction from the design spec:** the spec's to-do sub-card described showing "the student name" for change-request items. The real `grade_change_requests` query has no join to a student name anywhere in the codebase — even the canonical `/markbook/change-requests` page has this as an open `TODO(loader-join)` (confirmed: `app/(markbook)/markbook/change-requests/change-requests-data-table.tsx:164`). Adding that join here would be new plumbing, violating the "no new queries" constraint. This plan's sub-card shows the subject/term text (already available) + "requested by {email}" (the already-fetched-but-previously-unused `requested_by_email` field) instead of a student name.

---

## File map

```
lib/home/
  module-cards.ts        — MODIFY: ModuleCardChart collapses to {kind:'bar',pct}|{kind:'none'}; statLabel text
                            changes for 5 percentage cards + SIS Admin
  kpis.ts                 — MODIFY: HomeKpi gains `fraction?: string`; attendance + school_admin's
                            documents-on-file KPI populate it
  todos.ts                 — MODIFY: HomeTodoItem gains `requestedBy?: string`; populated from the
                            already-selected `requested_by_email` column
components/home/
  module-card-charts.tsx  — MODIFY: single bar renderer, sparkline/ring/dots removed
  module-card-grid.tsx    — MODIFY: 3-column-max grid; value+label row above the bar
  snapshot-card.tsx        — CREATE: replaces kpi-row.tsx; stacked rows with an optional fraction caption
  kpi-row.tsx              — DELETE
  quick-actions-row.tsx    — MODIFY: plain text links + hairline rule, not gradient Buttons
  todo-panel.tsx            — MODIFY: vertical timeline (dot+line); change-request rows get a
                            requester sub-card; review rows stay a single line + link
app/(dashboard)/
  page.tsx                 — MODIFY: max-width container, sidebar wraps ComingUpPanel+SnapshotCard,
                            KpiRow usage removed
__tests__/home/
  module-cards.test.ts     — MODIFY: chart-kind + label assertions
  kpis.test.ts             — MODIFY: fraction-field assertions
  todos.test.ts             — MODIFY: requestedBy-field assertions
  module-card-grid.test.tsx — MODIFY: bar-chart assertions
  todo-panel.test.tsx       — CREATE: new — the component's own layout logic wasn't covered by a
                            dedicated test before (flagged as a Minor gap in the original feature's
                            final review) and is now non-trivial enough to warrant one
```

---

### Task 1: `lib/home/module-cards.ts` — unify chart kind, add fraction copy to labels

**Files:**

- Modify: `lib/home/module-cards.ts`
- Modify: `__tests__/home/module-cards.test.ts`

**Interfaces:**

- Produces: `ModuleCardChart = { kind: 'bar'; pct: number } | { kind: 'none' }` (was: `'sparkline' | 'ring' | 'dots' | 'none'`) — consumed by Task 4 (`module-card-charts.tsx`).
- `ModuleCard.statLabel` now carries the full fraction phrase for the 5 percentage-backed cards + the "AY setup steps complete" phrase for SIS Admin — no new field on `ModuleCard`.

- [ ] **Step 1: Update the failing/changing test first**

Replace the relevant assertions in `__tests__/home/module-cards.test.ts` (keep the mocks and the 4 `it()` blocks — only the `chart`/`statLabel` expectations inside them change):

```typescript
// in the 'returns all 7 modules for school_admin...' test, replace:
//   expect(markbook.chart).toEqual({ kind: 'ring', pct: 82 });
// with (the top-of-file mock is updated below to carry sheetsLocked:41/sheetsTotal:50,
// so this test's markbook fixture now has a real fraction to assert):
expect(markbook.chart).toEqual({ kind: 'bar', pct: 82 });
expect(markbook.statLabel).toBe('41 of 50 sheets locked');
```

Also add a new focused test verifying the fraction copy end-to-end with a richer mock:

```typescript
it('shows the real sheets-locked fraction on the Markbook card', async () => {
  const { getMarkbookKpisRange } = await import('@/lib/markbook/dashboard');
  (getMarkbookKpisRange as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    current: { lockedPct: 82, sheetsLocked: 41, sheetsTotal: 50 },
  });
  const cards = await getModuleCards('school_admin', 'AY2026', 'user-2');
  const markbook = cards.find((c) => c.module === 'Markbook')!;
  expect(markbook.statLabel).toBe('41 of 50 sheets locked');
  expect(markbook.chart).toEqual({ kind: 'bar', pct: 82 });
});

it('shows the real AY-setup fraction on the SIS Admin card', async () => {
  const cards = await getModuleCards('school_admin', 'AY2026', 'user-2');
  const sisAdmin = cards.find((c) => c.module === 'SIS Admin')!;
  expect(sisAdmin.statValue).toBe('6/7');
  expect(sisAdmin.statLabel).toBe('AY setup steps complete');
  expect(sisAdmin.chart).toEqual({
    kind: 'bar',
    pct: (6 / 7) * 100,
  });
});
```

Update the top-of-file mock for `getMarkbookKpisRange` to include `sheetsLocked`/`sheetsTotal` by default so the pre-existing tests don't regress:

```typescript
vi.mock('@/lib/markbook/dashboard', () => ({
  getMarkbookKpisRange: vi.fn(async () => ({
    current: { lockedPct: 82, sheetsLocked: 41, sheetsTotal: 50 },
  })),
}));
```

Do the same for the other mocked loaders — update their default mock shapes to include the fields the new statLabel copy needs:

```typescript
vi.mock('@/lib/evaluation/dashboard', () => ({
  getEvaluationKpisRange: vi.fn(async () => ({
    current: { submissionPct: 68, submitted: 55, expected: 90 },
  })),
}));
vi.mock('@/lib/p-files/dashboard', () => ({
  getSlotStatusMix: vi.fn(async () => ({
    valid: 184,
    pending: 10,
    rejected: 4,
    missing: 2,
  })),
}));
vi.mock('@/lib/attendance/dashboard', () => ({
  getAttendanceKpisRange: vi.fn(async () => ({
    current: {
      attendancePct: 96,
      encodedDays: 500,
      present: 460,
      late: 15,
      excused: 5,
      absent: 20,
      nc: 0,
    },
  })),
}));
vi.mock('@/lib/admissions/dashboard', () => ({
  getAdmissionsKpisRange: vi.fn(async () => ({
    current: {
      applicationsInRange: 35,
      enrolledInRange: 12,
      conversionPct: 34,
    },
  })),
}));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/home/module-cards.test.ts`
Expected: FAIL — `chart.kind` is `'ring'`/`'dots'` not `'bar'`, and `statLabel` doesn't yet include the fraction text.

- [ ] **Step 3: Update `lib/home/module-cards.ts`**

Replace the `ModuleCardChart` type:

```typescript
export type ModuleCardChart = { kind: 'bar'; pct: number } | { kind: 'none' };
```

Update `buildAdmissionsCard`'s oversight branch (the `else` of the `isOperational` ternary):

```typescript
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
      statLabel: `${current.enrolledInRange} of ${current.applicationsInRange} applications enrolled`,
      chart: { kind: 'bar', pct: current.conversionPct },
    };
```

Update the `'P-Files':` case inside `getModuleCards`:

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
            statLabel: `${mix.valid} of ${total} documents on file`,
            chart: { kind: 'bar', pct: pctOnFile },
          };
        }
```

Update `buildMarkbookCard`'s returned `card` object (the `statLabel`/`chart` lines only — the teacher CR-badge logic below it is unchanged):

```typescript
const card: ModuleCard = {
  module: 'Markbook',
  href: '/markbook',
  statValue: `${Math.round(current.lockedPct)}%`,
  statLabel: `${current.sheetsLocked} of ${current.sheetsTotal} sheets locked`,
  chart: { kind: 'bar', pct: current.lockedPct },
};
```

Update `buildAttendanceCard`:

```typescript
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
  const attending = current.present + current.late + current.excused;
  return {
    module: 'Attendance',
    href: '/attendance',
    statValue: `${Math.round(current.attendancePct)}%`,
    statLabel: `${attending} of ${current.encodedDays} marked as attending`,
    chart: { kind: 'bar', pct: current.attendancePct },
  };
}
```

Update `buildEvaluationCard`:

```typescript
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
    statLabel: `${current.submitted} of ${current.expected} write-ups submitted`,
    chart: { kind: 'bar', pct: current.submissionPct },
  };
}
```

Update `buildSisAdminCard`:

```typescript
async function buildSisAdminCard(ayCode: string): Promise<ModuleCard> {
  const readiness = await getAyReadiness(ayCode);
  const pct =
    readiness.total === 0 ? 0 : (readiness.complete / readiness.total) * 100;
  return {
    module: 'SIS Admin',
    href: '/sis',
    statValue: `${readiness.complete}/${readiness.total}`,
    statLabel: 'AY setup steps complete',
    chart: { kind: 'bar', pct },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/home/module-cards.test.ts`
Expected: PASS (6 tests — the original 4 plus the 2 new ones from Step 1)

- [ ] **Step 5: Commit**

```bash
git add lib/home/module-cards.ts __tests__/home/module-cards.test.ts
git commit -m "refactor(home): unify module-card charts to one bar language, add fraction copy"
```

---

### Task 2: `lib/home/kpis.ts` — add a `fraction` caption to the Snapshot KPIs

**Files:**

- Modify: `lib/home/kpis.ts`
- Modify: `__tests__/home/kpis.test.ts`

**Interfaces:**

- Produces: `HomeKpi = { value: string; label: string; fraction?: string }` (was: no `fraction` field) — consumed by Task 5 (`snapshot-card.tsx`).

- [ ] **Step 1: Update the failing test**

In `__tests__/home/kpis.test.ts`, update the mocked loaders' return shapes to carry the fields the fraction math needs, and update the expected `HomeKpi` objects:

```typescript
vi.mock('@/lib/attendance/dashboard', () => ({
  getAttendanceKpisRange: vi.fn(async () => ({
    current: {
      attendancePct: 96.2,
      encodedDays: 500,
      present: 460,
      late: 15,
      excused: 5,
      absent: 20,
      nc: 0,
    },
  })),
}));
vi.mock('@/lib/p-files/dashboard', () => ({
  getSlotStatusMix: vi.fn(async () => ({
    valid: 184,
    pending: 10,
    rejected: 4,
    missing: 2,
  })),
}));
```

Update the `academic_coordinator` test's expected array to include `fraction` on the attendance entry:

```typescript
it('returns active students + attendance + write-ups for academic_coordinator', async () => {
  const kpis = await getHomeKpis('academic_coordinator', 'AY2026');
  expect(kpis).toEqual([
    { value: '1,048', label: 'Active students, AY2026' },
    {
      value: '96%',
      label: 'Attendance rate, today',
      fraction: '480 of 500 marked as attending',
    },
    { value: '68%', label: 'Write-ups submitted, this term' },
  ]);
});
```

Update the `school_admin` test similarly, adding `fraction` to both the attendance KPI and the documents-on-file KPI:

```typescript
it('returns active students + attendance + docs-on-file for school_admin', async () => {
  const kpis = await getHomeKpis('school_admin', 'AY2026');
  expect(kpis).toEqual([
    { value: '1,048', label: 'Active students, AY2026' },
    {
      value: '96%',
      label: 'Attendance rate, today',
      fraction: '480 of 500 marked as attending',
    },
    {
      value: '92%',
      label: 'Documents on file',
      fraction: '184 of 200 documents',
    },
  ]);
});
```

Update the `superadmin` test's attendance entry the same way (its 2nd/3rd order is `[activeStudents, issuesFlagged, attendanceToday]` — only the 3rd entry gains `fraction`):

```typescript
it('returns active students + system health + attendance for superadmin', async () => {
  const kpis = await getHomeKpis('superadmin', 'AY2026');
  expect(kpis).toEqual([
    { value: '1,048', label: 'Active students, AY2026' },
    { value: '1', label: 'System issues flagged' },
    {
      value: '96%',
      label: 'Attendance rate, today',
      fraction: '480 of 500 marked as attending',
    },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/home/kpis.test.ts`
Expected: FAIL — actual objects don't yet have a `fraction` key.

- [ ] **Step 3: Update `lib/home/kpis.ts`**

Update the `HomeKpi` type:

```typescript
export type HomeKpi = { value: string; label: string; fraction?: string };
```

Update `attendanceTodayKpi`:

```typescript
async function attendanceTodayKpi(ayCode: string): Promise<HomeKpi> {
  const today = sgToday();
  const { current } = await getAttendanceKpisRange({
    ayCode,
    from: today,
    to: today,
    cmpFrom: null,
    cmpTo: null,
  });
  const attending = current.present + current.late + current.excused;
  return {
    value: pct(current.attendancePct),
    label: 'Attendance rate, today',
    fraction: `${attending} of ${current.encodedDays} marked as attending`,
  };
}
```

Update the `school_admin` branch of `getHomeKpis`:

```typescript
if (role === 'school_admin') {
  const mix = await getSlotStatusMix(ayCode);
  const total = mix.valid + mix.pending + mix.rejected + mix.missing;
  const onFilePct = total === 0 ? 0 : (mix.valid / total) * 100;
  return [
    activeStudents,
    attendanceToday,
    {
      value: pct(onFilePct),
      label: 'Documents on file',
      fraction: `${mix.valid} of ${total} documents`,
    },
  ];
}
```

Everything else in the file (`activeStudentsKpi`, the `academic_coordinator`/`superadmin` branches' other two entries, the `teacher`/`p_file_officer`/`admissions` short-circuit) is unchanged — `fraction` stays `undefined` for entries that have no meaningful denominator (active-student headcount, write-up submission %, system-issues count).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/home/kpis.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/home/kpis.ts __tests__/home/kpis.test.ts
git commit -m "feat(home): add fraction captions to Snapshot KPIs"
```

---

### Task 3: `lib/home/todos.ts` — surface the requester email on change-request rows

**Files:**

- Modify: `lib/home/todos.ts`
- Modify: `__tests__/home/todos.test.ts`

**Interfaces:**

- Produces: `HomeTodoItem = { …; requestedBy?: string }` (new field) — consumed by Task 7 (`todo-panel.tsx`).

- [ ] **Step 1: Update the failing test**

In `__tests__/home/todos.test.ts`, the `createServiceClient` mock's `grade_change_requests` row already includes `requested_by_email: 'teacher@hfse.test'` (from the original Task 4 test) — update the school_admin test's assertion to check the new field:

```typescript
it('gives school_admin change-request rows with a requestId', async () => {
  const todos = await getHomeTodos('school_admin', 'AY2026', 'admin-1');
  const cr = todos.find((t) => t.kind === 'change-request');
  expect(cr).toBeDefined();
  expect(cr?.requestId).toBe('cr-1');
  expect(cr?.requestedBy).toBe('teacher@hfse.test');
  expect(cr?.aging).toEqual({ label: '2 days', tone: 'success' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/home/todos.test.ts`
Expected: FAIL — `cr?.requestedBy` is `undefined`.

- [ ] **Step 3: Update `lib/home/todos.ts`**

Update the `HomeTodoItem` type:

```typescript
export type HomeTodoItem = {
  id: string;
  module: string;
  text: string;
  href: string;
  kind: 'review' | 'change-request';
  aging?: { label: string; tone: 'success' | 'warning' | 'destructive' };
  requestId?: string;
  requestedBy?: string;
};
```

Update `schoolAdminChangeRequestTodos`'s `.map(...)` return object (the `select(...)` already fetches `requested_by_email` — no query change needed):

```typescript
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
    requestedBy: row.requested_by_email ?? undefined,
  };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/home/todos.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/home/todos.ts __tests__/home/todos.test.ts
git commit -m "feat(home): surface the requester email on change-request to-do rows"
```

---

### Task 4: `components/home/module-card-charts.tsx` + `module-card-grid.tsx` — bar-only chart, 3-column grid

**Files:**

- Modify: `components/home/module-card-charts.tsx`
- Modify: `components/home/module-card-grid.tsx`
- Modify: `__tests__/home/module-card-grid.test.tsx`

**Interfaces:**

- Consumes: `ModuleCardChart` (Task 1's new `{kind:'bar',pct}|{kind:'none'}` union).
- No exported-interface change to `ModuleCardChartView`/`ModuleCardGrid` themselves (same prop names).

- [ ] **Step 1: Update the test**

In `__tests__/home/module-card-grid.test.tsx`, change the mocked `chart` shapes from `{ kind: 'ring', pct: 82 }` to `{ kind: 'bar', pct: 82 }` in the `cards` fixture at the top of the file (the assertions below don't need to change — they check text content and the link href, not the chart internals):

```typescript
const cards: ModuleCard[] = [
  {
    module: 'Markbook',
    href: '/markbook',
    statValue: '82%',
    statLabel: '41 of 50 sheets locked',
    chart: { kind: 'bar', pct: 82 },
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
```

- [ ] **Step 2: Run test to verify it still passes (this task doesn't add new assertions, only updates fixtures — the RED/GREEN cycle here is about the component code, not the test)**

Run: `npx vitest run __tests__/home/module-card-grid.test.tsx`
Expected: still PASS at this point (the test doesn't assert chart internals) — this step just confirms the fixture update alone didn't break anything before you touch the components.

- [ ] **Step 3: Rewrite `module-card-charts.tsx`**

```typescript
// components/home/module-card-charts.tsx
import type { ModuleCardChart } from '@/lib/home/module-cards';

export function ModuleCardChartView({ chart }: { chart: ModuleCardChart }) {
  if (chart.kind === 'none') return null;

  const pct = Math.max(0, Math.min(100, chart.pct));
  return (
    <div
      className="h-1.5 overflow-hidden rounded-full bg-hairline"
      aria-hidden
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-brand-indigo to-brand-sky"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `module-card-grid.tsx`**

```typescript
// components/home/module-card-grid.tsx
import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ModuleCard } from '@/lib/home/module-cards';
import { ModuleCardChartView } from './module-card-charts';

export function ModuleCardGrid({ cards }: { cards: ModuleCard[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <Link key={card.href} href={card.href} className="block">
          <Card className="cursor-pointer p-4 transition-all hover:-translate-y-0.5 hover:border-brand-indigo/40 hover:shadow-md">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-md bg-gradient-to-br from-brand-indigo to-brand-navy text-[10px] font-semibold text-white shadow-brand-tile">
                {card.module.charAt(0)}
              </div>
              <span className="flex-1 text-sm font-semibold text-foreground">
                {card.module}
              </span>
              {card.badge ? (
                <Badge variant={card.badge.tone}>{card.badge.label}</Badge>
              ) : null}
            </div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="font-serif text-base font-bold text-foreground">
                {card.statValue}
              </span>
              <span className="text-right text-xs text-muted-foreground">
                {card.statLabel}
              </span>
            </div>
            <ModuleCardChartView chart={card.chart} />
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
git commit -m "refactor(home): module card grid to 3-column, single progress-bar chart"
```

---

### Task 5: `components/home/snapshot-card.tsx` (new) — replaces `kpi-row.tsx`

**Files:**

- Create: `components/home/snapshot-card.tsx`
- Delete: `components/home/kpi-row.tsx`
- Create: `__tests__/home/snapshot-card.test.tsx`

**Interfaces:**

- Consumes: `HomeKpi` (Task 2's new `fraction?: string` field).
- Produces: `export function SnapshotCard({ kpis }: { kpis: HomeKpi[] })` — consumed by Task 8 (`page.tsx`).

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/home/snapshot-card.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SnapshotCard } from '@/components/home/snapshot-card';
import type { HomeKpi } from '@/lib/home/kpis';

describe('SnapshotCard', () => {
  it('renders each KPI value, label, and its fraction caption when present', () => {
    const kpis: HomeKpi[] = [
      { value: '1,048', label: 'Active students, AY2026' },
      {
        value: '96%',
        label: 'Attendance rate, today',
        fraction: '480 of 500 marked as attending',
      },
    ];
    render(<SnapshotCard kpis={kpis} />);
    expect(screen.getByText('1,048')).toBeInTheDocument();
    expect(screen.getByText('Active students, AY2026')).toBeInTheDocument();
    expect(screen.getByText('96%')).toBeInTheDocument();
    expect(
      screen.getByText('480 of 500 marked as attending')
    ).toBeInTheDocument();
  });

  it('renders nothing when there are no KPIs', () => {
    const { container } = render(<SnapshotCard kpis={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/home/snapshot-card.test.tsx`
Expected: FAIL — `Cannot find module '@/components/home/snapshot-card'`

- [ ] **Step 3: Write `snapshot-card.tsx`**

```typescript
// components/home/snapshot-card.tsx
import { Card } from '@/components/ui/card';
import type { HomeKpi } from '@/lib/home/kpis';

export function SnapshotCard({ kpis }: { kpis: HomeKpi[] }) {
  if (kpis.length === 0) return null;
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
        Snapshot
      </div>
      <div className="px-4">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="border-b border-border py-2.5 last:border-b-0"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-serif text-base font-bold text-foreground">
                {kpi.value}
              </span>
              <span className="text-right text-xs text-muted-foreground">
                {kpi.label}
              </span>
            </div>
            {kpi.fraction ? (
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {kpi.fraction}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Delete `kpi-row.tsx`**

```bash
git rm components/home/kpi-row.tsx
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/home/snapshot-card.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add components/home/snapshot-card.tsx __tests__/home/snapshot-card.test.tsx
git commit -m "feat(home): add Snapshot sidebar card, retire the full-width KpiRow"
```

(The `git rm` from Step 4 stages the deletion; it's included in this same commit.)

---

### Task 6: `components/home/quick-actions-row.tsx` — demote to plain links

**Files:**

- Modify: `components/home/quick-actions-row.tsx`

**Interfaces:**

- No change to the component's exported name/props (`QuickActionsRow({ actions })`).

- [ ] **Step 1: Confirm the existing test still applies**

`__tests__/home/quick-actions-row.test.tsx` asserts `getByRole('link', { name: /Enter grades/ })` with an `href` and an `svg` child — since the new markup is still an `<a>` (via `next/link`) with the `ArrowUpRight` icon inside it, this test needs **no changes**. Run it once now as a baseline:

Run: `npx vitest run __tests__/home/quick-actions-row.test.tsx`
Expected: PASS (2 tests, current implementation)

- [ ] **Step 2: Rewrite `quick-actions-row.tsx`**

```typescript
// components/home/quick-actions-row.tsx
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

import type { QuickAction } from '@/lib/home/quick-actions';

export function QuickActionsRow({ actions }: { actions: QuickAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap gap-5 border-b border-border pb-3.5">
      {actions.map((action) => (
        <Link
          key={action.href}
          href={action.href}
          className="flex items-center gap-1 text-sm font-semibold text-brand-indigo hover:underline"
        >
          {action.label}
          <ArrowUpRight className="size-3.5" />
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Run test to verify it still passes**

Run: `npx vitest run __tests__/home/quick-actions-row.test.tsx`
Expected: PASS (2 tests, unchanged)

- [ ] **Step 4: Commit**

```bash
git add components/home/quick-actions-row.tsx
git commit -m "refactor(home): demote quick actions from gradient buttons to plain links"
```

---

### Task 7: `components/home/todo-panel.tsx` — timeline layout

**Files:**

- Modify: `components/home/todo-panel.tsx`
- Create: `__tests__/home/todo-panel.test.tsx`

**Interfaces:**

- Consumes: `HomeTodoItem` (Task 3's new `requestedBy?: string` field), `TodoCrActions` (unchanged, `components/home/todo-cr-actions.client.tsx`).
- No change to `TodoPanel`'s exported props (`{ title, items }`).

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/home/todo-panel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TodoPanel } from '@/components/home/todo-panel';
import type { HomeTodoItem } from '@/lib/home/todos';

describe('TodoPanel', () => {
  it('renders a timeline dot + text for a review item, with a Review link', () => {
    const items: HomeTodoItem[] = [
      {
        id: 'admissions-doc-validation',
        module: 'Admissions',
        text: '5 documents awaiting validation',
        href: '/admissions/document-validation',
        kind: 'review',
      },
    ];
    render(<TodoPanel title="To-do" items={items} />);
    expect(screen.getByText('5 documents awaiting validation')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review/ })).toHaveAttribute(
      'href',
      '/admissions/document-validation'
    );
  });

  it('renders a requester sub-card with Approve/Reject for a change-request item', () => {
    const items: HomeTodoItem[] = [
      {
        id: 'cr-1',
        module: 'Markbook',
        text: 'Grade change — T2 Science',
        href: '/markbook/change-requests?req=cr-1',
        kind: 'change-request',
        aging: { label: '2 days', tone: 'success' },
        requestId: 'cr-1',
        requestedBy: 'teacher@hfse.test',
      },
    ];
    render(<TodoPanel title="To-do" items={items} />);
    expect(screen.getByText('Grade change — T2 Science')).toBeInTheDocument();
    expect(screen.getByText(/requested by teacher@hfse.test/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /reject/i })).toBeInTheDocument();
  });

  it('renders the empty state when there are no items', () => {
    render(<TodoPanel title="To-do" items={[]} />);
    expect(
      screen.getByText('Nothing needs your attention right now.')
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/home/todo-panel.test.tsx`
Expected: FAIL — the `requested by {email}` sub-card text doesn't exist yet in the current flat-row implementation.

- [ ] **Step 3: Rewrite `todo-panel.tsx`**

```typescript
// components/home/todo-panel.tsx
import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
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
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="font-serif text-base font-bold text-foreground">
          {title}
        </span>
        <span className="font-mono text-[10px] font-semibold text-muted-foreground">
          {items.length} {items.length === 1 ? 'ITEM' : 'ITEMS'}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="px-5 py-4 text-xs text-muted-foreground">
          Nothing needs your attention right now.
        </div>
      ) : (
        <ol className="relative px-5 py-4 pl-9">
          <div
            className="absolute top-2 bottom-2 left-[2.05rem] w-px bg-border"
            aria-hidden
          />
          {items.map((item) => {
            const dotWarn =
              item.aging?.tone === 'warning' ||
              item.aging?.tone === 'destructive';
            return (
              <li key={item.id} className="relative pb-5 last:pb-0">
                <span
                  className={cn(
                    'absolute top-1 -left-[1.15rem] size-2.5 rounded-full border-2 bg-card',
                    dotWarn ? 'border-brand-amber' : 'border-brand-indigo'
                  )}
                  aria-hidden
                />
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="font-mono text-[10px] font-bold tracking-wide text-brand-indigo uppercase">
                    {item.module}
                  </span>
                  {item.aging ? (
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      requested {item.aging.label} ago
                    </span>
                  ) : null}
                </div>
                <div className="text-sm font-semibold text-foreground">
                  {item.text}
                </div>
                {item.kind === 'change-request' && item.requestId ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2">
                    {item.requestedBy ? (
                      <span className="text-xs text-muted-foreground">
                        requested by {item.requestedBy}
                      </span>
                    ) : null}
                    {item.aging ? (
                      <Badge
                        variant={
                          item.aging.tone === 'destructive'
                            ? 'blocked'
                            : item.aging.tone
                        }
                      >
                        {item.aging.label}
                      </Badge>
                    ) : null}
                    <TodoCrActions requestId={item.requestId} />
                  </div>
                ) : (
                  <Link
                    href={item.href}
                    className="mt-1 inline-block text-xs font-semibold text-brand-indigo hover:underline"
                  >
                    Review &rsaquo;
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/home/todo-panel.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add components/home/todo-panel.tsx __tests__/home/todo-panel.test.tsx
git commit -m "refactor(home): to-do panel becomes a timeline with a requester sub-card"
```

---

### Task 8: Rewrite `app/(dashboard)/page.tsx` — max-width, sidebar composition

**Files:**

- Modify: `app/(dashboard)/page.tsx`

**Interfaces:**

- Consumes: `SnapshotCard` (Task 5), `ModuleCardGrid`/`ModuleCardChartView` (Task 4, same exported name), `QuickActionsRow` (Task 6, same exported name), `TodoPanel` (Task 7, same exported name) — every `lib/home/*` call site is unchanged from what's already committed.

- [ ] **Step 1: Update the page**

Replace the `KpiRow` import with `SnapshotCard`:

```typescript
import { SnapshotCard } from '@/components/home/snapshot-card';
```

(remove the line `import { KpiRow } from '@/components/home/kpi-row';`)

Update the no-AY early return to cap the container width:

```typescript
  if (!ay) {
    return (
      <PageShell className="max-w-[1040px]">
        <Header email={email} />
        <QuickActionsRow actions={getQuickActions(role)} />
        <p className="text-sm text-muted-foreground">
          No current academic year is set yet — ask a superadmin to configure
          one in SIS Admin.
        </p>
      </PageShell>
    );
  }
```

Replace the main return's JSX:

```typescript
  return (
    <PageShell className="max-w-[1040px]">
      <Header email={email} />
      <QuickActionsRow actions={quickActions} />
      <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start">
        <TodoPanel title={todoTitle} items={todos} />
        <div className="flex flex-col gap-3 lg:w-[300px] lg:shrink-0">
          <ComingUpPanel events={events} />
          <SnapshotCard kpis={kpis} />
        </div>
      </div>
      <ModuleCardGrid cards={moduleCards} />
    </PageShell>
  );
```

The `Header` function and every `lib/home/*`/`getUpcomingCalendarEvents` call in the `Promise.all` above this JSX are unchanged — do not touch them.

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: all suites PASS, including every updated/new test from Tasks 1-7.

- [ ] **Step 3: Run the production build**

Run: `npx next build`
Expected: clean compile, no type errors. If `next build` reports an unused-import error for the removed `KpiRow` import, confirm Step 1's removal was applied.

- [ ] **Step 4: Manual visual check (deferred, same as the original feature)**

No dev server is available in this environment. Note in the commit/report that a live per-role browser check is still outstanding — same outstanding item as the original shipped feature, now compounded with this layout change, so it should happen before either is considered fully production-verified.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/page.tsx"
git commit -m "feat(home): compose the hierarchy-redesigned home page"
```

---

## Self-Review

**Spec coverage:** Container max-width (Task 8) · quick actions demoted (Task 6) · to-do as timeline hero with requester sub-card (Task 3 + 7) · sidebar with Coming-up + Snapshot (Task 5 + 8) · module grid 3-column + unified bar chart (Task 1 + 4) · every fraction pairing from the spec's table (Task 1 + 2, including both corrected formulas — Admissions denominator, Attendance numerator) · the spec's own mid-write correction (student name → requester email) is reflected in Task 3/7, not the originally-drafted "student name" wording. All spec items have a task.

**Placeholder scan:** no TBD/TODO in any step; every code block is complete, not a fragment description.

**Type consistency:** `ModuleCardChart`'s `'bar'`/`'none'` kind is used identically in Task 1 (producer) and Task 4 (consumer) — no leftover `'sparkline'`/`'ring'`/`'dots'` reference anywhere in the plan. `HomeKpi.fraction` (Task 2) and `HomeTodoItem.requestedBy` (Task 3) are both optional, additive fields — every existing call site that doesn't set them continues to compile (`undefined` is a valid value for both). `TodoCrActions`'s prop signature (`{ requestId: string }`) is unchanged and Task 7's JSX passes it exactly that.
