-- Migration 153 — the derive trigger must never erase a grade it cannot recompute
--
-- 🔴 FIXES A DATA-LOSS BUG INTRODUCED BY MIGRATION 152. Apply this before
-- anyone clicks "Generate sheets" on an academic year that holds imported
-- grades.
--
-- WHAT 152 GOT WRONG.
--
-- 152's BEFORE trigger derives `ww_ps / pt_ps / qa_ps / initial_grade /
-- quarterly_grade` from the raw scores on EVERY write. That is right for a
-- sheet a teacher fills in, and wrong for a row whose grade never came from
-- scores in the first place.
--
-- 3,714 grade entries in this database have NO SCORES AT ALL and a stored
-- quarterly grade between 70 and 95 — historical results imported as a final
-- number, with no component marks behind them. 274 of the 300 sampled have
-- EMPTY score arrays, which is precisely the shape
-- `create_grading_sheets_for_ay` Step 3 goes looking for when it resizes
-- entry arrays to match a sheet's slot count:
--
--     and coalesce(array_length(ge.ww_scores, 1), 0) = 0
--     and coalesce(array_length(ge.pt_scores, 1), 0) = 0
--
-- Before 152 that resize was harmless — it widened two empty arrays and left
-- the grade alone. After 152 it fires the derive trigger, the trigger finds no
-- scores, computes null, and a stored 95 becomes nothing. Clicking "Generate
-- sheets" once would have done that to thousands of rows at a stroke.
--
-- ⚠ THE PRE-152 ROUTE HAD THE SAME BLIND SPOT AND IT DID NOT MATTER, which is
-- why this was never seen. `computeQuarterly` on a blank entry returns nulls
-- and the route wrote them; but the route only ran when someone edited that
-- entry through the grading page, and these sheets are locked, so the teacher
-- path 403s and the registrar path needs an approved change request. A trigger
-- has no such luck — it fires for every writer, service-role backfills and
-- maintenance RPCs included. Moving a rule into the database widens its blast
-- radius, and that is the part to check, not just whether the rule is right.
--
-- THE RULE, STATED PLAINLY: a grade that cannot be recomputed is not erased.
--
--   new row has no scores, old row had none either
--       -> there is nothing to compute FROM and nothing was cleared.
--          Keep whatever derived values are already on the row, and let an
--          explicitly supplied value win.
--   old row had scores, new row has none
--       -> the teacher cleared the last mark. Recompute, which nulls them.
--          That is a real edit and must go through.
--   new row has any score
--       -> recompute as normal. Once a sheet is being scored, the scores are
--          the truth, and they replace an imported number.
--
-- `coalesce(new.<col>, old.<col>)` is doing the careful half of that. The
-- alternative — carrying OLD forward unconditionally — would have silently
-- DROPPED the AY2025 grade backfill still waiting on Ms JoAnn, because those
-- land as writes to exactly these blank-score rows. An explicit value always
-- wins; only a null that came from "I could not work this out" is refused.

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
  v_new_has_scores boolean;
  v_old_has_scores boolean;
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

  -- ---- normalise the score arrays to the sheet's slot count ----------------
  select coalesce(array_agg((new.ww_scores)[i] order by i), '{}'::numeric[])
    into v_scores
    from generate_series(1, coalesce(array_length(v_sheet.ww_totals, 1), 0)) as i;
  new.ww_scores := v_scores;

  select coalesce(array_agg((new.pt_scores)[i] order by i), '{}'::numeric[])
    into v_scores
    from generate_series(1, coalesce(array_length(v_sheet.pt_totals, 1), 0)) as i;
  new.pt_scores := v_scores;

  -- ---- every score within [0, its max] ------------------------------------
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

  -- ---- is there anything to compute FROM? ---------------------------------
  -- A single non-null mark anywhere is enough. Spelled as an `unnest` rather
  -- than `array_remove(arr, null)` on purpose: array_remove's behaviour for a
  -- NULL needle is a detail not worth betting a grade on, and this says what it
  -- means.
  v_new_has_scores :=
       new.qa_score is not null
    or exists (select 1 from unnest(coalesce(new.ww_scores, '{}')) v where v is not null)
    or exists (select 1 from unnest(coalesce(new.pt_scores, '{}')) v where v is not null);

  v_old_has_scores := tg_op = 'UPDATE' and (
       old.qa_score is not null
    or exists (select 1 from unnest(coalesce(old.ww_scores, '{}')) v where v is not null)
    or exists (select 1 from unnest(coalesce(old.pt_scores, '{}')) v where v is not null)
  );

  -- 🔴 THE FIX. No scores now, no scores before: there is nothing to work out
  -- and nothing was cleared, so the derived columns are not this trigger's to
  -- touch. An imported grade survives an array resize, a roster re-seed, or any
  -- other write that never mentioned a score.
  if not v_new_has_scores and not v_old_has_scores then
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
-- Prove the fix, at apply time
-- ---------------------------------------------------------------------------
--
-- Against a real row, inside a transaction that is rolled back, so this leaves
-- nothing behind. Picks the worst-shaped row it can find — blank scores, a
-- stored grade, empty arrays — and does to it exactly what
-- `create_grading_sheets_for_ay` Step 3 does.
do $$
declare
  v_id       uuid;
  v_before   smallint;
  v_after    smallint;
begin
  select ge.id, ge.quarterly_grade
    into v_id, v_before
    from public.grade_entries ge
    join public.grading_sheets gs on gs.id = ge.grading_sheet_id
   where ge.quarterly_grade is not null
     and ge.qa_score is null
     and not exists (select 1 from unnest(coalesce(ge.ww_scores, '{}')) v where v is not null)
     and not exists (select 1 from unnest(coalesce(ge.pt_scores, '{}')) v where v is not null)
     -- Both non-empty, so the `array_fill` below never gets a zero dimension.
     and coalesce(array_length(gs.ww_totals, 1), 0) > 0
     and coalesce(array_length(gs.pt_totals, 1), 0) > 0
   limit 1;

  if v_id is null then
    raise notice 'No blank-score row with a stored grade found — nothing to prove against.';
    return;
  end if;

  -- The resize, verbatim in shape.
  update public.grade_entries ge
     set ww_scores = array_fill(null::numeric, array[coalesce(array_length(gs.ww_totals, 1), 0)]),
         pt_scores = array_fill(null::numeric, array[coalesce(array_length(gs.pt_totals, 1), 0)])
    from public.grading_sheets gs
   where ge.grading_sheet_id = gs.id
     and ge.id = v_id;

  select quarterly_grade into v_after from public.grade_entries where id = v_id;

  if v_after is distinct from v_before then
    raise exception
      'Derive trigger still erases an imported grade: entry % went from % to %',
      v_id, v_before, v_after;
  end if;

  raise notice 'Verified on entry %: a resize left the stored grade at %.', v_id, v_before;

  -- Leave the database exactly as found.
  raise exception using errcode = 'HFRBK', message = 'rollback probe';
exception
  when sqlstate 'HFRBK' then
    raise notice 'Probe rolled back; no row was changed.';
end;
$$;

-- ---------------------------------------------------------------------------
-- Report the port's disagreements by KIND, not as one undifferentiated pile
-- ---------------------------------------------------------------------------
--
-- 152's version returned every row where the SQL formula and the stored value
-- differ, which turned out to be 10,540 rows — and all but one of them were
-- history, not a formula bug. A check that cannot tell those apart is a check
-- nobody will read twice. This labels each row:
--
--   imported_no_scores  — no marks on the entry, but a grade is stored. The
--                         formula has nothing to work from; migration 153 now
--                         leaves these alone. History, not a bug.
--   initial_not_stored  — the quarterly grade agrees; `initial_grade` was
--                         simply never written by the older code. The next
--                         genuine write fills it in.
--   stale               — the sheet's maxes or weights were edited AFTER this
--                         entry was last saved, so the stored number is the
--                         right answer to an older question.
--                         `recompute_grade_entries_for_sheet` fixes it.
--   mismatch            — same inputs, different answer. The only kind that
--                         means the port is wrong.
--
-- ⚠ DROP FIRST, NOT `create or replace`. Adding the `kind` column changes the
-- row type the OUT parameters define, and Postgres refuses to replace a
-- set-returning function's return type in place:
--   "42P13: cannot change return type of existing function".
-- Safe to drop — it is a read-only diagnostic introduced by 152, and nothing in
-- the app calls it except `scripts/verify-grading-formula-port.perf.ts`.
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
