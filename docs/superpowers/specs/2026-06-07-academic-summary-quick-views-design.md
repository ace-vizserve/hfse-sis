# Academic Summary — hub + quick-view child routes

**Date:** 2026-06-07
**Status:** Design — awaiting approval
**Module:** Records (`/records/academic-summary`)
**Cross-refs:** KD #95 (awards), KD #122 (masterfile dashboard), KD #127 (Academic Summary relocation), KD #128 (client-side drills), KD #124 (count==drill), KD #111/#68 (late-enrollee term), KD #49/#120/#129 (FCA comments), KD #47 (attendance is per-class), KD #57/#74 (dashboard role split)

## Context

The Academic Summary (`/records/academic-summary`, the relocated Masterfile per KD #127) is the consolidated cross-module academic view — the modern replacement for opening HFSE's Masterfile spreadsheet. Today it's a single long-scroll dashboard with a Dashboard | Table toggle, where the Table view renders the raw wide masterfile grid.

Admins live in Records. They want **quick, focused lookups** — "who got Gold in English," "what's this level's attendance," "are the FCA comments in" — without bouncing into Markbook / Attendance / Evaluation, and without eyeballing a wide grid. The Masterfile spreadsheet earned its place precisely because it *consolidates* everything; the dashboard should inherit that role for daily monitoring, while the spreadsheet becomes an **export artifact you generate on demand**, not a screen.

## Goal

Turn Academic Summary into a **hub with dedicated, deep-linkable quick-view child routes** (Awards / Attendance / Comments), keep the existing dashboard as the hub landing, and demote the raw masterfile grid from an on-screen view to an export-only artifact ("Generate Masterfile").

## Non-goals / explicitly dropped

- **Promotion Rate** — promotion is the parent portal's responsibility, not this system; no promotion/retention data is modelled here. Not built.
- **Class Rankings** — ranking is unvalidated new behavior (HFSE may not rank). Not built. The dashboard keeps *performance* views (avg GA, subject performance) which compare without imposing a rank order.
- **The on-screen masterfile grid** — the Dashboard | Table toggle is removed. The grid is reachable only via Generate Masterfile (.xlsx / .csv).
- **EX/excused attendance breakdown** in the Attendance quick view — the masterfile rollup carries present/late/school-days only; EX lives in the Attendance module. Deferred.
- True multi-AY behavior changes — child pages honor the existing AY/Level/Class scoping; no new AY semantics.

## Information architecture

All four routes gated `registrar | school_admin | superadmin` (same trio Academic Summary already uses; explicit `ROUTE_ACCESS` entries, longer-prefix-wins). Child routes render a breadcrumb trail.

```
/records/academic-summary             ← hub (the dashboard)
/records/academic-summary/awards      ← Awards quick view
/records/academic-summary/attendance  ← Attendance quick view
/records/academic-summary/comments    ← Comments quick view
```

Breadcrumb on each child: `Records › Academic Summary › <Awards|Attendance|Comments>`.

## Engine — single source of truth

Every page (hub + 3 children) reads **one `loadMasterfile(ayCode, levelId, sectionId?)` payload** and the **shared predicates** already exported from `lib/markbook/masterfile-dashboard.ts` (`scopeRows`, `enrolledScopeRows`, `awardTierForRow`, `gaBandTierForRow`, `subjectsInScope`, `termIndicesInScope`, `studentMissingCommentTerms`, etc.). A child page's "awardees" is therefore the same set as the hub's award donut — count==drill discipline (KD #124) extended to routes. No new query patterns; no API route for the child views (client-side derivation over the in-browser payload, same as KD #128). Cache tag stays `markbook-drill:${ayCode}`.

### Loader extension — late-enrollee term

`MasterfileStudentRow` currently carries `enrollmentStatus` but not the joining term. Extend `loadMasterfile`:

- Select `late_enrollee_term_number` + `enrollment_date` from `section_students`.
- Resolve the joining term with the **override→date-derived** logic the Records placement section already uses (KD #111/#68): prefer `late_enrollee_term_number`; else derive from `enrollment_date` via `preloadTermsForAYs` + `termForDateInPreloaded`; else "between terms".
- Add `lateEnrolleeTermNumber: number | null` (resolved term number) to `MasterfileStudentRow`.

This powers "Late enrollee · T2" in the hub's Late-Enrollees card breakdown and in every child-table status badge.

## Hub — `/records/academic-summary`

The existing dashboard, reorganized into four sections + retained watchlists. No Dashboard|Table toggle. Existing AY / Level / Class toolbar stays; the client-side Term / Subject / Status refinement stays where it currently applies.

1. **Overview cards** — Total Students · Active · Withdrawn · **Late Enrollees** (with per-term breakdown, e.g. "T2: 2 · T3: 1") · Missing FCA Comments · Students with Incomplete Grades.
   - Total/Active/Withdrawn/Late are derived from the same `loadMasterfile` rows (not a separate enrollment query) so they cannot disagree with the rest of the page. (They overlap the Records dashboard's enrollment counts by design — this is the consolidated view.)
   - Missing Comments + Incomplete Grades are the existing readiness drills (retain their click→drill-sheet behavior).
2. **Academic Performance** — Grade Average distribution (existing GA spread) · Performance Bands (existing Overall Academic Award distribution) · Subject performance (existing). No Class Rankings.
3. **Quick Links** — three entry cards → Awards / Attendance / Comments child routes.
4. **Actions** — `[ Generate Masterfile ]` → .xlsx (existing export) / .csv (new).
5. **Watchlists (retained)** — "Still coming in" + "Standing out", placed after Academic Performance, unchanged (daily-monitoring value).

## Awards — `/records/academic-summary/awards`

Quick view of award recipients + per-term performance.

**Filters:** AY · Level · Class · **Subject** · **Term** · **Tier**.
- **Subject** selector: first option **"Overall Academic Award"**, then each examinable subject. This is the type switch — Overall = the cross-subject award (from GA); a subject = that subject's award (from its Subject Overall).
- **Term** controls *what you're viewing* (both award types are computed annually, so term cannot change *who wins* — it switches between final award and per-term performance):
  - **Full year (default):** the **official award**. Columns: student · class · status(+late term) · score (**GA 1dp** for Overall / **Subject Overall 2dp** for a subject) · **tier badge** (Gold/Silver/Bronze/Not eligible). Sorted best-first; **Tier** filter applies.
  - **T1–T4:** that term's **performance** (provisional, no official tier). Columns: student · class · status(+late term) · that-term grade — for a subject = `cells[termIndex].quarterly`; for Overall = the per-term average of examinable quarterly grades. Sorted best-first. A quiet note: *"Provisional — awards finalize once Term 4 grades are complete."* The Tier filter is hidden/inert in per-term mode (no official tier to filter).
- **Tier** filter (Full-year mode only): Gold / Silver / Bronze / Not eligible / All.

**Actions:** Export CSV · Export Excel · Print (this is the awards-ceremony list).

## Attendance — `/records/academic-summary/attendance`

Quick academic-attendance monitoring, sourced from the same masterfile rollup as the hub.

**Filters:** AY · Level · Class · Term.
**Table:** student · class · status(+late term) · Present · Late · Absent (derived = school-days − present − late) · **Rate %** · total school-days. Term filter scopes to that term's `attendanceByTerm` cell; "All" uses `attendanceTotal`. Sortable by rate.
**Actions:** Export CSV · Export Excel.

(EX/excused is not in the masterfile rollup — deferred; the Attendance module remains the place for the excused-reason breakdown + the daily register.)

## Comments — `/records/academic-summary/comments`

Monitor FCA write-up completion. **Read-only** — editing stays in Evaluation (KD #49).

**Filters:** AY · Level · Class · Term.
**Status set:** Submitted · Draft · Missing (resolved per student via `commentsByTerm` + the write-up submitted flag; roster-correct per KD #120; T4 excluded per KD #49).
**Table/list:** student · class · status(+late term) · adviser · write-up text (truncated, expandable).
**Actions:** Export CSV · **Open Evaluation Module** (deep-link to the relevant Evaluation section).

This is the registrar's pre-publish check — directly relevant to the KD #129 comment hard-gate ("are the comments in before I publish?").

## Generate Masterfile

A hub action (not a page). Produces HFSE's traditional Masterfile structure in **Excel (.xlsx)** (existing `GET /api/markbook/masterfile/export`, unchanged layout) + **CSV** (new, same data). Mirrors the hub's AY/Level/Class scope. The exported file preserves the exact HFSE Masterfile layout for existing workflows.

## Removed

- `components/markbook/masterfile-grid.tsx` on-screen rendering + the Dashboard|Table toggle (`?view=` param). The grid logic survives only as the export source. Old `/markbook/masterfile` redirect (KD #127) unchanged.

## Access control

Add explicit `ROUTE_ACCESS` entries for the three child routes = `registrar | school_admin | superadmin`. Records sidebar: keep "Academic Summary" as the entry; optionally add the three quick-views as sub-items (decide at implementation — quick links on the hub may suffice).

## Out of scope / deferred

- EX/excused attendance column (needs an Attendance-module query, not the masterfile rollup).
- True student/class ranking (unvalidated behavior).
- Per-view server-side pagination (payload is already in-browser per level/class; client tables suffice).
- Multi-level "whole school" rollup in one view (stay level-scoped per the existing loader contract).

## New KD (to record at sync-docs)

**KD #134 (proposed):** Academic Summary becomes a hub + 3 quick-view child routes (Awards/Attendance/Comments), masterfile demoted to export-only artifact, dropped Promotion Rate + Class Rankings as unmodelled/unvalidated. Engine: all pages reuse one `loadMasterfile` payload + shared predicates (count==drill). Loader extended with resolved late-enrollee term.

## Verification

- `npx tsc --noEmit` + `npx vitest run` + `npx next build` clean.
- Each child page's filtered list count matches the hub aggregate it derives from (count==drill) for: a current scope, a past AY, and a level with late enrollees (term badge renders).
- Awards Full-year vs per-term modes both render with realistic seeded data; pre-T4 shows the provisional note.
- Generate Masterfile .xlsx is byte-for-byte the current export; .csv carries the same rows.
- Manual happy-path per page in the browser before done (per workflow.md).
- Execute via subagent-driven development + a `feature-dev:code-reviewer` pass.
