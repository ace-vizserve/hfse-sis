# AY2026 T1 Attendance Import — Design

**Date:** 2026-07-17
**Status:** Design (decisions approved in brainstorming; pending spec review)
**Target:** Import HFSE's real T1 daily attendance (P/A/EX/L marks, 8-Jan–13-Mar 2026) into production, plus populate `school_calendar` for T1, reusing the same attendance workbook Phase 1 used to build the roster.

**Scope:** Phase 2 of 4 in the broader AY2026 T1 data-import project (Phase 1 — enrollment/roster — is complete and live in production). Phase 3 (grading) and Phase 4 (evaluation) remain separate specs.

---

## 1. Why this is Phase 2, and what changed since Phase 1

Phase 1 established AY2026's T1 term, its 20 real sections, and a 371-student roster in `section_students` — all sourced from the same `T1 Attendance Jan-Mar (1).xlsx` workbook. That workbook's actual daily attendance grid (the P/A/EX/L marks under 47 dated columns per section) was parsed by Phase 1's tooling only far enough to build the roster; the marks themselves were never imported. This phase imports those marks into `attendance_daily`, computes the derived `attendance_records` rollup, and — newly in scope per this round's design — populates `school_calendar` for T1 so the live app's attendance grid isn't running in "legacy mode" (KD #50) going forward.

Because Phase 1 already exists and is live, Phase 2 does **not** need to re-derive student identity from names. Every real student in this workbook now has a `section_students` row carrying the exact `index_number` taken from this same workbook's "Index No." column. Phase 2 resolves each workbook row to its `section_students.id` via a live `(section, index_number)` lookup — no fuzzy name-matching required.

## 2. Locked decisions

1. **Roster resolution via `(section, index_number)` lookup**, not re-matching names. A workbook row that doesn't resolve (an index-number typo, or one of Phase 1's 25 still-unresolved "needs review" students) lands in this phase's own needs-review bucket — never guessed.
2. **`ex_reason` is always `NULL`** for imported `EX` marks. The source workbook records only the single letter `EX` (per KD #132, HFSE's paper-sheet palette collapses all excused sub-types to one letter) — there is no sub-reason data to import. Consequence: this term's excused absences won't count toward the vacation/compassionate leave quotas (KD #94), since those are keyed on `ex_reason` specifically. Quota tracking starts clean from whenever staff begin live-encoding in the app.
3. **`school_calendar` population is in scope for this phase.** Populated for T1 from the workbook's own data, not a separately-sourced academic calendar (none was available).
4. **Day-type classification is data-driven, not legend-text-driven.** A date is `school_day` if at least one roster cell anywhere is non-blank on that date; it's a holiday/no-class date if **every** roster cell across every section is blank. Verified empirically against the real file: `17-Feb`/`18-Feb` (CNY) and `6-Mar` (Marking Day) are all-blank across all 396 roster entries (20 real sections × their rosters) — confirming this signal works, including for the Marking Day case where the workbook's own legend filed it under "Important dates" rather than "School Holiday" despite being a genuine closure. The legend text is used only as a secondary label enrichment on top of this objective signal, never as the primary classifier.
5. **Blank cells on `school_day` dates are skipped entirely** — never written as an explicit `NC` row. Confirmed against `recompute_attendance_rollup`'s actual body (migration 068): `school_days = count(*) filter (where status <> 'NC')` operates only over rows that exist in `attendance_daily`; a date with no row at all is correctly excluded from `school_days` without needing an `NC` row.
6. **No unique constraint exists on `attendance_daily`** for `(section_student_id, date, period_id)` — it's deliberately append-only, "latest `recorded_at` wins" (migration 014's table comment). The generated `apply.sql` therefore adds its own `WHERE NOT EXISTS (...)` guard per row so regenerating-and-rerunning doesn't create duplicate rows.
7. **Mechanism: same generator → reviewable SQL files pattern as Phase 1.** One transaction, one file pair (`ay2026-t1-attendance-{preview,apply}.sql`), despite the larger scale (~16,000 `attendance_daily` rows) — Postgres handles a `VALUES` clause of that size without issue, and running the file directly (not pasting) avoids the known SQL-editor line-corruption gotcha.
8. **`period_id = NULL`** for every row (whole-day status; the schema's own comment marks this column as a dormant Phase-2-of-the-app forward-compat hook, not yet in use). **`recorded_by = NULL`, `recorded_at = now()`** — this is an import, not a specific teacher's live entry; stamping the actual import time is more honest than inventing a backdated timestamp.

## 3. Day-type classification algorithm

For each of the 47 dates (identical across all 24 sheets, confirmed in Phase 1):

1. Aggregate every roster cell for that date across every non-empty core section (skip `Reserved N` and `YS`, same exclusions as Phase 1).
2. If **any** cell is non-blank → `day_type = 'school_day'`.
3. If **every** cell is blank → holiday/no-class date. Determine sub-classification:
   - Search both masthead legend columns ("School Holiday" and "Important dates" — both must be checked, since a genuine closure like Marking Day can appear under either) for a date-range string covering this date.
   - Legend text mentions "HBL" → `day_type = 'school_holiday'`, `hbl_overlay = true` (KD #98 — still encodable in the live app).
   - Legend match found in the "School Holiday" column (no "HBL" mention) → `day_type = 'public_holiday'`.
   - Legend match found only in "Important dates," or no match at all → `day_type = 'no_class'` (covers operational closures like Marking Day that aren't public holidays).
   - `label` is set from the matched legend text when found, else `null` — a date with no legend match still gets a `school_calendar` row (never silently skipped).

## 4. Architecture

```
AY2026/T1/T1 Attendance Jan-Mar (1).xlsx
        │
        ▼
scripts/backfill/gen-ay2026-t1-attendance.ts
        │  1. Parse all 24 sheets — reuse Phase 1's
        │     lib/sis/backfill/enrollment/attendance-workbook.ts parser as-is
        │     (same masthead/date-grid format; this phase reads the daily
        │     P/A/EX/L cells the Phase-1 parser already walks past)
        │  2. Query DB: section_students for AY2026 T1's 20 live sections,
        │     building a (section name, index_number) → section_students.id map
        │  3. Classify each of the 47 dates (§3 above)
        │  4. Build attendance_daily rows for every non-blank cell on a
        │     school_day date; unresolved (section, index) pairs → needs-review
        │  5. Emit two files:
        ▼
ay2026-t1-attendance-preview.sql   ← reviewed first (report only)
ay2026-t1-attendance-apply.sql     ← reviewed + run manually after, ONE transaction
```

## 5. SQL write plan (idempotent — safe to rerun)

`ay2026-t1-attendance-apply.sql` contains, in order:

1. **`school_calendar`** — insert one row per date (all 47: `school_day` ones plus the holiday ones from §3), guarded by `on conflict (term_id, date) do nothing` (the table's existing unique constraint).
2. **`attendance_daily`** — insert one row per resolved `(section_student_id, date)` cell with a real mark, each guarded by `where not exists (select 1 from attendance_daily ad where ad.section_student_id = ... and ad.date = ... and ad.period_id is null)` (no natural unique constraint exists here, per locked decision #6).
3. **Rollup** — call `recompute_attendance_rollup(term_id, section_student_id)` once per distinct student touched (not per row), populating `attendance_records`.

**Explicitly not touched:** `calendar_events`, `grading_sheets`/`grade_entries`, `evaluation_writeups` — those are out of scope or later phases.

`ay2026-t1-attendance-preview.sql` is a read-only companion: the 47-date classification table (with labels), roster-resolution failures, per-section row counts — reviewed before `apply.sql` is ever run.

## 6. Validation plan

1. Run the generator; read the preview report (date classification, resolution failures, counts).
2. Spot-check a handful of dates/students against the source file.
3. Run `apply.sql` once (single transaction).
4. Read-only follow-up query confirms: `school_calendar` row count for T1 (~47), `attendance_daily` row count (~16,000), `attendance_records` row count (371 — one per student), and that `attendance_pct` values look sane (not uniformly 0% or 100%).

## 7. Testing

- **Unit:** the day-type classification algorithm (all-blank detection, legend-text matching for both columns, the HBL/public_holiday/no_class tiering) — pure and testable against synthetic fixtures mirroring the real masthead shapes already characterized in this design.
- **Reused, not retested:** Phase 1's `attendance-workbook.ts` parser is consumed as-is; no changes to it are in scope here.
- No integration test suite planned — same as Phase 1, this is operator tooling reviewed by hand via the preview report.

## 8. Out of scope

- `calendar_events` (KD #76 overlay — Math Week, exams, Eye & Dental Check-up, etc.) — informational legend entries that aren't genuine closures are not imported anywhere.
- T2–T4 attendance (no dates confirmed yet).
- Re-resolving Phase 1's 25 still-outstanding "needs review" students — if unresolved, their attendance simply can't be imported either, and they'll appear in this phase's own needs-review bucket too.

## 9. Open items (resolve during writing-plans / build — not blocking the design)

- Exact legend-text date-range parsing approach (e.g. `"Feb 17-18 CNY"` → the date range `[Feb 17, Feb 18]`) — needs a small, testable parser for the handful of date-range formats observed (`"Mon D"`, `"Mon D-D"`, `"Mon D - Mon D"`).
- Confirm whether `school_calendar` needs explicit weekend rows or can stay sparse (matching the workbook, which has no weekend columns at all) — current design leans toward leaving weekends unrepresented, consistent with KD #50's "empty → legacy mode" being a loose, non-broken fallback.
