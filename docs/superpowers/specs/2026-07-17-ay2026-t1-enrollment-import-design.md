# AY2026 T1 Enrollment Import — Design

**Date:** 2026-07-17
**Status:** Design (decisions approved in brainstorming; pending spec review)
**Target:** Establish the foundational AY2026 T1 operational data (term dates, real section list, roster) from HFSE's live T1 attendance workbook, since `section_students`/`terms` are currently empty for AY2026 despite the admissions tables already holding ~497 applications.

**Scope:** This is **Phase 1 of 4** in the broader AY2026 T1 data-import project. The other three phases each get their own design later:

- Phase 2 — Attendance (`attendance_daily`), reusing this same workbook
- Phase 3 — Grading sheets (WW/PT/QA), reconciling per-subject legacy weight scales
- Phase 4 — Evaluation — **scope currently unclear**: the uploaded "evaluation" file is structurally a PTC checklist, not FCA write-up text, and KD #114 says the Evaluation module deliberately dropped PTC-checklist support. Needs its own scoping conversation before that phase starts.

---

## 1. Why this is needed (the pivotal finding)

A DB investigation (2026-07-17) found AY2026 is `is_current=true` and admissions data is flowing normally (497 `ay2026_enrolment_applications` rows, 492 `ay2026_enrolment_status` rows, 499 `ay2026_enrolment_documents` rows) — but the **operational** side is essentially unbuilt:

- `terms`: **0 rows** for AY2026 — no T1–T4 dates exist at all.
- `sections`: **2 rows** ("Patience", "Respect", both under P1) — versus the ~20 real sections HFSE actually runs.
- `section_students`: **0 rows** — the roster table every other module (attendance, grading, evaluation) keys off is empty.
- Of the 492 `ay2026_enrolment_status` rows, only 4 have progressed to `Enrolled`/`Enrolled (Conditional)`; 433 are still `Submitted`, and only 93 even have `classSection` set.

Meanwhile HFSE's real T1 attendance workbook (`AY2026/T1/T1 Attendance Jan-Mar (1).xlsx`) shows the ground truth: 24 section tabs (one per real section, including some genuinely empty ones), each with a full student roster, form teacher, and 47 days of daily attendance marks (8-Jan-2026 through 13-Mar-2026, confirmed identical across every sheet). This is the most complete and current roster source available, and is treated as canonical for T1 (per user decision).

## 2. Locked decisions

