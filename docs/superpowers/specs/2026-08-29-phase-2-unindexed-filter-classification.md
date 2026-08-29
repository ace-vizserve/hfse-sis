# Phase 2 — unindexed-filter classification

**Scanned** 2026-08-29 with `npx tsx scripts/audit/unindexed-filters.ts` (static text scan of every
`.eq()` / `.in()` / `.order()` in `lib/` and `app/api/`, cross-referenced against every literal
`create index` across `supabase/migrations/*.sql`).

**Result:** 484 call sites across **86 distinct (table, column) pairs**. Every one of the 86 is
classified below with one of exactly two verdicts — **INDEX** or **EXEMPT**. Nothing is left as
"probably fine".

**Headline:** **5 of the 86 warrant an index. The other 81 do not, and 68 of those are false
positives of the scanner rather than judgement calls.** The 5 are all on the per-AY admissions
tables and are **future-proofing, not a speed-up** — see the sizing note in §1.

This document exists so nobody re-runs this sweep by hand. **The exempt list is the deliverable.**

---

## How to read this — the two rules that decide most rows

### Rule 1 — the scanner is blind to indexes it did not create with `create index`

`loadIndexedColumns()` greps `create index` statements only. Postgres also builds a btree index for
every `primary key (...)` and every `unique (...)` constraint, and those are declared inline in
`create table` bodies throughout `001_initial_schema.sql` and later migrations. The scanner never
sees them.

A composite index serves **any prefix** of its column list, so the _lead_ column of a
`unique (a, b, c)` is indexed exactly as well as if someone had written `create index … (a)`. It
also serves "equality on `a`, ordered by `b`" — which is why several `.order()` hits are covered too.

**This rule alone accounts for 17 of the 86 pairs, including the two largest: `academic_years.ay_code`
(67 call sites) and `terms.academic_year_id` (50).** The brief's hypothesis about
`grade_entries.grading_sheet_id` was correct — it is the lead column of
`unique (grading_sheet_id, section_student_id)`.

### Rule 1b — a corollary blind spot: PostgREST dotted filters report the SELECT _alias_, not the table

The scanner treats a dotted filter (`.eq('section.academic_year_id', …)`) as
`table = section, column = academic_year_id`. But `section` there is an **alias** declared in the
select (`section:sections!inner(academic_year_id)`) — the real table is `sections`, and
`sections.academic_year_id` has had a dedicated index since migration **040**. Six pairs are this
shape, covering 27 call sites, and all six are already indexed.

### Rule 2 — most of these tables are bounded by construction

Postgres will not choose an index scan over a table that fits in one or two heap pages; the planner
correctly prefers a sequential scan. Every exemption below on this ground cites the fact that bounds
the table — a schema constraint, a Key Decision, or a Phase 0 production measurement — never an
estimate.

Documented bounds used here:

| Table                           | Bound                                                       | Source                                                   |
| ------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| `academic_years`                | ≈ 3 rows (one per year)                                     | Phase 0 probe                                            |
| `terms`                         | 4 per AY                                                    | `001:29` — `check (term_number between 1 and 4)`         |
| `levels`                        | fixed 10 — P1–P6 + S1–S4                                    | KD #153 SUPERSEDED note, `docs/key-decisions/records.md` |
| `houses`                        | 4                                                           | KD #178                                                  |
| `sections`                      | 21 per AY                                                   | KD #193 / AY2026 deployment import                       |
| `approval_stages`               | 2 (adviser → officer in charge)                             | KD #196                                                  |
| `teacher_assignments`           | 115 rows in AY2026                                          | KD #194 import, measured                                 |
| `grading_sheets`                | 125 sheets in AY2026                                        | measured 2026-08-27 (99 staffed / 26 unstaffed)          |
| `grade_entries`                 | 4,636 in AY2026                                             | `scripts/audit-grade-recompute-drift.ts`                 |
| `audit_log`                     | 1,499 rows                                                  | Phase 0 probe, 2026-08-29                                |
| `ay2025_enrolment_applications` | **822 rows** (largest AY table; ay2026 = 499, ay2027 = 264) | Phase 0 probe, 2026-08-29                                |
| `attendance_daily`              | **102,510 rows** — the only genuinely large table           | Phase 0 probe, 2026-08-29                                |

---

## §1 — INDEX (5 pairs, 3 tables)

All five are on the dynamically-created per-AY admissions tables. **This is the one already-known
finding, and it is the whole of Phase 2's index work.**

