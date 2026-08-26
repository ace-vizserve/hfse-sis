-- Post-apply verification for teacher-assignments-apply.sql (AY2026).
--
-- Read-only. Run after the import and read all four results — the last one is
-- the point of the whole exercise.
--
-- ⚠ RUN `teacher-assignments-pe-cleanup.sql` TOO. It is a separate file because
-- apply.sql only ever adds; the three PE rows that pointed at the wrong PE
-- subject can only be removed by a delete. Verified final state 2026-08-27:
-- 126 rows, 125 grading sheets, 102 staffed, 23 unstaffed — and every one of
-- the 23 is accounted for (8 Cambridge collision, 4 Mandarin + 2 Mother Tongue
-- + 3 shared subjects + 1 relief English awaiting Mr Hanafi, 3 on the dead
-- P1 Respect section, 1 stray Christian Living sheet, 1 Humanities). The only
-- assignments without a matching sheet are the 5 PMPD rows, which is correct.

-- Regenerated 2026-08-27 after the KD #194 parser fix. The 2026-08-26 run put
-- 114 rows in (18 advisers, 96 subject teachers) — its file listed 115, but two
-- of its lines were the SAME P6 Grit STAR row under two spellings and `on
-- conflict do nothing` absorbed one. The re-run adds the 9 subjects Secondary
-- One Discipline 1 Global lost, and removes nothing.

-- 1. What landed, by role.
--    ⚠ THIS QUERY COUNTS MORE ROWS THAN THE IMPORT WROTE, and that is correct.
--    Actual after the 2026-08-27 apply: 19 form_adviser, 107 subject_teacher,
--    126 total. The import wrote 123. The other THREE are the pre-existing test
--    assignments AY2026 held before any of this — all of them on P1 Respect,
--    advised by `formclass@demo.com`. Subtract that section and the figure is
--    18 + 105 = 123, which is the header of apply.sql.
--    0 co_adviser / co_teacher: migration 124's roles exist and nothing uses
--    them yet, because every shared class is still waiting on Mr Hanafi.
select ta.role, count(*) as rows
from public.teacher_assignments ta
join public.sections s on s.id = ta.section_id
join public.academic_years ay on ay.id = s.academic_year_id
where ay.ay_code = 'AY2026'
group by ta.role
order by ta.role;

-- 2. Every AY2026 section and whether it now has an adviser.
--    Expected: 18 named, 3 without —
--      S1 Discipline 2  (two workbook classes collide; Cambridge question open)
--      S4 Excellence    (workbook names two advisers; Mr Hanafi to answer)
--      P1 Respect       (2 students, 0 of them active — an empty leftover, not
--                        a class Mr Hanafi forgot. Checked 2026-08-27; nothing
--                        to ask him. ⚠ S1 Discipline 2 is the opposite case:
--                        16 students, 14 active, so it is plainly running.)
select
  l.code as level,
  s.name as section,
  coalesce(u.email, '— none —') as adviser
from public.sections s
join public.levels l on l.id = s.level_id
join public.academic_years ay on ay.id = s.academic_year_id
left join public.teacher_assignments ta
  on ta.section_id = s.id and ta.role = 'form_adviser'
left join auth.users u on u.id = ta.teacher_user_id
where ay.ay_code = 'AY2026'
order by l.code, s.name;

-- 3. Subject teachers per section, so a thinly-staffed class is visible.
select
  l.code as level,
  s.name as section,
  count(ta.id) as subject_teachers
from public.sections s
join public.levels l on l.id = s.level_id
join public.academic_years ay on ay.id = s.academic_year_id
left join public.teacher_assignments ta
  on ta.section_id = s.id and ta.role in ('subject_teacher', 'co_teacher')
where ay.ay_code = 'AY2026'
group by l.code, s.name
order by count(ta.id), l.code, s.name;

-- 4. ⚠ THE ONE THAT MATTERS: report-card publishing is gated on a section
--    having a form adviser. Before this import AY2026 had ZERO, school-wide.
--    Anything listed here is still blocked.
select l.code as level, s.name as section
from public.sections s
join public.levels l on l.id = s.level_id
join public.academic_years ay on ay.id = s.academic_year_id
where ay.ay_code = 'AY2026'
  and not exists (
    select 1 from public.teacher_assignments ta
    where ta.section_id = s.id and ta.role = 'form_adviser'
  )
order by l.code, s.name;
