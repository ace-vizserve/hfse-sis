-- MAPEH consolidation — APPLY (transactional)
--
-- RUN ay2025-mapeh-consolidation-preview.sql FIRST and eyeball its counts.
-- See that file's header for the full rationale.
--
-- What this does, in one transaction:
--   (a) creates one MAPEH grading_sheet per (term, section) that
--       currently has any MUSIC/ARTS/PE/HE grading_sheet, reusing that
--       AY's MAPEH subject_configs row (already committed by migration
--       081's §1/§2, which ran and committed successfully before its §5
--       aborted — the per-section begin/commit blocks are real, per the
--       migration's own "Non-atomicity note").
--   (b) inserts one consolidated grade_entries row per section_student on
--       that sheet — quarterly_grade = mode() across whichever of
--       MUSIC/ARTS/PE/HE had a non-null value (ties do not occur in this
--       dataset — verified in preview step (b) — mode() correctly returns
--       the single most-frequent value); is_na = true only when ALL FOUR
--       source rows were is_na (a genuinely blank/never-graded roster
--       placeholder stays blank, not falsely marked N/A — Hard Rule #3).
--   (c) verifies coverage — every (section_student, term) group that had
--       REAL content under any of the four now has a matching MAPEH row
--       — and ABORTS BEFORE touching the old data if anything is missing.
--   (d) nulls out the old MUSIC/ARTS/PE/HE rows' content (ww_scores/
--       pt_scores/qa_score/quarterly_grade/letter_grade/is_na) — this is
--       the sanctioned Hard Rule #6 "deletion" (set to null, not a
--       physical DELETE; the rows themselves are removed later, by
--       migration 081's own already-reviewed §5, once this script has
--       left them correctly empty).
--
-- After this commits, migration 081 needs NO changes to §5 — its
-- existing zero-real-content assertion will now honestly find zero,
-- because the real content has been migrated forward, not destroyed.

begin;

-- (a) MAPEH grading_sheets — one per (term, section), lock state carried
-- forward from whichever of the 4 old sheets for that slot were locked
-- (if any were locked, the consolidated historical sheet is locked too).
with slots as (
  select
    gs.term_id, gs.section_id, sec.academic_year_id,
    bool_or(gs.is_locked) as any_locked,
    min(gs.locked_at) filter (where gs.is_locked) as earliest_lock
  from public.grading_sheets gs
  join public.subjects subj on subj.id = gs.subject_id
  join public.sections sec on sec.id = gs.section_id
  where subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
  group by gs.term_id, gs.section_id, sec.academic_year_id
)
insert into public.grading_sheets (
  term_id, section_id, subject_id, subject_config_id,
  is_locked, locked_at, locked_by
)
select
  s.term_id, s.section_id, mapeh.id, mapeh_sc.id,
  s.any_locked,
  case when s.any_locked then coalesce(s.earliest_lock, now()) else null end,
  case when s.any_locked then 'migration-081-consolidation' else null end
from slots s
join public.subjects mapeh on mapeh.code = 'MAPEH'
join public.subject_configs mapeh_sc
  on mapeh_sc.subject_id = mapeh.id
 and mapeh_sc.academic_year_id = s.academic_year_id
on conflict (term_id, section_id, subject_id) do nothing;

-- (b) Consolidated grade_entries.
with old_entries as (
  select
    gs.term_id, gs.section_id, ge.section_student_id,
    ge.quarterly_grade, ge.is_na
  from public.grade_entries ge
  join public.grading_sheets gs on gs.id = ge.grading_sheet_id
  join public.subjects subj on subj.id = gs.subject_id
  where subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
),
consolidated as (
  select
    term_id, section_id, section_student_id,
    mode() within group (order by quarterly_grade)
      filter (where quarterly_grade is not null) as consolidated_grade,
    bool_and(is_na) as all_na
  from old_entries
  group by term_id, section_id, section_student_id
)
insert into public.grade_entries (grading_sheet_id, section_student_id, quarterly_grade, is_na)
select
  mgs.id, c.section_student_id, c.consolidated_grade,
  (c.consolidated_grade is null and c.all_na)
from consolidated c
join public.grading_sheets mgs
  on mgs.term_id = c.term_id
 and mgs.section_id = c.section_id
