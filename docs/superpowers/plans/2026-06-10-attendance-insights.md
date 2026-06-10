# Attendance Insights Implementation Plan (Phase 3 of Module Insights)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace `/attendance/compare` with `/attendance/insights` — an "Attendance Health" surface (rate trend, chronic absentees, absence causes, leave-quota risk) — reusing the shared Insights skeleton (KD #140/#141).

**Architecture:** Composition over existing data — Attendance's loaders are already rich, so (unlike Admissions/Records) there is **no new synthesis lib**: the page assembles `lib/attendance/dashboard.ts` loaders (`getAttendanceKpisRange`, `getDailyAttendanceRange`, `getExReasonMixRange`, `getTopAbsentRange`, the quota loader) + the shared `growthDelta` for rate YoY + the shared `components/dashboard/insights/*` skeleton. Old `/attendance/compare` → redirect. P-Files/Evaluation untouched; Markbook is Phase 4.

**Tech Stack:** Next.js 16 (RSC, async params, term-scoped + registrar+ only per KD #55), Supabase + `unstable_cache`, recharts wrappers, Aurora Vault tokens. **Spec:** `docs/superpowers/specs/2026-06-10-module-insights-design.md` (Attendance). `[now]` builds from existing data; the seasonal section is a `BuildingHistoryCard` placeholder.

---

## File structure

- **Create** `app/(attendance)/attendance/insights/page.tsx` — the Attendance Health page.
- **Modify** `app/(attendance)/attendance/compare/page.tsx` — redirect to `/attendance/insights`.
- **Modify** `lib/auth/roles.ts` — Attendance nav: the `/attendance/compare` entry (~line 215) → href `/attendance/insights`, label `Insights`.
- **Reuse (read for exact shapes; do NOT modify):** `lib/attendance/dashboard.ts` (`getAttendanceKpisRange`, `getDailyAttendanceRange`, `getExReasonMixRange`, `getTopAbsentRange`, the compassionate/vacation quota loader — find its exact name/return), `lib/attendance/drill.ts` (`TopAbsentRow`/quota row types), `lib/schemas/attendance.ts` (`EX_REASON_LABELS` — confirm exact export name for the MC/vacation/compassionate humanization), `app/(attendance)/attendance/compare/page.tsx` (role gate `['registrar','school_admin','superadmin']`), `app/(records)/records/insights/page.tsx` + `app/(admissions)/admissions/insights/page.tsx` (reference page structure), `lib/dashboard/growth.ts` (`growthDelta`), `components/dashboard/insights/{insights-section,building-history-card}.tsx`, `components/dashboard/charts/*`.

---

## Task 1: Attendance Insights page

**Files:** Create `app/(attendance)/attendance/insights/page.tsx`.

Mirror the Records/Admissions insights page exactly: role gate `['registrar','school_admin','superadmin']` (`getSessionUser` → redirect/notFound), `NoCurrentAyCard` fallback, `await searchParams`, `listAyCodes` newest-first → `priorAy = ayCodes[idx+1] ?? null`, `getDashboardWindows` + `resolveRange` (term-scoped default — attendance uses `'thisTerm'`/term presets per KD #79; check how the attendance dashboard/compare builds its range and match it), single `Promise.all`, `<InsightsSection>` wrappers, tokens only, back-link only CTA, footer trust strip.

- [ ] **Step 1: Build the page** — sections (all `[now]` except the last), each `<InsightsSection>`:

1. `DashboardHero` — eyebrow "Attendance · Insights", title "Attendance Health", description. Headline: current attendance rate (`getAttendanceKpisRange` → the rate %) + `growthDelta(currentRate, priorRate)` where priorRate = prior-AY rate (fetch `getAttendanceKpisRange` for the prior AY's full-year range if `priorAy` exists, else null → "building history"). Rate is a percentage, so present growth as percentage-points or just the rate vs prior; if computing pct-change is awkward, show "{rate}% vs {priorRate}% in {priorAy}" and reserve the growth badge for null→"building history".
2. **Rate trend** — `getDailyAttendanceRange` → `<TrendChart>` (% attended per day across the range). Description names the period.
3. **Chronic absentees** — `getTopAbsentRange(rangeInput, 10)` → a token-only ranked list/table (student name via `<IdentifierLink>` to `/attendance/students/[studentNumber]` per KD #81, absence count). Calm empty state if none.
4. **Why are they absent?** — `getExReasonMixRange` → `<DonutChart>` of the EX-reason mix (MC / vacation / compassionate, humanized via `EX_REASON_LABELS`); pair with the late-count from the KPIs as a small stat. This is the diagnostic.
5. **Leave-quota risk** — the compassionate + vacation over/near-quota rows (reuse the dashboard's quota loader) as two compact tables/counts; calm empty state if none over quota.
6. **Seasonal** — `<BuildingHistoryCard label="Seasonal attendance" detail="Term-by-term and year-over-year attendance patterns unlock once more history is on record." />`.

Reuse only chart wrappers the records/admissions insights pages already import (`TrendChart`, `DonutChart`, `MetricCard`, `IdentifierLink`). Do not invent chart components.

- [ ] **Step 2: Verify** — `npx tsc --noEmit 2>&1 | grep -v validator.ts | grep "error TS"` (none); `npx next build` ("Compiled successfully").
- [ ] **Step 3: Manual (test AY)** — `/attendance/insights` as registrar: rate trend + chronic-absentee list + EX-reason donut + quota tables populate from seeded data; seasonal shows the placeholder; rate-YoY shows "building history" if no prior AY.
- [ ] **Step 4: Commit**

```bash
git add "app/(attendance)/attendance/insights/page.tsx"
git commit -m "feat(attendance): Attendance Health insights page"
```

---

## Task 2: Redirect old compare + rename nav

**Files:** Modify `app/(attendance)/attendance/compare/page.tsx`; `lib/auth/roles.ts`.

- [ ] **Step 1: Redirect stub**

```tsx
// app/(attendance)/attendance/compare/page.tsx
import { redirect } from 'next/navigation';

// Attendance "Compare" replaced by the Attendance Health Insights surface
// (spec 2026-06-10-module-insights-design). Old links land on Insights.
export default function AttendanceCompareRedirect() {
  redirect('/attendance/insights');
}
```

- [ ] **Step 2: Rename nav** — in `lib/auth/roles.ts` find `{ href: '/attendance/compare', ... }` (~line 215) → href `/attendance/insights`, label `Insights`. Leave other modules untouched.
- [ ] **Step 3: Verify** — tsc + `npx next build`; manual: Attendance sidebar shows "Insights"; `/attendance/compare` redirects.
- [ ] **Step 4: Commit**

```bash
git add "app/(attendance)/attendance/compare/page.tsx" lib/auth/roles.ts
git commit -m "feat(attendance): retire Compare → Insights (redirect + nav)"
```

---

## Task 3: KD + index

**Files:** Modify `.claude/rules/key-decisions/attendance.md` (KD #142) + `.claude/rules/key-decisions.md` (index row + quick-lookup).

- [ ] **Step 1:** Append KD #142 to `attendance.md`: "Attendance Insights (Phase 3 of Module Insights, KD #140). `/attendance/insights` 'Attendance Health': rate trend (`getDailyAttendanceRange`) + rate YoY (`growthDelta`), chronic-absentee watchlist (`getTopAbsentRange`), absence causes (`getExReasonMixRange` — MC/vacation/compassionate via `EX_REASON_LABELS`), leave-quota risk (compassionate + vacation over-quota). Pure composition of existing `lib/attendance/dashboard.ts` loaders (no new synthesis lib); shared `components/dashboard/insights/*` skeleton + `lib/dashboard/growth.ts`. `/attendance/compare` redirects; nav Compare→Insights. Seasonal = `BuildingHistoryCard`. Registrar+ only (KD #55). No migration." Add the index row (attendance.md KD list + quick-lookup `142 attendance`).
- [ ] **Step 2: Commit**

```bash
git add .claude/rules/key-decisions/attendance.md .claude/rules/key-decisions.md
git commit -m "docs(kd): Attendance Insights — Phase 3"
```

---

## Self-review (against spec)

- Attendance spec sections — rate/absenteeism trend (1.2 + headline), chronic-absentee watchlist (1.3), absence causes / EX-reason mix (1.4), leave-quota risk (1.5), seasonal placeholder (1.6) — all covered. ✓
- Reuse: no new data plumbing — pure composition of existing loaders + shared skeleton. ✓
- Data honesty: seasonal + rate-YoY → `BuildingHistoryCard`/null when no prior AY. ✓
- Boundary: Attendance is its own purpose (presence), no overlap with Admissions/Records. ✓

## Verification (whole feature)

- `npx tsc --noEmit` + `npx next build` green (no new unit tests — no new pure logic; the reused loaders are already covered).
- `/attendance/insights` renders all `[now]` sections; `/attendance/compare` redirects; sidebar "Insights".
- Ship as branch `feat/attendance-insights` off `main`; `feature-dev:code-reviewer` pass (focus: role gate, range/term scoping matches the attendance dashboard, reused loader shapes, IdentifierLink destinations); merge + push.
