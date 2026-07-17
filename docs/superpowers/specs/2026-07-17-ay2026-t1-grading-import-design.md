# AY2026 T1 Grading Sheets Import — Design

**Date:** 2026-07-17
**Status:** Design (approved in brainstorming; pending spec review)
**Target:** Import HFSE's real T1 grading data — raw WW/PT/QA component scores — for every section that actually has T1 component-level data recorded, into production.

**Scope:** Phase 3 of 4 in the broader AY2026 T1 data-import project (Phase 1 — enrollment/roster — and Phase 2 — attendance + calendar — are complete and live in production). Phase 4 (evaluation) remains a separate spec.

---

## 1. Why this is Phase 3, and what the source data actually contains

Phases 1–2 established AY2026's T1 term, 20 real sections, a 371-student roster (`section_students`), and a correct T1 `school_calendar`. This phase imports T1 grades — but the uploaded source data does **not** cover the full roster the way the attendance workbook did.

The source folder (`AY2026/T1/Term 1 Grades/Lower Secondary Global Grading Sheets/`) contains 8 subject workbooks (Math, English, Science, Humanities, Global Perspectives, Computing, Art & Design, PE & Health). Each workbook has exactly **2 real section tabs** — "Sec 1 Discipline 1" and "Sec 2 Integrity 1" — plus an identical stray tab in every single file, **"DO NOT USE Literature - Sec 4 E"**, labeled "Term 1 - 2025" (not 2026), wrong subject, wrong section. Confirmed stale (a template leftover left in every file) — excluded entirely, not just flagged.

A separate "Consolidated Term 1-2" file exists (`AY2026/T2/Term 2 Grades/AY2026 Consolidated File {Primary,Secondary} Grades Term 1-2 *.xlsx`) that _does_ cover the full roster, but it only carries a single final Quarterly Grade per term per subject — no raw WW/PT/QA components. There is no legitimate way to reconstruct real historical component scores from one final number; doing so would be fabricating data, not importing it. So this phase's real, importable scope is exactly the 2 sections with genuine component-level source data:

- **Discipline 1** (S1) — 29 active students in `section_students`
- **Integrity 1** (S2) — 10 active students in `section_students`

= up to 39 students × 8 subjects.

## 2. Locked decisions

