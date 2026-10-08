-- Grading sheet archive (migration 186) — behaviour test. Runs on the LOCAL
-- stack only, inside a transaction that is rolled back. Each check prints
-- "ARC OK: …".
begin;

create temp table fx (k text primary key, v uuid) on commit drop;

do $$
declare
  v_ay uuid; v_sec uuid; v_t1 uuid; v_t2 uuid; v_t3 uuid; v_t4 uuid;
  v_a uuid; v_ca uuid; v_b uuid; v_cb uuid;
begin
  select id into v_ay from academic_years where is_current limit 1;
  select id into v_t1 from terms where academic_year_id = v_ay and term_number = 1;
  select id into v_t2 from terms where academic_year_id = v_ay and term_number = 2;
  select id into v_t3 from terms where academic_year_id = v_ay and term_number = 3;
  select id into v_t4 from terms where academic_year_id = v_ay and term_number = 4;
  -- a section of the current AY with no sheets at all
  select s.id into v_sec from sections s
   where s.academic_year_id = v_ay
     and not exists (select 1 from grading_sheets g where g.section_id = s.id)
   order by s.id limit 1;
  select sc.subject_id, sc.id into v_a, v_ca from subject_configs sc join subjects su on su.id = sc.subject_id
   where sc.academic_year_id = v_ay and su.is_examinable order by su.code limit 1;
  select sc.subject_id, sc.id into v_b, v_cb from subject_configs sc join subjects su on su.id = sc.subject_id
   where sc.academic_year_id = v_ay and su.is_examinable and su.id <> v_a order by su.code limit 1;
  if v_sec is null or v_b is null or v_t4 is null then
    raise exception 'fixture: local stack lacks an empty section / two examinable subjects / T4 term';
  end if;
  insert into fx values ('ay',v_ay),('sec',v_sec),('t1',v_t1),('t2',v_t2),('t3',v_t3),('t4',v_t4),
    ('a',v_a),('ca',v_ca),('b',v_b),('cb',v_cb);
end $$;

-- The section takes subjects A and B (bulk create resolves through section_subjects)
insert into section_subjects (section_id, subject_config_id)
values ((select v from fx where k='sec'),(select v from fx where k='ca')),
       ((select v from fx where k='sec'),(select v from fx where k='cb'))
on conflict do nothing;

insert into students (id, student_number, last_name, first_name) values
  ('00000000-0000-4000-8000-0000000000c1','ARC-0001','Archive','One');
insert into section_students (id, section_id, student_id, index_number, enrollment_status) values
  ('00000000-0000-4000-8000-0000000000d1',(select v from fx where k='sec'),'00000000-0000-4000-8000-0000000000c1',951,'active');

create function pg_temp.mk_sheet(p_term text, p_subj text, p_cfg text) returns uuid
language sql as $f$
  insert into grading_sheets (term_id, section_id, subject_id, subject_config_id,
                              ww_totals, pt_totals, qa_total, ww_weight, pt_weight, qa_weight)
  values ((select v from fx where k=p_term),(select v from fx where k='sec'),
          (select v from fx where k=p_subj),(select v from fx where k=p_cfg),
          '{100}','{100}',100,0.40,0.40,0.20)
  returning id $f$;

create function pg_temp.put(p_sheet uuid, p_s numeric) returns uuid
language sql as $f$
  insert into grade_entries (grading_sheet_id, section_student_id, ww_scores, pt_scores, qa_score)
  values (p_sheet, '00000000-0000-4000-8000-0000000000d1', array[p_s], array[p_s], p_s)
  returning id $f$;

create function pg_temp.active_count(p_term text, p_subj text) returns bigint
language sql as $f$
  select count(*) from grading_sheets
   where term_id = (select v from fx where k=p_term) and section_id = (select v from fx where k='sec')
     and subject_id = (select v from fx where k=p_subj) and archived_at is null $f$;

create function pg_temp.all_count(p_term text, p_subj text) returns bigint
language sql as $f$
  select count(*) from grading_sheets
   where term_id = (select v from fx where k=p_term) and section_id = (select v from fx where k='sec')
     and subject_id = (select v from fx where k=p_subj) $f$;

