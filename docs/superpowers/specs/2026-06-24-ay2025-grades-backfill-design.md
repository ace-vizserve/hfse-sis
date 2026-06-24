# AY2025 Grades Backfill — Design (masterfile-only)

**Date:** 2026-06-24
**Status:** Design (decisions approved in brainstorming; pending spec review)
**Target:** AY2025 **report cards (T1–T4) + Academic Summary** in production — the last piece of the AY2025 historical backfill. Goal is the _issued_ historical grades families received, not operational re-grading.

**Scope:** **T1–T4, all subjects, sourced entirely from the masterfile.** No grading-file (component) import.

---

## 1. Why masterfile-only (the pivotal finding)

The report card renderer reads the **stored** grade, not the components. Verified in `lib/report-card/build-report-card.ts`: it selects `quarterly_grade, letter_grade, is_na, annual_letter_grade` and uses `entry.quarterly_grade` directly (lines 297/324/347) — it never reads or recomputes from `ww_scores`/`pt_scores`. The annual/Overall + GA + Subject/Overall awards all **derive** from the four term grades (`lib/compute/annual.ts` + `awards.ts`), again from the quarterlies, not components.

Therefore the **masterfile is sufficient** for historical report cards + Academic Summary:

- **Grades:** masterfile has the per-subject per-term quarterly (numeric, examinable) / letter (non-examinable), T1–T4, already reflecting the issued/Adjusted values → stored as `grade_entries.quarterly_grade` / derived letter.
- **Attendance:** already done (daily marks + rollups loaded; the card reads the rollup).
- **Comments / virtue themes / form advisers / letterhead:** already loaded.
- **Annual / Overall / GA / awards:** derive from the four stored term grades.

The WW/PT/QA **component import (the 39 grading workbooks) is deliberately out of scope** — it only feeds Markbook's operational "view scores" grid, which a closed year never uses, and all of its complexity (MAPEH→4 split, MT Filipino/Mandarin split, Adjusted overrides, secondary streaming, per-sheet weights) lives in the _files_, not the masterfile. The masterfile already carries every grade in clean DB-subject granularity (MUSIC/ARTS/PE/HE separate, one MT grade, the issued value), and a **blank cell already encodes "student doesn't take this subject"** — so per-level subject sets + streaming fall out for free.

## 2. Locked decisions

1. **Masterfile-only** — no component files; store the issued grade per (student × subject × term), T1–T4.
2. **Issued grade is authoritative** — the masterfile value is stored verbatim; nothing is recomputed against components.
3. **Import a `grade_entry` only where the masterfile cell is non-empty** — blank = not taken (handles level/streaming).
4. **Examinable** → store the masterfile numeric as `quarterly_grade`. **Non-examinable** → store a **band-representative numeric** so `numericToLetter` renders the masterfile letter (A≥90 / B≥85 / C≥80 / IP<80); the numeric is never displayed (the card shows the derived letter). `N.A.` → `is_na=true`.
5. **Annual/Overall/GA/awards derive** from the four terms and **cross-check** against the masterfile's Overall + Award columns (verification, not stored).
6. **Mechanism: one-off importer script** (`dry-run → report → apply`), reusing the masterfile parser + FCA student-matcher. Loads `.env.local` itself; no writes until the dry-run is approved.

## 3. Architecture

```
masterfile  ──►  for each (student × subject-column × term) with a non-empty cell:
                   • map masterfile subject column → DB subject code (clean 1:1)
                   • match student → roster (reuse FCA matcher: name → canonical enrolee → section_students)
                   • ensure grading_sheet (section × subject × term) exists  [+ minimal subject_config if FK requires]
                   • write grade_entry:
                       examinable     → quarterly_grade = masterfile numeric
                       non-examinable → quarterly_grade = band-representative numeric (renders masterfile letter)
                       N.A.           → is_na = true
                   • is_locked = true (historical)
                 then: derive annual/Overall/GA/awards → cross-check vs masterfile Overall + Award; report mismatches.
```

## 4. Subject mapping (clean 1:1, masterfile column → DB code)

