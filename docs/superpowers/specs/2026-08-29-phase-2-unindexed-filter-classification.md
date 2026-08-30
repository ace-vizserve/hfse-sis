# Phase 2 — unindexed-filter classification

**Scanned** 2026-08-29 with `npx tsx scripts/audit/unindexed-filters.ts` (static text scan of every
`.eq()` / `.in()` / `.order()` in `lib/` and `app/api/`, cross-referenced against every literal
`create index` across `supabase/migrations/*.sql`).

**Result:** 484 call sites across **86 distinct (table, column) pairs**. Every one of the 86 is
classified below with one of exactly two verdicts — **INDEX** or **EXEMPT**. Nothing is left as
"probably fine".

**Headline:** **13 of the 86 warrant an index, and those 13 collapse to 5 real (table, column)
targets. The other 73 do not — and 32 of them are outright scanner false positives, accounting for
244 of the 484 reported call sites.** The 5 real targets are all on the per-AY admissions tables and
are **future-proofing, not a speed-up** — see the sizing note in §1.

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

### The thirteen scanner labels these five collapse from

Listed verbatim so that a future re-run of the sweep can be grep-matched against this document
line-for-line. The table name is built at runtime from a template literal, and four files spell it
four different ways; a fifth group of call sites assembles the query across statements, so the name
does not resolve at all.

| Scanner label                                               | Sites | Real target                                                                                                                                   |
| ----------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `${prefix}_enrolment_applications.enroleeNumber`            | 25    | `_enrolment_applications ("enroleeNumber")`                                                                                                   |
| `unknown.enroleeNumber`                                     | 33    | `_enrolment_applications` / `_status` / `_documents` `("enroleeNumber")` — `lib/sis/drill.ts`, `lib/sis/process.ts`, `lib/p-files/queries.ts` |
| `ay${year}_enrolment_applications.enroleeNumber`            | 2     | `_enrolment_applications ("enroleeNumber")`                                                                                                   |
| `${prefix}_enrolment_status.enroleeNumber`                  | 13    | `_enrolment_status ("enroleeNumber")`                                                                                                         |
| `ay${year}_enrolment_status.enroleeNumber`                  | 1     | `_enrolment_status ("enroleeNumber")`                                                                                                         |
| `${rePrefix}_enrolment_status.enroleeNumber`                | 1     | `_enrolment_status ("enroleeNumber")`                                                                                                         |
| `${prefix}_enrolment_documents.enroleeNumber`               | 15    | `_enrolment_documents ("enroleeNumber")`                                                                                                      |
| `${prefix}_enrolment_status.applicationStatus`              | 12    | `_enrolment_status ("applicationStatus")`                                                                                                     |
| `unknown.applicationStatus`                                 | 3     | `_enrolment_status ("applicationStatus")`                                                                                                     |
| `${prefix}_enrolment_applications.studentNumber`            | 1     | `_enrolment_applications ("studentNumber")`                                                                                                   |
| `${prefixFor(ayCode)}_enrolment_applications.studentNumber` | 1     | `_enrolment_applications ("studentNumber")`                                                                                                   |
| `ay${year}_enrolment_applications.studentNumber`            | 1     | `_enrolment_applications ("studentNumber")`                                                                                                   |
| `unknown.studentNumber`                                     | 2     | `_enrolment_applications ("studentNumber")`                                                                                                   |

**13 labels, 110 call sites, 5 index statements per AY.**

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

---

## §2 — EXEMPT: an index already exists (32 pairs, 244 call sites)

**These are false positives.** The column is indexed; the scanner could not see it. No action, ever.

### §2a — indexed by an inline `primary key` / `unique` constraint (Rule 1) — 17 pairs

A composite constraint's **lead** column is indexed. Where the filter is equality on the lead column
and the `.order()` is on the second, the same index serves both.

