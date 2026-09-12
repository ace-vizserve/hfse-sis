# Dashboard Architecture (20)

> This file documents the dashboard layer added in Sprint 21 (all-module dashboard upgrade). The detailed design spec is at `docs/superpowers/specs/2026-04-24-comprehensive-dashboard-redesign.md`; this is the canonical reference for anyone TOUCHING a dashboard.

## The pattern in one page

Every module's dashboard landing page composes from **one** vocabulary:

**Shared primitives (`components/dashboard/`):**

- `dashboard-hero.tsx` — canonical hero pattern (§8 hero header)
- `comparison-toolbar.tsx` — AY + date range + comparison period picker
- `priority-panel.tsx` — top-of-fold "what to act on right now?" banner (operational archetype only — see Layout archetypes below)
- `insights-panel.tsx` — 3–5 auto-generated narrative observations
- `action-list.tsx` — compact follow-up table (analytical archetype "supplement" placement)
- `metric-card.tsx` — dashboard-01 SectionCards KPI with delta + sparkline
- `chart-legend-chip.tsx` — gradient pill for severity / category labels (use for chart-series legends; for table/grid cell tints use a bespoke `*LegendItem` swatch helper instead — see `09a-design-patterns.md` §10)
- `charts/trend-chart.tsx` — area chart with gradient fill + comparison overlay
- `charts/comparison-bar-chart.tsx` — grouped bar (vertical or horizontal)
- `charts/donut-chart.tsx` — donut + inline legend with progress bars
- `charts/sparkline-chart.tsx` — inline 40px area line

**Shared lib (`lib/dashboard/`):**

- `range.ts` — preset resolution + delta math + shared types (`RangeInput`, `RangeResult<T>`)
- `windows.ts` — server-side term + AY window resolver (uses service client to stay inside `unstable_cache`)
- `insights.ts` — 7 module-specific insight generators (pure, data-driven)
- `priority.ts` — `PriorityPayload` type for the PriorityPanel; per-module computers live next to `dashboard.ts` (e.g. `lib/p-files/dashboard.ts::getPFilesPriority`, `lib/admissions/priority.ts::getNewApplicationsPriority`)

**Cross-module lifecycle widget on `/sis`** (Sprint 27, 2026-04-27): `<LifecycleAggregateCard>` reads `lib/sis/process.ts::getLifecycleAggregate(ayCode)` and renders 8 per-blocker buckets:

| Bucket                             | Counts rows where…                                                                                                 | Severity |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------- |
| Awaiting fee payment               | `feeStatus !== 'Paid'` AND in active funnel (`Submitted`/`Ongoing Verification`/`Processing`)                      | warn     |
| Awaiting document revalidation     | any document slot is `'Rejected'` OR `'Expired'`                                                                   | bad      |
| Awaiting document validation (NEW) | any document slot is `'Uploaded'` (registrar action needed) — see KD #60 for the expiring vs non-expiring workflow | warn     |
| Awaiting assessment schedule       | `assessmentStatus='Pending'` AND `assessmentSchedule IS NULL`                                                      | info     |
| Awaiting contract signature        | `contractStatus IN ('Generated', 'Sent')`                                                                          | info     |
| Missing class assignment           | `applicationStatus='Enrolled'` AND `classSection IS NULL`                                                          | bad      |
| Ungated to enroll                  | all 5 prereq stages at terminal status, but `applicationStatus !== 'Enrolled'` (one click away)                    | good     |
| New applications                   | `applicationStatus='Submitted'` (also surfaced via the `<NewApplicationsPriority>` panel on `/admissions`)         | info     |

