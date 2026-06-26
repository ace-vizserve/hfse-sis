# Year Setup Control Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `/sis/ay-setup` into a single Year Setup control center — an AY picker + at-a-glance setup status for the selected year, with inline term-date / application-window editing and deep-links for the heavier config — while preserving the existing AY-rows table under a second "Manage years" tab.

**Architecture:** The page stays an async server component. It reads `?ay=` from searchParams (defaulting to the active AY), fetches readiness for the selected AY via the existing `getAyReadiness(ayCode)`, and renders a shadcn `Tabs` shell: **Year Setup** (new control center) + **Manage years** (the existing `AySetupDataTable` + rollover checklist, moved verbatim). The control center is a new server component composing existing client widgets (`TermDatesEditor`, `AyAcceptingApplicationsToggle`) plus a new client AY picker. Two pure helpers (select-AY resolution + status tone) are unit-tested; everything else is presentational and verified by build + manual smoke. No new API route, no readiness-logic change, no migration.

**Tech Stack:** Next.js 16 (App Router, async searchParams), React server + client components, shadcn `Tabs`/`Select`/`Card`/`Badge`/`Button`, Tailwind v4 tokens, Vitest (jsdom).

## Global Constraints

- **Design system is binding (Hard Rule #7).** Tokens only from `app/globals.css` — no raw `#rrggbb` / `oklch(...)` / `slate-*` / `zinc-*` / `gray-*` / `bg-white` / `bg-black`. Status badges use the §9.3 recipes (mint = done, amber = partial, muted = not started). One `default` (gradient) `Button` per view — the header's `NewAyButton` is it; every control-center action is `outline`/`ghost`/`link`/a `Switch`.
- **Role gate unchanged:** `/sis/ay-setup` stays `school_admin` + `superadmin` (registrar redirects to `/sis`). Do not widen it.
- **Next.js 16:** `searchParams` is async — `await` it. Server components may render client components as children.
- **No behavior change** to term-date saving, the accepting-applications toggle, AY create/switch/delete, or the readiness computation. This is consolidation + surfacing only.
- **Plain-English copy** for school admins — no dev jargon in any visible string.
- **No new API route, no migration.**
- **Full test coverage of new testable units.** Every new pure helper has unit tests (Task 1); every new client/presentational component has an RTL behavior test (Tasks 2, 3); the pill change is locked in by a test (Task 5). The async server page (Task 4) is not unit-tested directly — its only branching logic is the extracted, fully-tested `resolveSelectedAyCode`; the page itself is verified by `npx next build` + the manual smoke checklist. Tests follow the house patterns in `__tests__/_utils/` + `__tests__/dashboard/compare-ay-picker.test.tsx`.

---

### Task 1: Pure helpers — selected-AY resolution + status tone

**Files:**

- Create: `lib/sis/year-setup.ts`
- Test: `__tests__/sis/year-setup.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `resolveSelectedAyCode(ays: ReadonlyArray<{ ay_code: string; is_current: boolean }>, requested: string | undefined): string | null`
  - `ayStatusTone(ay: { is_current: boolean; accepting_applications: boolean }): AyStatusTone`
  - `type AyStatusTone = 'active' | 'early-bird' | 'inactive'`
  - `AY_STATUS_LABEL: Record<AyStatusTone, string>`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/sis/year-setup.test.ts
import { describe, it, expect } from 'vitest';
import { resolveSelectedAyCode, ayStatusTone } from '@/lib/sis/year-setup';

const ays = [
  { ay_code: 'AY2027', is_current: false },
  { ay_code: 'AY2026', is_current: true },
  { ay_code: 'AY2025', is_current: false },
];

describe('resolveSelectedAyCode', () => {
  it('returns the requested code when it is a real AY', () => {
    expect(resolveSelectedAyCode(ays, 'AY2027')).toBe('AY2027');
  });

  it('falls back to the active AY when requested is missing or invalid', () => {
    expect(resolveSelectedAyCode(ays, 'AY9999')).toBe('AY2026');
    expect(resolveSelectedAyCode(ays, undefined)).toBe('AY2026');
  });

  it('falls back to the first AY when none is active', () => {
    const noActive = ays.map((a) => ({ ...a, is_current: false }));
    expect(resolveSelectedAyCode(noActive, undefined)).toBe('AY2027');
  });

  it('returns null when there are no AYs', () => {
    expect(resolveSelectedAyCode([], 'AY2026')).toBeNull();
  });
});

describe('ayStatusTone', () => {
  it('is active when the AY is current', () => {
    expect(
      ayStatusTone({ is_current: true, accepting_applications: false })
    ).toBe('active');
  });

  it('is early-bird when not current but accepting applications', () => {
    expect(
      ayStatusTone({ is_current: false, accepting_applications: true })
    ).toBe('early-bird');
  });

  it('is inactive otherwise', () => {
    expect(
      ayStatusTone({ is_current: false, accepting_applications: false })
    ).toBe('inactive');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/sis/year-setup.test.ts`
Expected: FAIL — cannot resolve `@/lib/sis/year-setup` (module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/sis/year-setup.ts
export type AyStatusTone = 'active' | 'early-bird' | 'inactive';

export const AY_STATUS_LABEL: Record<AyStatusTone, string> = {
  active: 'Active year',
  'early-bird': 'Early-bird open',
  inactive: 'Inactive',
};

/**
 * Resolves which AY the control center should show:
 * the requested ?ay= (if it is a real AY) → the active AY → the first AY → null.
 */
export function resolveSelectedAyCode(
  ays: ReadonlyArray<{ ay_code: string; is_current: boolean }>,
  requested: string | undefined
): string | null {
  if (ays.length === 0) return null;
  if (requested && ays.some((a) => a.ay_code === requested)) return requested;
  const active = ays.find((a) => a.is_current);
  return active ? active.ay_code : ays[0].ay_code;
}

export function ayStatusTone(ay: {
  is_current: boolean;
  accepting_applications: boolean;
}): AyStatusTone {
  if (ay.is_current) return 'active';
  if (ay.accepting_applications) return 'early-bird';
  return 'inactive';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/sis/year-setup.test.ts`
Expected: PASS (7 assertions across 2 suites).

- [ ] **Step 5: Commit**

```bash
git add lib/sis/year-setup.ts __tests__/sis/year-setup.test.ts
git commit -m "feat(sis): pure helpers for year-setup AY selection + status tone"
```

---

### Task 2: AY picker (client navigation control)

**Files:**

- Create: `components/sis/year-setup/ay-picker.tsx`

**Interfaces:**

- Consumes: shadcn `Select` from `@/components/ui/select`; `useRouter` from `next/navigation`.
- Produces: `AyPicker({ ays, selected }: { ays: Array<{ ayCode: string; label: string; isCurrent: boolean }>; selected: string })` — a `Select` that, on change, navigates to `/sis/ay-setup?ay=<code>`.

- [ ] **Step 1: Write the component**

```tsx
// components/sis/year-setup/ay-picker.tsx
'use client';

import { useRouter } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type AyPickerProps = {
  ays: Array<{ ayCode: string; label: string; isCurrent: boolean }>;
  selected: string;
};

export function AyPicker({ ays, selected }: AyPickerProps) {
  const router = useRouter();
  return (
    <Select
      value={selected}
      onValueChange={(code) => router.push(`/sis/ay-setup?ay=${code}`)}
    >
      <SelectTrigger className="w-[240px]" aria-label="Choose academic year">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ays.map((ay) => (
          <SelectItem key={ay.ayCode} value={ay.ayCode}>
            {ay.label}
            {ay.isCurrent ? ' · Active' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 2: Write the behavior test**

Mirror the house pattern in `__tests__/dashboard/compare-ay-picker.test.tsx` (Radix Select interaction, polyfilled in `vitest.setup.ts`).

```tsx
// __tests__/sis/year-setup-ay-picker.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AyPicker } from '@/components/sis/year-setup/ay-picker';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/sis/ay-setup',
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => vi.clearAllMocks());

const AYS = [
  { ayCode: 'AY2026', label: 'Academic Year 2026', isCurrent: true },
  { ayCode: 'AY2027', label: 'Academic Year 2027', isCurrent: false },
];

describe('AyPicker', () => {
  it('shows the selected AY in the trigger', () => {
    render(<AyPicker ays={AYS} selected="AY2026" />);
    const matches = screen.getAllByText(/Academic Year 2026/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('navigates to /sis/ay-setup?ay=<code> when another AY is chosen', async () => {
    const user = userEvent.setup();
    render(<AyPicker ays={AYS} selected="AY2026" />);

    await user.click(screen.getByRole('combobox'));
    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: /Academic Year 2027/ })
      ).toBeInTheDocument()
    );
    await user.click(
      screen.getByRole('option', { name: /Academic Year 2027/ })
    );

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(pushMock).toHaveBeenCalledWith('/sis/ay-setup?ay=AY2027');
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run __tests__/sis/year-setup-ay-picker.test.tsx`
Expected: PASS (2 tests). If the component is missing/mis-imported, the suite fails to resolve the module — fix and re-run.

- [ ] **Step 4: Commit**

```bash
git add components/sis/year-setup/ay-picker.tsx __tests__/sis/year-setup-ay-picker.test.tsx
git commit -m "feat(sis): year-setup AY picker (navigates ?ay=) + tests"
```

---

### Task 3: Year Setup control center component

**Files:**

- Create: `components/sis/year-setup/year-setup-control-center.tsx`

**Interfaces:**

- Consumes:
  - `AyPicker` (Task 2)
  - `ayStatusTone`, `AY_STATUS_LABEL`, `type AyStatusTone` (Task 1)
  - `TermDatesEditor` from `@/components/sis/term-dates-editor` — props `{ ayCode: string; ayLabel: string; terms: TermRow[]; children: React.ReactNode }`
  - `AyAcceptingApplicationsToggle` from `@/components/sis/ay-accepting-applications-toggle` — props `{ ayCode: string; current: boolean; isCurrentAy: boolean }`
  - `type AcademicYearListItem, TermRow` from `@/lib/sis/ay-setup/queries`
  - `type AyReadiness, ReadinessStep, ReadinessStepId` from `@/lib/sis/readiness`
- Produces: `YearSetupControlCenter({ ays, selectedAy, selectedTerms, readiness }): JSX` (server component) consumed by the page in Task 4. Props:
  - `ays: Array<{ ayCode: string; label: string; isCurrent: boolean }>`
  - `selectedAy: AcademicYearListItem | null`
  - `selectedTerms: TermRow[]`
  - `readiness: AyReadiness | null`

**Notes for the implementer:**

- This is a **server** component (no `'use client'`) that renders the client widgets as children — that is allowed in Next 16.
- `AcademicYearListItem` carries `ay_code`, `label`, `is_current`, `accepting_applications`, and `counts: { sections, subject_configs, ... }`.
- The 4 readiness steps come straight from `readiness.steps`; the `ay-setup` step (`step.id === 'ay-setup'`) gets the inline `TermDatesEditor`, the other three get an "Open" deep-link to `step.href`. Step `grading-sheets` may carry `fraction: { done, total }`.

- [ ] **Step 1: Write the component**

```tsx
// components/sis/year-setup/year-setup-control-center.tsx
import Link from 'next/link';
import {
  ArrowUpRight,
  CalendarCog,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  Clock,
  LayoutGrid,
  Sparkles,
  Stamp,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { AyAcceptingApplicationsToggle } from '@/components/sis/ay-accepting-applications-toggle';
import { TermDatesEditor } from '@/components/sis/term-dates-editor';
import { AyPicker } from '@/components/sis/year-setup/ay-picker';
import {
  AY_STATUS_LABEL,
  ayStatusTone,
  type AyStatusTone,
} from '@/lib/sis/year-setup';
import type { AcademicYearListItem, TermRow } from '@/lib/sis/ay-setup/queries';
import type {
  AyReadiness,
  ReadinessStep,
  ReadinessStepId,
} from '@/lib/sis/readiness';

const STEP_ICONS: Record<ReadinessStepId, LucideIcon> = {
  'ay-setup': CalendarCog,
  calendar: CalendarDays,
  sections: LayoutGrid,
  'grading-sheets': ClipboardList,
};

const STATUS_BADGE_CLASS: Record<AyStatusTone, string> = {
  active: 'h-6 border-brand-mint bg-brand-mint/30 text-ink',
  'early-bird': 'h-6 border-brand-indigo-soft bg-accent text-brand-indigo-deep',
  inactive: 'h-6 text-muted-foreground',
};

function StepStatusBadge({ status }: { status: ReadinessStep['status'] }) {
  if (status === 'done') {
    return (
      <Badge
        variant="outline"
        className="h-6 gap-1 border-brand-mint bg-brand-mint/30 text-ink"
      >
        <CheckCircle2 className="size-3" /> Ready
      </Badge>
    );
  }
  if (status === 'partial') {
    return (
      <Badge
        variant="outline"
        className="h-6 gap-1 border-brand-amber bg-brand-amber/20 text-ink"
      >
        <Clock className="size-3" /> In progress
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="h-6 gap-1 text-muted-foreground">
      <CircleDashed className="size-3" /> Not started
    </Badge>
  );
}

function LinkRow({
  icon: Icon,
  title,
  description,
  href,
  emphasized = false,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  emphasized?: boolean;
}) {
  return (
    <li
      className={
        'flex items-center justify-between gap-4 px-6 py-4' +
        (emphasized ? ' bg-brand-amber/5' : '')
      }
    >
      <div className="flex items-start gap-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="space-y-1">
          <p className="font-medium text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <Button variant="ghost" size="sm" className="gap-1" asChild>
        <Link href={href}>
          Open
          <ArrowUpRight className="size-3.5" />
        </Link>
      </Button>
    </li>
  );
}

export function YearSetupControlCenter({
  ays,
  selectedAy,
  selectedTerms,
  readiness,
}: {
  ays: Array<{ ayCode: string; label: string; isCurrent: boolean }>;
  selectedAy: AcademicYearListItem | null;
  selectedTerms: TermRow[];
  readiness: AyReadiness | null;
}) {
  if (!selectedAy || !readiness) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <CalendarCog className="size-5" />
          </div>
          <p className="font-serif text-lg font-semibold text-foreground">
            No academic year yet
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create an academic year to start setting up its terms, calendar,
            sections, and grading sheets.
          </p>
        </CardContent>
      </Card>
    );
  }

  const tone = ayStatusTone(selectedAy);
  const pct =
    readiness.total > 0
      ? Math.round((readiness.complete / readiness.total) * 100)
      : 0;
  const needsTemplate =
    selectedAy.counts.sections === 0 || selectedAy.counts.subject_configs === 0;

  return (
    <div className="space-y-6">
      {/* AY picker + status + readiness summary */}
      <Card>
        <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Configuring
            </CardDescription>
            <div className="flex flex-wrap items-center gap-3">
              <AyPicker ays={ays} selected={selectedAy.ay_code} />
              <Badge variant="outline" className={STATUS_BADGE_CLASS[tone]}>
                {AY_STATUS_LABEL[tone]}
              </Badge>
            </div>
          </div>
          <div className="min-w-[220px] space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-foreground">
                Core readiness
              </span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {readiness.complete} / {readiness.total} ready
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-indigo-soft to-brand-sky transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Tier 1 — Core readiness steps */}
      <Card className="gap-0 py-0">
        <CardHeader className="border-b border-border py-5">
          <CardDescription>Core readiness</CardDescription>
          <CardTitle className="font-serif text-[22px]">
            Make the year ready
          </CardTitle>
        </CardHeader>
        <ul className="divide-y divide-border">
          {readiness.steps.map((step) => {
            const Icon = STEP_ICONS[step.id];
            return (
              <li key={step.id} className="flex items-start gap-4 px-6 py-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                  <Icon className="size-4" />
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{step.label}</p>
                    <StepStatusBadge status={step.status} />
                    {step.fraction ? (
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        {step.fraction.done}/{step.fraction.total} sections
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {step.description}
                  </p>
                </div>
                <div className="mt-0.5 shrink-0">
                  {step.id === 'ay-setup' ? (
                    <TermDatesEditor
                      ayCode={selectedAy.ay_code}
                      ayLabel={selectedAy.label}
                      terms={selectedTerms}
                    >
                      <Button variant="outline" size="sm">
                        Edit term dates
                      </Button>
                    </TermDatesEditor>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      asChild
                    >
                      <Link href={step.href}>
                        Open
                        <ArrowUpRight className="size-3.5" />
                      </Link>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Tier 2/3 + convenient links */}
      <Card className="gap-0 py-0">
        <CardHeader className="border-b border-border py-5">
          <CardDescription>More setup</CardDescription>
          <CardTitle className="font-serif text-[22px]">
            Admissions &amp; school-wide
          </CardTitle>
        </CardHeader>
        <ul className="divide-y divide-border">
          <li className="flex items-center justify-between gap-4 px-6 py-4">
            <div className="flex items-start gap-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <CalendarDays className="size-4" />
              </div>
              <div className="space-y-1">
                <p className="font-medium text-foreground">
                  Application window
                </p>
                <p className="text-sm text-muted-foreground">
                  Open or close early-bird applications for this year.
                </p>
              </div>
            </div>
            <AyAcceptingApplicationsToggle
              ayCode={selectedAy.ay_code}
              current={selectedAy.accepting_applications}
              isCurrentAy={selectedAy.is_current}
            />
          </li>
          <LinkRow
            icon={LayoutGrid}
            title="Class template &amp; subjects"
            description={
              needsTemplate
                ? 'This year has no sections or subjects yet — set up the class template first.'
                : 'Edit the section list and subject weights that new years copy from.'
            }
            href="/sis/admin/template"
            emphasized={needsTemplate}
          />
          <LinkRow
            icon={Sparkles}
            title="Virtue themes"
            description="Set each term's virtue theme, shown on report-card comments."
            href="/evaluation/virtue-themes"
          />
          <LinkRow
            icon={Stamp}
            title="Letterhead &amp; school details"
            description="Organization name, address, and the report-card letterhead."
            href="/sis/admin/school-config"
          />
        </ul>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Write the render/behavior test**

`YearSetupControlCenter` is a synchronous (non-async) server component — RTL renders it directly. Its child widgets call `useRouter` (mock `next/navigation`) and `useMutation` (wrap in `renderWithClient`). Type-only imports of the `server-only` queries module are erased, so they don't throw under jsdom.

```tsx
// __tests__/sis/year-setup-control-center.test.tsx
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { YearSetupControlCenter } from '@/components/sis/year-setup/year-setup-control-center';
import { renderWithClient } from '../_utils/render-with-client';
import type { AyReadiness } from '@/lib/sis/readiness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/sis/ay-setup',
  useSearchParams: () => new URLSearchParams(),
}));

const READINESS: AyReadiness = {
  ayCode: 'AY2026',
  complete: 2,
  total: 4,
  steps: [
    {
      id: 'ay-setup',
      step: 1,
      label: 'AY Setup',
      description: 'Academic year active with dated terms',
      href: '/sis/ay-setup',
      status: 'done',
    },
    {
      id: 'calendar',
      step: 2,
      label: 'School Calendar',
      description: 'All terms have calendar coverage',
      href: '/sis/calendar',
      status: 'done',
    },
    {
      id: 'sections',
      step: 3,
      label: 'Sections',
      description: 'No sections created for this AY',
      href: '/sis/sections',
      status: 'not_started',
    },
    {
      id: 'grading-sheets',
      step: 4,
      label: 'Grading Sheets',
      description: '1 of 3 sections have grading sheets',
      href: '/markbook/sections',
      status: 'partial',
      fraction: { done: 1, total: 3 },
    },
  ],
};

const PICKER_AYS = [
  { ayCode: 'AY2026', label: 'Academic Year 2026', isCurrent: true },
];

function makeAy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ay-id',
    ay_code: 'AY2026',
    label: 'Academic Year 2026',
    is_current: true,
    accepting_applications: false,
    created_at: '2026-01-01',
    counts: {
      terms: 4,
      sections: 3,
      subject_configs: 10,
      section_students: 50,
    },
    has_children: true,
    ...overrides,
  } as never;
}

describe('YearSetupControlCenter', () => {
  it('shows the empty state when there is no selected AY', () => {
    renderWithClient(
      <YearSetupControlCenter
        ays={[]}
        selectedAy={null}
        selectedTerms={[]}
        readiness={null}
      />
    );
    expect(screen.getByText('No academic year yet')).toBeInTheDocument();
  });

  it('renders all four readiness steps with their status and the grading fraction', () => {
    renderWithClient(
      <YearSetupControlCenter
        ays={PICKER_AYS}
        selectedAy={makeAy()}
        selectedTerms={[]}
        readiness={READINESS}
      />
    );
    expect(screen.getByText('AY Setup')).toBeInTheDocument();
    expect(screen.getByText('School Calendar')).toBeInTheDocument();
    expect(screen.getByText('Sections')).toBeInTheDocument();
    expect(screen.getByText('Grading Sheets')).toBeInTheDocument();
    expect(screen.getAllByText('Ready').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('1/3 sections')).toBeInTheDocument();
  });

  it('inline-edits the AY Setup step and deep-links every other surface', () => {
    renderWithClient(
      <YearSetupControlCenter
        ays={PICKER_AYS}
        selectedAy={makeAy()}
        selectedTerms={[]}
        readiness={READINESS}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Edit term dates' })
    ).toBeInTheDocument();
    const hrefs = screen
      .getAllByRole('link', { name: /Open/ })
      .map((l) => l.getAttribute('href'));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/sis/calendar',
        '/sis/sections',
        '/markbook/sections',
        '/evaluation/virtue-themes',
        '/sis/admin/template',
        '/sis/admin/school-config',
      ])
    );
  });

  it('renders the application-window toggle for the selected AY', () => {
    renderWithClient(
      <YearSetupControlCenter
        ays={PICKER_AYS}
        selectedAy={makeAy()}
        selectedTerms={[]}
        readiness={READINESS}
      />
    );
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('emphasizes the class-template link when the AY has no sections or subjects', () => {
    renderWithClient(
      <YearSetupControlCenter
        ays={PICKER_AYS}
        selectedAy={makeAy({
          counts: {
            terms: 4,
            sections: 0,
            subject_configs: 0,
            section_students: 0,
          },
        })}
        selectedTerms={[]}
        readiness={READINESS}
      />
    );
    expect(
      screen.getByText(/no sections or subjects yet/i)
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run __tests__/sis/year-setup-control-center.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 4: Commit**

```bash
git add components/sis/year-setup/year-setup-control-center.tsx __tests__/sis/year-setup-control-center.test.tsx
git commit -m "feat(sis): Year Setup control center component + tests"
```

---

### Task 4: Restructure the page into the two-tab control center

**Files:**

- Modify: `app/(sis)/sis/ay-setup/page.tsx`

**Interfaces:**

- Consumes: `resolveSelectedAyCode` (Task 1), `YearSetupControlCenter` (Task 3), `getAyReadiness` from `@/lib/sis/readiness`, shadcn `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` from `@/components/ui/tabs`.
- Produces: the restructured page (no exported interface change).

**Implementer steps:**

- [ ] **Step 1: Read the current file**

Run: open `app/(sis)/sis/ay-setup/page.tsx` and note the exact existing import lines (`getSessionUser`, `redirect`, `listAcademicYears`, `listTermsByAy`, `getCopyForwardPreview`, `checkAyEmpty`, `NewAyButton`, `AySetupDataTable` + `AyTableRow`, `PageShell`, `Link`, icons `ArrowLeft`/`CalendarRange`). **Keep all of these.** You will add new imports and replace the JSX body + add new loader lines.

- [ ] **Step 2: Add the new imports**

Add these alongside the existing imports (keep the existing ones exactly as they are):

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getAyReadiness } from '@/lib/sis/readiness';
import { resolveSelectedAyCode } from '@/lib/sis/year-setup';
import { YearSetupControlCenter } from '@/components/sis/year-setup/year-setup-control-center';
```

- [ ] **Step 3: Make the page read `searchParams` and resolve the selected AY + readiness**

Change the function signature to accept async `searchParams`, and after the existing loaders (`ays`, `termsByAy`, `activeAyCode`, `preview`, `blockersByAy`, `tableRows`) add the selection + readiness resolution. The new signature and added block:

```tsx
export default async function AySetupPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  // --- existing auth gate stays here, unchanged ---
  // --- existing loaders stay here: ays, termsByAy, activeAyCode, preview,
  //     blockersByAy, tableRows ---

  const sp = await searchParams;
  const selectedAyCode = resolveSelectedAyCode(ays, sp.ay);
  const selectedAy = ays.find((a) => a.ay_code === selectedAyCode) ?? null;
  const selectedTerms = selectedAy ? (termsByAy[selectedAy.id] ?? []) : [];
  const readiness = selectedAyCode
    ? await getAyReadiness(selectedAyCode)
    : null;
  const pickerAys = ays.map((a) => ({
    ayCode: a.ay_code,
    label: a.label,
    isCurrent: a.is_current,
  }));

  // --- return JSX (Step 4) ---
}
```

- [ ] **Step 4: Replace the JSX body**

Keep the outer `<PageShell>`, the back `<Link href="/sis">`, and the `<header>` — but update the header eyebrow/title/description to name the page plainly, and keep `<NewAyButton preview={preview} />` in the header actions. Replace the old `<AySetupDataTable ... />` + rollover-checklist `<section>` with a `Tabs` shell. Full return:

```tsx
return (
  <PageShell>
    <Link
      href="/sis"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      Dashboard
    </Link>

    <header className="mt-4 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          SIS Admin · Year Setup
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Year setup.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          See how ready an academic year is and configure it in one place — term
          dates, calendar, sections, grading sheets, and more.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <NewAyButton preview={preview} />
      </div>
    </header>

    <Tabs defaultValue="setup" className="mt-8">
      <TabsList>
        <TabsTrigger value="setup">Year Setup</TabsTrigger>
        <TabsTrigger value="manage">Manage years</TabsTrigger>
      </TabsList>

      <TabsContent value="setup" className="mt-6">
        <YearSetupControlCenter
          ays={pickerAys}
          selectedAy={selectedAy}
          selectedTerms={selectedTerms}
          readiness={readiness}
        />
      </TabsContent>

      <TabsContent value="manage" className="mt-6 space-y-8">
        <AySetupDataTable rows={tableRows} />

        <section className="rounded-xl border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <CalendarRange className="size-4" />
            </div>
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Rollover checklist
            </p>
          </div>
          <ol className="list-decimal space-y-2 pl-6 text-sm text-muted-foreground">
            <li>
              Create the next academic year (copies sections + subject weights
              forward).
            </li>
            <li>
              Verify the parent-portal admissions team is ready for the new
              year.
            </li>
            <li>Switch the active year when the new year begins.</li>
            <li>
              Optionally delete an empty year you created by mistake (superadmin
              only).
            </li>
          </ol>
        </section>
      </TabsContent>
    </Tabs>
  </PageShell>
);
```

(If the existing rollover-checklist `<section>` markup differs, reuse its exact copy/icons — the point is only to relocate it under the **Manage years** tab. Do not change its content beyond moving it.)

- [ ] **Step 5: Verify the build compiles**

Run: `npx next build`
Expected: clean compile, no type errors, `/sis/ay-setup` builds.

- [ ] **Step 6: Manual smoke test**

Run the dev server and verify at `/sis/ay-setup` (as school_admin or superadmin):

- The page opens on the **Year Setup** tab with the AY picker defaulting to the active year and its status badge.
- The 4 core-readiness rows render with correct status chips; "Edit term dates" opens the `TermDatesEditor` dialog; the other three "Open" buttons deep-link to `/sis/calendar`, `/sis/sections`, `/markbook/sections`.
- Changing the AY picker navigates to `?ay=<code>` and re-renders status for that year.
- The **Manage years** tab shows the existing AY table + the rollover checklist.
- `?ay=` with a bogus code falls back to the active year (no crash).

- [ ] **Step 7: Commit**

```bash
git add app/(sis)/sis/ay-setup/page.tsx
git commit -m "feat(sis): restructure /sis/ay-setup into Year Setup control center + Manage years tabs"
```

---

### Task 5: Repoint the readiness pill's Open buttons to the control center

**Files:**

- Modify: `components/sis/ay-readiness-pill.tsx`

**Interfaces:**

- Consumes: nothing new.
- Produces: no interface change — the pill's per-step "Open" link now targets `/sis/ay-setup` (the control center) instead of each step's individual surface.

- [ ] **Step 1: Change the Open link target**

In `ReadinessRow` (the `<Link>` inside the `Button asChild`), change the href from the per-step value to the control center. Find:

```tsx
<Button variant="outline" size="sm" className="mt-0.5 shrink-0 gap-1" asChild>
  <Link href={step.href} onClick={onNavigate}>
    Open
    <ArrowUpRight className="size-3.5" />
  </Link>
</Button>
```

Replace `href={step.href}` with `href="/sis/ay-setup"`:

```tsx
<Button variant="outline" size="sm" className="mt-0.5 shrink-0 gap-1" asChild>
  <Link href="/sis/ay-setup" onClick={onNavigate}>
    Open
    <ArrowUpRight className="size-3.5" />
  </Link>
</Button>
```

Leave everything else (per-step status, icons, the `step.href` value still computed in `readiness.ts`) untouched.

- [ ] **Step 2: Write the behavior test locking in the new target**

The pill is presentational (readiness passed as a prop, no fetch), so a plain `render` works; opening its dialog uses the Radix polyfills already in `vitest.setup.ts`. If a test like this already exists for the pill, extend it rather than duplicating.

```tsx
// __tests__/sis/ay-readiness-pill.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AyReadinessPill } from '@/components/sis/ay-readiness-pill';
import type { AyReadiness } from '@/lib/sis/readiness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/sis',
  useSearchParams: () => new URLSearchParams(),
}));

const READINESS: AyReadiness = {
  ayCode: 'AY2026',
  complete: 2,
  total: 4,
  steps: [
    {
      id: 'ay-setup',
      step: 1,
      label: 'AY Setup',
      description: 'd',
      href: '/sis/ay-setup',
      status: 'done',
    },
    {
      id: 'calendar',
      step: 2,
      label: 'School Calendar',
      description: 'd',
      href: '/sis/calendar',
      status: 'done',
    },
    {
      id: 'sections',
      step: 3,
      label: 'Sections',
      description: 'd',
      href: '/sis/sections',
      status: 'not_started',
    },
    {
      id: 'grading-sheets',
      step: 4,
      label: 'Grading Sheets',
      description: 'd',
      href: '/markbook/sections',
      status: 'partial',
      fraction: { done: 1, total: 3 },
    },
  ],
};

describe('AyReadinessPill', () => {
  it('renders nothing for non-admin roles', () => {
    const { container } = render(
      <AyReadinessPill readiness={READINESS} role="teacher" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('points every step Open button at the Year Setup control center', async () => {
    const user = userEvent.setup();
    render(<AyReadinessPill readiness={READINESS} role="superadmin" />);

    await user.click(screen.getByRole('button', { name: /Year Setup/i }));

    const openLinks = await screen.findAllByRole('link', { name: /Open/ });
    expect(openLinks.length).toBe(4);
    for (const link of openLinks) {
      expect(link.getAttribute('href')).toBe('/sis/ay-setup');
    }
  });
});
```

(If the pill's floating trigger has a different accessible name than `/Year Setup/i`, use whatever the trigger actually renders — confirm against the component before finalizing.)

- [ ] **Step 3: Run the test + build**

Run: `npx vitest run __tests__/sis/ay-readiness-pill.test.tsx` then `npx next build`
Expected: PASS (2 tests); clean compile.

- [ ] **Step 4: Manual smoke test**

Open any `/sis/*` page as school_admin/superadmin, open the floating readiness pill, click any step's "Open" — it should land on `/sis/ay-setup` (the control center).

- [ ] **Step 5: Commit**

```bash
git add components/sis/ay-readiness-pill.tsx __tests__/sis/ay-readiness-pill.test.tsx
git commit -m "feat(sis): readiness pill Open buttons land on the Year Setup control center + test"
```

---

### Task 6: Full verification + docs

**Files:**

- Modify: `docs/sprints/development-plan.md` (status-snapshot line only)

- [ ] **Step 1: Full test suite + build**

Run: `npx vitest run` then `npx next build`
Expected: all tests pass — including the four new suites: `__tests__/sis/year-setup.test.ts`, `__tests__/sis/year-setup-ay-picker.test.tsx`, `__tests__/sis/year-setup-control-center.test.tsx`, `__tests__/sis/ay-readiness-pill.test.tsx`; build is clean.

- [ ] **Step 2: Design-system grep (Hard Rule #7)**

Grep the new/changed components for banned tokens:
`rg -n "#[0-9a-fA-F]{6}|oklch\(|slate-|zinc-|gray-|bg-white|bg-black" components/sis/year-setup/ "app/(sis)/sis/ay-setup/page.tsx" components/sis/ay-readiness-pill.tsx`
Expected: no matches.

- [ ] **Step 3: Update the dev-plan status snapshot**

Add a one-line current-state entry to the top status snapshot of `docs/sprints/development-plan.md` describing the Year Setup control center (consolidated AY setup status + inline term-dates/app-window editing + deep-links at `/sis/ay-setup`; no migration). Keep it to the existing snapshot style.

- [ ] **Step 4: Commit**

```bash
git add docs/sprints/development-plan.md
git commit -m "docs(plan): Year Setup control center — status snapshot"
```

---

## Self-Review

**Spec coverage:**

- Route restructured to two tabs (control center default + Manage years) → Task 4. ✓
- AY picker defaulting to current, `?ay=` driven → Tasks 1 (resolution) + 2 (picker) + 4 (wiring). ✓
- Tier 1 status chips from `getAyReadiness` + inline term-dates edit + deep-links → Task 3. ✓
- Virtue themes as a plain link (no chip) → Task 3 (`LinkRow`). ✓
- Tier 2 application-window inline toggle + template link (emphasized when empty) → Task 3. ✓
- Tier 3 letterhead/school-config link → Task 3. ✓
- Readiness pill Open → control center → Task 5. ✓
- Role gate unchanged, no new API, no migration → preserved in Task 4, stated in Global Constraints. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full content. ✓

**Type consistency:** `resolveSelectedAyCode`/`ayStatusTone`/`AyStatusTone`/`AY_STATUS_LABEL` (Task 1) are used identically in Tasks 3–4. `YearSetupControlCenter` prop names (`ays`/`selectedAy`/`selectedTerms`/`readiness`) match between Task 3 (definition) and Task 4 (call site). `TermDatesEditor`/`AyAcceptingApplicationsToggle` prop names match the verified signatures. `ReadinessStep.fraction` / `AcademicYearListItem.counts` / `accepting_applications` are real fields per the queries/readiness types. ✓

## Cross-references

KD #40, #66, #109 (readiness engine + pill), #118 (early-bird SIS-owned), #48 (SIS central config), #137/#138 (virtue themes). Spec: `docs/superpowers/specs/2026-06-26-year-setup-control-center-design.md`.
