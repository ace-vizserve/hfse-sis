# AY2026 T1 Secondary Regular-Track Grading Import + T2 Filipino Secondary Backfill — Design

**Date:** 2026-07-20
**Status:** New
**Target:** Import HFSE's real T1 Secondary Regular-track grading data into `grading_sheets` / `grade_entries`, and separately backfill T2's Secondary Filipino data that a prior phase incorrectly excluded.

**Scope:** Sub-phase 2 of 2, closing the last T1 grading gap this session's diagnosis found — plus one unrelated, adjacent correction discovered while investigating it. T1's `grading_sheets` currently has 87 rows: 16 from Phase 3 (Discipline 1 + Integrity 1, Global track) and 71 from sub-phase 1 (T1 Primary, applied 2026-07-20). Zero rows exist for Discipline 2, Integrity 2, S3 Consistency, or S4 Excellence (Secondary Regular-track) — confirmed via a live DB query. T2 already has full coverage of these four sections via Phase 6b, so this part of the gap is T1-only.

While inspecting T1's Secondary source data for scope validation, a second, independent problem surfaced: Phase 6b (T2's Secondary import) excluded Filipino from Secondary scope entirely, citing that its T2 workbook tabs were "structurally incomplete." Direct inspection of the real T2 file during this design proved that claim false — the tabs are fully populated with real WW/PT/QA scores, real teacher names, and real printed grades across all four Secondary sections. T2 Secondary Filipino grades have never existed in the system, for any student, because of an incorrect premise. This design fixes both.

## 1. Part A — T1 Secondary Regular-track import

### 1.1 What's different from T2's Secondary import (Phase 6b)

T1's newly-found `Grades/` folder is structurally identical to T2's `GRADES/` folder — same masthead layout, same file-per-subject shape, same Primary+Secondary-Regular tabs riding together in one workbook. Phase 6b's `grading-workbook-secondary-t2.ts` is the direct architectural sibling. One real difference required a new parser rather than reusing that one unmodified: **T1's Secondary tabs carry `DO NOT USE` duplicate tabs that T2's Secondary-Regular tabs never had.**

Direct inspection of all 9 relevant T1 files confirmed: every file with an S4 Excellence tab has exactly one `DO NOT USE ...` tab that resolves to the identical `(subjectCode, levelCode, sectionName)` identity as the real tab. `grading-workbook-secondary-t2.ts` has no such filter (it never needed one) and no dedup call of its own — it relies entirely on the orchestrator's later cross-track merge (`dedupePreferringNonReservedTab`), which only special-cases `Reserved`-prefixed tab names, not `DO NOT USE`-prefixed ones. Naively reusing it for T1 would let a `DO NOT USE` tab and its real counterpart both reach the composer as separate rows sharing one `(term_id, section_id, subject_id)` key — the multi-row `INSERT ... ON CONFLICT DO NOTHING` would then silently keep whichever happened to sort first, an unacceptable, order-dependent risk. The fix is the same explicit filter `grading-workbook-global-t2.ts` already uses for its own DO-NOT-USE tabs: skip immediately, before identity resolution ever runs.

No other duplicate-identity source was found in T1's Secondary tabs. Every `Reserved N` tab observed resolves to a **Primary** identity (Respect/Gentleness/Compassion), never a Secondary one — so no score-based dedup logic is needed here, unlike the Primary parser's `dedupeByIdentityPreferringScored`.

### 1.2 Locked decisions

