# Section-list surfaces → unified DataTable + row-actions

**Date:** 2026-06-08
**Status:** Shipped (2026-06-08) — KD #84 update. All three lists tabled; Generate-index in the Markbook row-actions (registrar+).
**Modules:** SIS Admin, Markbook, Attendance (Evaluation already a table — the reference)
**Cross-refs:** KD #84 (unified `<DataTable>` shell + RowActionsMenu), KD #136 (Generate-index), KD #106 (evaluation sections list = the reference table), KD #55 (attendance sections picker), KD #3 (teacher_assignments)

## Context / problem

Three of the four "sections list" surfaces are bespoke **pill/card grids** grouped by level; only `/evaluation/sections` is a `<DataTable>` (KD #84/#106). Two gaps:

1. **Inconsistent UI** — three pill grids vs one table; no sort/search/CSV on the pill grids.
2. **Generate-index is only reachable from `/sis/sections`** — the registrar has no SIS module tile, so generating index numbers means a cross-link trip into SIS Admin. It should be reachable where the registrar already sees sections (**Markbook**).

**Decision (lean conversion):** convert the three pill grids to `<DataTable>` mirroring the Evaluation list, keeping their **current columns/data (no new queries)**, and add a `⋯` **row-actions menu** per row — which is where Generate-index lands (registrar-gated). The richer per-module columns that need new queries (adviser, Markbook sheet-status, Attendance today-marked) are **out of scope** (dashboards already cover analytics; can add later).

## Design

### Shared approach
Each list page keeps its **existing server loader unchanged** (same data) and passes rows to a new `'use client'` list component that renders `<DataTable>` (mirror `components/evaluation/sections-list.tsx`): **Level facet**, **search** (name/level), **CSV**, **sortable headers**, **URL state with a `namespace`** (avoid the phantom-facet footgun, KD #84). Section name = `IdentifierLink` to the module's per-section page. Add an **`actions` column** (`enableSorting:false, enableHiding:false`) rendering a per-module `<RowActionsMenu>` (`components/ui/data-table/row-actions-menu.tsx`). The page passes `role` so the client gates registrar-only actions.

### Per-surface columns + row-actions

| Surface | Columns (current data) | Row-actions (`⋯`) | Name links to |
|---|---|---|---|
| **`/sis/sections`** | Section · Level · Active · Withdrawn | **Generate index** · Generate sheets · Open roster | `/sis/sections/[id]` |
| **`/markbook/sections`** | Section · Level · Students (active) | **Generate index** \* · Generate sheets \* · Open grading | `/markbook/sections/[id]` |
| **`/attendance/sections`** | Section · Level · Active | Open daily / Mark today | `/attendance/[id]?date=<today>` |
| **`/evaluation/sections`** | *(unchanged — reference)* | — | — |

`*` = **registrar/school_admin/superadmin only** (hidden for teachers, who can view `/markbook/sections` + `/attendance/sections` but must not renumber or bulk-create). Gate in the row-actions component on the page-passed `role`.

- **SIS** keeps its header **"Generate all"** bulk button (move into the DataTable `toolbarTrailing` slot) + the existing role gate (registrar+ for the whole page).
- **Markbook** page stays teacher-viewable; the registrar-only actions appear only for registrar+. "Open grading" links to the section's grading view for everyone.
- **Attendance** keeps the form-adviser scoping (teachers see only their sections); row-action = open the daily writer for today.

### Reused components
- `<DataTable>` + `RowActionsMenu` + `SortableHeader` + `IdentifierLink` + `EnrollmentStatusBadge`/`StatusBadge` (KD #84) — all exist.
- `GenerateSheetsDialog` — already accepts a custom `children` trigger (drop in a `<DropdownMenuItem>`), `scope: { kind:'section', sectionId, sectionLabel }`.
- **`GenerateIndexButton` refactor:** extract its confirm `AlertDialog` into a **controlled `<GenerateIndexDialog open onOpenChange sectionId sectionName termStarted />`** (the row-actions component owns the open-state + renders the dialog *outside* the menu, per the RowActionsMenu pattern). The existing standalone `GenerateIndexButton` + `GenerateAllIndexButton` are refactored to use that same dialog so behavior (POST `/api/sections/[id]/generate-index`, toast, `router.refresh()`, term-started warning) is unchanged + single-sourced.
- A small per-module `SectionRowActions` client component each (SIS / Markbook / Attendance) — holds the menu items + the dialogs (Generate-index, Generate-sheets) it triggers, gated by `role` + `termStarted`.

### Data / loaders
No new queries. Each page's existing select (section + level + `section_students` counts; SIS/Attendance also load terms for `termStarted`) is reshaped into a flat `SectionRow[]` for the table. `termStarted` (earliest term start ≤ `sgToday()`) is computed once on the page (SIS + Markbook already need it for Generate-index; Attendance only needs it if it gets Generate-index — it doesn't, so skip there).

## Non-goals
- No new analytic columns (adviser / sheet-status / today-marked) — deferred (need new queries; dashboards cover analytics).
- No changes to `/evaluation/sections` (already a table) beyond optional styling parity.
- No changes to the per-section `[id]` roster pages, the Generate-index RPC/route, or the section_students data model.
- The Records "Section setup → /sis/sections" cross-link stays (harmless; SIS still owns section config) — Markbook is now the primary path for Generate-index, but the cross-link is a fine secondary.

## Verification
- `npx tsc --noEmit` + `npx vitest run` + `npx next build` clean.
- Each converted list renders as a table with sort / Level facet / search / CSV; level grouping preserved via the facet + default sort (pedagogical/level order then name).
- **Markbook (as registrar):** `⋯` → Generate index → confirm → numbers regenerate (no SIS trip); Generate sheets works; "Open grading" navigates. **As teacher:** only "Open grading" shows — no Generate index/sheets.
- **SIS:** `⋯` Generate index / Generate sheets / Open roster all work; "Generate all" in the toolbar works; term-started warning fires mid-year.
- **Attendance:** teachers see only their sections; row-action opens the daily writer for today.
- Build via subagent-driven development + a `feature-dev:code-reviewer` pass.
