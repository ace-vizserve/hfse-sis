# Year Setup Workbench — design

**Date:** 2026-06-26
**Status:** Draft (brainstormed; awaiting spec review → plan)
**Surface:** `/sis/ay-setup` ("Year Setup" tab) + `/sis` hub
**Roles:** `school_admin`, `superadmin` (unchanged page gate)

## Problem

Setting up an academic year _feels_ scattered even though the underlying tools all
work. Three concrete causes:

1. **Two front doors.** The same "AY Setup → Calendar → Sections → Grading Sheets"
   sequence renders as `AdminCard`s on the `/sis` hub **and** as readiness rows in the
   `YearSetupControlCenter` at `/sis/ay-setup`. Two places for one job.
2. **The "center" is a launcher, not a workbench.** Of the four readiness steps, only
   term dates is editable in place (`TermDatesEditor`). Everything else — calendar,
   sections, grading sheets, and all of the "More setup" card (template, virtue themes,
   letterhead) — bounces the user out to six different routes.
3. **The readiness % is dishonest about scope.** `lib/sis/readiness.ts` checks exactly
   four things and reports "N / 4 ready," but a genuinely ready year also needs **virtue
   themes** (hard-blocks report-card publishing for T1–T3, KD #138), **letterhead**,
   **classes & subjects** (template applied), and a decided **application window**.
   Those carry no readiness signal, so the bar can read "4/4 ready" while a year is
   missing things that will block publishing later.

The logic and functionality already exist. The goal is to **tie them together with one
clear, guided surface** and make the readiness check **cover everything that makes a year
ready**.

## Goals

- One front door for year setup at `/sis/ay-setup`; remove the duplicate step grid from
  the `/sis` hub.
- A **guided stepper** that tells the admin what to do next, while still allowing a
  returning admin to jump straight to any one step.
- Light steps edit **inline**; heavy spatial tools (calendar grid, sections roster) stay
  where they are, reduced to a **one-click action + "Open full tool"** escape hatch.
- Expand the readiness engine from 4 → **8 steps** so the % reflects 100% of what makes a
  year ready.
- Refactor the readiness engine into **pure resolvers + thin fetchers**, and add a unit
  test suite with **100% coverage of the pure resolver layer**.

## Non-goals

- Not rebuilding the calendar month-grid or the sections roster inline.
- Not touching create / switch-active / delete-AY (the "Manage years" tab is unchanged).
- Not altering any mutation route's behavior — the workbench only _calls_ existing
  routes/RPCs.
- Not chasing line-coverage on the Supabase fetch wiring (integration territory; brittle,
  low safety value).

## Interaction model — guided stepper (non-linear)

A stepper at `/sis/ay-setup` (replacing the current `YearSetupControlCenter` body; the AY
picker and readiness summary header are kept):

- A **clickable step rail** across the top with a status dot per step. Fresh setup runs
  left-to-right; a returning admin clicks straight to the one step they need.
- A prominent **"Resume → next incomplete step"** button for the first-run guided feel.
- **Back / Next** present but never the only path.
- The main panel shows **one step at a time**: its status, a short "do this" description,
  and either an **inline editor** or a **one-click action + "Open full tool"** link.
- The page keeps the **AY picker**, so a future/early-bird AY can be fully set up _before_
  it becomes the active year.

## The 8 steps

| #   | Step                       | id               | Treatment                                                                   | "Ready" when…                           | Required    |
| --- | -------------------------- | ---------------- | --------------------------------------------------------------------------- | --------------------------------------- | ----------- |
| 1   | Academic year & term dates | `ay-setup`       | Inline (`TermDatesEditor`)                                                  | all 4 terms have start + end dates      | ✅          |
| 2   | School calendar            | `calendar`       | Launch `/sis/calendar` (+ 1-click generate if a clean backend exists)       | every term has calendar coverage        | ✅          |
| 3   | Classes & subjects         | `classes`        | 1-click _Apply class template_ + Open `/sis/admin/template`                 | AY has sections **and** subject_configs | ✅          |
| 4   | Form advisers              | `advisers`       | Launch `/sis/sections` (per-class is spatial); shows fraction advised/total | every section has a form adviser        | ✅          |
| 5   | Grading sheets             | `grading-sheets` | 1-click _Create for all sections_ + Open `/markbook/sections`; fraction     | every section has grading sheets        | ✅          |
| 6   | Virtue themes              | `virtue-themes`  | Inline (`virtue-themes-editor`)                                             | T1–T3 virtue themes set                 | ✅          |
| 7   | Report-card letterhead     | `letterhead`     | Inline key fields + Open school-config                                      | required letterhead fields populated    | ✅          |
| 8   | Application window         | `app-window`     | Inline toggle                                                               | — (a decision, not a requirement)       | ⬜ optional |

**Required vs optional:** the readiness ring counts only **required** steps (1–7). The
application window is shown in the stepper but **excluded from the denominator** — a year
is ready whether or not it accepts early-bird applications.

> Note: this **splits** the current `checkSections` (which conflates "sections exist" with
> "advisers assigned") into step 3 (Classes & subjects) and step 4 (Form advisers).

## Readiness engine refactor — pure resolvers + thin fetchers

`lib/sis/readiness.ts` is restructured so each step is two pieces:

- **Pure resolver** — `resolve<Step>Step(input) → ReadinessStep`. No DB, no I/O; just the
  rule (status + description + optional fraction). This is where "ready when…" lives.
- **Thin fetcher** — runs the count query and hands raw numbers to the resolver. Almost no
  logic.

Proposed resolver signatures (inputs are plain numbers/booleans):

- `resolveAySetupStep({ datedTermCount })`
- `resolveCalendarStep({ totalTerms, coveredTerms })`
- `resolveClassesStep({ sectionCount, subjectConfigCount })`
- `resolveAdvisersStep({ sectionCount, advisedSectionCount })` → fraction
- `resolveGradingSheetsStep({ totalSections, sectionsWithSheets })` → fraction
- `resolveVirtueThemesStep({ termsRequiringTheme, termsWithTheme })` → fraction (T1–T3 = 3)
- `resolveLetterheadStep({ requiredFieldsFilled, requiredFieldsTotal })`
- `resolveAppWindowStep({ accepting })` → `required: false`

Aggregation becomes a pure function too:

- `buildReadiness(steps) → AyReadiness` where `complete` = count of **required** steps
  with `status === 'done'`, `total` = count of **required** steps, and the percent derives
  from those. The all-not-started case is just `buildReadiness` over resolvers fed empty
  inputs (no separate `buildAllNotStarted` hand-rolled list).

Type changes:

- `ReadinessStepId` gains `'classes' | 'virtue-themes' | 'letterhead' | 'app-window'`.
- `ReadinessStep` gains `required: boolean`.
- `AyReadiness.total` changes from the literal `4` to `number`.

`getAyReadiness` stays a cached wrapper (`unstable_cache`, tag `sis:${ayCode}`,
`revalidate: 60`); only its internals change.

## Test plan — 100% of the resolver layer

New `__tests__/sis/readiness.test.ts` (Vitest, pure-logic — mirrors
`__tests__/sis/enrolment-position.test.ts`). Covers **every resolver × every branch**:

- `done` / `partial` / `not_started` for each step that has all three.
- Boundary inputs: 0 terms, all-covered, partial fractions (e.g. 12/18), exactly-complete.
- Fraction math (`done`/`total`) for advisers, grading sheets, virtue themes.
- `resolveAppWindowStep` carries `required: false` in every branch.
- `buildReadiness`: required-only counting, optional steps excluded from the denominator,
  percent rounding, and the empty/all-not-started aggregate.

Target: **100% line + branch coverage of the resolver + `buildReadiness` functions.** The
fetchers are thin pass-throughs and are intentionally left to integration/manual coverage.

## Backend wiring (reuse, don't rebuild)

| Step               | Wires to (existing, confirmed 2026-06-26)                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Term dates         | `PATCH /api/sis/ay-setup/terms/[termId]` (via `TermDatesEditor`)                                                                       |
| School calendar    | **New thin AY-wide seed route** wrapping `ensureTermSeeded` per dated term (one-click) + Open `/sis/calendar`                          |
| Classes & subjects | `POST /api/sis/admin/template/apply` (`apply_template_to_ay` RPC) + Open `/sis/admin/template`                                         |
| Form advisers      | Launch `/sis/sections` (teacher-assignment; spatial)                                                                                   |
| Grading sheets     | **Embed `GenerateSheetsDialog` controlled**, `scope={{ kind: 'ay', ayId, ayCode }}` → `POST /api/grading-sheets/bulk-create { ay_id }` |
| Virtue themes      | Inline `virtue-themes-editor` → `PATCH /api/evaluation/virtue-theme` (KD #137)                                                         |
| Letterhead         | `PATCH /api/sis/admin/school-config`; "ready" = `organization_name` + `address_line_1` non-empty (global singleton)                    |
| Application window | Inline toggle → `PATCH /api/sis/ay-setup/accepting-applications` (KD #118)                                                             |

## Deduplication — `/sis` hub

The four-card "Year Setup" grid on `/sis` (`app/(sis)/sis/page.tsx`) is replaced by **one**
"Year Setup" card that shows the live readiness ring (e.g. "6 / 7 ready") and links to
`/sis/ay-setup`. The hub fetches `getAyReadiness(currentAyCode)` for the ring.

## Edge cases

- **Ring must refresh after inline edits — cache punch list (audited 2026-06-26).**
  `getAyReadiness` is cached (tag `sis:${ay}`, 60s). Only **accepting-applications** and
  **apply-template** currently `revalidateTag('sis:${ay}', 'max')`. **Four routes must be
  patched** to add it, or the ring lies for up to 60s after the step is fixed:
  - `app/api/sis/ay-setup/terms/[termId]/route.ts` (resolve ayCode from term; only busts
    attendance/markbook drill tags today)
  - `app/api/evaluation/virtue-theme/route.ts` (busts **nothing** today; resolve ayCode
    from term)
  - `app/api/grading-sheets/bulk-create/route.ts` (busts markbook drill only; has `ay_id`)
  - `app/api/sis/admin/school-config/route.ts` (busts markbook drill only) — **note:**
    `school_config` is a **global singleton** (id=1), so letterhead is AY-independent; bust
    the **current** AY's `sis:` tag (its existing comment already busts current-AY). Editing
    letterhead while configuring a non-current future AY self-heals within 60s — acceptable
    since letterhead is seeded by migration 054 and rarely touched.
    Match the repo's existing `revalidateTag(tag, 'max')` call convention.
- **Required vs optional denominator.** `buildReadiness` counts only `required` steps; the
  optional app-window step never drags the % down.
- **Brand-new AY (no terms).** Step 1 `not_started`, everything downstream `not_started`;
  "Resume" lands on step 1. The empty-input branch is in the resolver test suite.
- **Selected ≠ current AY.** The stepper configures whichever AY the picker has selected,
  so a future AY can be set up before switch-active.

## File-level change list (for the plan)

**Modify**

- `lib/sis/readiness.ts` — split into resolvers + fetchers; 8 steps; `required` flag;
  `buildReadiness`; `ReadinessStepId`/`ReadinessStep`/`AyReadiness` type updates.
- `app/(sis)/sis/ay-setup/page.tsx` — fetch expanded readiness; render the stepper.
- `app/(sis)/sis/page.tsx` — replace the 4-card Year Setup grid with the single readiness
  card.
- Cache punch list (4 routes) — add `revalidateTag('sis:${ay}', 'max')`:
  `sis/ay-setup/terms/[termId]`, `evaluation/virtue-theme`, `grading-sheets/bulk-create`,
  `sis/admin/school-config` (current AY). See Edge cases.

**Create**

- `__tests__/sis/readiness.test.ts` — resolver + aggregation suite (100% of resolver layer).
- `components/sis/year-setup/year-setup-stepper.tsx` — stepper shell (rail + panel +
  Resume/Back/Next), composing the existing inline editors and launch links.
- `app/api/sis/ay-setup/seed-calendar/route.ts` (or similar) — thin AY-wide wrapper that
  loops `ensureTermSeeded` over the AY's dated terms for the one-click calendar action,
  busting `sis:${ay}`.
- (Possibly) a small hub readiness card component for `/sis`.

**Repurpose / remove**

- `components/sis/year-setup/year-setup-control-center.tsx` — its content is superseded by
  the stepper; either repurposed into the stepper or removed.

## Resolved (investigation 2026-06-26)

1. **Calendar one-click generate — feasible, cheap.** School-day rows already auto-seed as
   an RSC side-effect when `/sis/calendar` loads (`ensureTermSeeded` loop), and a per-term
   `autofill_weekdays` POST action exists (`app/api/attendance/calendar/route.ts`) with no
   UI caller. Decision: add a **thin AY-wide seed route** that loops `ensureTermSeeded` over
   the AY's dated terms (reuses `weekdaysBetween` + idempotent upsert; ~10 lines) for the
   one-click action, and keep "Open `/sis/calendar`" as the escape hatch. Readiness
   "covered" = a term has **≥1** `school_calendar` row (not full-day completeness) — matches
   the current `checkCalendar`.
2. **Letterhead required fields — `organization_name` + `address_line_1`.** All letterhead
   columns come from **migration 054** (there is no migration 101; "101" is the **KD**
   number). `<ReportCardLetterhead>` renders every field conditionally; only org-name +
   address read as "broken if blank" (logo/phone/website/email/PEI degrade gracefully).
   `school_config` is a **global singleton (id=1)** seeded with real HFSE values by 054 (+ a
   code-side `DEFAULT_SCHOOL_CONFIG` fallback), so this step is **usually already green** and
   AY-independent. Keep it as a required step (honest breadth); it rarely blocks.
3. **Grading sheets — embed `GenerateSheetsDialog` controlled (AY scope).** It's already a
   controlled, trigger-less-capable component (`open` prop + omit `children`); the AY-scoped
   usage is proven in `ay-setup-data-table.tsx`. `POST /api/grading-sheets/bulk-create`
   accepts `{ ay_id }` and creates sheets for **all** sections in one idempotent call,
   returning `{ inserted, reason }`. Zero new UI logic — just a stepper button that flips
   `open`. (Optional: add an `onCompleted?(inserted)` prop if the step needs the count
   client-side; otherwise `router.refresh()` + the re-fetched ring suffices.)

## Cross-references

- `lib/sis/readiness.ts` (current 4-step engine), `getAyReadiness`
- `components/sis/year-setup/year-setup-control-center.tsx` (current surface)
- `app/(sis)/sis/ay-setup/page.tsx`, `app/(sis)/sis/page.tsx`
- KD #109 (AY Readiness indicator), KD #118 (early-bird window), KD #137 (virtue themes),
  KD #138 (virtue/comment publish gate), KD #101 (letterhead config)
- `docs/context/18-ay-setup.md`