| Pair                                 | Sites  | The constraint that already indexes it                                                                                                                                                           |
| ------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `academic_years.ay_code`             | **67** | `001:17` — `ay_code text not null unique`. The single biggest "finding" in the sweep is a false positive.                                                                                        |
| `terms.academic_year_id`             | **50** | `001:35` — `unique (academic_year_id, term_number)`, lead column.                                                                                                                                |
| `students.student_number`            | 16     | `001:64` — `student_number text not null unique`. Hard Rule #4's key was never unindexed.                                                                                                        |
| `grade_entries.grading_sheet_id`     | 15     | `001:163` — `unique (grading_sheet_id, section_student_id)`, lead column; re-declared as the named constraint `grade_entries_sheet_student_uniq` in `035:17`. The brief's hypothesis, confirmed. |
| `subject_configs.academic_year_id`   | 12     | `001:118` — `unique (academic_year_id, subject_id, level_id)`, lead column. Also `080:481` — `subject_configs_academic_year_id_subject_id_key unique (academic_year_id, subject_id)`.            |
| `section_students.index_number`      | 6      | `001:88` — `unique (section_id, index_number)`. All 6 sites are `.order('index_number')` **after** `.eq('section_id', …)`, which is precisely what that composite serves.                        |
| `attendance_records.term_id`         | 5      | `001:207` — `unique (term_id, section_student_id)`, lead column.                                                                                                                                 |
| `subjects.code`                      | 3      | `001:101` — `unique (code)`.                                                                                                                                                                     |
| `levels.code`                        | 2      | `001:41` — `code text not null unique`.                                                                                                                                                          |
| `subject_level_offerings.subject_id` | 2      | `080:127` — `unique (subject_id, level_id, academic_year_id)`, lead column.                                                                                                                      |
| `classroom_notes.section_id`         | 2      | `094:49` — `unique (section_id, teacher_user_id)`, lead column.                                                                                                                                  |
| `evaluation_terms.term_id`           | 1      | `018:52` — `term_id uuid not null unique`.                                                                                                                                                       |
| `approver_assignments.user_id`       | 1      | `013:33` — `unique (user_id, flow)`, lead column.                                                                                                                                                |
| `role_permissions.role`              | 1      | `101:40` — `primary key (role, capability)`, lead column.                                                                                                                                        |
| `subject_report_map.subject_id`      | 1      | `080:211` — `unique (subject_id, report_subject_id)`, lead column.                                                                                                                               |
| `level_aliases.raw_label`            | 1      | `088:29` — `constraint level_aliases_raw_label_unique unique (raw_label)`.                                                                                                                       |
| `grading_sheet.term_id`              | 1      | Alias for `grading_sheets`; `001:141` — `unique (term_id, section_id, subject_id)`, lead column.                                                                                                 |

### §2b — dotted PostgREST filters reported under the SELECT alias (Rule 1b) — 6 pairs

The scanner splits a dotted filter on its first `.` and treats the left-hand side as a table name.
In every one of these it is an **alias** from the select clause.

| Pair as reported                           | Sites | Really is                                                                  | Index                                                                                          |
| ------------------------------------------ | ----- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `section.academic_year_id`                 | 13    | `sections.academic_year_id` via `section:sections!inner(academic_year_id)` | `sections_academic_year_id_idx` — `040:18`                                                     |
| `grading_sheet.section.academic_year_id`   | 8     | same                                                                       | same                                                                                           |
| `academic_year.ay_code`                    | 3     | `academic_years.ay_code` via `academic_year:academic_years!inner(ay_code)` | `001:17` unique                                                                                |
| `grading_sheets.sections.academic_year_id` | 1     | `sections.academic_year_id`                                                | `040:18`                                                                                       |
| `terms.academic_years.ay_code`             | 1     | `academic_years.ay_code`                                                   | `001:17` unique                                                                                |
| `sections.academic_years.is_current`       | 1     | `academic_years.is_current`                                                | `academic_years_single_current` — `095:47`, a unique partial index; and the table holds 3 rows |

### §2c — the table could not be resolved, but the real table's column is indexed — 11 pairs

The scanner reports `unknown.<column>` when a query builder is assembled across statements
(`let q = supabase.from(…); if (x) q = q.eq(…)`). Resolved by hand.