1. **Canonical roster source:** the T1 attendance workbook's per-section rosters (24 tabs), not any separate roster file. Confirmed as canonical "for now" — T3 attendance/grading will later be compared against this to detect enrollment changes (transfers/withdrawals/new joins), so the matching logic must be reusable per term, not a one-off.
2. **Section naming:** clean names matching the KD #144 convention (e.g. "Patience", "Obedience", "Discipline 1", "Discipline 2") — the file's informal annotations like "(G)"/"AM Global" are dropped, not stored. (These annotations do matter for Phase 3 — the "Lower Secondary Global Grading Sheets" folder covers exactly the "(G)"-tagged sections — but section identity itself doesn't need to encode it since names stay unique per level.)
3. **Empty sections are skipped** — a section tab with zero students (e.g. "Reserved 1" / masthead "P1 Respect") is not created in the DB. (This also means no conflict with the DB's existing empty "Respect" section, which already reflects this correctly.)
4. **T1 term dates derived from the attendance file itself:** `start_date = 2026-01-08`, `end_date = 2026-03-13` — confirmed identical (first/last dated column) across all 24 sheets. T2–T4 dates are not available yet and are out of scope.
5. **Reconciliation = smart tiered matching**, auto-accepting only high-confidence matches; anything ambiguous or unmatched is flagged for manual review, never silently written or fabricated.
6. **Matched students get promoted:** `ay2026_enrolment_status.applicationStatus` → `Enrolled`, `classSection`/`classLevel` set — since the file shows they're already attending class in reality, just not reflected in the SIS yet.
7. **Mechanism: generator script → reviewable SQL files**, not a script that writes to the DB directly. Follows the existing `scripts/backfill/gen-ay2025-*.py` → `*-preview.sql`/`*-apply.sql` convention already used for the AY2025 backfill, rather than the `ay2025-grades.ts`-style direct-write script. The generator itself is TypeScript (reuses Supabase client + can share matching logic with `lib/sis/backfill/`), but its _output_ — the two `.sql` files — is what gets reviewed and run.

## 3. Architecture

```
AY2026/T1/T1 Attendance Jan-Mar (1).xlsx
        │
        ▼
scripts/backfill/gen-ay2026-t1-enrollment.ts   (tsx, reads .env.local service key)
        │  1. Parse all 24 section sheets, skip empty ones
        │  2. Query DB: ay2026_enrolment_applications + ay2026_enrolment_status
        │     (name fields, applicationStatus), current AY2026 `levels`/`sections`
        │  3. Smart-match each roster name → enroleeNumber (tiered confidence)
        │  4. Emit two files:
        ▼
scripts/backfill/ay2026-t1-enrollment-preview.sql   ← reviewed first (report only)
scripts/backfill/ay2026-t1-enrollment-apply.sql     ← reviewed + run manually after
```

The generator is throwaway tooling (not a persistent app feature), but will be re-run in a later term (T2/T3) with updated inputs, so the matching logic should live in a small reusable module rather than being inlined.

## 4. Matching algorithm

The file's "Full Name" cells are `LASTNAME, First Middle.`; the DB has separate `firstName`/`middleName`/`lastName` on `ay2026_enrolment_applications`.

1. **Parse** the sheet name into last/first/middle; normalize both sides (uppercase, strip periods, collapse whitespace).
2. **Candidate pool** = applications where `applicationStatus` is NOT `Cancelled`/`Withdrawn` (a currently-attending student shouldn't resolve to a dead application).
3. **Tiered confidence — only the top two auto-accept:**
   - **Exact** — normalized last+first+middle all match.
   - **Strong** — last+first match exactly, middle differs only by abbreviation/omission (e.g. file has "Zion", DB has "Zion C." or blank).
   - **Fuzzy** — similarity score ≥ a high threshold (e.g. Jaro-Winkler ≥ 0.90) **and exactly one** candidate clears it.
   - **Everything else** (multiple close candidates, below threshold, zero candidates, or the same `enroleeNumber` claimed by two different roster rows) → **not auto-applied**; listed in the preview report's "needs review" section with its candidate(s) shown.

Lives in `lib/sis/backfill/enrollment/name-match.ts` (reusable for T2/T3), with a light unit test since it's not truly one-off.

## 5. SQL write plan (idempotent — safe to rerun)

`ay2026-t1-enrollment-apply.sql` contains, in order:

1. **Term** — insert `terms` row (AY2026, term_number=1, start=2026-01-08, end=2026-03-13), guarded against duplication on rerun.
2. **Sections** — insert each new non-empty section (`name`, `level_id`, `form_class_adviser` pulled from the sheet's "Form Teacher" row — a display-only field per KD #67, low-risk to populate now). Relies on the existing `unique(academic_year_id, level_id, name)` constraint for `ON CONFLICT DO NOTHING`.
3. **`public.students`** — upsert by `student_number` (already populated on 495/497 applications; the 2 without one are flagged in the review report) for matched students not yet synced.
4. **`section_students`** — insert with `enrollment_status='active'`, **`enrollment_date = NULL`** (critical: these are on-time T1 enrollees; stamping today's date would wrongly exclude all Jan–Mar attendance from the rollup once Phase 2 runs — the known historical-AY-backfill gotcha), `index_number` taken directly from the file's own "Index No."/"No." column (HFSE's real alphabetical numbering, already correct), `enrolee_number` stamped (KD #135/#136 pattern). `unique(section_id, student_id)` + `unique(section_id, index_number)` make reruns safe.
5. **Status flip** — `UPDATE ay2026_enrolment_status SET applicationStatus='Enrolled', classSection=<name>, classLevel=<label> WHERE enroleeNumber=...` for each matched student.

**Explicitly not touched:** `attendance_daily`, `grading_sheets`/`grade_entries`, `evaluation_writeups` (Phase 2/3/4). The 4 students already `Enrolled`/`Enrolled (Conditional)` are not special-cased — they match and update normally (idempotent no-op where already correct).

`ay2026-t1-enrollment-preview.sql` is a read-only companion: match-tier counts, the full "needs review" list with candidates, sections/term about to be created — reviewed before `apply.sql` is ever run.

## 6. Validation plan

1. Run the generator; read the preview report (counts per match tier, needs-review list, sections/term to be created).
2. Spot-check a sample of matched rows against the source file.
3. Run `apply.sql` once.
4. Read-only follow-up query confirms: `terms` count = 1 for AY2026, `sections` count matches expectation, `section_students` count ≈ roster size minus unmatched/skipped.

## 7. Testing

- **Unit:** name normalization + tiered matching logic (exact / strong / fuzzy / ambiguous-rejected), including the dup-claim case (same `enroleeNumber` matched from two roster rows).
- No integration test suite planned — this is operator tooling reviewed by hand via the preview report, not an in-app feature.

## 8. Out of scope

- T2–T4 term dates (no source yet).
- `attendance_daily` import (Phase 2).
- Grading sheet import + per-subject weight reconciliation, including excluding stale leftover sheets like "DO NOT USE Literature - Sec 4 E" (dated Term 1 2025) found in the Math workbook (Phase 3 — will invoke the `reconciling-legacy-grading-scales` skill).
- Evaluation/PTC-checklist file import (Phase 4 — scope mismatch with KD #114 needs resolving first).
- Creating sections that are currently empty in the file (deferred until they have students).

## 9. Open items (resolve during writing-plans / build — not blocking the design)

- Exact fuzzy-match library/algorithm choice (e.g. a small local Jaro-Winkler implementation vs a lightweight dependency) — pick whichever keeps the generator dependency-free if reasonable.
- Whether `class_type`/`schedule` on `sections` should be populated now or left null (current design leaves them null — no reliable source in this file since the "(G)"/"AM Global" annotations were deliberately dropped).
- Confirm handling for the 2 applications missing `studentNumber` — surfaced in the preview report, resolved manually (not something the generator should invent).
