-- Post-apply sanity check for migration 081 (read-only).

-- (a) MAPEH/FIL/MANDARIN/MT present; MUSIC/ARTS/PE/HE absent.
select code, name, is_examinable
from public.subjects
where code in ('MAPEH','FIL','MANDARIN','MT','MUSIC','ARTS','PE','HE')
order by code;

-- (b) Weights per AY for the 3 new subjects.
select ay.ay_code, subj.code, sc.ww_weight, sc.pt_weight, sc.qa_weight
from public.subject_configs sc
join public.academic_years ay on ay.id = sc.academic_year_id
join public.subjects subj on subj.id = sc.subject_id
where subj.code in ('MAPEH','FIL','MANDARIN')
order by ay.ay_code, subj.code;

-- (c) Report-map: Filipino/Mandarin -> MT, MAPEH -> itself.
select subj.code as subject, rpt.code as reports_to
from public.subject_report_map srm
join public.subjects subj on subj.id = srm.subject_id
join public.subjects rpt on rpt.id = srm.report_subject_id
where rpt.code = 'MT' or subj.code = 'MAPEH'
order by subj.code;

-- (d) AY2025's real MAPEH grades survived the consolidation intact.
select
  count(*) as mapeh_grade_entries,
  count(*) filter (where ge.quarterly_grade is not null) as with_a_grade
from public.grade_entries ge
join public.grading_sheets gs on gs.id = ge.grading_sheet_id
join public.subjects subj on subj.id = gs.subject_id and subj.code = 'MAPEH'
join public.sections sec on sec.id = gs.section_id
join public.academic_years ay on ay.id = sec.academic_year_id
where ay.ay_code = 'AY2025';
-- Expect with_a_grade close to 1090 (the confirmed real-data count).

-- (e) Which AYs still have MT directly offered (should be ONLY AY2025 and
-- possibly other AYs with real historical MT data — everything else
-- should have been stripped).
select ay.ay_code
from public.subject_configs sc
join public.academic_years ay on ay.id = sc.academic_year_id
join public.subjects subj on subj.id = sc.subject_id
where subj.code = 'MT'
order by ay.ay_code;

-- (f) MAPEH/Filipino/Mandarin's rollout status for the CURRENT AY — the
-- migration's own "REQUIRED DEPLOY STEP" note. If this returns 0 for the
-- current operational AY, run
-- select sync_section_subjects_for_ay('<current AY code>');
-- and then generate grading sheets for the affected sections, same as any
-- other new subject rollout.
select ay.ay_code, subj.code, count(distinct ss.section_id) as sections_with_it_offered
from public.section_subjects ss
join public.subject_configs sc on sc.id = ss.subject_config_id
join public.academic_years ay on ay.id = sc.academic_year_id
join public.subjects subj on subj.id = sc.subject_id
where subj.code in ('MAPEH','FIL','MANDARIN')
  and ay.is_current
group by ay.ay_code, subj.code
order by subj.code;
