# SIS Admin — Content &amp; Functionality Redesign (2026-07-13)

## Context

Two prior attempts at a SIS Admin "redesign" this cycle were rejected or abandoned:

1. A "13 → 6" page-consolidation branch (`feat/sis-admin-consolidation`, parked, do not resume)
   was built and reviewed clean, but the user halted it: it relocated existing page bodies
   verbatim behind new routes/tabs — real IA plumbing, zero actual UI/UX or functionality
   change. "You just reused what's existing and didn't enhance any UI/UX or even the
   functionality."
2. A follow-up static mockup (v2, generic modern-SaaS styling, not the app's real design
   system) was drafted but the whole effort was paused to fix three concrete bugs first
   (`fix/sis-admin-config-silent-failures`, now merged/committed — see below).

This redesign is grounded in two pieces of research done before any visual work started:

- **Data-flow tracing** (three parallel agents) — for every SIS Admin config surface, the exact
  downstream tables/loaders/components it feeds across Attendance, Markbook, Report Cards,
  Evaluation, Records, and Admissions, and what breaks (often silently) when the config is
  missing or wrong.
- **lawsofux.com's full 30-law catalog**, mapped to concrete problems the data-flow research
  surfaced (Postel's Law → the fail-closed calendar gate is backwards; Mental Model → config
  screens don't resemble what they produce; Von Restorff Effect → high-blast-radius actions
  have no visual distinction from routine ones; Chunking → group by downstream artifact, not
  generic settings taxonomy; Doherty Threshold → Apply-to-AY gives no preview before commit).

Three bugs the research surfaced were fixed and shipped separately, and this redesign
deliberately builds on top of them (not around them):

- **Fix 1** — `school_config.default_compassionate_allowance_per_year` was validated/saved but
  silently ignored by the attendance quota calculation (hardcoded `5`). Now wired.
- **Fix 2** — the report card and masterfile export read a denormalized `sections
.form_class_adviser` mirror that's written on assign but never cleared on unassign. Both now
  resolve the adviser live from `teacher_assignments`, matching what the publish-readiness gate
  already did.
- **Fix 3** — the "Classes & subjects" readiness step only checked that _some_ subject config
  existed, not that every level's config was complete against Structure Defaults. Now a real
  per-level comparison, surfaced as a warning banner on Subject Weights.

## Scope decisions (confirmed with the user before any mockup work)

1. **Content only, same 13 pages/routes.** No route merging, no redirect stubs — the rejected
   consolidation attempt is not being revisited. The one exception, explicitly approved: **light
   inline IA** — a page may gain an inline tab/toggle surfacing directly-related information
   without becoming a new route (e.g. Subject Weights gaining a "Structure Defaults" comparison
   tab).
2. **All 13 pages, phased by real downstream stakes**, not a partial tranche. Order: Structure
   Defaults + Subject Weights (whole-cohort grade correctness) → Calendar + AY Setup (attendance
   blocking) → Sections + Staff (roster integrity) → Approvers (silently disables all grade
   corrections) → School Config (report-card correctness) → Grade Levels + Discount Codes
   (admissions-facing, lower stakes) → Audit Log/Settings/Hub (lowest daily-use value, light
   pass).
