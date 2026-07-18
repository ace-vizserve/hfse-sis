# AY2026 T2 Primary Grading Sheets Import — Design

**Date:** 2026-07-18
**Status:** Amended (see §8 — Tasks 1–3 implemented + reviewed; Task 4 added after a real run surfaced 2 findings)
**Target:** Import HFSE's real T2 Primary grading data (6 subjects × 17 real sections — see §8 Finding A, corrects the "14" figure below) into `subject_configs` (corrections only) / `grading_sheets` / `grade_entries`.

**Scope:** Phase 6a — the first half of the T2 grading sequence, split from the original single "T2 grading" phase because the full-roster scope (Primary + Secondary, ~5x T1's volume) was judged better done as two passes. Phase 6b (Secondary — Regular + Global track, plus the newly-discovered CCA subject) is a separate, later spec.

---

## 1. Why this phase, and what's different from T1's grading import (Phase 3)

Phase 3 imported T1's grading data from `Lower Secondary Global Grading Sheets/` — 8 subjects, exactly 2 sections (Discipline 1, Integrity 1), Secondary Global Class only. T2's source for Primary grading is a **different folder entirely**: `AY2026/T2/Term 2 Grades/GRADES/`, which mixes Primary and Secondary Regular-track tabs in the same per-subject workbooks. Direct inspection of the real files confirmed the masthead row layout (row 2 identity / row 3 teacher / row 5–7 weight+column labels / row 8 max-scores / row 9+ students) is the same shape Phase 3's parser already handles — but three real differences were found:

1. **Primary's row-2 identity text has no numeric section suffix.** T1's format was `"Secondary N WORD N"` (e.g. `"Secondary 1 DISCIPLINE 1 "`) — level, word, and a repeated section number. T2 Primary rows read `"Primary 1 PATIENCE - MATH"` — level, a single virtue word (the section name, no trailing number), then a `" - SUBJECT"` suffix T1's format never had. Confirmed identical across every sampled Primary tab in Math/English/Science/Filipino. (Secondary Regular-track rows in the same folder, e.g. `"Secondary 1 DISCIPLINE 2 - LITERATURE"`, DO carry a numeric suffix as part of the section name itself — relevant only to the deferred Phase 6b.)
2. **A second, spurious `"Quarterly"/"Term 1"` column pair appears after the real printed-grade columns on every T2 sheet.** Confirmed on Math (`col18=92` real Quarterly vs `col21=60, col22=93` in the trailing pair — no reliable relationship) and Science (`col18=91` vs `col21=91.00, col22=89, col23=-2.00` — coincidentally close this time, but not consistently). Since Primary was never graded in T1 in this system, there is no real "prior term" value these trailing columns could legitimately represent — they read as stale/broken template leftovers, not real data. T1's `findPrintedGradeCols` helper scans forward from the Exam column and keeps the _last_ `"Initial"`/`"Quarterly"` label match it finds — on T1's shape (only one pair existed) this was harmless, but on T2's shape it would silently grab the spurious second pair instead of the real one. This is a genuine bug to fix, not a straight port.
3. **The source workbooks are per-subject, not per-subject-and-level.** Each of the 6 subject files (Math, English, Science, STAR/MAPEH, Filipino, Mandarin) contains a tab per real section across BOTH Primary and Secondary Regular-track — this phase parses and imports Primary tabs only, explicitly recognizing (via the new identity regex) and skipping Secondary ones rather than erroring on them.

## 2. Locked decisions

1. **Scope is exactly 6 subjects × the 14 real Primary sections that have actual data**: Math (MATH), English (ENG), Science (SCI), STAR (MAPEH), Filipino (FIL, Regular-track sections only — 9 of the 14), Mandarin (MANDARIN, Global-track sections only — 5 of the 14). Math/English/Science/MAPEH apply to all 14. The 14 sections: Global-track Patience, Honesty, Courtesy, Diligence, Commitment; Regular-track Obedience, Humility, Courageous, Responsibility, Trust, Tenacity, Perseverance, Loyalty, Grit. 3 KD #144-named virtue sections (Respect, Gentleness, Compassion) have zero students/data in every real workbook (confirmed present only as empty `Reserved N` tabs) and are out of scope — not a bug, matches reality.
2. **`Copy of English Grading AY2026 T2.xlsx` and `Copy of Science Grading AY2026 T2.xlsx` are corrupted duplicates and are never read** — confirmed via direct inspection: the NAME column contains literal `#REF!` values, same corruption signature as T1's `Copy of Mathematics...` file (KD-documented in Phase 3's design doc). The orchestrator reads an explicit file list, never a directory glob, so a corrupted file can't accidentally slip in.
3. **`Reserved N` tabs are excluded** the same way Phase 1/2's `deriveSectionIdentity` already excludes them (an unrecognized-pattern sheet name, or — more commonly here — an empty roster caught by the existing `students.length === 0` skip). Secondary tabs within these same 6 workbooks are recognized by the new identity regex and explicitly skipped (not treated as an error) — deferred to Phase 6b.
4. **Level/section identity parsing is regex-based, capturing everything between the level number and a trailing `" - SUBJECT"` suffix as the section name**, title-cased from the source's all-caps text (`"PATIENCE"` → `"Patience"`, `"DISCIPLINE 2"` → `"Discipline 2"`) — not a fixed-position read, so it's robust to the subject-name tail varying per file. The regex recognizes both `Primary N <NAME> - SUBJECT` and `Secondary N <NAME> - SUBJECT` shapes; only rows identified as `Primary` are processed into output data this phase, `Secondary` rows are counted and reported as skipped (not errors) in the preview.
5. **Printed-grade cross-check reads only the FIRST `"Initial"`/`"Quarterly"` label pair found scanning forward from the Exam column — never the last, and never anything past a small bounded window.** This directly fixes the bug described in §1.2. The spurious second pair is never read, never written, and never surfaces in the preview (there is nothing meaningful to say about it).
6. **`subject_configs` writes are corrections only, applied via `ON CONFLICT ... DO UPDATE`**, scoped to exactly 3 of the 6 subjects, based on comparing each subject's real T2 header weight against the current DB value (verified via a direct read-only query before writing any code):
   - **FIL: a real correction** — DB currently holds `0.3/0.5/0.2` (`weights_confirmed=false`, template-sourced guess from an earlier ad-hoc backfill this session), but the real T2 Filipino header reads `40%/40%/20%`. The apply file corrects this to `0.4/0.4/0.2` and sets `weights_confirmed=true`.
   - **MAPEH and MANDARIN: confirm-only** — both already hold the numerically correct value (`0.2/0.6/0.2` and `0.3/0.5/0.2` respectively) but with `weights_confirmed=false`; the apply file flips the flag to `true` with no numeric change.
   - **MATH, ENG, SCI: no action** — all three already hold the correct, already-`weights_confirmed=true` value from Phase 3 (T1 Secondary) or its correction pass; since migration 080 collapsed `subject_configs` to be level-agnostic (one row per `(academic_year_id, subject_id)`), these rows already correctly apply to Primary too.
