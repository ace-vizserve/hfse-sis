# AY2026 T2 Secondary Grading Sheets Import — Design

**Date:** 2026-07-19
**Status:** Design (approved in brainstorming; pending spec review)
**Target:** Import HFSE's real T2 Secondary grading data (Regular track: 5 subjects × 4 sections from `GRADES/`, plus Global track: 8 subjects × 2 sections from `Lower Secondary Global Grading Sheets/`) into `grading_sheets` / `grade_entries`, with `subject_configs` verified but expected to need zero corrections.

**Scope:** Phase 6b — the second half of the T2 grading sequence, following the completed Phase 6a (Primary). CCA (Co-curricular Activities) is explicitly deferred — its workbook is shaped by activity roster, not by section, and doesn't fit this or any prior phase's per-section import model.

---

## 1. Why this phase, and what's different from Phase 6a (Primary)

Phase 6a built and shipped `grading-workbook-t2.ts`, which already handles the T2 masthead shape (row 2 identity / row 3 teacher / row 5–8 weight+column labels / row 9+ students), the spurious second `"Quarterly"/"Term 1"` column pair bug, and — after a real run surfaced a genuine defect — a tab-name-first identity resolver (row 2's free text is sometimes simply wrong, a copy-paste artifact from cloning a template tab). Direct inspection of Phase 6b's two source areas found:

1. **The `Lower Secondary Global Grading Sheets/` folder (Global track) has the identical masthead shape to T1's Phase 3 source, including the same spurious-column bug Phase 6a fixed.** Confirmed on the real T2 Mathematics file: `col18=80` is the real Quarterly grade, `col23/24 = 80.00/89` is the same kind of unreliable trailing pair Phase 6a found in the Primary `GRADES/` files. Phase 3's original `findPrintedGradeCols` (last-match) would misread this too — this phase reuses Phase 6a's fix, not Phase 3's original.
2. **A second, previously-unseen identity bug, in the opposite direction from Phase 6a's.** Some `GRADES/`-folder Secondary tab names are truncated by Excel's 31-character sheet-name limit — e.g. `"Social Studies&Geography - S3 C"` (31 characters exactly) is really `"...S3 Consistency"`, cut off; `"Contemporary Arts - Sec 1 Disci"` is really `"...Discipline 2"`. Phase 6a's "tab name always wins" rule would extract a garbage 1–5 letter section name from these. Row 2 (uncut, since it's cell content rather than a tab name with a length limit) carries the real text in these specific cases — confirmed correct against every truncated tab found. This is a genuinely different failure mode from Phase 6a's (there, row 2 was wrong and tab name was right) and needs a real rule enhancement, not a re-derivation of the same fix.
3. **The `CCA (Sec) Grading AY2026 T2.xlsx` workbook has 4 tabs named by activity** (`CCA Basketball`, `CCA Volleyball`, `CCA Badminton`, `CCA Track&Field`), not by level/section — row 2 for each tab is just the tab name repeated. A co-curricular activity's roster plausibly spans students from multiple different homeroom sections, which doesn't fit the "one `grading_sheets` row per `(subject, section)`" model every subject in this project (T1 and T2 alike) has used so far. **Confirmed with the user: deferred, not built this phase** — CCA needs its own investigation into how its roster actually maps to sections (or whether it needs a different data model entirely) before it can be designed, let alone built.

## 2. Locked decisions

