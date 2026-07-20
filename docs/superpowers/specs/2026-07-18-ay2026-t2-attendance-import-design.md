# AY2026 T2 Attendance Import — Design

**Date:** 2026-07-18
**Status:** Design (approved in brainstorming; pending spec review)
**Target:** Import HFSE's real T2 daily attendance (P/A/EX/L marks, 24-Mar–28-May 2026) into production, and populate `school_calendar` for T2.

**Scope:** Phase 5 of a new T2 sequence (attendance → grading → evaluation → Records cross-check), following the completed T1 sequence (Phases 1–3 live in production; T1 evaluation deferred, no real source file exists yet).

---

## 1. Why this phase, and what's different from T1's attendance import (Phase 2)

Phase 2 imported T1 daily attendance from `T1 Attendance Jan-Mar (1).xlsx` and established the reusable pattern this phase follows closely: `lib/sis/backfill/attendance/*` (legend parsing, day-type classification, SQL composition) plus the shared workbook-parsing helpers from Phase 1. The source for T2, `AY2026/T2/T2 Attendance Mar-May (1).xlsx`, is structurally very close to T1's — same P/A/EX/L single-letter codes, same masthead shape — with three real differences confirmed by direct inspection:

1. **Two extra leading columns.** T1's sheets went straight from `Full Name` into the date grid. T2's sheets insert `Bus No.` and `Classroom Officers` between the leave-quota column and `Full Name` — five header columns before dates begin (`Index No | Bus No. | Leave info | Classroom Officers | Full Name | dates...`), confirmed identical across every sampled P1–S4 section (both Primary tracks, both Secondary tracks).
2. **A richer, per-month legend.** T1's legend was a single continuous "School Holiday"/"Important dates" list scanned for free-text date-range strings (`"Feb 17-18 CNY"`). T2's legend repeats the same two-column header three times (once per month in the Mar–May range) and — more usefully — carries a **third representation**: row 8 (directly above the date-header row) prints each event's label **in the exact column of the date it falls on** (e.g., `"Good Friday"` sits directly under the `3-Apr` column). This is a more reliable label source than free-text date-range parsing and this phase uses it as the primary label lookup instead.
3. **YS (Youngstarters) now has real, usable attendance data**, unlike T1 where it was an empty/placeholder sheet excluded from scope. Per the locked decision below, it stays out of scope for this phase — it uses spelled-out words ("Present"/"Absent") instead of the P/A/EX/L codes every other sheet uses, a genuine format difference that deserves its own dedicated import, not a special-cased branch bolted onto this one.

Because Phase 1's roster (`section_students`) already covers the full 371-student roster across all 20 real sections — unlike Phase 3's grading import, which was narrowly scoped to 2 sections — this phase's roster resolution has no Phase-3-style scope gap: every section this workbook covers already has a live `section_students` row to resolve against.

## 2. Locked decisions

