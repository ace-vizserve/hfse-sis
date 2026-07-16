-- Read-only. Shows the 5 (student, section, term) groups where
-- MUSIC/ARTS/PE/HE quarterly_grade did NOT all agree, so we can decide
-- how to resolve them before consolidating into MAPEH.

with grouped as (
  select
    ge.section_student_id,
    t.id as term_id,
    t.term_number,
    sec.name as section,
    max(ge.quarterly_grade) filter (where subj.code = 'MUSIC') as music_grade,
    max(ge.quarterly_grade) filter (where subj.code = 'ARTS')  as arts_grade,
    max(ge.quarterly_grade) filter (where subj.code = 'PE')    as pe_grade,
    max(ge.quarterly_grade) filter (where subj.code = 'HE')    as he_grade,
    max(ge.is_na::int) filter (where subj.code = 'MUSIC') as music_na,
    max(ge.is_na::int) filter (where subj.code = 'ARTS')  as arts_na,
    max(ge.is_na::int) filter (where subj.code = 'PE')    as pe_na,
    max(ge.is_na::int) filter (where subj.code = 'HE')    as he_na
  from public.grade_entries ge
  join public.grading_sheets gs on gs.id = ge.grading_sheet_id
  join public.subjects subj on subj.id = gs.subject_id
  join public.sections sec on sec.id = gs.section_id
  join public.terms t on t.id = gs.term_id
  join public.academic_years ay on ay.id = sec.academic_year_id
  where ay.ay_code = 'AY2025'
    and subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
  group by ge.section_student_id, t.id, t.term_number, sec.name
)
select
  st.student_number,
  st.first_name || ' ' || st.last_name as student_name,
  g.section,
  g.term_number,
  g.music_grade, g.arts_grade, g.pe_grade, g.he_grade,
  g.music_na, g.arts_na, g.pe_na, g.he_na
from grouped g
join public.section_students ss on ss.id = g.section_student_id
join public.students st on st.id = ss.student_id
where music_grade is distinct from arts_grade
   or music_grade is distinct from pe_grade
   or music_grade is distinct from he_grade;