7. **No `subject_level_offerings` or `section_subjects` writes.** Both were already correctly populated for all 6×applicable-section pairs by this session's earlier ad-hoc `gen-ay2026-remaining-sections-subjects.ts` / `gen-ay2026-primary-subject-configs.ts` scripts. This phase reads them (for roster/section resolution) but never writes them — a genuine scope reduction versus Phase 3, which had to create these from scratch.
8. **Roster resolution, needs-review, and grade computation follow Phase 3's exact pattern**: `(levelCode, sectionName, indexNumber)` lookup against live `section_students`, unresolved → needs-review (never guessed); grades computed via importing `lib/compute/quarterly.ts::computeQuarterly` directly (Hard Rule #1/#2, never re-implemented); a printed-vs-computed mismatch is informational only (raw scores are still written — they remain the transcribed truth). **Correction from an earlier read of this section (caught during plan-writing, verified with a precise column-indexed dump): MAPEH does have a real printed Quarterly numeric grade** (e.g. col20 = `95`, paired with `"Quarterly"` in row 5) — it needs no special Initial-only fallback after all; the standard printed-Quarterly cross-check (Locked Decision #5's fixed first-match column finder) already lands on the correct real value. The source's `"Final Grade Equivalent"` letter column (e.g. `"A"`, sitting between the real Quarterly and the spurious second pair) is simply never read at all — it matches neither the `"Initial"` nor `"Quarterly"` label regex, so the column finder skips over it naturally, and it is never written to `grade_entries.letter_grade` (per KD #104, that column is reserved for UG/E manual overrides only; A/B/C/IP letters are always derived from `quarterly_grade` at render time).
9. **`grading_sheets` are locked on import** (`is_locked=true, locked_at=now(), locked_by='backfill-import'`), matching Phase 3.
10. **Single, un-chunked `apply.sql`.** Volume here (6 subjects × up to 14 sections × ~20 students, well under 2,000 `grade_entries` rows) is far below the scale that forced Phase 2's chunking fix — that was specifically an `attendance_daily`-row-count problem, not a general SQL-size one. No apply-file splitting needed.