1. **Scope is the same 22 real sections Phase 2 already covers** (all of P1–P6 and S1–S4, both Global and Regular tracks) — `YS` and every `Reserved N` tab are excluded, matching Phase 2's exact exclusion list.
2. **YS is explicitly deferred to its own future import**, not built here. Its word-based marks ("Present"/"Absent" instead of P/A/EX/L) are a real format difference, not a trivial branch — building it now would couple two genuinely different parsing shapes into one module for no benefit this phase needs.
3. **Column layout is located by header label, not fixed position.** The parser finds `Full Name` and the first date column by scanning the header row for their labels, rather than assuming a fixed offset — this absorbs T2's two extra leading columns without needing a T1-vs-T2 branch anywhere in the date-grid reading logic.
4. **Day-type classification stays data-driven, matching Phase 2 exactly**: a date is `school_day` if any roster cell anywhere is non-blank; a date where every cell across every section is blank is a holiday/no-class date. This principle already proved itself against messy legend text in Phase 2 (KD #50, Locked Decision #4) and is even more clearly the right call here, given T2's legend has three overlapping representations of the same events.
5. **Legend labeling uses row 8 (the date-aligned event row) as the primary source**, not the free-text "School Holiday"/"Important dates" summary table above it — row 8 already maps `event name → date column` directly, with no date-range text to parse. The summary table is not used at all (redundant with row 8, and free-text parsing was only ever a fallback necessity in Phase 2, not a preference).
6. **HBL / public holiday / no-class sub-classification follows Phase 2's exact rule**: a blank date with a row-8 label mentioning "HBL" → `school_holiday` + `hbl_overlay=true`. Every real label found in this workbook was hand-classified against that rule (none mention HBL, so this path isn't expected to trigger on real T2 data, but the check stays in place for correctness): **`public_holiday`** — Good Friday, Labor Day, Vesak Day, Hari Raya Haji (genuine Singapore public holidays); **`no_class`** — everything else found (Student Recollection, General PTC, Staff Dev't Day, English Week, Science Week, P1&P2/P5/P6 Fieldtrip, Term 2 Exam, Marking Day, In Lieu of Family Sportsfest — all operational closures, not public holidays). A blank date whose label doesn't match this explicit list falls back to `no_class` (never guessed as `public_holiday` without a positive match) and is flagged in the preview report for a human to confirm, so a real public holiday this list doesn't yet know about is surfaced, not silently miscategorized. This mirrors T1's Marking Day precedent exactly (KD #50 §3) — the objective all-blank signal decides _that_ a date is closed; the label only decides _which kind_, and is cosmetic (informational only) either way.
7. **`ex_reason` is always `NULL`**, roster resolution via `(section, index_number)` lookup with unresolved rows going to needs-review, `attendance_daily` has no natural unique constraint so a per-row `WHERE NOT EXISTS` guard applies, and sheets that don't fit one apply file get chunked the same way Phase 2's mid-session fix established — all identical to Phase 2's locked decisions, not repeated in full here.
8. **`school_calendar` population is in scope**, same as Phase 2, for T2's 48 dates (24-Mar through 28-May 2026).

## 3. Day-type classification algorithm

Identical in structure to Phase 2's (KD #50 §3), with the label source changed per Locked Decision #5:

1. Aggregate every roster cell for that date across every one of the 22 real sections (skip `YS` and `Reserved N`).
2. If **any** cell is non-blank → `school_day`.
3. If **every** cell is blank → holiday/no-class date. Look up row 8's label at that date's column (checked across sections — the label is section-specific in content, e.g. "P1&P2 Fieldtrip" only appears on P1/P2 sheets, so the classification takes the label from whichever section actually has one; a date with no label anywhere still gets a `school_calendar` row, just with `label=null`).
4. Classify: label mentions "HBL" → `school_holiday` + `hbl_overlay=true`; label exactly matches the explicit public-holiday whitelist (Good Friday, Labor Day, Vesak Day, Hari Raya Haji) → `public_holiday`; anything else, including no label at all → `no_class`. A blank date whose label doesn't match the whitelist is additionally flagged in the preview report (not silently trusted as `no_class` without a human glance) so a genuine public holiday the whitelist doesn't yet know about gets caught before `apply.sql` runs, not after.

## 4. Architecture

```
AY2026/T2/T2 Attendance Mar-May (1).xlsx
        │
        ▼
scripts/backfill/gen-ay2026-t2-attendance.ts
        │  1. Parse all 22 real sheets (skip YS, skip Reserved N) — new
        │     parser locates Full Name / date columns by header label,
        │     reusing Phase 1/2's row-boundary + mark-validation logic
        │  2. Query DB: section_students for AY2026 T2's 22 live sections
        │     (already fully rostered by Phase 1 — no narrow-scope gap)
        │  3. Classify each of the 48 dates via row-8 label lookup
        │  4. Build attendance_daily rows for every non-blank cell on a
        │     school_day date; unresolved (section, index) pairs → needs-review
        │  5. Emit SQL, chunked if the combined size risks the Supabase
        │     SQL Editor's rejection threshold (Phase 2's mid-session fix)
        ▼
ay2026-t2-attendance-preview.sql   ← reviewed first (report only)
ay2026-t2-attendance-apply/        ← reviewed + run manually after, chunked
```

## 5. SQL write plan (idempotent — safe to rerun)

Identical shape to Phase 2's final (post-chunking-fix) design:

1. **`school_calendar`** — one row per date (48 total), `on conflict (term_id, audience, date) do nothing`.
2. **`attendance_daily`** — one row per resolved `(section_student_id, date)` cell with a real mark, each guarded by a per-row `where not exists (...)` (no natural unique constraint on this table).
3. **Rollup** — `recompute_attendance_rollup(term_id, section_student_id)` once per distinct student touched.
4. **Chunking** — the generator splits `apply.sql` into multiple self-contained transaction files from the start this time (rather than discovering the need mid-session, as Phase 2 did) — a marks-chunk size tuned to stay well under the size that failed Phase 2 (~150KB per file), calendar and rollups as their own small files.

`ay2026-t2-attendance-preview.sql` is the same read-only companion shape as Phase 2's: date classification table, roster-resolution failures, and the apply-file run order.

## 6. Validation plan

1. Run the generator; read the preview report.
2. Spot-check a handful of dates/students against the source file, including at least one of each classification (`school_day`, `public_holiday`, `school_holiday`/HBL if any exist, `no_class`).
3. Run the apply files in order (single connection/session per file, per Phase 2's established instructions).
4. Read-only follow-up query confirms `school_calendar` (~48), `attendance_daily` (~roster × school days), and `attendance_records` row counts, plus a sanity check that `attendance_pct` values aren't uniformly 0% or 100%.

## 7. Testing

- **Unit:** the header-label column-location logic (Full Name / first date column found by scanning, not fixed offset) and the row-8 label lookup — pure and testable against synthetic fixtures mirroring T2's real masthead shape (including the two extra leading columns).
- **Reused, not retested:** Phase 1/2's row-boundary detection, mark validation, and SQL-emission chunking logic are consumed as-is wherever they don't need to change for T2's masthead differences.
- No integration test suite — same as every prior phase, this is operator tooling reviewed by hand via the preview report.

## 8. Out of scope

- `YS` (Youngstarters) — deferred to its own future import (Locked Decision #2).
- Grading (Phase 6) and evaluation (Phase 7) — separate specs.
- Re-resolving any students who were already unresolved in Phase 1/2/3's needs-review buckets — if a student's roster row still doesn't exist, they'll appear in this phase's needs-review bucket too, same as every prior phase.
