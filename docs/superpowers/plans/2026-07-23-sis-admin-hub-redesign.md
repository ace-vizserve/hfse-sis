# SIS Admin Hub Command-Centre Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add readiness detail (on-demand via Popover), a School Snapshot, a per-module Activity overview, a governance Recent Activity feed, and two cross-module activity/health charts to `/sis` (the SIS Admin Hub) — reusing existing data loaders and, where possible, existing components verbatim.

**Architecture:** The hub page RSC (`app/(sis)/sis/page.tsx`) gains a few new parallel data fetches (composed with the existing `Promise.all`) and mounts new presentational components fed by two new thin loader modules (`lib/sis/hub-snapshot.ts`, `lib/sis/hub-module-overview.ts`). The readiness detail is a `Popover` embedded inside the existing `HubYearBand` component (which already receives the full `AyReadiness` object — no prop drilling needed). Recent Activity and the two Activity & health charts reuse the **existing** `StructuralChangesFeedCard`, `AuditDailyTrendCard`, and `AuditByModuleDrillCard` components verbatim (already built for `/sis/audit-log?view=overview`) — no new chart components.

**Tech Stack:** Next.js 16 (App Router, RSC/client split), TypeScript, `components/ui/popover.tsx` (Radix), `components/dashboard/charts/{trend-chart,comparison-bar-chart}.tsx`, Vitest + `@testing-library/react`.

## Global Constraints

