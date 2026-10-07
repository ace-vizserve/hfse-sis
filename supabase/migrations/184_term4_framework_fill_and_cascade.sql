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
