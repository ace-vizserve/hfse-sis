# Admissions Insights Implementation Plan (Phase 1 of Module Insights)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/admissions/compare` with `/admissions/insights` — a purpose-driven "Enrollment Health" surface (intake trend, funnel drop-off, cancellation causes by level, time-to-enroll, referral, takeaways) — and establish the shared Insights page skeleton the other 3 modules will copy.

**Architecture:** Re-composition over existing data. New synthesis lives in `lib/admissions/insights.ts` (pure rollups + thin cached loaders) reusing the existing `lib/admissions/dashboard.ts` loaders (`getConversionFunnel`, `getAverageTimeToEnrollment`, `getReferralSourceBreakdown`, `getApplicationsVelocityRange`, `getAdmissionsKpisRange`) and the `admissionsInsights` narrative engine. New shared presentational primitives live in `components/dashboard/insights/`. The page is a server component at `app/(admissions)/admissions/insights/page.tsx`. The old `/admissions/compare` becomes a redirect. P-Files/Evaluation are NOT touched.

**Tech Stack:** Next.js 16 (App Router, RSC, async params), Supabase (service client + `unstable_cache`), recharts wrappers in `components/dashboard/charts/*`, vitest, Tailwind v4 + Aurora Vault tokens.

**Spec:** `docs/superpowers/specs/2026-06-10-module-insights-design.md`. Data-honesty rule: sections tagged `[now]` build from existing data; the seasonal/prediction section renders a "building history…" placeholder until ≥3 cycles exist.

---

## File structure

- **Create** `components/dashboard/insights/insights-section.tsx` — shared titled-section wrapper (eyebrow + serif title + optional description + children). Used by every module's Insights page.
- **Create** `components/dashboard/insights/building-history-card.tsx` — the `[needs cycles]` placeholder card ("Seasonal trends unlock once we have more history").
- **Create** `lib/admissions/insights.ts` — admissions synthesis: pure rollups (`rollupTerminalReasons`, `growthDelta`) + cached loaders (`getEnrollmentHealth`).
- **Create** `__tests__/admissions/insights.test.ts` — unit tests for the pure rollups.
- **Create** `app/(admissions)/admissions/insights/page.tsx` — the Enrollment Health page.
- **Modify** `app/(admissions)/admissions/compare/page.tsx` — replace body with a redirect to `/admissions/insights`.
- **Modify** `lib/sidebar/registry.ts` — Admissions nav: rename the "Compare" entry → "Insights", href `/admissions/insights`.
- **Reuse (read for exact shapes, do NOT modify):** `lib/admissions/dashboard.ts`, `lib/dashboard/insights.ts` (`admissionsInsights`, `AdmissionsInsightInput`), `lib/schemas/sis.ts` (`APPLICATION_TERMINAL_REASON_LABELS`, `APPLICATION_TERMINAL_REASON_VALUES`), `components/dashboard/charts/*`, `components/dashboard/insights-panel.tsx`, `components/dashboard/dashboard-hero.tsx`, `lib/admissions/_shared.ts` (`prefixFor`), `lib/admissions/drills/*` (existing drill cards).

---

## Task 1: Shared Insights section primitives

**Files:**

- Create: `components/dashboard/insights/insights-section.tsx`
- Create: `components/dashboard/insights/building-history-card.tsx`

These are presentational (no logic to unit-test); verified by the build + reused by all module Insights pages. Match the design system (read `docs/context/09a-design-patterns.md` §8 — eyebrow = mono uppercase, title = serif; tokens only).

- [ ] **Step 1: Create the section wrapper**

```tsx
// components/dashboard/insights/insights-section.tsx
import type { ReactNode } from 'react';

/**
 * Shared titled section for any module's Insights page. Eyebrow (mono) + serif
 * title + optional one-line description, then the section body. Keeps every
 * module's Insights surface visually consistent (spec: shared skeleton).
 */
export function InsightsSection({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {eyebrow}
        </p>
        <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
```

- [ ] **Step 2: Create the building-history placeholder**

