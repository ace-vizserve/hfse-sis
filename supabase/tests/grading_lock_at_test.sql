-- Grading lock time (migration 186) — behaviour test. Runs on the LOCAL stack
-- only, inside a transaction that is rolled back. Each check prints "GLA OK: …".
--
--   docker cp supabase/tests/grading_lock_at_test.sql supabase_db_hfse-markbook:/tmp/
--   docker exec supabase_db_hfse-markbook psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/grading_lock_at_test.sql
begin;

create temp table fx (k text primary key, v uuid) on commit drop;
grant select on fx to authenticated;

-- An unlocked sheet with entries, and its assigned subject teacher.
insert into fx
select k, v from (
  select gs.id as sheet, gs.term_id as term, ta.teacher_user_id as teacher,
         (select ge.id from grade_entries ge where ge.grading_sheet_id = gs.id
           order by ge.id limit 1) as entry
    from grading_sheets gs
    join teacher_assignments ta
      on ta.section_id = gs.section_id and ta.subject_id = gs.subject_id
     and ta.role = 'subject_teacher'
   where gs.is_locked = false
     and exists (select 1 from grade_entries ge where ge.grading_sheet_id = gs.id)
   order by gs.id limit 1
) s
cross join lateral (values ('sheet', s.sheet), ('term', s.term),
                           ('teacher', s.teacher), ('entry', s.entry)) as x(k, v);

do $$ begin
  if (select count(*) from fx) <> 4 then
    raise exception 'fixture: no unlocked sheet with entries and a subject teacher';
  end if;
end $$;

-- Act as the teacher for auth.uid().
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from fx where k = 'teacher')::text)::text, true);

-- 1. Deadline in the future: the teacher may write.
update terms set grading_lock_at = now() + interval '1 hour'
 where id = (select v from fx where k = 'term');
do $$ begin
  if not public.can_write_grade_entry((select v from fx where k = 'sheet')) then
    raise exception 'expected write allowed before the lock time';
  end if;
  raise notice 'GLA OK: write allowed before the lock time';
end $$;

-- 1b. Same through RLS: the teacher's UPDATE touches the row (so step 4 below
-- is not passing vacuously).
create temp table rls_result (step int, n int) on commit drop;
grant all on rls_result to authenticated;
set local role authenticated;
with u as (
  update grade_entries set qa_score = qa_score
   where id = (select v from fx where k = 'entry')
  returning 1
)
insert into rls_result select 1, count(*) from u;
reset role;
do $$ begin
  if (select n from rls_result where step = 1) <> 1 then
    raise exception 'fixture: RLS refused the teacher before the deadline';
  end if;
  raise notice 'GLA OK: RLS update allowed before the lock time';
end $$;

-- 2. The date column follows the instant (Singapore calendar day).
do $$ declare d date; begin
  select grading_lock_date into d from terms where id = (select v from fx where k = 'term');
  if d is distinct from ((now() + interval '1 hour') at time zone 'Asia/Singapore')::date then
    raise exception 'grading_lock_date not synced: %', d;
  end if;
  raise notice 'GLA OK: grading_lock_date synced from grading_lock_at';
end $$;

-- 3. Deadline one minute ago: refused, though is_locked is still false.
update terms set grading_lock_at = now() - interval '1 minute'
 where id = (select v from fx where k = 'term');
do $$ begin
  if public.can_write_grade_entry((select v from fx where k = 'sheet')) then
    raise exception 'expected write refused after the lock time';
  end if;
  if (select is_locked from grading_sheets where id = (select v from fx where k = 'sheet')) then
    raise exception 'fixture: sheet should still be stored unlocked';
  end if;
  raise notice 'GLA OK: write refused after the lock time (stored flag still unlocked)';
end $$;

-- 4. Through RLS for real: an authenticated UPDATE touches no row.
set local role authenticated;
with u as (
  update grade_entries set qa_score = qa_score
   where id = (select v from fx where k = 'entry')
  returning 1
)
insert into rls_result select 4, count(*) from u;
reset role;
do $$ begin
  if (select n from rls_result where step = 4) <> 0 then
    raise exception 'RLS let a past-deadline write through';
  end if;
  raise notice 'GLA OK: RLS update refused after the lock time';
end $$;

-- 5. A coordinator unlocked the sheet after the deadline: writes reopen.
update grading_sheets set unlocked_at = now()
 where id = (select v from fx where k = 'sheet');
do $$ begin
  if not public.can_write_grade_entry((select v from fx where k = 'sheet')) then
    raise exception 'expected write allowed after an unlock past the deadline';
  end if;
  raise notice 'GLA OK: unlock after the deadline reopens writes';
end $$;

-- 6. An unlock from BEFORE the deadline does not override it.
update grading_sheets set unlocked_at = now() - interval '1 day'
 where id = (select v from fx where k = 'sheet');
do $$ begin
  if public.can_write_grade_entry((select v from fx where k = 'sheet')) then
    raise exception 'an unlock before the deadline must not override it';
  end if;
  raise notice 'GLA OK: an earlier unlock does not override the deadline';
end $$;

-- 7. No deadline at all: writes allowed.
update terms set grading_lock_at = null
 where id = (select v from fx where k = 'term');
do $$ begin
  if not public.can_write_grade_entry((select v from fx where k = 'sheet')) then
    raise exception 'expected write allowed with no deadline';
  end if;
  if (select grading_lock_date from terms where id = (select v from fx where k = 'term')) is not null then
    raise exception 'clearing grading_lock_at should clear grading_lock_date';
  end if;
  raise notice 'GLA OK: no deadline, writes allowed and date cleared';
end $$;

-- 8. A writer that sets only the old date gets 23:59 Singapore time.
update terms set grading_lock_date = date '2026-03-20'
 where id = (select v from fx where k = 'term');
do $$ begin
  if (select grading_lock_at from terms where id = (select v from fx where k = 'term'))
     is distinct from timestamptz '2026-03-20 23:59:00+08' then
    raise exception 'date-only write did not set 23:59 SGT';
  end if;
  raise notice 'GLA OK: date-only write becomes 23:59 Singapore time';
end $$;

rollback;
