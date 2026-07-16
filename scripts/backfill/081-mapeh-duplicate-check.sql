-- Read-only. Shows MUSIC/ARTS/PE/HE quarterly_grade side by side per
-- (student, section, term) for AY2025, so we can see whether the 4 values
-- are identical (a duplicated single MAPEH grade — safe to consolidate)
-- or genuinely different (real distinct component grades — must NOT be
-- silently merged).

select
  st.student_number,
  st.first_name || ' ' || st.last_name as student_name,
  sec.name as section,
  t.term_number,
  max(ge.quarterly_grade) filter (where subj.code = 'MUSIC') as music_grade,
  max(ge.quarterly_grade) filter (where subj.code = 'ARTS')  as arts_grade,
  max(ge.quarterly_grade) filter (where subj.code = 'PE')    as pe_grade,
  max(ge.quarterly_grade) filter (where subj.code = 'HE')    as he_grade,
  max(ge.letter_grade) filter (where subj.code = 'MUSIC') as music_letter,
  max(ge.letter_grade) filter (where subj.code = 'ARTS')  as arts_letter,
  max(ge.letter_grade) filter (where subj.code = 'PE')    as pe_letter,
  max(ge.letter_grade) filter (where subj.code = 'HE')    as he_letter
from public.grade_entries ge
join public.grading_sheets gs on gs.id = ge.grading_sheet_id
join public.subjects subj on subj.id = gs.subject_id
join public.sections sec on sec.id = gs.section_id
join public.terms t on t.id = gs.term_id
join public.academic_years ay on ay.id = sec.academic_year_id
join public.section_students s on s.id = ge.section_student_id
join public.students st on st.id = s.student_id
where ay.ay_code = 'AY2025'
  and subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
group by st.student_number, st.first_name, st.last_name, sec.name, t.term_number
order by sec.name, t.term_number, st.student_number
limit 25;

-- Also: a blunt yes/no across the WHOLE dataset — counts how many
-- (student, section, term) groups have all-4-identical vs any-differ.
select
  count(*) filter (
    where music_grade is distinct from arts_grade
       or music_grade is distinct from pe_grade
       or music_grade is distinct from he_grade
  ) as groups_with_differing_values,
  count(*) filter (
    where music_grade is not distinct from arts_grade
      and music_grade is not distinct from pe_grade
      and music_grade is not distinct from he_grade
  ) as groups_all_identical,
  count(*) as total_groups
from (
  select
    ge.section_student_id,
    t.id as term_id,
    max(ge.quarterly_grade) filter (where subj.code = 'MUSIC') as music_grade,
    max(ge.quarterly_grade) filter (where subj.code = 'ARTS')  as arts_grade,
    max(ge.quarterly_grade) filter (where subj.code = 'PE')    as pe_grade,
    max(ge.quarterly_grade) filter (where subj.code = 'HE')    as he_grade
  from public.grade_entries ge
  join public.grading_sheets gs on gs.id = ge.grading_sheet_id
  join public.subjects subj on subj.id = gs.subject_id
  join public.sections sec on sec.id = gs.section_id
  join public.terms t on t.id = gs.term_id
  join public.academic_years ay on ay.id = sec.academic_year_id
  where ay.ay_code = 'AY2025'
    and subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
  group by ge.section_student_id, t.id
) grouped;