Each row is click-drillable in principle (drill API wiring deferred to a future iteration). Cache: 60s `unstable_cache`, tag `sis:${ayCode}` per KD #46.

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
export function getRevisionsOverTime(
  ayCode: string,
  weeks = 12
): Promise<RevisionWeek[]>; // existing
export function getRevisionsOverTimeRange(
  input: RangeInput
): Promise<RangeResult<RevisionWeek[]>>; // added
```

Hoist `load*Uncached` at module scope (KD #46), wrap per-call with `unstable_cache` using cache key `['module', 'fn-name', ayCode, from, to, cmpFrom, cmpTo]` and tag = the existing per-AY tag.

## Layout archetypes

Not every dashboard does the same job. The layout depends on what the user is trying to do when they arrive — **not** on what data the system happens to have. We classify each dashboard into one of three archetypes (Stephen Few taxonomy) and compose the top-of-fold accordingly.

| Archetype       | Primary user task                             | Top-of-fold answer                                            |
| --------------- | --------------------------------------------- | ------------------------------------------------------------- |
| **Operational** | "What do I owe / who needs action right now?" | A `PriorityPanel` headlining the single most important action |
| **Analytical**  | "Is the funnel / cohort healthy?"             | A 4-up `MetricCard` strip + `InsightsPanel`                   |
| **Hub**         | "What configuration surface do I need?"       | Admin nav cards. KPIs are _opt-in_ via `?view=audit`          |

### Module assignments

| Module                         | Archetype   | Notes                                                           |
| ------------------------------ | ----------- | --------------------------------------------------------------- |
| `/markbook` (registrar view)   | Operational | Lock-completion + change-request decision queue                 |
| `/markbook` (teacher view)     | Operational | Sheets needing entry + assigned-section chips                   |
| `/attendance`                  | Operational | Sections that haven't marked today + compassionate-quota alerts |
| `/p-files`                     | Operational | Documents expiring + missing for newly enrolled                 |
| `/records`                     | Analytical  | New enrolments / withdrawals / doc-expiry flow                  |
| `/admissions`                  | Analytical  | Funnel conversion + time-to-enroll                              |
| `/evaluation` (registrar view) | Analytical  | Submission velocity by section/term                             |
| `/evaluation` (teacher view)   | Operational | Writeups due in current term + assigned-section chips           |
| `/sis`                         | Hub         | Admin nav cards; audit metrics live behind `?view=audit`        |

### Composition per archetype

**Operational** (top-to-bottom):

1. `DashboardHero`
2. `PriorityPanel` (the headline answer — must fit in the first ~240px)
3. `ComparisonToolbar` (compact)
4. `MetricCard` strip — _secondary_, no sparklines (or omit entirely if PriorityPanel already covers the same metric)
5. Drill table (the work surface)
6. Charts (de-emphasized, below the fold)

**Analytical** (the original Sprint 21 F-pattern row order):

1. `DashboardHero` + `ComparisonToolbar`
2. `InsightsPanel`
3. 4 `MetricCard`s (SectionCards grid, with sparklines)
4. Primary trend chart (wide)
5. Secondary trend or context
6. Breakdowns (donuts / horizontal bars)
7. `ActionList` + tables + deep-link Cards
8. Trust strip

**Hub** (top-to-bottom):

1. `DashboardHero` + system-health strip (if relevant)
2. Admin nav cards (the navigation IS the page)
3. _(Optional)_ tabbed entry to KPIs / audit metrics via `?view=audit`

Chart budget ≤ 8 per screen for analytical; operational and hub typically use ≤ 3 charts.

### Role-aware composition

Where one URL serves both teachers and registrars (Markbook, Evaluation), the page RSC branches on role at SSR and renders different top-of-fold composition per role:

```ts
const sessionUser = await getSessionUser();
return sessionUser.role === 'teacher' ? <TeacherView /> : <RegistrarView />;
```

The two views live in `components/<module>/<module>-{teacher,registrar}-view.tsx`. The URL stays single — the user always lands at `/markbook`, never at a per-role route.

### Page-level role differentiation (KD #74)

Beyond the teacher/registrar split, four module dashboards differentiate operational roles from read-only oversight roles by gating only the _operational top-of-fold tiles_ (PriorityPanel, chase strip, ActionList, readiness card, etc.) without splitting into per-role views. The page RSC computes a single `isOperational` (or `isOfficer`) boolean and branches inline:

| Module        | Operational role(s)                         | Oversight role(s)                     | What gets gated                                                                                                                                                             |
| ------------- | ------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/p-files`    | `p-file`, `superadmin` (`isOfficer`)        | `school_admin`, `admin`               | `<PriorityPanel>` + `<DocumentChaseQueueStrip>` + bulk-notify; hero copy reframed for oversight                                                                             |
| `/records`    | `registrar` (`isOperational`)               | `school_admin`, `admin`, `superadmin` | `<DocumentChaseQueueStrip>` + "Documents to collect" `ActionList` + `<ClassAssignmentReadinessCard>`                                                                        |
| `/admissions` | `admissions`, `registrar` (`isOperational`) | `school_admin`, `admin`, `superadmin` | `<NewApplicationsPriority>` + chase strip + chase `<PriorityPanel>` + chaseInsights                                                                                         |
| `/sis`        | `superadmin` (full hub access)              | `admin`, `school_admin`               | Access + System nav sections (Approvers / School Config / Users / Settings) **hidden entirely** for non-superadmin instead of greyed-out; hero copy branches by access tier |

Oversight roles always keep the analytical surface (KPIs, charts, drill cards) — the gating subtracts the work-surface tiles only. This pattern is **not** the same as the teacher/registrar split above; it's an in-place subtraction at one URL, not a per-role view component. KD #57 archetype assignment is unchanged — the dashboard's archetype (operational / analytical / hub) reflects the operational role's task; the oversight roles see a degraded version.

### When to use which

- Default to **Analytical** for any new dashboard unless the user lands with a single concrete action
- Promote to **Operational** when the dashboard's first job is to surface "do this now" rather than "monitor this"
- Use **Hub** only when the page is genuinely a navigator (no aggregation; just routing into config surfaces)
- A dashboard CAN change archetype as the module matures; revisit during sync-docs passes

## Comparison model

"Target" = **prior period of equal length** (auto-computed by `autoComparison()` in `lib/dashboard/range.ts`). No stored `kpi_targets` table. Delta chips on MetricCards read ±% / ±pp vs prior.

## Gotchas (Next 16 + React 19)