1. **Scope is 9 subjects × the 4 real Secondary Regular-track sections that have data in each file**: ENG, MATH, SCI, FIL, HIST, LIT, SS, CA, PEH — one more than T2's 8-subject Regular-track list (Filipino is added; see Part B for why T2 excluded it and why T1 does not). Confirmed via direct inspection: History has only Discipline 2 + Integrity 2 tabs (no S3/S4 — genuinely absent from the file, matching T2's precedent exactly); SS & Geo has only S3 Consistency + S4 Excellence tabs (no S1/S2 — same precedent). Mandarin and STAR MAPEH are excluded — confirmed zero Secondary tabs in either file, matching T2's precedent.
2. **`DO NOT USE` tabs are filtered explicitly**, mirroring `grading-workbook-global-t2.ts`'s exact pattern (`sheetName.startsWith('DO NOT USE')`, skip before parsing). Confirmed present in ENG, MATH, SCI, FIL, LIT, SS, CA, and PEH's files — always exactly one, always duplicating a real S4 Excellence tab. History has no S4 tab at all, so it has no DO-NOT-USE tab either.
3. **`subject_configs` writes: none.** All 9 subjects' T1 Secondary header weights were directly verified against the live `subject_configs` and match exactly:

   | Subject | T1 header | Live `subject_configs` |
   | ------- | --------- | ---------------------- |
   | ENG     | 30/50/20  | 30/50/20               |
   | MATH    | 40/40/20  | 40/40/20               |
   | SCI     | 40/40/20  | 40/40/20               |
   | FIL     | 30/50/20  | 30/50/20               |
   | HIST    | 30/50/20  | 30/50/20               |
   | LIT     | 30/50/20  | 30/50/20               |
   | SS      | 30/50/20  | 30/50/20               |
   | CA      | 30/50/20  | 30/50/20               |
   | PEH     | 20/60/20  | 20/60/20               |

   `SUBJECT_CONFIG_WEIGHTS` in the orchestrator is empty on purpose, same as sub-phase 1.

4. **Identity resolution reuses `t2-masthead.ts`'s `resolveIdentity` unchanged.** No new identity logic beyond the DO-NOT-USE filter itself.
5. **Roster resolution, needs-review, and grade computation follow the established pattern**: `(levelCode, sectionName, indexNumber)` lookup against live `section_students`, unresolved → needs-review, grades computed via `lib/compute/quarterly.ts::computeQuarterly` (Hard Rule #1/#2), printed-vs-computed mismatches informational only.
6. **`grading_sheets` locked on import** (`is_locked=true, locked_at=now(), locked_by='backfill-import'`), matching every prior phase.
7. **Single, un-chunked `apply.sql`.** Volume (9 subjects × up to 4 sections × ~13–36 students) is comparable to every prior phase's scale.

### 1.3 Architecture

```
AY2026/T1/Term 1 Grades/Grades/{English,Math,Science,Filipino,History,Literature,SS & Geo,Contemporary Arts,PE (Sec)} Grading AY2026 T1.xlsx
        │
        ▼
scripts/backfill/gen-ay2026-t1-secondary-grading.ts
        │  1. Parse all 9 real subject files via the new
        │     grading-workbook-t1-secondary.ts (DO-NOT-USE filter +
        │     t2-masthead.ts helpers, unchanged)
        │  2. Query DB: section_students for AY2026's real Secondary
        │     sections
        │  3. No subject_configs writes (empty list)
        │  4. Resolve roster, compute grades, cross-check printed vs
        │     computed
        │  5. Emit SQL — single apply.sql
        ▼
ay2026-t1-secondary-grading-preview.sql   ← reviewed first
ay2026-t1-secondary-grading-apply.sql     ← reviewed + run manually
```

Two new library files, one new orchestrator:

- `lib/sis/backfill/grading/grading-workbook-t1-secondary.ts` — near-verbatim copy of `grading-workbook-secondary-t2.ts`, plus the `DO NOT USE` skip from `grading-workbook-global-t2.ts`. Exports `ParseGradingWorkbookT1SecondaryResult` (sheets, sheetNames, skippedPrimary, skippedDoNotUse, skippedUnrecognized, identityCorrections, truncationNotes).
- `lib/sis/backfill/grading/build-t1-secondary-grading-import.ts` — near-verbatim copy of `build-secondary-grading-import.ts` (only title strings change: "T2 Secondary" → "T1 Secondary"), matching the established composer-duplication convention.
- `scripts/backfill/gen-ay2026-t1-secondary-grading.ts` — mirrors `gen-ay2026-t2-secondary-grading.ts`'s Regular-track half only (no Global-track merge — Phase 3 already owns T1's Global track, untouched here, so no cross-track dedup call is needed either).

### 1.4 SQL write plan (idempotent — safe to rerun)

1. No `subject_configs` writes.
2. `grading_sheets` — one row per (subject, Secondary section) pair with real data, `ON CONFLICT (term_id, section_id, subject_id) DO NOTHING`, locked on import.
3. `grade_entries` — one row per resolved student per subject, `ON CONFLICT (grading_sheet_id, section_student_id) DO NOTHING`.
4. No `subject_level_offerings` / `section_subjects` writes — already populated.

