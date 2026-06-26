# Year Setup Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/sis/ay-setup` into a single guided, non-linear stepper that ties the existing year-setup tools together, and expand the readiness engine from 4 to 8 steps (refactored into 100%-tested pure resolvers).

**Architecture:** A new client `YearSetupStepper` replaces the `YearSetupControlCenter` body; it composes existing inline editors (`TermDatesEditor`, `VirtueThemesEditor`, `AyAcceptingApplicationsToggle`, `GenerateSheetsDialog`) and one-click action buttons over existing routes/RPCs. The readiness engine (`lib/sis/readiness.ts`) splits into pure `resolve*Step` functions + `buildReadiness` (unit-tested) and thin DB fetchers. The `/sis` hub's duplicate 4-card grid collapses to one readiness card. Four mutation routes gain `revalidateTag('sis:${ay}')` so the ring refreshes after inline edits, and one thin AY-wide calendar-seed route is added.

**Tech Stack:** Next.js 16 (App Router, RSC), TypeScript, TanStack Query v5 (`apiFetch`/`useMutation`), shadcn/Tailwind v4, Vitest (jsdom).

## Global Constraints

- **Design system is binding (Hard Rule #7).** Tokens only from `app/globals.css` — no raw hex/`oklch`/`slate|zinc|gray`/`bg-white`. Use semantic (`bg-primary`, `text-foreground`, `border-border`, `bg-muted`, `text-muted-foreground`) or Aurora Vault (`brand-indigo`, `brand-navy`, `brand-mint`, `brand-amber`, `brand-sky`, `brand-indigo-soft`, `brand-indigo-deep`, `accent`, `ink`, `hairline`). Status badges use the §9.3 recipes. Icon tiles = `bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile`. Headlines = `font-serif`. Eyebrows = `font-mono text-[10px]/[11px] uppercase tracking-[0.14em]`. Exactly one `default` `Button` per view.
- **Client→API calls go through `lib/query/fetcher.ts::apiFetch` + `jsonInit`.** Reads = `useQuery`, writes = `useMutation` (mutations `retry: 0`). Model A: `onSuccess` calls `router.refresh()`. Feedback via `toast` imported from `'sonner'`. `onError` surfaces `ApiError.message` (route's `error` body), never a generic string.
- **Cache invalidation convention:** `revalidateTag(\`sis:${ayCode}\`, 'max')`— match the repo's existing two-arg`'max'` call sites.
- **Dates:** no new date libraries (no dayjs/date-fns/moment).
- **Tests:** Vitest pure-logic suites live under `__tests__/`, `.test.ts`, mirroring `__tests__/sis/enrolment-position.test.ts`.
- **Roles:** the `/sis/ay-setup` page gate stays `school_admin` + `superadmin` (unchanged).
- **Verify each task with `npx next build` (clean compile) before marking done.**

---

### Task 1: Readiness engine — pure resolvers + `buildReadiness` + 8 steps + 100% tests

**Files:**

- Modify: `lib/sis/readiness.ts` (full restructure)
- Test: `__tests__/sis/readiness.test.ts` (create)
- Modify (keep compiling): `components/sis/year-setup/year-setup-control-center.tsx` (make `STEP_ICONS` non-exhaustive — superseded in Task 4)

**Interfaces:**

- Produces (consumed by Tasks 4 & 5):
  - `type ReadinessStepId = 'ay-setup' | 'calendar' | 'classes' | 'advisers' | 'grading-sheets' | 'virtue-themes' | 'letterhead' | 'app-window'`
  - `type ReadinessStatus = 'done' | 'partial' | 'not_started'`
  - `type ReadinessStep = { id: ReadinessStepId; step: number; label: string; description: string; href: string; status: ReadinessStatus; required: boolean; fraction?: { done: number; total: number } }`
  - `type AyReadiness = { ayCode: string; steps: ReadinessStep[]; complete: number; total: number }`
  - `resolve*Step(input)` pure functions, `buildReadiness(ayCode, steps)`, `nextIncompleteStepId(steps)`
  - `getAyReadiness(ayCode)` (signature unchanged; now returns 8 steps)

- [ ] **Step 1: Write the failing test suite**

Create `__tests__/sis/readiness.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  resolveAySetupStep,
  resolveCalendarStep,
  resolveClassesStep,
  resolveAdvisersStep,
  resolveGradingSheetsStep,
  resolveVirtueThemesStep,
  resolveLetterheadStep,
  resolveAppWindowStep,
  buildReadiness,
  nextIncompleteStepId,
} from '@/lib/sis/readiness';

describe('resolveAySetupStep', () => {
  it('not_started with no dated terms', () => {
    expect(resolveAySetupStep({ datedTermCount: 0 }).status).toBe(
      'not_started'
    );
  });
  it('done with at least one dated term', () => {
    const s = resolveAySetupStep({ datedTermCount: 4 });
    expect(s.status).toBe('done');
    expect(s.required).toBe(true);
    expect(s.id).toBe('ay-setup');
  });
});

describe('resolveCalendarStep', () => {
  it('not_started when no terms exist', () => {
    expect(resolveCalendarStep({ totalTerms: 0, coveredTerms: 0 }).status).toBe(
      'not_started'
    );
  });
  it('not_started when terms exist but none covered', () => {
    expect(resolveCalendarStep({ totalTerms: 4, coveredTerms: 0 }).status).toBe(
      'not_started'
    );
  });
  it('partial when some terms covered', () => {
    const s = resolveCalendarStep({ totalTerms: 4, coveredTerms: 2 });
    expect(s.status).toBe('partial');
    expect(s.fraction).toEqual({ done: 2, total: 4 });
  });
  it('done when all terms covered', () => {
    expect(resolveCalendarStep({ totalTerms: 4, coveredTerms: 4 }).status).toBe(
      'done'
    );
  });
});

describe('resolveClassesStep', () => {
  it('not_started when no sections', () => {
    expect(
      resolveClassesStep({ sectionCount: 0, subjectConfigCount: 10 }).status
    ).toBe('not_started');
  });
  it('not_started when sections but no subject configs', () => {
    expect(
      resolveClassesStep({ sectionCount: 18, subjectConfigCount: 0 }).status
    ).toBe('not_started');
  });
  it('done when both present', () => {
    expect(
      resolveClassesStep({ sectionCount: 18, subjectConfigCount: 82 }).status
    ).toBe('done');
  });
});

describe('resolveAdvisersStep', () => {
  it('not_started when no sections', () => {
    expect(
      resolveAdvisersStep({ sectionCount: 0, advisedSectionCount: 0 }).status
    ).toBe('not_started');
  });
  it('not_started when sections exist but none advised', () => {
    expect(
      resolveAdvisersStep({ sectionCount: 18, advisedSectionCount: 0 }).status
    ).toBe('not_started');
  });
  it('partial when some advised', () => {
    const s = resolveAdvisersStep({
      sectionCount: 18,
      advisedSectionCount: 12,
    });
    expect(s.status).toBe('partial');
    expect(s.fraction).toEqual({ done: 12, total: 18 });
  });
  it('done when all advised', () => {
    expect(
      resolveAdvisersStep({ sectionCount: 18, advisedSectionCount: 18 }).status
    ).toBe('done');
  });
});

describe('resolveGradingSheetsStep', () => {
  it('not_started with zero sections (fraction 0/0)', () => {
    const s = resolveGradingSheetsStep({
      totalSections: 0,
      sectionsWithSheets: 0,
    });
    expect(s.status).toBe('not_started');
    expect(s.fraction).toEqual({ done: 0, total: 0 });
  });
  it('not_started when no sheets yet', () => {
    expect(
      resolveGradingSheetsStep({ totalSections: 18, sectionsWithSheets: 0 })
        .status
    ).toBe('not_started');
  });
  it('partial when some sheets', () => {
    expect(
      resolveGradingSheetsStep({ totalSections: 18, sectionsWithSheets: 5 })
        .status
    ).toBe('partial');
  });
  it('done when all sections covered', () => {
    expect(
      resolveGradingSheetsStep({ totalSections: 18, sectionsWithSheets: 18 })
        .status
    ).toBe('done');
  });
});

describe('resolveVirtueThemesStep', () => {
  it('not_started when no terms require a theme', () => {
    expect(
      resolveVirtueThemesStep({ termsRequiringTheme: 0, termsWithTheme: 0 })
        .status
    ).toBe('not_started');
  });
  it('not_started when none set', () => {
    expect(
      resolveVirtueThemesStep({ termsRequiringTheme: 3, termsWithTheme: 0 })
        .status
    ).toBe('not_started');
  });
  it('partial when some set', () => {
    const s = resolveVirtueThemesStep({
      termsRequiringTheme: 3,
      termsWithTheme: 1,
    });
    expect(s.status).toBe('partial');
    expect(s.fraction).toEqual({ done: 1, total: 3 });
  });
  it('done when all set', () => {
    expect(
      resolveVirtueThemesStep({ termsRequiringTheme: 3, termsWithTheme: 3 })
        .status
    ).toBe('done');
  });
});

describe('resolveLetterheadStep', () => {
  it('not_started when neither field set', () => {
    expect(
      resolveLetterheadStep({ hasOrgName: false, hasAddress: false }).status
    ).toBe('not_started');
  });
  it('partial when only one field set', () => {
    expect(
      resolveLetterheadStep({ hasOrgName: true, hasAddress: false }).status
    ).toBe('partial');
  });
  it('done when both set', () => {
    expect(
      resolveLetterheadStep({ hasOrgName: true, hasAddress: true }).status
    ).toBe('done');
  });
});

describe('resolveAppWindowStep', () => {
  it('is always optional (required: false), done when accepting', () => {
    const s = resolveAppWindowStep({ accepting: true });
    expect(s.required).toBe(false);
    expect(s.status).toBe('done');
  });
  it('not_started when closed, still optional', () => {
    const s = resolveAppWindowStep({ accepting: false });
    expect(s.required).toBe(false);
    expect(s.status).toBe('not_started');
  });
});

describe('buildReadiness', () => {
  it('counts only required steps; optional app-window excluded from total', () => {
    const steps = [
      resolveAySetupStep({ datedTermCount: 4 }), // done
      resolveCalendarStep({ totalTerms: 4, coveredTerms: 4 }), // done
      resolveClassesStep({ sectionCount: 18, subjectConfigCount: 82 }), // done
      resolveAdvisersStep({ sectionCount: 18, advisedSectionCount: 12 }), // partial
      resolveGradingSheetsStep({ totalSections: 18, sectionsWithSheets: 0 }), // not_started
      resolveVirtueThemesStep({ termsRequiringTheme: 3, termsWithTheme: 3 }), // done
      resolveLetterheadStep({ hasOrgName: true, hasAddress: true }), // done
      resolveAppWindowStep({ accepting: true }), // optional done
    ];
    const r = buildReadiness('AY2027', steps);
    expect(r.total).toBe(7); // 7 required, app-window excluded
    expect(r.complete).toBe(5); // 5 required done
    expect(r.steps).toHaveLength(8);
    expect(r.ayCode).toBe('AY2027');
  });
  it('all-not-started → 0/7', () => {
    const steps = [
      resolveAySetupStep({ datedTermCount: 0 }),
      resolveCalendarStep({ totalTerms: 0, coveredTerms: 0 }),
      resolveClassesStep({ sectionCount: 0, subjectConfigCount: 0 }),
      resolveAdvisersStep({ sectionCount: 0, advisedSectionCount: 0 }),
      resolveGradingSheetsStep({ totalSections: 0, sectionsWithSheets: 0 }),
      resolveVirtueThemesStep({ termsRequiringTheme: 0, termsWithTheme: 0 }),
      resolveLetterheadStep({ hasOrgName: false, hasAddress: false }),
      resolveAppWindowStep({ accepting: false }),
    ];
    const r = buildReadiness('AY2027', steps);
    expect(r.complete).toBe(0);
    expect(r.total).toBe(7);
  });
});

describe('nextIncompleteStepId', () => {
  it('returns the first required step that is not done', () => {
    const steps = [
      resolveAySetupStep({ datedTermCount: 4 }), // done
      resolveCalendarStep({ totalTerms: 4, coveredTerms: 1 }), // partial
    ];
    expect(nextIncompleteStepId(steps)).toBe('calendar');
  });
  it('returns the first step id when everything required is done', () => {
    const steps = [
      resolveAySetupStep({ datedTermCount: 4 }),
      resolveAppWindowStep({ accepting: false }), // optional, ignored
    ];
    expect(nextIncompleteStepId(steps)).toBe('ay-setup');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/sis/readiness.test.ts`
Expected: FAIL — `resolveAySetupStep` (and siblings) are not exported from `@/lib/sis/readiness`.

- [ ] **Step 3: Rewrite `lib/sis/readiness.ts` with resolvers + fetchers**

Replace the entire file contents with:

```ts
// lib/sis/readiness.ts
import { unstable_cache } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/service';

export type ReadinessStepId =
  | 'ay-setup'
  | 'calendar'
  | 'classes'
  | 'advisers'
  | 'grading-sheets'
  | 'virtue-themes'
  | 'letterhead'
  | 'app-window';

export type ReadinessStatus = 'done' | 'partial' | 'not_started';

export type ReadinessStep = {
  id: ReadinessStepId;
  step: number;
  label: string;
  description: string;
  href: string;
  status: ReadinessStatus;
  required: boolean;
  fraction?: { done: number; total: number };
};

export type AyReadiness = {
  ayCode: string;
  steps: ReadinessStep[];
  complete: number; // required steps with status 'done'
  total: number; // count of required steps
};

// Static per-step metadata. Resolvers below add status/description/fraction.
const STEP_META: Record<
  ReadinessStepId,
  { step: number; label: string; href: string; required: boolean }
> = {
  'ay-setup': {
    step: 1,
    label: 'Academic year & term dates',
    href: '/sis/ay-setup',
    required: true,
  },
  calendar: {
    step: 2,
    label: 'School calendar',
    href: '/sis/calendar',
    required: true,
  },
  classes: {
    step: 3,
    label: 'Classes & subjects',
    href: '/sis/admin/template',
    required: true,
  },
  advisers: {
    step: 4,
    label: 'Form advisers',
    href: '/sis/sections',
    required: true,
  },
  'grading-sheets': {
    step: 5,
    label: 'Grading sheets',
    href: '/markbook/sections',
    required: true,
  },
  'virtue-themes': {
    step: 6,
    label: 'Virtue themes',
    href: '/evaluation/virtue-themes',
    required: true,
  },
  letterhead: {
    step: 7,
    label: 'Report-card letterhead',
    href: '/sis/admin/school-config',
    required: true,
  },
  'app-window': {
    step: 8,
    label: 'Application window',
    href: '/sis/ay-setup',
    required: false,
  },
};

function base(
  id: ReadinessStepId
): Omit<ReadinessStep, 'status' | 'description'> {
  const m = STEP_META[id];
  return {
    id,
    step: m.step,
    label: m.label,
    href: m.href,
    required: m.required,
  };
}

// ---- Pure resolvers (no DB, no I/O) ----

export function resolveAySetupStep(i: {
  datedTermCount: number;
}): ReadinessStep {
  const done = i.datedTermCount > 0;
  return {
    ...base('ay-setup'),
    status: done ? 'done' : 'not_started',
    description: done
      ? 'Academic year active with dated terms'
      : 'Create the academic year and define term dates',
  };
}

export function resolveCalendarStep(i: {
  totalTerms: number;
  coveredTerms: number;
}): ReadinessStep {
  if (i.totalTerms === 0) {
    return {
      ...base('calendar'),
      status: 'not_started',
      description: 'Define term dates first',
    };
  }
  const done = i.coveredTerms === i.totalTerms;
  return {
    ...base('calendar'),
    status: done ? 'done' : i.coveredTerms > 0 ? 'partial' : 'not_started',
    description: done
      ? 'All terms have school days'
      : `${i.coveredTerms} of ${i.totalTerms} terms have school days`,
    fraction: { done: i.coveredTerms, total: i.totalTerms },
  };
}

export function resolveClassesStep(i: {
  sectionCount: number;
  subjectConfigCount: number;
}): ReadinessStep {
  const done = i.sectionCount > 0 && i.subjectConfigCount > 0;
  return {
    ...base('classes'),
    status: done ? 'done' : 'not_started',
    description: done
      ? `${i.sectionCount} classes with subject weights`
      : 'Apply the class template to create classes and subjects',
  };
}

export function resolveAdvisersStep(i: {
  sectionCount: number;
  advisedSectionCount: number;
}): ReadinessStep {
  if (i.sectionCount === 0) {
    return {
      ...base('advisers'),
      status: 'not_started',
      description: 'Create classes first',
    };
  }
  const done = i.advisedSectionCount === i.sectionCount;
  return {
    ...base('advisers'),
    status: done
      ? 'done'
      : i.advisedSectionCount > 0
        ? 'partial'
        : 'not_started',
    description: done
      ? `All ${i.sectionCount} classes have a form adviser`
      : `${i.advisedSectionCount} of ${i.sectionCount} classes have a form adviser`,
    fraction: { done: i.advisedSectionCount, total: i.sectionCount },
  };
}

export function resolveGradingSheetsStep(i: {
  totalSections: number;
  sectionsWithSheets: number;
}): ReadinessStep {
  if (i.totalSections === 0) {
    return {
      ...base('grading-sheets'),
      status: 'not_started',
      description: 'Create classes first',
      fraction: { done: 0, total: 0 },
    };
  }
  const done = i.sectionsWithSheets === i.totalSections;
  return {
    ...base('grading-sheets'),
    status: done
      ? 'done'
      : i.sectionsWithSheets > 0
        ? 'partial'
        : 'not_started',
    description: done
      ? 'Grading sheets created for all classes'
      : `${i.sectionsWithSheets} of ${i.totalSections} classes have grading sheets`,
    fraction: { done: i.sectionsWithSheets, total: i.totalSections },
  };
}

export function resolveVirtueThemesStep(i: {
  termsRequiringTheme: number;
  termsWithTheme: number;
}): ReadinessStep {
  if (i.termsRequiringTheme === 0) {
    return {
      ...base('virtue-themes'),
      status: 'not_started',
      description: 'Define term dates first',
    };
  }
  const done = i.termsWithTheme >= i.termsRequiringTheme;
  return {
    ...base('virtue-themes'),
    status: done ? 'done' : i.termsWithTheme > 0 ? 'partial' : 'not_started',
    description: done
      ? 'Virtue themes set for Terms 1–3'
      : `${i.termsWithTheme} of ${i.termsRequiringTheme} terms have a virtue theme`,
    fraction: { done: i.termsWithTheme, total: i.termsRequiringTheme },
  };
}

export function resolveLetterheadStep(i: {
  hasOrgName: boolean;
  hasAddress: boolean;
}): ReadinessStep {
  const done = i.hasOrgName && i.hasAddress;
  return {
    ...base('letterhead'),
    status: done
      ? 'done'
      : i.hasOrgName || i.hasAddress
        ? 'partial'
        : 'not_started',
    description: done
      ? 'Organization name and address set'
      : 'Add the organization name and address for report cards',
  };
}

export function resolveAppWindowStep(i: { accepting: boolean }): ReadinessStep {
  // Optional — never counts toward readiness. Status reflects the decision only.
  return {
    ...base('app-window'),
    status: i.accepting ? 'done' : 'not_started',
    description: i.accepting
      ? 'Open for applications'
      : 'Closed to new applications (optional)',
  };
}

// ---- Pure aggregation ----

export function buildReadiness(
  ayCode: string,
  steps: ReadinessStep[]
): AyReadiness {
  const required = steps.filter((s) => s.required);
  const complete = required.filter((s) => s.status === 'done').length;
  return { ayCode, steps, complete, total: required.length };
}

export function nextIncompleteStepId(steps: ReadinessStep[]): ReadinessStepId {
  const incomplete = steps.find((s) => s.required && s.status !== 'done');
  return (incomplete ?? steps[0]).id;
}

// ---- Thin DB fetchers (one query, hand numbers to the resolver) ----

async function fetchAySetup(db: SupabaseClient, ayId: string) {
  const { count } = await db
    .from('terms')
    .select('id', { count: 'exact', head: true })
    .eq('academic_year_id', ayId)
    .not('start_date', 'is', null)
    .not('end_date', 'is', null);
  return resolveAySetupStep({ datedTermCount: count ?? 0 });
}

async function fetchCalendar(db: SupabaseClient, ayId: string) {
  const { data: termRows } = await db
    .from('terms')
    .select('id')
    .eq('academic_year_id', ayId);
  const ids = (termRows ?? []).map((t) => (t as { id: string }).id);
  if (ids.length === 0)
    return resolveCalendarStep({ totalTerms: 0, coveredTerms: 0 });
  const { data: coveredRows } = await db
    .from('school_calendar')
    .select('term_id')
    .in('term_id', ids);
  const coveredTerms = new Set(
    (coveredRows ?? []).map((r) => (r as { term_id: string }).term_id)
  ).size;
  return resolveCalendarStep({ totalTerms: ids.length, coveredTerms });
}

async function fetchClasses(db: SupabaseClient, ayId: string) {
  const [{ count: sectionCount }, { count: subjectConfigCount }] =
    await Promise.all([
      db
        .from('sections')
        .select('id', { count: 'exact', head: true })
        .eq('academic_year_id', ayId)
        .not('level_id', 'is', null),
      db
        .from('subject_configs')
        .select('id', { count: 'exact', head: true })
        .eq('academic_year_id', ayId),
    ]);
  return resolveClassesStep({
    sectionCount: sectionCount ?? 0,
    subjectConfigCount: subjectConfigCount ?? 0,
  });
}

async function fetchAdvisers(db: SupabaseClient, ayId: string) {
  const { data: sectionIds } = await db
    .from('sections')
    .select('id')
    .eq('academic_year_id', ayId)
    .not('level_id', 'is', null);
  const ids = (sectionIds ?? []).map((s) => (s as { id: string }).id);
  if (ids.length === 0)
    return resolveAdvisersStep({ sectionCount: 0, advisedSectionCount: 0 });
  const { data: advisedRows } = await db
    .from('teacher_assignments')
    .select('section_id')
    .in('section_id', ids)
    .eq('role', 'form_adviser');
  const advised = new Set(
    (advisedRows ?? []).map((r) => (r as { section_id: string }).section_id)
  ).size;
  return resolveAdvisersStep({
    sectionCount: ids.length,
    advisedSectionCount: advised,
  });
}

async function fetchGradingSheets(db: SupabaseClient, ayId: string) {
  const { data: allSections } = await db
    .from('sections')
    .select('id')
    .eq('academic_year_id', ayId);
  const ids = (allSections ?? []).map((s) => (s as { id: string }).id);
  if (ids.length === 0)
    return resolveGradingSheetsStep({
      totalSections: 0,
      sectionsWithSheets: 0,
    });
  const { data: sheetRows } = await db
    .from('grading_sheets')
    .select('section_id')
    .in('section_id', ids);
  const withSheets = new Set(
    (sheetRows ?? []).map((r) => (r as { section_id: string }).section_id)
  ).size;
  return resolveGradingSheetsStep({
    totalSections: ids.length,
    sectionsWithSheets: withSheets,
  });
}

async function fetchVirtueThemes(db: SupabaseClient, ayId: string) {
  // T1–T3 only (T4 has no FCA comment — KD #49).
  const { data: terms } = await db
    .from('terms')
    .select('term_number, virtue_theme')
    .eq('academic_year_id', ayId)
    .lte('term_number', 3);
  const rows = (terms ?? []) as {
    term_number: number;
    virtue_theme: string | null;
  }[];
  const withTheme = rows.filter(
    (t) => (t.virtue_theme ?? '').trim().length > 0
  ).length;
  return resolveVirtueThemesStep({
    termsRequiringTheme: rows.length,
    termsWithTheme: withTheme,
  });
}

async function fetchLetterhead(db: SupabaseClient) {
  // school_config is a global singleton (id=1) — AY-independent.
  const { data } = await db
    .from('school_config')
    .select('organization_name, address_line_1')
    .eq('id', 1)
    .maybeSingle();
  const row = data as {
    organization_name: string | null;
    address_line_1: string | null;
  } | null;
  return resolveLetterheadStep({
    hasOrgName: (row?.organization_name ?? '').trim().length > 0,
    hasAddress: (row?.address_line_1 ?? '').trim().length > 0,
  });
}

function buildAllNotStarted(ayCode: string): AyReadiness {
  return buildReadiness(ayCode, [
    resolveAySetupStep({ datedTermCount: 0 }),
    resolveCalendarStep({ totalTerms: 0, coveredTerms: 0 }),
    resolveClassesStep({ sectionCount: 0, subjectConfigCount: 0 }),
    resolveAdvisersStep({ sectionCount: 0, advisedSectionCount: 0 }),
    resolveGradingSheetsStep({ totalSections: 0, sectionsWithSheets: 0 }),
    resolveVirtueThemesStep({ termsRequiringTheme: 0, termsWithTheme: 0 }),
    resolveLetterheadStep({ hasOrgName: false, hasAddress: false }),
    resolveAppWindowStep({ accepting: false }),
  ]);
}

async function getAyReadinessUncached(ayCode: string): Promise<AyReadiness> {
  const db = createServiceClient();
  const { data: ay } = await db
    .from('academic_years')
    .select('id, accepting_applications')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ay) return buildAllNotStarted(ayCode);
  const ayRow = ay as { id: string; accepting_applications: boolean };

  const [s1, s2, s3, s4, s5, s6, s7] = await Promise.all([
    fetchAySetup(db, ayRow.id),
    fetchCalendar(db, ayRow.id),
    fetchClasses(db, ayRow.id),
    fetchAdvisers(db, ayRow.id),
    fetchGradingSheets(db, ayRow.id),
    fetchVirtueThemes(db, ayRow.id),
    fetchLetterhead(db),
  ]);
  const s8 = resolveAppWindowStep({ accepting: ayRow.accepting_applications });

  return buildReadiness(ayCode, [s1, s2, s3, s4, s5, s6, s7, s8]);
}

export const getAyReadiness = (ayCode: string) =>
  unstable_cache(
    () => getAyReadinessUncached(ayCode),
    [`sis-readiness-${ayCode}`],
    { tags: [`sis:${ayCode}`], revalidate: 60 }
  )();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/sis/readiness.test.ts`
Expected: PASS — all describe blocks green (every resolver branch + `buildReadiness` + `nextIncompleteStepId` covered).

- [ ] **Step 5: Keep the soon-to-be-replaced control center compiling**

In `components/sis/year-setup/year-setup-control-center.tsx`, the `STEP_ICONS` constant is typed `Record<ReadinessStepId, LucideIcon>`, which now requires 8 keys. Make it tolerant (it is superseded in Task 4) by changing its type and lookups to a partial map with a fallback. Replace:

```ts
const STEP_ICONS: Record<ReadinessStepId, LucideIcon> = {
  'ay-setup': CalendarCog,
  calendar: CalendarDays,
  sections: LayoutGrid,
  'grading-sheets': ClipboardList,
};
```

with:

```ts
const STEP_ICONS: Partial<Record<ReadinessStepId, LucideIcon>> = {
  'ay-setup': CalendarCog,
  calendar: CalendarDays,
  classes: LayoutGrid,
  advisers: LayoutGrid,
  'grading-sheets': ClipboardList,
};
```

and at the two `const Icon = STEP_ICONS[step.id];` lookups, add a fallback:

```ts
const Icon = STEP_ICONS[step.id] ?? CalendarCog;
```

- [ ] **Step 6: Verify the build compiles**

Run: `npx next build`
Expected: clean compile (the control center renders interim/odd UI but type-checks; superseded in Task 4). If `tsc` flags any OTHER file with `Record<ReadinessStepId, ...>` (e.g. `components/sis/ay-readiness-pill.tsx`), apply the same `Partial<Record<…>>` + `?? fallback` change there.

- [ ] **Step 7: Commit**

```bash
git add lib/sis/readiness.ts __tests__/sis/readiness.test.ts components/sis/year-setup/year-setup-control-center.tsx
git commit -m "feat(sis): readiness engine — pure resolvers + 8 steps + 100%-tested"
```

---

### Task 2: Cache punch list — refresh the readiness ring after inline edits

**Files:**

- Modify: `app/api/sis/ay-setup/terms/[termId]/route.ts`
- Modify: `app/api/evaluation/virtue-theme/route.ts`
- Modify: `app/api/grading-sheets/bulk-create/route.ts`
- Modify: `app/api/sis/admin/school-config/route.ts`

**Interfaces:**

- Consumes: the `sis:${ayCode}` cache tag declared by `getAyReadiness` (Task 1).
- Produces: nothing importable — these are runtime cache-busts so the ring re-reads after a step edit.

> No unit test: `revalidateTag` is a Next runtime effect. Verify by build + the manual check in Step 5.

- [ ] **Step 1: Terms route — bust `sis:${ay}` on date OR virtue change**

In `app/api/sis/ay-setup/terms/[termId]/route.ts`, add the import at the top (with the other `next/*` imports):

```ts
import { revalidateTag } from 'next/cache';
```

Then replace the existing tail block:

```ts
if (datesChanged) {
  const { data: ay } = await service
    .from('academic_years')
    .select('ay_code')
    .eq('id', before.academic_year_id)
    .maybeSingle();
  const ayCode = (ay as { ay_code: string } | null)?.ay_code ?? null;
  if (ayCode) {
    invalidateDrillTags('attendance', ayCode);
    invalidateDrillTags('markbook', ayCode);
  }
}
```

with:

```ts
if (datesChanged || virtueChanged) {
  const { data: ay } = await service
    .from('academic_years')
    .select('ay_code')
    .eq('id', before.academic_year_id)
    .maybeSingle();
  const ayCode = (ay as { ay_code: string } | null)?.ay_code ?? null;
  if (ayCode) {
    // Year Setup readiness ring (ay-setup + virtue-themes steps) is cached
    // under sis:${ay} — bust it whenever a readiness input changes.
    revalidateTag(`sis:${ayCode}`, 'max');
    if (datesChanged) {
      invalidateDrillTags('attendance', ayCode);
      invalidateDrillTags('markbook', ayCode);
    }
  }
}
```

- [ ] **Step 2: Virtue-theme route — bust `sis:${ay}` when the theme changes**

In `app/api/evaluation/virtue-theme/route.ts`, add the import:

```ts
import { revalidateTag } from 'next/cache';
```

Inside the `if (changed) { … }` block, after the `await logAction({ … })` call and before the block's closing brace, add:

```ts
const { data: ay } = await service
  .from('academic_years')
  .select('ay_code')
  .eq('id', before.academic_year_id)
  .maybeSingle();
const ayCode = (ay as { ay_code: string } | null)?.ay_code ?? null;
if (ayCode) revalidateTag(`sis:${ayCode}`, 'max');
```

- [ ] **Step 3: Grading-sheets bulk-create — bust `sis:${ay}`**

In `app/api/grading-sheets/bulk-create/route.ts`, add the import:

```ts
import { revalidateTag } from 'next/cache';
```

Find the existing line near the end:

```ts
invalidateDrillTags('markbook', ayCodeForInvalidation);
```

and add directly after it:

```ts
revalidateTag(`sis:${ayCodeForInvalidation}`, 'max');
```

- [ ] **Step 4: School-config — bust the current AY's `sis:` tag on letterhead change**

In `app/api/sis/admin/school-config/route.ts`, add the import:

```ts
import { revalidateTag } from 'next/cache';
```

After the existing award-thresholds invalidation block (the `if (awardCols.some(...)) { … }` block), add:

```ts
// Letterhead fields feed the Year Setup readiness 'letterhead' step (cached
// under sis:${ay}). school_config is a global singleton, so bust the CURRENT
// AY's tag — editing letterhead while configuring a non-current future AY
// self-heals within the 60s TTL (acceptable; letterhead is rarely changed).
const letterheadCols = [
  'organization_name',
  'address_line_1',
  'address_line_2',
  'phone_number',
  'website_url',
  'contact_email',
  'pei_registration_start_date',
  'pei_registration_end_date',
  'logo_url',
  'pei_registration_number',
];
if (letterheadCols.some((c) => c in diff)) {
  const currentAy = await getCurrentAcademicYear(service);
  if (currentAy) revalidateTag(`sis:${currentAy.ay_code}`, 'max');
}
```

(`getCurrentAcademicYear` is already imported in this file.)

- [ ] **Step 5: Build + manual verification**

Run: `npx next build`
Expected: clean compile.

Manual (after Task 4 ships the UI, or immediately against the current control center): on `/sis/ay-setup`, edit a term date / virtue theme / generate grading sheets, then reload — the readiness ring updates immediately (not after 60s).

- [ ] **Step 6: Commit**

```bash
git add app/api/sis/ay-setup/terms/[termId]/route.ts app/api/evaluation/virtue-theme/route.ts app/api/grading-sheets/bulk-create/route.ts app/api/sis/admin/school-config/route.ts
git commit -m "fix(sis): bust sis:\${ay} cache tag so Year Setup readiness ring refreshes after edits"
```

---

### Task 3: One-click "Generate school days" — thin AY-wide calendar-seed route

**Files:**

- Create: `app/api/sis/ay-setup/seed-calendar/route.ts`

**Interfaces:**

- Consumes: `ensureTermSeeded(termId, startIso, endIso, userId): Promise<number>` from `lib/attendance/calendar.ts`.
- Produces: `POST /api/sis/ay-setup/seed-calendar` — body `{ ay_code: string }` → `{ ok, inserted, terms }` (or 422 `no_dated_terms`). Consumed by the calendar step button in Task 4.

> No unit test: the route is thin glue over `ensureTermSeeded` (which is itself integration-level). Verify by build + manual.

- [ ] **Step 1: Write the route**

Create `app/api/sis/ay-setup/seed-calendar/route.ts`:

```ts
import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { ensureTermSeeded } from '@/lib/attendance/calendar';

// POST /api/sis/ay-setup/seed-calendar
// Body: { ay_code }
//
// Generates the standard weekday school-day rows for every dated term of the
// AY in one call (idempotent — ensureTermSeeded upserts on (term_id, audience,
// date) and skips existing rows). The one-click backing for the Year Setup
// "School calendar" step. Holidays/HBL are still marked on /sis/calendar.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as {
    ay_code?: string;
  } | null;
  const ayCode = body?.ay_code;
  if (typeof ayCode !== 'string' || !/^AY\d{4}$/i.test(ayCode)) {
    return NextResponse.json({ error: 'invalid ay_code' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: ay } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ay) {
    return NextResponse.json({ error: 'AY not found' }, { status: 404 });
  }

  const { data: termRows } = await service
    .from('terms')
    .select('id, start_date, end_date')
    .eq('academic_year_id', (ay as { id: string }).id)
    .not('start_date', 'is', null)
    .not('end_date', 'is', null);

  const dated = (termRows ?? []) as {
    id: string;
    start_date: string;
    end_date: string;
  }[];
  if (dated.length === 0) {
    return NextResponse.json(
      { error: 'no_dated_terms', message: 'Set term dates first.' },
      { status: 422 }
    );
  }

  let inserted = 0;
  for (const t of dated) {
    inserted += await ensureTermSeeded(
      t.id,
      t.start_date,
      t.end_date,
      auth.user.id
    );
  }

  // Readiness 'calendar' step is cached under sis:${ay}.
  revalidateTag(`sis:${ayCode}`, 'max');

  return NextResponse.json({ ok: true, inserted, terms: dated.length });
}
```

- [ ] **Step 2: Build + manual verification**

Run: `npx next build`
Expected: clean compile.

Manual: `POST /api/sis/ay-setup/seed-calendar` with `{ "ay_code": "AY9999" }` (test AY) returns `{ ok: true, inserted: <n>, terms: <n> }`; re-running returns `inserted: 0` (idempotent).

- [ ] **Step 3: Commit**

```bash
git add app/api/sis/ay-setup/seed-calendar/route.ts
git commit -m "feat(sis): AY-wide seed-calendar route for one-click school-day generation"
```

---

### Task 4: Year Setup stepper — replace the control center

**Files:**

- Create: `components/sis/year-setup/year-setup-stepper.tsx`
- Modify: `app/(sis)/sis/ay-setup/page.tsx` (swap component)
- Delete: `components/sis/year-setup/year-setup-control-center.tsx`

**Interfaces:**

- Consumes: `AyReadiness`, `ReadinessStep`, `ReadinessStepId`, `nextIncompleteStepId` (Task 1); `POST /api/sis/ay-setup/seed-calendar` (Task 3); existing `TermDatesEditor`, `VirtueThemesEditor`, `AyAcceptingApplicationsToggle`, `GenerateSheetsDialog`, `AyPicker`, `ayStatusTone`, `AY_STATUS_LABEL`.
- Produces: `<YearSetupStepper ays selectedAy selectedTerms readiness />` (same props the control center took).

- [ ] **Step 1: Write the stepper component**

Create `components/sis/year-setup/year-setup-stepper.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarCog,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  Clock,
  LayoutGrid,
  ListChecks,
  Loader2,
  Sparkles,
  Stamp,
  Users,
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
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { AyPicker } from '@/components/sis/year-setup/ay-picker';
import { TermDatesEditor } from '@/components/sis/term-dates-editor';
import { VirtueThemesEditor } from '@/components/evaluation/virtue-themes-editor';
import { GenerateSheetsDialog } from '@/components/sis/generate-sheets-dialog';
import { AyAcceptingApplicationsToggle } from '@/components/sis/ay-accepting-applications-toggle';
import {
  AY_STATUS_LABEL,
  ayStatusTone,
  type AyStatusTone,
} from '@/lib/sis/year-setup';
import {
  nextIncompleteStepId,
  type AyReadiness,
  type ReadinessStep,
  type ReadinessStepId,
} from '@/lib/sis/readiness';
import type { AcademicYearListItem, TermRow } from '@/lib/sis/ay-setup/queries';

const STEP_ICONS: Record<ReadinessStepId, LucideIcon> = {
  'ay-setup': CalendarCog,
  calendar: CalendarDays,
  classes: LayoutGrid,
  advisers: Users,
  'grading-sheets': ClipboardList,
  'virtue-themes': Sparkles,
  letterhead: Stamp,
  'app-window': ListChecks,
};

const STATUS_BADGE_CLASS: Record<AyStatusTone, string> = {
  active: 'h-6 border-brand-mint bg-brand-mint/30 text-ink',
  'early-bird': 'h-6 border-brand-indigo-soft bg-accent text-brand-indigo-deep',
  inactive: 'h-6 text-muted-foreground',
};

function StepStatusBadge({ step }: { step: ReadinessStep }) {
  if (step.status === 'done') {
    return (
      <Badge
        variant="outline"
        className="h-6 gap-1 border-brand-mint bg-brand-mint/30 text-ink"
      >
        <CheckCircle2 className="size-3" /> Ready
      </Badge>
    );
  }
  if (step.status === 'partial') {
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
      <CircleDashed className="size-3" />{' '}
      {step.required ? 'Not started' : 'Optional'}
    </Badge>
  );
}

function RailDot({ status }: { status: ReadinessStep['status'] }) {
  const cls =
    status === 'done'
      ? 'bg-brand-mint'
      : status === 'partial'
        ? 'bg-brand-amber'
        : 'bg-muted-foreground/30';
  return <span className={`size-2 rounded-full ${cls}`} aria-hidden />;
}

export function YearSetupStepper({
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
  // Hooks must run unconditionally — derive a safe step id even when empty.
  const steps = readiness?.steps ?? [];
  const initialId: ReadinessStepId =
    steps.length > 0 ? nextIncompleteStepId(steps) : 'ay-setup';
  const [activeId, setActiveId] = useState<ReadinessStepId>(initialId);

  if (!selectedAy || !readiness || steps.length === 0) {
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
            classes, and grading sheets.
          </p>
        </CardContent>
      </Card>
    );
  }

  const activeIndex = Math.max(
    0,
    steps.findIndex((s) => s.id === activeId)
  );
  const active = steps[activeIndex];
  const ActiveIcon = STEP_ICONS[active.id];
  const tone = ayStatusTone(selectedAy);
  const pct =
    readiness.total > 0
      ? Math.round((readiness.complete / readiness.total) * 100)
      : 0;
  const allDone = readiness.complete === readiness.total;

  return (
    <div className="space-y-6">
      {/* Header — AY picker + status + readiness summary + Resume */}
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
          <div className="min-w-[240px] space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-foreground">Readiness</span>
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
            {!allDone && (
              <Button
                size="sm"
                className="w-full"
                onClick={() => setActiveId(nextIncompleteStepId(steps))}
              >
                Resume — next step
                <ArrowRight className="size-3.5" />
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Clickable step rail */}
      <Card className="py-0">
        <nav className="flex flex-wrap gap-1 p-2" aria-label="Setup steps">
          {steps.map((s) => {
            const Icon = STEP_ICONS[s.id];
            const isActive = s.id === active.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveId(s.id)}
                aria-current={isActive ? 'step' : undefined}
                className={
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ' +
                  (isActive
                    ? 'bg-accent text-brand-indigo-deep ring-1 ring-inset ring-brand-indigo-soft'
                    : 'text-muted-foreground hover:bg-muted')
                }
              >
                <RailDot status={s.status} />
                <Icon className="size-4 shrink-0" />
                <span className="hidden font-medium md:inline">{s.label}</span>
              </button>
            );
          })}
        </nav>
      </Card>

      {/* Active step panel */}
      <Card className="gap-0 py-0">
        <CardHeader className="border-b border-border py-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <ActiveIcon className="size-5" />
            </div>
            <div className="space-y-1">
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Step {active.step} of {steps.length}
              </CardDescription>
              <CardTitle className="font-serif text-[22px]">
                {active.label}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {active.description}
              </p>
            </div>
          </div>
          <StepStatusBadge step={active} />
        </CardHeader>

        <CardContent className="py-6">
          <StepPanel
            step={active}
            selectedAy={selectedAy}
            selectedTerms={selectedTerms}
          />
        </CardContent>

        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <Button
            variant="ghost"
            size="sm"
            disabled={activeIndex <= 0}
            onClick={() => setActiveId(steps[activeIndex - 1].id)}
          >
            <ArrowLeft className="size-3.5" /> Back
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={activeIndex >= steps.length - 1}
            onClick={() => setActiveId(steps[activeIndex + 1].id)}
          >
            Next <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </Card>
    </div>
  );
}

function PanelShell({
  hint,
  children,
}: {
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{hint}</p>
      {children}
    </div>
  );
}

function StepPanel({
  step,
  selectedAy,
  selectedTerms,
}: {
  step: ReadinessStep;
  selectedAy: AcademicYearListItem;
  selectedTerms: TermRow[];
}) {
  switch (step.id) {
    case 'ay-setup':
      return (
        <PanelShell hint="Set each term's start and end date. Dates unlock the school calendar and report-card publish windows.">
          <TermDatesEditor
            ayCode={selectedAy.ay_code}
            ayLabel={selectedAy.label}
            terms={selectedTerms}
          >
            <Button>Edit term dates</Button>
          </TermDatesEditor>
        </PanelShell>
      );
    case 'calendar':
      return (
        <PanelShell hint="Generate the standard weekday school days for every term, then open the calendar to mark holidays and home-based learning days.">
          <div className="flex flex-wrap gap-2">
            <GenerateCalendarButton ayCode={selectedAy.ay_code} />
            <Button variant="outline" asChild>
              <Link href="/sis/calendar">
                Open calendar <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </PanelShell>
      );
    case 'classes':
      return (
        <PanelShell hint="Apply the master class template to create this year's classes and their subject weights.">
          <div className="flex flex-wrap gap-2">
            <ApplyTemplateButton ayCode={selectedAy.ay_code} />
            <Button variant="outline" asChild>
              <Link href="/sis/admin/template">
                Open class template <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </PanelShell>
      );
    case 'advisers':
      return (
        <PanelShell hint="Assign a form adviser to each class. This happens on the Sections page.">
          <Button variant="outline" asChild>
            <Link href="/sis/sections">
              Open Sections <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        </PanelShell>
      );
    case 'grading-sheets':
      return (
        <PanelShell hint="Create one grading sheet per class, subject, and term — for every class at once.">
          <div className="flex flex-wrap gap-2">
            <GenerateSheetsDialog
              scope={{
                kind: 'ay',
                ayId: selectedAy.id,
                ayCode: selectedAy.ay_code,
              }}
            >
              <Button>Create grading sheets</Button>
            </GenerateSheetsDialog>
            <Button variant="outline" asChild>
              <Link href="/markbook/sections">
                Open Markbook sections <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </PanelShell>
      );
    case 'virtue-themes': {
      const t13 = selectedTerms
        .filter((t) => t.term_number <= 3)
        .sort((a, b) => a.term_number - b.term_number)
        .map((t) => ({
          id: t.id,
          label: t.label,
          termNumber: t.term_number,
          startDate: t.start_date,
          endDate: t.end_date,
          virtueTheme: t.virtue_theme ?? '',
        }));
      return (
        <PanelShell hint="Set the virtue theme for Terms 1–3. It appears as the heading of the report-card form-class-adviser comments.">
          {t13.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              Set term dates first.
            </p>
          ) : (
            <VirtueThemesEditor terms={t13} />
          )}
        </PanelShell>
      );
    }
    case 'letterhead':
      return (
        <PanelShell hint="The organization name and address printed on report cards, set school-wide in School config. Usually already set for HFSE.">
          <Button variant="outline" asChild>
            <Link href="/sis/admin/school-config">
              Open School config <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        </PanelShell>
      );
    case 'app-window':
      return (
        <PanelShell hint="Optional. Open this year for parent applications — early-bird for a future year, or live for the active year.">
          <AyAcceptingApplicationsToggle
            ayCode={selectedAy.ay_code}
            current={selectedAy.accepting_applications}
            isCurrentAy={selectedAy.is_current}
          />
        </PanelShell>
      );
    default:
      return null;
  }
}

function GenerateCalendarButton({ ayCode }: { ayCode: string }) {
  const router = useRouter();
  const m = useMutation({
    mutationFn: () =>
      apiFetch(
        '/api/sis/ay-setup/seed-calendar',
        jsonInit('POST', { ay_code: ayCode })
      ),
    onSuccess: (data: unknown) => {
      const inserted = (data as { inserted?: number })?.inserted ?? 0;
      toast.success(`School days generated (${inserted} added).`);
      router.refresh();
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : 'Could not generate school days.'
      ),
  });
  return (
    <Button onClick={() => m.mutate()} disabled={m.isPending}>
      {m.isPending && <Loader2 className="size-3.5 animate-spin" />}
      Generate school days
    </Button>
  );
}

function ApplyTemplateButton({ ayCode }: { ayCode: string }) {
  const router = useRouter();
  const m = useMutation({
    mutationFn: () =>
      apiFetch(
        '/api/sis/admin/template/apply',
        jsonInit('POST', { ay_codes: [ayCode] })
      ),
    onSuccess: () => {
      toast.success('Class template applied.');
      router.refresh();
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : 'Could not apply the template.'
      ),
  });
  return (
    <Button onClick={() => m.mutate()} disabled={m.isPending}>
      {m.isPending && <Loader2 className="size-3.5 animate-spin" />}
      Apply class template
    </Button>
  );
}
```

- [ ] **Step 2: Swap the component on the page**

In `app/(sis)/sis/ay-setup/page.tsx`, change the import:

```ts
import { YearSetupControlCenter } from '@/components/sis/year-setup/year-setup-control-center';
```

to:

```ts
import { YearSetupStepper } from '@/components/sis/year-setup/year-setup-stepper';
```

and replace the usage inside `<TabsContent value="setup">`:

```tsx
<YearSetupControlCenter
  ays={pickerAys}
  selectedAy={selectedAy}
  selectedTerms={selectedTerms}
  readiness={readiness}
/>
```

with:

```tsx
<YearSetupStepper
  ays={pickerAys}
  selectedAy={selectedAy}
  selectedTerms={selectedTerms}
  readiness={readiness}
/>
```

- [ ] **Step 3: Delete the old control center**

```bash
git rm components/sis/year-setup/year-setup-control-center.tsx
```

- [ ] **Step 4: Build + manual verification**

Run: `npx next build`
Expected: clean compile (no remaining importers of `year-setup-control-center`).

Manual on `/sis/ay-setup` (Test AY): the stepper renders; the rail is clickable; "Resume — next step" jumps to the first incomplete required step; term dates / virtue themes edit inline; "Generate school days", "Apply class template", and "Create grading sheets" run and the ring updates; "Open …" links navigate out.

- [ ] **Step 5: Commit**

```bash
git add components/sis/year-setup/year-setup-stepper.tsx app/(sis)/sis/ay-setup/page.tsx
git commit -m "feat(sis): Year Setup guided stepper replaces the control center"
```

---

### Task 5: Collapse the `/sis` hub duplicate to one readiness card

**Files:**

- Create: `components/sis/year-setup/hub-year-setup-card.tsx`
- Modify: `app/(sis)/sis/page.tsx` (fetch readiness; replace the 4-card grid)

**Interfaces:**

- Consumes: `getAyReadiness` + `AyReadiness` (Task 1).
- Produces: `<HubYearSetupCard readiness={AyReadiness | null} />`.

- [ ] **Step 1: Write the hub card**

Create `components/sis/year-setup/hub-year-setup-card.tsx`:

```tsx
import Link from 'next/link';
import { ArrowUpRight, ListChecks } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { AyReadiness } from '@/lib/sis/readiness';

export function HubYearSetupCard({
  readiness,
}: {
  readiness: AyReadiness | null;
}) {
  const complete = readiness?.complete ?? 0;
  const total = readiness?.total ?? 0;
  const pct = total > 0 ? Math.round((complete / total) * 100) : 0;
  const ready = total > 0 && complete === total;

  return (
    <Card className="@container/card group transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <CardHeader>
        <CardDescription>Year setup</CardDescription>
        <CardTitle className="font-serif text-xl">
          Set up the academic year
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <ListChecks className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-4 text-sm">
        <p className="leading-relaxed text-muted-foreground">
          {ready
            ? 'Everything is in place for this academic year.'
            : 'Term dates, calendar, classes, advisers, grading sheets, virtue themes, and letterhead — guided, in one place.'}
        </p>
        <div className="flex w-full items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-indigo-soft to-brand-sky"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {complete} / {total} ready
          </span>
        </div>
        <Button asChild size="sm">
          <Link href="/sis/ay-setup">
            Open Year Setup
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
```

- [ ] **Step 2: Fetch readiness in the hub RSC**

In `app/(sis)/sis/page.tsx`, add the imports:

```ts
import { getAyReadiness } from '@/lib/sis/readiness';
import { HubYearSetupCard } from '@/components/sis/year-setup/hub-year-setup-card';
```

In the page's data-fetching body (where `currentAy` is already resolved), add:

```ts
const ayReadiness = currentAy ? await getAyReadiness(currentAy.ay_code) : null;
```

(Place it alongside the other `await`s; if `currentAy` uses a different property than `ay_code`, use whichever field holds the `AY####` code.)

- [ ] **Step 3: Replace the 4-card Year Setup grid**

In `app/(sis)/sis/page.tsx`, replace the entire Year Setup `<section>` (the `<h2>Year Setup</h2>` block containing the four `<AdminCard step={1..4} … />` cards) with:

```tsx
{
  /* Year Setup — single guided entry point (the steps live in /sis/ay-setup). */
}
<section className="space-y-3">
  <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
    Year Setup
  </h2>
  <div className="grid gap-4 md:grid-cols-2">
    <HubYearSetupCard readiness={ayReadiness} />
  </div>
</section>;
```

- [ ] **Step 4: Build + remove now-unused imports**

Run: `npx next build`
Expected: clean compile. If the build (or `tsc`) reports unused imports left over from the deleted cards (e.g. `CalendarCog`, `CalendarDays`, `LayoutGrid`, `ClipboardList` if no longer referenced — note `AdminCard` is still used by the "Organisation" section, so keep it), remove only the genuinely-unused ones.

Manual on `/sis`: the "Year Setup" section now shows one card with the readiness ring + "N / 7 ready" linking to `/sis/ay-setup`; the four separate step cards are gone; the "Organisation" section below is unchanged.

- [ ] **Step 5: Commit**

```bash
git add components/sis/year-setup/hub-year-setup-card.tsx app/(sis)/sis/page.tsx
git commit -m "feat(sis): collapse /sis hub Year Setup grid to one readiness card"
```

---

## Self-Review

**Spec coverage:**

- One front door (`/sis/ay-setup`) + hub dedup → Task 4 + Task 5. ✓
- Guided non-linear stepper (clickable rail + Resume + Back/Next) → Task 4. ✓
- 8 steps, light inline / heavy launch + one-click → Task 4 `StepPanel`. ✓
- Readiness engine refactor (pure resolvers + fetchers + `buildReadiness`) → Task 1. ✓
- 100% resolver test coverage → Task 1 Step 1 (every branch enumerated). ✓
- Required vs optional (7 required, app-window optional) → Task 1 `buildReadiness` + tests. ✓
- One-click calendar generate → Task 3 + Task 4 `GenerateCalendarButton`. ✓
- Cache punch list (4 routes) → Task 2. ✓
- Reuse `GenerateSheetsDialog` AY-scoped → Task 4 grading-sheets panel. ✓
- Letterhead = org_name + address_line_1, launch-only (singleton, usually green) → Task 1 `resolveLetterheadStep`/`fetchLetterhead` + Task 4 letterhead panel. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The two "if a different property/file" notes (hub `ay_code`, extra `Record<ReadinessStepId>` consumers) are concrete conditional instructions with the exact fix shown, not placeholders.

**Type consistency:** `ReadinessStepId` ids (`'classes'`, `'advisers'`, `'virtue-themes'`, `'letterhead'`, `'app-window'`) are identical across `readiness.ts`, the stepper's `STEP_ICONS`, and `StepPanel`'s switch. `AyReadiness` shape (`steps`/`complete`/`total`/`ayCode`) matches between Task 1, the stepper, and the hub card. `nextIncompleteStepId` returns `ReadinessStepId`, consumed by `useState<ReadinessStepId>`. `GenerateSheetsDialog` scope `{ kind: 'ay', ayId, ayCode }` matches the proven `ay-setup-data-table.tsx` usage. `VirtueThemesEditor` prop shape (`{ id, label, termNumber, startDate, endDate, virtueTheme }`) matches its definition.
