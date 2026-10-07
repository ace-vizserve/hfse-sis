-- Term 4 framework — behaviour test. Runs on the LOCAL stack only, inside a
-- transaction that is rolled back. Each check prints "T4F OK: …".
begin;

create temp table fx (k text primary key, v uuid) on commit drop;

do $$
declare
  v_ay uuid; v_sec uuid; v_sec2 uuid;
  v_t1 uuid; v_t2 uuid; v_t3 uuid; v_t4 uuid;
  v_a uuid; v_b uuid; v_c uuid; v_ca uuid; v_cb uuid; v_cc uuid;
  v_d uuid; v_cd uuid;
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
  -- two examinable subjects and one non-examinable, each with a config this AY
  select sc.subject_id, sc.id into v_a, v_ca from subject_configs sc join subjects su on su.id = sc.subject_id
   where sc.academic_year_id = v_ay and su.is_examinable order by su.code limit 1;
  select sc.subject_id, sc.id into v_b, v_cb from subject_configs sc join subjects su on su.id = sc.subject_id
   where sc.academic_year_id = v_ay and su.is_examinable and su.id <> v_a order by su.code limit 1;
  select sc.subject_id, sc.id into v_c, v_cc from subject_configs sc join subjects su on su.id = sc.subject_id
   where sc.academic_year_id = v_ay and not su.is_examinable order by su.code limit 1;
  -- a third examinable subject, for a (mis-placed) framework sheet on Term 2
  select sc.subject_id, sc.id into v_d, v_cd from subject_configs sc join subjects su on su.id = sc.subject_id
   where sc.academic_year_id = v_ay and su.is_examinable and su.id not in (v_a, v_b) order by su.code limit 1;
  -- Fixture adaptation: the local stack has only ONE section without sheets, so
  -- the second ("old class") section is any other section with no T1 sheet for A.
  select s.id into v_sec2 from sections s
   where s.academic_year_id = v_ay and s.id <> v_sec
     and not exists (select 1 from grading_sheets g
                      where g.section_id = s.id and g.term_id = v_t1 and g.subject_id = v_a)
   order by s.id limit 1;
  if v_sec2 is null or v_c is null or v_d is null or v_t4 is null then
    raise exception 'fixture: local stack lacks an empty section pair / non-examinable subject / third examinable subject / T4 term';
  end if;
  insert into fx values ('ay',v_ay),('sec',v_sec),('sec2',v_sec2),('t1',v_t1),('t2',v_t2),('t3',v_t3),('t4',v_t4),
    ('a',v_a),('b',v_b),('c',v_c),('ca',v_ca),('cb',v_cb),('cc',v_cc),('d',v_d),('cd',v_cd);
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

-- A framework sheet on TERM 2 (the app refuses this; the DB does not). Its
-- grade must never be a source of the best term average, and the cascade
-- must never touch it. s1: best 87.5 fills WW, rec 30/30, task 100 => ~96,
-- which would lift T2's average to ~90 if it counted.
insert into grading_sheets (term_id, section_id, subject_id, subject_config_id, sheet_type,
                            ww_totals, pt_totals, qa_total, ww_weight, pt_weight, qa_weight)
values ((select v from fx where k='t2'),(select v from fx where k='sec'),(select v from fx where k='d'),
        (select v from fx where k='cd'),'term4_framework','{100}','{30}',100,0.50,0.20,0.30);
insert into grade_entries (grading_sheet_id, section_student_id, pt_scores, qa_score)
select gs.id, '00000000-0000-4000-8000-0000000000b1', '{30}', 100
  from grading_sheets gs
 where gs.sheet_type = 'term4_framework' and gs.term_id = (select v from fx where k='t2')
   and gs.section_id = (select v from fx where k='sec');
create temp view t4wrong as
  select ge.* from grade_entries ge join grading_sheets gs on gs.id = ge.grading_sheet_id
   where gs.sheet_type = 'term4_framework' and gs.term_id = (select v from fx where k='t2')
     and gs.section_id = (select v from fx where k='sec');
do $$
declare r record;
begin
  select * into r from t4wrong;
  if r.quarterly_grade is null then
    raise exception 'fixture: the Term 2 framework entry has no grade'; end if;
  select * into r from student_best_term_average('00000000-0000-4000-8000-0000000000a1',(select v from fx where k='ay'));
  if r.best is distinct from 87.5 or r.term_number <> 2 then
    raise exception 'framework sheet counted as a source: expected 87.5 / T2, got % / %', r.best, r.term_number; end if;
  raise notice 'T4F OK: a framework sheet is never a source of the best term average';
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

