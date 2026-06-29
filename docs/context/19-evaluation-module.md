# Student Evaluation Module

> **Status:** ✅ **Shipped — FCA write-ups only.** PTC features (checklists, subject comments, PTC feedback) were **removed from the UI and API in KD #114** (routes 410 Gone; DB tables kept dormant). The Evaluation module is now exclusively the form-class-adviser write-up surface. Virtue-theme editor shipped at `/evaluation/virtue-themes` (KD #137). FCA chase metrics (outstanding write-ups + advisers behind) added to the registrar dashboard (KD #126).

## Contract

The Evaluation module owns the form class adviser's **holistic write-up per student per term** — the text that appears as "Form Class Adviser's Comments" on printed T1–T3 report cards. That is the **only** thing from this module that flows to the report card.

Grades come from Markbook; attendance from the Attendance module. The **virtue theme** that frames each term comes from `terms.virtue_theme` — now edited at `/evaluation/virtue-themes` (KD #137; previously in `/sis/ay-setup`'s term-dates dialog, which still accepts the field for back-compat but no longer shows it in the UI). Evaluation reads the virtue theme and surfaces it as a prompt to advisers + as the parenthetical on the report card label.

**T4 is out of scope** — the final report card has no comments section. The section picker, publish gate, and chase metrics all exclude T4.

## Agreed decisions (do not re-derive)

- **`evaluation_writeups` is the sole source** of the "Form Class Adviser's Comments" field on T1–T3 report cards. `lib/report-card/build-report-card.ts` reads from it.
- **Virtue theme is now a hard publish gate (KD #138)** — a T1–T3 card cannot be published until each displayed term's virtue theme is set AND its FCA comment is submitted + non-empty (KD #129). Set at `/evaluation/virtue-themes`.
- **Write-up entry is explicit manual save, not autosave (KD #49, updated 2026-06-03):** each student row has **Save as draft** + **Submit** buttons. Nothing persists until a button is clicked. Save-as-draft on a finalised write-up demotes it back to draft. Honest persistent save state (Unsaved changes ↔ Saving… ↔ Saved ↔ Error) + per-row Empty/Draft/Submitted pill.
- **`submitted` is the publish gate for comments.** A submitted + non-empty write-up counts toward the hard gate; draft/empty does not.
- **Subject-teacher access to the module was removed (KD #114).** Only form advisers (write-ups) and registrar+ (read-only oversight).

## Routes

- `/evaluation` — hub landing (orientation + entry links).
- `/evaluation/sections?term_id=…` — section picker. Teachers see only their `form_adviser` sections; registrar+ sees the full AY. Per-section progress bar (`submitted / total`).
- `/evaluation/sections/[sectionId]?term_id=…` — write-up roster for one section × term. Virtue-theme banner at top; one textarea + Save as draft / Submit per student.
- `/evaluation/virtue-themes` — registrar+ sets `terms.virtue_theme` per term (T1–T3 only; T4 excluded per KD #49). Inline inputs + save. `PATCH /api/evaluation/virtue-theme`. Audit: `ay.term_virtue.update`. (KD #137)
- `/evaluation/insights` — Evaluation has no Insights surface (the write-up dashboard IS the insight — see KD #143 / KD #140 governance).
- `/evaluation/audit-log` — module-scoped audit log (evaluation + virtue-theme + FCA audit actions allowlist, KD #9).

## Data model

- `evaluation_writeups(term_id, student_id, section_id, writeup, submitted, submitted_at, created_by)` — unique `(term_id, student_id)`. `section_id` is **denormalized and not updated on transfer** (KD #120). All code that counts or groups write-ups per section MUST resolve via the student's current active `section_students` row, not `evaluation_writeups.section_id`.
- `terms.virtue_theme text` — per-term free-text label. Edited at `/evaluation/virtue-themes`.

**Dormant tables (schema intact, no UI, all write routes 410 Gone):**

- `evaluation_checklist_items` — per-section × subject × term topic list (teacher-owned scope per KD #93).
- `evaluation_checklist_responses` — 1–5 ratings per item (KD #92).
- `evaluation_subject_comments` — per-subject teacher comments.
- `evaluation_ptc_feedback` — conference notes.

If HFSE requests a PTC surface in future, build it as a separate route/tab with zero coupling to the write-up flow. The DB tables are ready.

## Access

| Role                                       | What they can do                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `teacher` (with `form_adviser` assignment) | Read + write write-ups for their assigned sections only.                                          |
| `teacher` (subject_teacher only)           | No access (KD #114 removed subject-teacher access entirely).                                      |
| `registrar`                                | Read + write all sections. Sets virtue themes at `/evaluation/virtue-themes`.                     |
| `school_admin` / `superadmin`              | Read + write all sections. Access virtue-themes editor (school_admin+).                           |
| `p-file`, `admissions`                     | No access.                                                                                        |
| parent                                     | Sees the submitted write-up text on the published report card only (via the external parent SPA). |

## Workflows

1. **Virtue theme setup** — registrar opens `/evaluation/virtue-themes` → edits T1/T2/T3 virtue themes → saves. Audited `ay.term_virtue.update`. (Hard publish gate — must be set before that term's report cards can be published, KD #138.)
2. **Adviser writing** — form adviser opens `/evaluation/sections` → picks their section → lands on the roster with virtue-theme banner + one textarea per student → types → clicks **Save as draft** or **Submit**.
3. **Registrar chase view** — `/evaluation/sections` shows per-section `N / M submitted` progress bars. Registrar dashboard also shows **Outstanding write-ups** count (active-roster students lacking a submitted + non-empty write-up) + **Advisers behind** grouped by adviser (sorted biggest-gap-first; "Unassigned" bucket for sections with no form adviser, KD #126). Both are **live-state metrics** (not date-windowed; anchored to the current term, KD #124).
4. **Report-card generation** — `lib/report-card/build-report-card.ts` pulls the write-up + the viewing term's `virtue_theme`. `ReportCardDocument` renders "Form Class Adviser's Comments (HFSE Virtues: {theme})" as the section heading. The T2 card includes T1 + T2 comments; T3 includes all three (KD #129 cumulative render).
5. **Pre-publish hard gate** — `POST /api/report-card-publications` blocks with 422 `comments_incomplete` until every cumulative term (1..N, T1–T3 only) has a submitted + non-empty write-up AND a virtue theme (KD #129/#138). The `publish-readiness` checklist shows the comment row as destructive "Required to publish."

## Removed features (KD #114)

These were removed from the UI and API in KD #114 (2026-05-30):

- **Topics / Checklists tab** — `evaluation_checklist_items` management; 1–5 proficiency ratings per topic (KD #92, #93). Routes 410 Gone.
- **Conference Notes tab** — PTC feedback capture (KD #103). Routes 410 Gone.
- **Subject-teacher access** — subject teachers no longer access `/evaluation` (reversed KD #106).
- **PTC readiness banners** — removed from the roster page.

Routes 410'd: `POST /api/evaluation/checklist-items`, `PATCH/DELETE /api/evaluation/checklist-items/[id]`, `PATCH /api/evaluation/checklist-responses`, `PATCH /api/evaluation/subject-comments`, `PATCH /api/evaluation/ptc-feedback`.

## See also

- `CLAUDE.md` KD #49 — Evaluation owns the FCA write-up; T4 excluded; virtue theme is the FCA heading.
- `CLAUDE.md` KD #114 — PTC features removed (not deferred).
- `CLAUDE.md` KD #120 — write-up counts are roster-based + transfer-safe (don't use `writeup.section_id`).
- `CLAUDE.md` KD #126 — Outstanding write-ups + Advisers behind chase metrics.
- `CLAUDE.md` KD #129 / #138 — comments + virtue theme are hard publish gates.
- `CLAUDE.md` KD #137 — virtue-themes editor at `/evaluation/virtue-themes`.
- `lib/report-card/build-report-card.ts` — consumer of `evaluation_writeups`.
- `lib/evaluation/queries.ts` — read helpers (roster-safe write-up counts).
- `lib/evaluation/drill.ts` — `buildChaseState` (pure chase-state aggregator, unit-tested).
- `app/api/evaluation/writeups/route.ts` — PATCH endpoint (Save as draft + Submit).
- `app/api/evaluation/virtue-theme/route.ts` — virtue-theme PATCH (registrar+).
