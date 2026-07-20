# AY2026 T2 Evaluation Write-ups Import — Design (Phase 7)

## 1. Goal

Import HFSE's real AY2026 T2 form-class-adviser (FCA) write-ups from `AY2026/T2/Term 2 CONSOLIDATED FORM.xlsx` into `evaluation_writeups`, producing a reviewable `preview.sql` / `apply.sql` pair — no code in this phase ever writes to the database directly. This is Phase 7 of the ongoing AY2026 real-data import sequence, following the completed Phase 1 (enrollment), Phase 2/5 (attendance), Phase 3/6a/6b (grading).

`evaluation_writeups` is the sole source of the "Form Class Adviser's Comments" section on T1–T3 report cards (KD #49). T4 is excluded by design (no comment section on the final card) — moot here since this phase only ever touches T2.

## 2. Source data

`AY2026/T2/Term 2 CONSOLIDATED FORM.xlsx` — one sheet per real section, 23 sheets total, explicit sheet-by-sheet processing (no glob). Unlike every prior grading-import phase, this file has **no "Reserved N" scratch tabs, no "DO NOT USE" tabs, no corrupted "Copy of..." duplicates** — every sheet name is a clean, real section identity:

```
P1-Patience, P1 Respect, P1-Obedience, P2-Honesty, P2-Humility, P3-Courtesy,
P2-Gentleness, P3-Courageous, P3-Responsibility, P4-Diligence, P4-Trust,
P4-Compassion, P5-Commitment, P5-Tenacity, P5 Perseverance, P6 Grit,
P6-Loyalty, S1-Discipline 1 (G), S1-Discipline 2, S2-Integrity 1 (G),
S2-Integrity 2, S3-Consistency, S4 - Excellence
```

(Note: `P1 Respect`, `P2-Gentleness`, `P4-Compassion` are the same three sections that appeared as leftover-named "Reserved N" tabs in the _grading_ workbooks — Phase 6a/6b's Task 4/6 investigations already confirmed these are real, currently-taught Primary sections; the "Reserved" naming was specific to those grading files' tab-copy history, not a property of the section itself. This consolidated form names them properly.)

### Masthead layout (verified against the real file)

| Row (0-indexed) | Content                                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 0               | `" HFSE INTERNATIONAL SCHOOL"`                                                                                                                  |
| 1               | `"CONSOLIDATED FORM"`                                                                                                                           |
| 2               | Level/section title, spelled out (e.g. `"SECONDARY ONE DISCIPLINE ONE"`) — **not used**; the sheet name is the identity source instead (see §3) |
| 3               | `"AY 2026 - Term Two"`                                                                                                                          |
| 4               | `"Teacher: <name>"`                                                                                                                             |
| 5               | blank                                                                                                                                           |
| 6               | Column headers                                                                                                                                  |
| 7               | Sub-header for the attendance column group                                                                                                      |
| 8+              | One row per student                                                                                                                             |

### Columns (verified against the real header row)

| Col   | Header                                                                                                 | Content                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 0     | Index Number                                                                                           | matches `section_students.index_number`                                               |
| 1     | NAME                                                                                                   | `LAST, First Middle.`                                                                 |
| 2–9   | subject codes (English/Math/Science/Humanities/Global Perspectives/Computing/Art & Design/PE & Health) | per-subject grade — **out of scope**, already covered by Phase 6a/6b's grading import |
| 10–12 | Attendance sub-group (school days / days late / days present)                                          | **out of scope**, already covered by Phase 2/5's attendance import                    |
| 13    | Remarks                                                                                                | **NOT the FCA write-up** — see below                                                  |
| 14    | Notes/Comment                                                                                          | **NOT the FCA write-up** — see below                                                  |
| 15    | Student Evaluation                                                                                     | **the FCA write-up text**                                                             |

**Column 15 ("Student Evaluation") is the only column this phase imports.** Columns 13–14 were initially suspected to be the write-up field but a full scan of every sheet's every row showed they're populated only in a handful of sections (`P1 Respect`, `P2-Gentleness`, `P4-Compassion`, `P5-Commitment`, `P6-Loyalty`) with values like `"#REF!"` (a broken formula reference), `"No Correction (Verified)"`, and `"With Correction (See Notes/Comment)"` / `"attendance - Ms Lhen"` — an attendance-data verification workflow unrelated to FCA comments, not a report-card field at all. They are never read by this import.

Column 15 is non-empty for effectively every student in every section **except** the same three ex-"Reserved" Primary sections noted above, where it's mostly blank (e.g. `P4-Compassion`: 0/21 populated; `P1 Respect`: 1/13; `P2-Gentleness`: 3/13) plus a handful of single blanks scattered elsewhere (`P5-Tenacity` 1/30, `S1-Discipline 2` 1/15, `S2-Integrity 2` 3/21). These blanks are treated as "no write-up entered yet" — not an error, not corrected, not guessed — and are simply skipped (no row inserted for that student), which is indistinguishable from the adviser never having written one, a valid existing state in this schema.

## 3. Identity resolution

Sheet names parse directly to `(levelCode, sectionName)` with a simple regex — verified against all 23 real names:

```
/^([PS])(\d+)\s*-?\s*(.+?)(?:\s*\(G\))?$/i
```

`"S1-Discipline 1 (G)"` → `levelCode="S1"`, `sectionName="Discipline 1"` (the `(G)` Global-track marker is stripped — it's not part of the real section name in `sections.name`, confirmed against the same DB section names Phase 6b's Secondary import already resolved against). Every one of the 23 real names parses cleanly to the exact section name the DB already has; no truncation, no disagreement, no fallback path is needed (unlike the grading workbooks' tab-name-vs-row-2 problem — this file simply doesn't have that failure mode, since sheet names here were never auto-generated from a copy-pasted template).

Given this, the import does **not** need row 2's spelled-out title at all — sheet name alone is authoritative and sufficient.

## 4. Roster resolution — must exclude withdrawn students

Per KD #120 (evaluation write-up counts must resolve to a student's **current active** section, never a denormalized/stale one — a transfer leaves the write-up's own `section_id` pointing at the origin section), and per the explicit reminder that Phase 8's Records cross-check must account for withdrawal status: the roster lookup for this import queries `section_students` **filtered to `enrollment_status != 'withdrawn'`** (the same active-roster filter every prior phase's roster query has used implicitly, made explicit here since evaluation write-ups are the one place this project has already hit a real bug from getting it wrong).

Query shape (mirrors Phase 6a/6b's roster lookup, scoped to **all** level types this time — Primary and Secondary both, since write-ups aren't split by track or subject):

```sql
select ss.id, ss.index_number, ss.student_id, sec.name as section_name, lv.code as level_code
from section_students ss
join sections sec on sec.id = ss.section_id
join levels lv on lv.id = sec.level_id
where sec.academic_year_id = :ay_id
  and ss.enrollment_status != 'withdrawn'
```

Lookup key: `${levelCode}::${sectionName}::${indexNumber} → student_id`. A sheet row whose index number doesn't resolve (student withdrawn, transferred out, or simply absent from the live roster) goes to the preview's "needs review" list — never guessed, never silently dropped without a trace.

## 5. Field mapping

| `evaluation_writeups` column | Value                                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `term_id`                    | AY2026's T2 term row                                                                                                                                                                                                                                               |
| `student_id`                 | resolved via §4                                                                                                                                                                                                                                                    |
| `section_id`                 | the student's current active section (from the same roster row — **not** re-derived from the sheet, so a write-up always points at the student's real current section even if the sheet's own section differs from where they are today, e.g. a mid-term transfer) |
| `writeup`                    | column 15's text, trimmed                                                                                                                                                                                                                                          |
| `submitted`                  | `true` — this is HFSE's own finalized consolidated report-card source, not draft text (confirmed with the user)                                                                                                                                                    |
| `submitted_at`               | the term's `end_date` (`2026-05-28`) — represents when the real write-up was finalized in the world, not when this backfill script happened to run                                                                                                                 |
| `created_by`                 | `NULL` — the column is nullable; these rows weren't authored by any logged-in user, and there's no "backfill" placeholder account to misattribute them to (confirmed with the user)                                                                                |

## 6. SQL emission

Single transactional `apply.sql`, matching every prior phase's shape:

```sql
insert into evaluation_writeups (term_id, student_id, section_id, writeup, submitted, submitted_at)
values (...)
on conflict (term_id, student_id) do nothing;
```

`on conflict do nothing` is the standing safe default (moot today — zero existing T2 evaluation_writeups rows, verified) but protects a re-run from clobbering any write-up a real adviser has since entered through the live UI, consistent with Hard Rule #6 (append-only) and every prior phase's write pattern. String values (writeup text, section names, timestamps) are escaped via the project's existing `lib/sis/backfill/enrollment/sql-escape.ts::sqlString` helper — the same utility every prior phase's composer already uses, not a new escaping scheme.

`preview.sql` reports: per-section resolved/blank/needs-review counts, the full needs-review list (name + index + section), and a sample of resolved identities for a final human sanity check before `apply.sql` runs — same shape as every prior phase's preview.

## 7. Architecture

Three files, mirroring the established pattern:

- `lib/sis/backfill/evaluation/parse-consolidated-writeups.ts` — reads the workbook, parses each sheet's identity (§3), extracts each student's write-up text from column 15, returns one `ParsedWriteupRow` per non-blank cell plus per-sheet blank counts.
- `lib/sis/backfill/evaluation/build-writeups-import.ts` — pure composer: resolves roster (§4), applies field mapping (§5), emits `preview`/`apply` SQL strings (§6). No I/O — same "no I/O in the composer" boundary every prior phase's composer has kept.
- `scripts/backfill/gen-ay2026-t2-writeups.ts` — orchestrator: reads the DB (AY/term/roster), calls the parser once (single file, no per-file loop needed — a first for this project, since every prior phase read multiple subject workbooks), calls the composer, writes the two `.sql` files. Explicit run command, gitignored PII output, same as every prior phase.

No dedup logic is needed anywhere in this phase — there is exactly one sheet per section, and nothing in this file competes for the same `(levelCode, sectionName)` identity the way the grading workbooks' Reserved tabs did.

## 8. Testing

- Parser: unit tests against the real fixture file — identity resolution for a representative sample of sheet names (including a `(G)` Global-track one), blank-cell detection, and the full 23-sheet sweep asserting a total non-blank-writeup count in the expected range.
- Composer: unit tests with synthetic fixtures — roster resolution success/failure (needs-review), the `submitted=true`/`submitted_at`/`created_by=NULL` field mapping, the `on conflict do nothing` clause present, empty-input handling.
- No orchestrator-level test file (consistent with every prior phase — orchestrators are verified by a full-suite regression run, not new unit tests).

## 9. Validation plan (controller, after real generation)

Given how many rounds Phase 6b needed to catch a cross-sheet identity collision the design didn't anticipate, the orchestrator's real run gets one extra defensive check specific to that lesson, even though this file's structure makes the failure mode very unlikely (23 sheets, 23 distinct real section identities, one file — not multiple per-subject files covering overlapping tracks the way the grading workbooks did): after parsing, assert the 23 sheets resolve to exactly 23 **distinct** `(levelCode, sectionName)` identities (no two sheets claiming the same section). If that assertion ever fails, stop and investigate before composing — don't silently let a later row win.

Beyond that, the controller hand-verifies after generation: (1) the per-section resolved/blank/needs-review counts look sane against the real numbers noted in §2 (e.g. `P4-Compassion` ≈ 0 resolved, 21 blank); (2) the needs-review list's students are genuinely withdrawn/transferred, not a roster-query bug; (3) a handful of `writeup` text samples in the preview read as real, un-mangled paragraphs (no truncation, no escaping artifacts).

## 10. Out of scope

- Columns 2–12 (subject grades, attendance) — already covered by earlier phases.
- Columns 13–14 (Remarks / Notes/Comment) — confirmed to be an unrelated attendance-verification workflow, not report-card content.
- `terms.virtue_theme` — currently `NULL` for AY2026 T2 (verified), set separately by the registrar via `/evaluation/virtue-themes` (KD #137); not this import's concern.
- Any write-up content correction/editing UI — this is a one-time data backfill, not a UI change.
