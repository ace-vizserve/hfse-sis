# Virtue-theme editor in the Evaluation module

**Date:** 2026-06-08
**Status:** Design — approved, ready for implementation plan
**Module:** Evaluation
**Cross-refs:** KD #49 (FCA write-ups + virtue theme drives the comment heading; T4 excluded), KD #114 (Evaluation = FCA write-ups, registrar oversight), KD #48 (config placement), KD #39 (school_admin config tier)

## Context / problem

Each term's **virtue theme** (`terms.virtue_theme`) drives the report-card FCA-comment heading — "Form Class Adviser's Comments (HFSE Virtues: …)" (KD #49). HFSE confirmed **the registrar (Joann) is the one who encodes virtue themes per term.**

But the only UI to edit it today is inside the **AY-Setup wizard** (`<TermDatesEditor>` under `/sis/ay-setup`), which is gated `school_admin | superadmin` — the registrar can't reach it. The data-write capability already includes the registrar: `PATCH /api/sis/ay-setup/terms/[termId]` is `requireRole(['registrar','school_admin','superadmin'])` and already accepts `virtueTheme`. So the gap is purely **UI location**, not permissions or data.

Fix: give the registrar a dedicated virtue-theme editor in the **Evaluation** module (where the theme is used + where Joann works), writing to the existing `terms.virtue_theme`. No schema change.

## Design

### Page — `/evaluation/virtue-themes`
- New route under the Evaluation route group. Explicit `ROUTE_ACCESS` entry = `registrar | school_admin | superadmin`.
- Lists the **current AY's terms T1 / T2 / T3** (T4 excluded — no FCA comment, KD #49). Each row: term label + window (read-only context), the current `virtue_theme`, an inline text input, and save.
- A one-line helper explains the theme prints on the report-card FCA heading.
- **Scope: current AY only** (resolve via `requireCurrentAyCode`). No `?ay=` cross-year picker — themes are a this-year operational task.
- Evaluation sidebar gains a **"Virtue themes"** nav item (`lib/auth/roles.ts` EVALUATION_NAV + an icon in `lib/sidebar/registry.ts`), gated to the same trio.

### API — `PATCH /api/evaluation/virtue-theme`
- Body `{ termId: string, virtueTheme: string | null }` (zod-validated; empty string / null clears).
- `requireRole(['registrar','school_admin','superadmin'])`.
- Updates **only** `terms.virtue_theme` for that term (never touches `start_date`/`end_date` — decoupled from the combined AY-Setup route, which required the date pair).
- Audits the **existing** `ay.term_virtue.update` action with before/after (mirror the AY-Setup route's audit context: `academic_year_id`, `term_number`, `label`, before/after virtue_theme). No-op (unchanged value) emits no audit row.
- Optional: a small loader for the page (current AY's T1–T3 terms + their virtue_theme) — can be an inline RSC query, no new lib module needed unless it tidies things.

### AY-Setup change
- **Remove the virtue-theme field** from `<TermDatesEditor>` (the AY-Setup wizard) — single home in Evaluation, avoids the two-places seam. AY-Setup keeps term dates + grading-lock.
- Leave the combined route's `virtueTheme` handling intact for back-compat (it just stops being sent from the AY-Setup UI). The new dedicated route is the canonical writer going forward.

## Components / files
- New: `app/(evaluation)/evaluation/virtue-themes/page.tsx` (RSC: resolve current AY + T1–T3 + virtue_theme; render the editor).
- New: `components/evaluation/virtue-themes-editor.tsx` (`'use client'`: rows with input + save, `toast` feedback, `router.refresh()`; design-system tokens only).
- New: `app/api/evaluation/virtue-theme/route.ts` (PATCH).
- New: `lib/schemas/virtue-theme.ts` (or extend an existing eval schema) — `{ termId, virtueTheme }`.
- Modify: `lib/auth/roles.ts` (ROUTE_ACCESS entry for `/evaluation/virtue-themes` + EVALUATION_NAV item).
- Modify: `lib/sidebar/registry.ts` (evaluation iconByHref for the new route).
- Modify: `components/sis/term-dates-editor.tsx` (remove the virtue-theme field/input) + its save call (stop sending `virtueTheme`).

## Non-goals
- No schema change (`terms.virtue_theme` exists).
- No cross-AY editing (`?ay=`).
- No change to how the theme is consumed (report card / FCA heading reads `terms.virtue_theme` unchanged).
- Not touching the combined AY-Setup terms route's server behavior (only the UI stops sending virtue).

## Verification
- `npx tsc --noEmit` + `npx vitest run` + `npx next build` clean.
- Registrar can open `/evaluation/virtue-themes` (via the new sidebar item), edit T1–T3 themes, save → value persists on `terms.virtue_theme`; audit shows `ay.term_virtue.update`.
- The report-card FCA heading reflects the edited theme (existing consumer, unchanged).
- AY-Setup no longer shows the virtue field; term-dates + grading-lock still save correctly there.
- `/evaluation/virtue-themes` is unreachable for teachers / p-file / admissions (ROUTE_ACCESS).
- Build via subagent-driven development + a `feature-dev:code-reviewer` pass.
