# Term 4 framework sheet type — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A grading sheet type, "Term 4 framework", whose grade is 50% the student's best T1–T3 term average (system-filled, kept live), 20% a teacher's recommendation out of 30, 30% a task out of 100, through the unchanged grade formula.

**Architecture:** `grading_sheets.sheet_type` (`standard` | `term4_framework`). A Term 4 framework sheet is a standard sheet with a fixed shape — 1 WW slot (max 100), 1 PT slot (max 30), QA 100, weights 0.50/0.20/0.30 — so `computeQuarterly` and the database's `grade_entries_derive()` are untouched. A BEFORE trigger fills the WW slot with the best term average (and refuses anyone else writing it); an AFTER trigger on T1–T3 entries touches the student's Term 4 framework entries so they refill and re-derive.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres (plpgsql triggers), TypeScript, Vitest, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-10-07-term4-framework-sheet-design.md`

## Global Constraints

- Hard Rule #1: `computeQuarterly` returns 93 on the canonical case — do NOT modify `lib/compute/quarterly.ts`, `public.compute_quarterly`, `public.grade_component_ps` or `public.grade_entries_derive()`.
- Hard Rule #2: all grade computation server-side. The best term average is computed in SQL only; no TypeScript copy.
- Hard Rule #6: grade entries and audit logs are append-only — cascaded changes ADD `grade_audit_log` rows, never edit them.
- Hard Rule #7: tokens from `app/globals.css` only; no hex/oklch/slate/zinc/gray in `app/` or `components/`.
- Sheet type values exactly: `standard`, `term4_framework`. Label exactly: "Term 4 framework" (Standard sheets: "Standard").
- Fixed shape exactly: `ww_totals = {100}`, `pt_totals = {30}`, `qa_total = 100`, `ww_weight = 0.50`, `pt_weight = 0.20`, `qa_weight = 0.30`.
- Column labels exactly: "Best term average", "Teacher's recommendation", "Revision task / Mock exam".
- Term average = mean of `quarterly_grade` over EXAMINABLE subjects, non-N/A, T1–T3, per term; best = highest, ties to the later term; rounded to 1 decimal (General Average rounding, `lib/compute/annual.ts:computeGeneralAverage`).
- Error code for every Term 4 framework refusal: `HFT4F`. User-facing copy is plain English, no jargon.
- Bulk create is NOT changed. Term 4 framework sheets are created one at a time.
- Migrations are new files `183_…`, `184_…`; never edit an applied migration. Production apply is Task 8, only after Mr Ace says go.
- Vitest: `npx vitest run --pool=threads <path>` (forks pool times out here). Tests import vitest globals explicitly.
- Commit with `git add <paths> && git commit` as ONE command (shared index). Never edit files via PowerShell or scripts — Edit/Write tools only.

## Review Focus

1. **A student who moved class mid-year** has two `section_students` rows in the AY, so one subject can be graded twice in one term. Expected: each subject counts once per term (the non-withdrawn enrolment's grade). Test pinned in Task 1.
2. **A teacher saving the recommendation after the best term average moved under them** (the cascade changed it since page load). The grid's save sends only the touched field (`patchEntry` body in `score-entry-grid.tsx` ~566), so `ww_scores` is not in the write. Expected: the save succeeds and the best term average keeps its new value. Test pinned in Task 2. Task 6 must keep that property — never send `ww_scores` from a Term 4 framework row.
3. **Saving the subject's settings (config sync) when a Term 4 framework sheet exists.** `sync_grading_sheets_from_config` pads every unlocked sheet to the config's max slots. Expected: the Term 4 framework sheet keeps its fixed shape and the save does not fail. Test pinned in Task 1.
4. **A T1–T3 change while the T4 sheet is locked.** Expected: the T4 grade still moves, with a `grade_audit_log` row. Test pinned in Task 2.
5. **Bulk create run for a term after a Term 4 framework sheet exists for that section and subject.** Expected: bulk create skips it (no error, no second sheet, type unchanged). Test pinned in Task 2.

---

## Phase 1 — Database

Gate: both migrations apply cleanly on the local stack, `supabase/tests/term4_framework_test.sql` passes, then a reviewer pass on the SQL before Phase 2.

Local stack: Docker container `supabase_db_hfse-markbook`. Apply new migrations with `npm run local:migrate`. Run the SQL test with:

```bash
docker cp supabase/tests/term4_framework_test.sql supabase_db_hfse-markbook:/tmp/t4f.sql && docker exec supabase_db_hfse-markbook psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/t4f.sql
```

The test file runs inside `BEGIN … ROLLBACK`, so it leaves no rows behind. It prints `T4F OK: <name>` per check and stops at the first `RAISE EXCEPTION`.

### Task 1: Sheet type, fixed shape, best term average (migration 183)

**Files:**

- Create: `supabase/migrations/183_term4_framework_sheet_type.sql`
- Create: `supabase/tests/term4_framework_test.sql`
- Reference (copy from, don't edit): `supabase/migrations/108_sync_stops_clobbering_qa_total.sql` (latest `sync_grading_sheets_from_config`)

**Interfaces:**

- Produces:
  - column `public.grading_sheets.sheet_type text not null default 'standard'`
  - `public.student_best_term_average(p_student_id uuid, p_academic_year_id uuid) returns table (best numeric, term_number smallint)` — zero rows when the student has no examinable, non-N/A T1–T3 grade
  - `public.best_term_averages_for_sheet(p_sheet_id uuid) returns table (section_student_id uuid, best numeric, term_number smallint)` — one row per entry on the sheet; `best`/`term_number` null when none
  - both functions executable by `service_role` only

- [ ] **Step 1: Write the failing SQL test (part 1)**

Create `supabase/tests/term4_framework_test.sql`. It builds its own fixture inside the current AY's data on the local stack, picking sections that have no grading sheets, so it never collides with seeded rows. Adjust `insert into students` columns if later migrations added NOT NULL columns without defaults (check `\d students` in psql).

```sql
-- Term 4 framework — behaviour test. Runs on the LOCAL stack only, inside a
-- transaction that is rolled back. Each check prints "T4F OK: …".
begin;

create temp table fx (k text primary key, v uuid) on commit drop;

do $$
declare
  v_ay uuid; v_sec uuid; v_sec2 uuid;
  v_t1 uuid; v_t2 uuid; v_t3 uuid; v_t4 uuid;
  v_a uuid; v_b uuid; v_c uuid; v_ca uuid; v_cb uuid; v_cc uuid;
