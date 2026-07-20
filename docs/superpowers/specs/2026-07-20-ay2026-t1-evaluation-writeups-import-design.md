# AY2026 T1 Evaluation Write-ups Import — Design (Phase 4)

## 1. Goal

Import HFSE's real AY2026 T1 form-class-adviser (FCA) write-ups from `AY2026/T1/Term 1 Grades/AY2026 T1 Student Evaluation_Subject Checklists.xlsx` into `evaluation_writeups`, producing a reviewable `preview.sql` / `apply.sql` pair — no code in this phase ever writes to the database directly. This is Phase 4 of the ongoing AY2026 real-data import sequence; T1 enrollment/attendance/grading (Phases 1–3) and T2's full stack (Phases 5–7) are already applied.

`evaluation_writeups` is the sole source of the "Form Class Adviser's Comments" section on T1–T3 report cards (KD #49). Critically, KD #129's comment gate is **cumulative and non-overridable**: publishing a T2 or T3 report card requires submitted, non-empty write-ups for every term up to and including the one being published — and unlike every other publish-readiness check, there is no "publish anyway" override for comments (KD #139). With T1 currently empty, no AY2026 report card past T1 can be published until this phase lands.

## 2. Source data

`AY2026/T1/Term 1 Grades/AY2026 T1 Student Evaluation_Subject Checklists.xlsx` — 27 sheets total, structurally messier than T2's Consolidated Form:

```
PTC Checkkist  S1-S4, PTC Checklist P1-P6, SAMPLE HOW TO DO,       <- hidden, deprecated PTC system (KD #114) — excluded
P1 Patience (G), P1 Obedience, Reserved 1,
P2 Honesty (G), P2 Humility, Reserved 2,
P3 Courtesy (G), P3 Courageous, P3 Responsibility,
P4 Trust, Reserved, P4 Diligence (G),
P5 Commitment (G), P5 Tenacity, P5 Perseverance,
P6 Loyalty, P6 Grit,
Sec 1 D1, Sec 1 D2, Sec 2 I1, Sec 2 I2, Sec 3, Sec 4,
xx                                                                   <- stray scratch sheet — excluded
```

**Excluded sheets (7 of 27):**

- `PTC Checkkist  S1-S4`, `PTC Checklist P1-P6`, `SAMPLE HOW TO DO` — hidden tabs (verified via `wb.Workbook.Sheets[].Hidden`), the deprecated per-topic proficiency-rating/PTC system KD #114 already established HFSE doesn't use.
- `Reserved 1`, `Reserved 2`, `Reserved` — correspond by position to P1 Respect / P2 Gentleness / P4 Compassion, the same three sections T2's grading import (Phase 6a) found hidden in HFSE's own Consolidated Form. Unlike T2's Reserved tabs (which had real leftover teacher data), these are **100% empty templates** — every data row is blank except a literal `#REF!` in the name column of the first row. Nothing to exclude by decision; there's simply nothing there.
- `xx` — not a section at all. A stray scratch/reference sheet listing S3/S4 subject-checklist topic labels (TRUE/FALSE checkbox rows), no student names, no write-up column.

**20 real per-section sheets**, mapped via an explicit lookup table (verified programmatically against the live AY2026 roster — all 20 resolve cleanly; the D1/D2/I1/I2 Secondary abbreviations aren't derivable by regex, unlike T2's fully-spelled-out sheet names, so this must be a hardcoded table):

| Sheet name          | `levelCode` | `sectionName`    |
| ------------------- | ----------- | ---------------- |
| `P1 Patience (G)`   | `P1`        | `Patience`       |
| `P1 Obedience`      | `P1`        | `Obedience`      |
| `P2 Honesty (G)`    | `P2`        | `Honesty`        |
| `P2 Humility`       | `P2`        | `Humility`       |
| `P3 Courtesy (G)`   | `P3`        | `Courtesy`       |
| `P3 Courageous`     | `P3`        | `Courageous`     |
| `P3 Responsibility` | `P3`        | `Responsibility` |
| `P4 Trust`          | `P4`        | `Trust`          |
| `P4 Diligence (G)`  | `P4`        | `Diligence`      |
| `P5 Commitment (G)` | `P5`        | `Commitment`     |
| `P5 Tenacity`       | `P5`        | `Tenacity`       |
| `P5 Perseverance`   | `P5`        | `Perseverance`   |
| `P6 Loyalty`        | `P6`        | `Loyalty`        |
| `P6 Grit`           | `P6`        | `Grit`           |
| `Sec 1 D1`          | `S1`        | `Discipline 1`   |
| `Sec 1 D2`          | `S1`        | `Discipline 2`   |
| `Sec 2 I1`          | `S2`        | `Integrity 1`    |
| `Sec 2 I2`          | `S2`        | `Integrity 2`    |
| `Sec 3`             | `S3`        | `Consistency`    |
| `Sec 4`             | `S4`        | `Excellence`     |

The `(G)` Global-track marker is not part of `sections.name` and is dropped when building the table above (mirrors T2's handling). `P1::Respect` is the only real AY2026 section with no corresponding sheet — consistent with it being one of the fully-empty "Reserved" tabs.

### Masthead layout

| Row (0-indexed) | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2               | Column headers, including `"Student Evaluation write-up: <virtue theme text>"` — the write-up column's exact **position varies per sheet** (col 13 for every Primary sheet; col 18 for `Sec 1 D1`/`Sec 1 D2`; col 19 for `Sec 2 I1`/`Sec 2 I2`/`Sec 3`/`Sec 4`) and its header text embeds the term's actual virtue-theme wording rather than a fixed label. The column must be located per-sheet by scanning row 2 for a case-insensitive `"student evaluation"` substring — never a fixed index. |
| 3+              | Student data, in **variable-height blocks**, not a fixed row-per-student layout (see §3).                                                                                                                                                                                                                                                                                                                                                                                                          |

A `"PARENT FEEDBACK - IF ANY"` column sits near the write-up column on some sheets and must not be confused with it (located by the same substring scan, so this isn't a real risk as long as the scan matches the exact "student evaluation" phrase).

## 3. Parsing algorithm — variable-height blocks, not fixed rows

Unlike T2's one-row-per-student layout, T1's sheets are built from a fixed print template whose header row repeats every N rows (N is _not_ constant — verified across all 20 sheets, block height varies). Within a block, one student's write-up text can span multiple physical rows (a genuine authoring pattern — teachers' prose got typed across several rows within the template, not a formatting artifact), or sit entirely on the identity row, or even be entirely blank.

**Verified algorithm** (validated by re-implementing it and running it against the full text of all 20 real sheets, not samples):

For each row, starting after the sheet's own header row:

1. Locate the write-up column (§2) and capture the header row's own cell text there, normalized (lowercased, whitespace-collapsed) — this is the sheet's **header label**.
2. Walk rows top to bottom:
   - A row is an **identity row** if column A (index number) is non-blank **or** column B (name) is non-blank — either signal alone is sufficient. (Real rows exist with only one of the two populated, due to source data-entry gaps — e.g. an index number with no name, or a name with no index. Requiring both would silently drop real students.) An identity row starts a new student, finalizing whichever student was previously active.
   - A row is **header-repeat noise** if its own write-up-column text, normalized, equals the sheet's header label — skip entirely, no state change (this also correctly handles the case where an identity row's own write-up cell holds the header label instead of real text, with the real text spilling onto the next row).
   - Every other row appends its (trimmed) write-up-column text, if non-blank, to the currently active student, joined with a single space.
3. At the end, a student's write-up is the space-joined, whitespace-collapsed concatenation of every fragment collected for them.

**Row classification after parsing:**

- **Real write-up row** — non-blank final text. Becomes a candidate for roster resolution (§4).
- **Named-but-blank** — an identity row with a name but no write-up text ever accumulated. A genuine informational gap (the student exists, no write-up was entered) — reported in the preview, not written.
- **Unused template row** — an identity row with _neither_ a name nor any write-up text (just a bare sequential index number, left over from the fixed-size print template exceeding the real class size). Silently dropped — zero information value, not reported individually.

Validated full-file counts (all 20 sheets, real run): **392 real write-up rows**, 2 named-but-blank, 112 unused template rows silently dropped.

### Known data-quality issues in this specific file (accepted, not "fixed")

- **One duplicate index number within a sheet**: `Sec 2 I2` has two different real students both typed as index `14` (`IRAWAN, JOAN JOYLYN` and `LABANEN, Shannen Marella S.`). This is why §4 resolves by name, not index — see below for why this is safe.
- **One row-misalignment** (`Sec 4`): one student's write-up text is typed one physical row above her own identity row, so a naive top-to-bottom read would misattribute it to the _previous_ student and leave the true owner blank. Found exactly once across all 392 rows; no general algorithm can safely auto-correct a one-off transcription slip like this without risking a worse, silent misattribution elsewhere. Mitigated by §6's full-coverage preview rather than an auto-fix.

## 4. Roster resolution — name-first, not index-first

T2's import (Phase 7) resolved purely by `(levelCode, sectionName, indexNumber)` against the live roster, which worked because that file had no reason to disagree with the roster. T1's file does, for a specific, now-understood reason: a small number of students in this file were enrolled and being evaluated at T1 time but have since withdrawn from AY2026 entirely — verified directly against two real cases (Irawan, Ganelo): both have **zero** `section_students` rows scoped to AY2026's `academic_year_id`, and both show `applicationStatus: 'Withdrawn'`. Their old T1 sheet rows are leftovers from before they left, sharing index numbers that active students (like Labanen, at `Sec 2 I2` idx 14) have since inherited. Resolving purely by index would silently misattribute a withdrawn student's stale text to whoever the DB says currently holds that slot, and — worse — collide two competing rows on the same `(term_id, student_id)` key, silently dropping one via `on conflict do nothing` with zero trace.

**Resolution rule:** match each parsed row's name against the **entire active AY2026 roster** (all levels, all sections — not scoped to the sheet's own section), using the existing tiered name-matcher (`lib/sis/backfill/enrollment/name-match.ts`, exact → strong → fuzzy, already proven in Phase 1's enrollment import). Whichever section that student is _currently_ in is what gets written as `section_id` — safe per KD #120, which already documents `evaluation_writeups.section_id` as a point-in-time snapshot that no downstream reader trusts as authoritative. The sheet's own index number is **not used for resolution at all** — informational only, included in the preview for cross-reference.

A row with no clean, unique name match (ambiguous tier, or no candidate at all) goes to needs-review — never guessed.

**Full real-file validation** (run against the live 371-candidate active AY2026 roster, not a sample):

```
Resolution: exact=6, strong=360, fuzzy=1, needsReview=25
Total resolved: 367 / 392 (93.6%)
Section mismatches (sheet's stated section vs. resolved current section): 0
```

The zero section-mismatch count confirms the Irawan/Ganelo pattern (withdrawn-before-import, stale sheet entry) is the whole story here — there is no broader wave of genuine mid-year transfers to account for. Every row that resolves by name also agrees with the sheet on section; the students who disagree simply don't resolve at all (correctly, since they're not part of AY2026's active population). The needs-review rate (6.4%) is consistent with Phase 7's T2 result (5.1%).

Roster query (identical shape to Phase 7, all level types, active only):

```sql
select ss.id, ss.index_number, ss.student_id, sec.name as section_name, lv.code as level_code,
       s.first_name, s.last_name, s.middle_name, s.student_number
from section_students ss
join sections sec on sec.id = ss.section_id
join levels lv on lv.id = sec.level_id
join students s on s.id = ss.student_id
where sec.academic_year_id = :ay_id
  and ss.enrollment_status != 'withdrawn'
```

## 5. Field mapping

| `evaluation_writeups` column | Value                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `term_id`                    | AY2026's T1 term row                                                                               |
| `student_id`                 | resolved via §4 (by name)                                                                          |
| `section_id`                 | the matched student's **current** active section (from the same roster row)                        |
| `writeup`                    | the reconstructed, space-joined text from §3, trimmed                                              |
| `submitted`                  | `true` — same rationale as Phase 7: this is HFSE's own finalized evaluation record, not draft text |
| `submitted_at`               | the term's `end_date` (`2026-03-13`)                                                               |
| `created_by`                 | `NULL` — same rationale as Phase 7                                                                 |

## 6. SQL emission

Same transactional shape as every prior phase:

```sql
insert into evaluation_writeups (term_id, student_id, section_id, writeup, submitted, submitted_at)
values (...)
on conflict (term_id, student_id) do nothing;
```

`on conflict do nothing` protects a re-run from clobbering any write-up a real adviser has since entered through the live UI (Hard Rule #6). String values escaped via `lib/sis/backfill/enrollment/sql-escape.ts::sqlString`.

**`preview.sql` lists every resolved write-up in full** (not a per-section sample like Phase 7) — a deliberate departure, given this file's demonstrated lower data quality (§3's row-misalignment case). With ~367 real rows total, a full listing is realistically skimmable in one review pass and is the only realistic way a human catches a rare, silent transcription slip like the `Sec 4` case before `apply.sql` runs. Also reports: per-section resolved/named-blank/needs-review counts, the full needs-review list (name, sheet-stated section+index, reason), and the duplicate-index note from §3.

## 7. Architecture

Three files, mirroring the established pattern (Phase 7's shape):

- `lib/sis/backfill/evaluation/parse-t1-writeups.ts` — reads the single workbook, resolves each of the 20 real sheets' identity via the §2 lookup table, runs the §3 block-parsing algorithm, returns one `ParsedT1WriteupRow` per real write-up row plus named-blank/unused-template counts per sheet.
- `lib/sis/backfill/evaluation/build-t1-writeups-import.ts` — pure composer: resolves roster by name (§4), applies field mapping (§5), emits `preview`/`apply` SQL strings (§6). No I/O.
- `scripts/backfill/gen-ay2026-t1-writeups.ts` — orchestrator: reads the DB (AY/term/roster), calls the parser once, calls the composer, writes the two `.sql` files. Explicit run command, gitignored PII output.

No dedup logic is needed across sheets (each of the 20 real sheets is a distinct section, verified in §2's lookup table validation) — the only within-sheet duplication is the single known index collision in `Sec 2 I2`, harmless under name-first resolution.

## 8. Testing

- Parser: unit tests against the real fixture file — block-parsing correctness on a representative multi-row-fragmented Primary sample and a single-cell Secondary sample, header-repeat-row detection, named-blank vs. unused-template classification, and a full 20-sheet sweep asserting the real counts from §3 (392 real rows, 2 named-blank).
- Composer: unit tests with synthetic fixtures — name-based roster resolution (exact/strong/fuzzy/none tiers), the field mapping table, the `on conflict do nothing` clause, empty-input handling, and a synthetic duplicate-index case proving the resolution never collides two rows onto the same student.
- No orchestrator-level test file (consistent with every prior phase).

## 9. Validation plan (controller, after real generation)

- Assert the 20 sheets resolve to exactly 20 distinct `(levelCode, sectionName)` identities before composing (same defensive check as Phase 7 §9).
- Cross-check the real generation run's resolved/needs-review counts against §3/§4's validated numbers (392 parsed, 367 resolved, 25 needs-review) — any material drift means something changed since this design was validated and needs investigation before trusting the output.
- Spot-check the needs-review list: names should read as genuinely not-in-the-active-roster (withdrawn/never-enrolled), not a roster-query bug.
- Read through the full resolved-write-up listing in `preview.sql` (not a sample, per §6) specifically watching for any write-up whose content seems to reference a different student than its own name — the one class of defect (§3's row-misalignment case) that can't be caught by any automated check.

## 10. Out of scope

- The 3 hidden PTC-checklist sheets — confirmed dead per KD #114, never parsed.
- The 3 empty "Reserved" sheets and the "xx" scratch sheet — nothing real to import.
- `terms.virtue_theme` for T1 — set separately by the registrar via `/evaluation/virtue-themes` (KD #137); not this import's concern.
- Any write-up content correction/editing UI — this is a one-time data backfill.
- Recovering write-ups for students who have withdrawn from AY2026 (like Irawan/Ganelo) — their T1 text exists in the source file but they have no home in the active AY2026 roster to attach it to; correctly reported as needs-review, not written.
