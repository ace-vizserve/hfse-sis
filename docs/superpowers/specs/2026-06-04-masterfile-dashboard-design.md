# Masterfile Dashboard — design (status → outcomes → action)

## Context & purpose

The on-screen masterfile (`/markbook/masterfile`) currently mirrors the spreadsheet as a flat ~135-column grid — which is redundant now that the **Excel export already produces that exact masterfile sheet**. This redesign replaces the on-screen grid with a **narrative dashboard** that tells the _current status of the masterfile_ for the selected level/class, while the **Excel export stays the exact masterfile spreadsheet** (unchanged). One page serves admins, registrars, and teachers; the filter changes the emphasis rather than the page.

Out of scope (explicitly dropped): the per-student "report book / progress report" idea (already covered by the Records student page + report card). No schema change, no new audit logging, no change to the export.

## The story (one scrollable narrative, top → bottom)

**Act 1 — Readiness / completeness (the "current status" headline).** The masterfile is compiled all year; lead with how done + healthy it is for the selected scope:

- **Grades entered** — filled grade cells vs expected (roster × examinable+non-exam subjects × terms in scope).
- **Sheets locked** — locked vs total grading sheets.
- **Comments written** — FCA write-ups with content vs roster (T1–T3, KD #49/#120).
- **Attendance recorded** — student×term rollups present vs expected.
- **Gradable students** — count with complete-enough examinable data to receive an award/GA vs "pending."
  Reuse the existing publish-readiness completeness logic where possible (KD #28/#75) rather than re-deriving.

**Act 2 — Outcomes (what the data says).** Computed from `loadMasterfile` rows; anything incomplete renders honestly as **"pending,"** never a fake number:

- **Award distribution** — Overall Academic Award tiers (Gold/Silver/Bronze/Not eligible).
- **General Average spread** — distribution against the award bands (school_config cutoffs).
- **Subject performance** — class average per examinable subject (lagging subjects surface).
- **Attendance health** — present/late/absent rate for the scope.

**Act 3 — Action (two watchlists, deep-linked).**

- **Needs data** — missing grades / unlocked sheets / missing comments, grouped by subject/teacher (chase list).
- **Needs attention** — low GA, an IP/failing subject, or low attendance (student follow-up → links to the Records student page).

## Roles (one page, filter drives emphasis)

- **Teacher** → filter to their class/subject: are my grades in + locked, how's my subject doing.
- **Registrar** → whole level/class: completeness + chase + export.
- **Admin** → outcomes oversight.

## Filters & views

- **Filters:** Level, Class (existing `?level=&class=`) + **Term** (All / T1–T4) + **Subject** + **Status** (active / late-enrollee / withdrawn). URL-param driven (KD #54 contract style), namespaced if a DataTable is used (KD #84).
- **Primary view = the dashboard** (scrollable narrative). Keep the **Export to Excel** button (full masterfile sheet). Optional **"Table" toggle** to the existing grid for anyone who still wants raw rows on screen (low-cost; can defer).

## Components & data

- **Page** `app/(markbook)/markbook/masterfile/page.tsx` (RSC) — same auth/scope (registrar | school_admin | superadmin, KD #95); loads masterfile data + readiness aggregates; passes to the dashboard.
- **Loader** — extend `lib/markbook/masterfile.ts` (or a sibling `lib/markbook/masterfile-dashboard.ts`) to also return **cohort aggregates** (readiness counts, award tier counts, GA buckets, per-subject averages, attendance rates, watchlist rows). It already pulls roster + subjects + terms + grade entries + attendance + comments; add `grading_sheets.is_locked` for the lock count. Pure aggregation over the existing rows — no new query patterns.
- **UI** — new `components/markbook/masterfile-dashboard.tsx` composed from existing dashboard primitives: `MetricCard`, donut/bar/`MultiSeries` chart wrappers (`components/dashboard/charts/*`, `next/dynamic` per KD #80), `InsightsPanel`/`ActionList` for the watchlists. Tokens only (HFSE palette). Reuse `lib/compute/awards.ts` + `annual.ts` values already on the rows.
- Honest empty/pending states; ≤ ~6 charts (KD #54 budget).

## What's kept / removed

- Kept: `?level=&class=` filter, the Excel export (`/api/markbook/masterfile/export`) + button, the masterfile loader.
- Removed (on screen): the flat grid as the primary surface (the export covers raw rows; optional table toggle).
- The Teacher's Comments column work + the export stay (already shipped).

## Verification

- `npx tsc --noEmit` + `npx next build` clean; unit-test the cohort-aggregate helper (readiness counts, award buckets, subject averages, watchlist thresholds) with a small fixture.
- Manual: for a level/class, Act 1 readiness numbers match reality (enter a grade → count moves); incomplete data shows "pending" not fake awards; award/GA/subject/attendance charts match the export's rows; watchlists link out; filters (term/subject/status) refine all sections; Excel export unchanged.
- Execute via subagent-driven development + a `feature-dev:code-reviewer` pass (per saved preference).