- **Hard Rule #7 (binding):** tokens only from `app/globals.css`. No raw hex/oklch/slate/zinc/gray/bg-white/bg-black.
- **No new business-logic loaders** — every new data fetch composes _existing_ exported functions (`getLevelDistribution`, `listStaffUsers`, `resolveCurrentTerm`, `getHubKpis`, the five `get*KpisRange` functions, `getAuditDailyTrend`, `getAuditActivityByModule`, `getStructuralChangeFeed`, `resolveCompareAy`, `listAyCodes`, `growthDelta`) — the two new `lib/sis/hub-*.ts` files are thin composition + a handful of small pure helpers (roster average, days-left, staff tally), not new query surfaces.
- **Dates:** SGT calendar-date rule (KD #32) — use `sgToday()` (`lib/dates.ts`) for "today," never raw `new Date().toISOString()`. Date arithmetic is raw `Date.UTC` math (no dayjs/date-fns/moment), matching the existing pattern in `lib/sis/enrolment-position.ts::daysBetween`.
- **`RangeResult<T>` payload sits under `.current`** — every `get*KpisRange`/`getAuditDailyTrend`/`getAuditActivityByModule` call needs `result.current.<field>`, never a flat field.
- **The hub has no date-range picker.** `resolveRange`/`Preset` are NOT used here — every `RangeInput` the hub needs (today, this-week, last-14-days) is constructed directly as a plain object (`{ ayCode, from, to, cmpFrom: null, cmpTo: null }`), since no existing preset covers these windows and adding a page-level picker is out of scope (§7 of the spec).
- **Existing components are reused verbatim where the spec calls for it** (`StructuralChangesFeedCard`, `AuditDailyTrendCard`, `AuditByModuleDrillCard`) — do not fork or rebuild them.
- **Verify each task:** `npx tsc --noEmit` clean; `npx vitest run` no count regression; the final task runs `npx next build` + Hard-Rule-#7 grep.

---

## File Structure

**New:**

- `lib/sis/hub-readiness-summary.ts` — pure helpers: `ringPercent(step)`, `stepBadgeLabel(step)`, `groupStepsForPopover(steps)` (clusters into Core setup / Grading & staffing / Branding & admissions / Optional, mirroring `CLUSTER_LABEL_BEFORE` in `year-setup-checklist.tsx`).
- `components/sis/hub-readiness-popover.tsx` — `'use client'`, the "Summary" button + `Popover` + ring rows.
- `lib/sis/hub-snapshot.ts` — `getHubSnapshot(ayCode)`: composes `getLevelDistribution`, `listStaffUsers`, a lightweight section-roster average query, `resolveCurrentTerm` + days-left. Plus exported pure helpers `tallyStaffByRole`, `averageRosterSize`, `daysUntil` (unit-tested).
- `components/sis/hub-snapshot-card.tsx` — presentational School Snapshot card.
- `lib/sis/hub-module-overview.ts` — `getHubModuleOverview(ayCode, compareAyCode)`: fans out the 6 module KPI calls + Records' `growthDelta`.
- `components/sis/hub-module-overview.tsx` — presentational Module overview row.

**Modified:**

- `components/sis/hub-stat.tsx` — add optional `delta`/`deltaGoodWhen`/`comparisonLabel` props (mirrors `MetricCard`'s `DeltaChip` treatment).
- `components/sis/hub-year-band.tsx` — mount `<HubReadinessPopover readiness={readiness} />` next to the existing "Finish setup" button.
- `app/(sis)/sis/page.tsx` — new parallel fetches (snapshot, module overview, structural-change feed, audit trend, audit-by-module) + mount the new components.

**Tests:**

- `__tests__/sis/hub-readiness-summary.test.ts`
- `__tests__/sis/hub-snapshot.test.ts`
- `__tests__/dashboard/hub-stat-delta.test.tsx`

---

### Task 1: `HubStat` gains an optional delta chip

**Files:**

- Modify: `components/sis/hub-stat.tsx`
- Test: `__tests__/dashboard/hub-stat-delta.test.tsx` (create)

**Interfaces:**

- Produces: `HubStatProps.delta?: Delta`, `.deltaGoodWhen?: 'up' | 'down'` (default `'up'`), `.comparisonLabel?: string` — renders a small gradient-wash pill in the `CardFooter`, same recipe as `MetricCard`'s `DeltaChip` (`components/dashboard/metric-card.tsx`).

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/dashboard/hub-stat-delta.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Users } from 'lucide-react';
import { HubStat } from '@/components/sis/hub-stat';

describe('HubStat delta chip', () => {
  it('renders a mint chip for a good "up" delta', () => {
    render(
      <HubStat
        label="Enrolled students"
        value={330}
        icon={Users}
        delta={{ abs: 12, pct: 3.8, direction: 'up' }}
        comparisonLabel="vs AY2025"
      />
    );
    expect(screen.getByText(/\+12/)).toBeInTheDocument();
    expect(screen.getByText('vs AY2025')).toBeInTheDocument();
  });

  it('renders nothing extra when delta is omitted', () => {
    const { container } = render(
      <HubStat label="Active sections" value={24} icon={Users} />
    );
    expect(container.querySelector('[data-slot="delta-chip"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/dashboard/hub-stat-delta.test.tsx`
Expected: FAIL (props don't exist yet).

- [ ] **Step 3: Implement the props**

In `components/sis/hub-stat.tsx`, add near the top (after the `HubStatTone`/`TONE_CLASS` block):

```tsx
import type { Delta } from '@/lib/dashboard/range';
import { formatDeltaLabel } from '@/lib/dashboard/range';
import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from 'lucide-react';

// Same gradient-wash recipe as MetricCard's DeltaChip (components/dashboard/metric-card.tsx)
// — duplicated rather than imported, matching this file's existing precedent of not
// depending on MetricCard internals (see the file's own doc comment).
function hubDeltaChipClass(delta: Delta, goodWhen: 'up' | 'down'): string {
  if (delta.direction === 'flat')
    return 'border-border bg-muted text-muted-foreground';
  const isGood =
    (goodWhen === 'up' && delta.direction === 'up') ||
    (goodWhen === 'down' && delta.direction === 'down');
  return isGood
    ? 'border-brand-mint bg-gradient-to-b from-brand-mint/35 to-brand-mint/15 text-ink'
    : 'border-destructive/40 bg-gradient-to-b from-destructive/15 to-destructive/5 text-destructive';
}
```

Extend the props type and destructure:

```tsx
export function HubStat({
  label,
  value,
  icon: Icon,
  tone = 'brand',
  subtext,
  href,
  emphasize,
  delta,
  deltaGoodWhen = 'up',
  comparisonLabel,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: HubStatTone;
  subtext?: string;
  href?: string;
  emphasize?: boolean;
  delta?: Delta;
  deltaGoodWhen?: 'up' | 'down';
  comparisonLabel?: string;
}) {
```

Add the chip into the `CardFooter` (only rendered when `delta` is present), replacing the existing conditional `{subtext && (...)}` block with:

```tsx
{
  delta && (
    <div
      data-slot="delta-chip"
      className={cn(
        'inline-flex items-center gap-1 self-start rounded border px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider',
        hubDeltaChipClass(delta, deltaGoodWhen)
      )}
    >
      {delta.direction === 'up' ? (
        <ArrowUpIcon className="size-3" strokeWidth={2.5} />
      ) : delta.direction === 'down' ? (
        <ArrowDownIcon className="size-3" strokeWidth={2.5} />
      ) : (
        <MinusIcon className="size-3" strokeWidth={2.5} />
      )}
      {formatDeltaLabel(delta, { format: 'absolute' })}
    </div>
  );
}
{
  delta && comparisonLabel && (
    <p className="text-xs text-muted-foreground">{comparisonLabel}</p>
  );
}
{
  subtext && !delta && (
    <p className="text-xs text-muted-foreground">{subtext}</p>
  );
}
```

> Implementer note: confirm `CardFooter`'s current children in the file before editing — the `subtext` block is the only existing child; wrap the new chip + label logic inside the same `<CardFooter>` alongside it (don't render two `CardFooter`s). Confirm `formatDeltaLabel`'s exact signature by reading its definition in `lib/dashboard/range.ts` before calling it (it's already used this exact way in `metric-card.tsx` — copy that call shape if it differs from above).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/dashboard/hub-stat-delta.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/sis/hub-stat.tsx __tests__/dashboard/hub-stat-delta.test.tsx
git commit -m "feat(sis): HubStat gains an optional delta chip"
```

---

### Task 2: Readiness popover — pure helpers + component

**Files:**

- Create: `lib/sis/hub-readiness-summary.ts`
- Create: `components/sis/hub-readiness-popover.tsx`
- Test: `__tests__/sis/hub-readiness-summary.test.ts` (create)

**Interfaces:**

- Produces: `ringPercent(step: ReadinessStep): number`, `stepBadgeLabel(step: ReadinessStep): string`, `POPOVER_CLUSTERS: Array<{ label: string; stepIds: ReadinessStepId[] }>`, `groupStepsForPopover(steps: ReadinessStep[]): Array<{ label: string; steps: ReadinessStep[] }>`.
- Produces: `HubReadinessPopover({ readiness }: { readiness: AyReadiness })`.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/sis/hub-readiness-summary.test.ts
import { describe, it, expect } from 'vitest';
import {
  ringPercent,
  stepBadgeLabel,
  groupStepsForPopover,
} from '@/lib/sis/hub-readiness-summary';
import type { ReadinessStep } from '@/lib/sis/readiness';

function makeStep(overrides: Partial<ReadinessStep>): ReadinessStep {
  return {
    id: 'sections',
    step: 3,
    label: 'Sections',
    description: 'desc',
    href: '/sis/sections',
    status: 'done',
    required: true,
    ...overrides,
  };
}

describe('ringPercent', () => {
  it('returns 100 for a done step with no fraction (boolean step)', () => {
    expect(ringPercent(makeStep({ status: 'done', fraction: undefined }))).toBe(
      100
    );
  });
  it('returns 0 for a not_started boolean step', () => {
    expect(
      ringPercent(makeStep({ status: 'not_started', fraction: undefined }))
    ).toBe(0);
  });
  it('computes the real done/total percentage for a fractioned step', () => {
    expect(
      ringPercent(
        makeStep({ status: 'partial', fraction: { done: 142, total: 168 } })
      )
    ).toBeCloseTo(84.5, 1);
  });
});

describe('stepBadgeLabel', () => {
  it('reads "Ready" for done', () => {
    expect(stepBadgeLabel(makeStep({ status: 'done' }))).toBe('Ready');
  });
  it('reads the literal fraction for partial', () => {
    expect(
      stepBadgeLabel(
        makeStep({ status: 'partial', fraction: { done: 142, total: 168 } })
      )
    ).toBe('142/168');
  });
  it('reads "Optional" for a not_started optional step', () => {
    expect(
      stepBadgeLabel(makeStep({ status: 'not_started', required: false }))
    ).toBe('Optional');
  });
  it('reads "Not started" for a not_started required step', () => {
    expect(
      stepBadgeLabel(makeStep({ status: 'not_started', required: true }))
    ).toBe('Not started');
  });
});

describe('groupStepsForPopover', () => {
  it('clusters steps into the 4 documented groups, preserving step order within each', () => {
    const steps: ReadinessStep[] = [
      makeStep({ id: 'ay-setup', step: 1 }),
      makeStep({ id: 'calendar', step: 2 }),
      makeStep({ id: 'sections', step: 3 }),
      makeStep({ id: 'app-window', step: 10, required: false }),
    ];
    const groups = groupStepsForPopover(steps);
    expect(groups.map((g) => g.label)).toEqual([
      'Core setup',
      'Grading & staffing',
      'Optional',
    ]);
    expect(groups[0].steps.map((s) => s.id)).toEqual(['ay-setup', 'calendar']);
    expect(groups[2].steps.map((s) => s.id)).toEqual(['app-window']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/sis/hub-readiness-summary.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the pure helpers**

```ts
// lib/sis/hub-readiness-summary.ts
import type { ReadinessStep, ReadinessStepId } from './readiness';

/** Ring fill percentage for a step's progress ring. Boolean steps (no
 * fraction, e.g. letterhead/app-window) render full or empty by status. */
export function ringPercent(step: ReadinessStep): number {
  if (step.fraction) {
    const { done, total } = step.fraction;
    return total > 0 ? (done / total) * 100 : 0;
  }
  return step.status === 'done' ? 100 : 0;
}

/** Right-side badge text — honest per-step state, never a fabricated trend. */
export function stepBadgeLabel(step: ReadinessStep): string {
  if (step.status === 'done') return 'Ready';
  if (step.status === 'partial' && step.fraction) {
    return `${step.fraction.done}/${step.fraction.total}`;
  }
  return step.required ? 'Not started' : 'Optional';
}

// Mirrors CLUSTER_LABEL_BEFORE in components/sis/year-setup/year-setup-checklist.tsx —
// keep these two maps in sync if the checklist's own grouping ever changes.
const POPOVER_CLUSTERS: Array<{ label: string; stepIds: ReadinessStepId[] }> = [
  { label: 'Core setup', stepIds: ['ay-setup', 'calendar'] },
  {
    label: 'Grading & staffing',
    stepIds: [
      'sections',
      'subject-weights',
      'advisers',
      'section-subjects',
      'grading-sheets',
    ],
  },
  { label: 'Branding & admissions', stepIds: ['virtue-themes', 'letterhead'] },
  { label: 'Optional', stepIds: ['app-window'] },
];

export function groupStepsForPopover(
  steps: ReadinessStep[]
): Array<{ label: string; steps: ReadinessStep[] }> {
  const byId = new Map(steps.map((s) => [s.id, s]));
  return POPOVER_CLUSTERS.map((cluster) => ({
    label: cluster.label,
    steps: cluster.stepIds
      .map((id) => byId.get(id))
      .filter((s): s is ReadinessStep => !!s),
  })).filter((g) => g.steps.length > 0);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/sis/hub-readiness-summary.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the Popover component**

```tsx
// components/sis/hub-readiness-popover.tsx
'use client';

import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  groupStepsForPopover,
  ringPercent,
  stepBadgeLabel,
} from '@/lib/sis/hub-readiness-summary';
import type {
  AyReadiness,
  ReadinessStatus,
  ReadinessStep,
} from '@/lib/sis/readiness';

const RING_COLOR: Record<ReadinessStatus, string> = {
  done: 'var(--color-brand-mint)',
  partial: 'var(--color-brand-amber)',
  not_started: 'var(--color-muted-foreground)',
};

const BADGE_CLASS: Record<ReadinessStatus, string> = {
  done: 'bg-brand-mint/20 text-ink',
  partial: 'bg-brand-amber/20 text-ink',
  not_started: 'bg-muted text-muted-foreground',
};

function StepRing({ step }: { step: ReadinessStep }) {
  const pct = ringPercent(step);
  const color = RING_COLOR[step.status];
  return (
    <div
      className="relative flex size-11 shrink-0 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(${color} 0% ${pct}%, var(--color-secondary) ${pct}% 100%)`,
      }}
    >
      <div className="absolute inset-[6px] rounded-full bg-card" />
      <span className="relative font-mono text-[10px] font-bold text-foreground">
        {step.status === 'done' ? (
          <CheckCircle2 className="size-3.5 text-brand-mint" />
        ) : (
          `${Math.round(pct)}%`
        )}
      </span>
    </div>
  );
}

function StepRow({ step }: { step: ReadinessStep }) {
  return (
    <div className="flex items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0">
      <StepRing step={step} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-foreground">
          {step.label}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {step.description}
        </p>
      </div>
      <span
        className={cn(
          'shrink-0 rounded-full px-2 py-0.5 font-mono text-[10.5px] font-bold',
          BADGE_CLASS[step.status]
        )}
      >
        {stepBadgeLabel(step)}
      </span>
    </div>
  );
}

export function HubReadinessPopover({ readiness }: { readiness: AyReadiness }) {
  const groups = groupStepsForPopover(readiness.steps);
  if (readiness.total === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          Summary
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Setup readiness · {readiness.complete}/{readiness.total}
          </span>
          <Link
            href="/sis/ay-setup"
            className="text-[12px] font-semibold text-brand-indigo-deep hover:underline"
          >
            Full checklist →
          </Link>
        </div>
        {groups.map((group) => (
          <div key={group.label}>
            <p className="border-t border-border bg-muted/30 px-4 py-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {group.label}
            </p>
            {group.steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
```

> Implementer note: verify `var(--color-secondary)` and `var(--color-muted-foreground)` resolve as expected against `app/globals.css`'s `@theme inline` block (they should — these are the same tokens used elsewhere via Tailwind utility classes; here they're read directly as CSS custom properties for the `conic-gradient`, matching the pattern already used in this codebase's donut/ring charts, e.g. `components/dashboard/charts/donut-chart.client.tsx`'s `DEFAULT_COLORS` array which uses the identical `var(--color-chart-N)` convention).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/sis/hub-readiness-summary.ts components/sis/hub-readiness-popover.tsx __tests__/sis/hub-readiness-summary.test.ts
git commit -m "feat(sis): readiness detail Popover — pure helpers + ring-row component"
```

---

### Task 3: Wire the Popover into `HubYearBand`

**Files:**

- Modify: `components/sis/hub-year-band.tsx`

**Interfaces:**

- Consumes: `HubReadinessPopover` (Task 2).

- [ ] **Step 1: Add the Summary button next to "Finish setup"**

In `components/sis/hub-year-band.tsx`, import the new component:

```tsx
import { HubReadinessPopover } from '@/components/sis/hub-readiness-popover';
```

In the non-empty-state branch (the one with `complete`/`total`/`allDone`), change the trailing `<Button asChild ...>` block from a single button to a flex group with the popover trigger beside it:

```tsx
<div className="flex shrink-0 items-center gap-2">
  <HubReadinessPopover readiness={readiness} />
  <Button asChild size="sm" variant={allDone ? 'outline' : 'default'}>
    <Link href="/sis/ay-setup">
      {allDone ? (
        <>
          <CheckCircle2 className="size-4" /> Setup in place
        </>
      ) : (
        <>
          Finish setup <ArrowRight className="size-4" />
        </>
      )}
    </Link>
  </Button>
</div>
```

(Replaces the existing bare `<Button asChild size="sm" variant={...} className="shrink-0">...</Button>` — read the current file first to confirm the exact surrounding JSX before editing, since the `className="shrink-0"` moves from the `Button` to the wrapping `div`.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/sis/hub-year-band.tsx
git commit -m "feat(sis): wire the readiness Popover into HubYearBand's Summary button"
```

---

### Task 4: `lib/sis/hub-snapshot.ts` — loader + pure helpers

**Files:**

- Create: `lib/sis/hub-snapshot.ts`
- Test: `__tests__/sis/hub-snapshot.test.ts` (create)

**Interfaces:**

- Produces: `tallyStaffByRole(users: AdminUserRow[]): Record<Role, number>`, `averageRosterSize(counts: number[]): number | null`, `daysUntil(todayIso: string, endIso: string): number`, `getHubSnapshot(ayCode: string): Promise<HubSnapshot>`.
- Produces type: `HubSnapshot = { levelCounts: LevelCount[]; staffByRole: Record<Role, number>; totalStaff: number; activeSections: number; avgRosterSize: number | null; currentTermLabel: string | null; daysLeftInTerm: number | null }`.

- [ ] **Step 1: Write the failing tests for the pure helpers**

```ts
// __tests__/sis/hub-snapshot.test.ts
import { describe, it, expect } from 'vitest';
import {
  tallyStaffByRole,
  averageRosterSize,
  daysUntil,
} from '@/lib/sis/hub-snapshot';
import type { AdminUserRow } from '@/lib/sis/users/queries';

function makeUser(role: AdminUserRow['role']): AdminUserRow {
  return {
    id: 'x',
    email: 'x@x.com',
    role,
    display_name: 'X',
    disabled: false,
    created_at: '2026-01-01T00:00:00Z',
    last_sign_in_at: null,
  };
}

describe('tallyStaffByRole', () => {
  it('counts users per role, ignoring nulls', () => {
    const users = [
      makeUser('teacher'),
      makeUser('teacher'),
      makeUser('registrar'),
      makeUser(null),
    ];
    const tally = tallyStaffByRole(users);
    expect(tally.teacher).toBe(2);
    expect(tally.registrar).toBe(1);
    expect(tally.school_admin).toBe(0);
  });
});

describe('averageRosterSize', () => {
  it('averages a list of section counts', () => {
    expect(averageRosterSize([10, 20, 30])).toBe(20);
  });
  it('returns null for an empty list (no sections)', () => {
    expect(averageRosterSize([])).toBeNull();
  });
});

describe('daysUntil', () => {
  it('computes whole days between two ISO dates via UTC math', () => {
    expect(daysUntil('2026-02-06', '2026-02-24')).toBe(18);
  });
  it('returns 0 for the same date', () => {
    expect(daysUntil('2026-02-06', '2026-02-06')).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/sis/hub-snapshot.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// lib/sis/hub-snapshot.ts
import 'server-only';
import { unstable_cache } from 'next/cache';

import { getLevelDistribution, type LevelCount } from '@/lib/sis/dashboard';
import { listStaffUsers, type AdminUserRow } from '@/lib/sis/users/queries';
import { resolveCurrentTerm, type TermLike } from '@/lib/sis/current-term';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { createServiceClient } from '@/lib/supabase/service';
import { sgToday } from '@/lib/dates';
import { ROLES, type Role } from '@/lib/auth/roles';

export type HubSnapshot = {
  levelCounts: LevelCount[];
  staffByRole: Record<Role, number>;
  totalStaff: number;
  activeSections: number;
  avgRosterSize: number | null;
  currentTermLabel: string | null;
  daysLeftInTerm: number | null;
};

// ── Pure helpers (exported for unit tests) ─────────────────────────────────

export function tallyStaffByRole(users: AdminUserRow[]): Record<Role, number> {
  const tally = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<
    Role,
    number
  >;
  for (const u of users) {
    if (u.role) tally[u.role] += 1;
  }
  return tally;
}

export function averageRosterSize(counts: number[]): number | null {
  if (counts.length === 0) return null;
  const total = counts.reduce((s, n) => s + n, 0);
  return Math.round((total / counts.length) * 10) / 10;
}

// Raw Date.UTC math per KD #32 — no dayjs/date-fns/moment. Mirrors the exact
// pattern in lib/sis/enrolment-position.ts::daysBetween.
export function daysUntil(todayIso: string, endIso: string): number {
  const u = (iso: string) =>
    Date.UTC(
      Number(iso.slice(0, 4)),
      Number(iso.slice(5, 7)) - 1,
      Number(iso.slice(8, 10))
    );
  return Math.round((u(endIso) - u(todayIso)) / 86_400_000);
}

// ── Loader ───────────────────────────────────────────────────────────────

async function loadHubSnapshotUncached(ayCode: string): Promise<HubSnapshot> {
  const service = createServiceClient();

  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = (ayRow as { id: string } | null)?.id;

  const [levelCounts, staffUsers, termsRes, sectionsRes] = await Promise.all([
    getLevelDistribution(ayCode),
    listStaffUsers(),
    ayId
      ? service
          .from('terms')
          .select('id, term_number, start_date, end_date')
          .eq('academic_year_id', ayId)
      : Promise.resolve({ data: [] as TermLike[] }),
    ayId
      ? service.from('sections').select('id').eq('academic_year_id', ayId)
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);

  const sectionIds = ((sectionsRes.data ?? []) as { id: string }[]).map(
    (s) => s.id
  );
  const rosterCounts: number[] = [];
  if (sectionIds.length > 0) {
    const { data: enrolments } = await service
      .from('section_students')
      .select('section_id')
      .in('section_id', sectionIds)
      .neq('enrollment_status', 'withdrawn');
    const bySection = new Map<string, number>();
    for (const row of (enrolments ?? []) as { section_id: string }[]) {
      bySection.set(row.section_id, (bySection.get(row.section_id) ?? 0) + 1);
    }
    for (const id of sectionIds) rosterCounts.push(bySection.get(id) ?? 0);
  }

  const terms = (termsRes.data ?? []) as TermLike[];
  const today = sgToday();
  const currentTerm = resolveCurrentTerm(terms, today);

  return {
    levelCounts,
    staffByRole: tallyStaffByRole(staffUsers),
    totalStaff: staffUsers.length,
    activeSections: sectionIds.length,
    avgRosterSize: averageRosterSize(rosterCounts),
    currentTermLabel: currentTerm ? `Term ${currentTerm.term_number}` : null,
    daysLeftInTerm: currentTerm?.end_date
      ? Math.max(0, daysUntil(today, currentTerm.end_date))
      : null,
  };
}

export function getHubSnapshot(ayCode: string): Promise<HubSnapshot> {
  return unstable_cache(
    () => loadHubSnapshotUncached(ayCode),
    ['sis-hub-snapshot', ayCode],
    { tags: ['sis', `sis:${ayCode}`], revalidate: 300 }
  )();
}
```

> Implementer note: confirm `ROLES` is exported as a `Role[]` array from `lib/auth/roles.ts` (referenced in `lib/sis/users/queries.ts`'s own imports — `import { ROLES, type Role } from '@/lib/auth/roles';` — so it should already exist). Confirm `sgToday` is exported from `lib/dates.ts` per KD #32. If `getLevelDistribution`'s `LevelCount.level` is a word-form label (confirmed: "Primary One" not "P1") — that's fine, the snapshot card just renders whatever label the loader returns, no re-derivation needed.

- [ ] **Step 4: Run to verify pure-helper tests pass**

Run: `npx vitest run __tests__/sis/hub-snapshot.test.ts`
Expected: PASS (3 describe blocks, all pure — no DB mocking needed since `getHubSnapshot` itself isn't unit-tested here, only its exported pure pieces).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/sis/hub-snapshot.ts __tests__/sis/hub-snapshot.test.ts
git commit -m "feat(sis): hub snapshot loader — level/staff/section/term composition"
```

---

### Task 5: `HubSnapshotCard` component

**Files:**

- Create: `components/sis/hub-snapshot-card.tsx`

**Interfaces:**

- Consumes: `HubSnapshot` (Task 4).
- Produces: `HubSnapshotCard({ snapshot }: { snapshot: HubSnapshot })`.

- [ ] **Step 1: Implement**

```tsx
// components/sis/hub-snapshot-card.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { HubSnapshot } from '@/lib/sis/hub-snapshot';
import { ROLE_LABELS } from '@/lib/auth/roles';

const PRIMARY_LEVEL_HINTS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];

function isSecondaryLevel(label: string): boolean {
  return label.startsWith('Secondary');
}

export function HubSnapshotCard({ snapshot }: { snapshot: HubSnapshot }) {
  const maxCount = Math.max(1, ...snapshot.levelCounts.map((l) => l.count));

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b border-border py-4">
        <CardTitle className="font-serif text-lg font-semibold text-foreground">
          The school, at a glance
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-0 p-0 md:grid-cols-4">
        <div className="border-b border-border p-4 md:border-r md:border-b-0">
          <p className="mb-2.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Enrolled by level
          </p>
          <div className="space-y-1.5">
            {snapshot.levelCounts.map((l) => (
              <div
                key={l.level}
                className="flex items-center gap-2 text-[11.5px]"
              >
                <span className="w-16 shrink-0 truncate text-muted-foreground">
                  {l.level}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(l.count / maxCount) * 100}%`,
                      background: isSecondaryLevel(l.level)
                        ? 'linear-gradient(90deg, var(--color-brand-sky), var(--color-brand-indigo-soft))'
                        : 'linear-gradient(90deg, var(--color-brand-indigo), var(--color-brand-indigo-soft))',
                    }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right font-mono tabular-nums text-foreground">
                  {l.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="border-b border-border p-4 md:border-r md:border-b-0">
          <p className="mb-2.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Staff
          </p>
          <p className="font-serif text-2xl font-semibold text-foreground">
            {snapshot.totalStaff}
          </p>
          <p className="text-[11px] text-muted-foreground">Active accounts</p>
          <div className="mt-3 space-y-1">
            {(
              Object.entries(snapshot.staffByRole) as [
                keyof typeof ROLE_LABELS,
                number,
              ][]
            )
              .filter(([, count]) => count > 0)
              .map(([role, count]) => (
                <div key={role} className="flex justify-between text-[12px]">
                  <span className="text-muted-foreground">
                    {ROLE_LABELS[role]}
                  </span>
                  <span className="font-mono font-semibold text-foreground">
                    {count}
                  </span>
                </div>
              ))}
          </div>
        </div>

        <div className="border-b border-border p-4 md:border-r md:border-b-0">
          <p className="mb-2.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Sections
          </p>
          <p className="font-serif text-2xl font-semibold text-foreground">
            {snapshot.activeSections}
          </p>
          <p className="text-[11px] text-muted-foreground">Active this year</p>
          {snapshot.avgRosterSize != null && (
            <>
              <p className="mt-3 text-[11.5px] text-muted-foreground">
                Avg. {snapshot.avgRosterSize} students / section
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, (snapshot.avgRosterSize / 50) * 100)}%`,
                    background:
                      'linear-gradient(90deg, var(--color-brand-mint), var(--color-brand-sky))',
                  }}
                />
              </div>
            </>
          )}
        </div>

        <div className="p-4">
          <p className="mb-2.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Current term
          </p>
          <p className="font-serif text-xl font-semibold text-foreground">
            {snapshot.currentTermLabel ?? '—'}
          </p>
          {snapshot.daysLeftInTerm != null && (
            <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 font-mono text-[11px] font-semibold text-brand-indigo-deep">
              {snapshot.daysLeftInTerm} days left
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

> Implementer note: `ROLE_LABELS` — search `lib/auth/roles.ts` for an existing display-label map for `Role` values before assuming this name; if none exists, add a small local `ROLE_LABELS: Record<Role, string>` constant in this file instead (e.g. `{ teacher: 'Teachers', registrar: 'Registrar', school_admin: 'School admin', superadmin: 'Superadmin', 'p-file': 'P-Files officer', admissions: 'Admissions' }`) rather than inventing an import that may not exist.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Hard Rule #7 spot-check**

Run: `grep -nE "#[0-9a-fA-F]{6}|oklch\(|slate-|zinc-|gray-|bg-white|bg-black" components/sis/hub-snapshot-card.tsx`
Expected: no matches (all colors are `var(--color-*)` tokens or Tailwind utility classes).

- [ ] **Step 4: Commit**

```bash
git add components/sis/hub-snapshot-card.tsx
git commit -m "feat(sis): HubSnapshotCard — level/staff/section/term glance"
```

---

### Task 6: `lib/sis/hub-module-overview.ts` — loader

**Files:**

- Create: `lib/sis/hub-module-overview.ts`

**Interfaces:**

- Produces: `getHubModuleOverview(ayCode: string, compareAyCode: string | null): Promise<HubModuleOverviewRow[]>`.
- Produces type: `HubModuleOverviewRow = { key: string; label: string; value: string; href: string; tone: 'indigo' | 'amber' }`.

- [ ] **Step 1: Implement**

```ts
// lib/sis/hub-module-overview.ts
import 'server-only';

import { getAdmissionsKpisRange } from '@/lib/admissions/dashboard';
import { getAttendanceKpisRange } from '@/lib/attendance/dashboard';
import { getMarkbookKpisRange } from '@/lib/markbook/dashboard';
import { getEvaluationKpisRange } from '@/lib/evaluation/dashboard';
import { getPFilesKpisRange } from '@/lib/p-files/dashboard';
import { getHubKpis } from '@/lib/sis/dashboard';
import { growthDelta } from '@/lib/dashboard/growth';
import { sgToday } from '@/lib/dates';
import type { RangeInput } from '@/lib/dashboard/range';

export type HubModuleOverviewRow = {
  key: string;
  label: string;
  value: string;
  href: string;
  tone: 'indigo' | 'amber';
};

function isoDaysAgo(days: number, todayIso: string): string {
  const d = new Date(
    Date.UTC(
      Number(todayIso.slice(0, 4)),
      Number(todayIso.slice(5, 7)) - 1,
      Number(todayIso.slice(8, 10))
    )
  );
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function getHubModuleOverview(
  ayCode: string,
  compareAyCode: string | null
): Promise<HubModuleOverviewRow[]> {
  const today = sgToday();
  const weekAgo = isoDaysAgo(6, today);

  const weekRange: RangeInput = {
    ayCode,
    from: weekAgo,
    to: today,
    cmpFrom: null,
    cmpTo: null,
  };
  const todayRange: RangeInput = {
    ayCode,
    from: today,
    to: today,
    cmpFrom: null,
    cmpTo: null,
  };

  const [
    admissions,
    attendance,
    markbook,
    evaluation,
    pfiles,
    hubKpis,
    priorHubKpis,
  ] = await Promise.all([
    getAdmissionsKpisRange(weekRange),
    getAttendanceKpisRange(todayRange),
    getMarkbookKpisRange(weekRange),
    getEvaluationKpisRange(weekRange),
    getPFilesKpisRange(weekRange),
    getHubKpis(ayCode),
    compareAyCode ? getHubKpis(compareAyCode) : Promise.resolve(null),
  ]);

  const enrolledGrowth = growthDelta(
    hubKpis.enrolledStudents,
    priorHubKpis?.enrolledStudents ?? null
  );
  const enrolledSuffix =
    enrolledGrowth.pct != null
      ? `${enrolledGrowth.pct >= 0 ? '+' : ''}${Math.round(hubKpis.enrolledStudents - (priorHubKpis?.enrolledStudents ?? 0))} YoY`
      : '';

  return [
    {
      key: 'admissions',
      label: 'Admissions',
      value: `${admissions.current.applicationsInRange}`,
      href: '/admissions',
      tone: 'indigo',
    },
    {
      key: 'records',
      label: 'Records',
      value: `${hubKpis.enrolledStudents}${enrolledSuffix ? `, ${enrolledSuffix}` : ''}`,
      href: '/records',
      tone: 'indigo',
    },
    {
      key: 'attendance',
      label: 'Attendance',
      value: `${attendance.current.attendancePct.toFixed(1)}%`,
      href: '/attendance',
      tone: 'indigo',
    },
    {
      key: 'markbook',
      label: 'Markbook',
      value: `${markbook.current.lockedPct.toFixed(0)}%`,
      href: '/markbook',
      tone: 'indigo',
    },
    {
      key: 'evaluation',
      label: 'Evaluation',
      value: `${evaluation.current.submissionPct.toFixed(0)}%`,
      href: '/evaluation',
      tone: 'indigo',
    },
    {
      key: 'p-files',
      label: 'P-Files',
      value: `${pfiles.current.expiringSoon30}`,
      href: '/p-files',
      tone: pfiles.current.expiringSoon30 > 0 ? 'amber' : 'indigo',
    },
  ];
}
```

> Implementer note: this composition function is **not itself `unstable_cache`-wrapped** — every function it calls (`getAdmissionsKpisRange`, `getAttendanceKpisRange`, etc.) is already independently cached, so wrapping the composition again would only add a redundant cache layer with its own key-collision risk (same pattern as `getHubKpis` NOT wrapping its own already-cached constituent calls — verify this is in fact the existing convention by checking whether any other `lib/sis/*.ts` composition function wraps already-cached sub-calls; if the convention is otherwise, follow the existing pattern instead). Confirm `growthDelta`'s exact export location and signature (`lib/dashboard/growth.ts`) matches `growthDelta(current: number, prior: number | null): Growth` before calling.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/sis/hub-module-overview.ts
git commit -m "feat(sis): hub module-overview loader — 6 per-module live KPIs"
```

---

### Task 7: `HubModuleOverview` component

**Files:**

- Create: `components/sis/hub-module-overview.tsx`

**Interfaces:**

- Consumes: `HubModuleOverviewRow[]` (Task 6).

- [ ] **Step 1: Implement**

```tsx
// components/sis/hub-module-overview.tsx
import Link from 'next/link';
import {
  FileText,
  Users,
  CheckCircle2,
  BookOpen,
  MessageSquare,
  FileWarning,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { HubModuleOverviewRow } from '@/lib/sis/hub-module-overview';

const ICON_BY_KEY: Record<string, LucideIcon> = {
  admissions: FileText,
  records: Users,
  attendance: CheckCircle2,
  markbook: BookOpen,
  evaluation: MessageSquare,
  'p-files': FileWarning,
};

const TONE_CLASS: Record<HubModuleOverviewRow['tone'], string> = {
  indigo:
    'bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile',
  amber:
    'bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-brand-tile-amber',
};

export function HubModuleOverview({ rows }: { rows: HubModuleOverviewRow[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {rows.map((row) => {
        const Icon = ICON_BY_KEY[row.key] ?? FileText;
        return (
          <Link
            key={row.key}
            href={row.href}
            className="group flex flex-col gap-2.5 rounded-xl border border-border bg-gradient-to-b from-card to-muted/20 p-3.5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
          >
            <div
              className={cn(
                'flex size-8 items-center justify-center rounded-lg',
                TONE_CLASS[row.tone]
              )}
            >
              <Icon className="size-3.5" />
            </div>
            <div>
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {row.label}
              </p>
              <p className="mt-0.5 font-serif text-xl font-semibold tabular-nums text-foreground">
                {row.value}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + Hard Rule #7 spot-check**

Run: `npx tsc --noEmit && grep -nE "#[0-9a-fA-F]{6}|oklch\(|slate-|zinc-|gray-|bg-white|bg-black" components/sis/hub-module-overview.tsx`
Expected: clean, no matches.

- [ ] **Step 3: Commit**

```bash
git add components/sis/hub-module-overview.tsx
git commit -m "feat(sis): HubModuleOverview — per-module live KPI card row"
```

---

### Task 8: Wire everything into `app/(sis)/sis/page.tsx`

**Files:**

- Modify: `app/(sis)/sis/page.tsx`

**Interfaces:**

- Consumes: `getHubSnapshot` (Task 4), `HubSnapshotCard` (Task 5), `getHubModuleOverview` (Task 6), `HubModuleOverview` (Task 7), plus the **existing** `getStructuralChangeFeed`, `StructuralChangesFeedCard`, `getAuditDailyTrend`, `AuditDailyTrendCard`, `getAuditActivityByModule`, `AuditByModuleDrillCard`, `resolveCompareAy`, `listAyCodes`.

- [ ] **Step 1: Add the new imports**

At the top of `app/(sis)/sis/page.tsx`, alongside the existing imports:

```tsx
import { getHubSnapshot } from '@/lib/sis/hub-snapshot';
import { HubSnapshotCard } from '@/components/sis/hub-snapshot-card';
import { getHubModuleOverview } from '@/lib/sis/hub-module-overview';
import { HubModuleOverview } from '@/components/sis/hub-module-overview';
import { getStructuralChangeFeed } from '@/lib/sis/dashboard';
import { StructuralChangesFeedCard } from '@/components/sis/structural-changes-feed-card';
import {
  getAuditDailyTrend,
  getAuditActivityByModule,
} from '@/lib/sis/dashboard';
import { AuditDailyTrendCard } from '@/components/sis/audit-daily-trend-card';
import { AuditByModuleDrillCard } from '@/components/sis/drills/audit-by-module-drill-card';
import { resolveCompareAy } from '@/lib/dashboard/comparison';
import { listAyCodes } from '@/lib/academic-year';
import { sgToday } from '@/lib/dates';
import type { RangeInput } from '@/lib/dashboard/range';
import type { ComparisonBarPoint } from '@/components/dashboard/charts/comparison-bar-chart';
```

> Implementer note: `getStructuralChangeFeed`, `getAuditDailyTrend`, `getAuditActivityByModule` may already be imported in this file for other purposes — check before adding a duplicate import line; merge into the existing `from '@/lib/sis/dashboard'` import if one exists.

- [ ] **Step 2: Resolve the compare-AY and build the two new RangeInputs**

Inside the component, after `const ayCode = currentAy?.ay_code ?? '';` (existing line), add:

```tsx
const today = sgToday();
const isoDaysAgo = (days: number) => {
  const d = new Date(
    Date.UTC(
      Number(today.slice(0, 4)),
      Number(today.slice(5, 7)) - 1,
      Number(today.slice(8, 10))
    )
  );
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};
const trendRange: RangeInput = {
  ayCode,
  from: isoDaysAgo(13),
  to: today,
  cmpFrom: null,
  cmpTo: null,
};
const weekRange: RangeInput = {
  ayCode,
  from: isoDaysAgo(6),
  to: today,
  cmpFrom: null,
  cmpTo: null,
};
```

Just after `const ayReadiness = ...` (existing), add the compare-AY resolution:

```tsx
const ayCodes = ayCode ? await listAyCodes(service) : [];
const compareAyCode = ayCode
  ? resolveCompareAy(undefined, ayCodes, ayCode)
  : null;
```

- [ ] **Step 3: Add the new data fetches to the existing `Promise.all`**

Locate the existing `const [health, hubKpis, unassignedStudents, upcomingEvents, unassignedAdviserSections, approverFlowCounts, subjectConfigGapsForHub] = await Promise.all([...])` block. Extend both the destructure and the array with 5 new entries:

```tsx
const [
  health,
  hubKpis,
  unassignedStudents,
  upcomingEvents,
  unassignedAdviserSections,
  approverFlowCounts,
  subjectConfigGapsForHub,
  hubSnapshot,
  moduleOverview,
  structuralChanges,
  auditTrend,
  auditByModule,
] = await Promise.all([
  role === 'superadmin' ? getSystemHealth() : Promise.resolve(null),
  ayCode ? getHubKpis(ayCode).catch(() => null) : Promise.resolve(null),
  ayCode
    ? getClassAssignmentReadiness(ayCode).catch(
        () => [] as Awaited<ReturnType<typeof getClassAssignmentReadiness>>
      )
    : Promise.resolve(
        [] as Awaited<ReturnType<typeof getClassAssignmentReadiness>>
      ),
  ayCode
    ? getUpcomingCalendarEvents(ayCode).catch(
        () => [] as Awaited<ReturnType<typeof getUpcomingCalendarEvents>>
      )
    : Promise.resolve(
        [] as Awaited<ReturnType<typeof getUpcomingCalendarEvents>>
      ),
  currentAy
    ? loadUnassignedAdviserSections(currentAy.id, currentAy.ay_code)
    : Promise.resolve([] as Array<{ id: string; name: string }>),
  role === 'superadmin'
    ? loadApproverFlowCounts()
    : Promise.resolve({} as Record<string, number>),
  currentAy
    ? loadSubjectConfigGapsForHub(currentAy.id, currentAy.ay_code)
    : Promise.resolve([] as EmptyLevelGap[]),
  ayCode ? getHubSnapshot(ayCode).catch(() => null) : Promise.resolve(null),
  ayCode
    ? getHubModuleOverview(ayCode, compareAyCode).catch(() => [])
    : Promise.resolve([]),
  getStructuralChangeFeed().catch(() => []),
  ayCode
    ? getAuditDailyTrend(trendRange).catch(() => null)
    : Promise.resolve(null),
  ayCode
    ? getAuditActivityByModule(weekRange).catch(() => null)
    : Promise.resolve(null),
]);
```

> Implementer note: `.catch(() => ...)` fallbacks follow this file's own existing convention (every other fetch in this `Promise.all` already does this) — match the exact fallback shape (empty array vs `null`) to how each new component below handles an absent/empty prop, so nothing crashes on a partial-data AY.

- [ ] **Step 4: Build the `ComparisonBarPoint[]` for the module-breakdown chart**

Right after the `Promise.all` block:

```tsx
const auditByModuleData: ComparisonBarPoint[] = auditByModule
  ? auditByModule.current.map((row, i) => ({
      category: row.module,
      current: row.count,
      ...(auditByModule.comparison
        ? { comparison: auditByModule.comparison[i]?.count ?? 0 }
        : {}),
    }))
  : [];
```

- [ ] **Step 5: Mount the new sections in the JSX**

Inside the returned `<PageShell>`, after the existing `<HubYearBand readiness={ayReadiness} />` and before the existing stat-row `{hubKpis && (...)}` block, insert:

```tsx
{
  hubSnapshot && <HubSnapshotCard snapshot={hubSnapshot} />;
}
```

Immediately after the existing stat-row block (still before the existing `<section className="grid gap-3 lg:grid-cols-5">` Needs-attention/Coming-up row), insert:

```tsx
{
  moduleOverview.length > 0 && <HubModuleOverview rows={moduleOverview} />;
}
```

After the existing Needs-attention/Coming-up `<section>` block and before `<HubQuickActions />`, insert:

```tsx
<div className="grid gap-3 lg:grid-cols-2">
  <StructuralChangesFeedCard rows={structuralChanges} />
  <div className="grid gap-3">
    {auditTrend && (
      <AuditDailyTrendCard
        current={auditTrend.current}
        comparison={auditTrend.comparison}
      />
    )}
  </div>
</div>;
{
  auditByModuleData.length > 0 && (
    <AuditByModuleDrillCard
      data={auditByModuleData}
      rangeFrom={weekRange.from}
      rangeTo={weekRange.to}
    />
  );
}
```

> Implementer note: read the current file's exact JSX structure before editing — the insertion points above are described relative to the sections documented in the file's own top-of-file comment (`// Layout: hero → year band ... → 3:2 "Needs attention" / "Coming up" → quick actions`). Adjust the exact grid pairing of `StructuralChangesFeedCard` + `AuditDailyTrendCard` if a single-column stack reads better once actually rendered (this is a layout-polish call, not a data-correctness one) — the `AuditByModuleDrillCard` staying full-width below is deliberate (7 category bars need width).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add "app/(sis)/sis/page.tsx"
git commit -m "feat(sis): wire School Snapshot, Module overview, Recent activity, and activity/health charts into the Admin Hub"
```

---

### Task 9: Full verification

- [ ] **Step 1: Typecheck** — `npx tsc --noEmit` → clean.
- [ ] **Step 2: Tests** — `npx vitest run` → no count regression vs the pre-change baseline; new tests from Tasks 1, 2, 4 all present and passing.
- [ ] **Step 3: Build** — `npx next build` → clean; confirm `/sis` route compiles (RSC page importing several client components — `HubReadinessPopover`, `AuditByModuleDrillCard` — both already `'use client'`, no new boundary violations expected).
- [ ] **Step 4: Hard Rule #7 grep sweep** on every new/edited file:

```bash
git grep -nE "#[0-9a-fA-F]{6}|oklch\(|slate-|zinc-|gray-|bg-white|bg-black" -- \
  'lib/sis/hub-readiness-summary.ts' 'components/sis/hub-readiness-popover.tsx' \
  'lib/sis/hub-snapshot.ts' 'components/sis/hub-snapshot-card.tsx' \
  'lib/sis/hub-module-overview.ts' 'components/sis/hub-module-overview.tsx' \
  'components/sis/hub-stat.tsx' 'components/sis/hub-year-band.tsx' \
  'app/(sis)/sis/page.tsx'
```

Expected: no matches.

- [ ] **Step 5: Manual smoke** (browser, if available this session — otherwise a careful static read-through):
  - `/sis` loads for a `school_admin` and a `superadmin` session.
  - The "Summary" button on the year band opens the Popover with real per-step rings; click-away and Escape both close it; "Full checklist →" navigates to `/sis/ay-setup`.
  - School Snapshot renders level bars, staff counts, section utilization, and current term + days-left with real data on a populated AY.
  - Module overview's 6 cards link to their respective modules and show plausible live numbers (spot-check attendance % and evaluation % aren't swapped, since both are percentages of similar magnitude).
  - Recent activity shows governance-only rows (no student/grade entries) — confirms it's genuinely `getStructuralChangeFeed`, not accidentally wired to a broader feed.
  - Both new charts render with real data; the module-breakdown chart's bars are clickable and open the existing `SisAdminDrillSheet` (inherited for free from reusing `AuditByModuleDrillCard`).
  - Icon tiles across all new sections are crisp lucide SVGs, no missing/broken icons.

- [ ] **Step 6: Final commit (if any sweep fixes needed)**

```bash
git add -A && git commit -m "chore: sis admin hub redesign — verification fixes"
```

---

## Self-Review notes (author)

- **Spec coverage:** §4.1 (readiness Popover) → Tasks 2–3; §4.2 (School Snapshot) → Tasks 4–5; §4.3 (stat-row delta) → Task 1 (component) + Task 6 (Records' growthDelta wiring); §4.4 (Module overview) → Tasks 6–7; §4.5 (Recent activity) → Task 8 (reuses existing `StructuralChangesFeedCard` verbatim, per spec's explicit choice); §4.6 (Activity & health charts) → Task 8 (reuses existing `AuditDailyTrendCard`/`AuditByModuleDrillCard` verbatim). §5 (icon fidelity) is satisfied by construction — every new component in this plan uses real `lucide-react` imports, never emoji. ✓
- **Real-code discipline:** every function signature and return-type field used in this plan was verified against the actual source this session (two parallel research passes) — including the one correction the spec itself already flagged (Markbook's `lockedPct`, not `gradesEntered`) and one new correction made while writing this plan (the real `HubYearBand` already renders `{complete}/{total}` dynamically — there was no "stale 6/7" bug in the actual code to fix, only in the design mockup's placeholder copy; no task in this plan touches that non-existent bug).
- **`RangeResult<T>` discipline:** every `get*KpisRange`/`getAuditDailyTrend`/`getAuditActivityByModule` call site in this plan correctly reads `.current.<field>`, never a flat field.
- **No new date presets:** confirmed no existing `Preset` covers "today" or "this week," so this plan constructs `RangeInput` objects directly via raw `Date.UTC` math (KD #32-compliant) rather than extending the shared `Preset` union — a deliberate, narrower footprint than adding a page-wide picker feature the hub doesn't otherwise need.
- **Open verification items for the implementer:** confirm `ROLES`/`Role` export shape from `lib/auth/roles.ts` before Task 4/5; confirm whether a `ROLE_LABELS` map already exists before Task 5 (fallback: define locally); confirm `formatDeltaLabel`'s exact signature before Task 1; confirm the exact current JSX around `HubYearBand`'s CTA button and `app/(sis)/sis/page.tsx`'s section ordering before Tasks 3 and 8 (both tasks describe insertion points relative to existing structure, not exact line replacements, since those files may have shifted since this plan was written).