### 1.5 Validated real numbers (from a real parse run during design)

32 sheets, 768 raw student rows, 8 DO-NOT-USE tabs correctly filtered, 64 Primary tabs correctly skipped (owned by sub-phase 1), 0 unrecognized tabs, 0 identity corrections, 6 truncation notes (all genuine Excel 31-character tab-name truncations, already handled by existing logic — e.g. `"Social Studies&Geography - S3 C"` → row 2's fuller `"Consistency"`).

## 2. Part B — T2 Secondary Filipino backfill

### 2.1 Why this exists

Phase 6b's design doc states Filipino was "explicitly excluded from Regular-track Secondary scope" because its T2 tabs were found to be "structurally incomplete: only a `WRITTEN WORKS (30%)` block ... with no Performance Tasks block, no Exam/QA column, and no printed Initial/Quarterly grade columns at all," and concluded this was "consistent with Filipino not being a taught Secondary subject at HFSE."

Direct inspection of the real file during this design (`AY2026/T2/Term 2 Grades/GRADES/Filipino Grading AY2026 T2.xlsx`) shows this is false. All four Secondary tabs (`Filipino - S1 Discipline 2` through `S4 Excellence`) have the complete `WRITTEN WORKS (30%)` / `PERFORMANCE TASKS (50%)` / `QUARTERLY ASSESSMENT (20%)` structure, real teacher names (Ms. Melissa, Ms. Med), real per-student scores, and real printed Initial/Quarterly grades. The subject is genuinely taught and genuinely graded. The exclusion was based on an incorrect claim, not a real data limitation — confirmed by re-parsing the file with the existing, unmodified `parseGradingWorkbookSecondaryT2`, which produces 4 clean sheets with zero errors.

A systematic audit of every other file across both AY2026 terms' Secondary/Global folders (done as part of this design, prompted by this discovery) found no other instance of this problem — every other exclusion in this project's grading-backfill history (corrupted `Copy of ...` duplicates, CCA's activity-rostered tabs, Mandarin/STAR MAPEH's genuine absence of Secondary tabs) is independently re-confirmed correct by direct inspection, not merely trusted from prior docs.

### 2.2 Locked decisions

1. **Scope is exactly one subject, one file, one term**: Filipino, `AY2026/T2/Term 2 Grades/GRADES/Filipino Grading AY2026 T2.xlsx`, T2. Not a broader re-audit of Phase 6b's other subjects.
2. **Zero new code.** Reuses `parseGradingWorkbookSecondaryT2` and `buildSecondaryGradingImport` completely unmodified — T2's Filipino Secondary tabs have no `DO NOT USE` duplicates (confirmed: exactly 4 sheets, no extras), so none of Part A's new parser logic is needed here.
3. **A standalone, dedicated correction script**, not a regeneration of Phase 6b's original `gen-ay2026-t2-secondary-grading.ts` output. This follows the same precedent as this session's earlier Filipino/Global Perspectives weight correction (`gen-ay2026-t2-fil-gp-weight-correction.ts`): when a real bug is found in already-applied data, the fix is a new, narrowly-scoped script, keeping the original phase's on-disk artifacts stable and auditable rather than silently regenerating them to look like they always covered this.
4. **`subject_configs` writes: none.** FIL's T2 header (ww=0.3, pt=0.5, qa=0.2) matches the live `subject_configs` row exactly (the same row already corrected this session for Primary FIL/GP weights — one `subject_configs` row per `(academic_year, subject)`, not per level, so this confirms the same value is correct for both Primary and Secondary uses).
5. **`grading_sheets` locked on import**, matching every prior phase.
6. **No collision with existing T2 Secondary data.** Filipino was never in Phase 6b's subject list, so its `(term_id, section_id, subject_id)` keys are entirely new — nothing to conflict with.

### 2.3 Architecture

```
AY2026/T2/Term 2 Grades/GRADES/Filipino Grading AY2026 T2.xlsx
        │
        ▼
scripts/backfill/gen-ay2026-t2-filipino-secondary-backfill.ts
        │  1. Parse via the EXISTING, unmodified
        │     parseGradingWorkbookSecondaryT2
        │  2. Query DB: section_students for AY2026's real Secondary
        │     sections
        │  3. No subject_configs writes
        │  4. Resolve roster, compute grades via the EXISTING
        │     buildSecondaryGradingImport
        ▼
ay2026-t2-filipino-secondary-backfill-preview.sql
ay2026-t2-filipino-secondary-backfill-apply.sql
```

One new file: `scripts/backfill/gen-ay2026-t2-filipino-secondary-backfill.ts` — a small orchestrator, structurally similar to `gen-ay2026-t1-secondary-grading.ts` but with a one-subject file list and calling the pre-existing T2 parser/composer directly (no new library code).

### 2.4 Validated real numbers (from a real parse run during design)

4 sheets (S1 Discipline 2, S2 Integrity 2, S3 Consistency, S4 Excellence), 94 raw student rows (14+18+26+36), 0 unrecognized tabs, 0 truncation notes. Two identity-correction notes will appear in the preview (both already-proven cases of the existing tab-name-wins logic: a Primary tab, `Filipino - P6 Loyalty` vs row 2's `P6 Grit`, out of this phase's scope but incidentally reported by the parser; and `Filipino - S2 Integrity 2` vs row 2's `S2 Integrity` — the tab name correctly wins in both).

## 3. Validation plan (both parts)

1. Run each generator; read its preview report.
2. Part A: confirm the DO-NOT-USE skip count (8) and excluded-Primary-tab count (64) match design expectations; confirm the 6 truncation notes are the same ones found during design.
3. Part B: confirm the 2 identity-correction notes match design expectations; confirm 94 raw students across 4 sheets.
4. Spot-check a handful of students' computed grades against the real workbooks in both.
5. Run each `apply.sql` (single file, one connection/session, run separately).
6. Read-only follow-up: confirm T1's `grading_sheets` now covers Discipline 2/Integrity 2/Consistency/Excellence (bringing T1 to full coverage, all 6 Secondary sections + 14 Primary sections); confirm T2's Secondary Filipino count goes from 0 to 4 sheets; spot-check a Secondary student's report card/Markbook view for both terms.

## 4. Testing

- **Part A (new code):** `grading-workbook-t1-secondary.ts` gets a real-fixture test file mirroring sub-phase 1's pattern — asserts the exact validated counts above (32 sheets, 768 students, 8 DO-NOT-USE filtered, 0 identity corrections, 6 truncation notes), and explicitly asserts that a known DO-NOT-USE tab (e.g. `"DO NOT USE Math - S4 Excellence"`) appears in `skippedDoNotUse`, never in `sheets`. `build-t1-secondary-grading-import.ts` gets synthetic-fixture tests mirroring `build-secondary-grading-import.ts`'s existing suite, including an explicit empty-`subjectConfigWeights` case.
- **Part B (reused code):** no new unit tests — 100% reuse of `parseGradingWorkbookSecondaryT2` and `buildSecondaryGradingImport`, both already covered by Phase 6b's existing test suite. No dedicated orchestrator test file, per every prior phase's established pattern.
- Full-suite regression run (`npx vitest run`) after both are implemented.

## 5. Out of scope

- Any further re-audit of Phase 6b's already-applied T2 Secondary subjects beyond Filipino. The systematic folder/file audit performed during this design (every AY2026 grading folder, every file, cross-checked against every phase's scope) found no other gap of this kind — but a full per-student, per-score re-verification of already-applied T2 data is a separate, much larger undertaking not triggered by this specific finding.
- T2's `Integrity 2` grading_sheets count (6, one fewer than the other Regular-track sections' 7) noticed incidentally during this design's audit. Not investigated further here — it may be a genuine per-subject absence (like History's S3/S4 or SS & Geo's S1/S2) rather than a gap, but this hasn't been confirmed and is not part of either fix in this design.
- CCA (Sec)'s activity-rostered grading data (Basketball/Volleyball/Badminton/Track&Field) — confirmed structurally different (roster is per-activity, not per-section) and out of scope, matching Phase 6b's original deferral.
- T3/T4 grading data — both source folders are currently empty; no data exists to import yet.
