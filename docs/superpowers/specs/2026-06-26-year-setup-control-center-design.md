# Year Setup Control Center — design

**Date:** 2026-06-26
**Status:** Approved (design); pending implementation plan
**Scope:** Restructure `/sis/ay-setup` into a single Year Setup control center that shows the setup status of a selected academic year and lets the cheap config be edited inline, with deep-links for the heavy/cross-module config.

---

## Problem

Academic-year setup is scattered. There is no single page to see "is this year set up?" and configure it. Today:

- **`/sis/ay-setup`** opens straight onto a _table of AY rows_ + a static "rollover checklist" card. It only really covers the AY row itself + term dates (+ an accepting-applications toggle bolted onto each row).
- **The actual "is my year ready?" status** lives only in a small floating **readiness pill** (bottom-right, school_admin/superadmin only) that checks 4 steps and links out.
- **Real configuration spans four route modules**: `/sis/ay-setup`, `/sis/calendar`, `/sis/sections`, `/markbook/sections` (Grading Sheets — in Markbook), `/sis/admin/template`, `/sis/admin/subjects`, `/evaluation/virtue-themes` (Virtue themes — in Evaluation), `/sis/admin/school-config`. The code even acknowledges the seams ("virtue themes are set elsewhere"; "go to Class Template to populate sections").

So a status engine already exists (`lib/sis/readiness.ts`) — it's just trapped in a pill and covers only 4 of the ~8 things that make a year "ready."

## Goal

One **control center** at `/sis/ay-setup` that, for a chosen AY:

1. shows every setup step's status at a glance, and
2. lets the genuinely-cheap config be edited inline, with one-click deep-links for the rest.

This is a **consolidation + surfacing** change. It does **not** change any setup behavior, rollover flow, or the readiness computation itself.

---

## Design

### Route & page structure

`/sis/ay-setup`, restructured into two tabs (shadcn `Tabs`, default = first tab):

- **Tab 1 · "Year Setup"** — the new control center. The default landing.
- **Tab 2 · "Manage years"** — the _existing_ `AySetupDataTable` verbatim (create AY / switch active / delete / copy teacher assignments / per-row dates + accepting-applications). **No behavior change** — it just moves under a tab so it's not the first thing you see. Year _lifecycle_ is a different job from configuring one year.

**Role gate:** unchanged — **school_admin + superadmin** (matches today's page redirect and the readiness pill's in-component gate). Registrar continues to redirect to `/sis`. (Registrar-edited config like virtue themes and term dates remains reachable from its own surfaces; widening this page's gate is out of scope.)

### AY picker

- A select of all academic years at the top of the control center, **defaulting to the current/active AY**.
- Driven by a `?ay=` searchParam so the page is **server-rendered per selection** (the readiness engine and all loaders already take an `ayCode`).
- A status badge next to the picker: **Active / Inactive / Early-bird open**.

### Tier 1 — Core readiness

Each item carries a **live status chip** (✓ done / ⚠ partial / — not started) sourced from `getAyReadiness(selectedAy)` (the existing 4-step engine, unchanged):

1. **Terms & dates** — start/end + grading-lock per term. **Inline edit** via the existing `TermDatesEditor` dialog (already per-AY).
2. **School calendar** — school days per term. **Deep-link** → `/sis/calendar`.
3. **Sections & advisers** — sections exist + form advisers assigned. **Deep-link** → `/sis/sections`.
4. **Grading sheets** — sheets created per section (shows the `N/M sections` fraction the engine already returns). **Deep-link** → `/markbook/sections`.

### Convenient links (no status chip)

- **Virtue themes** → `/evaluation/virtue-themes`. (Per decision: a plain link, _not_ a tracked readiness step and _not_ inline-edited — avoids embedding the Evaluation editor.)

### Tier 2 — Admissions & enrolment (contextual, not blocking)

- **Application window** — **inline** `AyAcceptingApplicationsToggle` for the selected AY (shows open/closed; this is a state indicator, not a readiness chip).
- **Class template / subjects** — **deep-link** → `/sis/admin/template`. Framed as a prerequisite; surfaced more prominently when the AY's copy-forward came up empty (no sections / no subject configs).

### Tier 3 — School-wide (not per-AY, but people look for it here)

- **Letterhead / school config** — **deep-link** → `/sis/admin/school-config`.

### Readiness pill

Kept as the floating quick-glance entry point, but its "Open" actions now land on **`/sis/ay-setup`** (the control center) instead of scattering to each individual surface. (The per-step `href` metadata in `getAyReadiness` is unchanged; only the pill's link target is simplified.)

---

## Reuse vs new

**Reused as-is (no changes):**

- `lib/sis/readiness.ts::getAyReadiness` — 4-step engine, already takes `ayCode`.
- `components/sis/term-dates-editor.tsx` (`TermDatesEditor`).
- `components/sis/ay-accepting-applications-toggle.tsx` (`AyAcceptingApplicationsToggle`).
- `components/sis/ay-setup-data-table.tsx` (`AySetupDataTable`) and all its row dialogs (`NewAyButton`, `AySwitchActiveDialog`, `AyDeleteDialog`, `CopyTeacherAssignmentsDialog`, `GenerateSheetsDialog`).
- All existing API routes under `app/api/sis/ay-setup/**`.
- Read helpers in `lib/sis/ay-setup/queries.ts` (`listAcademicYears`, `listTermsByAy`, `getCopyForwardPreview`, `checkAyEmpty`).

**New (presentational only):**

- The control-center page composition + tab shell in `app/(sis)/sis/ay-setup/page.tsx`.
- A small set of presentational components: a status-step row/card, the AY picker, the tier section cards.

**No new readiness logic, no new API route, no migration.**

---

## Out of scope (explicit)

- Rebuilding the calendar / sections / grading-sheets / virtue-themes editors — they stay where they live; we link.
- Embedding the Evaluation or Markbook editors inline.
- Changing any setup _behavior_, term-date validation, or the rollover/switch-active flow.
- Promoting virtue themes (or any other config) into the tracked readiness engine.
- Widening the page's role gate to registrar.

---

## Design-system conformance

- Tier sections as `Card`s; status via the `§9.3` status recipes (mint = done, amber = partial, muted = not started); one primary action per area; tokens only from `app/globals.css` (Hard Rule #7).
- `frontend-design` skill + `docs/context/09-design-system.md` to be consulted at implementation time before writing JSX (per `.claude/rules/always-do-first.md` + `design-system.md`).

## Cross-references

- KD #40 (AY rollover = DB flag flip), KD #66 (class template as the copy-forward source), KD #109 (4-step AY readiness engine + pill), KD #118 (early-bird window is SIS-owned), KD #48 (SIS Admin is the central config surface), KD #137/#138 (virtue themes live in Evaluation; report-card publish hard-gate).