-- ── One active sheet per slot; an archived sheet frees the slot ───────────
do $$
declare sh uuid; sh2 uuid;
begin
  sh := pg_temp.mk_sheet('t3','a','ca');
  insert into fx values ('t3a_old', sh);
  begin
    perform pg_temp.mk_sheet('t3','a','ca');
    raise exception 'a second active sheet for the same slot was accepted';
  exception when unique_violation then
    raise notice 'ARC OK: two active sheets for the same slot refused';
  end;

  update grading_sheets set archived_at = now() where id = sh;
  sh2 := pg_temp.mk_sheet('t3','a','ca');
  if sh2 is null or pg_temp.active_count('t3','a') <> 1 or pg_temp.all_count('t3','a') <> 2 then
    raise exception 'archived sheet did not free the slot'; end if;
  insert into fx values ('t3a_new', sh2);
  raise notice 'ARC OK: an archived sheet frees the slot for a new active sheet';

  begin
    perform pg_temp.mk_sheet('t3','a','ca');
    raise exception 'a second active sheet beside the archived one was accepted';
  exception when unique_violation then
    raise notice 'ARC OK: still only one active sheet when an archived one exists';
  end;
end $$;

-- ── Bulk create: skips active sheets, ignores archived ones ───────────────
-- T2/B: only an archived sheet exists; bulk create must make an active one.
do $$
declare sh uuid;
begin
  sh := pg_temp.mk_sheet('t2','b','cb');
  update grading_sheets set archived_at = now() where id = sh;
  insert into fx values ('t2b_arch', sh);
end $$;

select create_grading_sheets_for_section((select v from fx where k='sec'));
do $$
begin
  if pg_temp.active_count('t3','a') <> 1
     or not exists (select 1 from grading_sheets where id = (select v from fx where k='t3a_new') and archived_at is null) then
    raise exception 'bulk create (section) disturbed the active T3/A sheet'; end if;
  if pg_temp.active_count('t2','b') <> 1 or pg_temp.all_count('t2','b') <> 2 then
    raise exception 'bulk create (section) did not create an active sheet beside the archived T2/B one'; end if;
  if pg_temp.active_count('t1','a') <> 1 or pg_temp.active_count('t4','b') <> 1 then
    raise exception 'bulk create (section) did not create the missing sheets'; end if;
  if exists (select 1 from grade_entries where grading_sheet_id in
               ((select v from fx where k='t3a_old'),(select v from fx where k='t2b_arch'))) then
    raise exception 'bulk create seeded entries onto an archived sheet'; end if;
  raise notice 'ARC OK: bulk create (section) skips the active sheet, ignores archived ones';
end $$;

-- Undo the section-level bulk create's T1-T2 sheets for subject B so the scope
-- RPC has something to do: archive the active T2/B sheet again.
update grading_sheets set archived_at = now()
 where term_id = (select v from fx where k='t2') and section_id = (select v from fx where k='sec')
   and subject_id = (select v from fx where k='b') and archived_at is null;
do $$
declare res jsonb;
begin
  res := create_grading_sheets_for_scopes(jsonb_build_array(
    jsonb_build_object('section_id',(select v from fx where k='sec'),'subject_id',(select v from fx where k='a'),'term_id',(select v from fx where k='t3')),
    jsonb_build_object('section_id',(select v from fx where k='sec'),'subject_id',(select v from fx where k='b'),'term_id',(select v from fx where k='t2'))));
  if (res->>'inserted')::int <> 1 or pg_temp.active_count('t3','a') <> 1
     or pg_temp.active_count('t2','b') <> 1 or pg_temp.all_count('t2','b') <> 3 then
    raise exception 'bulk create (scopes) wrong: % / T3A active % / T2B active % all %',
      res, pg_temp.active_count('t3','a'), pg_temp.active_count('t2','b'), pg_temp.all_count('t2','b'); end if;
  raise notice 'ARC OK: bulk create (scopes) skips the active sheet, ignores archived ones';
end $$;

