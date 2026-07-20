# AY2026 T1 Primary Grading Sheets Import — Design

**Date:** 2026-07-20
**Status:** New
**Target:** Import HFSE's real T1 Primary grading data into `grading_sheets` / `grade_entries`.

**Scope:** Sub-phase 1 of 2 — closes a real gap diagnosed via a plan-mode investigation earlier this session: T1's `grading_sheets` table currently has 16 rows, all Secondary Global-track (S1 Discipline 1, S2 Integrity 1), because that's the only source data that existed when Phase 3 (T1's original grading import) ran. Primary has zero T1 grading data. This is the direct cause of Markbook not showing T1 sheets for Primary sections, and of report cards showing blank T1 grades for those students — confirmed by reading `build-report-card.ts`: it reads stored `grade_entries` directly, no display bug, just missing data. Sub-phase 2 (Secondary Regular-track — Discipline 2, Integrity 2, S3 Consistency, S4 Excellence) is a separate, later spec, deferred because the source folder mixes DO-NOT-USE tabs into the Secondary-Regular sheets in a way the existing Secondary parser has never had to handle (see §6).

## 1. Why this phase, and what's different from T2's Primary import (Phase 6a)

A fresh, exhaustive re-check of `AY2026/T1/` (prompted directly by the user) turned up `AY2026/T1/Term 1 Grades/Grades/` — a folder not present in earlier searches this session, structurally the T1 sibling of T2's already-solved `GRADES/` folder. Direct inspection and a real parse run (using the existing, unmodified `parseGradingWorkbookT2`) confirmed the masthead layout, subject-code list, Reserved-tab pattern, and DO-NOT-USE-tab pattern are **byte-identical** to T2's Primary GRADES folder — not just similar, actually identical row positions (`t2-masthead.ts`'s `ROW_LEVEL_SECTION=2` / `ROW_TEACHER=3` / `ROW_LABELS=5` / `ROW_SUBCOLS=7` / `ROW_MAXSCORES=8` / `ROW_STUDENTS_START=9` all matched on direct inspection). Running the existing parser against all 6 real T1 files produced **zero errors, zero unrecognized sheets, zero duplicate-identity collisions** — every hard-won fix from Phase 6a's own history (the `EXCLUDED_PRIMARY_SECTIONS` set for Respect/Gentleness/Compassion, the tab-name-first identity resolution, the NaN-safe max-score filter) already applies correctly to T1's files with no code changes.

Two findings from the real parse run, both already handled by the reused code (documented here for the same transparency Phase 6a's own preview report gives, not because either needs a new decision):

1. **One tab-name-vs-row-2 disagreement**, the same class of bug Phase 6a's Finding B found 6 instances of in T2: `MAPEH - P5 Perseverance`'s row 2 wrongly says `"Primary 5 COMMITMENT"`. The existing tab-name-first resolution (`resolveIdentity` in `t2-masthead.ts`) correctly uses the tab name and logs a correction note — this is exactly the mechanism Phase 6a built specifically to prevent this class of silent misattribution.
2. **The "DO NOT USE" tabs correctly resolve to Secondary identity** (e.g. `"DO NOT USE English - S4 Excelle"` resolves to `S4 Excellence` via the truncation-handling path), and are harmlessly bucketed into `skippedSecondary` by this Primary-only parser — it doesn't need to distinguish _why_ a sheet isn't Primary. This does **not** carry over safely to sub-phase 2's Secondary parser, which does need to distinguish real Secondary sheets from DO-NOT-USE duplicates of the same identity (see §6).

## 2. Locked decisions

1. **Scope is 6 subjects × the real Primary sections that have data in each file**: Math (MATH), English (ENG), Science (SCI), STAR MAPEH (MAPEH), Filipino (FIL, Regular-track sections only), Mandarin (MANDARIN, Global-track sections only) — the identical subject list Phase 6a used for T2. `Respect`, `Gentleness`, `Compassion` are excluded via the existing `EXCLUDED_PRIMARY_SECTIONS` set, reused verbatim (not re-derived) — same 3 sections, same reasoning, confirmed present in T1's files as the same named `Reserved N` tabs.
2. **No file-corruption exclusions needed.** Unlike T1's original grading source (which had a `Copy of Mathematics...` corrupted duplicate) and T2's GRADES folder (`Copy of English...`, `Copy of Science...`), this newly-found T1 `Grades/` folder has no `Copy of ...` files — confirmed via direct directory listing, 9 real subject files only (6 relevant to this Primary phase).
3. **`subject_configs` writes: none.** Every one of the 6 subjects' T1 header weights was directly verified against the live, already-corrected `subject_configs` this session (including the just-applied Filipino/Global Perspectives correction) and all match exactly:

   | Subject  | T1 header | Live `subject_configs`    |
   | -------- | --------- | ------------------------- |
   | MATH     | 40/40/20  | 40/40/20                  |
   | SCI      | 40/40/20  | 40/40/20                  |
   | ENG      | 30/50/20  | 30/50/20                  |
   | FIL      | 30/50/20  | 30/50/20 (just corrected) |
   | MANDARIN | 30/50/20  | 30/50/20                  |
   | MAPEH    | 20/60/20  | 20/60/20                  |

   `SUBJECT_CONFIG_WEIGHTS` in the orchestrator is empty on purpose — not derived at generation time, and the composer must correctly handle this empty input (same pattern Phase 6b already established for T2 Secondary).

4. **Identity resolution reuses `t2-masthead.ts`'s `resolveIdentity` unchanged** (tab-name-first, row-2 fallback, truncation handling) — no new identity logic. `EXCLUDED_PRIMARY_SECTIONS` and `dedupeByIdentityPreferringScored` are reused unchanged from `grading-workbook-t2.ts`.
5. **Roster resolution, needs-review, and grade computation follow the exact established pattern**: `(levelCode, sectionName, indexNumber)` lookup against live `section_students`, unresolved → needs-review, grades computed via `lib/compute/quarterly.ts::computeQuarterly` (Hard Rule #1/#2), printed-vs-computed mismatches informational only.
6. **`grading_sheets` locked on import** (`is_locked=true, locked_at=now(), locked_by='backfill-import'`), matching every prior phase.
7. **Single, un-chunked `apply.sql`** — volume here (6 subjects × up to ~14 sections × ~20 students) is comparable to Phase 6a's T2 Primary run, well under the row-count threshold that ever required chunking.

## 3. Architecture

```
AY2026/T1/Term 1 Grades/Grades/{Math,English,Science,STAR MAPEH (PrI),Filipino,Mandarin} Grading AY2026 T1.xlsx
        │
        ▼
scripts/backfill/gen-ay2026-t1-primary-grading.ts
        │  1. Parse all 6 real subject files (explicit list, never a
        │     directory glob) via the new grading-workbook-t1-primary.ts
        │     — a near-verbatim copy of grading-workbook-t2.ts, reusing
        │     t2-masthead.ts's helpers directly (row layout confirmed
        │     identical)
        │  2. Query DB: section_students for AY2026's real Primary
        │     sections (already fully rostered by Phase 1)
        │  3. No subject_configs writes (Locked Decision #3 — empty list,
        │     composer must handle it correctly)
        │  4. Resolve roster, compute grades via lib/compute/quarterly.ts,
        │     cross-check printed vs computed
        │  5. Emit SQL — single apply.sql
        ▼
ay2026-t1-primary-grading-preview.sql   ← reviewed first (report only)
ay2026-t1-primary-grading-apply.sql     ← reviewed + run manually after
```

Three files, mirroring Phase 6a's exact shape:

- `lib/sis/backfill/grading/grading-workbook-t1-primary.ts` — near-verbatim copy of `grading-workbook-t2.ts` (same `EXCLUDED_PRIMARY_SECTIONS`, same parse/dedupe logic), pointed at the T1 file list, comments updated to reference T1 rather than T2.
- `lib/sis/backfill/grading/build-t1-primary-grading-import.ts` — near-verbatim copy of `build-primary-grading-import.ts`, only title strings changed (matches the established "accepted duplication" convention already used twice between the T2 Primary/Secondary composers).
- `scripts/backfill/gen-ay2026-t1-primary-grading.ts` — mirrors `gen-ay2026-t2-primary-grading.ts`: `TERM_NUMBER = 1`, `SUBJECT_CONFIG_WEIGHTS = []`, term resolved via `end_date = '2026-03-13'`.

## 4. SQL write plan (idempotent — safe to rerun)

1. **No `subject_configs` writes** (Locked Decision #3).
2. **`grading_sheets`** — one row per (subject, Primary section) pair with real data, `ON CONFLICT (term_id, section_id, subject_id) DO NOTHING`, locked on import.
3. **`grade_entries`** — one row per resolved student per subject, `ON CONFLICT (grading_sheet_id, section_student_id) DO NOTHING`.
4. **No `subject_level_offerings` / `section_subjects` writes** — already populated (Phase 1/6a's work covers Primary sections' subject attachments; this phase only adds T1's grading data on top of an already-correctly-configured structure).

`ay2026-t1-primary-grading-preview.sql` follows the same shape every prior phase used: per-subject weight table (confirm-only, no corrections), roster-resolution failures, quarterly-mismatch list, identity-correction notes (§1's MAPEH finding), and skipped-Secondary/skipped-excluded-section counts per file for operator visibility.

## 5. Validation plan

1. Run the generator; read the preview report.
2. Confirm the identity-corrections section shows exactly the one MAPEH P5 Perseverance correction found during design, and nothing unexpected.
3. Confirm the excluded-section counts (Respect/Gentleness/Compassion) match across all 6 files.
4. Spot-check a handful of students' computed grades against the real workbook.
5. Run `apply.sql` (single file, one connection/session).
6. Read-only follow-up query confirms `grading_sheets`/`grade_entries` row counts for T1, and — critically — that Markbook now lists T1 Primary sheets and a sample Primary student's report card now shows T1 grades.

## 6. Testing

- **Unit:** since `grading-workbook-t1-primary.ts` is a near-verbatim copy of already-tested `grading-workbook-t2.ts` logic, tests mirror that file's existing suite shape (identity resolution, exclusion set, dedup) but run against the real T1 fixture files, asserting the exact counts confirmed during design (6 files parse cleanly, 3 excluded sections per file where applicable, the one MAPEH correction note).
- **Reused, not retested:** `t2-masthead.ts`'s row-position constants, column-layout finder, and printed-grade-column finder are consumed as-is — already covered by their own existing test suite, confirmed unchanged.
- No integration test suite — operator tooling reviewed by hand via the preview report, same as every prior phase.

## 7. Out of scope

- **Sub-phase 2 (T1 Secondary Regular-track)** — Discipline 2, Integrity 2, S3 Consistency, S4 Excellence, from the same 9-file `Grades/` folder. Deferred because its parser needs an explicit DO-NOT-USE-tab filter (mirroring `grading-workbook-global-t2.ts`'s `sheetName.startsWith('DO NOT USE')` check) that the existing `grading-workbook-secondary-t2.ts` has never needed — confirmed via direct testing this session that T1's DO-NOT-USE tabs resolve to the _same_ identity as their real counterparts (e.g. both resolve to `S4 Excellence`), which the generic dedup logic (`dedupePreferringNonReservedTab`, which only special-cases `Reserved`-prefixed names) would NOT safely arbitrate — the exact silent-corruption risk class the Science/Discipline-1 correction already fixed once for a different cause. Separate, later spec.
- T1's existing Secondary Global-track data (S1 Discipline 1, S2 Integrity 1) — already correctly imported by Phase 3, untouched by this phase.
- Filipino/Global Perspectives weight correction — already applied separately this session (`gen-ay2026-t2-fil-gp-weight-correction.ts`), unrelated to this phase's own scope (T1's Filipino header was already correct at 30/50/20 all along).