```tsx
// components/dashboard/insights/building-history-card.tsx
import { Hourglass } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

/**
 * Placeholder for `[needs cycles]` sections (seasonal baselines, prediction).
 * The surface is wired now; the data fills in automatically once enough
 * completed cycles exist. Honest empty-state instead of fake numbers.
 */
export function BuildingHistoryCard({
  label = 'Seasonal trends',
  detail = 'This unlocks once the school has a few completed years of data to compare against. It will fill in automatically each cycle.',
}: {
  label?: string;
  detail?: string;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex items-start gap-4 p-6">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Hourglass className="size-5" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="font-serif text-base font-semibold text-foreground">
            {label} — building history…
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {detail}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Verify the build compiles**

Run: `npx tsc --noEmit 2>&1 | grep -v validator.ts | grep "error TS"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/insights/insights-section.tsx components/dashboard/insights/building-history-card.tsx
git commit -m "feat(insights): shared section wrapper + building-history placeholder"
```

---

## Task 2: Terminal-reason rollup (pure) + unit tests

**Files:**

- Create: `lib/admissions/insights.ts` (rollup helpers only in this task)
- Create: `__tests__/admissions/insights.test.ts`

The diagnostic core: aggregate cancelled/withdrawn applications by their `applicationTerminalReason` (the "why they drop" data, captured per KD #111, never aggregated). Pure functions so they're unit-testable; the cached loader (Task 3) wraps them.

First read `lib/schemas/sis.ts` to confirm `APPLICATION_TERMINAL_REASON_VALUES` (string union) + `APPLICATION_TERMINAL_REASON_LABELS` (Record<reason,string>) and import them.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/admissions/insights.test.ts
import { describe, it, expect } from 'vitest';
import { rollupTerminalReasons, growthDelta } from '@/lib/admissions/insights';

describe('rollupTerminalReasons', () => {
  it('counts reasons overall and by level, sorted desc, null/blank -> "Unspecified"', () => {
    const rows = [
      { applicationTerminalReason: 'Chose another school', levelApplied: 'P1' },
      { applicationTerminalReason: 'Chose another school', levelApplied: 'P2' },
      { applicationTerminalReason: 'Fees', levelApplied: 'P1' },
      { applicationTerminalReason: null, levelApplied: 'P1' },
      { applicationTerminalReason: '', levelApplied: 'S1' },
    ];
    const out = rollupTerminalReasons(rows);
    // overall: Chose another school 2, Fees 1, Unspecified 2 -> sorted desc
    expect(out.overall[0]).toEqual({
      reason: 'Chose another school',
      count: 2,
    });
    expect(out.total).toBe(5);
    // by level: P1 has 3 (Chose another school 1, Fees 1, Unspecified 1)
    const p1 = out.byLevel.find((l) => l.level === 'P1');
    expect(p1?.count).toBe(3);
  });

  it('returns empty shape for no rows', () => {
    const out = rollupTerminalReasons([]);
    expect(out).toEqual({ overall: [], byLevel: [], total: 0 });
  });
});

describe('growthDelta', () => {
  it('computes pct change vs prior, null prior -> null pct', () => {
    expect(growthDelta(120, 100)).toEqual({
      current: 120,
      prior: 100,
      pct: 20,
    });
    expect(growthDelta(100, 0)).toEqual({ current: 100, prior: 0, pct: null });
    expect(growthDelta(80, null)).toEqual({
      current: 80,
      prior: null,
      pct: null,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/admissions/insights.test.ts`
Expected: FAIL — `rollupTerminalReasons`/`growthDelta` not exported.

- [ ] **Step 3: Implement the pure rollups**