do $$
declare res jsonb;
begin
  res := create_grading_sheets_for_ay((select v from fx where k='ay'));
  if pg_temp.active_count('t3','a') <> 1 or pg_temp.active_count('t2','b') <> 1 then
    raise exception 'bulk create (AY) made a second active sheet: %', res; end if;
  if exists (select 1 from grade_entries where grading_sheet_id in
               ((select v from fx where k='t3a_old'),(select v from fx where k='t2b_arch'))) then
    raise exception 'bulk create (AY) seeded entries onto an archived sheet'; end if;
  raise notice 'ARC OK: bulk create (AY) skips active sheets, ignores archived ones';
end $$;

-- ── Force delete ──────────────────────────────────────────────────────────
do $$
begin
  begin
    perform force_delete_grading_sheet((select v from fx where k='t3a_new'));
    raise exception 'force delete of an active sheet was accepted';
  exception when sqlstate 'HFARC' then
    raise notice 'ARC OK: force delete refused on an active sheet';
  end;
  begin
    perform force_delete_grading_sheet('00000000-0000-4000-8000-00000000ffff');
    raise exception 'force delete of a missing sheet was accepted';
  exception when sqlstate 'HFARC' then
    raise notice 'ARC OK: force delete refused on a missing sheet';
  end;
end $$;

do $$
declare sh uuid; e uuid; res jsonb;
begin
  -- the active T3/A sheet: an entry, a change request, two grade history rows
  sh := (select v from fx where k='t3a_new');
  select id into e from grade_entries where grading_sheet_id = sh
     and section_student_id = '00000000-0000-4000-8000-0000000000d1';
  if e is null then e := pg_temp.put(sh, 80);
  else update grade_entries set ww_scores = '{80}', pt_scores = '{80}', qa_score = 80 where id = e; end if;
  insert into grade_audit_log (grade_entry_id, grading_sheet_id, changed_by, field_changed, old_value, new_value)
  values (e, sh, 'test@example.com', 'ww_scores[0]', null, '80'),
         (e, sh, 'test@example.com', 'qa_score', null, '80');
  insert into grade_change_requests (grading_sheet_id, grade_entry_id, field_changed, current_value,
                                     proposed_value, reason_category, justification, requested_by, requested_by_email)
  values (sh, e, 'qa_score', '80', '85', 'regrading', 'Re-marked the paper after a review of question 4.',
          '00000000-0000-4000-8000-00000000eeee', 'test@example.com');
  update grading_sheets set archived_at = now(), is_locked = true where id = sh;

  res := force_delete_grading_sheet(sh);

  if exists (select 1 from grading_sheets where id = sh)
     or exists (select 1 from grade_entries where grading_sheet_id = sh)
     or exists (select 1 from grade_change_requests where grading_sheet_id = sh)
     or exists (select 1 from grade_audit_log where grading_sheet_id = sh) then
    raise exception 'force delete left records behind'; end if;
  raise notice 'ARC OK: force delete removes the sheet, entries, change requests and grade history';

  if res->'sheet'->>'id' <> sh::text
     or (res->'counts'->>'entries')::int < 1
     or (res->'counts'->>'change_requests')::int <> 1
     or (res->'counts'->>'grade_audit_log')::int <> 2
     or jsonb_array_length(res->'entries') <> (res->'counts'->>'entries')::int
     or jsonb_array_length(res->'change_requests') <> 1
     or jsonb_array_length(res->'grade_audit_log') <> 2
     or not exists (select 1 from jsonb_array_elements(res->'entries') x
                     where x->>'id' = e::text and (x->>'qa_score')::numeric = 80)
     or (select x->>'proposed_value' from jsonb_array_elements(res->'change_requests') x) <> '85' then
    raise exception 'force delete snapshot wrong: %', res; end if;
  raise notice 'ARC OK: force delete returns the snapshot and counts';

  -- the slot is free again, and the old archived sheet is still there
  if pg_temp.active_count('t3','a') <> 0 or pg_temp.all_count('t3','a') <> 1 then
    raise exception 'force delete touched another sheet'; end if;
  raise notice 'ARC OK: force delete only touches its own sheet';
end $$;

