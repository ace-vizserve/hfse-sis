# Bulk-publish dialog — concern-aware fix links (expandable rows) — design spec

**Date:** 2026-06-11
**Status:** Design — approved, pending plan
**Scope:** Redesign the per-section readiness rows in the bulk-publish report-cards dialog so each section expands to a mini checklist of its **specific** publish-readiness concerns, each a deep-link to the right fix surface carrying the selected term. UI-only; no API/route changes.

## Context

`components/admin/bulk-publish-dialog.tsx` lists every section for a chosen term with a readiness pill (ready / warn / blocked) computed by `classify()` from each section's `GET /api/sections/[id]/publish-readiness` verdict (`hardBlockers` / `softGaps` — `PublishBlocker[] = {code,label,count?}`, KD #139 — plus `comment_gate` carrying per-term `virtue_missing`). Today every row has **one generic link → always `/markbook/grading`**, regardless of the actual concern. The single-section `publish-window-panel.tsx` already does concern-specific deep-links (KD #75) — this brings the bulk dialog to parity, condensed.

## Design

### Row (compact, unchanged height)

`[checkbox] [level · name] [readiness pill] [⌄ disclosure]`. The current `<label>` wrapper (whole-row toggles the checkbox) becomes a `<div>`; the `Checkbox` keeps its own toggle, and a separate **chevron disclosure button** (`aria-expanded`, keyboard-focusable, `ChevronDown` rotating) expands the concern panel. **Ready** sections render no chevron (nothing to fix). **Blocked** rows keep the checkbox disabled (unpublishable) but stay expandable — that's how the registrar reaches the fix links.

### Expanded concern panel (indented, below the row)

One mini row per concern (mirrors `ChecklistRow`, condensed): a **status-tinted icon** (`destructive` for hard blockers, `amber`/warning for soft gaps) + the gap's plain-English **label** (already on `PublishBlocker.label`) + an outline **"Open ↗"** link button to that concern's fix surface — **opens in a new tab** (`target="_blank"`, dialog stays open), `stopPropagation` so it never toggles the checkbox. Color is never the only signal (icon + label + the pill). The selected **term** (`termId` state) is carried into the links live.

### Concern → fix-link map (by gap `code`)

| code                                                       | label source       | destination                                                                |
| ---------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------- |
| `attendance_incomplete`                                    | gap.label          | `/attendance/{sectionId}?term_id={termId}`                                 |
| `comments_incomplete` → comments                           | "Adviser comments" | `/evaluation/sections/{sectionId}?term_id={termId}`                        |
| `comments_incomplete` → virtue                             | "Virtue theme"     | `/evaluation/virtue-themes`                                                |
| `no_grading_sheets` / `sheets_unlocked` / `grades_missing` | gap.label          | `/markbook/grading?grading.section={encodeURIComponent(name)}`             |
| `nonexam_finals_missing`                                   | gap.label          | `/markbook/report-cards`                                                   |
| `letterhead_incomplete`                                    | gap.label          | `/sis/admin/school-config`                                                 |
| `no_students`                                              | gap.label          | **no link** (structural — no one-click fix; render as a plain labeled row) |

`comments_incomplete` is split into up to two concern rows using `comment_gate.gaps`: a **comments** row when any gap has missing students, a **virtue** row when any gap has `virtue_missing` (mirrors the single-section panel, KD #75/#137). Both are hard (destructive).

### Data

No new fetches. `classify()` already has the full readiness response per section; extend the stored per-section readiness to keep the **concern list** (derived from `hardBlockers`+`softGaps` codes + the comment/virtue split), each entry `{ code, label, severity: 'hard'|'soft', href: string | null }`. The href is computed in the row from `sectionId` / `sectionName` / `termId`. `attendance` + `evaluation` destinations accept `?term_id=` (verified); grading uses the `grading.section` client facet (KD #84).

### Component boundary

Extract a **`SectionReadinessRow`** component (own expand state via `useState`) — the dialog file is ~575 lines; this keeps it focused. A small pure `concernsFor(readiness)` → `Concern[]` helper (code→label/severity + the comment/virtue split) is unit-testable; href derivation is a pure `concernHref(code, {sectionId, sectionName, termId})`.

## Out of scope

- The publish POST flow, `classify()`'s ready/warn/blocked verdict, the readiness route — unchanged.
- The single-section `publish-window-panel` — unchanged (already concern-aware).
- `no_students` quick-fix link (no single destination).

## Verification

- `npx tsc --noEmit` + `npx next build` clean; unit test for `concernsFor` (code mapping + comment/virtue split + ready→empty).
- Manual (test AY): a warn/blocked section expands to its concerns; each "Open ↗" goes to the right surface in a new tab with `?term_id` = the selected term; changing the term updates the links; ready sections have no chevron; blocked checkbox stays disabled but expandable; chevron keyboard-operable (`aria-expanded`). Tokens only.
- One small branch; `feature-dev:code-reviewer` (concern mapping correctness incl. comment/virtue split + term param; a11y of the disclosure; tokens). No migration.