```ts
// lib/admissions/insights.ts  (rollups only; loaders added in Task 3)
import 'server-only';

export type ReasonCount = { reason: string; count: number };
export type TerminalReasonRollup = {
  overall: ReasonCount[];
  byLevel: { level: string; count: number; reasons: ReasonCount[] }[];
  total: number;
};

type TerminalRow = {
  applicationTerminalReason: string | null;
  levelApplied: string | null;
};

const UNSPECIFIED = 'Unspecified';

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}
function toSortedCounts(map: Map<string, number>): ReasonCount[] {
  return [...map.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/** Aggregate terminal (cancelled/withdrawn-application) reasons overall + by level. */
export function rollupTerminalReasons(
  rows: TerminalRow[]
): TerminalReasonRollup {
  const overall = new Map<string, number>();
  const perLevel = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const reason = (r.applicationTerminalReason ?? '').trim() || UNSPECIFIED;
    const level = (r.levelApplied ?? '').trim() || 'Unknown';
    bump(overall, reason);
    if (!perLevel.has(level)) perLevel.set(level, new Map());
    bump(perLevel.get(level)!, reason);
  }
  const byLevel = [...perLevel.entries()]
    .map(([level, m]) => {
      const reasons = toSortedCounts(m);
      return {
        level,
        count: reasons.reduce((s, x) => s + x.count, 0),
        reasons,
      };
    })
    .sort((a, b) => b.count - a.count || a.level.localeCompare(b.level));
  return { overall: toSortedCounts(overall), byLevel, total: rows.length };
}

export type Growth = {
  current: number;
  prior: number | null;
  pct: number | null;
};
/** Period-over-period growth %; null prior or zero prior -> null pct (avoid /0). */
export function growthDelta(current: number, prior: number | null): Growth {
  if (prior === null || prior === 0) return { current, prior, pct: null };
  return {
    current,
    prior,
    pct: Math.round(((current - prior) / prior) * 1000) / 10,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/admissions/insights.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add lib/admissions/insights.ts __tests__/admissions/insights.test.ts
git commit -m "feat(admissions/insights): terminal-reason rollup + growth-delta pure helpers"
```

---

## Task 3: Enrollment Health loader

**Files:**

- Modify: `lib/admissions/insights.ts` (add the cached loader)

Wraps the pure rollups + reuses existing dashboard loaders into one payload for the page. **Before coding, read** `lib/admissions/_shared.ts` for `prefixFor`, and `lib/admissions/dashboard.ts` for the exact return shapes + signatures of `getConversionFunnel`, `getAverageTimeToEnrollment`, `getReferralSourceBreakdown`, `getApplicationsVelocityRange`, `getAdmissionsKpisRange` — use them as-is; do not reimplement.

- [ ] **Step 1: Add the loader**

The terminal-reason query reads the AY's `_enrolment_status` (carries `applicationTerminalReason`) joined to `_enrolment_applications` (carries `levelApplied`) — confirm the join key (`enroleeNumber`) by reading the closed-applications loader pattern in `app/(admissions)/admissions/applications/closed/page.tsx`. Use the service client + `prefixFor(ayCode)`; cache with the existing admissions tag pattern (`admissions-dashboard:${ayCode}`, 60s) so existing mutations invalidate it.

```ts
// add to lib/admissions/insights.ts
import { unstable_cache } from 'next/cache';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { prefixFor } from '@/lib/admissions/_shared';

const CACHE_TTL_SECONDS = 60;

async function loadTerminalReasonsUncached(
  ayCode: string
): Promise<TerminalReasonRollup> {
  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();
  // Closed/terminal applications carry applicationTerminalReason on _enrolment_status;
  // levelApplied lives on _enrolment_applications. Join on enroleeNumber.
  const { data: statusRows, error } = await supabase
    .from(`${prefix}_enrolment_status`)
    .select('enroleeNumber, applicationTerminalReason')
    .not('applicationTerminalReason', 'is', null);
  if (error || !statusRows) return { overall: [], byLevel: [], total: 0 };
  const enroleeNumbers = statusRows
    .map((r) => (r as { enroleeNumber: string | null }).enroleeNumber)
    .filter((n): n is string => !!n);
  const levelByEnrolee = new Map<string, string | null>();
  if (enroleeNumbers.length > 0) {
    const { data: appRows } = await supabase
      .from(`${prefix}_enrolment_applications`)
      .select('enroleeNumber, levelApplied')
      .in('enroleeNumber', enroleeNumbers);
    for (const a of (appRows ?? []) as {
      enroleeNumber: string;
      levelApplied: string | null;
    }[]) {
      levelByEnrolee.set(a.enroleeNumber, a.levelApplied);
    }
  }
  const rows = (
    statusRows as {
      enroleeNumber: string | null;
      applicationTerminalReason: string | null;
    }[]
  ).map((r) => ({
    applicationTerminalReason: r.applicationTerminalReason,
    levelApplied: r.enroleeNumber
      ? (levelByEnrolee.get(r.enroleeNumber) ?? null)
      : null,
  }));
  return rollupTerminalReasons(rows);
}

export function getAdmissionsTerminalReasons(
  ayCode: string
): Promise<TerminalReasonRollup> {
  return unstable_cache(
    () => loadTerminalReasonsUncached(ayCode),
    ['admissions-insights', 'terminal-reasons', ayCode],
    {
      revalidate: CACHE_TTL_SECONDS,
      tags: ['admissions-dashboard', `admissions-dashboard:${ayCode}`],
    }
  )();
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit 2>&1 | grep -v validator.ts | grep "error TS"`
Expected: no output. (If the `_enrolment_status` select shape differs, fix the cast to match the real columns.)