1. **Scope is Regular-track Secondary + Global-track Secondary, CCA excluded.** Regular track (4 sections: Discipline 2, Integrity 2, Consistency, Excellence) draws from the same `GRADES/` folder Phase 6a already used, now processing the Secondary tabs that phase explicitly skipped: Literature (all 4 sections), History (S1/S2 only — confirmed via direct inspection, no S3/S4 tabs exist in the file), SS & Geo (S3/S4 only — confirmed, no S1/S2 tabs), Contemporary Arts (all 4), PE (Sec) (all 4, subject code `PEH`), plus the ENG/MATH/SCI tabs in Math/English/Science `GRADES/` files (same files Phase 6a already parses for Primary — this phase's parser call additionally captures their Secondary tabs). Global track (2 sections: Discipline 1, Integrity 1) draws from `Lower Secondary Global Grading Sheets/`, the same 8 subjects as T1's Phase 3 (ARTD, COMP, ENG, GP, HUM, MATH, PEH, SCI), explicit file list excluding `Copy of English/Science/Mathematics...` (corrupted duplicates — the T2 `Copy of Mathematics...` file's corruption sits in the already-ignored spurious column this time, not the NAME column like T1's, but it is excluded anyway on the same standing policy: a file already flagged as a known duplicate is never read, regardless of exactly where its corruption happens to land) and `"DO NOT USE ..."` tabs (Phase 3's exact exclusion, reused as-is).
   **Filipino (`Filipino Grading AY2026 T2.xlsx`) is explicitly excluded from Regular-track Secondary scope**, even though its file physically contains `S1`–`S4` tabs with real student names — direct inspection found those tabs structurally incomplete: only a `WRITTEN WORKS (30%)` block (W1/W2/W3/Total), with no Performance Tasks block, no Exam/QA column, and no printed Initial/Quarterly grade columns at all. Attempting to run the standard column-layout finder against this shape would throw (`could not locate WW/PT Total columns or the Exam column`), since there is genuinely no PT block to find. This is consistent with Filipino not being a taught Secondary subject at HFSE (it was already absent from this session's established Secondary-Regular-track subject list, derived independently from real T2 header data) rather than a parsing bug — the Secondary-track orchestrator's explicit subject-file list omits Filipino's file entirely, so this incomplete shape is never even attempted. (Mandarin and STAR/MAPEH's `GRADES/`-folder files need no equivalent exclusion — direct inspection confirmed neither file has any Secondary tabs at all to iterate over.)
2. **CCA is out of scope**, per the discussion above — deferred to its own future phase once its roster-to-section relationship is understood.
3. **Shared module extraction.** Per the explicit recommendation in Phase 6a's final whole-branch review ("if Phase 6b introduces a third parser, extract the shared masthead helpers... a third copy-paste would tip into excessive"), a new `lib/sis/backfill/grading/t2-masthead.ts` houses the reusable, already-proven T2-specific pieces: `cell`/`numOrNull` primitives, `findColumnLayout`, `weightAt`, the fixed `findPrintedGradeColsT2` (first-match), `titleCase`, `parseTeacherName`, and the identity resolver (enhanced per Locked Decision #4 below). **Phase 6a's `grading-workbook-t2.ts` is refactored to import from this module instead of duplicating its own copies — a pure extraction, no behavior change.** Phase 6a's existing test suite must pass completely unchanged after the refactor; this is the verification that the extraction introduced no regression.
4. **Identity resolution gains a truncation-aware rule, layered on top of Phase 6a's tab-name-first rule.** When the tab name parses to a shorter section name that is a case-insensitive **prefix** of what row 2 parses to (e.g. tab-derived `"C"` vs row2-derived `"Consistency"`; tab-derived `"Disci"` vs row2-derived `"Discipline 2"`) — this is recognized as **tab-name truncation**, not a real disagreement, and row 2's fuller text is used instead. This is logged in preview.sql under a distinct heading (`"tab name truncated — using row 2's fuller label"`) separate from Phase 6a's disagreement-correction heading, since it's a different situation (the tab name gave a real but incomplete signal, not a wrong one). Every other case where both signals parse and disagree keeps Phase 6a's original rule: tab name wins, logged as a correction. When the tab name doesn't parse at all, row 2 is the fallback (unchanged from Phase 6a).
5. **`subject_configs` is expected to need zero corrections** — every relevant subject (ENG, MATH, SCI, CA, LIT, HIST, SS, PEH) is already `weights_confirmed=true` with a value matching the real T2 header data, verified via direct query before writing any code (PE (Sec)'s real 20/60/20 exactly matches the DB's current `PEH` row; CA/LIT/HIST/SS were already hand-verified against real T2 Secondary data during an earlier ad-hoc backfill this session). The composer still performs the same read-and-compare Phase 6a's did — this is a verified expectation, not an assumption baked in as "skip the check."
6. **No `subject_level_offerings` or `section_subjects` writes.** Regular-track section_subjects rows were already created by this session's earlier ad-hoc `gen-ay2026-remaining-sections-subjects.ts` script; Global-track section_subjects rows were already created by Phase 3's T1 import (that composer's `section_subjects` insert links `(section_id, subject_config_id)` — not term-scoped, so a row created for T1 already covers T2 too). This phase reads them for roster/section resolution but never writes them.
7. **Roster resolution, needs-review, and grade computation follow the established pattern**: `(levelCode, sectionName, indexNumber)` lookup against live `section_students`, unresolved → needs-review (never guessed); grades computed via importing `lib/compute/quarterly.ts::computeQuarterly` directly (Hard Rule #1/#2); a printed-vs-computed mismatch is informational only.
8. **`grading_sheets` are locked on import** (`is_locked=true, locked_at=now(), locked_by='backfill-import'`), matching every prior phase.
9. **Single, un-chunked `apply.sql`.** Volume here (13 subjects × up to 4 sections × ~20–30 students) is comparable in scale to Phase 6a's, well under the threshold that forced Phase 2's chunking.
10. **Accepted residual risk carried over from Phase 6a (unchanged, not re-litigated here):** student resolution remains index-number-only, no name cross-check — same locked project convention every phase uses, per Phase 6a's design doc §7 note.

## 3. Architecture

```
lib/sis/backfill/grading/t2-masthead.ts                          (new, shared)
        ▲                        ▲                        ▲
        │                        │                        │
grading-workbook-t2.ts    grading-workbook-        grading-workbook-
(Phase 6a, refactored      secondary-t2.ts (new)    global-secondary-t2.ts (new)
 to consume the shared     — GRADES/ Secondary       — Lower Secondary Global
 module; Primary-only      tabs (Regular track)       Grading Sheets/ (Global
 behavior unchanged)                                  track)
        │                        │                        │
        └────────────────────────┴────────────────────────┘
                                  │
                 scripts/backfill/gen-ay2026-t2-secondary-grading.ts
                        │  1. Parse GRADES/ files (Secondary tabs only —
                        │     Primary tabs from the same files are ignored,
                        │     already handled by Phase 6a)
                        │  2. Parse Lower Secondary Global Grading Sheets/
                        │     files (explicit list, skip DO NOT USE tabs)
                        │  3. Query DB: section_students for AY2026's 6
                        │     Secondary sections (4 Regular + 2 Global)
                        │  4. Verify subject_configs — expect 0 corrections,
                        │     but actually check, not assume
                        │  5. Resolve roster, compute grades, cross-check
                        │  6. Emit SQL — single apply.sql
                        ▼
        ay2026-t2-secondary-grading-preview.sql   ← reviewed first
        ay2026-t2-secondary-grading-apply.sql     ← reviewed + run manually
```

## 4. SQL write plan (idempotent — safe to rerun)

1. **`subject_configs`** — 0 rows expected; the composer still emits a correction block if the verification ever finds a real mismatch (mirrors Phase 6a's mechanism exactly, just with an empty input list going in).
2. **`grading_sheets`** — one row per (subject, Secondary section) pair with real data, `ON CONFLICT (term_id, section_id, subject_id) DO NOTHING`, locked on import.
3. **`grade_entries`** — one row per resolved student per subject, `ON CONFLICT (grading_sheet_id, section_student_id) DO NOTHING`.
4. **No `subject_level_offerings` / `section_subjects` writes.**

`preview.sql` follows the same shape as Phase 6a's, with two additions: a "tab name truncated" section (distinct from the "identity corrections" section) and a per-source-folder breakdown (Regular vs Global track) so a reviewer can see at a glance which track each row came from.

## 5. Validation plan

1. Run the generator; read the preview report.
2. Hand-verify the truncation-detection cases (SS & Geo, Contemporary Arts) resolved to their full, correct section names, and that the identity-correction list (if any) makes sense.
3. Confirm the `subject_configs` section reports 0 actual corrections (matching the design's expectation) — if it reports any, stop and investigate before running apply.sql, since that would mean a real subject weight discrepancy this design didn't anticipate.
4. Spot-check a handful of students' computed-vs-printed grades against the real workbook, one per track.
5. Run `apply.sql` (single file, one connection/session).
6. Read-only follow-up query confirms `grading_sheets` and `grade_entries` row counts.

## 6. Testing

- **Unit:** the truncation-aware identity resolver (tested against the real SS & Geo / Contemporary Arts truncated-tab-name fixtures, proving row 2 wins specifically in the truncation case while Phase 6a's existing disagreement-correction behavior is unchanged for non-truncation cases), plus the two new parser files' Secondary/Global classification.
- **Regression:** Phase 6a's full existing test suite must pass unchanged after the `t2-masthead.ts` extraction — this is the primary proof the refactor didn't change behavior.
- **Reused, not retested:** row-boundary detection, `DO NOT USE` tab exclusion (Global-track folder, reused verbatim from Phase 3), and max-score-blank-means-slot-unused exclusion.
- No integration test suite — operator tooling, reviewed by hand via the preview report, same as every prior phase.

## 7. Out of scope

- CCA (Co-curricular Activities) — deferred to its own future phase (Locked Decision #2).
- Phase 7 (T2 evaluation write-ups) and Phase 8 (Records cross-check against the Term 2 CONSOLIDATED FORM) — separate specs.
- Re-resolving any students who were already unresolved in earlier phases' needs-review buckets.
- Re-litigating Phase 6a's accepted residual risk (index-only student resolution) — carried forward unchanged.
