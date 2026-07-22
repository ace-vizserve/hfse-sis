# Academic Summary → Module-Local Detail Pages — Design Spec

**Date:** 2026-07-22
**Status:** Draft for review
**Scope:** Relocate + redesign the three Records → Academic Summary "quick views" (Awards, Attendance, Comments) into their owning modules as standalone three-tier analytics pages. The masterfile **export** stays on Records.

---

## 1. Problem & motivation

The Records → Academic Summary hub (KD #127 / #134) carries three per-level "quick-view" detail tables — **Awards**, **Attendance**, **Comments** — each a `'use client'` component over a plain shadcn `<Table>`. Two issues:

1. **Wrong home.** Award tiers are a Markbook concern, per-student attendance is an Attendance concern, and FCA write-up comments are an Evaluation concern (KD #49). Housing all three under Records buries them away from the people who work each module.
2. **Under-built presentation.** Each quick-view is a bare filter-row + table. There's no at-a-glance summary and no analytics layer — it's a spreadsheet with dropdowns.

The masterfile itself (the consolidated cross-subject grid + the `.xlsx`/`.csv` export) is genuinely a Records artifact (the registrar generates the school-wide report book) and **stays on Records**.

## 2. Goal

Move each detail view to its owning module, rebuilt as a **three-tier analytics page** in this app's own design vocabulary (Aurora Vault tokens, `MetricCard`, our chart wrappers, the `<DataTable>` shell), reusing the existing masterfile data layer with **zero new data plumbing**. Records keeps the masterfile grid + export; the three old quick-view routes redirect to the new homes.

## 3. Architecture

### 3.1 Three standalone, matching pages

| View       | New home module | Route                  | Nav label            |
| ---------- | --------------- | ---------------------- | -------------------- |
| Awards     | Markbook        | `/markbook/awards`     | "Awards"             |
| Attendance | Attendance      | `/attendance/summary`  | "Attendance Summary" |
| Comments   | Evaluation      | `/evaluation/comments` | "Comments"           |

All three share one page **template** (three tiers, below) so they read as siblings. They are **standalone pages**, not tiers folded into existing dashboards.

**Why Attendance is its own page, not a tier of Attendance Insights:** Attendance Insights (`app/(attendance)/attendance/insights/page.tsx`) is whole-school, AY-scoped, with no class/section picker (its only control is `CompareAyPicker`). The Academic Summary attendance view is a **per-level student roster**. Folding a per-level roster table into a whole-school trends page is off-model and would force a scope picker onto Insights that changes its identity. `/attendance/summary` is the per-student roster detail; Attendance Insights stays exactly as-is (the over-time trends surface). Different jobs, no redundancy.

### 3.2 The three-tier template

Every page renders, top to bottom:

1. **Tier ① — Stat row.** 3–4 `MetricCard`s (`components/dashboard/metric-card.tsx`), computed from the row set. Gradient icon tiles per the design system (§7.4).
2. **Tier ② — Analytics.** 1–2 of our chart wrappers, each in a `Card` (mono `CardDescription` eyebrow + serif `CardTitle` + gradient icon tile in `CardAction` — the `InsightChartCard` idiom already used on the Insights pages), chosen to fit the data shape honestly.
3. **Tier ③ — Detail table.** The current quick-view table, rebuilt on the unified `<DataTable>` shell (`components/ui/data-table/index.tsx`, KD #84): sortable columns, facet filters, `StatusBadge`/domain badges, `IdentifierLink` students, built-in CSV export, URL-namespaced filter state.

### 3.3 Data reuse — no new plumbing

All three pages resolve scope and rows through the **existing** masterfile layer:

- **Scope:** `resolveAcademicSummaryScope(sp)` (`lib/markbook/academic-summary-scope.ts`) → `{ ayCode, ayCodes, levels, selectedLevelId, selectedSectionId, payload, empty, noAyRow }`. Reused verbatim on all three pages (already cross-module — the Records page in `(records)` imports it from `lib/markbook`). Cross-module import of a `lib/markbook` helper is acceptable: the masterfile is inherently cross-module (it reads grades, attendance, and FCA comments).
- **Scope picker:** `MasterfileToolbar` (`components/markbook/masterfile-toolbar.tsx`) — the AY × level × class `<Select>` trio. It navigates the **current** route via relative `?...` params + `router.refresh()`, so it works identically on any of the three new routes (resets `class` on level change, `level`+`class` on AY change). Reused verbatim.
- **Row builders (pure, no I/O):** from `lib/markbook/academic-summary-views.ts`:
  - `buildAwardsRows(payload, { subjectId, termNumber, tier })` → `AwardsRow[]`
  - `buildAttendanceRows(payload, { termNumber })` → `AttendanceRow[]`
  - `buildCommentRows(payload, { termNumber, status })` → `CommentRow[]`
  - Plus `subjectLabelToTier`, and `awardTierForRow` / `AwardTier` from `lib/markbook/masterfile-dashboard.ts`.

The `MasterfilePayload` (`lib/markbook/masterfile.ts`) is loaded once per page via `loadMasterfile` (service client, 60s `unstable_cache`, tag `markbook-drill:${ayCode}`). Tier ① and ② aggregates are computed **client-side or server-side from the same payload rows** the tier-③ table lists — so **count == what the table shows** by construction (KD #124 discipline).

### 3.4 Access & gating

Academic Summary is registrar / school_admin / superadmin today. The new pages keep that (these are cross-class **oversight** surfaces, not teacher entry surfaces):

- **`ROUTE_ACCESS`** (`lib/auth/roles.ts`): add an explicit `{ prefix, allowed: ['registrar','school_admin','superadmin'] }` row for each new route, placed **above** the broad module rule (longest-specific-first ordering; the exact pattern `/markbook/masterfile` already uses above `/markbook`):
  - `/markbook/awards` above `/markbook`
  - `/attendance/summary` above `/attendance`
  - `/evaluation/comments` above `/evaluation`
- **Nav items** carry `requiresRoles: ['registrar','school_admin','superadmin']` so teachers never see them.
- **Page-level guard** in each page RSC mirrors the module convention (redirect `/login` when no session; `notFound()` or `redirect('/')` when role not allowed) — same as the attendance insights page's `ALLOWED_ROLES` set / the evaluation section page's inline check. The route-group layouts already gate the module; these add the tighter per-page check.

### 3.5 Records changes

- **Hub stays:** `/records/academic-summary/page.tsx` keeps the `MasterfileToolbar` + `MasterfileView` grid + the **Generate Masterfile** export (`.xlsx` + `.csv` via `/api/markbook/masterfile/export`). Unchanged.
- **Child routes → redirect stubs:** `app/(records)/records/academic-summary/{awards,attendance,comments}/page.tsx` become query-preserving redirect stubs pointing to the new homes, forwarding `ay`/`level`/`class` (the exact pattern in `app/(markbook)/markbook/masterfile/page.tsx`). The old `ROUTE_ACCESS` prefix `/records/academic-summary` stays (role gate fires before redirect).
- **Records sidebar prune:** remove the three `academic-summary/{awards,attendance,comments}` sub-items from `RECORDS_NAV` (`lib/auth/roles.ts`) and their `iconByHref` entries (`lib/sidebar/registry.ts`). The hub item stays.
- The three old quick-view components (`components/markbook/academic-summary/{awards,attendance,comments}-view.tsx`) and `quick-view-header.tsx` are **deleted** (superseded by the new module pages). `loading.tsx` under the hub stays for the hub route.

## 4. Per-page detail

Shared row-field vocabulary (all three row types): `studentNumber`, `studentName`, `sectionName`, `status: 'Active'|'Late enrollee'|'Withdrawn'`, `lateTermNumber`, `indexNumber`.

### 4.1 Awards — `/markbook/awards`

**Data:** `buildAwardsRows(payload, { subjectId, termNumber, tier })`. `AwardsRow` = `{ …shared, score: number|null, tier: AwardTier|null }`. Full-year overall mode → `score = generalAverage`, `tier = awardTierForRow(row)`. Per-term mode → provisional score, `tier = null`.

**Tier ① stat row** (from the full-year overall row set):

- Gold count · Silver count · Bronze count · Not-eligible count (`awardTierForRow`).
  Icons: `Award` / `Medal` / `Trophy`-family (from lucide, already imported set). Each `MetricCard` shows the count; subtext = "of N students".

**Tier ② analytics:**

- **Award distribution `DonutChart`** — gold/silver/bronze/not-eligible is a genuine partition of the roster (correct donut fit). `centerValue = roster count`, `centerLabel = "Students"`. `DonutChart` renders its own full swatch+name+value+% legend.
- **Award tiers per class `GroupedBarChart`** — one grouped bar per section (`payload.sections`), bars = tier counts. Only when the level has ≥2 sections; otherwise omit (single-class levels add nothing). Fixed ≤5 hues (4 tiers fits).

**Tier ③ detail table** (`<DataTable>`, namespace `awards`):

- Columns: `#` (indexNumber) · Student (`IdentifierLink` → `/records/students/{studentNumber}`) · Class · Status (`EnrollmentStatusBadge`) · Score (right-aligned, dp: 0 per-term / 1 overall-full-year / 2 subject-full-year) · Award (tier badge, full-year only).
- Controls: subject facet (Overall + every `payload.subjects`), term facet (Full year + each term), tier facet (gold/silver/bronze/not-eligible — full-year only). These map to `buildAwardsRows` options; when `termNumber != null` the Award column + tier facet hide (provisional).
- CSV export (shell built-in). "Export Masterfile" is **not** repeated here — that lives on the Records hub.

### 4.2 Attendance Summary — `/attendance/summary`

**Data:** `buildAttendanceRows(payload, { termNumber })`. `AttendanceRow` = `{ …shared, present, late, absent, schoolDays, rate: number|null }`. `termNumber = null` → full-year totals; else the matching term cell.

**Tier ① stat row:**

- Avg attendance rate (mean of non-null `rate`, 1dp) · Students ≥95% · Students <85% (at-risk) · Total absences (sum of `absent`).

**Tier ② analytics:**

- **Rate-band `ComparisonBarChart`** — buckets ≥95 / 85–94 / <85, counts per bucket (independent counts → bars, not a partition-donut; honest fit). Horizontal.
- **Avg rate per class `ComparisonBarChart`** (horizontal, `{category: sectionName, current: avgRate}`) — only when ≥2 sections.

**Tier ③ detail table** (`<DataTable>`, namespace `attnsummary`):

- Columns: `#` · Student (`IdentifierLink` → `/attendance/students/{studentNumber}`) · Class · Status · Present · Late · Absent · Rate (color-banded: ≥95 mint / ≥85 amber / <85 destructive, via a token-based class helper) · School days.
- Control: term facet (Full year + each term).
- Footnote: "Excused (EX) days are tracked in the Attendance module." CSV export.

### 4.3 Comments — `/evaluation/comments`

**Data:** `buildCommentRows(payload, { termNumber, status })`. `CommentRow` = `{ …shared, termNumber, adviser, commentStatus: 'Submitted'|'Draft'|'Missing'|'N.A.', text }`. One row per (student × T1–T3 term); T4 excluded (KD #49). Status per KD #120/#148 (Missing only if enrolled that term, else N.A.).

**Tier ① stat row** (for the selected term, or all-terms aggregate):

- Submitted % · Submitted count · Draft count · Missing count. (Consistent with the evaluation dashboard's submission KPI — submitted requires non-empty content, KD #120.)

**Tier ② analytics:**

- **Completeness per section `GroupedBarChart`** — one group per section, bars = submitted / draft / missing counts (N.A. excluded — not a real gap). Genuinely diagnostic (which advisers are behind, KD #126 framing).

**Tier ③ detail table** (`<DataTable>`, namespace `comments`):

- Columns: `#` · Student (`IdentifierLink` → `/records/students/{studentNumber}`, late-term suffix) · Class · Term · Status (`StatusBadge` toned: Submitted healthy / Draft warning / Missing locked / N.A. muted) · Adviser · Comment (line-clamped, expandable, + "Open in Evaluation" deep-link → `/evaluation/sections/{sectionId}` resolved by section name→id from `payload.sections`).
- Controls: term facet (All / T1–T3) · status facet (Submitted / Draft / Missing / N.A.).
- Read-only (comments are authored in the write-up roster, KD #49). CSV export.

## 5. Files

**New pages** (each: RSC page + role guard + `resolveAcademicSummaryScope` + `MasterfileToolbar` + a `'use client'` view component rendering the three tiers):

- `app/(markbook)/markbook/awards/page.tsx` + `components/markbook/awards/awards-summary-view.tsx`
- `app/(attendance)/attendance/summary/page.tsx` + `components/attendance/summary/attendance-summary-view.tsx`
- `app/(evaluation)/evaluation/comments/page.tsx` + `components/evaluation/comments/comments-summary-view.tsx`

**Shared, reused verbatim:** `lib/markbook/academic-summary-scope.ts`, `lib/markbook/academic-summary-views.ts`, `lib/markbook/masterfile.ts`, `lib/markbook/masterfile-dashboard.ts`, `components/markbook/masterfile-toolbar.tsx`, `components/ui/data-table/*`, `components/dashboard/metric-card.tsx`, the chart wrappers (`donut-chart`, `comparison-bar-chart`, `grouped-bar-chart`), `IdentifierLink`, the status badges.

**Redirect stubs** (rewrite):

- `app/(records)/records/academic-summary/awards/page.tsx` → `/markbook/awards`
- `app/(records)/records/academic-summary/attendance/page.tsx` → `/attendance/summary`
- `app/(records)/records/academic-summary/comments/page.tsx` → `/evaluation/comments`

**Deleted:** `components/markbook/academic-summary/{awards-view,attendance-view,comments-view,quick-view-header}.tsx`.

**Edited (nav/access/icons):**

- `lib/auth/roles.ts` — add 3 `ROUTE_ACCESS` rows (above broad module rules); add "Awards" nav item to each Markbook per-role `NavSection[]` that should show it (registrar/school_admin/superadmin arrays); add "Comments" to `EVALUATION_NAV` (Write-ups group, `requiresRoles` registrar+); add "Attendance Summary" to the Attendance nav (registrar+); remove the 3 `academic-summary/*` sub-items from `RECORDS_NAV`.
- `lib/sidebar/registry.ts` — `iconByHref`: add `'/markbook/awards': Award`, `'/attendance/summary': CalendarCheck` (import if not already present), `'/evaluation/comments': MessageSquare` (Award/MessageSquare already imported for the records academic-summary entries — reuse); remove the 3 records academic-summary child entries.

## 6. Data-honesty notes

- **count == table** by construction — tier ① and ② aggregate the same rows tier ③ lists (KD #124).
- **Provisional awards:** per-term award score shows without a tier badge (only full-year overall yields an official tier, KD #95). The subject/term facets enforce this in the table; the donut/stat row only render tiers in full-year overall mode.
- **Comments N.A. vs Missing:** a term a student wasn't enrolled for is N.A., never counted as a gap (KD #148); the completeness bar excludes N.A.
- **T4 has no FCA comment** (KD #49) — Comments is T1–T3 only.
- **Full-payload load cost:** `/attendance/summary` and `/evaluation/comments` load the entire `MasterfilePayload` (all subjects/grades/comments) to render attendance/comment columns — identical to what the quick-views do today, so no regression. A leaner per-module loader is deferred (not v1).

## 7. Non-goals / out of scope

- No change to the masterfile `.xlsx`/`.csv` export or its route (`/api/markbook/masterfile/export`) — stays on the Records hub.
- No change to `loadMasterfile` / the `MasterfilePayload` shape / the pure `build*Rows` logic (reused as-is).
- No new DB columns, no migration.
- No leaner per-module data loader (deferred).
- Attendance Insights, the Evaluation dashboard, and the Markbook dashboard are untouched.

## 8. Verification

- `npx tsc --noEmit` clean.
- `npx vitest run` — no test-count regression; the pure `build*Rows` tests are unchanged (logic reused, not modified). Add render tests for the three new view components only if the existing quick-view tests covered rendering (match prior coverage, don't reduce it).
- `npx next build` clean — confirm RSC/client boundaries (chart wrappers are `.client.tsx` dynamic; view components are `'use client'`).
- Hard Rule #7 grep sweep on all new/edited files: no raw hex/oklch/slate/zinc/gray/bg-white/bg-black; gradient icon tiles use real tokens.
- Manual: each new route loads under the AY×level×class picker; the three old academic-summary child routes redirect with params preserved; teachers do not see the nav items and are gated by `ROUTE_ACCESS`.

## 9. Design/build note

This is a genuine redesign (not a lift-and-shift), so the actual page layout + component JSX will be authored under the **frontend-design** skill during implementation, producing a mockup of the canonical three-tier page (Awards) for visual sign-off before all three are built. The three pages share one template, so one approved mockup governs all three.