-- ── Task 2 checks ─────────────────────────────────────────────────────────
-- Seed the T4 framework sheet (sheet for subject A was inserted above) the way
-- the create route does: bare rows.
insert into grade_entries (grading_sheet_id, section_student_id)
select gs.id, ss.id from grading_sheets gs, section_students ss
 where gs.sheet_type = 'term4_framework' and gs.section_id = (select v from fx where k='sec')
   and gs.term_id = (select v from fx where k='t4')
   and ss.section_id = gs.section_id;

create temp view t4 as
  select ge.* from grade_entries ge join grading_sheets gs on gs.id = ge.grading_sheet_id
   where gs.sheet_type = 'term4_framework' and gs.section_id = (select v from fx where k='sec')
     and gs.term_id = (select v from fx where k='t4');

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
  select * into r from t4wrong;
  if r.ww_scores is distinct from '{87.5}'::numeric[] then
    raise exception 'cascade wrote a framework sheet outside Term 4: got %', r.ww_scores; end if;
  raise notice 'T4F OK: cascade only writes Term 4 rows';
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

-- A signed-in teacher's T1-T3 save cascades into the T4 sheet; the system-owned
-- ww_scores slot must NOT be audited as that teacher.
select set_config('request.jwt.claims',
  '{"sub":"fe5362fd-2e8f-460e-a488-8c7f4d1dc5cb","role":"authenticated"}', true);
update grade_entries ge set ww_scores = '{50}', pt_scores = '{50}', qa_score = 50
  from grading_sheets gs
 where gs.id = ge.grading_sheet_id and gs.term_id = (select v from fx where k='t3')
   and gs.subject_id = (select v from fx where k='b')
   and ge.section_student_id = '00000000-0000-4000-8000-0000000000b1';
select set_config('request.jwt.claims', '', true);
do $$
declare r record;
begin
  select * into r from t4 where section_student_id = '00000000-0000-4000-8000-0000000000b1';
  if r.ww_scores is not distinct from '{93.5}'::numeric[] then
    raise exception 'audit test: cascade did not move the T4 value'; end if;
  if exists (select 1 from audit_log where entity_id = r.id::text
              and context->>'field' = 'ww_scores[0]') then
    raise exception 'audit_log blamed a user for the system-owned T4 ww slot'; end if;
  if not exists (select 1 from audit_log
                  where actor_id = 'fe5362fd-2e8f-460e-a488-8c7f4d1dc5cb'
                    and context->>'field' = 'ww_scores[0]') then
    raise exception 'audit test invalid: the teacher''s own T3 write was not audited'; end if;
  raise notice 'T4F OK: cascade does not write audit_log rows for the system-owned slot';
end $$;

-- Bulk create skips an existing Term 4 framework sheet.
-- create_grading_sheets_for_section(p_section_id uuid) (migration 083) covers
-- every subject x every term of the section's AY, so it is called once.
select create_grading_sheets_for_section((select v from fx where k='sec'));
do $$
begin
  if (select count(*) from grading_sheets where section_id = (select v from fx where k='sec')
        and term_id = (select v from fx where k='t4') and subject_id = (select v from fx where k='a')) <> 1
     or not exists (select 1 from grading_sheets where section_id = (select v from fx where k='sec')
        and term_id = (select v from fx where k='t4') and subject_id = (select v from fx where k='a')
        and sheet_type = 'term4_framework' and ww_totals = '{100}' and pt_totals = '{30}') then
    raise exception 'bulk create disturbed the Term 4 framework sheet'; end if;
  raise notice 'T4F OK: bulk create leaves Term 4 framework sheets alone';
end $$;

