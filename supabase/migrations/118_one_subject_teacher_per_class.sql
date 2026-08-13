-- 118_one_subject_teacher_per_class.sql
--
-- One subject teacher per (section, subject). Closes a gap that has been open
-- since migration 003.
--
-- WHAT WENT WRONG. 003's header states the rule plainly:
--
--     subject_teacher — one per (section, subject) pair, enters grades for
--                       that grading sheet
--
-- but the index it then created is
--
--     unique (teacher_user_id, section_id, subject_id) where role = 'subject_teacher'
--
-- which enforces something else entirely: the same teacher cannot be listed
-- twice for one subject in one class. Two DIFFERENT teachers could both hold
-- P1 Respect's Filipino, and did — that is how this was found (Mr Ace,
-- 2026-08-13, on the section Teachers tab).
--
-- WHY THE STATED RULE IS THE RIGHT ONE. A grading sheet has one subject
-- teacher, resolved live from this table (KD #158). With two rows there is no
-- answer to "whose name is on this mark sheet", and nothing anywhere picks a
-- winner — the sheet, the masterfile and the report card would each resolve it
-- by whatever order the rows came back in.
--
-- The adviser rule was always correct: `teacher_assignments_form_adviser_unique`
-- is on `(section_id)` alone, so one class has one adviser regardless of who.
-- This migration makes the subject rule its exact counterpart.
--
-- ── THIS MIGRATION ABORTS IF THE DATA VIOLATES THE RULE ────────────────────
--
-- Deliberately. Deleting one of two teachers is a staffing decision, not a
-- migration's call — the wrong one removed takes a teacher's access to a class
-- they are actually teaching. So this reports exactly which classes are
-- doubled up and stops. Remove the extra teacher on each from the class's
-- Teachers tab, then re-run.
--
-- Idempotent — safe to re-run once the data is clean.

do $$
declare
  v_conflicts text;
begin
  select string_agg(line, e'\n' order by line) into v_conflicts
  from (
    select
      '  · ' || coalesce(lv.code || ' ', '') || sec.name ||
      ' — ' || sub.name || ' (' || count(*) || ' teachers)' as line
    from public.teacher_assignments ta
    join public.sections sec on sec.id = ta.section_id
    join public.subjects sub on sub.id = ta.subject_id
    left join public.levels lv on lv.id = sec.level_id
    where ta.role = 'subject_teacher'
    group by lv.code, sec.name, sub.name, ta.section_id, ta.subject_id
    having count(*) > 1
  ) x;

  if v_conflicts is not null then
    raise exception
      'Some classes have more than one teacher for the same subject. Remove the extra teacher on each from the class''s Teachers tab, then run this again:%s%s',
      e'\n', v_conflicts;
  end if;
end $$;

-- The rule as 003 always described it: one teacher holds a subject in a class.
create unique index if not exists teacher_assignments_one_subject_teacher_per_class
  on public.teacher_assignments (section_id, subject_id)
  where role = 'subject_teacher';

comment on index public.teacher_assignments_one_subject_teacher_per_class is
  'One subject teacher per (section, subject) — the counterpart of teacher_assignments_form_adviser_unique, which allows one adviser per section. A grading sheet resolves its teacher live from this table (KD #158) and has room for exactly one name.';

-- The old index is now redundant: a pair that is unique on (section, subject)
-- cannot repeat a teacher within it. Dropped rather than left in place, so the
-- next person reading this table finds one rule and not two overlapping ones.
drop index if exists public.teacher_assignments_subject_teacher_unique;