## 3. Architecture

```
AY2026/T2/Term 2 Grades/GRADES/{Math,English,Science,STAR (PrI),Filipino,Mandarin} Grading AY2026 T2.xlsx
        │
        ▼
scripts/backfill/gen-ay2026-t2-primary-grading.ts
        │  1. Parse all 6 real subject files (explicit list, never
        │     "Copy of ..."), reading every tab; identity regex
        │     classifies each tab Primary/Secondary/Reserved/unrecognized
        │     — only Primary tabs feed into output data
        │  2. Query DB: section_students for AY2026's 14 real Primary
        │     sections (already fully rostered by Phase 1)
        │  3. Cross-check subject_configs' current values against each
        │     subject's real header weight — corrections limited to
        │     exactly FIL (numeric) + MAPEH/MANDARIN (confirm-flag only)
        │  4. Resolve roster, compute grades via lib/compute/quarterly.ts,
        │     cross-check printed vs computed (first Initial/Quarterly
        │     pair only)
        │  5. Emit SQL — single apply.sql, no chunking needed at this volume
        ▼
ay2026-t2-primary-grading-preview.sql   ← reviewed first (report only)
ay2026-t2-primary-grading-apply.sql     ← reviewed + run manually after
```

## 4. SQL write plan (idempotent — safe to rerun)

