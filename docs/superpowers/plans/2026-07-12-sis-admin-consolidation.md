# SIS Admin Consolidation ("13 → 6") Implementation Plan

> # ⛔ DO NOT IMPLEMENT THIS PLAN.
>
> **Abandoned 2026-07-31.** The work was built (14 commits), halted by Mr Ace
> before merge, and the branch was deleted without merging. It is kept only as a
> record of the reasoning — see the ABANDONED banner in
> `docs/superpowers/specs/2026-07-12-sis-admin-consolidation-design.md` for why
> it is dead rather than parked (most of the benefit already shipped as KD #154;
> its centrepiece sidebar change was explicitly reverted; two pages it merges no
> longer exist; and its discount-codes move contradicts KD #133).
>
> The unchecked `- [ ]` boxes below are **not** outstanding work. Do not resume
> this without an explicit, current instruction from Mr Ace — and if he ever gives
> one, re-plan from today's `main` rather than following these steps, which were
> written against a tree ~600 commits old.

> **For agentic workers:** ~~REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.~~ **Superseded by the stop notice above — this plan is not to be executed.** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge SIS Admin's 13 pages into 6 surfaces (flat sidebar, `?view=` cuts, seasonal readiness engine), move Discount Codes to Admissions, with every old URL redirecting to its new home.

**Architecture:** Each new surface is a thin RSC page that resolves its active cut from `?view=` (role-aware pure resolvers in `lib/sis/surface-views.ts`), runs ONLY that cut's data loads, and mounts the existing client components unchanged. Old pages become redirect stubs driven by one pure map (`lib/sis/legacy-routes.ts`). Nav/route tables flatten; all inbound links are repointed at the source (stubs are the safety net).

**Tech Stack:** Next.js 16 App Router (async `searchParams`), shadcn Tabs (`variant="segmented"`), Vitest (`npx vitest run`), existing loaders — **no migrations, no new API routes**.

**Spec:** `docs/superpowers/specs/2026-07-12-sis-admin-consolidation-design.md` (+ binding mockup `2026-07-12-sis-admin-consolidation-mockup.html`).

## Global Constraints

- Hard Rule #7: tokens only — no `#rrggbb`/`slate-*`/`gray-*`/`bg-white` in `app/` or `components/`.
- Plain-English UI copy (no dev jargon); one `default`-variant Button per view; status never colour-only.
- `SisPageHeader` prop is `group` (renders "SIS Admin · {group}"); `searchParams` is a `Promise` and must be awaited.
- All write-API role gates unchanged. Merged surfaces change where things live, never who can touch them.
- Per-cut gating is server-side: a page must NOT fetch data for a cut the viewer can't see (staff-page pattern).
- Legacy `ROUTE_ACCESS` rows are KEPT (same role sets) so old bookmarks reach their redirect stubs; new-surface rows are added. Comment legacy rows `// legacy → redirect stub (KD #155)`.
- Verify per task: `npx vitest run <touched test files>`; full `npx vitest run` + `npx next build` at Tasks 10 and 12.
- Commit after each task; message suffix: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The pre-commit hook runs prettier via lint-staged — expect reformatting, don't fight it.

---

### Task 1: Legacy route map + view resolvers (pure, TDD)

**Files:**

- Create: `lib/sis/legacy-routes.ts`
- Create: `lib/sis/surface-views.ts`
- Test: `__tests__/sis/legacy-routes.test.ts`, `__tests__/sis/surface-views.test.ts`

**Interfaces (Produces):**

- `legacySisTarget(oldPath: string, params?: Record<string, string | undefined>): string`
- `resolveSchoolYearView(role, raw) → 'year' | 'calendar'`; `resolveStructureView(raw) → 'levels' | 'weights' | 'defaults'`; `resolvePeopleView(role, raw) → 'assignments' | 'accounts' | 'approvers'`; `resolveSystemView(role, raw) → 'config' | 'settings' | 'audit'` (role type: `Role | null` from `@/lib/auth/roles`). Exported view union types: `SchoolYearView`, `StructureView`, `PeopleView`, `SystemView`.

- [ ] **Step 1: Write failing tests** — `__tests__/sis/legacy-routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { legacySisTarget } from '@/lib/sis/legacy-routes';

describe('legacySisTarget', () => {
  it('maps ay-setup, carrying ?ay', () => {
    expect(legacySisTarget('/sis/ay-setup')).toBe('/sis/school-year');
    expect(legacySisTarget('/sis/ay-setup', { ay: 'AY2027' })).toBe(
      '/sis/school-year?ay=AY2027'
    );
  });
  it('maps calendar with view + audience', () => {
    expect(legacySisTarget('/sis/calendar')).toBe(
      '/sis/school-year?view=calendar'
    );
    expect(legacySisTarget('/sis/calendar', { audience: 'primary' })).toBe(
      '/sis/school-year?view=calendar&audience=primary'
    );
  });
  it('maps the three structure pages', () => {
    expect(legacySisTarget('/sis/admin/levels', { ay: 'AY2026' })).toBe(
      '/sis/structure?view=levels&ay=AY2026'
    );
    expect(legacySisTarget('/sis/admin/subjects')).toBe(
      '/sis/structure?view=weights'
    );
    expect(legacySisTarget('/sis/admin/template')).toBe(
      '/sis/structure?view=defaults'
    );
  });
  it('maps staff/users/approvers into people', () => {
    expect(legacySisTarget('/sis/admin/staff')).toBe('/sis/people');
    expect(legacySisTarget('/sis/admin/staff', { view: 'accounts' })).toBe(
      '/sis/people?view=accounts'
    );
    expect(legacySisTarget('/sis/admin/users')).toBe(
      '/sis/people?view=accounts'
    );
    expect(legacySisTarget('/sis/admin/approvers')).toBe(
      '/sis/people?view=approvers'
    );
  });
  it('maps config/settings/audit into system, preserving audit mode + paging', () => {
    expect(legacySisTarget('/sis/admin/school-config')).toBe('/sis/system');
    expect(legacySisTarget('/sis/admin/settings')).toBe(
      '/sis/system?view=settings'
    );
    expect(legacySisTarget('/sis/audit-log')).toBe('/sis/system?view=audit');
    expect(legacySisTarget('/sis/audit-log', { view: 'overview' })).toBe(
      '/sis/system?view=audit&mode=overview'
    );
    expect(
      legacySisTarget('/sis/audit-log', { page: '3', pageSize: '100' })
    ).toBe('/sis/system?view=audit&page=3&pageSize=100');
  });
  it('sends discount codes to admissions, carrying ?ay', () => {
    expect(legacySisTarget('/sis/admin/discount-codes', { ay: 'AY2027' })).toBe(
      '/admissions/discount-codes?ay=AY2027'
    );
  });
  it('falls back to /sis for unknown paths', () => {
    expect(legacySisTarget('/sis/whatever')).toBe('/sis');
  });
});
```

`__tests__/sis/surface-views.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  resolvePeopleView,
  resolveSchoolYearView,
  resolveStructureView,
  resolveSystemView,
} from '@/lib/sis/surface-views';

describe('surface view resolvers', () => {
  it('school-year: registrar is calendar-only; others default to year', () => {
    expect(resolveSchoolYearView('registrar', undefined)).toBe('calendar');
    expect(resolveSchoolYearView('registrar', 'year')).toBe('calendar');
    expect(resolveSchoolYearView('school_admin', undefined)).toBe('year');
    expect(resolveSchoolYearView('superadmin', 'calendar')).toBe('calendar');
  });
  it('structure: defaults to levels; only known cuts pass through', () => {
    expect(resolveStructureView(undefined)).toBe('levels');
    expect(resolveStructureView('weights')).toBe('weights');
    expect(resolveStructureView('defaults')).toBe('defaults');
    expect(resolveStructureView('nope')).toBe('levels');
  });
  it('people: registrar assignments-only; approvers superadmin-only; accounts school_admin+', () => {
    expect(resolvePeopleView('registrar', 'accounts')).toBe('assignments');
    expect(resolvePeopleView('registrar', 'approvers')).toBe('assignments');
    expect(resolvePeopleView('school_admin', 'accounts')).toBe('accounts');
    expect(resolvePeopleView('school_admin', 'approvers')).toBe('assignments');
    expect(resolvePeopleView('superadmin', 'approvers')).toBe('approvers');
  });
  it('system: settings superadmin-only; audit school_admin+; default config', () => {
    expect(resolveSystemView('school_admin', 'settings')).toBe('config');
    expect(resolveSystemView('superadmin', 'settings')).toBe('settings');
    expect(resolveSystemView('school_admin', 'audit')).toBe('audit');
    expect(resolveSystemView('superadmin', undefined)).toBe('config');
  });
});
```

- [ ] **Step 2: Run to verify both fail** — `npx vitest run __tests__/sis/legacy-routes.test.ts __tests__/sis/surface-views.test.ts` → FAIL (modules not found).
- [ ] **Step 3: Implement** — `lib/sis/legacy-routes.ts`:

```ts
// Pure map of retired SIS Admin page paths to their consolidated homes
// (KD #155 "13 → 6"). Redirect stubs and tests share this single source.
export type LegacyParams = Record<string, string | undefined>;

function qs(pairs: Array<[string, string | undefined]>): string {
  const p = new URLSearchParams();
  for (const [k, v] of pairs) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function legacySisTarget(
  oldPath: string,
  params: LegacyParams = {}
): string {
  switch (oldPath) {
    case '/sis/ay-setup':
      return `/sis/school-year${qs([['ay', params.ay]])}`;
    case '/sis/calendar':
      return `/sis/school-year${qs([
        ['view', 'calendar'],
        ['audience', params.audience],
      ])}`;
    case '/sis/admin/levels':
      return `/sis/structure${qs([
        ['view', 'levels'],
        ['ay', params.ay],
      ])}`;
    case '/sis/admin/subjects':
      return `/sis/structure${qs([
        ['view', 'weights'],
        ['ay', params.ay],
      ])}`;
    case '/sis/admin/template':
      return '/sis/structure?view=defaults';
    case '/sis/admin/staff':
      return params.view === 'accounts'
        ? '/sis/people?view=accounts'
        : '/sis/people';
    case '/sis/admin/users':
      return '/sis/people?view=accounts';
    case '/sis/admin/approvers':
      return '/sis/people?view=approvers';
    case '/sis/admin/school-config':
      return '/sis/system';
    case '/sis/admin/settings':
      return '/sis/system?view=settings';
    case '/sis/audit-log':
      return `/sis/system${qs([
        ['view', 'audit'],
        ['mode', params.view === 'overview' ? 'overview' : undefined],
        ['page', params.page],
        ['pageSize', params.pageSize],
      ])}`;
    case '/sis/admin/discount-codes':
      return `/admissions/discount-codes${qs([['ay', params.ay]])}`;
    default:
      return '/sis';
  }
}
```

`lib/sis/surface-views.ts`:

```ts
// Role-aware ?view= resolvers for the consolidated SIS Admin surfaces (KD #155).
// A forbidden or unknown view silently resolves to the viewer's default cut —
// never an error page.
import type { Role } from '@/lib/auth/roles';

export type SchoolYearView = 'year' | 'calendar';
export type StructureView = 'levels' | 'weights' | 'defaults';
export type PeopleView = 'assignments' | 'accounts' | 'approvers';
export type SystemView = 'config' | 'settings' | 'audit';

export function resolveSchoolYearView(
  role: Role | null,
  raw: string | undefined
): SchoolYearView {
  if (role === 'registrar') return 'calendar';
  return raw === 'calendar' ? 'calendar' : 'year';
}

export function resolveStructureView(raw: string | undefined): StructureView {
  return raw === 'weights' || raw === 'defaults' ? raw : 'levels';
}

export function resolvePeopleView(
  role: Role | null,
  raw: string | undefined
): PeopleView {
  if (role === 'registrar') return 'assignments';
  if (raw === 'approvers')
    return role === 'superadmin' ? 'approvers' : 'assignments';
  return raw === 'accounts' ? 'accounts' : 'assignments';
}

export function resolveSystemView(
  role: Role | null,
  raw: string | undefined
): SystemView {
  if (raw === 'settings') return role === 'superadmin' ? 'settings' : 'config';
  return raw === 'audit' ? 'audit' : 'config';
}
```

- [ ] **Step 4: Run to verify both pass.**
- [ ] **Step 5: Commit** — `feat(sis): legacy route map + surface view resolvers for consolidation`.

---

### Task 2: Flatten SIS nav + route table + sidebar registry

**Files:**

- Modify: `lib/auth/roles.ts` (SIS_NAV lines ~422–533; ROUTE_ACCESS `/sis` rows ~672–714)
- Modify: `lib/sidebar/registry.ts` (SIS iconByHref ~L280–308, quickActionByRole)
- Test: `__tests__/auth/sis-nav-route-consistency.test.ts` (should pass unchanged — it iterates `NAV_BY_MODULE.sis`)

**Interfaces:** Produces the 6 nav hrefs later tasks link to: `/sis`, `/sis/school-year`, `/sis/structure`, `/sis/sections`, `/sis/people`, `/sis/system`.

- [ ] **Step 1: Replace SIS_NAV** with one flat section (keep the type shapes; no `hint`s — six items need no group chrome):

```ts
const SIS_NAV: NavSection[] = [
  {
    items: [
      {
        href: '/sis',
        label: 'Admin Hub',
        requiresRoles: ['school_admin', 'superadmin'],
      },
      {
        href: '/sis/school-year',
        label: 'School Year',
        countKey: 'aySetupReadiness',
        requiresRoles: ['registrar', 'school_admin', 'superadmin'],
      },
      {
        href: '/sis/structure',
        label: 'Structure',
        requiresRoles: ['school_admin', 'superadmin'],
      },
      {
        href: '/sis/sections',
        label: 'Sections',
        countKey: 'sectionsCount',
        requiresRoles: ['registrar', 'school_admin', 'superadmin'],
      },
      {
        href: '/sis/people',
        label: 'People & Access',
        countKey: 'staffCount',
        requiresRoles: ['registrar', 'school_admin', 'superadmin'],
      },
      {
        href: '/sis/system',
        label: 'System',
        requiresRoles: ['school_admin', 'superadmin'],
      },
    ],
  },
];
```

- [ ] **Step 2: ROUTE_ACCESS** — insert new rows ABOVE the legacy `/sis/*` rows (order: longest/most-specific first is already the convention; these four are siblings of the existing `/sis/sections` row):

```ts
{ prefix: '/sis/school-year', allowed: ['registrar', 'school_admin', 'superadmin'] },
{ prefix: '/sis/structure', allowed: ['school_admin', 'superadmin'] },
{ prefix: '/sis/people', allowed: ['registrar', 'school_admin', 'superadmin'] },
{ prefix: '/sis/system', allowed: ['school_admin', 'superadmin'] },
```

Keep EVERY existing `/sis/*` row unchanged, each annotated `// legacy → redirect stub (KD #155)`. Do NOT remove the `/sis` catch-all.

- [ ] **Step 3: Sidebar registry** — in `SIDEBAR_REGISTRY.sis.iconByHref` replace the old-href entries with the six new hrefs (reuse the same lucide icons: School Year→the old ay-setup/calendar icon `CalendarRange` or existing calendar icon, Structure→the old levels `Layers`, People & Access→old staff icon, System→old settings icon; Sections/Admin Hub entries unchanged). Update `quickActionByRole`: `school_admin` → `{ href: '/sis/school-year?view=calendar', label: 'School Calendar' }`, `superadmin` → `{ href: '/sis/school-year', label: 'Year setup' }`.
- [ ] **Step 4: Run** `npx vitest run __tests__/auth/sis-nav-route-consistency.test.ts` → PASS (every new NAV item reachable by its declared roles). Also run any sidebar-registry tests: `npx vitest run __tests__ -t sidebar` (best-effort).
- [ ] **Step 5: Commit** — `feat(sis): flat 6-item sidebar + consolidated route table (KD #155)`.

Note: the module builds but old pages still exist and are now nav-orphaned — fine mid-stack; stubs land in Tasks 4–8.

---

### Task 3: `SisCutBar` segmented cut control

**Files:**

- Create: `components/sis/sis-cut-bar.tsx`
- Test: `__tests__/ui/sis-cut-bar.test.tsx`

**Interfaces (Produces):** `SisCutBar({ items, active, ariaLabel })` with `items: Array<{ value: string; label: string; href: string; count?: string; lockLabel?: string }>`. Renders `null` when `items.length <= 1` (registrar's single-cut pages show no bar).

- [ ] **Step 1: Failing test** — `__tests__/ui/sis-cut-bar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SisCutBar } from '@/components/sis/sis-cut-bar';

const ITEMS = [
  {
    value: 'assignments',
    label: 'Teaching assignments',
    href: '/sis/people',
    count: '18',
  },
  {
    value: 'accounts',
    label: 'Accounts',
    href: '/sis/people?view=accounts',
    count: '21',
  },
  {
    value: 'approvers',
    label: 'Approvers',
    href: '/sis/people?view=approvers',
    lockLabel: 'superadmin',
  },
];

describe('SisCutBar', () => {
  it('renders one link per cut with counts and lock tags', () => {
    render(
      <SisCutBar items={ITEMS} active="assignments" ariaLabel="People views" />
    );
    expect(
      screen.getByRole('link', { name: /teaching assignments/i })
    ).toHaveAttribute('href', '/sis/people');
    expect(screen.getByRole('link', { name: /accounts/i })).toHaveAttribute(
      'href',
      '/sis/people?view=accounts'
    );
    expect(screen.getByText('superadmin')).toBeInTheDocument();
  });
  it('renders nothing for a single-cut viewer', () => {
    const { container } = render(
      <SisCutBar
        items={[ITEMS[0]]}
        active="assignments"
        ariaLabel="People views"
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run → FAIL** (component missing).
- [ ] **Step 3: Implement** `components/sis/sis-cut-bar.tsx` (mirror the shipped staff-page Tabs idiom — URL-driven `TabsTrigger asChild` per 09a §8):

```tsx
import Link from 'next/link';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type SisCutItem = {
  value: string;
  label: string;
  href: string;
  count?: string;
  lockLabel?: string;
};

export function SisCutBar({
  items,
  active,
  ariaLabel,
}: {
  items: SisCutItem[];
  active: string;
  ariaLabel: string;
}) {
  if (items.length <= 1) return null;
  return (
    <Tabs value={active} className="mt-4">
      <TabsList variant="segmented" aria-label={ariaLabel}>
        {items.map((item) => (
          <TabsTrigger key={item.value} value={item.value} asChild>
            <Link href={item.href}>
              {item.label}
              {item.count ? (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {item.count}
                </span>
              ) : null}
              {item.lockLabel ? (
                <span className="rounded border border-border px-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  {item.lockLabel}
                </span>
              ) : null}
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
```

(If `TabsList` has no `variant="segmented"` prop in `components/ui/tabs.tsx`, use exactly the classNames the staff page's segmented Tabs uses — copy, don't invent.)

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(sis): shared SisCutBar segmented view control`.

---

### Task 4: School Year surface (`/sis/school-year`) + ay-setup/calendar stubs

**Files:**

- Create: `app/(sis)/sis/school-year/page.tsx`, `app/(sis)/sis/school-year/year-view.tsx`, `app/(sis)/sis/school-year/calendar-view.tsx`
- Replace with stubs: `app/(sis)/sis/ay-setup/page.tsx`, `app/(sis)/sis/calendar/page.tsx`
- Modify: `components/sis/year-setup/ay-picker.tsx` (router.push `/sis/ay-setup?ay=` → `/sis/school-year?ay=`)
- Modify: `components/sis/ay-readiness-pill.tsx` (pathname guard + Link: `/sis/ay-setup` → `/sis/school-year`)

**Interfaces:** Consumes `resolveSchoolYearView`, `SisCutBar`, `legacySisTarget`. `year-view.tsx` exports `async function YearView({ ayParam }: { ayParam?: string })`; `calendar-view.tsx` exports `async function CalendarView({ audienceParam, sessionUserId }: { audienceParam?: string; sessionUserId: string })`.

- [ ] **Step 1: Extract views.** `year-view.tsx` = everything the current ay-setup page renders AFTER its guard + `SisPageHeader` (the `Tabs setup|manage` block with `YearSetupChecklist` + `AySetupDataTable`, and ALL its data loads: `listAcademicYears`, `listTermsByAy`, `getCopyForwardPreview('__NEW__')`, per-AY `checkAyEmpty` for superadmin, `getAyReadiness`, `resolveSelectedAyCode`) — moved verbatim, `ayParam` replacing `sp.ay`. It needs the role for `AyTableRow.role`: read `getSessionUser()` inside the view (RSCs may call it repeatedly; it's cached). `calendar-view.tsx` = everything the current calendar page renders after its guard/header (AY+terms fetch, `ensureTermSeeded` loop + autoseed audit, `getSchoolCalendarForAy`/`getCalendarEventsForAy`, `parseAudience`, empty states, `CalendarAdminClient` mount with `copyFromPriorAyProps: null`) — its empty-state `Link href="/sis/ay-setup"` becomes `/sis/school-year`.
- [ ] **Step 2: Compose the page** — `app/(sis)/sis/school-year/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { PageShell } from '@/components/ui/page-shell';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { SisCutBar, type SisCutItem } from '@/components/sis/sis-cut-bar';
import { resolveSchoolYearView } from '@/lib/sis/surface-views';
import { getSessionUser } from '@/lib/supabase/server';
import { CalendarView } from './calendar-view';
import { YearView } from './year-view';

export default async function SchoolYearPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; ay?: string; audience?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const role = sessionUser.role;
  if (role !== 'registrar' && role !== 'school_admin' && role !== 'superadmin')
    redirect('/');

  const sp = await searchParams;
  const view = resolveSchoolYearView(role, sp.view);

  const cuts: SisCutItem[] = [
    ...(role !== 'registrar'
      ? [{ value: 'year', label: 'Year', href: '/sis/school-year' }]
      : []),
    {
      value: 'calendar',
      label: 'Calendar',
      href: '/sis/school-year?view=calendar',
    },
  ];

  return (
    <PageShell className={view === 'calendar' ? 'max-w-[1400px]' : undefined}>
      <SisPageHeader
        group="School Year"
        title="School year."
        description={
          view === 'calendar'
            ? 'Mark school days, closures, and calendar events per term — the attendance grid follows this calendar.'
            : 'How ready the year is, its terms, and the years list — the calendar lives one tab over.'
        }
      />
      <SisCutBar items={cuts} active={view} ariaLabel="School Year views" />
      {view === 'year' ? (
        <YearView ayParam={sp.ay} />
      ) : (
        <CalendarView
          audienceParam={sp.audience}
          sessionUserId={sessionUser.id}
        />
      )}
    </PageShell>
  );
}
```

(Chips from the old headers — AY badge / readiness badge — move into each view's own top row so the page header stays cut-agnostic. `NewAyButton` stays inside `YearView`, top-right of the years block — it is that cut's action, and the calendar cut must not show it.)

- [ ] **Step 3: Stubs.** Replace both old pages' entire contents:

```tsx
// app/(sis)/sis/ay-setup/page.tsx
import { redirect } from 'next/navigation';
import { legacySisTarget } from '@/lib/sis/legacy-routes';

// AY Setup merged into /sis/school-year (KD #155). ROUTE_ACCESS keeps the
// old prefix gated so the redirect fires only for roles that could reach it.
export default async function LegacyAySetupPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  redirect(legacySisTarget('/sis/ay-setup', await searchParams));
}
```

```tsx
// app/(sis)/sis/calendar/page.tsx
import { redirect } from 'next/navigation';
import { legacySisTarget } from '@/lib/sis/legacy-routes';

// School Calendar merged into /sis/school-year?view=calendar (KD #155).
export default async function LegacyCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ audience?: string }>;
}) {
  redirect(legacySisTarget('/sis/calendar', await searchParams));
}
```

- [ ] **Step 4: Repoint the two client pushes** — `ay-picker.tsx` `router.push('/sis/school-year?ay=...')`; `ay-readiness-pill.tsx` pathname-hide guard `startsWith('/sis/school-year')` + its Link → `/sis/school-year`.
- [ ] **Step 5: Verify** — `npx vitest run __tests__/sis` (readiness/year-setup suites still green) and `npx next build` compiles. Manual: `/sis/school-year` (year default), `?view=calendar`, old URLs redirect.
- [ ] **Step 6: Commit** — `feat(sis): School Year surface — AY setup + calendar merged (KD #155)`.

---

### Task 5: Structure surface (`/sis/structure`) + levels/subjects/template stubs

**Files:**

- Create: `app/(sis)/sis/structure/page.tsx`, plus `levels-view.tsx`, `weights-view.tsx`, `defaults-view.tsx` in the same folder
- Replace with stubs: `app/(sis)/sis/admin/levels/page.tsx`, `app/(sis)/sis/admin/subjects/page.tsx`, `app/(sis)/sis/admin/template/page.tsx`
- Modify: `components/sis/levels-manager-client.tsx` (push → `/sis/structure?view=levels&ay=...`), `components/sis/subject-ay-switcher.tsx` (push → `/sis/structure?view=weights&ay=...`), `components/sis/ay-setup-wizard.tsx` (3 pushes → `/sis/structure?view=defaults`)

**Interfaces:** Consumes `resolveStructureView`, `SisCutBar`, `legacySisTarget`. Views: `LevelsView({ ayParam })`, `WeightsView({ ayParam })`, `DefaultsView()` — each is the old page body + data loads moved verbatim.

- [ ] **Step 1: Extract the three views** from the old pages (guards/headers stripped; each keeps its own empty states and its `?ay=` resolution). Old inline headers' chips (AY badge + `SubjectAySwitcher`, `Badge Template`) move into each view's top row.
- [ ] **Step 2: Compose the page** with the summary line + seasonal chip:

```tsx
import { redirect } from 'next/navigation';
import { Clock } from 'lucide-react';
import { PageShell } from '@/components/ui/page-shell';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { SisCutBar, type SisCutItem } from '@/components/sis/sis-cut-bar';
import { resolveStructureView } from '@/lib/sis/surface-views';
import { getSessionUser } from '@/lib/supabase/server';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { getAyReadiness } from '@/lib/sis/readiness';
import { DefaultsView } from './defaults-view';
import { LevelsView } from './levels-view';
import { WeightsView } from './weights-view';

export default async function StructurePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; ay?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const role = sessionUser.role;
  if (role !== 'school_admin' && role !== 'superadmin') redirect('/sis');

  const sp = await searchParams;
  const view = resolveStructureView(sp.view);

  const currentAy = await getCurrentAcademicYear();
  const readiness = currentAy ? await getAyReadiness(currentAy.ay_code) : null;
  const yearUnderway =
    readiness !== null && readiness.complete >= readiness.total;

  const cuts: SisCutItem[] = [
    {
      value: 'levels',
      label: 'Grade levels',
      href: '/sis/structure?view=levels',
    },
    {
      value: 'weights',
      label: 'Subject weights',
      href: '/sis/structure?view=weights',
    },
    {
      value: 'defaults',
      label: 'Year defaults',
      href: '/sis/structure?view=defaults',
    },
  ];

  return (
    <PageShell>
      <SisPageHeader
        group="Structure"
        title="How the school is built."
        description="The levels you teach, how grades are weighted per subject, and the defaults every new year starts from."
      />
      <SisCutBar items={cuts} active={view} ariaLabel="Structure views" />
      {yearUnderway && currentAy ? (
        <p className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-soft px-3 py-1.5 text-[13px] text-structure-inyear">
          {/* Use the existing amber status recipe from §9.3 — border-amber tokens, icon + text */}
          <Clock className="size-3.5" aria-hidden />
          {currentAy.label} is underway — structure changes now are unusual.
          New-year changes belong in Year defaults.
        </p>
      ) : null}
      {view === 'levels' ? (
        <LevelsView ayParam={sp.ay} />
      ) : view === 'weights' ? (
        <WeightsView ayParam={sp.ay} />
      ) : (
        <DefaultsView />
      )}
    </PageShell>
  );
}
```

**Amber chip:** implement with the existing §9.3 amber recipe (`border-*/bg-*/text-*` semantic amber tokens already used across the app — copy the exact classes from an existing amber status chip, e.g. the staleness badge or an existing warning chip; do NOT invent `bg-amber-soft`/`text-structure-inyear` utility names — the snippet above marks intent, not literal classes).

**Summary line (mockup's count header):** skip a dedicated always-on stat strip if it would force loading all three cuts' data — instead each view keeps its own counts. (Decision: honest per-cut counts beat a header that triples every request. Note this deviation from the mockup in the PR/commit body.)

- [ ] **Step 3: Stubs** for the three old pages (same shape as Task 4's, paths `/sis/admin/levels|subjects|template`, forwarding `ay` where the map supports it).
- [ ] **Step 4: Repoint client pushes** (levels-manager-client, subject-ay-switcher, ay-setup-wizard×3).
- [ ] **Step 5: Verify** — `npx vitest run __tests__/sis` + build; manual: three cuts render, `?ay=` switching works on levels/weights, in-year chip appears when readiness complete.
- [ ] **Step 6: Commit** — `feat(sis): Structure surface — levels + weights + year defaults merged (KD #155)`.

---

### Task 6: People & Access surface (`/sis/people`) + staff/users/approvers stubs

**Files:**

- Create: `app/(sis)/sis/people/page.tsx` (+ `approvers-view.tsx` in folder if extraction reads cleaner)
- Replace with stubs: `app/(sis)/sis/admin/staff/page.tsx`, `app/(sis)/sis/admin/users/page.tsx` (retarget existing stub), `app/(sis)/sis/admin/approvers/page.tsx`
- Modify: `components/sis/staff-accounts-client.tsx` (post-create `router.push('/sis/admin/staff')` → `/sis/people`)

**Interfaces:** Consumes `resolvePeopleView`, `SisCutBar`. The staff page is ALREADY the two-cut merged page — this task relocates it and adds the third cut.

- [ ] **Step 1: Move the staff page's body** to `/sis/people/page.tsx`, swapping its inline two-tab Tabs for `SisCutBar` and its `view` resolution for `resolvePeopleView`. Cut items (build per-role): assignments (count `String(teachingCount)`), accounts for non-registrar (count `String(staffCount)`), approvers for superadmin only (`lockLabel: 'superadmin'`). Keep the conditional loads exactly (assignments data only on assignments view; `listStaffUsers` only on accounts view) and add: approvers view loads `listAllApproverAssignments()` + per-flow `listEligibleApproverCandidates` (from `@/lib/sis/approvers/queries`, flows from `APPROVER_FLOWS`) ONLY when `view === 'approvers'`, mounting `ApproversDataTable` + the "How this works" section from the old approvers page.
- [ ] **Step 2: Header** — `group="People & Access"`, `title="People."`, `description="Everyone who works in the school — what they teach, their accounts, and who approves grade changes."`, chips = the `{staffCount} people · {teachingCount} teaching` badge.
- [ ] **Step 3: Stubs** — staff (forwards `view=accounts`), users (`redirect(legacySisTarget('/sis/admin/users'))`), approvers.
- [ ] **Step 4: Verify** — `npx vitest run __tests__/sis __tests__/auth`; build; manual per role (registrar sees no cut bar beyond assignments; school_admin no approvers cut; superadmin all three).
- [ ] **Step 5: Commit** — `feat(sis): People & Access surface — staff + accounts + approvers merged (KD #155)`.

---

### Task 7: System surface (`/sis/system`) + config/settings/audit-log stubs

**Files:**

- Create: `app/(sis)/sis/system/page.tsx` + `config-view.tsx`, `settings-view.tsx`, `audit-view.tsx`
- Replace with stubs: `app/(sis)/sis/admin/school-config/page.tsx`, `app/(sis)/sis/admin/settings/page.tsx`, `app/(sis)/sis/audit-log/page.tsx`
- Modify: `components/sis/ay-banner.tsx` (Link → `/sis/system?view=settings`), `components/admin/publish-window-panel.tsx` + `components/admin/bulk-publish-concerns.ts` (school-config deep-links → `/sis/system`), `components/sis/system-health-strip.tsx` (approvers link → `/sis/people?view=approvers`; ay-setup link → `/sis/school-year`)

**Interfaces:** Consumes `resolveSystemView`, `SisCutBar`. `audit-view.tsx` exports `AuditView({ mode, params }: { mode: 'overview' | 'log'; params: SisAuditLogSearchParams })` — the old audit-log page's entire two-mode body with its internal toggle links rewritten to `/sis/system?view=audit&mode=overview` / `/sis/system?view=audit`, and its `SIS_AUDIT_ALLOWLIST` const moved along. Log-view pagination keeps reading `page`/`pageSize` searchParams (now on `/sis/system`; `AuditLogDataTable` uses url-state namespace `al`, no collision with `view`/`mode`).

- [ ] **Step 1: Extract views.** `config-view.tsx` = school-config body (`getSchoolConfig` + `SchoolConfigForm` card). `settings-view.tsx` = settings body (`getCurrentEnvironment` + `listEnvironmentAys` + `SisUrlMissingBanner` + `EnvironmentCard`) — rendered ONLY for superadmin (resolver enforces; the view itself asserts role again defensively). `audit-view.tsx` per interface above. Cut labels per spec: "School details" / "Settings" (lock tag) / "Activity history".
- [ ] **Step 2: Compose page** (same skeleton as Task 5; `mode` param read `sp.mode === 'overview' ? 'overview' : 'log'`; guard `school_admin|superadmin` else redirect `/`).
- [ ] **Step 3: Stubs** (school-config, settings, audit-log — audit-log forwards `view`→`mode`, `page`, `pageSize` via `legacySisTarget`).
- [ ] **Step 4: Repoint the four link sites** listed under Files.
- [ ] **Step 5: Verify** — `npx vitest run __tests__/sis`; build; manual: config default, settings superadmin-only, audit log + overview modes, CSV export still superadmin-gated.
- [ ] **Step 6: Commit** — `feat(sis): System surface — school details + settings + activity history merged (KD #155)`.

---

### Task 8: Discount Codes → Admissions

**Files:**

- Create: `app/(admissions)/admissions/discount-codes/page.tsx`
- Replace with stub: `app/(sis)/sis/admin/discount-codes/page.tsx`
- Modify: `lib/auth/roles.ts` (ADMISSIONS_NAV Pipeline item href `/sis/admin/discount-codes` → `/admissions/discount-codes`; Quicklinks `/sis/ay-setup` → `/sis/school-year`; remove `admissions` from the legacy `/sis/admin/discount-codes` row? NO — keep it so admissions bookmarks reach the stub)
- Modify: `lib/sidebar/registry.ts` (admissions iconByHref: replace `/sis/admin/discount-codes` key with `/admissions/discount-codes`, update `/sis/ay-setup` → `/sis/school-year`)
- Modify: `app/(records)/records/discount-codes/page.tsx` (stub target → `/admissions/discount-codes${qs}`), `app/(records)/records/page.tsx` (L439 href → `/admissions/discount-codes?ay=...`)
- Modify: `app/(sis)/layout.tsx` — keep `admissions` admitted (stub must render); add comment that it exists only for the legacy redirect.

**Interfaces:** The new page copies the old SIS page's loads/mounts verbatim (`getCurrentAcademicYear`, `listAyCodes`, `listDiscountCodes`, `HubStat` ×4, `DiscountCodesDataTable` with `toolbarTrailing: <NewDiscountCodeButton …>`, `AySwitcher`) but uses the **admissions page idiom**: guard `['admissions','registrar','school_admin','superadmin']` else `redirect('/')`, inline `<header>` (mono eyebrow `Admissions · Discount codes`, serif h1 "Promotion codes.", muted description — copy the old page's description), `PageShell`. No `SisPageHeader` (that's a SIS component with a back-to-hub link admissions users can't follow).

- [ ] **Step 1: Create the page** per interface (copy old body; adapt header idiom; same `?ay=` behavior).
- [ ] **Step 2: Stub** the old SIS page → `redirect(legacySisTarget('/sis/admin/discount-codes', sp))`.
- [ ] **Step 3: Nav + registry + records links** per Files list.
- [ ] **Step 4: Verify** — `npx vitest run __tests__/auth`; build; manual as `admissions` role: sidebar shows Discount Codes inside Admissions, page works, old URL redirects, `/sis` still inaccessible to them elsewhere.
- [ ] **Step 5: Commit** — `feat(admissions): Discount Codes relocated from SIS Admin (KD #155, extends KD #133)`.

---

### Task 9: Hub + readiness engine + palette + remaining link sweep

**Files:**

- Modify: `lib/sis/readiness.ts` (STEP default hrefs), `components/sis/hub-year-band.tsx`, `components/sis/hub-quick-actions.tsx`, `components/sis/hub-upcoming-events-card.tsx`, `lib/sis/hub-attention.ts` (+ its test `__tests__/sis/hub-attention.test.ts`), `components/sis/command-palette.tsx`, `components/ui/no-current-ay-card.tsx`, `components/attendance/wide-grid.tsx`, `lib/auth/roles.ts` (ATTENDANCE_NAV `/sis/calendar` item → `/sis/school-year?view=calendar`), `lib/sidebar/registry.ts` (attendance iconByHref key swap)

- [ ] **Step 1: Readiness STEP hrefs** (`lib/sis/readiness.ts`): `ay-setup`→`/sis/school-year` · `calendar`→`/sis/school-year?view=calendar` · `classes`→`/sis/structure?view=defaults` · `advisers`→`/sis/sections` (unchanged) · `grading-sheets`→`/markbook/sections` (unchanged) · `virtue-themes`→`/evaluation/virtue-themes` (unchanged) · `letterhead`→`/sis/system` · `app-window`→`/sis/school-year`. The `YearSetupChecklist` buttons read `step.href`, so its deep-links update automatically.
- [ ] **Step 2: Hub year band** — both `/sis/ay-setup` hrefs → `/sis/school-year`; add the quiet in-year state: when `allDone`, render a single-line muted row (mint check icon + "「AY label」 is set up and underway" + a ghost "School Year →" link) instead of the loud band — mint per §9.3, no primary CTA (frees the hub's one primary button during the year).
- [ ] **Step 3: Quick actions** — `/sis/calendar`→`/sis/school-year?view=calendar`, `/sis/admin/staff?view=accounts`→`/sis/people?view=accounts`, `/sis/admin/levels`→`/sis/structure?view=levels` (sublabels: "School Year", "People", "Structure").
- [ ] **Step 4: Attention feed** — `lib/sis/hub-attention.ts` level-demand href → `/sis/structure?view=levels`; update `__tests__/sis/hub-attention.test.ts` expectation; run it (fails before edit, passes after).
- [ ] **Step 5: Command palette** — update all 12 entries to the new surfaces (keep recognizable labels, e.g. "Academic Year Setup" → href `/sis/school-year`; "Staff accounts" → `/sis/people?view=accounts`; "System Settings (Test environment)" → `/sis/system?view=settings`; "Audit log" → `/sis/system?view=audit`; "Discount Codes" → `/admissions/discount-codes`).
- [ ] **Step 6: Stragglers** — `no-current-ay-card` → `/sis/school-year`; attendance `wide-grid` "Open School Calendar" → `/sis/school-year?view=calendar`; `hub-upcoming-events-card` → `/sis/school-year?view=calendar`; ATTENDANCE_NAV + attendance registry icon key.
- [ ] **Step 7: Sweep gate** — run:
      `rg "'/sis/(ay-setup|calendar|admin/(levels|subjects|template|staff|users|approvers|school-config|settings|discount-codes))|/sis/audit-log" app components lib __tests__`
      Remaining hits must ONLY be: the redirect stubs, `lib/sis/legacy-routes.ts`, ROUTE_ACCESS legacy rows, and `/api/sis/...` endpoint strings (APIs unchanged). Anything else gets repointed.
- [ ] **Step 8: Full verify** — `npx vitest run` (all green) + `npx next build`.
- [ ] **Step 9: Commit** — `feat(sis): seasonal engine + hub/palette/cross-module links onto the 6 surfaces (KD #155)`.

---

### Task 10: One section detail — Markbook deep-link

**Files:**

- Modify: `components/sections/section-row-actions.tsx`
- Test: extend an existing row-actions/sections-table test if present (`rg "section-row-actions" __tests__`), else render-test the menu item gating in `__tests__/ui/section-row-actions.test.tsx`

- [ ] **Step 1:** In the shared `⋯` menu, when `module === 'markbook'` and the viewer is registrar/school_admin/superadmin (the same `canManage` gate the Generate items already use), add a `DropdownMenuItem asChild` → `<Link href={`/sis/sections/${sectionId}`}>Section settings</Link>` beneath the Generate items. Teachers don't see it (they can't open `/sis/sections/[id]`).
- [ ] **Step 2:** Test the gating (renders for registrar, absent for teacher); run; commit — `feat(markbook): section settings deep-link to the canonical SIS section detail (KD #155)`.

---

### Task 11: Full verification + docs

- [ ] **Step 1:** `npx vitest run` — full suite green (baseline 1095 + new tests). `npx next build` — clean.
- [ ] **Step 2: Browser pass matrix** (manual, dev server): superadmin → all 6 surfaces + settings/approvers cuts + quiet/loud year band; school_admin → no Settings/Approvers cuts, Accounts read-only; registrar → sidebar shows School Year/Sections/People only, lands on calendar/assignments, no dead-ends from Records "Section setup" or Attendance "School Calendar"; admissions → Discount Codes inside Admissions, `/sis/admin/discount-codes` redirects, no other `/sis` access. Every legacy URL redirects with params.
- [ ] **Step 3: Docs** — add **KD #155** to `.claude/rules/key-decisions/records.md` (+ index/table rows in `key-decisions.md`); update notes on KD #154 (IA superseded by consolidation), #133 (discount codes relocated to `/admissions/discount-codes`), #109 (checklist home → `/sis/school-year`); update `.claude/rules/project-layout.md` `(sis)` + `(admissions)` lines; then run the `/sync-docs` skill for CLAUDE.md session context + dev-plan snapshot.
- [ ] **Step 4: Commit** — `docs: KD #155 SIS Admin consolidation (13 → 6)`.

---

## Self-review notes

- **Spec coverage:** six surfaces (T4–T7 + Sections untouched + hub T9), cuts + role gating (T1 resolvers, per-page), redirects (T1 map + per-task stubs), moves (T8 discount codes, T10 section detail), seasonal engine (T5 chip, T9 band/steps), nav flatten (T2), link repoint (per-task + T9 sweep), tests (T1/T3/T9/T10 + nav test), docs (T11). Deviation recorded: Structure's always-on 4-count summary strip dropped in favor of per-cut counts (T5 Step 2 rationale).
- **Type consistency:** view unions defined once in T1 and consumed by T4–T7; `SisCutItem` defined in T3 and consumed by T4–T7; `legacySisTarget` signature uniform across all stubs.
- **Placeholder scan:** the two "copy the old page body" extractions (T4 Step 1, T5 Step 1, T7 Step 1) intentionally reference the source files being moved rather than duplicating hundreds of lines — the mover has the source in-repo; all NEW code is written out.