begin
  select id into v_ay from academic_years where is_current limit 1;
  select id into v_t1 from terms where academic_year_id = v_ay and term_number = 1;
  select id into v_t2 from terms where academic_year_id = v_ay and term_number = 2;
  select id into v_t3 from terms where academic_year_id = v_ay and term_number = 3;
  select id into v_t4 from terms where academic_year_id = v_ay and term_number = 4;
  select s.id into v_sec from sections s
   where s.academic_year_id = v_ay
     and not exists (select 1 from grading_sheets g where g.section_id = s.id)
   order by s.id limit 1;
  select s.id into v_sec2 from sections s
   where s.academic_year_id = v_ay and s.id <> v_sec
     and not exists (select 1 from grading_sheets g where g.section_id = s.id)
   order by s.id limit 1;
  -- two examinable subjects and one non-examinable, each with a config this AY
  select sc.subject_id, sc.id into v_a, v_ca from subject_configs sc join subjects su on su.id = sc.subject_id
   where sc.academic_year_id = v_ay and su.is_examinable order by su.code limit 1;
  select sc.subject_id, sc.id into v_b, v_cb from subject_configs sc join subjects su on su.id = sc.subject_id
   where sc.academic_year_id = v_ay and su.is_examinable and su.id <> v_a order by su.code limit 1;
  select sc.subject_id, sc.id into v_c, v_cc from subject_configs sc join subjects su on su.id = sc.subject_id
   where sc.academic_year_id = v_ay and not su.is_examinable order by su.code limit 1;
  if v_sec2 is null or v_c is null or v_t4 is null then
    raise exception 'fixture: local stack lacks an empty section pair / non-examinable subject / T4 term';
  end if;
  insert into fx values ('ay',v_ay),('sec',v_sec),('sec2',v_sec2),('t1',v_t1),('t2',v_t2),('t3',v_t3),('t4',v_t4),
    ('a',v_a),('b',v_b),('c',v_c),('ca',v_ca),('cb',v_cb),('cc',v_cc);
end $$;

-- Students: s1 normal; s2 N/A in T2; s3 no earlier grades; s4 moved class.
insert into students (id, student_number, last_name, first_name) values
  ('00000000-0000-4000-8000-0000000000a1','T4F-0001','Test','One'),
  ('00000000-0000-4000-8000-0000000000a2','T4F-0002','Test','Two'),
  ('00000000-0000-4000-8000-0000000000a3','T4F-0003','Test','Three'),
  ('00000000-0000-4000-8000-0000000000a4','T4F-0004','Test','Four');
insert into section_students (id, section_id, student_id, index_number, enrollment_status) values
  ('00000000-0000-4000-8000-0000000000b1',(select v from fx where k='sec'),'00000000-0000-4000-8000-0000000000a1',901,'active'),
  ('00000000-0000-4000-8000-0000000000b2',(select v from fx where k='sec'),'00000000-0000-4000-8000-0000000000a2',902,'active'),
  ('00000000-0000-4000-8000-0000000000b3',(select v from fx where k='sec'),'00000000-0000-4000-8000-0000000000a3',903,'active'),
  ('00000000-0000-4000-8000-0000000000b4',(select v from fx where k='sec'),'00000000-0000-4000-8000-0000000000a4',904,'active'),
  ('00000000-0000-4000-8000-0000000000b5',(select v from fx where k='sec2'),'00000000-0000-4000-8000-0000000000a4',905,'withdrawn');

-- Standard sheets: one WW, one PT, one exam, all max 100, weights 40/40/20,
-- so equal scores s give initial s. Transmuted: 60→75, 70→81, 80→87, 100→100.
-- (Postgres has no CREATE TEMP FUNCTION; pg_temp functions vanish with the session.)
create function pg_temp.mk_sheet(p_term text, p_sec text, p_subj text, p_cfg text) returns uuid
language sql as $f$
  insert into grading_sheets (term_id, section_id, subject_id, subject_config_id,
                              ww_totals, pt_totals, qa_total, ww_weight, pt_weight, qa_weight)
  values ((select v from fx where k=p_term),(select v from fx where k=p_sec),
          (select v from fx where k=p_subj),(select v from fx where k=p_cfg),
          '{100}','{100}',100,0.40,0.40,0.20)
  returning id $f$;

create function pg_temp.put(p_sheet uuid, p_ss text, p_s numeric, p_na boolean default false) returns void
language sql as $f$
  insert into grade_entries (grading_sheet_id, section_student_id, ww_scores, pt_scores, qa_score, is_na)
  values (p_sheet, p_ss::uuid, array[p_s], array[p_s], p_s, p_na) $f$;

do $$
declare sh uuid;
  s1 text := '00000000-0000-4000-8000-0000000000b1';
  s2 text := '00000000-0000-4000-8000-0000000000b2';
  s4 text := '00000000-0000-4000-8000-0000000000b4';
  s4old text := '00000000-0000-4000-8000-0000000000b5';
begin
  -- T1: A 80→87, B 60→75  => avg 81.0
  sh := pg_temp.mk_sheet('t1','sec','a','ca'); perform pg_temp.put(sh,s1,80); perform pg_temp.put(sh,s2,100); perform pg_temp.put(sh,s4,60);
  sh := pg_temp.mk_sheet('t1','sec','b','cb'); perform pg_temp.put(sh,s1,60); perform pg_temp.put(sh,s2,100); perform pg_temp.put(sh,s4,60);
  -- s4's old class graded A in T1 at 100 before they moved; must NOT count
  sh := pg_temp.mk_sheet('t1','sec2','a','ca'); perform pg_temp.put(sh,s4old,100);
  -- T2: A 100→100, B 60→75  => avg 87.5 ; s2 is N/A in T2
  sh := pg_temp.mk_sheet('t2','sec','a','ca'); perform pg_temp.put(sh,s1,100); perform pg_temp.put(sh,s2,100,true); perform pg_temp.put(sh,s4,60);
  sh := pg_temp.mk_sheet('t2','sec','b','cb'); perform pg_temp.put(sh,s1,60);  perform pg_temp.put(sh,s2,100,true); perform pg_temp.put(sh,s4,60);
  -- T3: A 80→87, B 80→87 => avg 87.0 ; C (non-examinable) 100 must be ignored
  sh := pg_temp.mk_sheet('t3','sec','a','ca'); perform pg_temp.put(sh,s1,80); perform pg_temp.put(sh,s2,70); perform pg_temp.put(sh,s4,60);
  sh := pg_temp.mk_sheet('t3','sec','b','cb'); perform pg_temp.put(sh,s1,80); perform pg_temp.put(sh,s2,70); perform pg_temp.put(sh,s4,60);
  sh := pg_temp.mk_sheet('t3','sec','c','cc'); perform pg_temp.put(sh,s1,100);