1. **`subject_configs`** — exactly 3 rows touched (FIL numeric correction, MAPEH + MANDARIN confirm-flag flips), `ON CONFLICT (academic_year_id, subject_id) DO UPDATE`. MATH/ENG/SCI are read for cross-check but never written (already correct).
2. **`grading_sheets`** — one row per (subject, Primary section) pair with real data, `ON CONFLICT (term_id, section_id, subject_id) DO NOTHING`, locked on import.
3. **`grade_entries`** — one row per resolved student per subject, `ON CONFLICT (grading_sheet_id, section_student_id) DO NOTHING`.
4. **No `subject_level_offerings` / `section_subjects` writes** (Locked Decision #7).

`ay2026-t2-primary-grading-preview.sql` is the same read-only companion shape every prior phase used: per-subject weight-correction table, date/roster-resolution failures, quarterly-mismatch list, and (new, since Secondary tabs are recognized-and-skipped rather than absent) a count of skipped Secondary tabs per file for operator visibility.

## 5. Validation plan

1. Run the generator; read the preview report.
2. Hand-verify the FIL correction (0.3/0.5/0.2 → 0.4/0.4/0.2) and the MAPEH/MANDARIN confirm-flips appear exactly as expected, and that MATH/ENG/SCI show no changes.
3. Spot-check a handful of students' computed-vs-printed grades against the real workbook, including at least one MAPEH row (Initial-based cross-check, non-examinable shape).
4. Confirm the "Secondary tabs skipped" count in the preview matches the real per-file tab count minus Primary/Reserved tabs (a sanity check that nothing Secondary silently leaked into Primary's output).
5. Run `apply.sql` (single file, one connection/session).
6. Read-only follow-up query confirms `grading_sheets` (~up to 6×14=84, minus subjects that don't apply to all sections) and `grade_entries` row counts, plus the corrected `subject_configs` values.

## 6. Testing

- **Unit:** the new level/section identity regex (Primary vs Secondary vs unrecognized, section-name extraction with title-casing) and the fixed printed-grade-column finder (first-match-only, tested against a fixture that deliberately includes the spurious second `"Quarterly"` pair to prove the old last-match bug is actually fixed, not just untested) — pure and testable against synthetic fixtures mirroring the real masthead shape.
- **Reused, not retested:** row-boundary detection (first-blank-name stop), W/PT/Exam column discovery via row 7 labels, and max-score-blank-means-slot-unused exclusion are consumed as-is from Phase 3's proven logic wherever they don't need to change for T2 Primary's masthead differences.
- No integration test suite — same as every prior phase, this is operator tooling reviewed by hand via the preview report.

## 7. Out of scope

- Phase 6b (Secondary — Regular track from the same `GRADES/` folder + Global track from `Lower Secondary Global Grading Sheets/`, plus resolving the CCA subject's section attachment) — separate, later spec.
- Phase 7 (T2 evaluation write-ups) and Phase 8 (Records cross-check against the Term 2 CONSOLIDATED FORM) — separate specs.
- Re-resolving any students who were already unresolved in earlier phases' needs-review buckets.

## 8. Amendment (2026-07-18) — real-run findings require a Task 4

The implementation (Tasks 1–3) was built, reviewed, and run for real against the live database and the real 6 workbooks. The run surfaced two things this design got wrong, both discovered only by inspecting the _actual output_, not by re-reading the source files differently — a genuine gap in the original investigation, not a coding bug in Tasks 1–3.

**Finding A — `Reserved N` tabs are not empty.** Locked Decision #1's claim ("3 KD #144 sections have zero students/data... confirmed present only as empty `Reserved N` tabs") was wrong. Every `Reserved N` tab across all 6 files actually contains a real, populated Primary section — Respect, Gentleness, or Compassion — with real students and real scores; the tab was simply never renamed from the workbook template's placeholder name. The real scope is **17 Primary sections, not 14** (the full KD #144 list). This is not a code defect — the existing identity parser (row-2-based) already reads these tabs correctly _when it reaches them via the row-2 fallback described in Finding B's fix_; the design's assumption that the tab name told the whole story was the gap. Consequence, confirmed benign: these 3 sections' students correctly fail roster resolution (`no matching section_students row`) and land in needs-review, because the sections themselves don't exist in `section_students` yet — a real SIS Admin/Records gap outside this phase's scope, not something this import should paper over. Nothing incorrect gets written for them.

**Finding B — row 2 is not always reliable, and the failure mode is silent, not loud.** Cross-checking every real tab's name against its row-2 text found **6 tabs across 4 subjects where row 2 is simply wrong** — a copy-paste artifact from cloning an existing tab as a template inside Excel and forgetting to update the label cell:

| File       | Tab (verified correct)      | Row 2 text (wrong)                                             |
| ---------- | --------------------------- | -------------------------------------------------------------- |
| English    | `English - P5 Perseverance` | `"Primary 5 COMMITMENT - ENGLISH"`                             |
| STAR/MAPEH | `STAR - P5 Perseverance`    | `"Primary 5 COMMITMENT - MUSIC, ARTS, PE, HEALTH"`             |
| Filipino   | `Filipino - P6 Loyalty`     | `"Primary 6 GRIT - FILIPINO"`                                  |
| Mandarin   | `Mandarin - P3 Courtesy`    | `"Primary 4 DILIGENCE - MANDARIN"`                             |
| Mandarin   | `Mandarin - P4 Diligence`   | `"Primary 3 COURTESY - MANDARIN"` (swapped with the row above) |
| Mandarin   | `Mandarin - P5 Commitment`  | `"Primary 4 DILIGENCE - MANDARIN"`                             |

Math and Science have zero instances of this — every tab name there matches row 2 exactly. Locked Decision #4 ("level/section identity parsing is regex-based [over row 2 text]... not a fixed-position read") is amended: **row 2 alone is not a safe sole identity source**. Because roster resolution keys on `(levelCode, sectionName, indexNumber)`, a wrong `sectionName` from row 2 does not reliably fail loud — it can resolve against a _different real section's_ roster and silently attribute one student's grades to another, with no error and no needs-review flag. This is the specific risk class Hard Rule discipline throughout this whole project exists to prevent, and it slipped through here because the original design never cross-checked the two available identity signals against each other.

**Amended Locked Decision (supersedes #1, #3, #4 for identity specifically — #4's non-identity claims, like title-casing and the `" - SUBJECT"` suffix handling, are unaffected):**

9. **Identity is derived from the tab name first; row 2 is a fallback used only when the tab name doesn't parse.** Tab names are a `"<Subject> - <PrimaryLevel><Num> <Section>"` or `"<Subject> - <S|Sec><Num> <Section>"` shape (`"Math - P1 Patience"`, `"English - P5 Perseverance"`, `"Math - S1 Discipline 2"`, `"Literature - Sec 1 Discipline 2"` — note the `S`/`Sec` prefix spelling itself varies by file and both must be handled) and are structurally reliable: Excel does not allow two tabs in one workbook to share a name, so a mis-typed tab name would be immediately, visibly obvious to whoever built the workbook, unlike a free-text label cell. When the tab name matches this shape, it is authoritative for level + section identity, full stop — row 2 is not consulted for identity at all in that case (row 2 is still used for weights/teacher-name, which this bug never affected). When the tab name does **not** match the shape (`"Reserved 1"`, `"Sheet2"`, etc. — Finding A's case), identity falls back to parsing row 2's text exactly as the original Locked Decision #4 described. **Every tab where the two signals disagree is recorded in a new preview.sql section** (`identity corrections — tab name overrode a conflicting row 2 label`) so a human reviewing the output can see exactly which corrections this fix applied and confirm none of them look wrong, rather than the override happening invisibly.
