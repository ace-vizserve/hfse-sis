# Markbook Insights Implementation Plan (Phase 4 of Module Insights)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace `/markbook/compare` with `/markbook/insights` — an "Academic Performance" surface (performance trend, grade distribution, lagging subjects, grading throughput) — reusing the shared Insights skeleton (KD #140/#141/#142). Final module of Module Insights.

**Architecture:** Composition over existing data (like Attendance) — **no new synthesis lib**. The page assembles `lib/markbook/dashboard.ts` loaders (`getGradeDistribution`, `getChangeRequestSummary`, `getSheetLockProgressByTerm`, `getPublicationCoverage`, `getMarkbookKpisRange`, `getGradeEntryVelocityRange`) + `lib/markbook/compare.ts::getSubjectPerformanceTrend` (the per-term×subject avg, KD #115) + the shared `components/dashboard/insights/*` skeleton. Old `/markbook/compare` → redirect.

**Boundary (deliberate, mirrors the Admissions↔Records discipline):** **award tiers (Bronze/Silver/Gold) are NOT here** — that distribution already lives on Records → Academic Summary (KD #134). Markbook Insights owns _grading performance + throughput_ (its grade-entry domain); Academic Summary owns the _award/GA outcome_ view. No shared metric. P-Files/Evaluation untouched.

**Tech Stack:** Next.js 16 (RSC, async params, term-scoped + registrar+ per KD #57/#79), Supabase + `unstable_cache`, recharts wrappers (incl. `MultiSeriesTrendChart`, KD #115), Aurora Vault tokens. **Spec:** `docs/superpowers/specs/2026-06-10-module-insights-design.md` (Markbook). `[now]` builds from existing data; seasonal = `BuildingHistoryCard`.

---

## File structure

- **Create** `app/(markbook)/markbook/insights/page.tsx` — the Academic Performance page.
- **Modify** `app/(markbook)/markbook/compare/page.tsx` — redirect to `/markbook/insights`.
- **Modify** `lib/auth/roles.ts` — Markbook nav: the `/markbook/compare` entries (there are 3 role-variant copies, ~lines 555/591/617) → href `/markbook/insights`, label `Insights`.
- **Reuse (read for exact shapes; do NOT modify):** `lib/markbook/dashboard.ts` (`getGradeDistribution`, `getChangeRequestSummary`, `getSheetLockProgressByTerm`, `getPublicationCoverage`, `getMarkbookKpisRange`, `getGradeEntryVelocityRange`, `GRADE_BANDS`), `lib/markbook/compare.ts` (`getSubjectPerformanceTrend` — confirm its arg shape: AY(s) + terms; and its return series shape), `app/(markbook)/markbook/compare/page.tsx` (role gate `['registrar','school_admin','superadmin']` + how it builds the MultiSeriesTrendChart input), `app/(records)/records/insights/page.tsx` + `app/(attendance)/attendance/insights/page.tsx` (reference structure), `components/dashboard/charts/*` (`MultiSeriesTrendChart`, `TrendChart`, `DonutChart`/`ComparisonBarChart`), `components/dashboard/insights/{insights-section,building-history-card}.tsx`, `lib/dashboard/growth.ts`.

---

## Task 1: Markbook Insights page

**Files:** Create `app/(markbook)/markbook/insights/page.tsx`.

Mirror the Records/Attendance insights pages: role gate `['registrar','school_admin','superadmin']` (`getSessionUser` → redirect/notFound), `NoCurrentAyCard` fallback, `await searchParams`, `getDashboardWindows`+`resolveRange` (term-scoped, KD #79 — match how the markbook compare/dashboard builds range), `listAyCodes` newest-first → `priorAy = ayCodes[idx+1] ?? null`, single `Promise.all`, `<InsightsSection>` wrappers, tokens only, back-link CTA, footer trust strip.

- [ ] **Step 1: Build the page** — sections (all `[now]` except last), each `<InsightsSection>`:

1. `DashboardHero` — eyebrow "Markbook · Insights", title "Academic Performance", description. Headline: a school-wide standing metric from `getGradeDistribution` (e.g. % of grade entries in the top bands, or total graded) + a vs-prior-AY note via the prior AY's distribution if `priorAy` exists, else "Building history". (Keep it honest — if a clean single "performance %" isn't obvious from `GRADE_BANDS`, show "N grade entries · {top-band}% in top bands" and reserve the growth badge for null→building-history.)
2. **Performance trend** — `getSubjectPerformanceTrend` for `selectedAy` → `<MultiSeriesTrendChart>` (avg quarterly per examinable subject across terms). Mirror how `markbook/compare/page.tsx` builds this chart's props. Hide if no trend data.
3. **Grade distribution** — `getGradeDistribution` → `<ComparisonBarChart>`/bar of `GRADE_BANDS` spread.
4. **Subjects to watch** — derive from the latest term of `getSubjectPerformanceTrend`: sort subjects by avg ascending, show the lowest-performing few as a token-only bar list. Calm empty state if no data.
5. **Grading throughput** — `getChangeRequestSummary` (filed / pending / avg decision time) as stat tiles + `getSheetLockProgressByTerm` and `getPublicationCoverage` as compact per-term bars (lock readiness + publication coverage). Plus grade-entry velocity (`getGradeEntryVelocityRange` → small `<TrendChart>`) if useful.
6. **Seasonal** — `<BuildingHistoryCard label="Seasonal performance" detail="Term-over-term and year-over-year academic trends sharpen once more history is on record." />`.

Reuse only chart wrappers the existing insights/compare pages import. Do not invent chart components. Note: award/GA tiers are intentionally NOT shown (Academic Summary owns them) — do not add them.

- [ ] **Step 2: Verify** — `npx tsc --noEmit 2>&1 | grep -v validator.ts | grep "error TS"` (none); `npx next build` ("Compiled successfully").
- [ ] **Step 3: Manual (test AY)** — `/markbook/insights` as registrar: performance trend + grade distribution + subjects-to-watch + throughput populate from seeded grades; seasonal placeholder shows.
- [ ] **Step 4: Commit**

```bash
git add "app/(markbook)/markbook/insights/page.tsx"
git commit -m "feat(markbook): Academic Performance insights page"
```

---

## Task 2: Redirect old compare + rename nav

**Files:** Modify `app/(markbook)/markbook/compare/page.tsx`; `lib/auth/roles.ts`.

- [ ] **Step 1: Redirect stub**

```tsx
// app/(markbook)/markbook/compare/page.tsx
import { redirect } from 'next/navigation';

// Markbook "Compare" replaced by the Academic Performance Insights surface
// (spec 2026-06-10-module-insights-design). Old links land on Insights.
export default function MarkbookCompareRedirect() {
  redirect('/markbook/insights');
}
```

- [ ] **Step 2: Rename nav** — in `lib/auth/roles.ts` there are THREE `{ href: '/markbook/compare', label: 'Compare' }` entries (role-variant nav copies). Change ALL of them → href `/markbook/insights`, label `Insights`. Leave other modules untouched. (grep `'/markbook/compare'` to find all three.)
- [ ] **Step 3: Verify** — tsc + `npx next build`; manual: Markbook sidebar shows "Insights"; `/markbook/compare` redirects.
- [ ] **Step 4: Commit**

```bash
git add "app/(markbook)/markbook/compare/page.tsx" lib/auth/roles.ts
git commit -m "feat(markbook): retire Compare → Insights (redirect + nav)"
```

---

## Task 3: KD + index

**Files:** Modify `.claude/rules/key-decisions/markbook.md` (KD #143) + `.claude/rules/key-decisions.md` (index row + quick-lookup).

- [ ] **Step 1:** Append KD #143 to `markbook.md`: "Markbook Insights (Phase 4, final, of Module Insights, KD #140). `/markbook/insights` 'Academic Performance': performance trend (`getSubjectPerformanceTrend` → MultiSeriesTrendChart, KD #115), grade distribution (`getGradeDistribution`/`GRADE_BANDS`), subjects-to-watch (lowest latest-term avg), grading throughput (`getChangeRequestSummary` + `getSheetLockProgressByTerm` + `getPublicationCoverage` + grade-entry velocity). Pure composition of existing `lib/markbook/dashboard.ts` + `compare.ts` loaders — no new synthesis lib; shared `components/dashboard/insights/*` skeleton. **Boundary:** award/GA tiers are deliberately NOT here — Records → Academic Summary (KD #134) owns the award/outcome view; Markbook Insights owns grading performance + throughput (no shared metric, mirrors the Admissions↔Records split). `/markbook/compare` redirects; all 3 nav copies Compare→Insights. Registrar+ only (KD #57). Seasonal = `BuildingHistoryCard`. No migration. **Module Insights complete: Admissions/Records/Attendance/Markbook have Insights; P-Files/Evaluation do not (dashboard is their insight).**" Add the index row (markbook.md KD list + quick-lookup `143 markbook`).
- [ ] **Step 2: Commit**

```bash
git add .claude/rules/key-decisions/markbook.md .claude/rules/key-decisions.md
git commit -m "docs(kd): Markbook Insights — Phase 4 (Module Insights complete)"
```

---

## Self-review (against spec)

- Markbook spec sections — performance trend (1.2), grade distribution (1.3), subject performance / lagging (1.4), grading throughput (1.5), seasonal (1.6) — covered. Award distribution intentionally excluded (Academic Summary owns it; documented). ✓
- Reuse: no new data plumbing — composition + shared skeleton. ✓
- Data honesty: seasonal + prior-AY → `BuildingHistoryCard`/null. ✓
- Boundary: no overlap with Academic Summary (awards) or other modules. ✓

## Verification (whole feature)

- `npx tsc --noEmit` + `npx next build` green (no new unit tests — no new pure logic).
- `/markbook/insights` renders all `[now]` sections; `/markbook/compare` redirects; sidebar "Insights".
- Ship as branch `feat/markbook-insights` off `main`; `feature-dev:code-reviewer` pass (focus: role gate, all 3 nav copies renamed, getSubjectPerformanceTrend arg/return shape + MultiSeriesTrendChart props, no award duplication); merge + push.
