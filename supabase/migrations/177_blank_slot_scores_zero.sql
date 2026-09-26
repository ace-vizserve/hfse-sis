-- Migration 177 — a blank WW/PT slot scores zero against the FULL total.
--
-- The grading workbooks divide by the fixed max row (`(F10/$F$9)*100`); the
-- SIS dropped a blank slot's max too. WW 2×15, only WW1 = 14:
-- workbook 14/30 → 64, SIS 14/15 → 69. Same change as lib/compute/quarterly.ts.
--
-- Recomputes every affected grade, locked sheets included (Mr Ace,
-- 2026-09-26), with a grade_audit_log row per changed grade. Rows whose stored
-- grade did not come from the old formula (workbook imports) are left alone.

begin;

-- 1. Affected rows, with the grade the OLD formula gives them.
create temp table _m177 on commit drop as
select ge.id, ge.grading_sheet_id, ge.quarterly_grade as stored_q, ge.initial_grade as stored_initial,
       ge.ww_scores, ge.pt_scores, ge.qa_score,
       gs.ww_totals, gs.pt_totals, gs.qa_total, w.ww, w.pt, w.qa,
       (public.compute_quarterly(ge.ww_scores, gs.ww_totals, ge.pt_scores, gs.pt_totals,
          ge.qa_score, gs.qa_total, w.ww, w.pt, w.qa)).quarterly_grade::smallint as old_q
  from public.grade_entries ge
  join public.grading_sheets gs on gs.id = ge.grading_sheet_id
  join public.subjects s on s.id = gs.subject_id
  left join public.subject_configs sc on sc.id = gs.subject_config_id
 cross join lateral (
   select coalesce(gs.ww_weight, sc.ww_weight) as ww,
          case when gs.ww_weight is not null then gs.pt_weight else sc.pt_weight end as pt,
          case when gs.ww_weight is not null then gs.qa_weight else sc.qa_weight end as qa
 ) w
 where s.is_examinable
   and not coalesce(ge.is_na, false)
   and w.ww is not null
   and array_position(ge.ww_scores || ge.pt_scores, null) is not null;

-- 2. The fix.
create or replace function public.grade_component_ps(
  p_scores numeric[],
  p_totals numeric[]
)
returns double precision
language plpgsql
immutable
as $$
declare
  v_sum_scores double precision := 0;
  v_sum_max    double precision := 0;
  v_any_scored boolean := false;
  i            int;
begin
  for i in 1 .. coalesce(array_length(p_totals, 1), 0) loop
    continue when p_totals[i] is null;
    v_sum_max := v_sum_max + p_totals[i];           -- every slot's max counts
    continue when p_scores[i] is null;              -- blank adds nothing
    v_sum_scores := v_sum_scores + p_scores[i];
    v_any_scored := true;
  end loop;
  if not v_any_scored or v_sum_max = 0 then
    return null;                                     -- nothing entered yet
  end if;
  return (v_sum_scores / v_sum_max) * 100;
end;
$$;

do $$
begin
  if (public.compute_quarterly(array[10,10]::numeric[], array[10,10]::numeric[],
        array[6,10,10]::numeric[], array[10,10,10]::numeric[], 22, 30, .4, .4, .2)).quarterly_grade <> 93 then
    raise exception 'Hard Rule #1 failed: canonical case is not 93';
  end if;
  if (public.compute_quarterly(array[14,null]::numeric[], array[15,15]::numeric[],
        array[null,null,null]::numeric[], array[20,20,20]::numeric[], null, 60, .4, .4, .2)).quarterly_grade <> 64 then
    raise exception 'Workbook example is not 64';
  end if;
end;
$$;

-- 3. Recompute the rows the old formula wrote; log each grade that moves.
create temp table _m177_new on commit drop as
select m.id, m.grading_sheet_id, m.stored_q, c.*
  from _m177 m
 cross join lateral public.compute_quarterly(m.ww_scores, m.ww_totals, m.pt_scores,
   m.pt_totals, m.qa_score, m.qa_total, m.ww, m.pt, m.qa) c
 where m.stored_q = m.old_q
   and round(c.initial_grade::numeric, 4) is distinct from m.stored_initial;

alter table public.grade_entries disable trigger grade_entries_derive_trg;
update public.grade_entries ge
   set ww_ps = n.ww_ps, pt_ps = n.pt_ps, qa_ps = n.qa_ps,
       initial_grade = n.initial_grade, quarterly_grade = n.quarterly_grade,
       updated_at = now()
  from _m177_new n
 where ge.id = n.id;
alter table public.grade_entries enable trigger grade_entries_derive_trg;

insert into public.grade_audit_log
  (grade_entry_id, grading_sheet_id, changed_by, field_changed, old_value, new_value, approval_reference)
select id, grading_sheet_id, 'migration 177', 'quarterly_grade',
       stored_q::text, quarterly_grade::smallint::text,
       'Mr Ace, 2026-09-26: blank WW/PT slot scores zero against the full total (Excel parity)'
  from _m177_new
 where stored_q <> quarterly_grade::smallint;

commit;