| Pair as reported            | Sites | Real table.column                                                                                                                                                                                                                            | Index                                                                                                                                                       |
| --------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unknown.status`            | 14    | `grade_change_requests.status` — `lib/change-requests/sidebar-counts.ts` ×8, `lib/sidebar/use-change-request-count.ts` ×4, `app/api/change-requests/route.ts:74`, `lib/change-requests/decide.ts:337`                                        | `grade_change_requests_status_idx` — `009:79`; also `grade_change_requests_sheet_status_idx` — `009:73`                                                     |
| `unknown.requested_by`      | 4     | `grade_change_requests.requested_by`                                                                                                                                                                                                         | `grade_change_requests_requested_by_idx` — `009:75`                                                                                                         |
| `unknown.term_id`           | 4     | `attendance_daily.term_id` (`lib/attendance/queries.ts:221`), `school_calendar.term_id` (`:503`, `:505`), `grading_sheets.term_id` (`app/api/grading-sheets/route.ts:40`)                                                                    | `attendance_daily_student_date_idx` `014:65` leads on the `section_student_id` already filtered; `school_calendar_term_date_idx` `015:55`; `001:141` unique |
| `unknown.section_id`        | 3     | `section_students.section_id` (`lib/sis/placement-completion.ts:106`), `report_card_publications.section_id` (`app/api/report-card-publications/route.ts:30`), `teacher_assignments.section_id` (`app/api/teacher-assignments/route.ts:176`) | `001:88` unique lead; `007:33` unique lead + `report_card_publications_active_idx` `007:37`; teacher_assignments is 115 rows — see §3                       |
| `unknown.applicationStatus` | 3     | `ay{YYYY}_enrolment_status."applicationStatus"` — `lib/p-files/drill.ts:218`, `lib/sis/document-chase-queue.ts:86,92`                                                                                                                        | **Not exempt — folded into §1.** Listed here only so the bucket reconciles.                                                                                 |
| `unknown.studentNumber`     | 2     | `ay{YYYY}_enrolment_applications."studentNumber"` — `lib/sis/drill.ts:300`, `lib/supabase/admissions.ts:196`                                                                                                                                 | **Not exempt — folded into §1.**                                                                                                                            |
| `unknown.grading_sheet_id`  | 2     | `grade_change_requests.grading_sheet_id` (`app/api/change-requests/route.ts:77`) and `grade_audit_log.grading_sheet_id` (`app/api/audit-log/route.ts:27`)                                                                                    | `grade_change_requests_sheet_status_idx` `009:73` lead. The `grade_audit_log` half is unindexed — see §4.                                                   |
| `unknown.academic_year_id`  | 1     | `student_discipline_records.academic_year_id` — `lib/discipline/queries.ts:252`                                                                                                                                                              | `student_discipline_records_ay_idx` — `120:150`                                                                                                             |
| `unknown.occurred_on`       | 1     | `student_discipline_records.occurred_on` — `lib/discipline/queries.ts:255`, an `.order()` after `.eq('student_id', …)`                                                                                                                       | `student_discipline_records_student_idx` — `120:144` bounds the scan before the sort                                                                        |
| `unknown.request_id`        | 1     | `approval_request_stages.request_id` — `lib/activity/feed.ts:214`                                                                                                                                                                            | `approval_request_stages_request_idx` — `126:284`                                                                                                           |
| `unknown.teacher_user_id`   | 1     | `teacher_assignments.teacher_user_id` — `app/api/teacher-assignments/route.ts:178`                                                                                                                                                           | `teacher_assignments_by_user` — `003:41`                                                                                                                    |

⚠ **Two rows in §2c (`unknown.applicationStatus`, `unknown.studentNumber`) are NOT exempt** — they
resolve to the AY admissions tables and are covered by §1's DDL. They are shown here because that is
where the scanner filed them, and leaving them out would make the bucket look like it lost two
pairs.

**§2 subtotal: 34 rows listed above, of which 32 are genuinely exempt** (244 call sites); the other 2
are §1 entries shown under the label the scanner gave them, and are counted in §1.

---

## §3 — EXEMPT: bounded by construction (33 pairs, 118 call sites)

Rule 2. Postgres will not choose an index on a table that fits in a page or two, and adding one buys
a write cost for a plan the planner will refuse. **Each row names the fact that bounds the table** —
a schema constraint, a Key Decision, or a measured production count. None of these is an estimate.

### §3a — fixed-size configuration tables

| Pair                                    | Sites | Bound                                                                                                                                                                                                                                                               |
| --------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `terms.term_number`                     | 18    | **4 rows per AY** — `001:29`, `check (term_number between 1 and 4)`. ~12–16 rows total. The second column of `unique (academic_year_id, term_number)`, so the composite serves it anyway once `academic_year_id` is filtered, which every one of the 18 sites does. |
| `terms.start_date`                      | 1     | Same 4-per-AY bound. `lib/dashboard/windows.ts:43` sorts them.                                                                                                                                                                                                      |
| `academic_years.accepting_applications` | 2     | **≈ 3 rows** (Phase 0). A boolean on a 3-row table.                                                                                                                                                                                                                 |
| `levels.sort_order`                     | 1     | **Fixed 10 rows**, P1–P6 + S1–S4 — KD #153 SUPERSEDED note.                                                                                                                                                                                                         |
| `houses.sort_order`                     | 1     | **4 rows** — KD #178.                                                                                                                                                                                                                                               |
| `approval_stages.is_active`             | 4     | **2 rows** — the declaration flow's adviser → officer-in-charge ladder, KD #196. Also already served by `approval_stages_flow_idx` (`126:126`), a partial index `where is_active`.                                                                                  |
| `sections.name`                         | 5     | **21 sections per AY** — KD #193 / the AY2026 deployment import.                                                                                                                                                                                                    |
| `sections.level_id`                     | 4     | Same 21-per-AY bound; also the second column of `unique (academic_year_id, level_id, name)` (`001:59`).                                                                                                                                                             |
| `subjects.is_examinable`                | 3     | The subject catalogue — one row per subject the school offers. A boolean has ~2 distinct values, so an index would be rejected by the planner even on a large table.                                                                                                |
| `subjects.name`                         | 1     | Same table; an `.order()` for a picker.                                                                                                                                                                                                                             |
| `subject_configs.subject_id`            | 5     | One row per (AY, subject) since `080:481` collapsed the shape — bounded by the catalogue × ≈3 AYs.                                                                                                                                                                  |

(`role_permissions.role`, `level_aliases.raw_label` and `subject_report_map.subject_id` are also
fixed-size config tables, but they are already exempt in §2a on their PK/unique and are counted
there, not here.)

### §3b — per-AY roster tables (bounded by a ~400-student school × 21 sections)

| Pair                                    | Sites | Bound                                                                                                                                                                                                                                                       |
| --------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `teacher_assignments.role`              | 16    | **115 rows in AY2026** (measured — KD #194 import, 123 rows regenerated 2026-08-27). `role` has 4 distinct values across a 115-row table.                                                                                                                   |
| `attendance_records.section_student_id` | 10    | One row per (term, enrolment) ≈ 1,600/AY. **And every call site also filters `term_id`**, which is the lead column of `unique (term_id, section_student_id)` (`001:207`) — so the existing composite serves the whole predicate, not just half of it.       |
| `evaluation_writeups.student_id`        | 9     | One row per (term, student) ≈ 1,600/AY. 8 of the 9 sites also filter `term_id`, the lead column of `unique (term_id, student_id)` (`018:102`); the ninth (`lib/classroom/queries.ts:137`) is an `.in()` over one section's ~25 students against that bound. |
| `evaluation_writeups.submitted`         | 3     | Same table; a boolean.                                                                                                                                                                                                                                      |
| `grading_sheets.subject_config_id`      | 3     | **125 sheets in AY2026** (measured 2026-08-27).                                                                                                                                                                                                             |
| `grading_sheets.subject_id`             | 2     | Same 125-sheet bound; also the third column of `unique (term_id, section_id, subject_id)` (`001:141`).                                                                                                                                                      |
| `report_card_publications.created_at`   | 1     | 21 sections × 4 terms = **≤ 84 rows per AY**, capped by `unique (section_id, term_id)` (`007:33`).                                                                                                                                                          |
| `${prefix}_discount_codes.endDate`      | 1     | A handful of codes per AY (KD #118 early-bird). `lib/sis/queries.ts:1405` reads the whole table and sorts it.                                                                                                                                               |
| `calendar_events.category`              | 1     | School events per term — low hundreds across all AYs. `lib/evaluation/ptc-resolver.ts:91` filters `category = 'ptc'`, which is a small slice of an already-small table.                                                                                     |

### §3c — workflow tables (bounded by how often people file things)

| Pair                                    | Sites | Bound                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approval_requests.status`              | 4     | One row per filing in flight. Already served by `approval_requests_open_idx` (`126:200`), a partial index `where status = 'pending'` — and `'pending'` is the value every site filters on.                                                                                                                                      |
| `approval_request_stages.status`        | 4     | Two rows per request (the 2-stage ladder). Both `approval_request_stages_pool_idx` (`126:275`) and `_section_idx` (`126:280`) are partial `where status = 'pending'`.                                                                                                                                                           |
| `approval_request_stages.resolver`      | 1     | Same 2-rows-per-request bound; `resolver` has 2 distinct values (`named`, `form_adviser`).                                                                                                                                                                                                                                      |
| `approval_stage_approvers.created_at`   | 1     | One row per person on a named stage — currently 2 people (KD #196: Ms Lhen, Ms Elaine Wee).                                                                                                                                                                                                                                     |
| `approver_assignments.created_at`       | 2     | Bounded by `unique (user_id, flow)` (`013:33`) across a 22-account staff roster and 2 flows.                                                                                                                                                                                                                                    |
| `student_declarations.status`           | 2     | Both sites narrow first on an indexed column — `section_id` (`125:212`) at `lib/declarations/cell-filings.ts:95`, `student_id` (`125:209`) at `lib/declarations/filing-window.ts:166`. There is also a partial `student_declarations_pending_idx` (`125:223`). Production held **0 pending declarations** at the Phase 0 probe. |
| `student_discipline_records.created_at` | 2     | An `.order()` after `.eq('student_id', …)`, indexed by `student_discipline_records_student_idx` (`120:144`). One row per filed incident; the module shipped 2026-08-21.                                                                                                                                                         |
| `grade_change_requests.requested_at`    | 3     | An `.order()` after `status` / `requested_by` filters that are both indexed (`009:75`, `009:79`).                                                                                                                                                                                                                               |
| `unknown.requested_at`                  | 1     | Same — `grade_change_requests.requested_at` at `lib/activity/feed.ts:387`, after the `.or(arms)` scope filter.                                                                                                                                                                                                                  |

### §3d — `audit_log` JSONB path filters (4 pairs, 7 call sites)

| Pair                                           | Sites | Verdict |
| ---------------------------------------------- | ----- | ------- |
| `audit_log.context->after->>enrollment_status` | 2     | EXEMPT  |
| `audit_log.context->>lateEnrolleeTransition`   | 2     | EXEMPT  |
| `audit_log.context->>reEnrolment`              | 2     | EXEMPT  |
| `audit_log.context->>ay_code`                  | 1     | EXEMPT  |

All seven sites are in `lib/sis/movements.ts`, which derives the student-movements report from the
audit trail. **`audit_log` holds 1,499 rows** (Phase 0 probe, 2026-08-29). Four expression indexes on
four different JSONB paths, on a table that every admin action appends to, would cost four index
writes per action to save a sub-millisecond scan of one page-set. The movements report is also
already narrowed by `audit_log_action_created_at_idx` (`052:8`) and
`audit_log_entity_type_created_at_idx` (`052:19`).

⚠ **If this is ever revisited, the right answer is one `gin` index on `context`, not four btree
expression indexes** — the paths queried will keep changing as the movements report grows, and an
expression index only serves the exact expression it was built on.

---

## §4 — EXEMPT: other (8 pairs, 12 call sites)

These are neither "already indexed on that column" nor "too small". Each has its own reason.

### §4a — `attendance_daily`: a partial index already built for exactly this query (2 pairs)

| Pair                         | Sites | Verdict |
| ---------------------------- | ----- | ------- |
| `attendance_daily.status`    | 1     | EXEMPT  |
| `attendance_daily.ex_reason` | 1     | EXEMPT  |

**This is the one genuinely large table in the sweep — 102,510 rows** (Phase 0 probe) — so it is the
one place a missing index would actually matter. It does not have one.

Both hits are the same statement, `lib/attendance/drill.ts:771-772`:

```
.in('section_student_id', ssIds.slice(...))   // chunks of <= 100
.eq('status', 'EX')
.eq('ex_reason', 'compassionate')
```

`attendance_daily_compassionate_idx` (`015:204`) is
`(section_student_id, recorded_at desc) where ex_reason = 'compassionate'` — **a partial index whose
predicate is literally this query's `ex_reason` filter, led by the column this query narrows on
first.** Migration 015's own comment says it was built for the compassionate-quota counter, which is
what this loader is. The residual `.eq('status','EX')` is free: `ex_reason` is only ever non-null
when `status = 'EX'`, enforced by `attendance_daily_ex_reason_requires_ex_chk` (`015:197`).

⚠ **Do not propose anything on `attendance_daily`.** Migrations 014, 015 and 048 between them cover
the daily grid (`term_id, section_student_id, date desc`), the per-student history
(`section_student_id, date desc, recorded_at desc`), the import/audit path (`recorded_at desc`), the
compassionate quota, and the vacation quota (`048:102`, partial `where ex_reason = 'vacation'`).
Every read this app makes of that table lands on one of them.

### §4b — the query reads the whole table, so an index cannot avoid the scan (4 pairs)

| Pair                                          | Sites | Verdict |
| --------------------------------------------- | ----- | ------- |
| `${prefix}_enrolment_applications.created_at` | 2     | EXEMPT  |
| `unknown.lastName`                            | 1     | EXEMPT  |
| `unknown.firstName`                           | 1     | EXEMPT  |
| `unknown.created_at`                          | 3     | EXEMPT  |

`lib/sis/queries.ts:137-141` and `lib/admissions/priority.ts:88` are the admissions list read. It
selects `LIST_APP_COLUMNS` from `${prefix}_enrolment_applications` **with no `where` clause at all**
and walks every page with `fetchAllPages` — by design, because the list is the whole intake. An index
on the `order by` column cannot remove a scan that is the point of the query; it could only replace
an in-memory sort of **822 rows** (the largest AY table) with an ordered read, and that sort is
sub-millisecond.

⚠ **This is deliberately excluded from §1 even though it sits on the same tables.** §1 indexes the
columns that _narrow_ a read. These three only order one. Adding them would be write cost for
nothing, and would make the §1 migration look better-evidenced than it is.

The third `unknown.created_at` site is `lib/activity/feed.ts:210` — an `.order()` on
`approval_requests` through `referencedTable`, already served by `approval_requests_open_idx`
(`126:200`, `(flow, created_at desc) where status = 'pending'`) and bounded per §3c. The remaining
one is `lib/discipline/queries.ts:256`, already answered in §2c.

### §4c — `grade_audit_log`: unindexed, and the only entry carrying a re-measure trigger (2 pairs)

| Pair                         | Sites | Verdict                                                                    |
| ---------------------------- | ----- | -------------------------------------------------------------------------- |
| `grade_audit_log.changed_at` | 2     | EXEMPT — **with a stated trigger to revisit**                              |
| `unknown.grade_entry_id`     | 1     | EXEMPT (`grade_audit_log.grade_entry_id`, `app/api/audit-log/route.ts:28`) |

`grade_audit_log` carries **no index of any kind beyond its `id` primary key** — `001:167` declares
no unique constraint, and no later migration adds one. `app/api/audit-log/route.ts:25` orders it
`changed_at desc` with `limit 500` and only _optionally_ narrows by `sheet_id` / `entry_id`; the
export route (`:77`) does the same. (The `grading_sheet_id` half of `unknown.grading_sheet_id` in
§2c is this same table and this same verdict.)

It is exempt because the table is bounded by grade-entry **edit** volume, and AY2026 holds
**4,636 grade entries in total** (`scripts/audit-grade-recompute-drift.ts`, measured). A `limit 500`
top-N sort over a table of that order is sub-millisecond.

⚠ **This is the only exemption in this document that rests on an inference rather than a count.**
`grade_audit_log`'s own row count was not in the Phase 0 probe, and unlike every other table here it
is append-only with no per-AY ceiling — a locked sheet reopened and re-edited appends rows without
adding entries. **Re-measure it on the next sweep.** The trigger: if it exceeds ~50,000 rows, add
`create index … on public.grade_audit_log (changed_at desc)` and
`… (grading_sheet_id, changed_at desc)`. Until someone has counted it, proposing those would be
guessing — and a false "missing index" finding is worse than none.

---

## §5 — Counts, and the reconciliation

Every one of the 86 pairs and all 484 call sites are accounted for exactly once.

| Category                             | Pairs                                                      | Call sites |
| ------------------------------------ | ---------------------------------------------------------- | ---------- |
| **§1 — INDEX**                       | **13 scanner labels → 5 distinct (table, column) targets** | **110**    |
| §2 — EXEMPT, an index already exists | 32                                                         | 244        |
| §3 — EXEMPT, bounded by construction | 33                                                         | 118        |
| §4 — EXEMPT, other                   | 8                                                          | 12         |
| **Total**                            | **86**                                                     | **484**    |

By verdict, counting the scanner's own 86 labels: **13 INDEX, 73 EXEMPT**. Those 13 INDEX labels
collapse to **5 distinct (table, column) targets** and therefore 5 index statements per AY.

⚠ **The 13-vs-5 gap is not double-counting.** The scanner sees the AY tables under thirteen
different spellings, because the table name is built at runtime from a template literal that four
different files spell four different ways (`${prefix}_`, `${rePrefix}_`, `ay${year}_`,
`${prefixFor(ayCode)}_`) and a fifth group of call sites builds the query across statements so the
name resolves to `unknown`. All thirteen are the same three physical tables and the same five
columns. **The migration writes five index statements per AY, not thirteen.**

### Where the exemptions come from

Of the 73 exempt labels:

- **32 are outright scanner false positives** — the column is indexed and the scanner could not see
  it (§2). 17 because the index came from an inline `unique` / `primary key` constraint instead of a
  `create index`, 6 because a dotted PostgREST filter reports the SELECT alias instead of the table,
  and 9 because the table name could not be resolved statically at all. **Between them these account
  for 244 of the 484 reported call sites — just over half the report.**
- **33 are on tables bounded by a documented fact** (§3) — a check constraint, a Key Decision, or a
  Phase 0 measurement. These are the real judgement calls, and every one names its bound.
- **8 are one-off reasons** (§4): 2 already covered by a partial index built for the exact query,
  4 where the query reads the whole table so an index cannot help, and 2 on `grade_audit_log` —
  **the only pair in this document whose exemption rests on an inference rather than a count.**

### Where the scanner should improve, if anyone touches it

Two of the three blind spots are cheap to close and would take the noise floor of this sweep from
86 pairs to about 30:

1. **Parse `unique (...)` and `primary key (...)` out of `create table` bodies** and register the
   lead column (and every prefix) as indexed. This alone removes 17 pairs and 186 call sites,
   including the two loudest findings in the report.
2. **Resolve a dotted filter's alias against the select clause** (`section:sections!inner(...)`)
   before deciding which table it names. Removes 6 more pairs and 27 sites.

The third — resolving a query builder assembled across statements — is real static analysis and is
not worth it; 11 pairs answered by hand in an afternoon is cheaper than a TypeScript AST pass, and
the script already reports them as `unknown` rather than dropping them, which is the right
behaviour.

### What this document does NOT do

- **No migration is written here.** §1 gives the DDL and the three traps; a separate agent owns the
  migration.
- **No claim that this is a speed-up.** It is not. See the sizing note in §1.
- **`attendance_daily` is not touched** — see §4a.
- **`grade_audit_log` is the one open thread**, with its trigger and DDL written down in §4c.

### Re-running this

```
npx tsx scripts/audit/unindexed-filters.ts    # ~40s, no DB credentials, exits 0 always
```

The script enumerates; it cannot prove a query plan is a sequential scan. Anything it surfaces that
is not in this document is genuinely new. Anything in this document that it surfaces again is
already answered above — **do not re-litigate an exempt row without a new measurement to overturn the
bound it cites.**