join public.subjects mapeh on mapeh.id = mgs.subject_id and mapeh.code = 'MAPEH'
on conflict (grading_sheet_id, section_student_id) do nothing;

-- (c) Coverage verification — HARD ABORT (not a soft eyeball-select) if
-- any real MUSIC/ARTS/PE/HE grade lacks a matching MAPEH row. Raising here
-- rolls back the whole transaction, including (a)/(b) above, so the old
-- data is never touched by (d) unless coverage is complete.
do $$
declare
  v_uncovered bigint;
begin
  select count(*) into v_uncovered
  from (
    select distinct gs.term_id, gs.section_id, ge.section_student_id
    from public.grade_entries ge
    join public.grading_sheets gs on gs.id = ge.grading_sheet_id
    join public.subjects subj on subj.id = gs.subject_id
    where subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
      and ge.quarterly_grade is not null
  ) src
  where not exists (
    select 1
    from public.grade_entries mge
    join public.grading_sheets mgs on mgs.id = mge.grading_sheet_id
    join public.subjects msubj on msubj.id = mgs.subject_id
    where msubj.code = 'MAPEH'
      and mgs.term_id = src.term_id
      and mgs.section_id = src.section_id
      and mge.section_student_id = src.section_student_id
      and mge.quarterly_grade is not null
  );

  if v_uncovered > 0 then
    raise exception '[ay2025-mapeh-consolidation] ABORT — % (section_student, term) group(s) with a real MUSIC/ARTS/PE/HE grade have NO matching MAPEH row after consolidation. Transaction rolled back — the old data is untouched. Investigate before re-running.', v_uncovered;
  end if;

  raise notice '[ay2025-mapeh-consolidation] Coverage verified — every real MUSIC/ARTS/PE/HE grade has a matching MAPEH row. Proceeding to null out the old rows.';
end $$;

-- (d) Null out the old rows' content — the sanctioned Hard Rule #6
-- "deletion." Physical row removal happens later, in migration 081's
-- unmodified §5, once these rows are correctly empty.
update public.grade_entries ge
set ww_scores = '{}', pt_scores = '{}', qa_score = null,
    quarterly_grade = null, letter_grade = null, is_na = false,
    updated_at = now()
from public.grading_sheets gs, public.subjects subj
where ge.grading_sheet_id = gs.id
  and gs.subject_id = subj.id
  and subj.code in ('MUSIC', 'ARTS', 'PE', 'HE');

-- === pre-commit verification ===

-- (e) MUST read 0 — confirms (d) actually cleared everything.
select count(*) as still_has_real_content
from public.grade_entries ge
join public.grading_sheets gs on gs.id = ge.grading_sheet_id
join public.subjects subj on subj.id = gs.subject_id
where subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
  and (
    coalesce(array_length(array_remove(ge.ww_scores, null), 1), 0) > 0
    or coalesce(array_length(array_remove(ge.pt_scores, null), 1), 0) > 0
    or ge.qa_score is not null
    or ge.quarterly_grade is not null
    or ge.letter_grade is not null
  );

commit;

-- === post-commit verification ===

-- (f) Per-AY summary of what MAPEH now holds.
select
  ay.ay_code,
  count(*) as mapeh_grade_entries,
  count(*) filter (where ge.quarterly_grade is not null) as with_a_grade,
  count(*) filter (where ge.is_na) as marked_na
from public.grade_entries ge
join public.grading_sheets gs on gs.id = ge.grading_sheet_id
join public.subjects subj on subj.id = gs.subject_id and subj.code = 'MAPEH'
join public.sections sec on sec.id = gs.section_id
join public.academic_years ay on ay.id = sec.academic_year_id
group by ay.ay_code
order by ay.ay_code;

-- (g) MUST read 0 — old rows are content-empty, ready for migration 081's
-- unmodified §5 to delete.
select count(*) as still_has_real_content_post_commit
from public.grade_entries ge
join public.grading_sheets gs on gs.id = ge.grading_sheet_id
join public.subjects subj on subj.id = gs.subject_id
where subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
  and (
    coalesce(array_length(array_remove(ge.ww_scores, null), 1), 0) > 0
    or coalesce(array_length(array_remove(ge.pt_scores, null), 1), 0) > 0
    or ge.qa_score is not null
    or ge.quarterly_grade is not null
    or ge.letter_grade is not null
  );
