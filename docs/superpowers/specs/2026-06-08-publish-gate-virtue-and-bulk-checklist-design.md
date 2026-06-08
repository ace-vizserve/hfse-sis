# Publish gate: virtue theme into the comment hard-gate + readiness checklist in bulk publish

**Date:** 2026-06-08
**Status:** Design — approved, ready for implementation plan
**Module:** Markbook (report-card publishing)
**Cross-refs:** KD #28 (soft gate + "publish anyway"), KD #49 (virtue theme frames the FCA comment), KD #75 (publish checklist = nav hub), KD #129 (comment hard-gate + cumulative render), KD #120 (roster-correct counts), KD #137 (virtue-theme editor in Evaluation)

## Context / problem

Two gaps in report-card publishing, both surfaced this session:

1. **The virtue theme isn't gated, but it's part of the hard-gated comment block.** The FCA comment is the one hard publish gate (KD #129). The term's virtue theme is the _heading_ of that comment block on the card ("Form Class Adviser's Comments (HFSE Virtues: …)", KD #49). Today a term's `virtue_theme` is only a **soft** readiness row (`virtue_readiness`) — so a card can publish with a complete comment under a heading that silently drops the virtue framing (the render omits the parenthetical when null — `report-card-document.tsx:305`). The virtue belongs _with_ the comment in the hard gate: it's coupled, HFSE designed the comment to be virtue-framed, and — unlike attendance/lock — it's **safe to hard-gate** (one value per term, set once at `/evaluation/virtue-themes`, no per-student/false-positive risk).
2. **Bulk publish shows no readiness checklist.** `BulkPublishDialog` loops the same gated `POST /api/report-card-publications` (so the comment hard-gate _is_ enforced), but it surfaces **none** of the soft checks (unlocked grading, attendance gaps) and **halts on the first hard failure** — one comment-incomplete section blocks the rest of the batch until fixed.

The soft checks (grading-locked, attendance, T4 grades, letterhead) **stay soft** — they have real false-positive / operator-lockout risk (KD #28/#75/#105). This spec hardens only the virtue theme (coupled to the already-hard comment) and gives bulk parity with the single-section checklist.

## Part 1 — Virtue theme folded into the comment hard gate

**`lib/markbook/comment-completeness.ts`** (the single source of truth for both the checklist display and the server block — KD #129):

- `CumulativeTerm` gains `virtue_theme?: string | null`.
- `CumulativeGap` gains `virtueMissing: boolean` (the term's `missing` student array stays as-is; a gap can now be student-missing, virtue-missing, or both).
- `cumulativeCommentGaps`: for each required term 1..min(N,3), compute `virtueMissing = !(t.virtue_theme?.trim())` alongside the existing `missing` students. **Push a gap when `missing.length > 0 OR virtueMissing`.** T4 still exempt (early return unchanged).

**Callers pass `virtue_theme`:**

- `POST /api/report-card-publications` — its terms query (`id, term_number, end_date`) adds `virtue_theme`; the 422 `comments_incomplete` message + `comment_gate.gaps` payload include virtue: a gap renders as `Term 2 (3 students)` and/or `Term 2 (virtue theme not set)`. `gaps[].virtue_missing` added to the JSON.
- `app/api/sections/[id]/publish-readiness/route.ts` — its terms query for the gate adds `virtue_theme`; the returned `comment_gate` now reflects virtue. The standalone **soft `virtue_readiness` block is removed** (it's now covered by the hard `comment_gate` — one source of truth, no drift).

**`components/admin/publish-window-panel.tsx`:** the comment `<ChecklistRow>` (hard, destructive "Required to publish") now also represents virtue — when a term is virtue-blocked it lists "Term N — virtue theme not set" with a deep-link to `/evaluation/virtue-themes`. The separate soft virtue row is removed.

**Tests:** extend `__tests__/markbook/comment-completeness.test.ts` — virtue-set + comments-complete → no gap; virtue-null + comments-complete → gap with `virtueMissing:true`, empty `missing`; both missing → gap with both.

## Part 2 — Readiness checklist in the bulk dialog

**`components/admin/bulk-publish-dialog.tsx`:**

- **Compute readiness automatically** on dialog open / term change: for each selected section, fetch `GET /api/sections/[id]/publish-readiness?term_id=<term>` (chunked 5 at a time, same cadence as the publish loop). Cache per `(sectionId, termId)` so re-toggling selection doesn't refetch.
- **Classify each section** from the response:
  - **✗ Blocked (hard):** `comment_gate.ok === false` (covers comments + virtue after Part 1). Excluded from the publish run.
  - **⚠ Warnings (soft):** any of `grading_sheets.unlocked.length`, `attendance.missing.length`, `t4_readiness` not-ready, letterhead missing. Publishes; shown as caution.
  - **✓ Ready:** none of the above.
- **Per-section row** shows a status pill (✓/⚠/✗) + a one-line reason ("2 sheets unlocked", "comments: Term 1 (3) · Term 2 virtue"). A small loading state while readiness is in flight; sections still loading are not publishable yet.
- **Publish behaviour** changes from halt-on-first → **publish-all-non-blocked, skip-blocked, report**: the run publishes every selected ✓ and ⚠ section (soft never blocks bulk — consistent with single-section "publish anyway"), **skips** ✗ sections, and ends with a summary toast (e.g. _"Published 17 · 3 skipped (comments)"_). The publish loop keeps the existing chunked POST + idempotent upsert; the per-section 422 is now _expected_ for skipped rows (pre-filtered out, so it shouldn't fire — but if a section's state changes between check and publish, a 422 is counted as "skipped (blocked)", not a halt).
- The Publish button label reflects the publishable count (✓ + ⚠), e.g. "Publish 17"; blocked count shown separately ("3 blocked").

## Non-goals

- The other soft checks (grading-locked, attendance, T4 grades, letterhead) stay **soft** — not hardened (false-positive/operator-lockout risk; KD #28). No "confirm" speed-bump in this pass.
- No change to the single-section publish flow beyond the virtue fold + the panel comment-row copy.
- No new DB columns, RPCs, or schema changes (`terms.virtue_theme` exists).
- No change to the report-card render (it already gracefully handles a set virtue).

## Verification

- `npx tsc --noEmit` + `npx vitest run` (incl. new virtue cases) + `npx next build` clean.
- **Part 1:** a section with complete comments but a null virtue theme for a displayed term → single-section publish 422s with a virtue message; the checklist comment row shows the virtue gap deep-linking to `/evaluation/virtue-themes`; setting the theme clears it and publish succeeds.
- **Part 2:** open bulk publish for a term where some sections are comment/virtue-blocked, some have unlocked grading, some clean → the dialog shows ✓/⚠/✗ per section; Publish sends the ✓ + ⚠ sections, skips ✗, and the summary toast reports both counts; blocked sections are never silently published.
- Build via subagent-driven development + a `feature-dev:code-reviewer` pass.