end $$;

-- ── Task 1 checks ─────────────────────────────────────────────────────────
do $$
declare r record;
begin
  select * into r from student_best_term_average('00000000-0000-4000-8000-0000000000a1',(select v from fx where k='ay'));
  if r.best is distinct from 87.5 or r.term_number <> 2 then
    raise exception 'best term s1: expected 87.5 / T2, got % / %', r.best, r.term_number; end if;
  raise notice 'T4F OK: best term average, examinable only, best of three';

  select * into r from student_best_term_average('00000000-0000-4000-8000-0000000000a2',(select v from fx where k='ay'));
  -- s2: T1 avg 100 (both 100), T2 N/A (skipped), T3 81 => 100 / T1
  if r.best is distinct from 100.0 or r.term_number <> 1 then
    raise exception 'best term s2 (N/A skipped): expected 100.0 / T1, got % / %', r.best, r.term_number; end if;
  raise notice 'T4F OK: N/A term skipped';

  if exists (select 1 from student_best_term_average('00000000-0000-4000-8000-0000000000a3',(select v from fx where k='ay'))) then
    raise exception 'best term s3: expected no row'; end if;
  raise notice 'T4F OK: no earlier grades -> no row';

  select * into r from student_best_term_average('00000000-0000-4000-8000-0000000000a4',(select v from fx where k='ay'));
  -- s4: every term 75 in the current class; the withdrawn class's 100 must not count
  if r.best is distinct from 75.0 then
    raise exception 'moved class s4: expected 75.0, got %', r.best; end if;
  raise notice 'T4F OK: moved class counts each subject once';
end $$;

-- Fixed shape is enforced
do $$
begin
  begin
    insert into grading_sheets (term_id, section_id, subject_id, subject_config_id, sheet_type,
                                ww_totals, pt_totals, qa_total, ww_weight, pt_weight, qa_weight)
    values ((select v from fx where k='t4'),(select v from fx where k='sec'),(select v from fx where k='b'),
            (select v from fx where k='cb'),'term4_framework','{10,10}','{30}',100,0.50,0.20,0.30);
    raise exception 'shape check did not fire';
  exception when check_violation then
    raise notice 'T4F OK: wrong shape refused';
  end;
end $$;

-- The Term 4 framework sheet for subject A (Task 2 seeds and grades it)
insert into grading_sheets (term_id, section_id, subject_id, subject_config_id, sheet_type,
                            ww_totals, pt_totals, qa_total, ww_weight, pt_weight, qa_weight)
values ((select v from fx where k='t4'),(select v from fx where k='sec'),(select v from fx where k='a'),
        (select v from fx where k='ca'),'term4_framework','{100}','{30}',100,0.50,0.20,0.30);

-- @@TASK2@@ (Task 2 appends its checks here)

-- Config sync leaves a Term 4 framework sheet alone. LAST on purpose: it pads
-- the fixture's standard sheets for subject A to the config's max slots,
-- which changes their grades.
select sync_grading_sheets_from_config((select v from fx where k='ca'));
do $$
begin
  if not exists (select 1 from grading_sheets where sheet_type='term4_framework'
                  and section_id=(select v from fx where k='sec') and ww_totals='{100}' and pt_totals='{30}') then
    raise exception 'config sync reshaped the Term 4 framework sheet'; end if;
  raise notice 'T4F OK: config sync skips Term 4 framework sheets';
end $$;

