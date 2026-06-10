# Records Insights Implementation Plan (Phase 2 of Module Insights)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace `/records/compare` with `/records/insights` — a "Retention / Population" surface (headcount growth, student movement, retention, late-enrollee patterns, withdrawal-cause analysis) — reusing the shared Insights skeleton built in Phase 1 (Admissions).

**Architecture:** Same pattern as Admissions Insights (KD #140). New synthesis in `lib/sis/records-insights.ts` (pure `rollupMovements` + thin cached loaders) reusing existing `lib/sis/movements.ts::getMovementEvents`, `lib/sis/dashboard.ts` loaders (`getLevelDistribution`, `getEnrollmentVelocityRange`, `getWithdrawalVelocityRange`), and `WITHDRAWAL_REASON_LABELS`. The one genuinely new query is cross-AY retention. Page composes the shared `components/dashboard/insights/*` primitives. Old `/records/compare` → redirect. P-Files/Evaluation untouched; Attendance/Markbook are later phases.

**Tech Stack:** Next.js 16 (RSC, async params), Supabase service client + `unstable_cache`, recharts wrappers, vitest, Aurora Vault tokens. **Spec:** `docs/superpowers/specs/2026-06-10-module-insights-design.md` (Records section). `[now]` builds from existing data; retention/growth show "building history" (`BuildingHistoryCard`) when no prior AY exists.

---

## File structure

- **Create** `lib/dashboard/growth.ts` — move the generic pure `growthDelta` + `Growth` type here (shared by Admissions + Records; DRY).
- **Modify** `lib/admissions/insights.ts` — re-export-free: drop its local `growthDelta`/`Growth`, import from `lib/dashboard/growth.ts`. Update the admissions page/insights consumers' imports if they imported from `lib/admissions/insights.ts`.
- **Create** `lib/sis/records-insights.ts` — pure `rollupMovements` + cached loaders (`getRecordsRetention`, `getRecordsInsightsData`).
- **Create** `__tests__/sis/records-insights.test.ts` — unit tests for `rollupMovements`.
- **Create** `app/(records)/records/insights/page.tsx` — the Retention/Population page.
- **Modify** `app/(records)/records/compare/page.tsx` — replace body with redirect to `/records/insights`.
- **Modify** `lib/auth/roles.ts` — Records nav: the `/records/compare` entry (~line 122) → href `/records/insights`, label `Insights`.
- **Reuse (read for exact shapes; do NOT modify):** `lib/sis/movements.ts` (`getMovementEvents(currentAyCode, { includeAllAYs? })` → `MovementEvent[]`, union kinds `section-transfer | withdrawn | late-enrolled | re-enrolled`, each with `studentNumber|level|termNumber|termLabel`; `withdrawn` adds `reasonLabel`), `lib/sis/dashboard.ts` (`getLevelDistribution(ayCode)` → `LevelCount[]`, `getEnrollmentVelocityRange`, `getWithdrawalVelocityRange`), `lib/schemas/enrolment.ts` (`WITHDRAWAL_REASON_LABELS`), `app/(records)/records/compare/page.tsx` (role gate `['registrar','school_admin','superadmin']`), `components/dashboard/insights/{insights-section,building-history-card}.tsx`, `app/(admissions)/admissions/insights/page.tsx` (the reference page structure), `components/dashboard/charts/*`.

---

## Task 1: Move `growthDelta` to a shared module

**Files:** Create `lib/dashboard/growth.ts`; Modify `lib/admissions/insights.ts` (+ any importer of its `growthDelta`).

- [ ] **Step 1: Create the shared helper** (copy the exact body currently in `lib/admissions/insights.ts`)

```ts
// lib/dashboard/growth.ts
export type Growth = {
  current: number;
  prior: number | null;
  pct: number | null;
};

/** Period-over-period growth %; null/zero prior -> null pct (avoid /0). Pure. */
export function growthDelta(current: number, prior: number | null): Growth {
  if (prior === null || prior === 0) return { current, prior, pct: null };
  return {
    current,
    prior,
    pct: Math.round(((current - prior) / prior) * 1000) / 10,
  };
}
```

- [ ] **Step 2: Point admissions at the shared helper**

In `lib/admissions/insights.ts`, delete the local `growthDelta` + `Growth` definitions and add `export { growthDelta, type Growth } from '@/lib/dashboard/growth';` (re-export so the existing admissions page import keeps working unchanged). Read the file first to confirm where they're defined + that nothing else breaks.

- [ ] **Step 3: Verify**

Run: `npx vitest run __tests__/admissions/insights.test.ts` (the existing growthDelta tests still pass via the re-export) + `npx tsc --noEmit 2>&1 | grep -v validator.ts | grep "error TS"` (none).

- [ ] **Step 4: Commit**

```bash
git add lib/dashboard/growth.ts lib/admissions/insights.ts
git commit -m "refactor(insights): hoist growthDelta to lib/dashboard/growth (shared)"
```

---

## Task 2: Movement rollups (pure) + unit tests

**Files:** Create `lib/sis/records-insights.ts` (rollups only); Create `__tests__/sis/records-insights.test.ts`.

Aggregate `MovementEvent[]` into the Records Insights breakdowns: counts by kind, late-enrollees by level + by term, withdrawals by reason + by level. Pure so it's unit-testable.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/sis/records-insights.test.ts
import { describe, it, expect } from 'vitest';
import { rollupMovements } from '@/lib/sis/records-insights';

const ev = (over: Record<string, unknown>) => ({
  kind: 'withdrawn',
  studentNumber: 'S1',
  level: 'P1',
  termNumber: 1,
  termLabel: 'Term 1',
  reasonLabel: null,
  ...over,
});

describe('rollupMovements', () => {
  it('counts by kind, late by level/term, withdrawals by reason/level', () => {
    const events = [
      ev({ kind: 'withdrawn', level: 'P1', reasonLabel: 'Relocation' }),
      ev({ kind: 'withdrawn', level: 'P1', reasonLabel: 'Fees' }),
      ev({ kind: 'withdrawn', level: 'S1', reasonLabel: 'Relocation' }),
      ev({ kind: 'late-enrolled', level: 'P1', termNumber: 2 }),
      ev({ kind: 'late-enrolled', level: 'P2', termNumber: 2 }),
      ev({ kind: 'section-transfer', level: 'P1' }),
      ev({ kind: 're-enrolled', level: 'P3' }),
    ] as Parameters<typeof rollupMovements>[0];

    const out = rollupMovements(events);
    expect(out.counts).toEqual({
      withdrawn: 3,
      lateEnrolled: 2,
      transferred: 1,
      reEnrolled: 1,
    });
    // withdrawals by reason, desc
    expect(out.withdrawalsByReason[0]).toEqual({
      reason: 'Relocation',
      count: 2,
    });
    // late by term
    const t2 = out.lateByTerm.find((t) => t.termNumber === 2);
    expect(t2?.count).toBe(2);
    // late by level
    expect(out.lateByLevel.map((l) => l.level).sort()).toEqual(['P1', 'P2']);
    // withdrawals by level
    const p1 = out.withdrawalsByLevel.find((l) => l.level === 'P1');
    expect(p1?.count).toBe(2);
  });

  it('null/blank reason -> "Unspecified"; empty -> zeroed shape', () => {
    const out = rollupMovements([
      ev({ kind: 'withdrawn', reasonLabel: null, level: 'P1' }),
    ] as Parameters<typeof rollupMovements>[0]);
    expect(out.withdrawalsByReason[0]).toEqual({
      reason: 'Unspecified',
      count: 1,
    });
    const empty = rollupMovements([]);
    expect(empty.counts).toEqual({
      withdrawn: 0,
      lateEnrolled: 0,
      transferred: 0,
      reEnrolled: 0,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/sis/records-insights.test.ts`
Expected: FAIL — `rollupMovements` not exported.

- [ ] **Step 3: Implement the pure rollup**

Read `lib/sis/movements.ts` for the exact `MovementEvent` field names first, then:

```ts
// lib/sis/records-insights.ts  (rollups only; loaders in Task 3)
import 'server-only';
import type { MovementEvent } from '@/lib/sis/movements';

export type LabelCount = { reason: string; count: number };
export type LevelCountRow = { level: string; count: number };
export type TermCountRow = { termNumber: number; count: number };
export type MovementRollup = {
  counts: {
    withdrawn: number;
    lateEnrolled: number;
    transferred: number;
    reEnrolled: number;
  };
  withdrawalsByReason: LabelCount[];
  withdrawalsByLevel: LevelCountRow[];
  lateByLevel: LevelCountRow[];
  lateByTerm: TermCountRow[];
};

const UNSPECIFIED = 'Unspecified';
function bump<K>(m: Map<K, number>, k: K) {
  m.set(k, (m.get(k) ?? 0) + 1);
}
function sortedLabels(m: Map<string, number>): LabelCount[] {
  return [...m.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}
function sortedLevels(m: Map<string, number>): LevelCountRow[] {
  return [...m.entries()]
    .map(([level, count]) => ({ level, count }))
    .sort((a, b) => b.count - a.count || a.level.localeCompare(b.level));
}

export function rollupMovements(events: MovementEvent[]): MovementRollup {
  const counts = {
    withdrawn: 0,
    lateEnrolled: 0,
    transferred: 0,
    reEnrolled: 0,
  };
  const wReason = new Map<string, number>();
  const wLevel = new Map<string, number>();
  const lLevel = new Map<string, number>();
  const lTerm = new Map<number, number>();
  for (const e of events) {
    const level = (e.level ?? '').trim() || 'Unknown';
    if (e.kind === 'withdrawn') {
      counts.withdrawn += 1;
      const reason =
        ((e as { reasonLabel?: string | null }).reasonLabel ?? '').trim() ||
        UNSPECIFIED;
      bump(wReason, reason);
      bump(wLevel, level);
    } else if (e.kind === 'late-enrolled') {
      counts.lateEnrolled += 1;
      bump(lLevel, level);
      if (typeof e.termNumber === 'number') bump(lTerm, e.termNumber);
    } else if (e.kind === 'section-transfer') {
      counts.transferred += 1;
    } else if (e.kind === 're-enrolled') {
      counts.reEnrolled += 1;
    }
  }
  return {
    counts,
    withdrawalsByReason: sortedLabels(wReason),
    withdrawalsByLevel: sortedLevels(wLevel),
    lateByLevel: sortedLevels(lLevel),
    lateByTerm: [...lTerm.entries()]
      .map(([termNumber, count]) => ({ termNumber, count }))
      .sort((a, b) => a.termNumber - b.termNumber),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/sis/records-insights.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sis/records-insights.ts __tests__/sis/records-insights.test.ts
git commit -m "feat(records/insights): movement rollups (pure) + tests"
```

---

## Task 3: Retention + orchestration loaders

**Files:** Modify `lib/sis/records-insights.ts`.

- [ ] **Step 1: Add the enrolled-set + retention loaders**

Read how an AY's active enrolled students are queried (e.g. `section_students` joined `sections.academic_year_id` for the AY, `enrollment_status != 'withdrawn'`, → `students.student_number`). Implement:

```ts
// add to lib/sis/records-insights.ts
import { unstable_cache } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { growthDelta, type Growth } from '@/lib/dashboard/growth';

async function loadEnrolledStudentNumbers(
  ayCode: string
): Promise<Set<string>> {
  const service = createServiceClient();
  // Resolve the AY id, then active section_students -> student_number.
  const { data: ay } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  const ayId = (ay as { id: string } | null)?.id;
  if (!ayId) return new Set();
  const { data, error } = await service
    .from('section_students')
    .select(
      'student:students(student_number), section:sections!inner(academic_year_id)'
    )
    .eq('section.academic_year_id', ayId)
    .neq('enrollment_status', 'withdrawn');
  if (error || !data) return new Set();
  const out = new Set<string>();
  for (const r of data as {
    student:
      | { student_number: string | null }
      | { student_number: string | null }[]
      | null;
  }[]) {
    const s = Array.isArray(r.student) ? r.student[0] : r.student;
    if (s?.student_number) out.add(s.student_number);
  }
  return out;
}

export type Retention = {
  priorAy: string | null;
  returned: number;
  didNotReturn: number;
  priorTotal: number;
  pct: number | null;
};

/** Of priorAy's enrolled students, how many are also enrolled in currentAy. */
export async function getRecordsRetention(
  currentAy: string,
  priorAy: string | null
): Promise<Retention> {
  if (!priorAy) {
    return {
      priorAy: null,
      returned: 0,
      didNotReturn: 0,
      priorTotal: 0,
      pct: null,
    };
  }
  const [current, prior] = await Promise.all([
    loadEnrolledStudentNumbers(currentAy),
    loadEnrolledStudentNumbers(priorAy),
  ]);
  let returned = 0;
  for (const sn of prior) if (current.has(sn)) returned += 1;
  const priorTotal = prior.size;
  return {
    priorAy,
    returned,
    didNotReturn: priorTotal - returned,
    priorTotal,
    pct:
      priorTotal === 0 ? null : Math.round((returned / priorTotal) * 1000) / 10,
  };
}
```

Then add a thin `getRecordsHeadcount(ayCode)` (sum `getLevelDistribution(ayCode)` → total + keep the per-level array) and re-export `growthDelta` for the page. Cache the retention loader with `unstable_cache` tagged `sis:${currentAy}` (Records reuses the `sis:` tag per KD #46), 60s.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit 2>&1 | grep -v validator.ts | grep "error TS"` (none). If the `section_students`/`sections!inner` select shape errors, adjust to the real column names (read a working Records loader for the exact pattern).

- [ ] **Step 3: Commit**

```bash
git add lib/sis/records-insights.ts
git commit -m "feat(records/insights): cross-AY retention + headcount loaders"
```

---

## Task 4: Records Insights page

**Files:** Create `app/(records)/records/insights/page.tsx`.

Mirror `app/(admissions)/admissions/insights/page.tsx` structure (role gate `['registrar','school_admin','superadmin']`, `await searchParams`, `listAyCodes` newest-first → prior AY = `ayCodes[idx+1] ?? null`, `Promise.all`, `InsightsSection` wrappers, tokens only).

- [ ] **Step 1: Build the page** — sections (all `[now]` unless noted), wrapped in `<InsightsSection>`:

1. `DashboardHero` — eyebrow "Records · Insights", title "Retention & Population". Headline: current headcount + `growthDelta(currentHeadcount, priorHeadcount)`; `pct===null` → "building history".
2. **Student Population** — headcount by level (`getLevelDistribution`) as a bar; current vs previous-AY total.
3. **Student Movement** — `rollupMovements(getMovementEvents(ay))` `counts` as 4 stat tiles (New via `getEnrollmentVelocityRange` total or movement re-enrol/late, Withdrawals, Transfers, Re-enrollees) + an enrollment-vs-withdrawal `<TrendChart>` (`getEnrollmentVelocityRange` + `getWithdrawalVelocityRange`).
4. **Retention** — `getRecordsRetention(currentAy, priorAy)`: returned / did-not-return / retention %; if `priorAy===null` render `<BuildingHistoryCard label="Retention" />`.
5. **Late Enrollees** — `rollupMovements` `lateByLevel` + `lateByTerm` (two small bars/tables).
6. **Withdrawal Analysis** — `withdrawalsByReason` (donut, labels already humanized via `reasonLabel` from movements) + `withdrawalsByLevel` (bar); if no withdrawals, calm empty state. (Use `getMovementEvents(ay, { includeAllAYs: true })` only if you add a "by AY" cut; otherwise current-AY scope.)

Reuse only chart wrappers the admissions insights page already imports.

- [ ] **Step 2: Verify** — `npx tsc --noEmit ...` (none) + `npx next build` ("Compiled successfully").
- [ ] **Step 3: Manual (test AY)** — `/records/insights` as registrar: population/movement/late/withdrawal sections populate from seeded movements; retention shows real numbers if AY9998/prior exists else "building history".
- [ ] **Step 4: Commit**

```bash
git add "app/(records)/records/insights/page.tsx"
git commit -m "feat(records): Retention & Population insights page"
```

---

## Task 5: Redirect old compare + rename nav

**Files:** Modify `app/(records)/records/compare/page.tsx`; `lib/auth/roles.ts`.

- [ ] **Step 1: Redirect stub**

```tsx
// app/(records)/records/compare/page.tsx
import { redirect } from 'next/navigation';

// Records "Compare" replaced by the Retention & Population Insights surface
// (spec 2026-06-10-module-insights-design). Old links land on Insights.
export default function RecordsCompareRedirect() {
  redirect('/records/insights');
}
```

- [ ] **Step 2: Rename nav** — in `lib/auth/roles.ts` find the Records `{ href: '/records/compare', ... }` entry (~line 122) → href `/records/insights`, label `Insights`. Leave other modules untouched.
- [ ] **Step 3: Verify** — tsc + `npx next build`; manual: Records sidebar shows "Insights"; `/records/compare` redirects.
- [ ] **Step 4: Commit**

```bash
git add "app/(records)/records/compare/page.tsx" lib/auth/roles.ts
git commit -m "feat(records): retire Compare → Insights (redirect + nav)"
```

---

## Task 6: KD + index

**Files:** Modify `.claude/rules/key-decisions/records.md` (KD #141) + `.claude/rules/key-decisions.md` (index row + quick-lookup).

- [ ] **Step 1:** Append KD #141 to `records.md`: "Records Insights (Phase 2 of Module Insights, KD #140). `/records/insights` 'Retention & Population': headcount + growth, student movement (rollupMovements over getMovementEvents), cross-AY retention (`getRecordsRetention` — studentNumber set intersection priorAy∩currentAy), late-enrollees by level/term, withdrawal causes by reason/level. Synthesis in `lib/sis/records-insights.ts` reusing movements + dashboard loaders + `WITHDRAWAL_REASON_LABELS`; pure `rollupMovements` unit-tested. `growthDelta` hoisted to `lib/dashboard/growth.ts` (shared with Admissions). `/records/compare` redirects; nav Compare→Insights. Retention/growth show `BuildingHistoryCard` when no prior AY. No migration." Add the index row (records.md KD list + quick-lookup `141 records`).
- [ ] **Step 2: Commit**

```bash
git add .claude/rules/key-decisions/records.md .claude/rules/key-decisions.md
git commit -m "docs(kd): Records Insights — Phase 2"
```

---

## Self-review (against spec)

- Records spec sections — Student Population (Task 4.2), Student Movement (4.3), Retention (Task 3 + 4.4), Late Enrollees (4.5), Withdrawal Analysis (4.6) — all covered. ✓
- Reuse: only new logic is `rollupMovements` (unit-tested) + cross-AY retention; rest reuses movements + dashboard loaders + the shared skeleton. ✓
- Data honesty: retention/growth → `BuildingHistoryCard`/null-pct when no prior AY. ✓
- DRY: `growthDelta` shared (Task 1). ✓
- Types consistent: `MovementRollup`/`Retention`/`Growth` defined once, consumed in page. ✓

## Verification (whole feature)

- `npx tsc --noEmit` + `npx vitest run __tests__/sis/records-insights.test.ts __tests__/admissions/insights.test.ts` + `npx next build` green.
- `/records/insights` renders all `[now]` sections; `/records/compare` redirects; sidebar "Insights".
- Ship as branch `feat/records-insights` off `main`; `feature-dev:code-reviewer` pass (focus: retention set-query correctness, movement rollup, growthDelta move didn't break Admissions); merge + push.