3. **Every phase must ship a genuine functionality upgrade**, not just visual polish — the
   explicit lesson from the first rejected attempt. Where a page is already good (Staff's
   person-row treatment, KD #154; Grade Levels' unmatched-demand warning, KD #153), the plan
   says so plainly and scopes that phase's work to what's actually new, rather than manufacturing
   busywork.

## Design system — real tokens only, no invention

Every screen in this redesign uses the actual Aurora Vault tokens from `app/globals.css` and the
binding docs (`docs/context/09-design-system.md` + `09a-design-patterns.md`), not an approximation:

- **Type:** `font-serif` (Source Serif 4) for headlines/card titles, `font-mono` (JetBrains Mono)
  for eyebrows/codes/status text, `font-sans` (Inter) for body and controls.
- **Color:** `brand-indigo` (#213098) primary, `brand-mint` (#34d399) healthy, `brand-amber`
  (#ed7622) warning, `destructive` blocking, `ink`/`ink-3`/`ink-4`/`ink-5` for text hierarchy,
  `hairline`/`hairline-strong` for borders. No raw hex, no invented CSS variables.
- **Icon tiles:** gradient (`bg-gradient-to-br from-brand-indigo to-brand-navy` + `shadow-brand
-tile`) — the one place gradients are used, per the design system's own rule. Everything else
  is solid tints (`bg-brand-mint/20`, `bg-brand-amber-light`), never a gradient content
  background.
- **Status panels:** the existing §9.4 recipe (icon tile + serif title + body, color family
  swapped to match severity) — already used for the Fix 3 warning banner and Subject Weights'
  existing indigo panel; every new warning in this redesign reuses that exact shape rather than
  inventing a new one.
- **Chips/badges:** the existing §9.3 recipes and the already-shipped `staff-visuals.tsx` tone
  map (avatar tint, role chip colors, FCA/subject chip shapes) — copied verbatim where a phase
  touches staff/adviser data, not redrawn.

## The seven phases

### Phase 1 — Grading setup (Structure Defaults + Subject Weights)

**Stakes:** highest in the module — a bad weight edit or template-apply silently re-grades a
whole cohort across every masterfile row and printed report card.

- **Subject Weights** (`/sis/admin/subjects`, unchanged route): each subject card renders the
  _actual grading-sheet columns_ (WW1–5 blue-tinted, PT1–5 mint-tinted, QA amber-tinted, with
  slot maxes) instead of a flat weight-percentage matrix. A "HFSE Primary/Secondary standard" vs
  "Custom" badge replaces reading three raw percentages — **"Standard" means this
  `(subject × level)`'s weights and slot maxes exactly match `template_subject_configs` for that
  level; any difference is "Custom"** (the same comparison Fix 3's gap-check already performs,
  reused rather than re-derived). **New inline tab** (light IA):
  "This year" / "Structure Defaults" with a drift-count badge — reuses `computeSubjectConfigGaps`
  (Fix 3) to show exactly which subjects differ between this AY and the template, no new page.
- **Structure Defaults** (`/sis/admin/template`, unchanged route): "Apply to AY" changes from an
  immediate commit to **Apply-with-preview** — a computed diff (new sections/configs inserted,
  old→new weight values for updates) rendered before any write happens, plus an explicit,
  honest note that Apply never deletes (a section/subject removed from the template stays in
  already-applied AYs untouched — surfacing the real UPSERT-only behavior instead of hiding it).
  **Per-AY drift chips** show which already-applied years have since diverged from the template,
  reusing the same comparison engine as the Subject Weights tab.

### Phase 2 — School year (School Calendar + AY Setup)

**Stakes:** the fail-closed attendance gate (an unlisted date in a partially-seeded term blocks
teachers with a 409) and undated terms breaking report-card computation.

- **School Calendar** (`/sis/calendar`, unchanged route): month grid matches the attendance
  workbook's own vocabulary (PH/HBL/SE tags exactly as they print on teachers' sheets). **New:**
  any date inside an already-started term with no day-type row is visually flagged (destructive
  border/badge, "Unmarked — will block attendance") with a plain-English consequence panel
  underneath — closing the invisible-until-a-teacher-hits-409 gap the research found.
- **AY Setup** (`/sis/ay-setup`, unchanged route): the year-band summary stays as-is (already
  good, KD #154). **The checklist rows change from binary status to real consequences** — reusing
  the exact fraction/gap data the readiness engine (Fix 3) and calendar/subjects pages compute,
  stated in plain English ("Secondary 1 is missing 2 subjects from Structure Defaults — they
  won't appear on report cards" instead of "Classes & subjects: not done").

### Phase 3 — People & rosters (Sections + Staff)

**Stakes:** `index_number` is invisible on the sections list today but drives attendance-register
order, the xlsx export, and the masterfile export — a named pain point (misaligned index
numbers). Missing form advisers hard-block report-card publish.

- **Sections** (`/sis/sections`, unchanged route): each row surfaces index-number completeness
  as a scannable status chip (mint "Index #1–21 complete" vs amber "1 student unnumbered" with
  a one-click Generate Index action inline) and a destructive "No form adviser — blocks
  report-card publish" state where applicable, instead of requiring a click into the section to
  discover either.
- **Staff** (`/sis/admin/staff`, unchanged route): **mostly confirming, not redesigning** — the
  person-row treatment (avatar tile, role chip, FCA/subject chips) already shipped in KD #154 and
  is genuinely good; re-doing it would be busywork. The two real additions: an explicit
  "Unassigned" empty state (an unassigned staff member currently just shows a blank cell), and a
  visible trust note that FCA/adviser data now resolves live from `teacher_assignments` (Fix 2),
  not the drift-prone mirror.

### Phase 4 — Approvers

**Stakes:** an under-resourced approver list (0 or 1 person on a flow) silently disables all
grade corrections on that flow school-wide — filing requires two distinct approvers. Today's page
is a bare table with no warning.

- Each approval flow becomes its own card showing assigned approvers as person chips (same
  avatar-tile treatment as Staff) and a computed readiness state: mint "Ready — N approvers" for
  2+, a loud destructive-bordered card with an explicit consequence panel for exactly 1
  ("A correction needs two different approvers... no one can file a request on this flow — add a
  second person now"), scaling to 0 the same way.

### Phase 5 — School details (School Config)

**Stakes:** every letterhead field maps to an exact, specific spot on the printed report card;
a blank field silently omits that line with no error anywhere.

- **School Config** (`/sis/admin/school-config`, unchanged route): form fields on the left, a
  **live preview of the actual report-card letterhead component** on the right, updating as
  fields are edited — reusing the real hide-when-empty and T1–T3-vs-T4-signature-line rules
  already in `report-card-document.tsx`, not a re-derived approximation. A missing signature
  renders as a visibly blank dashed line in the exact position it prints. The attendance-quota
  defaults section (vacation leave + compassionate leave) carries a small "now wired end-to-end"
  note — the direct callback to Fix 1 closing the dead compassionate-default field.

### Phase 6 — Admissions-facing (Grade Levels + Discount Codes)

**Stakes:** lower than Phases 1–5 — these config surfaces affect the admissions funnel, not
live grading/attendance correctness.

- **Grade Levels** (`/sis/admin/levels`, unchanged route): the existing unmatched-demand warning
  (KD #153) is kept as-is — it's good work, not being redone. **New:** a live preview of the
  actual parent-facing application-form level picker for the accepting AY, so the "Offered"
  toggle's real-world effect (which levels a parent can select, and the pre-filled "next level"
  suggestion for a returning student) is visible directly, not just documented.
- **Discount Codes** (`/sis/admin/discount-codes`, unchanged route): **deliberately the lightest
  touch in this plan.** The research found zero referential integrity between this catalogue and
  the actual grant (written by the external parent portal into free-text columns) — the SIS can
  never confirm a real-world grant matches the catalogue. Redesign is limited to the same
  status-badge language as every other page, plus an honest boundary note explaining exactly what
  this page can and can't do. No artifact preview, no diff view — building either would misrepresent
  capability the system doesn't have (Mental Model law, applied in reverse: don't let the UI imply
  more control than exists).

### Phase 7 — System &amp; Hub polish (Audit Log, Settings, Admin Hub)

**Stakes:** lowest daily-use value — break-glass and system-level surfaces.

- **Audit Log** and **Settings** (unchanged routes): light consistency pass only — both already
  ship the Overview|Log toggle and environment switcher from KD #154; this phase aligns spacing/
  type to the exact tokens used everywhere else in this plan, no new functionality.
- **Admin Hub** (`/sis`, unchanged route): the year band and quick actions stay as shipped
  (KD #154, already good). **The payoff phase:** the attention feed is wired to surface the real
  consequence signals built across Phases 1–6 — the unassigned adviser (Phase 3), the
  under-resourced approver flow (Phase 4), the subject-config gap (Fix 3/Phase 1), the calendar
  block risk (Phase 2), the unmatched level demand (Phase 6) — each linking directly to the exact
  screen/cut that fixes it. This makes the hub a genuine single "what needs attention today"
  instead of a narrower class-assignment/change-request-only summary.

## What stays explicitly out of scope

- Any route merging, page consolidation, or redirect stubs (the rejected consolidation approach).
- New database migrations — every phase works against existing schema (Fixes 1–3 already
  extended what was needed; the readiness/gap-comparison logic those fixes introduced is reused,
  not re-invented, by Phases 1, 2, and 7).
- Deep functionality for Discount Codes beyond the catalogue view (Phase 6) — the referential-
  integrity gap is a real system boundary, not a UI problem this redesign can fix.
- Re-designing Staff's person-row treatment or Grade Levels' demand warning — both already good,
  confirmed in Phases 3 and 6 rather than rebuilt.

## Verification approach (per phase, to be detailed in the implementation plan)

Each phase's implementation plan step should include: `npx vitest run` on the touched module's
existing test files (extending, not replacing, coverage per the fixes' established pattern of
pure/unit-testable helpers — `computeSubjectConfigGaps`, `buildFormAdviserNameMap`, the readiness
resolvers); `npx next build` clean; and a manual browser pass confirming the artifact-preview
components render real data correctly (grading-sheet columns match actual `subject_configs`
values, the letterhead preview matches `report-card-document.tsx`'s actual render rules, the
calendar block-flag matches the real fail-closed gate logic in `app/api/attendance/daily/route.ts`).
Hard Rule #7 (tokens only) and the frontend-design skill invocation apply to every phase's JSX,
per the project's Always-Do-First rule.
