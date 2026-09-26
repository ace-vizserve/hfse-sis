-- Migration 179 — the registrar can excuse one WW/PT slot for one student
--
-- Since migration 177 a blank slot scores zero against the full total, as the
-- workbooks do. A late enrollee's assessments from before they joined are the
-- exception: in Excel the registrar prorates them by hand. This gives that a
-- home in the system — an excused slot leaves BOTH the student's score and
-- their total, for that student only.
--
-- `ww_excused` / `pt_excused` hold 1-based slot numbers (WW1 = 1). Only the
-- registrar (academic_coordinator and above) or the service role may change
-- them, and an excused slot cannot hold a score. The trigger drops any slot
-- number past the sheet's slot count, so removing a slot cannot leave a stale
-- excusal behind.

begin;

alter table public.grade_entries
  add column if not exists ww_excused int[] not null default '{}',
  add column if not exists pt_excused int[] not null default '{}';

-- ---------------------------------------------------------------------------
-- The formula, with excused slots
-- ---------------------------------------------------------------------------
drop function if exists public.grade_component_ps(numeric[], numeric[]);
drop function if exists public.compute_quarterly(
  numeric[], numeric[], numeric[], numeric[], numeric, numeric, numeric, numeric, numeric
);

create or replace function public.grade_component_ps(
  p_scores   numeric[],
  p_totals   numeric[],
  p_excused  int[] default '{}'
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
    continue when i = any(coalesce(p_excused, '{}'));  -- excused: out of both sums
    v_sum_max := v_sum_max + p_totals[i];
    continue when p_scores[i] is null;                  -- blank scores zero
    v_sum_scores := v_sum_scores + p_scores[i];
    v_any_scored := true;
  end loop;
  if not v_any_scored or v_sum_max = 0 then
    return null;
  end if;
  return (v_sum_scores / v_sum_max) * 100;
end;
$$;

create or replace function public.compute_quarterly(
  p_ww_scores  numeric[],
  p_ww_totals  numeric[],
  p_pt_scores  numeric[],
  p_pt_totals  numeric[],
  p_qa_score   numeric,
  p_qa_total   numeric,
  p_ww_weight  numeric,
  p_pt_weight  numeric,
  p_qa_weight  numeric,
  p_ww_excused int[] default '{}',
  p_pt_excused int[] default '{}',
  out ww_ps           double precision,
  out pt_ps           double precision,
  out qa_ps           double precision,
  out initial_grade   double precision,
  out quarterly_grade double precision
)
language plpgsql
immutable
as $$
begin
  ww_ps := public.grade_component_ps(p_ww_scores, p_ww_totals, p_ww_excused);
  pt_ps := public.grade_component_ps(p_pt_scores, p_pt_totals, p_pt_excused);
  qa_ps := public.grade_qa_ps(p_qa_score, p_qa_total);

  if ww_ps is null and pt_ps is null and qa_ps is null then
    initial_grade := null;
    quarterly_grade := null;
    return;
  end if;

  initial_grade :=
      coalesce(ww_ps, 0) * p_ww_weight::double precision
    + coalesce(pt_ps, 0) * p_pt_weight::double precision
    + coalesce(qa_ps, 0) * p_qa_weight::double precision;

  quarterly_grade := public.grade_transmute(initial_grade);
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
    raise exception 'Blank slot must score zero: workbook example is not 64';
  end if;
  -- Same row, WW2 excused: 14/15 again → 69.
  if (public.compute_quarterly(array[14,null]::numeric[], array[15,15]::numeric[],
        array[null,null,null]::numeric[], array[20,20,20]::numeric[], null, 60, .4, .4, .2,
        array[2], '{}')).quarterly_grade <> 69 then
    raise exception 'Excused slot must leave the total: expected 69';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The derive trigger — 178 plus excused slots
-- ---------------------------------------------------------------------------
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

  -- ---- excused slots: registrar only, in range, sorted --------------------
  new.ww_excused := coalesce((
    select array_agg(distinct x order by x) from unnest(coalesce(new.ww_excused, '{}')) x
     where x between 1 and coalesce(array_length(v_sheet.ww_totals, 1), 0)
  ), '{}');
  new.pt_excused := coalesce((
    select array_agg(distinct x order by x) from unnest(coalesce(new.pt_excused, '{}')) x
     where x between 1 and coalesce(array_length(v_sheet.pt_totals, 1), 0)
  ), '{}');

  -- OLD is range-filtered the same way before comparing, so a stale excusal
  -- past a removed slot does not read as a change on a teacher's next save.
  if auth.uid() is not null and not public.is_registrar_or_above() and (
       (tg_op = 'INSERT' and (new.ww_excused <> '{}' or new.pt_excused <> '{}'))
    or (tg_op = 'UPDATE' and (
          new.ww_excused is distinct from coalesce((
            select array_agg(distinct x order by x) from unnest(coalesce(old.ww_excused, '{}')) x
             where x between 1 and coalesce(array_length(v_sheet.ww_totals, 1), 0)), '{}')
       or new.pt_excused is distinct from coalesce((
            select array_agg(distinct x order by x) from unnest(coalesce(old.pt_excused, '{}')) x
             where x between 1 and coalesce(array_length(v_sheet.pt_totals, 1), 0)), '{}')))
  ) then
    raise exception 'Only the registrar can excuse an assessment.'
      using errcode = 'HFEXC';
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
    if v_v is not null and v_i = any(new.ww_excused) then
      raise exception 'W% is excused for this student, so it cannot hold a score.', v_i
        using errcode = 'HFEXC';
    end if;
    if v_v is not null and v_max is not null and (v_v < 0 or v_v > v_max) then
      raise exception 'W% score % is outside the allowed range 0 to %.', v_i, v_v, v_max
        using errcode = 'HFRNG';
    end if;
  end loop;
  for v_i in 1 .. coalesce(array_length(new.pt_scores, 1), 0) loop
    v_v := (new.pt_scores)[v_i];
    v_max := (v_sheet.pt_totals)[v_i];
    if v_v is not null and v_i = any(new.pt_excused) then
      raise exception 'PT% is excused for this student, so it cannot hold a score.', v_i
        using errcode = 'HFEXC';
    end if;
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
    v_sheet.ww_weight, v_sheet.pt_weight, v_sheet.qa_weight,
    new.ww_excused, new.pt_excused
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
-- The parity report (155) — same weights and excusals as the trigger, so a
-- prorated row or a sheet with its own weights no longer reads as a mismatch
-- ---------------------------------------------------------------------------
create or replace function public.grade_formula_port_diff()
returns table (
  kind              text,
  entry_id          uuid,
  grading_sheet_id  uuid,
  stored_quarterly  smallint,
  sql_quarterly     smallint,
  stored_initial    numeric,
  sql_initial       numeric,
  sheet_locked      boolean,
  entry_updated_at  timestamptz,
  sheet_updated_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select case
           when ge.qa_score is null
            and not exists (select 1 from unnest(coalesce(ge.ww_scores, '{}')) v where v is not null)
            and not exists (select 1 from unnest(coalesce(ge.pt_scores, '{}')) v where v is not null)
             then 'imported_no_scores'
           when (exists (select 1 from unnest(coalesce(ge.ww_scores, '{}')) v where v is not null)
                 and coalesce(array_length(gs.ww_totals, 1), 0) = 0)
             or (exists (select 1 from unnest(coalesce(ge.pt_scores, '{}')) v where v is not null)
                 and coalesce(array_length(gs.pt_totals, 1), 0) = 0)
             then 'sheet_not_configured'
           when ge.initial_grade is null
             then 'derived_never_computed'
           when ge.quarterly_grade is not distinct from c.quarterly_grade::smallint
            and ge.initial_grade is not null
            and c.initial_grade is not null
            and abs(ge.initial_grade - round(c.initial_grade::numeric, 4)) < 0.001
             then 'legacy_rounding'
           when ge.updated_at < gs.updated_at
             then 'stale'
           else 'mismatch'
         end,
         ge.id,
         ge.grading_sheet_id,
         ge.quarterly_grade,
         c.quarterly_grade::smallint,
         ge.initial_grade,
         round(c.initial_grade::numeric, 4),
         gs.is_locked,
         ge.updated_at,
         gs.updated_at
    from public.grade_entries ge
    join public.grading_sheets gs on gs.id = ge.grading_sheet_id
    join public.subject_configs sc on sc.id = gs.subject_config_id
   cross join lateral public.compute_quarterly(
     ge.ww_scores, gs.ww_totals,
     ge.pt_scores, gs.pt_totals,
     ge.qa_score,  gs.qa_total,
     case when gs.ww_weight is not null then gs.ww_weight else sc.ww_weight end,
     case when gs.ww_weight is not null then gs.pt_weight else sc.pt_weight end,
     case when gs.ww_weight is not null then gs.qa_weight else sc.qa_weight end,
     ge.ww_excused, ge.pt_excused
   ) c
   where ge.quarterly_grade is distinct from c.quarterly_grade::smallint
      or ge.initial_grade is distinct from round(c.initial_grade::numeric, 4);
$$;

commit;
