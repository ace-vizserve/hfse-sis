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
  -- two examinable subjects and one non-examinable, each with a config this AY
  select sc.subject_id, sc.id into v_a, v_ca from subject_configs sc join subjects su on su.id = sc.subject_id
   where sc.academic_year_id = v_ay and su.is_examinable order by su.code limit 1;
  select sc.subject_id, sc.id into v_b, v_cb from subject_configs sc join subjects su on su.id = sc.subject_id
   where sc.academic_year_id = v_ay and su.is_examinable and su.id <> v_a order by su.code limit 1;
  select sc.subject_id, sc.id into v_c, v_cc from subject_configs sc join subjects su on su.id = sc.subject_id
   where sc.academic_year_id = v_ay and not su.is_examinable order by su.code limit 1;
  -- Fixture adaptation: the local stack has only ONE section without sheets, so
  -- the second ("old class") section is any other section with no T1 sheet for A.
  select s.id into v_sec2 from sections s
   where s.academic_year_id = v_ay and s.id <> v_sec
     and not exists (select 1 from grading_sheets g
                      where g.section_id = s.id and g.term_id = v_t1 and g.subject_id = v_a)
   order by s.id limit 1;
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
