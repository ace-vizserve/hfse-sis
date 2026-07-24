# Home page (`/`) role-aware overview — design

**Date:** 2026-07-24
**Status:** Approved (mockups reviewed interactively via the brainstorming visual companion — no artifact file saved, session-local only)

## Problem

`/` (`app/(dashboard)/page.tsx`) is currently a plain centered tile picker: it filters the 7 module tiles by `isRouteAllowed(href, role)` and renders nothing else. This is redundant — the module switcher already in the topbar/sidebar header (`TopbarModuleSwitcher`, `ModuleSidebar` popover, KD #58) does the same navigation job. The page shows zero information about the state of the school or what the signed-in user actually needs to do.

## Goal

Replace the picker with a role-aware overview: a quick per-module snapshot plus actionable items, so landing on `/` answers "what's going on and what do I need to do" instead of "where do I click." Navigation to a module stays available via the existing switcher — this page adds information, it doesn't replace navigation.

## Scope: who sees this page

Unchanged from today. Only four roles ever reach `/`:

- `teacher`
- `academic_coordinator`
- `school_admin`
- `superadmin`

`p_file_officer` and `admissions` continue to redirect straight to their one module (`app/(dashboard)/page.tsx` lines 46-47 and `app/(dashboard)/layout.tsx` lines 24-25) — unchanged, out of scope.

Which of the 7 module cards a given role sees is **unchanged**: still driven by `isRouteAllowed(href, role)` against the existing `ROUTE_ACCESS` table (`lib/auth/roles.ts`). No new access rule is introduced by this feature.

## Page structure (top to bottom)

1. **Header** — mono-uppercase eyebrow ("HFSE · Student Information System") + serif greeting ("Good morning, {name}.") + one-line subtitle. Same recipe the current page already uses for its header, just no longer centered/hero-styled — left-aligned, consistent with the rest of the app's data-dense pages (not a marketing hero).
2. **Quick actions row** — 3 one-click shortcuts to the most common thing that role does, real `Button` `default` variant (indigo→indigo-deep gradient, `shadow-button`) with a trailing `ArrowUpRight` icon. See per-role table below for the 3 picks and targets.
3. **To-do + Coming up** — a two-column row. To-do (flex 2) is the actionable list; Coming up (flex 1) is a capped 2-item calendar strip. They share a row rather than stacking taller, since both are "top of mind right now" content.
4. **KPI row** — 3 headline numbers, role-scoped. **Omitted entirely for `teacher`** — nothing school-wide is meaningful at that scope, and the module cards already carry personal-scope numbers.
5. **Module card grid** — one card per accessible module (same `isRouteAllowed` filter as today). Each card: icon tile (existing `ModuleTile` gradient recipe) + module name + one headline stat, with a mini-chart **only** where the data has a natural chart shape (see mapping below), and a status badge only when it isn't already itemized in the To-do panel (no duplicate counts between To-do and the card grid).

**Cut from scope:** a cross-module "recent activity" table (sourced from `audit_log`) was mocked and then dropped for page length once quick actions + to-do + coming-up were added. Noted as a deliberate v1 cut, not an oversight — revisit only if a real need shows up post-ship.

## Per-role content

| Role                     | KPI row                                                                          | Quick actions (→ target)                                                                                                                    | Module cards shown                                                                                                                                                                                                                              | To-do sources                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **teacher**              | none                                                                             | Enter grades (→ `/markbook/grading`) · Mark attendance (→ `/attendance/sections`) · Write evaluation (→ `/evaluation`)                      | Markbook, Attendance, Evaluation — own sections only                                                                                                                                                                                            | "Needs your attention" (not "approvals" — teachers are never in the CR approver pool): own sheets' unscored-slot count, own advisory's draft write-up count. Review-only links, no inline actions.                                                                                                                                                                                                                                                                 |
| **academic_coordinator** | Active students (AY) · Attendance rate today · Write-ups submitted % (this term) | Review applications (→ `/admissions/applications`) · Lock overdue sheets (→ `/markbook/grading`) · Assign a section (→ `/records/unsynced`) | Admissions, Records, Markbook, Attendance, Evaluation — **no P-Files** (not in her `ROUTE_ACCESS`), **no SIS Admin** (the bare `/sis` catch-all is school_admin/superadmin only even though she can deep-link into specific `/sis/*` sub-pages) | Admissions doc-validation pending count (→ `/admissions/document-validation`), unsynced-students count (→ `/records/unsynced`), report-card comment-gate gaps for the current term (→ the section's evaluation/comments page). Review-only — she is not in the grade-CR approver pool.                                                                                                                                                                             |
| **school_admin**         | Active students (AY) · Attendance rate today · Documents on file %               | Validate documents (→ `/admissions/document-validation`) · AY Setup (→ `/sis/ay-setup`) · Manage staff (→ `/sis/admin/staff`)               | All 7 modules                                                                                                                                                                                                                                   | **Grade change requests assigned to her, with inline Approve/Reject** (the one role that can actually decide — see Correctness note below) + doc-validation pending + unsynced-students, both review-only.                                                                                                                                                                                                                                                         |
| **superadmin**           | Active students (AY) · System issues flagged · Attendance rate today             | Validate documents (→ `/p-files/document-validation`) · Manage staff (→ `/sis/admin/staff`) · School config (→ `/sis/admin/school-config`)  | All 7 modules                                                                                                                                                                                                                                   | P-Files doc-validation pending, via the existing `countAwaitingVerification` helper (`lib/p-files/document-validation.ts`) — superadmin is the one non-`p_file_officer` role KD #74 treats as an "officer" there, so this to-do is actionable for them specifically, not for school_admin (who can reach the same `/p-files/document-validation` page but only in its read-only oversight mode) + unsynced-students. **No grade-CR items** — see Correctness note. |

### Correctness note: grade change-request approvals are `school_admin`-only, verified against the live authorization code

The mockup originally assumed this from KD #41's prose ("eligible pool = school_admin; superadmin excluded"), but the actual code has a subtlety worth recording since it affects what the to-do panel is allowed to show:

- `app/(markbook)/markbook/change-requests/page.tsx` gives superadmin **full read visibility** into all pending change requests, unfiltered by approver assignment ("oversight even when not in the approval loop") — but only applies the assigned-to-me `.or()` filter for `role === 'school_admin'`.
- `lib/change-requests/decide.ts` (the actual server-side authorization for approve/reject) hard-blocks anyone whose `role !== 'school_admin'` with a 403, regardless of what the page renders.

So: the home-page to-do panel's grade-CR rows (with inline Approve/Reject) are **school_admin-only**, scoped with the exact same query shape already used at `app/(markbook)/markbook/change-requests/page.tsx:88-91` (assigned-to-me OR legacy-both-null-broadcast) — reuse that scoping verbatim rather than re-deriving it. Superadmin does not get CR to-do items at all (they have oversight visibility elsewhere — the `/markbook/change-requests` inbox itself — but a to-do panel implies actionability, and they can't act here).

## Module card content mapping

One headline stat per card, reusing each module's own existing `lib/<module>/dashboard.ts` loader value rather than computing anything new (KD #46 pattern). Mini-chart only where the underlying data is naturally a time series or a single completion percentage/step-progress — everything else stays a plain stat + label:

| Module     | Chart                  | Why                                                            |
| ---------- | ---------------------- | -------------------------------------------------------------- |
| Attendance | Sparkline, last 7 days | Rate over time is the natural shape                            |
| Markbook   | Progress ring          | Single completion % ("sheets locked")                          |
| Evaluation | Progress ring          | Single completion % ("write-ups submitted")                    |
| SIS Admin  | Segmented dots         | Discrete step progress (AY readiness, KD #109)                 |
| Admissions | Plain stat             | A single count/percent doesn't chart meaningfully at this size |
| Records    | Plain stat             | Same                                                           |
| P-Files    | Plain stat             | Same                                                           |

Card content also follows the existing KD #74 operational-vs-oversight split per module — `academic_coordinator` sees the chase-flavored number (e.g. Admissions: new applications this week), `school_admin`/`superadmin` see the oversight number (e.g. Admissions: conversion % this AY). This is not a new rule; it mirrors what each module's own dashboard already does for these roles, surfaced one level up.

## Data sources — reuse vs. new

**Reused as-is (no new query logic):**

- Each module's `lib/<module>/dashboard.ts` headline KPI for the card grid.
- Grade change-request "assigned to me" scoping — copy the exact `.or()` clause from `app/(markbook)/markbook/change-requests/page.tsx:88-91`.
- `lib/admissions/document-validation.ts` (KD #89) for the doc-validation to-do count.
- `lib/sis/unsynced-students.ts` (KD #90) for the unsynced-students to-do count.
- `calendar_events` (KD #76) for Coming up, ordered by date ≥ today, capped at 2.
- `getAyReadiness` (KD #109) for the SIS Admin card's segmented-dots fraction.
- `lib/sis/health.ts` (already backs the SIS Admin hub's `SystemHealthStrip`) for superadmin's "System issues flagged" KPI — resolves what was an undefined placeholder number in the mockup.

**New, small, additive (no schema changes):**

- `lib/home/todos.ts` — per-role aggregator composing the sources above into one ranked list. The one genuinely new piece of logic inside it: a report-card comment-gate rollup for `academic_coordinator`/`school_admin`/`superadmin` (reuses `cumulativeCommentGaps`/`computePublishReadiness` from `lib/markbook/comment-completeness.ts` and `lib/markbook/publish-readiness.ts`, KD #129/#139, run per-section for the current term). **Flagging this as the one item worth a second look during spec review** — it's the most expensive of the to-do sources (a per-section scan rather than a single indexed count) and the least precedented; everything else in this list is a one-query reuse.
- `lib/home/coming-up.ts` — thin wrapper selecting the next 2 `calendar_events`.
- `lib/home/kpis.ts` — the 3 role-scoped headline numbers (active-student headcount, today's attendance rate, + one role-specific third metric), each itself a reuse of an existing per-module dashboard helper, just composed together. "Write-ups submitted %" reuses the existing Evaluation dashboard submission-% KPI (KD #126). "Documents on file %" reuses whatever slot-status completeness metric `lib/p-files/dashboard.ts` already exposes — no new computation; the exact field gets pinned during implementation rather than guessed here.
- `lib/home/quick-actions.ts` (or inline in `lib/auth/roles.ts`) — static role → 3 links mapping, no query.

## Visual design

Established across the mockup iterations, all pulled from the actual design system rather than invented:

- Header eyebrow/serif/subtitle recipe already used by the current picker page.
- Icon tiles: the existing `ModuleTile` gradient (`from-brand-indigo to-brand-navy`, `shadow-brand-tile`) — one consistent recipe for every module, not color-coded per module.
- Cards: real `Card` primitive (`rounded-xl border bg-card shadow-sm`).
- Status badges: real `Badge` variants (`success`/`warning`/`blocked`/`default` — saturated gradient + white text + mono-uppercase, per the KD #84 sprint-37 "one visual voice" update). No soft-tint badges.
- Buttons: real variants — quick actions use `default` (gradient + `ArrowUpRight` trailing icon, per explicit direction even though it means 3 gradient buttons together, a deliberate deviation from the "one primary Button per view" convention); Approve uses `success` (mint→sky) labeled "✓ Approve"; Reject uses `destructive` labeled "✕ Reject" — both icon + word, never icon-only.
- Typography: `font-serif` (Source Serif 4) for the greeting and stat values; mono-uppercase tracking for eyebrows and to-do module chips.

## Interaction details

- **Approve** fires immediately from the home page (no dialog) — matches the existing email one-click-approve behavior (KD #123) and `decide.ts`'s rule that approval needs no note.
- **Reject** navigates to the real change-request record instead of acting inline — rejecting requires a reason (KD #88), which doesn't fit a one-line to-do row.
- All other to-do rows ("N documents awaiting validation", "N students unsynced", "comments incomplete for 1 section") are **Review →** links into the existing target page — no other in-place actions.
- Quick action buttons and module cards are plain navigation (`next/link`), consistent with Hard Rule-adjacent conventions elsewhere in the app (no `<a href>` hard reloads, KD tech-stack.md).

## Testing plan

- Unit tests for the three new `lib/home/*` helpers, especially the role-scoping branches (teacher gets none of the school-wide sources; `academic_coordinator` never gets grade-CR to-do rows; `superadmin` never gets grade-CR to-do rows; `school_admin` gets exactly the same assigned-to-me OR legacy-broadcast scope as the existing change-requests page).
- A regression test asserting the home page's module-card set for each role matches `isRouteAllowed` exactly (mirrors the existing `sis-nav-route-consistency.test.ts` no-dead-ends pattern, KD #154) — this page must never drift from the access table.
- Manual happy-path check per role in the browser (Hard Rule-adjacent workflow requirement) before calling this done.

## Out of scope / deferred

- Cross-module "recent activity" audit-log feed — mocked, then cut for page length. Revisit only on a real request.
- Any change to which roles land on `/` (p_file_officer/admissions redirects are untouched).
- Any change to `ROUTE_ACCESS` / module visibility rules.