-- ── Switch sheet type (migration 185) ─────────────────────────────────────
-- A standard Term 4 sheet for subject D with s1's scores entered, plus s3 on
-- a row with no scores that still carries a grade (an imported grade, say —
-- the derive trigger's "never erases" branch would keep it).
create temp table sw (k text primary key, v uuid) on commit drop;
do $$
declare sh uuid; b record; res jsonb; r record; snap jsonb;
  s1 uuid := '00000000-0000-4000-8000-0000000000b1';
  s3 uuid := '00000000-0000-4000-8000-0000000000b3';
begin
  select id into sh from grading_sheets
   where term_id = (select v from fx where k='t4') and section_id = (select v from fx where k='sec')
     and subject_id = (select v from fx where k='d');
  if sh is null then
    insert into grading_sheets (term_id, section_id, subject_id, subject_config_id, ww_totals, pt_totals, qa_total)
    values ((select v from fx where k='t4'),(select v from fx where k='sec'),(select v from fx where k='d'),
            (select v from fx where k='cd'),'{10,10}','{10}',30)
    returning id into sh;
  end if;
  update grading_sheets set ww_totals = '{10,10}', pt_totals = '{10}', qa_total = 30,
                            slot_labels = '{"ww":["Quiz 1","Quiz 2"]}'::jsonb
   where id = sh;
  insert into sw values ('d4', sh);
  delete from grade_entries where grading_sheet_id = sh
     and section_student_id in (s1, s3)
     and not exists (select 1 from grade_audit_log g where g.grade_entry_id = grade_entries.id);
  insert into grade_entries (grading_sheet_id, section_student_id, ww_scores, pt_scores, qa_score)
  values (sh, s1, '{8,9}', '{7}', 20)
  on conflict (grading_sheet_id, section_student_id)
  do update set ww_scores = excluded.ww_scores, pt_scores = excluded.pt_scores, qa_score = excluded.qa_score;
  insert into grade_entries (grading_sheet_id, section_student_id, initial_grade, quarterly_grade)
  values (sh, s3, 70, 81)
  on conflict (grading_sheet_id, section_student_id) do nothing;
  update grade_entries set quarterly_grade = 81 where grading_sheet_id = sh and section_student_id = s3;
  if (select quarterly_grade from grade_entries where grading_sheet_id = sh and section_student_id = s3) is distinct from 81 then
    raise exception 'fixture: s3 does not carry a stale grade'; end if;
  -- s2: an excusal and nothing else
  delete from grade_entries where grading_sheet_id = sh
     and section_student_id = '00000000-0000-4000-8000-0000000000b2'
     and not exists (select 1 from grade_audit_log g where g.grade_entry_id = grade_entries.id);
  insert into grade_entries (grading_sheet_id, section_student_id, ww_excused)
  values (sh, '00000000-0000-4000-8000-0000000000b2', '{1}')
  on conflict (grading_sheet_id, section_student_id)
  do update set ww_scores = '{}', pt_scores = '{}', qa_score = null, ww_excused = '{1}';
  if (select ww_excused::text from grade_entries where grading_sheet_id = sh
        and section_student_id = '00000000-0000-4000-8000-0000000000b2') is distinct from '{1}' then
    raise exception 'fixture: s2 has no excusal'; end if;

  res := switch_grading_sheet_type(sh, 'term4_framework');

  if not exists (select 1 from grading_sheets where id = sh and sheet_type = 'term4_framework'
                   and ww_totals = '{100}' and pt_totals = '{30}' and qa_total = 100
                   and ww_weight = 0.50 and pt_weight = 0.20 and qa_weight = 0.30 and slot_labels is null) then
    raise exception 'switch to framework: wrong shape'; end if;
  raise notice 'T4F OK: switch to framework reshapes the sheet';

  select * into b from student_best_term_average('00000000-0000-4000-8000-0000000000a1',(select v from fx where k='ay'));
  select * into r from grade_entries where grading_sheet_id = sh and section_student_id = s1;
  if r.ww_scores is distinct from array[b.best] or r.pt_scores[1] is not null or r.qa_score is not null then
    raise exception 'switch to framework: expected {%}/blank/null, got %/%/%', b.best, r.ww_scores, r.pt_scores, r.qa_score; end if;
  raise notice 'T4F OK: switch to framework clears scores and refills the best term average';

  select * into r from grade_entries where grading_sheet_id = sh and section_student_id = s3;
  if r.ww_scores[1] is not null or r.quarterly_grade is not null or r.initial_grade is not null then
    raise exception 'switch to framework: s3 kept %/% with no scores', r.initial_grade, r.quarterly_grade; end if;
  raise notice 'T4F OK: a grade with no scores behind it does not survive a switch';

  select e into snap from jsonb_array_elements(res->'cleared') e where e->>'section_student_id' = s1::text;
  if res->>'from' <> 'standard' or res->>'to' <> 'term4_framework'
     or (res->>'cleared_count')::int < 1
     or snap->'ww_scores' <> '[8, 9]'::jsonb or snap->'pt_scores' <> '[7]'::jsonb
     or (snap->>'qa_score')::numeric <> 20 or snap->>'quarterly_grade' is null
     or res->'slot_labels'->'ww'->>0 is distinct from 'Quiz 1' then
    raise exception 'switch to framework: snapshot wrong: %', res; end if;
  raise notice 'T4F OK: switch returns the cleared scores for the audit row';
  if not exists (select 1 from jsonb_array_elements(res->'cleared') e
                  where e->>'section_student_id' = s3::text
                    and (e->>'quarterly_grade')::int = 81 and (e->>'initial_grade')::numeric = 70) then
    raise exception 'switch to framework: s3''s grade with no scores is not in the snapshot: %', res; end if;
  raise notice 'T4F OK: a grade with no scores behind it is kept in the snapshot';
  if not exists (select 1 from jsonb_array_elements(res->'cleared') e
                  where e->>'section_student_id' = '00000000-0000-4000-8000-0000000000b2'
                    and e->'ww_excused' = '[1]'::jsonb) then
    raise exception 'switch to framework: the excusal-only row is not in the snapshot: %', res; end if;
  if exists (select 1 from grade_entries where grading_sheet_id = sh
              and section_student_id = '00000000-0000-4000-8000-0000000000b2' and ww_excused <> '{}') then
    raise exception 'switch to framework: the excusal was not cleared'; end if;
  raise notice 'T4F OK: an excusal-only row is captured, then cleared';
end $$;

-- Refusals, each HFT4F.
do $$
declare sh uuid;
begin
  begin
    perform switch_grading_sheet_type((select v from sw where k='d4'), 'term4_framework');
    raise exception 'same type was accepted';
  exception when sqlstate 'HFT4F' then raise notice 'T4F OK: switch to the same type refused';
  end;

  update grading_sheets set is_locked = true where id = (select v from sw where k='d4');
  begin
    perform switch_grading_sheet_type((select v from sw where k='d4'), 'standard');
    raise exception 'locked switch was accepted';
  exception when sqlstate 'HFT4F' then raise notice 'T4F OK: switching a locked sheet refused';
  end;
  update grading_sheets set is_locked = false where id = (select v from sw where k='d4');

  select id into sh from grading_sheets where term_id = (select v from fx where k='t1')
     and section_id = (select v from fx where k='sec') and subject_id = (select v from fx where k='a');
  begin
    perform switch_grading_sheet_type(sh, 'term4_framework');
    raise exception 'non-T4 switch was accepted';
  exception when sqlstate 'HFT4F' then raise notice 'T4F OK: framework outside Term 4 refused';
  end;

  insert into grading_sheets (term_id, section_id, subject_id, subject_config_id, ww_totals, pt_totals, qa_total)
  values ((select v from fx where k='t4'),(select v from fx where k='sec'),(select v from fx where k='c'),
          (select v from fx where k='cc'),'{10}','{10}',30)
  on conflict (term_id, section_id, subject_id) do nothing;
  select id into sh from grading_sheets where term_id = (select v from fx where k='t4')
     and section_id = (select v from fx where k='sec') and subject_id = (select v from fx where k='c');
  begin
    perform switch_grading_sheet_type(sh, 'term4_framework');
    raise exception 'non-examinable switch was accepted';
  exception when sqlstate 'HFT4F' then raise notice 'T4F OK: framework for a non-examinable subject refused';
  end;
end $$;

-- Switch back: standard shape, scores empty, derived figures null.
do $$
declare sh uuid := (select v from sw where k='d4'); res jsonb; r record; v_qa numeric;
  s1 uuid := '00000000-0000-4000-8000-0000000000b1';
  s3 uuid := '00000000-0000-4000-8000-0000000000b3';
begin
  update grade_entries set pt_scores = '{25}', qa_score = 80 where grading_sheet_id = sh and section_student_id = s1;
  -- s3 picks up a stale grade again (no scores; the derive trigger keeps it)
  update grade_entries set quarterly_grade = 81 where grading_sheet_id = sh and section_student_id = s3;
  if (select quarterly_grade from grade_entries where grading_sheet_id = sh and section_student_id = s3) is distinct from 81 then
    raise exception 'fixture: s3 does not carry a stale grade before switching back'; end if;

  res := switch_grading_sheet_type(sh, 'standard');

  select coalesce(sc.qa_max, 30) into v_qa from subject_configs sc where sc.id = (select v from fx where k='cd');
  if not exists (select 1 from grading_sheets where id = sh and sheet_type = 'standard'
                   and ww_totals = '{10,10,10}' and pt_totals = '{10,10,10}' and qa_total = v_qa
                   and ww_weight is null and pt_weight is null and qa_weight is null) then
    raise exception 'switch to standard: wrong shape'; end if;
  raise notice 'T4F OK: switch to standard reshapes the sheet';

  for r in select * from grade_entries where grading_sheet_id = sh and section_student_id in (s1, s3) loop
    if exists (select 1 from unnest(r.ww_scores) v where v is not null)
       or exists (select 1 from unnest(r.pt_scores) v where v is not null) or r.qa_score is not null
       or r.ww_ps is not null or r.pt_ps is not null or r.qa_ps is not null
       or r.initial_grade is not null or r.quarterly_grade is not null then
      raise exception 'switch to standard: row % not blank: %', r.section_student_id, row_to_json(r); end if;
  end loop;
  raise notice 'T4F OK: switch to standard clears scores and derived figures';

  if res->>'from' <> 'term4_framework' or res->>'to' <> 'standard'
     or not exists (select 1 from jsonb_array_elements(res->'cleared') e
                     where e->>'section_student_id' = s1::text
                       and e->'pt_scores' = '[25]'::jsonb and (e->>'qa_score')::numeric = 80) then
    raise exception 'switch to standard: snapshot wrong: %', res; end if;
  raise notice 'T4F OK: switch back returns the cleared scores';
end $$;

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
