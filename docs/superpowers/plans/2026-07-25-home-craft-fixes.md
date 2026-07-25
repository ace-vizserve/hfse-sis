# Home page (`/`) craft & accuracy fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix concrete, doc-verified violations of `docs/context/09-design-system.md` in the just-shipped home-page redesign (module cards used bare `<div>`s instead of real `Card` composition at the wrong type scale, icon tiles were ambiguous bare letters, the timeline's connecting line was visually broken, spacing was too tight) — plus fix a real data bug where the Snapshot sidebar's "Attendance rate, today" contradicts the Attendance module card (0% vs. 96%) because they query different time windows.

**Architecture:** Presentation-only fixes to already-shipped, already-tested components from the prior two plans. No `lib/home/*` exported function signatures change except `attendanceTodayKpi`'s internal empty-state handling (still returns a `HomeKpi`, same shape). No new files except one small icon-lookup constant.

**Tech Stack:** Next.js 16 (RSC), Tailwind v4 (Aurora Vault tokens), shadcn `Card` sub-components (`CardHeader`/`CardTitle`/`CardDescription`/`CardAction`/`CardFooter`), `lucide-react`, Vitest + `@testing-library/react`.

## Global Constraints

- **Every fix here is traceable to a specific line in the binding docs** — cite it in code comments where non-obvious:
  - `docs/context/09-design-system.md` §3.3: stat values are `font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground` (module cards were shipped at `text-base`, 16px).
  - §7.4: icon tiles are `bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile`, "placed in `CardAction` on cards so the grid auto-positions them top-right," sized `size-9` in the canonical pattern (module cards were `size-6`, inline-left, bare `.charAt(0)` letters).
  - §8 "Stat card grid" gives the exact canonical shape: `Card` → `CardHeader` (`CardDescription` eyebrow + `CardTitle` value + `CardAction` icon tile) → `CardFooter` (label + detail). Module cards must use these real sub-components, not bare `<div>`s (Hard Rule #2: "shadcn primitives over custom wrappers").
  - §7.5: vertical rhythm is 16/24/32/48, "48 between major regions." The page currently uses `mb-4`/`gap-4` (16px) between the quick-actions row, the todo+sidebar row, and the module grid — bump to the 32 tier (`gap-8`/`mb-8`) between those three regions.
  - Rule: "Use `tabular-nums` for anything numeric" — add it to every stat value (module cards, Snapshot KPIs) that doesn't already have it.
- **Icons:** reuse the exact 7 module→icon assignments the original (pre-redesign) tile picker used — `FileStack` (Admissions), `Users` (Records), `FolderKanban` (P-Files), `BookOpen` (Markbook), `CalendarCheck` (Attendance), `ClipboardCheck` (Evaluation), `ShieldCheck` (SIS Admin) — all from `lucide-react`. Don't invent new icon choices.
- **Attendance empty-state:** when nothing has been marked yet for the current day (`encodedDays === 0` in `AttendanceKpis`), the Snapshot's attendance-today KPI must NOT show a misleading `0%` — show `'—'` as the value and `'Not yet marked today'` as the fraction line instead. The Attendance _module card_ (which queries a trailing 7-day window, not just today) is untouched by this — it already shows real data and was never the broken one.
- No new Supabase queries, no new `lib/home/*` exported signatures beyond the one internal branch in `attendanceTodayKpi`.
- Hard Rule #7: no raw hex/`slate-*`/`gray-*`/`zinc-*`.

---

## File map

```
lib/home/
  kpis.ts                    — MODIFY: attendanceTodayKpi gains an empty-state branch
components/home/
  module-card-grid.tsx        — REWRITE: real Card/CardHeader/CardTitle/CardAction/CardFooter,
                                real per-module icons, 32px tabular-nums stat value
  module-card-charts.tsx      — MODIFY: bar track height bump to match the new footer placement
  snapshot-card.tsx           — MODIFY: bigger tabular-nums stat value, mono-eyebrow label
  todo-panel.tsx               — MODIFY: fix the connecting-line alignment bug, filled gradient
                                dots with a check/alert glyph, requester avatar circle, more
                                generous spacing
app/(dashboard)/
  page.tsx                    — MODIFY: bump inter-region gaps from the 16px tier to the 32px tier
__tests__/home/
  module-card-grid.test.tsx   — MODIFY: assertions still query by text/role, should mostly hold;
                                verify against the new DOM structure
```

---

### Task 1: `lib/home/kpis.ts` — honest empty state for "Attendance rate, today"

**Files:**

- Modify: `lib/home/kpis.ts`
- Modify: `__tests__/home/kpis.test.ts`

**Interfaces:**

- No change to `HomeKpi`'s shape (`{ value: string; label: string; fraction?: string }`) — this task only changes what values `attendanceTodayKpi` produces in one branch.

- [ ] **Step 1: Read the current file first**

Read `lib/home/kpis.ts` in full to confirm `attendanceTodayKpi`'s current exact code before editing.

- [ ] **Step 2: Write the failing test**

Add this test to `__tests__/home/kpis.test.ts` (alongside the existing ones — keep the existing tests, just add this one and adjust the shared `getAttendanceKpisRange` mock to be overridable per-test via `mockResolvedValueOnce` rather than a fixed return, if it isn't already):

```typescript
it('shows an honest empty state when nothing is marked yet today, not a fake 0%', async () => {
  const { getAttendanceKpisRange } = await import('@/lib/attendance/dashboard');
  (getAttendanceKpisRange as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    current: {
      attendancePct: 0,
      encodedDays: 0,
      present: 0,
      late: 0,
      excused: 0,
      absent: 0,
      nc: 0,
    },
  });
  const kpis = await getHomeKpis('school_admin', 'AY2026');
  const attendance = kpis.find((k) => k.label === 'Attendance rate, today')!;
  expect(attendance.value).toBe('—');
  expect(attendance.fraction).toBe('Not yet marked today');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run __tests__/home/kpis.test.ts`
Expected: FAIL — current code returns `value: '0%'`, `fraction: '0 of 0 marked as attending'`.

- [ ] **Step 4: Update `attendanceTodayKpi`**

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
  // Nothing marked yet today — a bare "0%" would misleadingly contradict
  // the Attendance module card's real (trailing-7-day) rate right below it
  // on the same page. Show an honest empty state instead.
  if (current.encodedDays === 0) {
    return {
      value: '—',
      label: 'Attendance rate, today',
      fraction: 'Not yet marked today',
    };
  }
  const attending = current.present + current.late + current.excused;
  return {
    value: pct(current.attendancePct),
    label: 'Attendance rate, today',
    fraction: `${attending} of ${current.encodedDays} marked as attending`,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/home/kpis.test.ts`
Expected: PASS (all tests, including the new one)

- [ ] **Step 6: Run the full suite once, then commit**

```bash
npx vitest run
git add lib/home/kpis.ts __tests__/home/kpis.test.ts
git commit -m "fix(home): honest empty state for attendance-today KPI instead of misleading 0%"
```

---

### Task 2: `components/home/module-card-grid.tsx` — real Card composition, correct type scale, real icons

**Files:**

- Modify: `components/home/module-card-grid.tsx`
- Modify: `components/home/module-card-charts.tsx`
- Modify: `__tests__/home/module-card-grid.test.tsx`

**Interfaces:**

- No change to `ModuleCardGrid`'s props (`{ cards: ModuleCard[] }`) or `ModuleCard`'s shape — this is a pure re-render of the same data.

- [ ] **Step 1: Read the current files first**

Read `components/home/module-card-grid.tsx`, `components/home/module-card-charts.tsx`, and `__tests__/home/module-card-grid.test.tsx` in full before editing.

- [ ] **Step 2: Rewrite `module-card-grid.tsx`**

```typescript
// components/home/module-card-grid.tsx
import Link from 'next/link';
import {
  FileStack,
  Users,
  FolderKanban,
  BookOpen,
  CalendarCheck,
  ClipboardCheck,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

import {
  Card,
  CardHeader,
  CardDescription,
  CardTitle,
  CardAction,
  CardFooter,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ModuleCard } from '@/lib/home/module-cards';
import { ModuleCardChartView } from './module-card-charts';

// Same 7 module → icon assignments the original module picker used
// (docs/context/09-design-system.md §7.4 — icon tiles are crafted, not
// flat single-letter placeholders).
const MODULE_ICONS: Record<string, LucideIcon> = {
  Admissions: FileStack,
  Records: Users,
  'P-Files': FolderKanban,
  Markbook: BookOpen,
  Attendance: CalendarCheck,
  Evaluation: ClipboardCheck,
  'SIS Admin': ShieldCheck,
};

export function ModuleCardGrid({ cards }: { cards: ModuleCard[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const Icon = MODULE_ICONS[card.module] ?? FileStack;
        return (
          <Link key={card.href} href={card.href} className="block">
            <Card className="@container/card cursor-pointer gap-0 py-0 transition-all hover:-translate-y-0.5 hover:border-brand-indigo/40 hover:shadow-md">
              <CardHeader className="pt-5 pb-3">
                <CardDescription className="font-mono text-[10px] font-semibold tracking-[0.14em] uppercase">
                  {card.module}
                </CardDescription>
                <CardTitle className="font-serif text-[32px] leading-none font-semibold tabular-nums text-foreground">
                  {card.statValue}
                </CardTitle>
                <CardAction>
                  <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                    <Icon className="size-4" />
                  </div>
                  {card.badge ? (
                    <Badge variant={card.badge.tone} className="mt-2">
                      {card.badge.label}
                    </Badge>
                  ) : null}
                </CardAction>
              </CardHeader>
              <CardFooter className="flex-col items-start gap-2 pb-5 text-sm">
                <p className="text-xs font-medium text-foreground">
                  {card.statLabel}
                </p>
                <ModuleCardChartView chart={card.chart} />
              </CardFooter>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Update `module-card-charts.tsx`** (bar sits directly under a one-line label in the footer now, not under a `mb-2` value/label row — drop the now-redundant top margin, keep everything else)

```typescript
// components/home/module-card-charts.tsx
import type { ModuleCardChart } from '@/lib/home/module-cards';

export function ModuleCardChartView({ chart }: { chart: ModuleCardChart }) {
  if (chart.kind === 'none') return null;

  const pct = Math.max(0, Math.min(100, chart.pct));
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-hairline"
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

(This is the same logic as before — only the `mb-2`/margin classes that assumed the old flat layout are gone, since `CardFooter`'s `gap-2` now handles the spacing between the label and the bar.)

- [ ] **Step 4: Verify the test file still passes, fix if the DOM structure change broke a query**

Run: `npx vitest run __tests__/home/module-card-grid.test.tsx`

The existing tests query by `getByText(...)` and `getByRole('link', {...})` — these should still resolve since the text content and the outer `<Link>` are unchanged, only the internal wrapper structure changed. If a query fails, read the actual rendered output and fix the test to match the new (correct) structure — do not change the component to make a stale test pass.

Expected: PASS (2 tests) — if not, diagnose and report in the self-review below.

- [ ] **Step 5: Run the full suite and `next build`, then commit**

```bash
npx vitest run
npx next build
git add components/home/module-card-grid.tsx components/home/module-card-charts.tsx __tests__/home/module-card-grid.test.tsx
git commit -m "fix(home): module cards use real Card composition, 32px tabular-nums values, real icons"
```

---

### Task 3: `components/home/snapshot-card.tsx` — bigger stat value, mono-eyebrow label

**Files:**

- Modify: `components/home/snapshot-card.tsx`

**Interfaces:**

- No change to `SnapshotCard`'s props.

- [ ] **Step 1: Read the current file first**

- [ ] **Step 2: Rewrite `snapshot-card.tsx`**

```typescript
// components/home/snapshot-card.tsx
import { Card } from '@/components/ui/card';
import type { HomeKpi } from '@/lib/home/kpis';

export function SnapshotCard({ kpis }: { kpis: HomeKpi[] }) {
  if (kpis.length === 0) return null;
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border px-4 py-3 font-serif text-sm font-bold text-foreground">
        Snapshot
      </div>
      <div className="px-4">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="border-b border-border py-3 last:border-b-0"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-serif text-2xl leading-none font-bold tabular-nums text-foreground">
                {kpi.value}
              </span>
              <span className="max-w-[120px] text-right font-mono text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                {kpi.label}
              </span>
            </div>
            {kpi.fraction ? (
              <div className="mt-1 text-[11px] text-muted-foreground">
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

- [ ] **Step 3: Run the existing test to verify it still passes**

Run: `npx vitest run __tests__/home/snapshot-card.test.tsx`
Expected: PASS (2 tests) — the test queries by text content only, unaffected by the type-scale/label-case change.

- [ ] **Step 4: Commit**

```bash
git add components/home/snapshot-card.tsx
git commit -m "fix(home): Snapshot KPI values use the real 24px tabular-nums stat treatment"
```

---

### Task 4: `components/home/todo-panel.tsx` — fix the timeline, richer dots, more room

**Files:**

- Modify: `components/home/todo-panel.tsx`
- Modify: `app/(dashboard)/page.tsx`

**Interfaces:**

- No change to `TodoPanel`'s props. `components/home/todo-cr-actions.client.tsx` stays completely untouched (same security-boundary constraint as the prior plan).

- [ ] **Step 1: Read the current files first**

Read `components/home/todo-panel.tsx` and `app/(dashboard)/page.tsx` in full before editing.

- [ ] **Step 2: Rewrite `todo-panel.tsx`**

The concrete bug being fixed: the connecting-line `<div>`'s `left` offset didn't align with the dots' centers (they were positioned relative to different ancestors with mismatched math), and one CSS custom-property color-mix expression was invalid and silently dropped. This rewrite uses clean, consistent pixel math for the gutter, and gives the dots real visual weight (filled gradient circle with a check/alert glyph) instead of a thin 2px outline ring, per the user-approved mockup.

```typescript
// components/home/todo-panel.tsx
import Link from 'next/link';
import { Check, AlertTriangle, Circle } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { HomeTodoItem } from '@/lib/home/todos';
import { TodoCrActions } from './todo-cr-actions.client';

function initials(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]/).filter(Boolean);
  const chars =
    parts.length >= 2
      ? [parts[0][0], parts[1][0]]
      : [local[0], local[1] ?? ''];
  return chars.join('').toUpperCase();
}

export function TodoPanel({
  title,
  items,
}: {
  title: string;
  items: HomeTodoItem[];
}) {
  return (
    <Card className="flex-[2] overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <span className="font-serif text-base font-bold text-foreground">
          {title}
        </span>
        <span className="rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-[10px] font-semibold text-muted-foreground">
          {items.length} {items.length === 1 ? 'ITEM' : 'ITEMS'}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="px-5 py-4 text-xs text-muted-foreground">
          Nothing needs your attention right now.
        </div>
      ) : (
        <ol className="relative py-5 pr-5 pl-14">
          <div
            className="absolute top-[30px] bottom-[30px] left-[27px] w-px bg-border"
            aria-hidden
          />
          {items.map((item) => {
            const dotWarn =
              item.aging?.tone === 'warning' ||
              item.aging?.tone === 'destructive';
            const DotIcon = item.aging
              ? dotWarn
                ? AlertTriangle
                : Check
              : Circle;
            return (
              <li key={item.id} className="relative pb-7 last:pb-0">
                <span
                  className={cn(
                    'absolute top-0 -left-[42px] z-1 flex size-7 items-center justify-center rounded-full text-white shadow-sm',
                    dotWarn
                      ? 'bg-gradient-to-br from-brand-amber to-brand-amber/80'
                      : 'bg-gradient-to-br from-brand-indigo to-brand-navy'
                  )}
                  aria-hidden
                >
                  <DotIcon className={item.aging ? 'size-3.5' : 'size-2'} />
                </span>
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
                  <div className="mt-2 flex flex-wrap items-center gap-2.5 rounded-lg border border-border bg-muted px-3 py-2.5">
                    {item.requestedBy ? (
                      <>
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-hairline text-[10px] font-bold text-foreground">
                          {initials(item.requestedBy)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          requested by {item.requestedBy}
                        </span>
                      </>
                    ) : null}
                    {item.aging ? (
                      <Badge
                        variant={
                          item.aging.tone === 'destructive'
                            ? 'blocked'
                            : item.aging.tone
                        }
                        className="ml-auto"
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

Note: the `Badge` gained `className="ml-auto"` only when there's no `requestedBy` pushing it right already — since `requestedBy`'s wrapping `<>...</>` isn't itself a flex item with `ml-auto` logic, verify in the browser that the badge and action buttons still lay out sensibly on one row; this is a minor flex-wrap detail, not a structural risk.

- [ ] **Step 3: Update `app/(dashboard)/page.tsx`'s inter-region spacing**

Change the three region gaps from the 16px tier to the 32px tier (`docs/context/09-design-system.md` §7.5 — "48 between major regions"; using the 32 tier here since these are sub-regions of one page, not top-level page sections):

```typescript
      <QuickActionsRow actions={quickActions} />
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start">
        <TodoPanel title={todoTitle} items={todos} />
        <div className="flex flex-col gap-3 lg:w-[300px] lg:shrink-0">
          <ComingUpPanel events={events} />
          <SnapshotCard kpis={kpis} />
        </div>
      </div>
      <ModuleCardGrid cards={moduleCards} />
```

(Only `mb-4` → `mb-8` on the todo+sidebar row's wrapper `<div>` changes here — everything else in `page.tsx` stays as-is.) Also bump `QuickActionsRow`'s own `mb-4` to `mb-6` in `components/home/quick-actions-row.tsx` for consistent breathing room above the to-do row (a one-class change, not a rewrite).

- [ ] **Step 4: Run the full test suite and `next build`**

Run: `npx vitest run` then `npx next build`. The existing `__tests__/home/todo-panel.test.tsx` (from the prior plan) queries by text content and roles that are unchanged by this rewrite — confirm it still passes; if a specific query breaks because of the new icon-based dot markup, fix the test to match the corrected structure.

- [ ] **Step 5: Commit**

```bash
git add components/home/todo-panel.tsx "app/(dashboard)/page.tsx" components/home/quick-actions-row.tsx
git commit -m "fix(home): repair the timeline's broken connecting line, richer dots, more breathing room"
```

---

## Self-Review

**Spec coverage:** Attendance empty-state (Task 1) · module-card real Card composition + type scale + real icons (Task 2) · Snapshot stat-value scale (Task 3) · timeline connecting-line bug fix + richer dots + region spacing (Task 4). All four issues raised by the user, and all doc-citations from the design system, have a task.

**Placeholder scan:** no TBD/TODO; every code block is complete.

**Type consistency:** No exported type/signature changes anywhere in this plan except `HomeKpi`'s _values_ (not shape) for the empty-state case — every consumer already handles `fraction?: string` as optional, so `'Not yet marked today'` is just another valid string. `ModuleCardChartView`'s prop type (`ModuleCardChart`) is unchanged.
