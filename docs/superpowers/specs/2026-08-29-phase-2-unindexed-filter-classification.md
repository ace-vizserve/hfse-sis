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

---

## §2 — EXEMPT: an index already exists (34 pairs, 218 call sites)

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

**§2 subtotal: 34 pairs listed, of which 32 are genuinely exempt** and 2 are §1 entries appearing
under their scanner label.
