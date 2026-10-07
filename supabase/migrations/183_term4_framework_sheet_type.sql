-- Migration 183 — the "Term 4 framework" grading sheet type
--
-- Secondary Four's Term 4 is two weeks before O-Level study leave, so the
-- school grades it as: 50% the student's best T1–T3 term average, 20% the
-- teacher's recommendation (out of 30), 30% a revision task or mock exam (out
-- of 100). Spec: docs/superpowers/specs/2026-10-07-term4-framework-sheet-design.md
--
-- A Term 4 framework sheet is a standard sheet with a FIXED shape — one WW
-- slot (the best term average, max 100), one PT slot (max 30), exam 100,
-- weights 50/20/30 — so the grade formula is untouched (Hard Rule #1).
-- Migration 184 fills and keeps the WW slot live.

begin;

alter table public.grading_sheets
  add column if not exists sheet_type text not null default 'standard';

alter table public.grading_sheets
  drop constraint if exists grading_sheets_sheet_type_check;
alter table public.grading_sheets
  add constraint grading_sheets_sheet_type_check
  check (sheet_type in ('standard', 'term4_framework'));

alter table public.grading_sheets
  drop constraint if exists grading_sheets_term4_framework_shape_check;
alter table public.grading_sheets
  add constraint grading_sheets_term4_framework_shape_check
  check (
    sheet_type <> 'term4_framework'
    or (    ww_totals = '{100}'::numeric[]
        and pt_totals = '{30}'::numeric[]
        and qa_total  = 100
        and ww_weight = 0.50 and pt_weight = 0.20 and qa_weight = 0.30)
  );

comment on column public.grading_sheets.sheet_type is
  'standard | term4_framework. A term4_framework sheet has a fixed shape (see grading_sheets_term4_framework_shape_check); its WW slot is the best T1–T3 term average, filled by grade_entries_best_term_fill() (migration 184).';

-- ---------------------------------------------------------------------------
-- The best term average
-- ---------------------------------------------------------------------------
-- Per term T1–T3: the mean of the student's quarterly grades over EXAMINABLE
-- subjects, N/A rows skipped (that is the proration for late enrollees). A
-- subject counts once per term: a student who moved class mid-year has rows
-- in both sections, and the non-withdrawn enrolment's row wins. Rounded to 1
-- decimal like the General Average. Best = highest; a tie goes to the later
-- term (the value is the same either way).
create or replace function public.student_best_term_average(
  p_student_id       uuid,
  p_academic_year_id uuid
)
returns table (best numeric, term_number smallint)
language sql
stable
security definer
set search_path = public
as $$
  with one_per_subject as (
    select distinct on (t.term_number, gs.subject_id)
           t.term_number, ge.quarterly_grade
      from grade_entries ge
      join grading_sheets gs   on gs.id = ge.grading_sheet_id
      join terms t             on t.id = gs.term_id
      join subjects s          on s.id = gs.subject_id
      join section_students ss on ss.id = ge.section_student_id
     where ss.student_id = p_student_id
       and t.academic_year_id = p_academic_year_id
       and t.term_number between 1 and 3
       and s.is_examinable
       -- a framework sheet is never a source, whatever term it sits on
       and gs.sheet_type = 'standard'
       and not ge.is_na
       and ge.quarterly_grade is not null
     order by t.term_number, gs.subject_id,
              (ss.enrollment_status = 'withdrawn'), ge.updated_at desc
  )
  select round(avg(quarterly_grade)::numeric, 1) as best, term_number
    from one_per_subject
   group by term_number
   order by 1 desc, term_number desc
   limit 1;
$$;

-- For the grid: each entry's best term average and the term it came from.
create or replace function public.best_term_averages_for_sheet(p_sheet_id uuid)
returns table (section_student_id uuid, best numeric, term_number smallint)
language sql
stable
security definer
set search_path = public
as $$
  select ge.section_student_id, b.best, b.term_number
    from grade_entries ge
    join grading_sheets gs   on gs.id = ge.grading_sheet_id
    join terms t             on t.id = gs.term_id
    join section_students ss on ss.id = ge.section_student_id
    left join lateral public.student_best_term_average(ss.student_id, t.academic_year_id) b on true
   where ge.grading_sheet_id = p_sheet_id;
$$;

revoke all on function public.student_best_term_average(uuid, uuid) from public, anon, authenticated;
revoke all on function public.best_term_averages_for_sheet(uuid) from public, anon, authenticated;
grant execute on function public.student_best_term_average(uuid, uuid) to service_role;
grant execute on function public.best_term_averages_for_sheet(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Config sync must not reshape a Term 4 framework sheet
-- ---------------------------------------------------------------------------
-- Verbatim from migration 108 except the loop's query gains
-- `AND sheet_type = 'standard'`: the function pads every unlocked sheet to the
-- config's max slots, which would break the fixed shape and make the
-- subject's settings save fail.
CREATE OR REPLACE FUNCTION sync_grading_sheets_from_config(p_config_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ww_max_slots  smallint;
  v_pt_max_slots  smallint;
  v_qa_max        smallint;
  v_sheet         record;
  v_old_ww_len    int;
  v_old_pt_len    int;
  v_new_ww_totals numeric[];
  v_new_pt_totals numeric[];
  v_updated_sheets  int := 0;
  v_updated_entries int := 0;
  v_sheet_ids     uuid[] := ARRAY[]::uuid[];
BEGIN
  -- v_qa_max is still read: it is reported back so the caller can apply the
  -- customisation rule without a second lookup.
  SELECT ww_max_slots, pt_max_slots, qa_max
  INTO v_ww_max_slots, v_pt_max_slots, v_qa_max
  FROM subject_configs
  WHERE id = p_config_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'subject_config % not found', p_config_id;
  END IF;

  FOR v_sheet IN
    SELECT id, ww_totals, pt_totals
    FROM grading_sheets
    WHERE subject_config_id = p_config_id
      AND is_locked = false
      AND sheet_type = 'standard'
  LOOP
    -- ── WW totals ──────────────────────────────────────────────────────────
    v_old_ww_len := COALESCE(array_length(v_sheet.ww_totals, 1), 0);
    v_new_ww_totals := v_sheet.ww_totals;

    IF v_old_ww_len < v_ww_max_slots THEN
      v_new_ww_totals := v_sheet.ww_totals
        || array_fill(10::numeric, ARRAY[v_ww_max_slots - v_old_ww_len]);
    ELSIF v_old_ww_len > v_ww_max_slots THEN
      v_new_ww_totals := v_sheet.ww_totals[1:v_ww_max_slots];
    END IF;

    -- ── PT totals ──────────────────────────────────────────────────────────
    v_old_pt_len := COALESCE(array_length(v_sheet.pt_totals, 1), 0);
    v_new_pt_totals := v_sheet.pt_totals;

    IF v_old_pt_len < v_pt_max_slots THEN
      v_new_pt_totals := v_sheet.pt_totals
        || array_fill(10::numeric, ARRAY[v_pt_max_slots - v_old_pt_len]);
    ELSIF v_old_pt_len > v_pt_max_slots THEN
      v_new_pt_totals := v_sheet.pt_totals[1:v_pt_max_slots];
    END IF;

    -- ── Write grading_sheets ───────────────────────────────────────────────
    -- qa_total is DELIBERATELY not set here any more; see the header.
    UPDATE grading_sheets
    SET
      ww_totals  = v_new_ww_totals,
      pt_totals  = v_new_pt_totals,
      updated_at = now()
    WHERE id = v_sheet.id;

    v_updated_sheets := v_updated_sheets + 1;
    v_sheet_ids := v_sheet_ids || v_sheet.id;

    -- ── Resize grade_entries arrays ────────────────────────────────────────
    IF v_old_ww_len != v_ww_max_slots THEN
      UPDATE grade_entries
      SET ww_scores = CASE
        WHEN COALESCE(array_length(ww_scores, 1), 0) < v_ww_max_slots
          THEN ww_scores
            || array_fill(NULL::numeric,
                          ARRAY[v_ww_max_slots
                                - COALESCE(array_length(ww_scores, 1), 0)])
        WHEN array_length(ww_scores, 1) > v_ww_max_slots
          THEN ww_scores[1:v_ww_max_slots]
        ELSE ww_scores
      END
      WHERE grading_sheet_id = v_sheet.id;
      v_updated_entries := v_updated_entries + 1;
    END IF;

    IF v_old_pt_len != v_pt_max_slots THEN
      UPDATE grade_entries
      SET pt_scores = CASE
        WHEN COALESCE(array_length(pt_scores, 1), 0) < v_pt_max_slots
          THEN pt_scores
            || array_fill(NULL::numeric,
                          ARRAY[v_pt_max_slots
                                - COALESCE(array_length(pt_scores, 1), 0)])
        WHEN array_length(pt_scores, 1) > v_pt_max_slots
          THEN pt_scores[1:v_pt_max_slots]
        ELSE pt_scores
      END
      WHERE grading_sheet_id = v_sheet.id;
      v_updated_entries := v_updated_entries + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'updated_sheets',  v_updated_sheets,
    'updated_entries', v_updated_entries,
    'sheet_ids',       COALESCE(to_jsonb(v_sheet_ids), '[]'::jsonb),
    -- New in 108: the caller applies the qa_total rule and needs this.
    'qa_max',          v_qa_max
  );
END;
$$;

-- KD #167 lockdown, re-asserted. CREATE OR REPLACE preserves grants so this is
-- belt-and-braces, but the cost is nil and the failure mode is a definer RPC
-- open to the anon key.
do $$
declare
  fn text := 'public.sync_grading_sheets_from_config(uuid)';
begin
  if to_regprocedure(fn) is not null then
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end if;
end $$;

commit;
