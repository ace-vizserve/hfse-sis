-- Post-apply verification for teacher-assignments-apply.sql (AY2026).
--
-- Read-only. Run after the import and read all four results — the last one is
-- the point of the whole exercise.

-- 1. What landed, by role.
--    Expected: 18 form_adviser, 97 subject_teacher, 0 co_* (none imported yet).
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
--      P1 Respect       (a test section, correctly untouched)
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
