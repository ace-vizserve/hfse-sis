-- Migration 178 — the derive trigger uses the SHEET's weights when it has them
--
-- Migration 159 (KD #218) let a grading sheet carry its own WW/PT/QA weights —
-- a term with no exam hands the exam's share on (Filipino no-exam = 37/63).
-- The app reads them sheet-first (lib/grading/resolve-sheet-weights.ts), but
-- this trigger, written in 154 before 159 existed, still read only
-- subject_configs. So every save re-derived a no-exam sheet at 30/50/20 with
-- the exam counting zero: full marks → 87 instead of 100.
--
-- Not yet visible: all 24 graded entries on the 38 sheets with their own
-- weights give the same grade either way (2026-09-26). The first score on the
-- AY2026 T4 Filipino no-exam class would have been wrong.
--
-- Same rule as the TS resolver: sheet-or-config, one hop, all three together.
-- Only the weights select changes; the rest of the function is 154 verbatim.

create or replace function public.grade_entries_derive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sheet          record;
  v_scores         numeric[];
  v_i              int;
  v_v              numeric;
  v_max            numeric;
  v_c              record;
  v_len            int;
  v_ww_scored      int;
  v_pt_scored      int;
  v_new_has_scores boolean;
  v_old_has_scores boolean;
  v_computable     boolean;
begin
  select gs.ww_totals,
         gs.pt_totals,
         gs.qa_total,
         case when gs.ww_weight is not null then gs.ww_weight else sc.ww_weight end as ww_weight,
         case when gs.ww_weight is not null then gs.pt_weight else sc.pt_weight end as pt_weight,
         case when gs.ww_weight is not null then gs.qa_weight else sc.qa_weight end as qa_weight,
         s.is_examinable
    into v_sheet
    from public.grading_sheets gs
    join public.subjects s          on s.id = gs.subject_id
    left join public.subject_configs sc on sc.id = gs.subject_config_id
   where gs.id = new.grading_sheet_id;

  if not found then
    raise exception 'grading sheet % not found', new.grading_sheet_id;
  end if;
  if v_sheet.ww_weight is null then
    raise exception 'This sheet has no subject weights set, so grades cannot be worked out.'
      using errcode = 'HFCFG';
  end if;

  select coalesce(max(i), 0) into v_ww_scored
    from generate_series(1, coalesce(array_length(new.ww_scores, 1), 0)) as i
   where (new.ww_scores)[i] is not null;
  v_len := greatest(coalesce(array_length(v_sheet.ww_totals, 1), 0), v_ww_scored);
  select coalesce(array_agg((new.ww_scores)[i] order by i), '{}'::numeric[])
    into v_scores from generate_series(1, v_len) as i;
  new.ww_scores := v_scores;

  select coalesce(max(i), 0) into v_pt_scored
    from generate_series(1, coalesce(array_length(new.pt_scores, 1), 0)) as i
   where (new.pt_scores)[i] is not null;
  v_len := greatest(coalesce(array_length(v_sheet.pt_totals, 1), 0), v_pt_scored);
  select coalesce(array_agg((new.pt_scores)[i] order by i), '{}'::numeric[])
    into v_scores from generate_series(1, v_len) as i;
  new.pt_scores := v_scores;

  for v_i in 1 .. coalesce(array_length(new.ww_scores, 1), 0) loop
    v_v := (new.ww_scores)[v_i];
    v_max := (v_sheet.ww_totals)[v_i];
    if v_v is not null and v_max is not null and (v_v < 0 or v_v > v_max) then
      raise exception 'W% score % is outside the allowed range 0 to %.', v_i, v_v, v_max
        using errcode = 'HFRNG';
    end if;
  end loop;
  for v_i in 1 .. coalesce(array_length(new.pt_scores, 1), 0) loop
    v_v := (new.pt_scores)[v_i];
    v_max := (v_sheet.pt_totals)[v_i];
    if v_v is not null and v_max is not null and (v_v < 0 or v_v > v_max) then
      raise exception 'PT% score % is outside the allowed range 0 to %.', v_i, v_v, v_max
        using errcode = 'HFRNG';
    end if;
  end loop;
  if new.qa_score is not null and v_sheet.qa_total is not null
     and (new.qa_score < 0 or new.qa_score > v_sheet.qa_total) then
    raise exception 'Quarterly assessment score % is outside the allowed range 0 to %.',
      new.qa_score, v_sheet.qa_total
      using errcode = 'HFRNG';
  end if;

  if new.letter_grade is not null then
    if new.letter_grade not in ('UG', 'E') then
      raise exception 'A letter grade can only be UG or E, or left empty.'
        using errcode = 'HFLTR';
    end if;
    if coalesce(v_sheet.is_examinable, true) then
      raise exception 'A letter grade can only be set on a non-examinable subject.'
        using errcode = 'HFLTR';
    end if;
  end if;

  v_new_has_scores :=
       new.qa_score is not null
    or exists (select 1 from unnest(coalesce(new.ww_scores, '{}')) v where v is not null)
    or exists (select 1 from unnest(coalesce(new.pt_scores, '{}')) v where v is not null);

  v_old_has_scores := tg_op = 'UPDATE' and (
       old.qa_score is not null
    or exists (select 1 from unnest(coalesce(old.ww_scores, '{}')) v where v is not null)
    or exists (select 1 from unnest(coalesce(old.pt_scores, '{}')) v where v is not null)
  );

  v_computable := not (
       (v_ww_scored > 0 and coalesce(array_length(v_sheet.ww_totals, 1), 0) = 0)
    or (v_pt_scored > 0 and coalesce(array_length(v_sheet.pt_totals, 1), 0) = 0)
  );

  if (not v_new_has_scores and not v_old_has_scores) or not v_computable then
    if tg_op = 'UPDATE' then
      new.ww_ps           := coalesce(new.ww_ps, old.ww_ps);
      new.pt_ps           := coalesce(new.pt_ps, old.pt_ps);
      new.qa_ps           := coalesce(new.qa_ps, old.qa_ps);
      new.initial_grade   := coalesce(new.initial_grade, old.initial_grade);
      new.quarterly_grade := coalesce(new.quarterly_grade, old.quarterly_grade);
    end if;
    new.updated_at := now();
    return new;
  end if;

  select * into v_c from public.compute_quarterly(
    new.ww_scores, v_sheet.ww_totals,
    new.pt_scores, v_sheet.pt_totals,
    new.qa_score,  v_sheet.qa_total,
    v_sheet.ww_weight, v_sheet.pt_weight, v_sheet.qa_weight
  );

  new.ww_ps           := v_c.ww_ps::numeric;
  new.pt_ps           := v_c.pt_ps::numeric;
  new.qa_ps           := v_c.qa_ps::numeric;
  new.initial_grade   := v_c.initial_grade::numeric;
  new.quarterly_grade := v_c.quarterly_grade::smallint;

  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Prove it on a real row, then roll back
-- ---------------------------------------------------------------------------
-- Takes a scored entry on an unlocked sheet, gives the sheet its own 50/50/0
-- split, saves the entry, and checks the stored grade is the 50/50/0 one.
do $$
declare
  v_id     uuid;
  v_sheet  uuid;
  v_q      smallint;
  v_expect smallint;
begin
  select ge.id, ge.grading_sheet_id into v_id, v_sheet
    from public.grade_entries ge
    join public.grading_sheets gs on gs.id = ge.grading_sheet_id
   where not gs.is_locked
     and ge.qa_score is not null
     and ge.qa_score <= gs.qa_total
     and coalesce(array_length(gs.ww_totals, 1), 0) > 0
     and coalesce(array_length(gs.pt_totals, 1), 0) > 0
     and exists (select 1 from unnest(ge.ww_scores) v where v is not null)
     and exists (select 1 from unnest(ge.pt_scores) v where v is not null)
     -- every score within its slot's max, so the trigger computes rather
     -- than refusing the row for an unrelated reason
     and not exists (select 1 from generate_subscripts(ge.ww_scores, 1) i
                      where (ge.ww_scores)[i] > coalesce(gs.ww_totals[i], 'infinity'))
     and not exists (select 1 from generate_subscripts(ge.pt_scores, 1) i
                      where (ge.pt_scores)[i] > coalesce(gs.pt_totals[i], 'infinity'))
   limit 1;

  if v_id is null then
    raise notice 'No scored entry on an unlocked sheet — nothing to prove against.';
    return;
  end if;

  update public.grading_sheets
     set ww_weight = 0.50, pt_weight = 0.50, qa_weight = 0.00
   where id = v_sheet;
  update public.grade_entries set updated_at = now() where id = v_id;

  select ge.quarterly_grade,
         (public.compute_quarterly(ge.ww_scores, gs.ww_totals, ge.pt_scores, gs.pt_totals,
            ge.qa_score, gs.qa_total, 0.50, 0.50, 0.00)).quarterly_grade::smallint
    into v_q, v_expect
    from public.grade_entries ge
    join public.grading_sheets gs on gs.id = ge.grading_sheet_id
   where ge.id = v_id;

  if v_q is distinct from v_expect then
    raise exception 'Derive trigger ignored the sheet weights: entry % stored %, 50/50/0 gives %',
      v_id, v_q, v_expect;
  end if;

  raise notice 'Verified on entry %: stored % = the sheet''s 50/50/0 grade.', v_id, v_q;
  raise exception using errcode = 'HFRBK', message = 'rollback probe';
exception
  when sqlstate 'HFRBK' then
    raise notice 'Probe rolled back; no row was changed.';
end;
$$;