rollback;
```

- [ ] **Step 2: Run it and confirm it fails**

Run the SQL test command (Phase 1 header). Expected: `ERROR: function student_best_term_average(...) does not exist` (or `column "sheet_type" does not exist`).

- [ ] **Step 3: Write migration 183**

```sql
-- Migration 183 — the "Term 4 framework" grading sheet type
--
-- Secondary Four's Term 4 is two weeks before O-Level study leave, so the
-- school grades it as: 50% the student's best T1–T3 term average, 20% the
-- teacher's recommendation (out of 30), 30% a revision task or mock exam (out
-- of 100). Spec: docs/superpowers/specs/2026-10-07-term4-framework-sheet-design.md
--
-- A Term 4 framework sheet is a standard sheet with a FIXED shape — one WW
-- slot (the best term average, max 100), one PT slot (max 30), exam 100,
-- weights 50/20/30 — so the grade formula is untouched (Hard Rule #1).
-- Migration 184 fills and keeps the WW slot live.

begin;

alter table public.grading_sheets
  add column if not exists sheet_type text not null default 'standard';

alter table public.grading_sheets
  drop constraint if exists grading_sheets_sheet_type_check;
alter table public.grading_sheets
  add constraint grading_sheets_sheet_type_check
  check (sheet_type in ('standard', 'term4_framework'));

alter table public.grading_sheets
  drop constraint if exists grading_sheets_term4_framework_shape_check;
alter table public.grading_sheets
  add constraint grading_sheets_term4_framework_shape_check
  check (
    sheet_type <> 'term4_framework'
    or (    ww_totals = '{100}'::numeric[]
        and pt_totals = '{30}'::numeric[]
        and qa_total  = 100
        and ww_weight = 0.50 and pt_weight = 0.20 and qa_weight = 0.30)
  );

comment on column public.grading_sheets.sheet_type is
  'standard | term4_framework. A term4_framework sheet has a fixed shape (see grading_sheets_term4_framework_shape_check); its WW slot is the best T1–T3 term average, filled by grade_entries_best_term_fill() (migration 184).';

-- ---------------------------------------------------------------------------
-- The best term average
-- ---------------------------------------------------------------------------
-- Per term T1–T3: the mean of the student's quarterly grades over EXAMINABLE
-- subjects, N/A rows skipped (that is the proration for late enrollees). A
-- subject counts once per term: a student who moved class mid-year has rows
-- in both sections, and the non-withdrawn enrolment's row wins. Rounded to 1
-- decimal like the General Average. Best = highest; a tie goes to the later
-- term (the value is the same either way).
create or replace function public.student_best_term_average(
  p_student_id       uuid,
  p_academic_year_id uuid
)
returns table (best numeric, term_number smallint)
language sql
stable
security definer
set search_path = public
as $$
  with one_per_subject as (
    select distinct on (t.term_number, gs.subject_id)
           t.term_number, ge.quarterly_grade
      from grade_entries ge
      join grading_sheets gs   on gs.id = ge.grading_sheet_id
      join terms t             on t.id = gs.term_id
      join subjects s          on s.id = gs.subject_id
      join section_students ss on ss.id = ge.section_student_id
     where ss.student_id = p_student_id
       and t.academic_year_id = p_academic_year_id
       and t.term_number between 1 and 3
       and s.is_examinable
       and not ge.is_na
       and ge.quarterly_grade is not null
     order by t.term_number, gs.subject_id,
              (ss.enrollment_status = 'withdrawn'), ge.updated_at desc
  )
  select round(avg(quarterly_grade)::numeric, 1) as best, term_number
    from one_per_subject
   group by term_number
   order by 1 desc, term_number desc
   limit 1;
$$;

-- For the grid: each entry's best term average and the term it came from.
create or replace function public.best_term_averages_for_sheet(p_sheet_id uuid)
returns table (section_student_id uuid, best numeric, term_number smallint)
language sql
stable
security definer
set search_path = public
as $$
  select ge.section_student_id, b.best, b.term_number
    from grade_entries ge
    join grading_sheets gs   on gs.id = ge.grading_sheet_id
    join terms t             on t.id = gs.term_id
    join section_students ss on ss.id = ge.section_student_id
    left join lateral public.student_best_term_average(ss.student_id, t.academic_year_id) b on true
   where ge.grading_sheet_id = p_sheet_id;
$$;

revoke all on function public.student_best_term_average(uuid, uuid) from public, anon, authenticated;
revoke all on function public.best_term_averages_for_sheet(uuid) from public, anon, authenticated;
grant execute on function public.student_best_term_average(uuid, uuid) to service_role;
grant execute on function public.best_term_averages_for_sheet(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Config sync must not reshape a Term 4 framework sheet
-- ---------------------------------------------------------------------------
-- COPY the full `CREATE OR REPLACE FUNCTION sync_grading_sheets_from_config`
-- body from migration 108 here, verbatim, changing ONLY the loop's query to:
--
--     SELECT id, ww_totals, pt_totals
--     FROM grading_sheets
--     WHERE subject_config_id = p_config_id
--       AND is_locked = false
--       AND sheet_type = 'standard'
--
-- (It pads every unlocked sheet to the config's max slots, which would break
-- the fixed shape and make the subject's settings save fail.) Keep 108's
-- trailing grant/comment block if it has one.

commit;
```

The executor replaces the COPY comment block with the real function body from 108 plus the one-line filter — the function must be present in the file, not a comment.

- [ ] **Step 4: Apply and run the test**

Run: `npm run local:migrate` then the SQL test command.
Expected: the Task 1 notices print (`T4F OK: best term average…` through `T4F OK: config sync skips…`), then `ROLLBACK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/183_term4_framework_sheet_type.sql supabase/tests/term4_framework_test.sql && git commit -m "feat(grading): Term 4 framework sheet type — fixed shape + best term average (migration 183)"
```

### Task 2: Fill and keep live (migration 184)

**Files:**

- Create: `supabase/migrations/184_term4_framework_fill_and_cascade.sql`
- Modify: `supabase/tests/term4_framework_test.sql` (replace the `-- @@TASK2@@` line)

**Interfaces:**

- Consumes: `student_best_term_average` (Task 1), `grading_sheets.sheet_type`.
- Produces: triggers `grade_entries_best_term_fill_trg` (BEFORE INSERT OR UPDATE, name sorts before `grade_entries_derive_trg` so it runs first) and `grade_entries_best_term_cascade_trg` (AFTER INSERT OR UPDATE). Error code `HFT4F`.

- [ ] **Step 1: Add the failing checks**

Replace `-- @@TASK2@@ (Task 2 appends its checks here)` with:

```sql
-- ── Task 2 checks ─────────────────────────────────────────────────────────
-- Seed the T4 framework sheet (sheet for subject A was inserted above) the way
-- the create route does: bare rows.
insert into grade_entries (grading_sheet_id, section_student_id)
select gs.id, ss.id from grading_sheets gs, section_students ss
 where gs.sheet_type = 'term4_framework' and gs.section_id = (select v from fx where k='sec')
   and ss.section_id = gs.section_id;

create temp view t4 as
  select ge.* from grade_entries ge join grading_sheets gs on gs.id = ge.grading_sheet_id
   where gs.sheet_type = 'term4_framework' and gs.section_id = (select v from fx where k='sec');

do $$
declare r record;
begin
  select * into r from t4 where section_student_id = '00000000-0000-4000-8000-0000000000b1';
  if r.ww_scores is distinct from '{87.5}'::numeric[] then
    raise exception 'fill on insert: expected {87.5}, got %', r.ww_scores; end if;
  raise notice 'T4F OK: best term average filled on create';

  select * into r from t4 where section_student_id = '00000000-0000-4000-8000-0000000000b3';
  if r.ww_scores[1] is not null then raise exception 'no earlier grades: expected null'; end if;
  raise notice 'T4F OK: no earlier grades -> blank';
end $$;

-- Teacher enters rec 24/30 and task 70/100 => 43.75 + 16 + 21 = 80.75 -> 87
update grade_entries set pt_scores = '{24}', qa_score = 70
 where id = (select id from t4 where section_student_id = '00000000-0000-4000-8000-0000000000b1');
do $$
declare r record;
begin
  select * into r from t4 where section_student_id = '00000000-0000-4000-8000-0000000000b1';
  if r.quarterly_grade <> 87 then raise exception 'worked example: expected 87, got %', r.quarterly_grade; end if;
  raise notice 'T4F OK: 50/20/30 through the usual conversion';
end $$;

-- Nobody types the best term average
do $$
begin
  begin
    update grade_entries set ww_scores = '{50}'
     where id = (select id from t4 where section_student_id = '00000000-0000-4000-8000-0000000000b1');
    raise exception 'typed best term average was accepted';
  exception when sqlstate 'HFT4F' then raise notice 'T4F OK: typed best term average refused';
  end;
  begin
    update grade_entries set pt_excused = '{1}'
     where id = (select id from t4 where section_student_id = '00000000-0000-4000-8000-0000000000b1');
    raise exception 'excusal was accepted';
  exception when sqlstate 'HFT4F' then raise notice 'T4F OK: excusing refused';
  end;
end $$;

-- Lock the T4 sheet, then change s1's T3 B grade 80 -> 100 (quarterly 100)
update grading_sheets set is_locked = true where sheet_type = 'term4_framework'
   and section_id = (select v from fx where k='sec');
update grade_entries ge set ww_scores = '{100}', pt_scores = '{100}', qa_score = 100
  from grading_sheets gs
 where gs.id = ge.grading_sheet_id and gs.term_id = (select v from fx where k='t3')
   and gs.subject_id = (select v from fx where k='b')
   and ge.section_student_id = '00000000-0000-4000-8000-0000000000b1';
do $$
declare r record;
begin
  -- T3 avg now (87 + 100)/2 = 93.5 -> 46.75 + 16 + 21 = 83.75 -> 89
  select * into r from t4 where section_student_id = '00000000-0000-4000-8000-0000000000b1';
  if r.ww_scores is distinct from '{93.5}'::numeric[] or r.quarterly_grade <> 89 then
    raise exception 'cascade: expected {93.5}/89, got %/%', r.ww_scores, r.quarterly_grade; end if;
  if not exists (select 1 from grade_audit_log where grade_entry_id = r.id
                  and field_changed = 'ww_scores[0]' and old_value = '87.5' and new_value = '93.5') then
    raise exception 'cascade: no grade_audit_log row'; end if;
  raise notice 'T4F OK: T1-T3 change flows into a locked T4 sheet, audited';
end $$;

-- After the cascade moved it, a recommendation save (PT only, as the grid
-- sends it) succeeds and leaves the new best term average in place
update grading_sheets set is_locked = false where sheet_type = 'term4_framework'
   and section_id = (select v from fx where k='sec');
update grade_entries set pt_scores = '{27}'
 where id = (select id from t4 where section_student_id = '00000000-0000-4000-8000-0000000000b1');
do $$
declare r record;
begin
  select * into r from t4 where section_student_id = '00000000-0000-4000-8000-0000000000b1';
  if r.ww_scores is distinct from '{93.5}'::numeric[] or r.pt_scores is distinct from '{27}'::numeric[] then
    raise exception 'save after cascade: expected {93.5}/{27}, got %/%', r.ww_scores, r.pt_scores; end if;
  raise notice 'T4F OK: recommendation save after a cascade keeps the new best term average';
end $$;

-- Bulk create skips an existing Term 4 framework sheet.
-- Read the current signature of create_grading_sheets_for_section (migrations
-- 083/107) and call it here for (section 'sec', term 't4'); then:
do $$
begin
  if (select count(*) from grading_sheets where section_id = (select v from fx where k='sec')
        and term_id = (select v from fx where k='t4') and subject_id = (select v from fx where k='a')) <> 1
     or not exists (select 1 from grading_sheets where section_id = (select v from fx where k='sec')
        and term_id = (select v from fx where k='t4') and subject_id = (select v from fx where k='a')
        and sheet_type = 'term4_framework') then
    raise exception 'bulk create disturbed the Term 4 framework sheet'; end if;
  raise notice 'T4F OK: bulk create leaves Term 4 framework sheets alone';
end $$;
```

The executor replaces the "Read the current signature…" comment with the actual `select create_grading_sheets_for_section(...)` call. If bulk create raises on the existing sheet, fix that in migration 184 (skip sheets that already exist) — the expected behaviour is skip.

- [ ] **Step 2: Run it and confirm it fails**

Expected: `fill on insert: expected {87.5}, got {}` (or `{NULL}`).

- [ ] **Step 3: Write migration 184**

```sql
-- Migration 184 — fill the Term 4 framework sheet's best term average, and
-- keep it live when a T1–T3 grade changes.
--
-- FILL (BEFORE, runs before grade_entries_derive_trg — triggers of the same
-- timing fire in name order, and "best" < "derive"): on a term4_framework
-- sheet the WW slot is ALWAYS the student's best term average. Anyone sending
-- a different value than the stored one is refused (HFT4F); re-sending the
-- stored value (a stale screen) is accepted and refilled. Excusing is refused.
--
-- CASCADE (AFTER): a T1–T3 entry whose quarterly_grade or is_na changed
-- touches that student's term4_framework entries in the same AY, which
-- re-fires FILL then DERIVE on them. Locked sheets included — a locked T1–T3
-- grade only changes through an approved change request (Mr Ace, 2026-10-07:
-- "of course update if approved"). Not `UPDATE OF quarterly_grade`: the
-- caller never names that column, the derive trigger sets it, and a
-- column-filtered trigger would never fire.

begin;

create or replace function public.grade_entries_best_term_fill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type    text;
  v_ay      uuid;
  v_student uuid;
  v_best    numeric;
  v_term    smallint;
  v_old     numeric;
begin
  select gs.sheet_type, t.academic_year_id into v_type, v_ay
    from grading_sheets gs join terms t on t.id = gs.term_id
   where gs.id = new.grading_sheet_id;
  if v_type is distinct from 'term4_framework' then
    return new;
  end if;

  if coalesce(new.ww_excused, '{}') <> '{}' or coalesce(new.pt_excused, '{}') <> '{}' then
    raise exception 'Assessments cannot be excused on a Term 4 framework sheet.'
      using errcode = 'HFT4F';
  end if;

  select ss.student_id into v_student from section_students ss where ss.id = new.section_student_id;
  select b.best, b.term_number into v_best, v_term
    from public.student_best_term_average(v_student, v_ay) b;

  v_old := case when tg_op = 'UPDATE' then old.ww_scores[1] end;

  if new.ww_scores[1] is not null
     and new.ww_scores[1] is distinct from v_best
     and new.ww_scores[1] is distinct from v_old then
    raise exception 'The best term average is filled in by the system.'
      using errcode = 'HFT4F';
  end if;

  new.ww_scores := array[v_best];

  if tg_op = 'UPDATE' and v_old is distinct from v_best then
    insert into grade_audit_log
      (grade_entry_id, grading_sheet_id, changed_by, field_changed, old_value, new_value, approval_reference)
    values
      (new.id, new.grading_sheet_id, 'system: best term average', 'ww_scores[0]',
       case when v_old  is null then null else trim_scale(v_old)::text  end,
       case when v_best is null then null else trim_scale(v_best)::text end,
       'Best term average follows the T1–T3 grades'
         || coalesce(' (now T' || v_term || ')', ''));
  end if;

  return new;
end;
$$;

drop trigger if exists grade_entries_best_term_fill_trg on public.grade_entries;
create trigger grade_entries_best_term_fill_trg
  before insert or update on public.grade_entries
  for each row execute function public.grade_entries_best_term_fill();

create or replace function public.grade_entries_best_term_cascade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_term    smallint;
  v_ay      uuid;
  v_student uuid;
begin
  if tg_op = 'UPDATE'
     and new.quarterly_grade is not distinct from old.quarterly_grade
     and new.is_na = old.is_na then
    return null;
  end if;

  select t.term_number, t.academic_year_id into v_term, v_ay
    from grading_sheets gs join terms t on t.id = gs.term_id
   where gs.id = new.grading_sheet_id;
  if v_term is null or v_term not between 1 and 3 then
    return null;
  end if;

  select student_id into v_student from section_students where id = new.section_student_id;

  update grade_entries ge
     set updated_at = now()
    from grading_sheets gs, terms t, section_students ss
   where ge.grading_sheet_id = gs.id
     and gs.term_id = t.id
     and gs.sheet_type = 'term4_framework'
     and t.academic_year_id = v_ay
     and ss.id = ge.section_student_id
     and ss.student_id = v_student;

  return null;
end;
$$;

drop trigger if exists grade_entries_best_term_cascade_trg on public.grade_entries;
create trigger grade_entries_best_term_cascade_trg
  after insert or update on public.grade_entries
  for each row execute function public.grade_entries_best_term_cascade();

commit;
```

- [ ] **Step 4: Apply and run the test**

Run: `npm run local:migrate` then the SQL test command. Expected: every `T4F OK:` notice from Tasks 1 and 2, then `ROLLBACK`.

- [ ] **Step 5: Confirm Hard Rule #1 still holds**

Run: `npx vitest run --pool=threads __tests__/compute/quarterly.test.ts`
Expected: PASS (formula untouched).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/184_term4_framework_fill_and_cascade.sql supabase/tests/term4_framework_test.sql && git commit -m "feat(grading): fill the Term 4 framework best term average and keep it live (migration 184)"
```

**Phase 1 check:** dispatch a reviewer on migrations 183/184 + the test: trigger order, recursion (cascade writes only term4_framework rows, which are T4 so the cascade exits), RLS bypass via security definer, the audit row shape matches migration 177's. Fix before Phase 2.

---

## Phase 2 — Server

Gate: `npx tsc --noEmit` clean, new vitest files pass, reviewer pass.

### Task 3: Shared constants

**Files:**

- Create: `lib/grading/term4-framework.ts`
- Test: `__tests__/grading/term4-framework.test.ts`

**Interfaces:**

- Produces:
  - `export const SHEET_TYPES = ['standard', 'term4_framework'] as const;`
  - `export type SheetType = (typeof SHEET_TYPES)[number];`
  - `export const SHEET_TYPE_LABEL: Record<SheetType, string>`
  - `export const TERM4_FRAMEWORK_SHAPE` (readonly: `ww_totals: [100]`, `pt_totals: [30]`, `qa_total: 100`, `ww_weight: 0.5`, `pt_weight: 0.2`, `qa_weight: 0.3`)
  - `export const TERM4_FRAMEWORK_LABELS = { ww, pt, qa }`
  - `export function parseSheetType(v: unknown): SheetType | null` — `undefined`/`null` → `'standard'`; unknown string → `null`
  - `export function isTerm4Framework(t: string | null | undefined): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { computeQuarterly } from '@/lib/compute/quarterly';
import {
  TERM4_FRAMEWORK_SHAPE,
  isTerm4Framework,
  parseSheetType,
} from '@/lib/grading/term4-framework';

describe('Term 4 framework', () => {
  it('worked example: best 86, rec 24/30, task 70/100 -> 80 -> 87', () => {
    const s = TERM4_FRAMEWORK_SHAPE;
    const out = computeQuarterly({
      ww_scores: [86],
      ww_totals: [...s.ww_totals],
      pt_scores: [24],
      pt_totals: [...s.pt_totals],
      qa_score: 70,
      qa_total: s.qa_total,
      ww_weight: s.ww_weight,
      pt_weight: s.pt_weight,
      qa_weight: s.qa_weight,
    });
    expect(out.initial_grade).toBeCloseTo(80, 6);
    expect(out.quarterly_grade).toBe(87);
  });

  it('parses the sheet type', () => {
    expect(parseSheetType(undefined)).toBe('standard');
    expect(parseSheetType(null)).toBe('standard');
    expect(parseSheetType('term4_framework')).toBe('term4_framework');
    expect(parseSheetType('holistic')).toBeNull();
    expect(parseSheetType(4)).toBeNull();
  });

  it('recognises the type', () => {
    expect(isTerm4Framework('term4_framework')).toBe(true);
    expect(isTerm4Framework('standard')).toBe(false);
    expect(isTerm4Framework(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --pool=threads __tests__/grading/term4-framework.test.ts`
Expected: FAIL — cannot resolve `@/lib/grading/term4-framework`.

- [ ] **Step 3: Implement**

```ts
// The "Term 4 framework" grading sheet type (KD #230).
//
// A standard sheet with a fixed shape: the WW slot is the student's best
// T1–T3 term average (filled by the database, migration 184), the PT slot the
// teacher's recommendation out of 30, the exam a revision task or mock exam
// out of 100, weighted 50/20/30. The grade formula is the usual one.
// The database enforces the same shape (grading_sheets_term4_framework_shape_check).

export const SHEET_TYPES = ['standard', 'term4_framework'] as const;
export type SheetType = (typeof SHEET_TYPES)[number];

export const SHEET_TYPE_LABEL: Record<SheetType, string> = {
  standard: 'Standard',
  term4_framework: 'Term 4 framework',
};

export const TERM4_FRAMEWORK_SHAPE = {
  ww_totals: [100],
  pt_totals: [30],
  qa_total: 100,
  ww_weight: 0.5,
  pt_weight: 0.2,
  qa_weight: 0.3,
} as const;

export const TERM4_FRAMEWORK_LABELS = {
  ww: 'Best term average',
  pt: "Teacher's recommendation",
  qa: 'Revision task / Mock exam',
} as const;

export function parseSheetType(v: unknown): SheetType | null {
  if (v == null) return 'standard';
  return typeof v === 'string' && (SHEET_TYPES as readonly string[]).includes(v)
    ? (v as SheetType)
    : null;
}

export function isTerm4Framework(t: string | null | undefined): boolean {
  return t === 'term4_framework';
}
```

- [ ] **Step 4: Run to verify it passes** — same command, expected PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/grading/term4-framework.ts __tests__/grading/term4-framework.test.ts && git commit -m "feat(grading): Term 4 framework constants"
```

### Task 4: Routes

**Files:**

- Modify: `app/api/grading-sheets/route.ts` (POST, ~97–250)
- Modify: `app/api/grading-sheets/[id]/totals/route.ts` (PATCH, ~44)
- Modify: `app/api/grading-sheets/[id]/excused/route.ts` (PATCH, ~54)
- Modify: `app/api/sis/admin/subjects/[configId]/term-weights/route.ts` (selects at ~79 and ~254)
- Modify: `lib/grading/sync-config-sheets.ts` (every `.from('grading_sheets')` select that feeds an update, ~59/195/266/306/317)

**Interfaces:**

- Consumes: `parseSheetType`, `isTerm4Framework`, `TERM4_FRAMEWORK_SHAPE` (Task 3).
- Produces: POST body accepts `sheet_type?: 'standard' | 'term4_framework'`.

- [ ] **Step 1: POST create**

After the `teacher_name` parse, add:

```ts
const sheet_type = parseSheetType(body.sheet_type);
if (!sheet_type) {
  return NextResponse.json({ error: 'Unknown sheet type' }, { status: 400 });
}
const t4f = isTerm4Framework(sheet_type);
```

Wrap the three existing `ww_totals`/`pt_totals`/`qa_total` validations and the two max-slot checks in `if (!t4f) { … }`. Before the insert, when `t4f`, check the subject is examinable:

```ts
if (t4f) {
  const { data: subj } = await service
    .from('subjects')
    .select('is_examinable')
    .eq('id', subject_id)
    .maybeSingle();
  if (!subj?.is_examinable) {
    return NextResponse.json(
      {
        error:
          'A Term 4 framework sheet is only for subjects with a number grade.',
      },
      { status: 400 }
    );
  }
}
```

In the insert, replace the shape fields with:

```ts
      sheet_type,
      ...(t4f
        ? {
            ww_totals: [...TERM4_FRAMEWORK_SHAPE.ww_totals],
            pt_totals: [...TERM4_FRAMEWORK_SHAPE.pt_totals],
            qa_total: TERM4_FRAMEWORK_SHAPE.qa_total,
            ww_weight: TERM4_FRAMEWORK_SHAPE.ww_weight,
            pt_weight: TERM4_FRAMEWORK_SHAPE.pt_weight,
            qa_weight: TERM4_FRAMEWORK_SHAPE.qa_weight,
          }
        : { ww_totals, pt_totals, qa_total }),
```

Add `sheet_type` to the `logAction` context object. Entry seeding is unchanged — migration 184 fills the best term average on insert.

- [ ] **Step 2: Totals PATCH refuses**

Where the route loads the sheet, add `sheet_type` to its select, and immediately after the not-found check:

```ts
if (isTerm4Framework(sheet.sheet_type)) {
  return NextResponse.json(
    { error: 'A Term 4 framework sheet has a fixed structure and weights.' },
    { status: 400 }
  );
}
```

- [ ] **Step 3: Excused PATCH refuses**

Same pattern in `excused/route.ts`, message: `'Assessments cannot be excused on a Term 4 framework sheet.'`.

- [ ] **Step 4: Term-weights and config sync skip these sheets**

In `term-weights/route.ts`, add `.eq('sheet_type', 'standard')` to both `grading_sheets` selects (~79, ~254). In `lib/grading/sync-config-sheets.ts`, add `.eq('sheet_type', 'standard')` to every `grading_sheets` select whose rows are then updated or recomputed. Leave read-only selects alone.

- [ ] **Step 5: Type-check and run grading tests**

Run: `npx tsc --noEmit` — expected clean.
Run: `npx vitest run --pool=threads __tests__/grading` — expected PASS. (`sheet-weight-resolution.test.ts` forbids reading `ww_weight` off a `subject_configs` join — this task doesn't.)

- [ ] **Step 6: Commit**

```bash
git add app/api/grading-sheets/route.ts "app/api/grading-sheets/[id]/totals/route.ts" "app/api/grading-sheets/[id]/excused/route.ts" "app/api/sis/admin/subjects/[configId]/term-weights/route.ts" lib/grading/sync-config-sheets.ts && git commit -m "feat(grading): create Term 4 framework sheets; fixed shape guarded in routes"
```

**Phase 2 check:** reviewer pass on Tasks 3–4.

---

## Phase 3 — UI

Gate: `npx tsc --noEmit` clean, a browser pass on the local stack (create one Term 4 framework sheet, enter a recommendation and a task score, hover the best term average), reviewer pass. Design docs `docs/context/09-design-system.md` and `09a-design-patterns.md` are binding — reuse existing primitives, no new visual language.

### Task 5: Create form

**Files:**

- Modify: `lib/schemas/new-sheet.ts`
- Modify: `app/(markbook)/markbook/grading/new/new-sheet-form.tsx`

- [ ] **Step 1: Schema**

Add to `NewSheetSchema`:

```ts
  sheet_type: z.enum(['standard', 'term4_framework']),
```

- [ ] **Step 2: Form state and POST body**

Default `sheet_type: 'standard'`; `const sheetType = form.watch('sheet_type');`; add `sheet_type: values.sheet_type` to the POST body. When `sheet_type` is `term4_framework`, also send the fixed shape from `TERM4_FRAMEWORK_SHAPE` (the server overrides it anyway).

- [ ] **Step 3: Sheet type field — last field in Step 1's card, after Subject**

```tsx
<FormField
  control={form.control}
  name="sheet_type"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Sheet type</FormLabel>
      <Select value={field.value} onValueChange={field.onChange}>
        <FormControl>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
        </FormControl>
        <SelectContent>
          <SelectItem value="standard">Standard</SelectItem>
          <SelectItem value="term4_framework">Term 4 framework</SelectItem>
        </SelectContent>
      </Select>
      <FormDescription>
        Term 4 framework: 50% best term average, 20% teacher&apos;s
        recommendation, 30% revision task or mock exam.
      </FormDescription>
      <FormMessage />
    </FormItem>
  )}
/>
```

- [ ] **Step 4: Step 2 card shows the fixed structure instead of inputs**

Inside Step 2's `CardContent`, render the existing inputs only when `sheetType === 'standard'`; otherwise:

```tsx
<dl className="divide-y divide-border rounded-lg border border-border">
  {[
    [TERM4_FRAMEWORK_LABELS.ww, 'Filled in from the best of Terms 1–3', '50%'],
    [TERM4_FRAMEWORK_LABELS.pt, 'Out of 30', '20%'],
    [TERM4_FRAMEWORK_LABELS.qa, 'Out of 100', '30%'],
  ].map(([name, detail, weight]) => (
    <div
      key={name}
      className="flex items-baseline justify-between gap-4 px-4 py-3"
    >
      <div>
        <dt className="text-sm font-medium text-foreground">{name}</dt>
        <dd className="text-xs text-muted-foreground">{detail}</dd>
      </div>
      <dd className="font-mono text-sm tabular-nums text-foreground">
        {weight}
      </dd>
    </div>
  ))}
</dl>
```

Also hide the form's side summary of WW/PT/QA totals (whatever reads `wwTotal`/`ptTotal`/`qaTotal`) for this type, or show the same three rows — whichever the existing summary pattern makes simpler.

When the chosen subject is non-examinable, disable the `term4_framework` item (`disabled` on `SelectItem`) and reset to `standard` on subject change.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit` — expected clean.

- [ ] **Step 6: Commit**

```bash
git add lib/schemas/new-sheet.ts "app/(markbook)/markbook/grading/new/new-sheet-form.tsx" && git commit -m "feat(grading): choose Term 4 framework when creating a sheet"
```

### Task 6: Grid and sheet page

**Files:**

- Modify: `app/(markbook)/markbook/grading/[id]/page.tsx` (sheet select ~169, `TotalsEditor` ~661, `ScoreEntryGrid` ~917)
- Modify: `components/grading/score-entry-grid.tsx` (Props ~121, headers ~1069–1090 and mobile ~1833–1876, WW cells ~1294, `ComputedCell` WW total ~1330)

**Interfaces:**

- Consumes: `best_term_averages_for_sheet` RPC (Task 1), `TERM4_FRAMEWORK_LABELS`, `isTerm4Framework` (Task 3).
- Produces: `ScoreEntryGrid` props `sheetType?: SheetType` and `bestTermSource?: Record<string, { best: number | null; termNumber: number | null }>` keyed by `section_student_id`.

- [ ] **Step 1: Page**

Add `sheet_type` to the sheet select. When `isTerm4Framework(sheet.sheet_type)`:

- don't render `<TotalsEditor>`;
- pass `canExcuse={false}`;
- load the sources with the service client and pass them down:

```ts
let bestTermSource:
  | Record<string, { best: number | null; termNumber: number | null }>
  | undefined;
if (isTerm4Framework(sheet.sheet_type)) {
  const { data } = await createServiceClient().rpc(
    'best_term_averages_for_sheet',
    {
      p_sheet_id: sheet.id,
    }
  );
  bestTermSource = Object.fromEntries(
    (data ?? []).map(
      (r: {
        section_student_id: string;
        best: number | null;
        term_number: number | null;
      }) => [
        r.section_student_id,
        {
          best: r.best == null ? null : Number(r.best),
          termNumber: r.term_number,
        },
      ]
    )
  );
}
```

Pass `sheetType={sheet.sheet_type}` and `bestTermSource={bestTermSource}` to `ScoreEntryGrid`.

- [ ] **Step 2: Headers (desktop and mobile)**

```tsx
const t4f = isTerm4Framework(sheetType);
const wwHeader = t4f ? TERM4_FRAMEWORK_LABELS.ww : 'Written Works';
const ptHeader = t4f ? TERM4_FRAMEWORK_LABELS.pt : 'Performance Tasks';
const qaHeader = t4f ? TERM4_FRAMEWORK_LABELS.qa : 'Quarterly Assessment';
```

Replace the six literal header strings with `{wwHeader} ({wwPct}%)` etc. On `t4f` the column-code row reads `Avg` instead of `W1` and `Rec` instead of `PT1`.

- [ ] **Step 3: The best term average cell**

In the WW inputs map, before the excused branch:

```tsx
                        {t4f ? (
                          <BestTermCell
                            value={r.ww_scores[0] ?? null}
                            termNumber={bestTermSource?.[r.section_student_id]?.termNumber ?? null}
                          />
                        ) : r.ww_excused?.includes(i + 1) ? (
```

Add next to `ExcusedCell`:

```tsx
function BestTermCell({
  value,
  termNumber,
}: {
  value: number | null;
  termNumber: number | null;
}) {
  if (value == null) {
    return (
      <HoverHint hint="This student has no Term 1–3 grades yet, so there is no best term average.">
        <span className="flex h-8 items-center justify-center rounded-md bg-muted px-2 text-[11px] font-medium text-muted-foreground">
          No earlier grades
        </span>
      </HoverHint>
    );
  }
  return (
    <HoverHint
      hint={`Term ${termNumber} average, the best of Terms 1–3. Filled in automatically.`}
    >
      <span className="flex h-8 items-center justify-end rounded-md bg-muted/60 px-2 font-mono text-xs tabular-nums text-foreground">
        {value.toFixed(1)}
      </span>
    </HoverHint>
  );
}
```

The WW Total `ComputedCell` uses `dp={t4f ? 1 : 0}`. Apply the same cell in the mobile layout's WW block.

- [ ] **Step 4: Type-check and the label-coverage test**

Run: `npx tsc --noEmit` — expected clean.
Run: `npx vitest run --pool=threads __tests__/ui` — expected PASS.

- [ ] **Step 5: Browser pass on the local stack**

`npm run dev` (with `.env.development.local`). Create a Term 4 framework sheet for an examinable subject in a section with T1–T3 grades. Check: headers read the three labels; the best term average shows with a 1-decimal value and its hint names the term; typing is not possible in it; entering 24 and 70 gives the expected quarterly grade; the totals editor is absent; clicking a student name does not open "Counted assessments".

- [ ] **Step 6: Commit**

```bash
git add "app/(markbook)/markbook/grading/[id]/page.tsx" components/grading/score-entry-grid.tsx && git commit -m "feat(grading): Term 4 framework sheet on the score grid"
```

**Phase 3 check:** reviewer pass on Tasks 5–6 against `09-design-system.md` §7 checklist.

---

## Phase 4 — Record and ship

### Task 7: Docs

**Files:**

- Modify: `docs/key-decisions/markbook-grading.md` (append KD #230)
- Modify: `.claude/rules/key-decisions.md` — ⚠ needs Mr Ace's approval (rules file); ask, then add `230` to the markbook-grading row and `230 mb-grading` to the quick lookup
- Modify: `docs/context/02-grading-system.md` (new section "Term 4 framework sheets")
- Modify: `docs/context/04-database-schema.md` (`grading_sheets.sheet_type`, the two functions, the two triggers)
- Follow `docs/rules/workflow.md` for the session-context entry in `CLAUDE.md`

- [ ] **Step 1:** KD #230 — what, why (O-Level study leave; Excel name-lookup chain), the rule, the fixed-shape reuse decision, the live cascade incl. locked sheets ("of course update if approved"), the name ("Term 4 framework", the school's title; "Holistic grading" rejected), bulk create unchanged.
- [ ] **Step 2:** 02-grading-system section with the worked example (86 / 24 / 70 → 80 → 87).
- [ ] **Step 3:** Commit `git add <the doc paths> && git commit -m "docs: Term 4 framework sheet type (KD #230)"`.

### Task 8: Production (only on Mr Ace's go)

- [ ] **Step 1:** Ask Mr Ace before touching production.
- [ ] **Step 2:** Apply 183 then 184 to production; probe read-only: `sheet_type` column exists with every existing sheet `standard`; both functions and both triggers present; `select * from best_term_averages_for_sheet(<any T1 sheet id>)` returns without error.
- [ ] **Step 3:** `git pull --rebase` then push.