- `cookies()` inside `unstable_cache` is forbidden → `windows.ts::loadTermsUncached` uses `createServiceClient()`, never the cookie-scoped `createClient()`.
- Array mutation via `.sort()` inside JSX causes React 19 profiler "negative timestamp" warnings → hoist derived values above the return.
- `Promise.all(modules.map(async → out.push))` produces non-deterministic order → return from each mapped promise and index the result (see `getAuditActivityByModule` in `lib/sis/dashboard.ts`).
- Function props on `'use client'` chart components are not serializable → use enum string props (`yFormat: 'number' | 'percent' | 'days'`) instead of `yFormatter: (n) => string`.

## CSV export

Every module dashboard (`/attendance`, `/markbook`, `/admissions`, `/records`, `/p-files`, `/evaluation`) and every Insights page (`/attendance/insights`, `/markbook/insights`, `/admissions/insights`, `/records/insights`) has an **Export CSV** button. Clicking it downloads one file with everything that page is showing that viewer, in the same order the page shows it — nothing more, nothing less. (Out of scope: the teacher-facing views of Markbook/Evaluation/Attendance, `/sis` and its sub-pages, and the "focused" filtered views like `/admissions?status=…` — those already have their own DataTable CSV.)

### What's in the file

- A few **scope lines** at the top — the page name, the academic year, the date range (dashboards) or the compared-against academic year (Insights), and `Exported`: the moment the download button was clicked (Singapore time), not when the page was generated.
- One **section per widget** the page renders for that viewer, in the order it appears on screen:
  - The KPI strip becomes one "Key figures" section (`Figure, This period, Previous period, Change`). `Change` is always the same number the KPI card's own delta chip already shows — never a value worked out by subtracting one column from the other.
  - Each chart becomes a table of the numbers it plots.
  - Each list/table card becomes its rows exactly as shown on the card (every tab of a tabbed card), not the larger dataset behind a drill-down sheet.

### Mirror the page — exactly

- A widget the page doesn't render for this viewer at all (hidden by role, or hidden because there's nothing to show) gets **no section** in the file.
- A widget that IS rendered but showing an empty state still gets a section — just with headers and zero rows, so the reader can tell the widget existed and had nothing in it.
- Numbers are rounded to whatever precision the widget shows on screen, which is usually coarser than the underlying data. A chart labelled "85%" exports `85`, never the raw `84.7` the loader fetched — check each widget's own formatter rather than assuming one decimal place everywhere.

### Where the code lives

- `components/dashboard/export-csv-button.tsx` — the button (`<ExportCsvButton>`, and `<ExportCsvButtonPending>` for a page whose export data is still loading). It is client-side only: it turns already-built data into a CSV string and triggers the download in the browser. It never fetches anything itself.
- `lib/export/dashboard-export.ts` — the shared shape (`DashboardExport`, `ExportSection`) plus small shared helpers (`kpiSection`, `roundTo`, `dashboardFilename`, `insightsFilename`).
- `lib/<module>/dashboard-export.ts` and `lib/<module>/insights-export.ts` — one plain, pure `build<Module>DashboardExport` / `build<Module>InsightsExport` function per page, turning values the page already loaded into a `DashboardExport`. No database calls, no clock reads — everything arrives as an argument, so the same input always produces the same file. (Records is the one exception to the file name: its builders live under `lib/sis/` — `records-dashboard-export.ts` / `records-insights-export.ts` — because that's where the rest of the Records module's server code already lives.)
- The page's own server component calls its builder and hands the result straight to `<ExportCsvButton data={...} />`. It never calls a data-loading function a second time just to feed the export — the builder only ever sees values the page has already fetched for rendering.

### Streamed pages share one promise

The Attendance dashboard streams its heaviest data (a large day-by-day scan) below the fold behind `<Suspense>`. Its Export CSV button needs that same data, so rather than run the scan twice, the page creates the scan's promise **once**, un-awaited, and hands that same promise to both the streamed section and to a small async server component that renders the button behind its own `<Suspense fallback={<ExportCsvButtonPending />}>`. Both places `await` it independently; the scan still runs exactly once per page load. Any future page that streams part of its data should follow this pattern rather than give the export its own copy of the loader.

### The coverage test

`__tests__/dashboard/export-csv-coverage.test.ts` reads the source of all ten pages in plain text and asserts each one renders `<ExportCsvButton` (or a wrapper component ending in `ExportButton`, to allow for the Attendance-style Suspense wrapper). It's a source-text guard, not a rendered-DOM check — its job is to stop a future dashboard or Insights page shipping without the button. Bringing a new page under the rule is one line: add its path to the test's `PAGES` list.

### What's deliberately left out

The file is figures, not prose or navigation. It never includes the narrative `InsightsPanel` sentences, `RecommendationCallout` text, the `PriorityPanel` headline, quick links, or "recent activity" feeds of audit events — none of that is a number a school admin would put in a spreadsheet. Student-level detail stays where it already lived: the existing drill-sheet downloads (e.g. the attendance register, the masterfile export). This file is the dashboard's own numbers, not a replacement for those.

## Full spec

See `docs/superpowers/specs/2026-04-24-comprehensive-dashboard-redesign.md` for per-module business questions, KPI formulas, wireframes, insight rules, and deviation notes.