-- ── Best term average (KD #230) ignores archived sheets ───────────────────
-- s: T1/A 60 -> 75, T2/A 100 -> 100. Best = 100 (T2) until T2/A is archived.
do $$
declare sh1 uuid; sh2 uuid; r record;
begin
  select id into sh1 from grading_sheets where term_id = (select v from fx where k='t1')
     and section_id = (select v from fx where k='sec') and subject_id = (select v from fx where k='a') and archived_at is null;
  select id into sh2 from grading_sheets where term_id = (select v from fx where k='t2')
     and section_id = (select v from fx where k='sec') and subject_id = (select v from fx where k='a') and archived_at is null;
  update grading_sheets set ww_totals = '{100}', pt_totals = '{100}', qa_total = 100,
         ww_weight = 0.40, pt_weight = 0.40, qa_weight = 0.20 where id in (sh1, sh2);
  delete from grade_entries where grading_sheet_id in (sh1, sh2);
  perform pg_temp.put(sh1, 60);
  perform pg_temp.put(sh2, 100);
  insert into fx values ('t2a', sh2);

  select * into r from student_best_term_average('00000000-0000-4000-8000-0000000000c1',(select v from fx where k='ay'));
  if r.best is distinct from 100.0 or r.term_number <> 2 then
    raise exception 'fixture: expected 100 / T2, got % / %', r.best, r.term_number; end if;

  update grading_sheets set archived_at = now() where id = sh2;
  select * into r from student_best_term_average('00000000-0000-4000-8000-0000000000c1',(select v from fx where k='ay'));
  if r.best is distinct from 75.0 or r.term_number <> 1 then
    raise exception 'archived T2 sheet still counted: expected 75 / T1, got % / %', r.best, r.term_number; end if;
  raise notice 'ARC OK: best term average ignores an archived T2 sheet';
end $$;

-- ── The cascade (KD #230) never writes an archived Term 4 sheet ───────────
do $$
declare sh4 uuid; sh1 uuid; e4 uuid; r record;
begin
  -- an archived framework sheet for subject B on T4 holding s's best (75)
  update grading_sheets set archived_at = now()
   where term_id = (select v from fx where k='t4') and section_id = (select v from fx where k='sec')
     and subject_id = (select v from fx where k='b') and archived_at is null;
  insert into grading_sheets (term_id, section_id, subject_id, subject_config_id, sheet_type,
                              ww_totals, pt_totals, qa_total, ww_weight, pt_weight, qa_weight)
  values ((select v from fx where k='t4'),(select v from fx where k='sec'),(select v from fx where k='b'),
          (select v from fx where k='cb'),'term4_framework','{100}','{30}',100,0.50,0.20,0.30)
  returning id into sh4;
  insert into grade_entries (grading_sheet_id, section_student_id)
  values (sh4, '00000000-0000-4000-8000-0000000000d1') returning id into e4;
  select * into r from grade_entries where id = e4;
  if r.ww_scores is distinct from '{75.0}'::numeric[] then
    raise exception 'fixture: framework entry not filled with 75, got %', r.ww_scores; end if;
  update grading_sheets set archived_at = now() where id = sh4;

  -- s's T1/A grade moves 60 -> 100: best becomes 100
  select id into sh1 from grading_sheets where term_id = (select v from fx where k='t1')
     and section_id = (select v from fx where k='sec') and subject_id = (select v from fx where k='a') and archived_at is null;
  update grade_entries set ww_scores = '{100}', pt_scores = '{100}', qa_score = 100
   where grading_sheet_id = sh1 and section_student_id = '00000000-0000-4000-8000-0000000000d1';

  select * into r from grade_entries where id = e4;
  if r.ww_scores is distinct from '{75.0}'::numeric[] then
    raise exception 'cascade wrote an archived Term 4 sheet: got %', r.ww_scores; end if;
  raise notice 'ARC OK: the cascade leaves an archived Term 4 sheet alone';
end $$;

-- ── Subjects carry the archive columns (Task 6) ───────────────────────────
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'subjects'
         and column_name in ('archived_at','archived_by')) <> 2 then
    raise exception 'subjects.archived_at / archived_by missing'; end if;
  raise notice 'ARC OK: subjects carry archived_at / archived_by';
end $$;

rollback;