- **Primary:** ENGLISH→`ENG`, MATH→`MATH`, MOTHER TONGUE→`MT`, SCIENCE→`SCI`, Social Studies→`SS`, MUSIC EDUCATION→`MUSIC`, ARTS EDUCATION→`ARTS`, PHYSICAL EDUCATION→`PE`, HEALTH EDUCATION→`HE`.
- **Secondary:** +HISTORY→`HIST`, LITERATURE→`LIT`, HUMANITIES→`HUM`, ECONOMICS→`ECON`, CONTEMPORARY ART→`CA`, PHYSICAL EDUCATION AND HEALTH→`PEH`; MATHEMATICS→`MATH`.
- Any unmapped column is **flagged** in the dry-run, never silently dropped.

## 5. Components (all under `lib/sis/backfill/`, pure where logic-bearing)

- **masterfile parser** — reuse/extend the loader already used for the FCA pass: yields `(canonicalEnrolee, subjectCode, term, value, kind: numeric|letter|na, overall, award)` for every non-empty cell, both workbooks, T1–T4.
- **subject-map** — the §4 table; unit-tested, flags unmapped.
- **student matcher** — reuse the FCA matcher (sheet/masterfile name → reconciliation → canonical enrolee → `section_students`). Held-52 dups skip (not in roster); listed in the report.
- **scaffolding writer** — create/ensure `grading_sheets` per (section, subject, term) with empty slot config + `is_locked=true`; create minimal `subject_configs` per (subject×level) **only if** the schema requires the FK (placeholder weights — irrelevant with no components).
- **entry writer** — `grade_entries` per (section_student × grading_sheet): examinable numeric / non-exam band-representative numeric / `is_na`. Idempotent upsert on the natural key.
- **verification** — derive annual/Overall/GA + Subject/Overall awards from the stored terms; compare to the masterfile's Overall + Award columns; emit the mismatch list.

## 6. Modes

- **`dry-run`** — parse + map + match + scaffold-plan + verify; write a **report only** (entries per subject/term, unmatched students, unmapped columns, derived-vs-masterfile Overall/Award mismatches). **Zero DB writes.**
- **`apply`** — after review, write `subject_configs?` → `grading_sheets` → `grade_entries` idempotently; re-emit the verification summary.

## 7. Verification & error handling

- The stored grade is the masterfile value verbatim — no divergence possible at the term level.
- **Cross-check:** the _derived_ annual/Overall + awards must match the masterfile's Overall + Award columns; mismatches indicate a mapping/parse error → investigate before apply.
- **No silent caps:** unmapped columns, unmatched students, and award mismatches are all listed in the dry-run report.
- Sheets `is_locked=true` (historical).

## 8. Testing

- **Unit:** masterfile parser (examinable numeric, non-exam letter, N.A., T4/Overall/Award columns); subject-map (every column → code, flags unmapped); the band-representative-numeric → `numericToLetter` round-trip (A/B/C/IP); `annual.ts`/`awards.ts` self-tests.
- **Integration (dry-run):** derived Overall/Award == masterfile for the roster; every non-empty cell either written or explicitly reported as unmatched/unmapped.

## 9. Out of scope

- The **WW/PT/QA component import** (the 39 grading workbooks) — operational "view scores" detail only; AY2025 "view scores" will show the grade with no breakdown. Can be layered later if ever needed.
- **In-app grades-import feature** (one-off backfill — YAGNI).
- Provisioning the **missing AY2026 subject_configs** (separate go-live concern, flagged).
- The **52 held DIFF_SN dups** (not in roster; skip, as in the FCA pass).

## 10. Open items (resolve during writing-plans / build — not blocking the design)

- Verify the `grade_entries` / `grading_sheets` / `subject_configs` schema: NOT-NULL columns (do `ww_scores`/`pt_scores` need `[]`?), whether `grading_sheets` requires a `subject_config` FK (→ whether minimal configs are needed), and the exact natural keys for idempotent upserts.
- Confirm the non-exam **band-representative numeric** approach is acceptable vs pulling real numerics from the ~4 non-exam component files (MAPEH/CCA/PE/Contemporary Arts) — default is representative (file-free; only the letter is shown).
- Confirm masterfile **column offsets per term** (examinable: 6 cols = T1–T4/Overall/Remarks; non-exam: 4 cols = T1–T4) hold across both workbooks for every subject.
- Pick the student-match key (name via reconciliation vs (section, index)) by measuring coverage in the dry-run.
- Decide whether T4 non-exam should also set `annual_letter_grade` (KD #100) or rely solely on the derived annual letter from the four representative numerics.
