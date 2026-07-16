-- MAPEH consolidation — PREVIEW (read-only, no writes)
--
-- MUSIC/ARTS/PE/HE were mechanically split from one real "MAPEH" grade
-- during the AY2025 masterfile backfill, because the catalog only offered
-- 4 separate subjects at the time (the real source sheets are literally
-- one combined "MAPEH - <section>" workbook tab per section — see
-- grade-skill-result/primary/T1/AY2025-T1-grading-sheet-mapping.csv,
-- where every "MAPEH -" sheet is marked mapping_confidence=unmapped,
-- i.e. it never went through the WW/PT/QA patch scripts at all). Live
-- query confirmed 1085 of 1090 (section_student, term) groups have the
-- IDENTICAL quarterly_grade across all four subjects; the remaining 5
-- have ARTS/PE/HE agreeing and only MUSIC differing (a MUSIC-specific
-- import slip) — resolved via majority vote (mode()), confirmed with the
-- user. This script consolidates that real data forward into MAPEH BEFORE
-- migration 081 retires the four old subjects, so the migration's
-- existing (already-reviewed, unmodified) zero-real-content assertion
-- passes honestly instead of destroying information.
--
-- This is deliberately NOT scoped to AY2025 only — it operates on
-- whichever AY(s) currently have real MUSIC/ARTS/PE/HE grade content
-- (confirmed live: AY2025 [production] + AY9998/AY9999 [seeded test
-- AYs] — the seeded rows are stale leftovers from before the seeder was
-- corrected to stop generating these subjects, and consolidating them the
-- same way as AY2025 is harmless and simpler than special-casing test AYs
-- out).
--
-- RUN THIS FIRST, eyeball the counts, THEN run
-- ay2025-mapeh-consolidation-apply.sql, THEN apply migration 081.

-- (a) How many (section_student, term) groups will get a new MAPEH row,
--     broken down by AY.
with old_entries as (
  select
    ay.ay_code, gs.term_id, gs.section_id, ge.section_student_id,
    ge.quarterly_grade, ge.is_na
  from public.grade_entries ge
  join public.grading_sheets gs on gs.id = ge.grading_sheet_id
  join public.subjects subj on subj.id = gs.subject_id
  join public.sections sec on sec.id = gs.section_id
  join public.academic_years ay on ay.id = sec.academic_year_id
  where subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
),
consolidated as (
  select
    ay_code, term_id, section_id, section_student_id,
    mode() within group (order by quarterly_grade)
      filter (where quarterly_grade is not null) as consolidated_grade,
    bool_and(is_na) as all_na,
    count(*) filter (where quarterly_grade is not null) as source_count,
    count(distinct quarterly_grade) filter (where quarterly_grade is not null) as distinct_values
  from old_entries
  group by ay_code, term_id, section_id, section_student_id
)
select
  ay_code,
  count(*) as groups_total,
  count(*) filter (where consolidated_grade is not null) as groups_with_a_grade,
  count(*) filter (where consolidated_grade is null and all_na) as groups_all_na,
  count(*) filter (where consolidated_grade is null and not all_na) as groups_blank_placeholder,
  count(*) filter (where distinct_values > 1) as groups_needed_majority_vote
from consolidated
group by ay_code
order by ay_code;

-- (b) The exact groups where majority vote was needed (sanity — should be
--     the same 5 AY2025 rows already reviewed, unless a test AY also has
--     disagreement).
with old_entries as (
  select
    ay.ay_code, gs.term_id, gs.section_id, ge.section_student_id,
    ge.quarterly_grade
  from public.grade_entries ge
  join public.grading_sheets gs on gs.id = ge.grading_sheet_id
  join public.subjects subj on subj.id = gs.subject_id
  join public.sections sec on sec.id = gs.section_id
  join public.academic_years ay on ay.id = sec.academic_year_id
  where subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
)
select
  ay_code, section_id, section_student_id, term_id,
  mode() within group (order by quarterly_grade) filter (where quarterly_grade is not null) as resolved_grade,
  array_agg(distinct quarterly_grade) filter (where quarterly_grade is not null) as all_distinct_values
from old_entries
group by ay_code, section_id, section_student_id, term_id
having count(distinct quarterly_grade) filter (where quarterly_grade is not null) > 1;

-- (c) How many old rows will have their content nulled out (the old-side
--     of the same operation — should match the "real scores" counts from
--     the earlier diagnostic: 4304 + 382 + 363 = 5049 total).
select
  ay.ay_code,
  subj.code,
  count(*) filter (
    where coalesce(array_length(array_remove(ge.ww_scores, null), 1), 0) > 0
       or coalesce(array_length(array_remove(ge.pt_scores, null), 1), 0) > 0
       or ge.qa_score is not null
       or ge.quarterly_grade is not null
       or ge.letter_grade is not null
  ) as rows_to_be_nulled
from public.grade_entries ge
join public.grading_sheets gs on gs.id = ge.grading_sheet_id
join public.subjects subj on subj.id = gs.subject_id
join public.sections sec on sec.id = gs.section_id
join public.academic_years ay on ay.id = sec.academic_year_id
where subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
group by ay.ay_code, subj.code
order by ay.ay_code, subj.code;

-- (d) Orphan-content check — MUST return 0 rows. The apply script only
-- carries quarterly_grade forward into MAPEH; this finds any old row with
-- real content in ww_scores/pt_scores/qa_score/letter_grade WITHOUT a
-- quarterly_grade, which the apply script's own hard orphan-content check
-- will also catch and abort on — but surfacing it here, read-only, first
-- is cheaper to investigate than an aborted transaction.
select
  ay.ay_code, sec.name as section, subj.code as subject,
  st.student_number, t.term_number,
  ge.ww_scores, ge.pt_scores, ge.qa_score, ge.letter_grade
from public.grade_entries ge
join public.grading_sheets gs on gs.id = ge.grading_sheet_id
join public.subjects subj on subj.id = gs.subject_id
join public.sections sec on sec.id = gs.section_id
join public.terms t on t.id = gs.term_id
join public.academic_years ay on ay.id = sec.academic_year_id
join public.section_students ss on ss.id = ge.section_student_id
join public.students st on st.id = ss.student_id
where subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
  and ge.quarterly_grade is null
  and (
    coalesce(array_length(array_remove(ge.ww_scores, null), 1), 0) > 0
    or coalesce(array_length(array_remove(ge.pt_scores, null), 1), 0) > 0
    or ge.qa_score is not null
    or ge.letter_grade is not null
  );
