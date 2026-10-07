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

-- AUDIT. grade_entries_audit() (migration 165) copied verbatim, with ONE change:
-- the ww_scores slot diff is skipped on a term4_framework sheet. That slot is
-- system-owned; when a signed-in teacher saves a T1–T3 score the cascade moves
-- it on sheets they never touched (possibly locked), and the audit trigger
-- would blame them. The fill trigger already writes a grade_audit_log row for
-- every change to it.
create or replace function public.grade_entries_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text;
  v_role    text;
  v_i       int;
  v_old     numeric;
  v_new     numeric;
  v_len     int;
  -- The row as it was. All null on an insert: every value is "from blank".
  v_old_ww  numeric[];
  v_old_pt  numeric[];
  v_old_qa  numeric;
  v_old_lg  text;
  v_old_na  boolean := false;
  v_t4f     boolean;
begin
  if auth.uid() is null then
    return null;                      -- service role: the route owns the trail
  end if;

  select (gs.sheet_type = 'term4_framework') into v_t4f
    from public.grading_sheets gs where gs.id = new.grading_sheet_id;
  v_t4f := coalesce(v_t4f, false);

  if tg_op = 'UPDATE' then
    v_old_ww := old.ww_scores;
    v_old_pt := old.pt_scores;
    v_old_qa := old.qa_score;
    v_old_lg := old.letter_grade;
    v_old_na := coalesce(old.is_na, false);
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();
  v_role := public.current_user_role();

  -- ww_scores / pt_scores, slot by slot.
  v_len := greatest(
    coalesce(array_length(v_old_ww, 1), 0),
    coalesce(array_length(new.ww_scores, 1), 0)
  );
  for v_i in 1 .. v_len loop
    exit when v_t4f;                  -- system-owned slot on a Term 4 framework sheet
    v_old := v_old_ww[v_i];
    v_new := (new.ww_scores)[v_i];
    if v_old is distinct from v_new then
      perform public.log_grade_entry_change(
        new.id, new.grading_sheet_id,
        'ww_scores[' || (v_i - 1) || ']',
        case when v_old is null then null else trim_scale(v_old)::text end,
        case when v_new is null then null else trim_scale(v_new)::text end,
        auth.uid(), v_email, v_role
      );
    end if;
  end loop;

  v_len := greatest(
    coalesce(array_length(v_old_pt, 1), 0),
    coalesce(array_length(new.pt_scores, 1), 0)
  );
  for v_i in 1 .. v_len loop
    v_old := v_old_pt[v_i];
    v_new := (new.pt_scores)[v_i];
    if v_old is distinct from v_new then
      perform public.log_grade_entry_change(
        new.id, new.grading_sheet_id,
        'pt_scores[' || (v_i - 1) || ']',
        case when v_old is null then null else trim_scale(v_old)::text end,
        case when v_new is null then null else trim_scale(v_new)::text end,
        auth.uid(), v_email, v_role
      );
    end if;
  end loop;

  if v_old_qa is distinct from new.qa_score then
    perform public.log_grade_entry_change(
      new.id, new.grading_sheet_id, 'qa_score',
      case when v_old_qa is null then null else trim_scale(v_old_qa)::text end,
      case when new.qa_score is null then null else trim_scale(new.qa_score)::text end,
      auth.uid(), v_email, v_role
    );
  end if;

  if v_old_lg is distinct from new.letter_grade then
    perform public.log_grade_entry_change(
      new.id, new.grading_sheet_id, 'letter_grade',
      v_old_lg, new.letter_grade,
      auth.uid(), v_email, v_role
    );
  end if;

  -- An insert starts from `false`, the column default, so a new row marked
  -- N/A is logged and an ordinary new row is not.
  if v_old_na is distinct from coalesce(new.is_na, false) then
    perform public.log_grade_entry_change(
      new.id, new.grading_sheet_id, 'is_na',
      lower(v_old_na::text),
      lower(coalesce(new.is_na, false)::text),
      auth.uid(), v_email, v_role
    );
  end if;

  return null;
end;
$$;

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
  v_type    text;
begin
  if tg_op = 'UPDATE'
     and new.quarterly_grade is not distinct from old.quarterly_grade
     and new.is_na = old.is_na then
    return null;
  end if;
  -- Bare seeding rows carry no grade; nothing to cascade.
  if tg_op = 'INSERT' and new.quarterly_grade is null then
    return null;
  end if;

  select t.term_number, t.academic_year_id, gs.sheet_type into v_term, v_ay, v_type
    from grading_sheets gs join terms t on t.id = gs.term_id
   where gs.id = new.grading_sheet_id;
  -- Recursion guard: a term4_framework row never cascades (nothing in the DB
  -- ties that sheet type to term 4).
  if v_type = 'term4_framework' then
    return null;
  end if;
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
     and t.term_number = 4
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