1. **Scope is exactly Discipline 1 + Integrity 1, 8 subjects each.** No attempt to cover the other 18 sections (all Primary + Discipline 2 / Integrity 2 / Consistency / Excellence) — they have zero real T1 component data uploaded. They keep having zero T1 grades in the system after this import, same as before it.
2. **"DO NOT USE Literature - Sec 4 E" is excluded from every workbook, unconditionally.** Confirmed stale: wrong year (2025), wrong subject, wrong section, explicitly self-flagged by its own sheet name.
3. **Weights and max-scores come from each sheet's own header row, verbatim — not from `subject_configs`, not from KD #4's documented defaults, not from `template_subject_configs`.** All three of those disagree with the real data (KD #4 documents Secondary as 30/50/20; the real sheets show per-subject schemes ranging from 20/60/20 to 40/40/20 — see §3). The header values were hand-verified: recomputing one student's grade (Math, BANTA Stephanie) from raw scores through the header's own max-scores and weights via `lib/compute/quarterly.ts` reproduces the sheet's own printed Quarterly Grade (89) exactly.
4. **Roster resolution via `(section, index_number)` lookup**, identical to Phase 2. A sheet row that doesn't resolve to a live `section_students` row lands in the needs-review bucket, never guessed. Confirmed via direct DB comparison: 3 rows won't resolve — Discipline 1 index 14 and 25 (DB has no active student at those indices — gaps, likely a prior withdrawal), Integrity 1 index 2 (same).
5. **`grade_entries` computed fields (`ww_ps`/`pt_ps`/`qa_ps`/`initial_grade`/`quarterly_grade`) are computed by the generator itself, using the real `lib/compute/quarterly.ts` module imported directly** (not re-implemented, not ported) — matching how the live entries API route does it (`app/api/grading-sheets/[id]/entries/[entryId]/route.ts`), per Hard Rule #2. Zero drift risk since it's the same module, not a copy.
6. **The sheet's own printed Initial/Quarterly Grade is used only as a cross-check, never written directly.** The generator's own computed `quarterly_grade` is what gets written; if it disagrees with the sheet's printed value beyond rounding, that row is flagged in the preview report (not blocked) — the raw scores are still the transcribed truth even if a derived value differs.
7. **`subject_configs` is corrected, not just filled.** ~~Only 1 row currently exists for all of AY2026 (should be ~1 per subject × level).~~ **Superseded — see the 2026-07-17 update note at the end of this doc: a concurrent migration (080) already collapsed `subject_configs` to one row per subject for the whole AY, dropping `level_id` entirely.** `apply.sql` upserts (`ON CONFLICT (academic_year_id, subject_id) DO UPDATE`, not `DO NOTHING`) 8 rows (one per subject) with the real header-sourced weights/slots/max-scores, plus writes `subject_level_offerings` (16 rows, one per subject×level) and `section_subjects` (16 rows, one per subject×section) to carry the level/section eligibility that used to live on `subject_configs` itself.
8. **Sheets are locked on import** (`is_locked=true`, `locked_at=now()`, `locked_by='backfill-import'`). T1 is being treated as settled/historical at import time; any future correction goes through the normal change-request flow (Hard Rule #5), same as any other locked sheet.
9. **`teacher_name`** on `grading_sheets` is carried over from each sheet's own "Teacher: ..." header row (plain text, no FK) — informational only.
10. **Mechanism: same generator → reviewable SQL files pattern as Phases 1–2.** Volume here is tiny (≤344 total rows across 3 tables) — a single `apply.sql` transaction, no Phase-2-style chunking needed.

## 3. Per-subject weights & slots (read verbatim from each sheet's header row — confirmed identical between Discipline 1 and Integrity 1 for every subject)

| Subject             | Code | WW / PT / QA weight | WW slots (max) | PT slots (max)         | QA max |
| ------------------- | ---- | ------------------- | -------------- | ---------------------- | ------ |
| Math                | MATH | 40 / 40 / 20        | 2 (20, 20)     | 3 (30, 30, 25)         | 65     |
| Science             | SCI  | 40 / 40 / 20        | 2 (20, 20)     | 3 (25, 25, 25)         | 50     |
| English             | ENG  | 30 / 50 / 20        | 2 (20, 20)     | 3 (20, 30, 25)         | 50     |
| Humanities          | HUM  | 30 / 50 / 20        | 2 (20, 20)     | 3 (30, 25, 20)         | 65     |
| Global Perspectives | GP   | 30 / 50 / 20        | 1 (40)         | 2 (30, 25)             | 65     |
| Computing           | COMP | 30 / 50 / 20        | 2 (20, 20)     | 2 (25, 25)             | 50     |
| Art & Design        | ARTD | 20 / 60 / 20        | 1 (20)         | 5 (20, 20, 20, 20, 20) | 20     |
| PE & Health         | PEH  | 20 / 60 / 20        | 1 (20)         | 5 (20, 20, 20, 20, 20) | 20     |

Notes:

- Every subject respects Hard Rule #5 (max 5 WW + 5 PT slots); Art & Design and PE & Health sit at the 5-PT-slot ceiling.
- Humanities' header row has one corrupted label cell (a literal `"36"` where `"PERFORMANCE TASKS (50%)"` should read) — the actual weight is still recoverable from the surrounding percentages (100% − 30% WW − 20% QA = 50% PT) and matches the row-8 max-score data, so this doesn't block anything; noted here for the record.
- Art & Design (ARTD) and PE & Health (PEH) are catalogued `is_examinable=false`. Per KD #104 this only changes _display_ (a derived letter shows instead of the raw number) — the WW/PT/QA entry mechanism is identical to examinable subjects, so the import path needs no special-casing for these two.

## 4. Architecture

```
AY2026/T1/Term 1 Grades/Lower Secondary Global Grading Sheets/*.xlsx (8 files)
        │
        ▼
scripts/backfill/gen-ay2026-t1-grading.ts
        │  1. Parse each workbook, keep only the 2 real section tabs
        │     (skip any "DO NOT USE..." tab by name)
        │  2. Query DB: section_students for Discipline 1 + Integrity 1
        │     (section, index_number) → section_students.id map
        │  3. Read each sheet's own header row for weights/max-scores —
        │     no assumptions, no reverse-fit search (the source is trusted
        │     and hand-verified — see locked decision #3)
        │  4. Resolve each roster row; unresolved → needs-review
        │  5. Run resolved rows through the real lib/compute/quarterly.ts
        │     (imported directly) to get ww_ps/pt_ps/qa_ps/initial/quarterly
        │  6. Cross-check computed quarterly_grade against the sheet's own
        │     printed value — mismatches flagged in preview, not blocking
        │  7. Emit SQL
        ▼
ay2026-t1-grading-preview.sql   ← reviewed first (report only)
ay2026-t1-grading-apply.sql     ← reviewed + run manually after, ONE transaction
```

## 5. SQL write plan (idempotent — safe to rerun)

`ay2026-t1-grading-apply.sql` contains, in order:

1. **`subject_configs`** — upsert 16 rows (8 subjects × {S1, S2}) with each subject's real weights / `ww_max_slots` / `pt_max_slots` / `qa_max`, keyed on the existing `unique(academic_year_id, subject_id, level_id)` via `ON CONFLICT ... DO UPDATE` — deliberately corrects the near-empty AY2026 config, not merely fills gaps.
2. **`grading_sheets`** — insert 16 rows (8 subjects × 2 sections), `subject_config_id` pointing at the row just written, `ww_totals`/`pt_totals`/`qa_total` copied from the same source header, `teacher_name` from the sheet's own "Teacher:" row, `is_locked=true`, `locked_at=now()`, `locked_by='backfill-import'`. Guarded on the existing `unique(term_id, section_id, subject_id)`.
3. **`grade_entries`** — insert up to 312 rows (39 students × 8 subjects), both raw (`ww_scores`/`pt_scores`/`qa_score`) and computed (`ww_ps`/`pt_ps`/`qa_ps`/`initial_grade`/`quarterly_grade`) columns, guarded on the existing `unique(grading_sheet_id, section_student_id)`.

**Explicitly not touched:** `evaluation_writeups`, `attendance_*` (already correct from Phase 2), any section/subject outside the 2×8 scope above.

`ay2026-t1-grading-preview.sql` is a read-only companion: the per-subject weight/slot table (§3), roster-resolution failures (expect exactly 3), and any quarterly-grade cross-check mismatches (expect ~0, given the hand-verified sample already matches exactly) — reviewed before `apply.sql` is ever run.

## 6. Validation plan

1. Run the generator; read the preview report — confirm the weight/slot table matches §3, confirm the needs-review list is exactly the 3 expected rows, confirm the mismatch list is empty or near-empty.
2. Spot-check 1–2 more students by hand against the source workbook (beyond the Math/BANTA check already done during design).
3. Run `apply.sql` once (single transaction).
4. Read-only follow-up: `subject_configs` count for AY2026 S1/S2 = 16; `grading_sheets` count for T1 scoped to Discipline 1 + Integrity 1 = 16, all `is_locked=true`; `grade_entries` count ≤ 312; a handful of `quarterly_grade` values re-verified against the source sheet.

## 7. Testing

- **Unit:** header-row weight/max-score extraction, the `(section, index_number)` resolution + needs-review logic, the quarterly-grade cross-check — pure and testable against synthetic fixtures mirroring the real masthead shapes characterized in §3.
- **Reused, not retested:** `lib/compute/quarterly.ts` is consumed as-is (it already self-tests on import per Hard Rule #1); Phase 1/2's `sql-escape.ts` helpers are reused as-is.
- No integration test suite — same as Phases 1–2, this is operator tooling reviewed by hand via the preview report.

## 8. Out of scope (this spec)

- The other 332 students (all Primary + Discipline 2 / Integrity 2 / Consistency / Excellence) — no real T1 component data exists yet for them.
- T2–T4 grading.
- Non-examinable annual letter grades (`grade_entries.annual_letter_grade`, KD #100) — T4-only concern, not applicable to T1.

## 9. Deferred to after T2 import (explicit future work, not blocking this phase)

- **Cross-term weight consistency check.** `subject_configs` weights are fixed per `subject × AY` now (see the update note below — narrowed from `subject × level × AY` by a concurrent migration), not per-term — once T2's real grading sheets are available, verify T2's own headers agree with the weights this phase sets from T1. Any drift is a real signal (a genuine mid-year policy change, or a data-entry inconsistency) worth surfacing, not noise to ignore.
- **Cross-check against the Consolidated "Term 1-2" file.** Once both T1 and T2 are in the system for Discipline 1 + Integrity 1, compare this system's computed Quarterly grades against the Consolidated file's T1/T2 columns for those same sections as an independent sanity check.

## 10. Update (2026-07-17, caught by the final whole-branch review) — `subject_configs` schema changed under this phase's feet

A **concurrent, unrelated project** in this same shared checkout (a "Subject Weights redesign," see `docs/superpowers/specs/2026-07-15-ay-setup-subject-weights-redesign-design.md` and migration `080_subject_weights_collapse.sql`) shipped **directly to production** while this phase was being designed/built. It collapsed `subject_configs` from one row per `(academic_year_id, subject_id, level_id)` to one row per `(academic_year_id, subject_id)` — **`level_id` no longer exists on the table at all.** Confirmed live via direct query against production (not just reading the migration file): `select level_id from subject_configs` returns `column subject_configs.level_id does not exist`.

Level/section eligibility that used to live implicitly on `subject_configs` now lives in two new tables the migration also introduced:

- **`subject_level_offerings(subject_id, level_id, academic_year_id)`** — "this subject applies to this level this year," additive-only.
- **`section_subjects(section_id, subject_config_id)`** — links a specific section to the subject_configs row it uses; this is how `create_grading_sheets_for_ay`/`_for_section` (the live app's own sheet-generation RPCs) now resolve which subjects a section gets sheets for.

**Consequence for this phase's data:** Discipline 1 (S1) and Integrity 1 (S2) now share exactly **one** `subject_configs` row per subject (8 rows total, not 16) — verified safe because every one of the 8 real subjects' T1 sheets already showed identical weights/max-scores between the two sections (§3 above). The generator now also writes `subject_level_offerings` (16 rows, one per subject×level) and `section_subjects` (16 rows, one per subject×section) so the two sections are correctly linked to their shared config, matching how the rest of the app now models this relationship. A hard runtime error (not a silent pick) fires if two sections' sheets for the same subject ever genuinely disagree — that can no longer be represented in one row and needs a human decision, not a guess.

This does not change anything else in this doc — the workbook parsing, roster resolution, grade computation, and locking behavior are all unaffected. Only the `subject_configs`/`grading_sheets` write plan (§5) changed; §5 above was left as originally written for the historical record — treat this section as the correction.