- [ ] **Step 3: Commit**

```bash
git add lib/admissions/insights.ts
git commit -m "feat(admissions/insights): cached terminal-reasons loader"
```

---

## Task 4: Admissions Insights page

**Files:**

- Create: `app/(admissions)/admissions/insights/page.tsx`

Server component. Role gate identical to the existing compare page (read `app/(admissions)/admissions/compare/page.tsx` for the `ALLOWED_ROLES` set + `getSessionUser` pattern, copy it). Compose the spec's skeleton using `InsightsSection` + existing loaders/charts/insight engine.

- [ ] **Step 1: Build the page**

Sections, in order (all `[now]` except the last):

1. **Headline** — `DashboardHero` (eyebrow "Admissions · Insights", title "Enrollment Health", description). Show current-AY enrolled count + growth vs prior AY via `growthDelta` (prior AY = `listAyCodes` → the AY code one below current, if it exists; else prior = null → "building history").
2. **Intake trend** (`InsightsSection`) — `getApplicationsVelocityRange` over the AY → `TrendChart` (applications/day). Reuse the chart wrapper used on the admissions dashboard.
3. **Funnel drop-off** (`InsightsSection`) — `getConversionFunnel(ayCode)`; render the existing funnel/pipeline drill card OR a `ComparisonBarChart` of stage counts; surface the biggest drop-off stage in the section description.
4. **Cancellation causes** (`InsightsSection`) — `getAdmissionsTerminalReasons(ayCode)`: a `DonutChart` (or bar) of `overall` reasons (label via `APPLICATION_TERMINAL_REASON_LABELS`, falling back to the raw string for `Unspecified`), plus a compact "by level" table (top reason per level). This is the headline diagnostic.
5. **Time-to-enroll + referral** (`InsightsSection`, 2-col) — `getAverageTimeToEnrollment` + `getReferralSourceBreakdown`.
6. **Takeaways** — `admissionsInsights(...)` (`InsightsPanel`), fed `funnelDropOff` (from the funnel) + `topReferral` (from referral) + the KPI deltas (`getAdmissionsKpisRange`), exactly as the admissions dashboard builds it (copy that construction).
7. **Seasonal** — `BuildingHistoryCard` (placeholder; `[needs cycles]`).

Fetch all loaders in one `Promise.all`. Reuse chart wrappers from `components/dashboard/charts/*` and the admissions drill cards where they fit. Tokens only; one primary action max.

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep -v validator.ts | grep "error TS"` (expect none), then `npx next build` (expect "Compiled successfully").

- [ ] **Step 3: Manual happy-path (test AY)**

Load `/admissions/insights` as a registrar on the AY9999 test env: every `[now]` section renders real numbers; the cancellation-causes donut + by-level table populate from seeded terminal reasons; the seasonal section shows "building history…". Note: if seeded terminal-reason data is sparse, add a few via the seeder or accept an empty-but-correct state.

- [ ] **Step 4: Commit**

```bash
git add "app/(admissions)/admissions/insights/page.tsx"
git commit -m "feat(admissions): Enrollment Health insights page"
```

---

## Task 5: Redirect old compare + rename nav

**Files:**

- Modify: `app/(admissions)/admissions/compare/page.tsx`
- Modify: `lib/sidebar/registry.ts`

- [ ] **Step 1: Turn the compare page into a redirect**

Replace the whole component body with a permanent redirect that preserves nothing (the compare params don't map to insights):

```tsx
// app/(admissions)/admissions/compare/page.tsx
import { redirect } from 'next/navigation';