`docs/context/11-performance-patterns.md` §10 found it on **2026-07-08** by a read-only hand sweep
and it was never actioned. The DDL for these tables lives inside the `create_ay_admissions_tables`
RPC body, which declares only `constraint %I primary key (id)`. **No `create index` for these tables
exists anywhere in the migration tree** — the only index ever attached is
`attach_discount_code_unique` (098/099), and that is on `_discount_codes`, a different table.

### Sizing — read this before writing the migration

⚠ **This is near-zero-risk future-proofing, not a performance win, and it must not be sold as one.**
At 822 rows (the largest of the three live AY application tables) a sequential scan is
sub-millisecond. The "missing indexes are the single biggest win" framing was **retracted** in
`progress.md` and is not restated here. The reasons to do it anyway:

1. The gap is real, documented since 2026-07-08, and cheap to close.
2. These tables are the ones that **grow without bound** as the school takes intakes — every other
   table in this sweep is bounded per-AY by roster size or is a fixed constant.
3. Adding it inside `create_ay_admissions_tables` means every future AY gets it for free, so the
   cost is paid once.

### The five

| Table (per-AY, `ay{YYYY}_` prefix) | Column                | Call sites                                                                                    | Why                                                                                                                                                                  |
| ---------------------------------- | --------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_enrolment_applications`          | `"enroleeNumber"`     | 25 direct + 33 in the unresolved `unknown.enroleeNumber` bucket + 3 template-literal variants | The join key between admissions and everything else. `lib/sis/`, `lib/p-files/`, `lib/sync/students.ts`, `lib/classroom/`.                                           |
| `_enrolment_applications`          | `"studentNumber"`     | 3 (across 3 template-literal spellings) + 2 unresolved                                        | Hard Rule #4's stable cross-year ID; the fallback lookup in `lib/sis/drill.ts:300` and `lib/supabase/admissions.ts:196`.                                             |
| `_enrolment_status`                | `"enroleeNumber"`     | 13 + 2 template-literal variants                                                              | Every P-Files and process-pipeline read joins status to applications on this.                                                                                        |
| `_enrolment_status`                | `"applicationStatus"` | 12 + 3 unresolved                                                                             | The enrolment gate — `.in('applicationStatus', ['Enrolled', 'Enrolled (Conditional)'])` is on the hot path of P-Files, the document-chase queue, and the SIS drills. |
| `_enrolment_documents`             | `"enroleeNumber"`     | 15                                                                                            | The document-completeness matrix reads this table per enrolee.                                                                                                       |

### Proposed DDL

⚠ **Column names are camelCase and MUST be double-quoted.** Unquoted, Postgres folds them to
lowercase and the statement fails on a column that does not exist.

```sql
create index if not exists <slug>_enrolment_applications_enrolee_idx
  on public.<slug>_enrolment_applications ("enroleeNumber");
create index if not exists <slug>_enrolment_applications_student_idx
  on public.<slug>_enrolment_applications ("studentNumber");
create index if not exists <slug>_enrolment_status_enrolee_idx
  on public.<slug>_enrolment_status ("enroleeNumber");
create index if not exists <slug>_enrolment_status_appstatus_idx
  on public.<slug>_enrolment_status ("applicationStatus");
create index if not exists <slug>_enrolment_documents_enrolee_idx
  on public.<slug>_enrolment_documents ("enroleeNumber");
```

**Non-unique on purpose.** `"enroleeNumber"` is the natural key and is very probably unique in
practice, but a `unique` index would be a behaviour change that can fail on existing production data
and would turn a silent duplicate into a hard write error. That is a separate decision, not this
one.

### Notes for whoever writes the migration — three traps, all live

1. ⚠ **Do NOT edit `012_ay_setup_helpers.sql`.** The plan and
   `docs/context/11-performance-patterns.md:110` both say to add these inside
   `create_ay_admissions_tables`, base `012`. **012 is the ORIGIN, not the current definition** —
   the function has been re-emitted **eleven** times and **`099` is current**. Re-emitting from a
   stale body already caused a real regression here: 099's own header records the doc-revision
   trigger being _"silently dropped by migration 050's re-emit and stayed dropped through
   067/069/075/076"_.
2. ⚠ **Use the idempotent `attach_*(slug)` helper pattern from 098/099**, not an inline block.
   `attach_discount_code_unique(p_ay_slug text)` is the working template: a `security definer`
   function that formats the DDL with `%I`, is called once per existing AY by a `pg_tables` walk in
   its own migration, and is then wired into `create_ay_admissions_tables` so future AYs get it
   automatically.
3. ⚠ **The slug is `ay{YYYY}` — four digits since migration 026.** The plan and the perf doc still
   say `ay26`, and `025`'s own `pg_tables` walk still matches the 2-digit form. Copying that walk
   verbatim matches **zero** tables and reports success.
