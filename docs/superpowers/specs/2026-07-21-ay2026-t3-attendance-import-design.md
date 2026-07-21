# AY2026 T3 Attendance Import — Design

**Date:** 2026-07-21
**Status:** Design (approved in brainstorming; pending spec review)
**Target:** Import HFSE's real T3 daily attendance (P/A/EX/L marks, 29-Jun–4-Sep 2026) into production, and populate `school_calendar` + `calendar_events` for T3.

**Scope:** A new phase in the ongoing AY2026 data-import project (`.claude/worktrees/ay2026-t1-enrollment-import`), following the completed T1/T2 sequences. Prerequisite already done outside this phase: the `terms` row for T3 (`start_date=2026-06-29`, `end_date=2026-09-04`) was missing from the database entirely (AY2026 predates `create_academic_year`'s auto-seeding of all 4 terms) and has been inserted directly.

> **Correction (during planning, before implementation):** §2 Locked Decision #2 below originally said Phase 1's `parseSheet` is reused unmodified for roster/marks extraction. Verified against the real file and that's wrong: `parseSheet` locates the roster's date-header row by scanning for the _first_ row containing any `"D-Mon"`-shaped cell, but T3's legend rows (4–7) already contain scattered single dates in that exact shape (`"21-Jul"`, `"6-Jul"`, `"9-Aug"`, `"26-Aug"` — one per legend group) — so it locks onto row 4 (3–4 matches) instead of the real header at row 12 (68 matches). §2/§4 below are corrected to build a small T3-specific roster/marks parser (adapted from `parseSheet`'s logic — same name/index/marks extraction, but header-row detection uses "the row with the most date-shaped cells," an unambiguous rule given row 12's 68 vs. any legend row's ≤4) rather than calling `parseSheet` directly.

---

## 1. Why this phase, and what's different from T1/T2's attendance imports

T1 and T2 both came from a plain roster workbook (`Index No | Bus No. | Leave info | [Classroom Officers] | Full Name | dates...`) with a free-text or date-aligned-label legend that required guessing which blank dates were holidays. T3's source, `AY2026/T3/AY2026 Term 3 Attendance (1).xlsx`, is a **structurally different, richer workbook** — it's HFSE's current native template, the exact one KD #151 (attendance-sheet template fidelity) built the in-system Term sheet to mirror. Confirmed by direct inspection of all 23 sheets:

1. **Same roster/marks shape, positionally — but the header-row rule needs its own logic.** The 4 identity columns before `Full Name` (`Index No | Bus No. / Student Care | Academics | Admin | Full Name`) match T2's column _count_ exactly, and `Full Name` sitting immediately before the first date column (same as T1/T2) still holds. But T3's legend rows (4–7) contain scattered single "D-Mon"-shaped dates of their own (one per legend group), so Phase 1's `parseSheet` — which finds the header row via "first row with any date-shaped cell" — locks onto row 4 instead of the real 68-date header at row 12. A new T3 parser reuses the same name/index/marks extraction logic but picks the header row via "most date-shaped cells" instead (see the correction note above).
2. **Day-type is given directly, not guessed.** Row 11 (immediately above the date-header row) carries an explicit tag per date column — `SH` (School Holiday), `PH` (Public Holiday), `SE` (School Event), `EX` (Examination), or blank. This replaces T1/T2's "all cells blank → holiday, guess which kind from label text" heuristic with a direct lookup for the tagged cases. Confirmed across all 20 real section sheets: only these 4 tag values appear, one per column, never combined.
3. **A separate, richer legend gives event labels**, but in a new shape: 4 named groups (School Events / School Holiday / Public Holiday / Examination) in the masthead, each a list of `(date-text, label)` pairs. `date-text` is day-first with the month sometimes trailing a comma-list or range (`"6-Jul"`, `"13, 20, 27 July"`, `"14-16 July"`) — a different shape from both T1's `"Month Day[-Day] Label"` strings and T2's date-aligned single-column lookup. Legend content is genuinely section-specific (exam dates/subjects differ P1 vs S4), so it's read per-sheet, not once globally.
4. **`SE`/`EX` tags don't mean "no class."** Spot-checked: 13-Jul and 20-Jul are tagged `SE` and have real `P`/`L` marks recorded — these are ordinary teaching days with an event or exam layered on top, not closures. Only `SH`/`PH` mean the day is genuinely non-teaching.
5. **Legend text can conflict; the row-11 tag wins.** 3-Sep is listed under both "School Events" (_"Teachers and ANTS Day"_) and "School Holiday" (_"Teacher's Day"_) — but its actual row-11 tag is `SE`. The tag is authoritative; legend text is only ever used to source a label, never to decide day-type.
6. **Weekends are present as real date columns.** The range is 68 contiguous calendar days (29-Jun through 4-Sep) with no gaps for Saturdays/Sundays — those columns are simply untagged and blank across every roster cell, same as a T1/T2 no-class date.
7. Section-sheet naming has a wrinkle T1/T2 didn't: `"S1 Discipline - 1"` / `"S1 Discipline - 2"` (and `"S2 Integrity - 1"` / `"- 2"`) map to the live DB sections `"Discipline 1"` / `"Discipline 2"` (`"Integrity 1"` / `"2"`) — confirmed these are two genuinely distinct sections (different form advisers, different roster sizes), not a paginated split of one section. Every other section name matches the DB directly (e.g. `"P1 Patience (Global)"` → level P1, section `"Patience"`).

Because Phase 1's roster already covers the full AY2026 student body, this phase has no Phase-3-style scope gap — every section this workbook covers already has a live `section_students` row to resolve against.

## 2. Locked decisions

1. **Scope is the same 20 real sections** T1/T2 cover (all of P1–P6 and S1–S4, including the `Discipline 1/2` and `Integrity 1/2` splits) — `ADMIN_Bus Summary`, `YS`, and `Reference - Dropdown` are excluded.
2. **A new T3-specific roster/marks parser, adapted from `parseSheet`'s logic** (see correction above) — same name/index/marks extraction (`Full Name` = first date column − 1, `Index No` = column 0, reject non-comma names), but its own header-row detection: the row with the _most_ date-shaped cells, not the first row with _any_ match. Phase 1's `parseSheet` itself is not modified or called.
3. **Day-type comes from the row-11 tag directly, not from blank-cell guessing**: `SH`→`school_holiday`, `PH`→`public_holiday`. Untagged columns fall back to T1/T2's existing rule (any roster cell non-blank anywhere among the 20 sections → `school_day`; every cell blank → `no_class`, covering weekends and any true gap days). `SE`/`EX`-tagged columns are `school_day` (confirmed real marks exist on `SE`-tagged dates) with an accompanying `calendar_events` row.
4. **`calendar_events` rows are created for `SE`/`EX`-tagged dates only** (per approved design scope) — `SE`→category `school_event`, `EX`→category `term_exam` (both valid per KD #76's category enum). `SH`/`PH` dates get their holiday semantics entirely from `school_calendar.day_type`, matching KD #76's existing philosophy that day-type — not a calendar event — is the holiday signal; no `calendar_events` row is created for them.
5. **Legend label matching**: each of the 4 legend groups' `(date-text, label)` pairs is parsed into one or more ISO dates (single `"6-Jul"`, comma-list `"13, 20, 27 July"`, or range `"14-16 July"` — all day-first with a shared trailing month, a different shape from T1's month-first ranges). A new small pure parser handles this, reusing `resolveDate`/`MONTH_MAP` from `legend-parser.ts` (generic month-name resolution) but not `parseLegendDateRange` (T1-specific month-first regex, wrong shape for T3). For each `SE`/`EX`-tagged column, the label is looked up from the matching group by date; `calendar_events.label` is `NOT NULL`, so a tagged date with no matching legend entry does **not** get a `calendar_events` row written at all — it's flagged in the preview report (`labelMissing`) so a human adds it by hand after reviewing the source file, rather than guessing a label or violating the constraint.
6. **`ex_reason` is always `NULL`, roster resolution via `(section, index_number)`** with unresolved rows going to needs-review, `attendance_daily` guarded by a per-row `WHERE NOT EXISTS` (no natural unique constraint), and marks normalized case-insensitively (a stray lowercase `p` was observed) — all identical to T1/T2's locked decisions.
7. **`school_calendar` and `calendar_events` population is in scope**, for T3's full 68-date range (29-Jun–4-Sep 2026), `audience='all'` (matching T1/T2 — no primary/secondary split observed in this workbook). `school_calendar.label` (nullable, informational only) is populated from the same matched legend text for every tagged date (`SH`/`PH`/`SE`/`EX`), independent of whether a `calendar_events` row was also created — it's the same underlying lookup, just written to a different, already-existing column.

## 3. Day-type + event classification algorithm

1. For each of the 68 dates, read row 11's tag on that section's sheet (tags are consistent across sections for the same date — spot-checked; a section-specific legend label doesn't change the shared day-type).
2. `SH` → `school_calendar.day_type = 'school_holiday'`, `label` = the matched School Holiday legend text. No `calendar_events` row.
3. `PH` → `day_type = 'public_holiday'`, `label` = the matched Public Holiday legend text. No `calendar_events` row.
4. `SE` → `day_type = 'school_day'`, `label` = the matched School Events legend text; also emit a `calendar_events` row (category `school_event`) when a label was found — skipped (flagged `labelMissing`) when it wasn't, since `calendar_events.label` is `NOT NULL`.
5. `EX` → `day_type = 'school_day'`, `label` = the matched Examination legend text; same `calendar_events` treatment (category `term_exam`).
6. Blank tag → aggregate every roster cell for that date across all 20 sections. Any non-blank → `school_day`, `label = null`, no event. All blank → `no_class` (weekends/gaps), `label = null`, no event.
7. Every date gets exactly one `school_calendar` row regardless of branch above; `calendar_events` rows only from branches 4–5, and only when a label was actually found.

## 4. Architecture

```
AY2026/T3/AY2026 Term 3 Attendance (1).xlsx
        │
        ▼
scripts/backfill/gen-ay2026-t3-attendance.ts
        │  1. Parse all 20 real sheets (skip ADMIN_Bus Summary, YS,
        │     Reference - Dropdown) — new masthead extractor for
        │     identity + legend groups, new roster/marks parser
        │     (adapted from parseSheet's logic, own header-row rule)
        │  2. Query DB: section_students for AY2026's 20 live sections,
        │     the T3 terms row (already inserted)
        │  3. Classify each of the 68 dates via row-11 tag lookup +
        │     legend date-list/range parsing for SE/EX labels
        │  4. Build attendance_daily rows for every non-blank cell on a
        │     school_day date; unresolved (section, index) pairs →
        │     needs-review
        │  5. Resolve S1/S2 sheet-name → DB-section-name normalization
        │     ("S1 Discipline - 1" → "Discipline 1")
        │  6. Emit SQL, chunked from the start (T2's tuned ~150KB/file
        │     target)
        ▼
ay2026-t3-attendance-preview.sql   ← reviewed first (report only)
ay2026-t3-attendance-apply/        ← reviewed + run manually after, chunked
```

New files only — nothing in Phase 1/2/3's modules is modified:

- `lib/sis/backfill/attendance/attendance-workbook-t3.ts` — masthead extractor (Term/Course/Section/Form Class Adviser identity + 4 legend groups + row-11 date tags) + a T3-specific roster/marks parser (adapted from `parseSheet`'s logic, own max-date-cell-count header-row rule).
- `lib/sis/backfill/attendance/legend-dates-t3.ts` — day-first date-list/range parser (single/comma-list/range → ISO dates), reusing `resolveDate`/`MONTH_MAP` from `legend-parser.ts`.
- `lib/sis/backfill/attendance/day-classifier-t3.ts` — the algorithm in §3.
- `lib/sis/backfill/attendance/build-attendance-import-t3.ts` — composer: roster + tags + legend + section-identity → `preview.sql` + chunked `apply/*.sql`.
- `scripts/backfill/gen-ay2026-t3-attendance.ts` — orchestrator; reads the DB (read-only) and the workbook, writes only local `.sql` files.

## 5. SQL write plan (idempotent — safe to rerun)

1. **`school_calendar`** — one row per date (68 total), `on conflict (term_id, audience, date) do nothing`.
2. **`calendar_events`** — one row per `SE`/`EX`-tagged date with a resolved label, guarded against duplicate insertion (`where not exists`, matched on term + date + category).
3. **`attendance_daily`** — one row per resolved `(section_student_id, date)` cell with a real mark, each guarded by `where not exists (...)`.
4. **Rollup** — `recompute_attendance_rollup(term_id, section_student_id)` once per distinct student touched.
5. **Chunking** — `apply.sql` split into multiple self-contained files from the start (T2's tuned ~150KB/file target): calendar + events as their own small file(s), marks chunked, rollups last.

`ay2026-t3-attendance-preview.sql` is the same read-only companion shape as T1/T2's: date classification table (including which dates got a `calendar_events` row and their resolved label), roster-resolution failures, any `SE`/`EX`-tagged date with no matching legend label (flagged, not silently blank), and the apply-file run order.

## 6. Validation plan

1. Run the generator; read the preview report.
2. Spot-check a handful of dates/students against the source file, including at least one of each classification (`school_day` plain, `school_day`+`school_event`, `school_day`+`term_exam`, `school_holiday`, `public_holiday`, `no_class`/weekend).
3. Confirm the 3-Sep conflicting-legend case resolved to `SE`/`school_event`, not `school_holiday`.
4. Run the apply files in order (single connection/session per file).
5. Read-only follow-up query confirms `school_calendar` (~68), `calendar_events` (~count of SE/EX tags), `attendance_daily`, and `attendance_records` row counts, plus a sanity check that `attendance_pct` values aren't uniformly 0% or 100%.

## 7. Testing

- **Unit:** the masthead/legend-group extraction, the new header-row-detection + roster/marks parser (including a fixture proving it correctly skips the legend rows' scattered dates and locks onto the real 68-date header row), the day-first date-list/range parser (single/comma-list/range fixtures), and the row-11-tag-driven classifier — all pure, testable against synthetic fixtures mirroring T3's real masthead shape.
- No integration test suite — same as every prior phase, this is operator tooling reviewed by hand via the preview report.

## 8. Out of scope

- T4 — explicitly deferred (no source file yet).
- Grading and evaluation for T3 — separate future specs, following the same phase pattern as T1/T2.
- Re-resolving any students who were already unresolved in a prior phase's needs-review bucket.
- A generalized/reusable "native masthead" parser for future terms — if T4 or an AY2027 workbook arrives in this same shape, generalize then, with two real examples to design against.