// Admissions "Compare" was replaced by the purpose-driven Insights surface
// (spec 2026-06-10-module-insights-design). Old links/bookmarks land on Insights.
export default function AdmissionsCompareRedirect() {
  redirect('/admissions/insights');
}
```

- [ ] **Step 2: Rename the Admissions nav entry**

In `lib/sidebar/registry.ts`, find the Admissions module's "Compare" nav item (href `/admissions/compare`) and change its label to `Insights` + href to `/admissions/insights`. Leave the OTHER modules' Compare entries untouched (their Insights ships in later phases). Read the file first to match the exact registry shape.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit 2>&1 | grep -v validator.ts | grep "error TS"` (none) + `npx next build` (compiles). Manual: the Admissions sidebar shows "Insights"; visiting `/admissions/compare` redirects to `/admissions/insights`.

- [ ] **Step 4: Commit**

```bash
git add "app/(admissions)/admissions/compare/page.tsx" lib/sidebar/registry.ts
git commit -m "feat(admissions): retire Compare → Insights (redirect + nav rename)"
```

---

## Task 6: KD + docs

**Files:**

- Modify: `.claude/rules/key-decisions/admissions.md` (new KD) + `.claude/rules/key-decisions.md` (index row)

- [ ] **Step 1: Add the KD**

Append a new KD (next unused number) to `admissions.md`: "Module Insights replaces Compare (Admissions first). Dashboard = today / Insights = over-time. `/admissions/insights` (Enrollment Health: intake trend, funnel drop-off, terminal-reason causes by level, time-to-enroll, referral, takeaways); `/admissions/compare` redirects. Shared primitives in `components/dashboard/insights/`; synthesis in `lib/admissions/insights.ts` reusing existing dashboard loaders. Seasonal/prediction deferred (`[needs cycles]` placeholder). Records/Attendance/Markbook follow the same skeleton in later phases; P-Files/Evaluation get no Insights (dashboard is their insight). Spec: docs/superpowers/specs/2026-06-10-module-insights-design.md." Add the index row in `key-decisions.md` (table + quick-lookup).

- [ ] **Step 2: Commit**

```bash
git add .claude/rules/key-decisions/admissions.md .claude/rules/key-decisions.md
git commit -m "docs(kd): Module Insights — Admissions Phase 1"
```

---

## Self-review (against the spec)

- **Spec coverage:** Enrollment Health sections — intake trend (Task 4.2), funnel drop-off (4.3), cancellation causes by level (Tasks 2/3/4.4), time-to-enroll + referral (4.5), takeaways (4.6), seasonal placeholder (4.7); Compare→Insights rename + redirect (Task 5); shared skeleton primitives (Task 1) — all covered. Records/Attendance/Markbook are explicitly out of scope (later phases). P-Files/Evaluation untouched. ✓
- **Data honesty:** seasonal = `BuildingHistoryCard`; growth shows null/"building history" when no prior AY. ✓
- **Reuse:** no new data plumbing except the terminal-reason aggregation (genuinely new — never aggregated before); everything else reuses `lib/admissions/dashboard.ts` + `admissionsInsights`. ✓
- **Types:** `TerminalReasonRollup` / `ReasonCount` / `Growth` defined in Task 2, consumed in Tasks 3–4; loader name `getAdmissionsTerminalReasons` consistent. ✓

## Verification (whole feature)

- `npx tsc --noEmit` + `npx vitest run __tests__/admissions/insights.test.ts` + `npx next build` all green.
- `/admissions/insights` renders all `[now]` sections from seeded data; `/admissions/compare` redirects; sidebar reads "Insights".
- Ship as one branch `feat/admissions-insights` off `main`; reviewer pass (focus: terminal-reason join correctness + the reused-loader shapes); merge + push.
