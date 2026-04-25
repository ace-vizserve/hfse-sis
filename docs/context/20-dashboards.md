# Dashboard Architecture (20)

> This file documents the dashboard layer added in Sprint 21 (all-module dashboard upgrade). The detailed design spec is at `docs/superpowers/specs/2026-04-24-comprehensive-dashboard-redesign.md`; this is the canonical reference for anyone TOUCHING a dashboard.

## The pattern in one page

Every module's dashboard landing page composes from **one** vocabulary:

**Shared primitives (`components/dashboard/`):**
- `dashboard-hero.tsx` — canonical hero pattern (§8 hero header)
- `comparison-toolbar.tsx` — AY + date range + comparison period picker
- `insights-panel.tsx` — 3–5 auto-generated narrative observations
- `action-list.tsx` — compact follow-up table
- `metric-card.tsx` — dashboard-01 SectionCards KPI with delta + sparkline
- `charts/trend-chart.tsx` — area chart with gradient fill + comparison overlay
- `charts/comparison-bar-chart.tsx` — grouped bar (vertical or horizontal)
- `charts/donut-chart.tsx` — donut + inline legend with progress bars
- `charts/sparkline-chart.tsx` — inline 40px area line

**Shared lib (`lib/dashboard/`):**
- `range.ts` — preset resolution + delta math + shared types (`RangeInput`, `RangeResult<T>`)
- `windows.ts` — server-side term + AY window resolver (uses service client to stay inside `unstable_cache`)
- `insights.ts` — 7 module-specific insight generators (pure, data-driven)

## URL-param contract

Every dashboard page parses the same query shape:

```
?ay=AY2026&from=YYYY-MM-DD&to=YYYY-MM-DD&cmpFrom=YYYY-MM-DD&cmpTo=YYYY-MM-DD
```

Malformed `from`/`to` → fall back to `thisTerm` preset (else last-30d). Missing `cmpFrom`/`cmpTo` → auto-computed prior period of equal length.

Module-specific secondary filters (`?level=P3`, `?status=pending`, `?term=1`) stack on top via URL params only — no dropdown UI.

## Library contract

Every `lib/<module>/dashboard.ts` file adds `*Range` sibling functions next to any AY-scoped existing functions:

```ts
export function getRevisionsOverTime(ayCode: string, weeks = 12): Promise<RevisionWeek[]>;                    // existing
export function getRevisionsOverTimeRange(input: RangeInput): Promise<RangeResult<RevisionWeek[]>>;          // added
```

Hoist `load*Uncached` at module scope (KD #46), wrap per-call with `unstable_cache` using cache key `['module', 'fn-name', ayCode, from, to, cmpFrom, cmpTo]` and tag = the existing per-AY tag.

## F-pattern row order

Every dashboard follows:
1. Hero + filters
2. InsightsPanel
3. 4 MetricCards (SectionCards grid)
4. Primary trend chart (wide)
5. Secondary trend or context
6. Breakdowns (donuts / horizontal bars)
7. Action lists + tables + deep-link Cards
8. Trust strip

Chart budget ≤ 8 per screen (sparklines inside MetricCards don't count).

## Comparison model

"Target" = **prior period of equal length** (auto-computed by `autoComparison()` in `lib/dashboard/range.ts`). No stored `kpi_targets` table. Delta chips on MetricCards read ±% / ±pp vs prior.

## Gotchas (Next 16 + React 19)

- `cookies()` inside `unstable_cache` is forbidden → `windows.ts::loadTermsUncached` uses `createServiceClient()`, never the cookie-scoped `createClient()`.
- Array mutation via `.sort()` inside JSX causes React 19 profiler "negative timestamp" warnings → hoist derived values above the return.
- `Promise.all(modules.map(async → out.push))` produces non-deterministic order → return from each mapped promise and index the result (see `getAuditActivityByModule` in `lib/sis/dashboard.ts`).
- Function props on `'use client'` chart components are not serializable → use enum string props (`yFormat: 'number' | 'percent' | 'days'`) instead of `yFormatter: (n) => string`.

## Full spec

See `docs/superpowers/specs/2026-04-24-comprehensive-dashboard-redesign.md` for per-module business questions, KPI formulas, wireframes, insight rules, and deviation notes.
