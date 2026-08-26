-- AY2026 — remove the three PE assignments that point at the wrong PE subject.
--
-- WHY THIS EXISTS
--
-- The catalogue holds PE under two codes because the two curricula name it
-- differently: `PEH` ("Physical Education and Health") for the Global classes,
-- and `PESTD` ("Physical Education"), created 2026-07-16, for the Standard
-- ones. Both are PE and the split is deliberate.
--
-- Mr Hanafi teaches PE to the whole secondary school and his deployment
-- workbook writes "Physical Education and Health" in every cell, so the
-- importer's flat name-to-code map landed all five classes on `PEH`. Right for
-- S1 Discipline 1 and S2 Integrity 1. Wrong for S2 Integrity 2, S3 Consistency
-- and S4 Excellence — and wrong SILENTLY: each row inserted cleanly against a
-- subject the class does not run, while the PE mark sheet it should have
-- claimed sat unstaffed. Nothing reported it; it was found by auditing sheets
-- that had no teacher.
--
-- The generator now reads the section's own sheets and re-points the code
-- (`EQUIVALENT_SUBJECT_CODES`), so a re-run writes `PESTD` for those three.
-- But `apply.sql` ends `on conflict do nothing` and therefore DELETES NOTHING,
-- so the three stale `PEH` rows survive a re-run untouched. Hence this file.
--
-- ⚠ ORDER MATTERS ONLY IN ONE DIRECTION: run this BEFORE or AFTER the
-- regenerated apply.sql, either is fine — they touch different rows. What is
-- not fine is running neither.

begin;

-- 1. Look first. Expect exactly 3 rows: Mr Hanafi on S2 Integrity 2,
--    S3 Consistency and S4 Excellence.
select l.code as level, s.name as section, u.email as teacher, sub.code as subject
from public.teacher_assignments ta
join public.sections s on s.id = ta.section_id
join public.levels l on l.id = s.level_id
join public.academic_years ay on ay.id = s.academic_year_id
join public.subjects sub on sub.id = ta.subject_id
join auth.users u on u.id = ta.teacher_user_id
where ay.ay_code = 'AY2026'
  and sub.code = 'PEH'
  and not exists (
    select 1
    from public.grading_sheets gs
    join public.terms t on t.id = gs.term_id
    where gs.section_id = ta.section_id
      and gs.subject_id = ta.subject_id
      and t.academic_year_id = ay.id
  )
order by l.code, s.name;

-- 2. Delete them.
--
-- ⚠ THE `not exists` GUARD IS THE WHOLE SAFETY OF THIS STATEMENT, not a
-- refinement of it. It deletes a PE assignment only where the class has no PE
-- sheet under that code, so the legitimate `PEH` rows on S1 Discipline 1 and
-- S2 Integrity 1 — both of which DO hold a `PEH` sheet — can never match.
-- Without it this reads as "delete every PEH assignment", which is five rows.
--
-- Scoped to `PEH` deliberately, rather than "any assignment with no sheet":
-- `PMPD` (Pastoral Ministry and Personal Development) has no grading sheet in
-- ANY year because it is taught and not graded, so its five assignments are
-- correct and must survive.
delete from public.teacher_assignments ta
using public.sections s, public.academic_years ay, public.subjects sub
where ta.section_id = s.id
  and s.academic_year_id = ay.id
  and ay.ay_code = 'AY2026'
  and ta.subject_id = sub.id
  and sub.code = 'PEH'
  and ta.role = 'subject_teacher'
  and not exists (
    select 1
    from public.grading_sheets gs
    join public.terms t on t.id = gs.term_id
    where gs.section_id = ta.section_id
      and gs.subject_id = ta.subject_id
      and t.academic_year_id = ay.id
  );

-- 3. Confirm. Expect 2 rows — S1 Discipline 1 and S2 Integrity 1, the two
--    Global classes that genuinely run PEH.
select l.code as level, s.name as section, u.email as teacher
from public.teacher_assignments ta
join public.sections s on s.id = ta.section_id
join public.levels l on l.id = s.level_id
join public.academic_years ay on ay.id = s.academic_year_id
join public.subjects sub on sub.id = ta.subject_id
join auth.users u on u.id = ta.teacher_user_id
where ay.ay_code = 'AY2026' and sub.code = 'PEH'
order by l.code, s.name;

commit;
