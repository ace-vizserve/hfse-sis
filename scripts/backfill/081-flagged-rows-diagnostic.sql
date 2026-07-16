-- Diagnostic for migration 081's abort — read-only, no writes.
-- Characterizes the 5049 flagged grade_entries rows under
-- MUSIC/ARTS/PE/HE: which AY(s) they belong to, and whether any live in
-- an AY other than AY2025 (which would change the fix).

select
  ay.ay_code,
  subj.code as subject_code,
  count(*) as flagged_rows,
  count(*) filter (
    where coalesce(array_length(array_remove(ge.ww_scores, null), 1), 0) > 0
       or coalesce(array_length(array_remove(ge.pt_scores, null), 1), 0) > 0
       or ge.qa_score is not null
       or ge.quarterly_grade is not null
       or ge.letter_grade is not null
  ) as rows_with_real_scores,
  count(*) filter (
    where exists (
      select 1 from public.grade_audit_log gal
      where gal.grading_sheet_id = gs.id
    )
  ) as sheets_with_audit_history
from public.grade_entries ge
join public.grading_sheets gs on gs.id = ge.grading_sheet_id
join public.subjects subj on subj.id = gs.subject_id
join public.sections sec on sec.id = gs.section_id
join public.academic_years ay on ay.id = sec.academic_year_id
where subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
group by ay.ay_code, subj.code
order by ay.ay_code, subj.code;
