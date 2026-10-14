-- Migration 187 — Term 4 framework: the 50% is the best T1–T3 grade IN THAT
-- SUBJECT, and letter-graded subjects are included (KD #230 update).
--
-- The school's own template ("Sec 4 Grading Sheets - Term 4.xlsx", Mr Ace,
-- 2026-10-14) computes, per subject tab:
--   F = MAX(T1, T2, T3)            -- that subject's own term grades
--   L = 0.5·F + ROUND(0.2·(H/30·100), 2) + 0.3·J
--   M = the usual transmutation of L
--   N = A / B / C / IP from M      -- CA and PE tabs only
-- Migration 183 took the best of the student's whole-term averages over
-- examinable subjects instead (the same value in every subject) — that was a
-- misreading, replaced here. Letter subjects already carry a numeric quarterly
-- grade and derive their letter from it (KD #104, numericToLetter), so they
-- get the same sheet.
--
-- The workbook's 2-decimal rounding of the 20% part never changes a
-- transmuted grade (band edges sit on multiples of 0.1), so the grade formula
-- stays untouched (Hard Rule #1).
--
-- Changes:
--   1. student_subject_term_grades + student_best_subject_term(student, ay,
--      subject) replace student_best_term_average(student, ay);
--      best_subject_terms_for_sheet (best + T1 / T2 / T3, for the grid's
--      template columns) replaces best_term_averages_for_sheet.
--   2. The fill trigger reads the sheet's own subject.
--   3. The cascade touches only the same subject's framework rows.
--   4. switch_grading_sheet_type no longer refuses a letter-graded subject.
--   5. Every existing framework row is refilled (audited by the fill trigger).

begin;

-- 1. The term grades and the best, per subject ------------------------------
-- The student's T1–T3 quarterly grades in ONE subject (the template's T1 / T2
-- / T3 columns); N/A terms skipped (the proration for late enrollees, as MAX
-- skips a blank cell in the workbook). A term counts once: a student who moved
-- class has a row in both sections and the non-withdrawn enrolment's row wins.
drop function if exists public.student_subject_term_grades(uuid, uuid, uuid);
create function public.student_subject_term_grades(
  p_student_id       uuid,
  p_academic_year_id uuid,
  p_subject_id       uuid
)
returns table (term_number smallint, grade numeric, grading_sheet_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (t.term_number)
         t.term_number, ge.quarterly_grade::numeric, gs.id
    from grade_entries ge
    join grading_sheets gs   on gs.id = ge.grading_sheet_id
    join terms t             on t.id = gs.term_id
    join section_students ss on ss.id = ge.section_student_id
   where ss.student_id = p_student_id
     and t.academic_year_id = p_academic_year_id
     and gs.subject_id = p_subject_id
     and t.term_number between 1 and 3
     -- a framework sheet is never a source, whatever term it sits on
     and gs.sheet_type = 'standard'
     and not ge.is_na
     and ge.quarterly_grade is not null
   order by t.term_number,
            (ss.enrollment_status = 'withdrawn'), ge.updated_at desc;
$$;

-- The template's "Best Overall": the highest of those. Ties go to the later term.
create or replace function public.student_best_subject_term(
  p_student_id       uuid,
  p_academic_year_id uuid,
  p_subject_id       uuid
)
returns table (best numeric, term_number smallint)
language sql
stable
security definer
set search_path = public
as $$
  select g.grade as best, g.term_number
    from public.student_subject_term_grades(p_student_id, p_academic_year_id, p_subject_id) g
   order by 1 desc, g.term_number desc
   limit 1;
$$;

-- For the grid: each entry's T1 / T2 / T3 grades and the sheet each came from
-- (the grid links to it), the best and its term.
drop function if exists public.best_subject_terms_for_sheet(uuid);
create function public.best_subject_terms_for_sheet(p_sheet_id uuid)
returns table (section_student_id uuid, best numeric, term_number smallint,
               t1 numeric, t2 numeric, t3 numeric,
               t1_sheet_id uuid, t2_sheet_id uuid, t3_sheet_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select ge.section_student_id, b.best, b.term_number, g.t1, g.t2, g.t3,
         g.t1_sheet_id, g.t2_sheet_id, g.t3_sheet_id
    from grade_entries ge
    join grading_sheets gs   on gs.id = ge.grading_sheet_id
    join terms t             on t.id = gs.term_id
    join section_students ss on ss.id = ge.section_student_id
    left join lateral public.student_best_subject_term(
      ss.student_id, t.academic_year_id, gs.subject_id) b on true
    left join lateral (
      select max(x.grade) filter (where x.term_number = 1) as t1,
             max(x.grade) filter (where x.term_number = 2) as t2,
             max(x.grade) filter (where x.term_number = 3) as t3,
             (array_agg(x.grading_sheet_id) filter (where x.term_number = 1))[1] as t1_sheet_id,
             (array_agg(x.grading_sheet_id) filter (where x.term_number = 2))[1] as t2_sheet_id,
             (array_agg(x.grading_sheet_id) filter (where x.term_number = 3))[1] as t3_sheet_id
        from public.student_subject_term_grades(
          ss.student_id, t.academic_year_id, gs.subject_id) x
    ) g on true
   where ge.grading_sheet_id = p_sheet_id;
$$;

revoke all on function public.student_subject_term_grades(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.student_best_subject_term(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.best_subject_terms_for_sheet(uuid) from public, anon, authenticated;
grant execute on function public.student_subject_term_grades(uuid, uuid, uuid) to service_role;
grant execute on function public.student_best_subject_term(uuid, uuid, uuid) to service_role;
grant execute on function public.best_subject_terms_for_sheet(uuid) to service_role;

-- 2. Fill: the sheet's own subject --------------------------------------------
create or replace function public.grade_entries_best_term_fill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type    text;
  v_ay      uuid;
  v_subject uuid;
  v_student uuid;
  v_best    numeric;
  v_term    smallint;
  v_old     numeric;
begin
  select gs.sheet_type, t.academic_year_id, gs.subject_id into v_type, v_ay, v_subject
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
    from public.student_best_subject_term(v_student, v_ay, v_subject) b;

  v_old := case when tg_op = 'UPDATE' then old.ww_scores[1] end;

  if new.ww_scores[1] is not null
     and new.ww_scores[1] is distinct from v_best
     and new.ww_scores[1] is distinct from v_old then
    raise exception 'The best Term 1–3 grade is filled in by the system.'
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
       'Best Term 1–3 grade in this subject'
         || coalesce(' (now T' || v_term || ')', ''));
  end if;

  return new;
end;
$$;

-- 3. Cascade: only the same subject's framework rows ------------------------
create or replace function public.grade_entries_best_term_cascade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_term    smallint;
  v_ay      uuid;
  v_subject uuid;
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

  select t.term_number, t.academic_year_id, gs.sheet_type, gs.subject_id
    into v_term, v_ay, v_type, v_subject
    from grading_sheets gs join terms t on t.id = gs.term_id
   where gs.id = new.grading_sheet_id;
  -- Recursion guard: a term4_framework row never cascades.
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
     and gs.subject_id = v_subject
     and t.term_number = 4
     and t.academic_year_id = v_ay
     and ss.id = ge.section_student_id
     and ss.student_id = v_student;

  return null;
end;
$$;

-- 4. Switch: letter-graded subjects allowed ---------------------------------
-- Migration 185's function verbatim, minus the is_examinable refusal.
create or replace function public.switch_grading_sheet_type(
  p_sheet_id   uuid,
  p_sheet_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sheet   record;
  v_qa_max  numeric;
  v_cleared jsonb;
  v_count   int;
  v_stuck   uuid[];
begin
  if p_sheet_type is null or p_sheet_type not in ('standard', 'term4_framework') then
    raise exception 'Unknown sheet type.' using errcode = 'HFT4F';
  end if;

  select gs.id, gs.sheet_type, gs.is_locked, gs.subject_config_id, gs.slot_labels,
         t.term_number
    into v_sheet
    from grading_sheets gs
    join terms t on t.id = gs.term_id
   where gs.id = p_sheet_id
   for update of gs;

  if not found then
    raise exception 'Grading sheet not found.' using errcode = 'HFT4F';
  end if;
  if v_sheet.sheet_type = p_sheet_type then
    raise exception 'The sheet is already that type.' using errcode = 'HFT4F';
  end if;
  if v_sheet.is_locked then
    raise exception 'Unlock the sheet before switching its type.' using errcode = 'HFT4F';
  end if;
  if p_sheet_type = 'term4_framework' and v_sheet.term_number is distinct from 4 then
    raise exception 'A Term 4 framework sheet is only for Term 4.' using errcode = 'HFT4F';
  end if;

  -- 2. What is about to be cleared — every row the switch changes: a score,
  -- a derived figure (an imported or stale grade the reset will null), or an
  -- excusal. Nothing goes without a record.
  select coalesce(jsonb_agg(jsonb_build_object(
           'entry_id',           ge.id,
           'section_student_id', ge.section_student_id,
           'ww_scores',          ge.ww_scores,
           'pt_scores',          ge.pt_scores,
           'qa_score',           ge.qa_score,
           'ww_excused',         ge.ww_excused,
           'pt_excused',         ge.pt_excused,
           'initial_grade',      ge.initial_grade,
           'quarterly_grade',    ge.quarterly_grade,
           'letter_grade',       ge.letter_grade
         ) order by ge.section_student_id), '[]'::jsonb),
         count(*)
    into v_cleared, v_count
    from grade_entries ge
   where ge.grading_sheet_id = p_sheet_id
     and (   ge.qa_score is not null
          or exists (select 1 from unnest(coalesce(ge.ww_scores, '{}')) v where v is not null)
          or exists (select 1 from unnest(coalesce(ge.pt_scores, '{}')) v where v is not null)
          or ge.ww_ps is not null or ge.pt_ps is not null or ge.qa_ps is not null
          or ge.initial_grade is not null or ge.quarterly_grade is not null
          or coalesce(ge.ww_excused, '{}') <> '{}' or coalesce(ge.pt_excused, '{}') <> '{}');

  -- 3. The new shape, in one statement. Slot labels described the assessments
  -- being cleared, so they go too (kept in the audit row by the route).
  if p_sheet_type = 'term4_framework' then
    update grading_sheets
       set sheet_type  = 'term4_framework',
           ww_totals   = '{100}',
           pt_totals   = '{30}',
           qa_total    = 100,
           ww_weight   = 0.50,
           pt_weight   = 0.20,
           qa_weight   = 0.30,
           slot_labels = null,
           updated_at  = now()
     where id = p_sheet_id;
  else
    select sc.qa_max into v_qa_max from subject_configs sc where sc.id = v_sheet.subject_config_id;
    update grading_sheets
       set sheet_type  = 'standard',
           ww_totals   = '{10,10,10}',
           pt_totals   = '{10,10,10}',
           qa_total    = coalesce(v_qa_max, 30),
           ww_weight   = null,
           pt_weight   = null,
           qa_weight   = null,
           slot_labels = null,
           updated_at  = now()
     where id = p_sheet_id;
  end if;

  -- Rows that hold no score but still carry a derived figure: the derive
  -- trigger would keep those figures through the reset (see 185's header).
  select coalesce(array_agg(ge.id), '{}') into v_stuck
    from grade_entries ge
   where ge.grading_sheet_id = p_sheet_id
     and ge.qa_score is null
     and not exists (select 1 from unnest(coalesce(ge.ww_scores, '{}')) v where v is not null)
     and not exists (select 1 from unnest(coalesce(ge.pt_scores, '{}')) v where v is not null)
     and (   ge.ww_ps is not null or ge.pt_ps is not null or ge.qa_ps is not null
          or ge.initial_grade is not null or ge.quarterly_grade is not null);

  -- 4. Every entry back to blank. is_na and letter_grade stay. The stuck rows
  -- hold an exam score of 0 for a moment (so the grade is computed) …
  update grade_entries
     set ww_scores  = '{}',
         pt_scores  = '{}',
         qa_score   = case when id = any(v_stuck) then 0 end,
         ww_excused = '{}',
         pt_excused = '{}'
   where grading_sheet_id = p_sheet_id;

  -- 5. … then blank again (the old row held a score → recomputed → NULL).
  if array_length(v_stuck, 1) > 0 then
    update grade_entries set qa_score = null where id = any(v_stuck);
  end if;

  return jsonb_build_object(
    'cleared',       v_cleared,
    'cleared_count', v_count,
    'slot_labels',   v_sheet.slot_labels,
    'from',          v_sheet.sheet_type,
    'to',            p_sheet_type
  );
end;
$$;

revoke all on function public.switch_grading_sheet_type(uuid, text) from public, anon, authenticated;
grant execute on function public.switch_grading_sheet_type(uuid, text) to service_role;

-- 5. Refill every existing framework row ------------------------------------
-- Re-sending the stored value is accepted by the fill trigger, which then
-- writes the per-subject best (with a grade_audit_log row when it moves) and
-- the derive trigger recomputes the grade. Locked sheets included, as the
-- cascade always has.
update grade_entries ge
   set updated_at = now()
  from grading_sheets gs
 where gs.id = ge.grading_sheet_id
   and gs.sheet_type = 'term4_framework';

drop function if exists public.best_term_averages_for_sheet(uuid);
drop function if exists public.student_best_term_average(uuid, uuid);

commit;
