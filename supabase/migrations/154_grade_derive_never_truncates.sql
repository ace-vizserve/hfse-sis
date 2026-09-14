-- Migration 154 — the derive trigger must never delete a mark, and must not
-- overwrite a grade it has no maxes to compute from
--
-- 🔴 SECOND DATA-LOSS BUG FROM MIGRATION 152, WORSE THAN THE FIRST. 153 stopped
-- the trigger erasing a derived GRADE. This one stops it erasing the MARKS.
--
-- Measured on production: 513 grade entries hold 3,908 individual marks in
-- slots beyond their sheet's configured slot count, across 21 sheets. Every one
-- of those marks would be deleted by the next write to its row.
--
-- HOW. 152's normalisation step rebuilds each score array to the sheet's slot
-- count, padding with nulls and dropping the overflow:
--
--     select coalesce(array_agg((new.ww_scores)[i] order by i), '{}')
--       from generate_series(1, coalesce(array_length(v_sheet.ww_totals, 1), 0))
--
-- 232 of this school's 1,116 grading sheets have NO maxes configured at all —
-- `ww_totals` and `pt_totals` are both empty. On those sheets that
-- `generate_series` runs from 1 to 0, produces nothing, and the array becomes
-- `{}`. An entry holding `ww_scores = [17, 20, 20]` keeps its stored grade of
-- 95 and loses the three marks behind it.
--
-- ⚠ THE ROUTE DID EXACTLY THE SAME THING — `normalizeArr(merged.ww_scores,
-- sheet.ww_totals.length)` with `length === 0` returns `[]`. This is the SECOND
-- time in three migrations that a rule which was harmless in the route became
-- destructive in a trigger, for the same reason both times: all 232 of those
-- sheets are LOCKED, so the route could not be reached, and a trigger fires for
-- every writer whether the sheet is locked or not. That is the lesson worth
-- keeping from this pair of migrations.
--
-- TWO CHANGES.
--
-- 1. NORMALISATION PADS BUT NEVER TRUNCATES A MARK. The array grows to the
--    sheet's slot count, and shrinks only past the last slot that holds an
--    actual score. A sheet that was narrowed from five slots to three keeps any
--    mark sitting in slot four — it is data, and the formula already ignores it
--    (`grade_component_ps` skips a slot whose max is null, which is exactly what
--    `lib/compute/quarterly.ts` does when `totals[i]` is `undefined`). Silently
--    deleting a teacher's mark to tidy an array is not a trade worth making.
--
-- 2. NO MAXES MEANS NO OPINION. If a component carries scores but its sheet has
--    no maxes for them, the grade cannot be worked out — `grade_component_ps`
--    returns null, the weighted sum treats it as 0, and a stored 95 would be
--    overwritten with a computed 64 assembled out of nothing. This is 153's
--    rule, widened from "no scores to compute from" to its real form: THE
--    TRIGGER DERIVES ONLY WHEN IT CAN DERIVE SOMETHING MEANINGFUL. Otherwise it
--    leaves the derived columns as it found them, and an explicitly supplied
--    value still wins.

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
         sc.ww_weight,
         sc.pt_weight,
         sc.qa_weight,
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

  -- ---- normalise: pad to the sheet, never drop a mark ---------------------
  -- `v_*_scored` is the index of the LAST slot holding a real score. The array
  -- is rebuilt to whichever is longer, that or the sheet's slot count — so it
  -- always covers every slot the grid will draw, and never stops short of a
  -- mark someone actually entered.
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

  -- ---- every score within [0, its max] ------------------------------------
  -- A slot with no configured max is not checked, matching the TS, where
  -- `v > undefined` is false and the comparison quietly passes. That is also
  -- what keeps the 3,908 marks above from being rejected outright now that they
  -- survive normalisation.
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

  -- ---- letter override (KD #104) ------------------------------------------
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

  -- ---- can a meaningful grade be worked out at all? -----------------------
  v_new_has_scores :=
       new.qa_score is not null
    or exists (select 1 from unnest(coalesce(new.ww_scores, '{}')) v where v is not null)
    or exists (select 1 from unnest(coalesce(new.pt_scores, '{}')) v where v is not null);

  v_old_has_scores := tg_op = 'UPDATE' and (
       old.qa_score is not null
    or exists (select 1 from unnest(coalesce(old.ww_scores, '{}')) v where v is not null)
    or exists (select 1 from unnest(coalesce(old.pt_scores, '{}')) v where v is not null)
  );

  -- Scores with no maxes behind them cannot produce a percentage. The formula
  -- would return null for that component, the weighted sum would read it as
  -- zero, and the result would be a number assembled out of a gap in the setup
  -- rather than out of anyone's marks.
  v_computable := not (
       (v_ww_scored > 0 and coalesce(array_length(v_sheet.ww_totals, 1), 0) = 0)
    or (v_pt_scored > 0 and coalesce(array_length(v_sheet.pt_totals, 1), 0) = 0)
  );

  -- 🔴 THE GUARD, in its general form. Nothing to compute from, or nothing to
  -- compute against: either way the derived columns are not this trigger's to
  -- touch. An explicitly supplied value still wins, so the AY2025 grade
  -- backfill and any future import write through untouched — only a null
  -- meaning "I could not work this out" is refused.
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

  -- ---- derive (Hard Rule #2) ----------------------------------------------
  select * into v_c from public.compute_quarterly(
    new.ww_scores, v_sheet.ww_totals,
    new.pt_scores, v_sheet.pt_totals,
    new.qa_score,  v_sheet.qa_total,
    v_sheet.ww_weight, v_sheet.pt_weight, v_sheet.qa_weight
  );

  -- ⚠ The floor already happened, inside compute_quarterly, against the full
  -- double. Only now is anything rounded for storage.
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
-- Prove it, at apply time, against the worst row in the database
-- ---------------------------------------------------------------------------
--
-- Finds a real entry whose marks sit beyond its sheet's slot count — the exact
-- 3,908-mark population — writes to it the way the maintenance RPC does, and
-- checks that every mark and the stored grade are still there. Rolled back, so
-- the database is untouched either way.
do $$
declare
  v_id        uuid;
  v_ww_before numeric[];
  v_pt_before numeric[];
  v_q_before  smallint;
  v_ww_after  numeric[];
  v_pt_after  numeric[];
  v_q_after   smallint;
begin
  select ge.id, ge.ww_scores, ge.pt_scores, ge.quarterly_grade
    into v_id, v_ww_before, v_pt_before, v_q_before
    from public.grade_entries ge
    join public.grading_sheets gs on gs.id = ge.grading_sheet_id
   where exists (
           select 1 from generate_series(1, coalesce(array_length(ge.ww_scores, 1), 0)) i
            where (ge.ww_scores)[i] is not null
              and i > coalesce(array_length(gs.ww_totals, 1), 0)
         )
   limit 1;

  if v_id is null then
    raise notice 'No entry with marks beyond its sheet slot count — nothing to prove against.';
    return;
  end if;

  -- Any write at all. `updated_at` is what the recompute helper touches.
  update public.grade_entries set updated_at = now() where id = v_id;

  select ww_scores, pt_scores, quarterly_grade
    into v_ww_after, v_pt_after, v_q_after
    from public.grade_entries where id = v_id;

  if v_ww_after is distinct from v_ww_before or v_pt_after is distinct from v_pt_before then
    raise exception
      'Derive trigger still deletes marks: entry % ww % -> %, pt % -> %',
      v_id, v_ww_before, v_ww_after, v_pt_before, v_pt_after;
  end if;
  if v_q_after is distinct from v_q_before then
    raise exception
      'Derive trigger still overwrites an uncomputable grade: entry % went from % to %',
      v_id, v_q_before, v_q_after;
  end if;

  raise notice 'Verified on entry %: marks % and grade % all survived a write.',
    v_id, v_ww_before, v_q_before;

  raise exception using errcode = 'HFRBK', message = 'rollback probe';
exception
  when sqlstate 'HFRBK' then
    raise notice 'Probe rolled back; no row was changed.';
end;
$$;

-- ---------------------------------------------------------------------------
-- One more kind for the report
-- ---------------------------------------------------------------------------
--
-- `sheet_not_configured` — the sheet has no maxes for a component that carries
-- marks, so no percentage exists to compare against. 758 rows landed in
-- `mismatch` for this reason on the first classified run, which made the report
-- say the port was wrong 758 times when it was not wrong once.
drop function if exists public.grade_formula_port_diff();

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
           when ge.quarterly_grade is not distinct from c.quarterly_grade::smallint
            and ge.initial_grade is null
             then 'initial_not_stored'
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
     sc.ww_weight, sc.pt_weight, sc.qa_weight
   ) c
   where ge.quarterly_grade is distinct from c.quarterly_grade::smallint
      or ge.initial_grade is distinct from round(c.initial_grade::numeric, 4);
$$;
