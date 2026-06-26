# Dashboard & Insights Storytelling Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all 6 module dashboards + 4 Insights pages read as a clear story — finding-stating titles, surfaced recommendations, declutter, F-pattern flow — every narrative line **derived from a live computed value with a neutral fallback**.

**Architecture:** A tiny shared layer (pure `narrative.ts` extreme/threshold helpers + one token-pure `RecommendationCallout` component) is built first. Then **Admissions Insights** is rebuilt as the template (pattern A + targeted-B chapter grouping) and **validated by the user in the browser** before the same pattern rolls across the other 9 surfaces, one task each. No DB/loader changes — we narrate data already computed.

**Tech Stack:** Next.js 16 RSC, TypeScript, recharts, Vitest+jsdom, Tailwind v4, design system 09/09a. Build phase uses the `frontend-design` + `ui-ux-pro-max` skills.

## Global Constraints

- **No DB schema changes / migrations. No new loaders or metrics.** Presentation/copy + light layout only. (Spec: Out of scope.)
- **Derived, never hardcoded.** Every finding-title + recommendation line is templated from the actual computed value at render time, with a tie/empty/threshold fallback to a neutral state. A title that can go stale or lie is a defect. (Spec: the non-negotiable.)
- **Design system 09/09a binding; semantic tokens only** (Hard Rule #7) — no raw hex/`slate-*`/`gray-*`/`oklch()`. Reuse existing primitives (`InsightsSection`, `MetricCard`, `DashboardHero`, `InsightsPanel`, `ActionList`, `ChartLegendChip`).
- **Two voices.** Dashboards = "what needs you today" (lede = top priority; to-dos read as directives). Insights = "trend → why → what to do" (lede = headline finding).
- **Copy:** plain English (school admins, not IT), active voice, name things by what the user controls (memory: plain-English UI copy).
- **Stacked on branch `feat/insights-comparison-readability`** — do not switch branches.
- **Invoke `frontend-design` before writing any JSX** (`.claude/rules/always-do-first.md`).
- Per-task: `npx tsc --noEmit` clean + relevant `vitest` green; **do NOT run `next build`** (controller runs it at the rollout boundary). Visual verification is the user's browser pass.

---

### Task 1: Shared narrative primitives

**Files:**

- Create: `lib/dashboard/narrative.ts`
- Create: `components/dashboard/insights/recommendation-callout.tsx`
- Test: `__tests__/dashboard/narrative.test.ts`

**Interfaces — Produces (later tasks consume these):**

- `pickExtreme<T>(items: T[], valueFn: (t: T) => number | null, dir: 'max' | 'min'): Extreme<T>` where `Extreme<T> = { item: T | null; value: number | null; isEmpty: boolean; isTie: boolean }`.
- `meetsThreshold(value: number | null, min: number): boolean`.
- `<RecommendationCallout tone="positive" | "watch" | "act">…</RecommendationCallout>` — one-line "what this means / do this" treatment.

- [ ] **Step 1: Write the failing test** — `__tests__/dashboard/narrative.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { pickExtreme, meetsThreshold } from '@/lib/dashboard/narrative';

describe('pickExtreme', () => {
  const rows = [
    { k: 'a', v: 3 },
    { k: 'b', v: 9 },
    { k: 'c', v: 1 },
  ];
  it('finds the max', () => {
    const r = pickExtreme(rows, (x) => x.v, 'max');
    expect(r.item?.k).toBe('b');
    expect(r.value).toBe(9);
    expect(r.isEmpty).toBe(false);
    expect(r.isTie).toBe(false);
  });
  it('finds the min', () => {
    expect(pickExtreme(rows, (x) => x.v, 'min').item?.k).toBe('c');
  });
  it('flags empty when no finite values', () => {
    const r = pickExtreme(
      [{ k: 'a', v: null }],
      (x) => x.v as number | null,
      'max'
    );
    expect(r.isEmpty).toBe(true);
    expect(r.item).toBeNull();
  });
  it('flags a tie at the extreme', () => {
    const r = pickExtreme(
      [
        { k: 'a', v: 5 },
        { k: 'b', v: 5 },
      ],
      (x) => x.v,
      'max'
    );
    expect(r.isTie).toBe(true);
  });
  it('skips null/NaN values', () => {
    const r = pickExtreme(
      [
        { k: 'a', v: null },
        { k: 'b', v: 4 },
      ],
      (x) => x.v as number | null,
      'max'
    );
    expect(r.item?.k).toBe('b');
  });
});

describe('meetsThreshold', () => {
  it('is false for null / below', () => {
    expect(meetsThreshold(null, 5)).toBe(false);
    expect(meetsThreshold(4, 5)).toBe(false);
  });
  it('is true at/above', () => {
    expect(meetsThreshold(5, 5)).toBe(true);
    expect(meetsThreshold(6, 5)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run __tests__/dashboard/narrative.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `lib/dashboard/narrative.ts`**

```ts
// Pure narrative helpers for the storytelling pass. No server-only imports —
// safe to import from client components + unit tests.

export type Extreme<T> = {
  /** The item holding the extreme finite value, or null when none exists. */
  item: T | null;
  value: number | null;
  /** No item had a finite value. */
  isEmpty: boolean;
  /** The top two items share the extreme value (don't claim a single "worst"). */
  isTie: boolean;
};

/** Pick the max/min item by a numeric accessor, skipping null/NaN, with
 *  empty + tie flags so callers can fall back to neutral copy. */
export function pickExtreme<T>(
  items: T[],
  valueFn: (t: T) => number | null,
  dir: 'max' | 'min'
): Extreme<T> {
  const scored = items
    .map((item) => ({ item, value: valueFn(item) }))
    .filter(
      (s): s is { item: T; value: number } =>
        s.value !== null && Number.isFinite(s.value)
    );
  if (scored.length === 0)
    return { item: null, value: null, isEmpty: true, isTie: false };
  scored.sort((a, b) =>
    dir === 'max' ? b.value - a.value : a.value - b.value
  );
  const top = scored[0];
  const isTie = scored.length > 1 && scored[1].value === top.value;
  return { item: top.item, value: top.value, isEmpty: false, isTie };
}

/** True only when value is finite and ≥ min — gate for rendering a claim. */
export function meetsThreshold(value: number | null, min: number): boolean {
  return value !== null && Number.isFinite(value) && value >= min;
}
```

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run __tests__/dashboard/narrative.test.ts` → PASS.

- [ ] **Step 5: Build `RecommendationCallout` (invoke `frontend-design` first).** Create `components/dashboard/insights/recommendation-callout.tsx` — a thin, token-pure one-liner that surfaces the "what this means / do this" sentence. Requirements:
  - Props: `{ tone: 'positive' | 'watch' | 'act'; icon?: LucideIcon; children: ReactNode; className?: string }`.
  - **Tone → §9.3 status palette (semantic tokens only):** `positive` mint, `watch` amber, `act` destructive — gradient wash + ring/border like the existing status recipes (mirror `components/dashboard/insights-panel.tsx` / `StatusBadge` tones). Icon **+** text (never colour-only — accessibility).
  - One line of emphasis text; visually distinct from a section description but quieter than a KPI. Reuse `cn` + existing tokens; no raw colours.
  - Keep it generic (both dashboards + insights use it).

- [ ] **Step 6: tsc + commit** — `npx tsc --noEmit` clean. Commit:

```bash
git add lib/dashboard/narrative.ts components/dashboard/insights/recommendation-callout.tsx __tests__/dashboard/narrative.test.ts
git commit -m "feat(storytelling): narrative extreme/threshold helpers + RecommendationCallout"
```

---

### Task 2: Admissions Insights — TEMPLATE (pattern A + targeted-B)

This task **establishes the pattern**; everything after copies it. Spend the design judgment here.

**Files:**

- Modify: `app/(admissions)/admissions/insights/page.tsx`
- (Consume) `lib/dashboard/narrative.ts`, `components/dashboard/insights/recommendation-callout.tsx` from Task 1.

**Already-computed values to narrate (derive titles/callouts from these — do NOT recompute, do NOT hardcode):**

- **Deep funnel:** `deepFunnel.stages` already carries `isBiggestLeak` + `dropOffPct` (`lib/admissions/insights-funnel.ts`). Title → _"Most applicants drop at {biggestLeak.stageLabel}"_ (fall back to a neutral _"Application pipeline"_ when no stage has a drop / tie / empty). Callout (`act`) → the drop-off %.
- **Conversion by level:** `conversionByLevel` → `pickExtreme(rows, r => r.conversionPct, 'min')` → worst-converting level. Callout when it meets a meaningful gap vs the overall rate; neutral otherwise.
- **Referral conversion:** `referralConversion` → best + worst converting source (`pickExtreme` max/min on `conversionPct`, min sample guard). Title states the channel finding.
- **Terminal reasons:** `terminal` → the top cancellation cause (already aggregated) → title/callout.
- **Lede:** conversion rate (`conversionPct`) + the biggest leak, in the `DashboardHero` subtitle / top section.

**Targeted-B (this surface only):** group the sections into three enclosed chapters — **"Demand & conversion"** (intake trend + headline + funnel), **"Who & why we lose"** (conversion-by-level + terminal reasons), **"Channels & segments"** (referral + enrolee-type). Use light enclosure (a labelled group wrapper / `InsightsSection` grouping), not new chart types.

- [ ] **Step 1: Invoke `frontend-design`** (mandatory before JSX). Re-read design system 09/09a §8/§9. State the page's story, then design the title voice, the `RecommendationCallout` placement, and the 3-chapter enclosure.
- [ ] **Step 2: Apply pattern A** — rewrite each section/chart title to its derived finding (using `pickExtreme`/`isBiggestLeak` + neutral fallbacks); add `RecommendationCallout` lines off the computed extremes; set the lede; declutter redundant labels.
- [ ] **Step 3: Apply targeted-B** — the 3-chapter enclosure grouping.
- [ ] **Step 4: Narrative-honesty self-check** — every finding-title/callout traces to a live computed value; each has a tie/empty/threshold neutral fallback; `grep` the page for hardcoded claim strings (stage names, "most", level codes in literals) → none.
- [ ] **Step 5: Verify** — `npx tsc --noEmit` clean; `npx vitest run __tests__/admissions __tests__/dashboard` green. (No `next build`.)
- [ ] **Step 6: Commit** — `git commit -m "feat(admissions/insights): storytelling pass — finding-titles, recommendation callouts, chapter grouping"`

---

### ⛔ USER-VALIDATION CHECKPOINT (after Task 2)

**Controller: STOP here.** Do not proceed to Task 3 until the user has reviewed Admissions Insights in the browser and locked the pattern (title voice, callout treatment, enclosure depth). Carry any adjustments back into Task 1's primitives / Task 2 before rolling out. The rollout tasks (3–11) inherit whatever the user approves here.

---

### Task 3: Records Insights — storytelling pass (pattern A)

**Files:** Modify `app/(records)/records/insights/page.tsx`. Consume Task 1 primitives + the locked Task 2 pattern.

**Narrate these already-computed values (derived, neutral fallback):**

- `rollup.controllability.topControllableTakeaway` (already a computed string) → the prescriptive lede/callout ("{reason} is your biggest fixable loss, concentrated in {level}").
- `retentionByLevel` → `pickExtreme(min retentionPct)` → worst-returning cohort title.
- reason×level matrix → finding-title naming the level with the most concentrated attrition.
- Lede: retention % + the top controllable loss.

- [ ] **Step 1:** Invoke `frontend-design`. **Step 2:** Apply the locked pattern (titles + callouts + lede + declutter; targeted-B only if a section genuinely needs reflow). **Step 3:** Narrative-honesty self-check (no hardcoded claims; fallbacks present). **Step 4:** `npx tsc --noEmit` + `npx vitest run __tests__/sis __tests__/dashboard` green. **Step 5:** Commit `feat(records/insights): storytelling pass`.

---

### Task 4: Attendance Insights — storytelling pass (pattern A)

**Files:** Modify `app/(attendance)/attendance/insights/page.tsx`. Consume Task 1 + locked pattern.

**Narrate (derived, neutral fallback):**

- Intervene/monitor split → lede/callout: _"{N} students need a truancy follow-up"_ (the intervene count; neutral when 0).
- `sectionAttendance` → `pickExtreme(min attendancePct)` → worst-attending section title.
- A/EX mix → finding-title (engagement vs health framing).
- Leave-quota risk → `act` callout when any over/approaching; neutral otherwise.
- Lede: attendance rate + the intervene count.

- [ ] **Step 1:** `frontend-design`. **Step 2:** Apply locked pattern. **Step 3:** Honesty self-check. **Step 4:** `npx tsc --noEmit` + `npx vitest run __tests__/attendance __tests__/dashboard` green. **Step 5:** Commit `feat(attendance/insights): storytelling pass`.

---

### Task 5: Markbook Insights — storytelling pass (pattern A)

**Files:** Modify `app/(markbook)/markbook/insights/page.tsx`. Consume Task 1 + locked pattern.

**Narrate (derived, neutral fallback):**

- `computeTermDelta(...)` is sorted biggest-regression-first → `[0]` → lede/title: _"{subject} ({level}) fell {Δ} over {n} terms"_ (neutral when no regression).
- subjects-to-watch (`getWatchRowsByLevel`) → worst subject×level title.
- failing-tail → `pickExtreme(max failingPct)` → worst-tail subject callout.
- Lede: the most-regressed / weakest subject.

- [ ] **Step 1:** `frontend-design`. **Step 2:** Apply locked pattern. **Step 3:** Honesty self-check. **Step 4:** `npx tsc --noEmit` + `npx vitest run __tests__/markbook __tests__/dashboard` green. **Step 5:** Commit `feat(markbook/insights): storytelling pass`.

---

### Tasks 6–11: The 6 dashboards — storytelling pass ("what needs you today" voice)

Each task modifies one dashboard page. Voice = **directive**: the lede is the top priority/number; the existing `PriorityPanel`/`ActionList`/chase-strip to-dos read as directives ("Lock 3 overdue sheets", not "3 sheets unlocked"). Derive every count/lede from the live priority loader the page already calls — never invent. `frontend-design` first; reuse `RecommendationCallout` for any "do this" line; targeted-B only if needed. Per task: tsc + the module's vitest dir + `__tests__/dashboard` green; commit `feat(<module>/dashboard): storytelling pass`.

- [ ] **Task 6 — Admissions dashboard.** `app/(admissions)/admissions/page.tsx`. Lede: new applications to action + chase count (PriorityPanel). Honesty self-check + verify (`__tests__/admissions`).
- [ ] **Task 7 — Records dashboard.** `app/(records)/records/page.tsx`. Lede: unsynced enrolled + docs-to-collect (chase strip / ActionList). Verify (`__tests__/sis`).
- [ ] **Task 8 — Attendance dashboard.** `app/(attendance)/attendance/page.tsx`. Lede: today's unencoded sections / gaps. Verify (`__tests__/attendance`).
- [ ] **Task 9 — Markbook dashboard.** `app/(markbook)/markbook/page.tsx`. Lede: pending change-requests + unlocked overdue sheets. Verify (`__tests__/markbook`).
- [ ] **Task 10 — P-Files dashboard.** `app/(p-files)/p-files/page.tsx`. Lede: documents expiring / needing renewal (chase queue). Verify (`__tests__/p-files` if present, else `__tests__/dashboard`).
- [ ] **Task 11 — Evaluation dashboard.** `app/(evaluation)/evaluation/page.tsx`. Lede: outstanding write-ups + advisers behind. Verify (`__tests__/evaluation` if present, else `__tests__/dashboard`).

---

## Rollout boundary

After Task 11: controller runs `npx next build` + full `npx vitest run`; a consolidated storytelling review (narrative-honesty across all 10 surfaces — every claim derived, fallbacks present, tokens clean); then `finishing-a-development-branch`.

## Self-Review (plan vs spec)

- **Spec coverage:** pattern (T2–T11) ✓; two voices (insights T2–5 / dashboards T6–11) ✓; derived-not-hardcoded guard (every page task Step "honesty self-check" + T1 helpers) ✓; targeted-B (T2 + per-task "only if needed") ✓; 10 surfaces ✓; template-first + user checkpoint ✓; primitives-first ✓; no DB/loader changes (Global Constraints) ✓; design-system grounding ✓.
- **Placeholder scan:** page tasks are intentionally design-briefs (frontend-design owns JSX) with exact derived-value sources — not mechanical-code placeholders. Task 1 (the only pure-logic task) carries complete code + tests.
- **Type consistency:** `pickExtreme`/`meetsThreshold`/`Extreme<T>`/`RecommendationCallout` props are used consistently across T2–T11.
