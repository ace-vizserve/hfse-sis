-- Migration 155 — name the last two kinds of disagreement honestly
--
-- No behaviour changes here. This is the diagnostic from 152/153/154 finishing
-- the job of telling the truth about what it found, so that a future run either
-- says "nothing wrong" or points at something real.
--
-- THE PORT IS CORRECT. That is now measured, not asserted. For all 270 rows
-- still landing in `mismatch` after 154, `lib/compute/quarterly.ts` was run in
-- Node against the exact same inputs the SQL was given:
--
--     TS agrees with SQL          : 270
--     TS agrees with STORED value : 0
--     TS agrees with neither      : 0
--
-- So in every remaining case the two formulas agree with EACH OTHER and the
-- stored number came from somewhere else. `mismatch` was the wrong label for
-- all of them.
--
-- THE TWO REMAINING KINDS.
--
-- `derived_never_computed` (269 rows) — `initial_grade` is null while a
-- quarterly grade is stored. The current formula has never written this row's
-- derived block; the grade arrived by import. Whether the stored quarterly
-- happens to match what the formula would say is incidental, so the old
-- `initial_not_stored` label, which only covered the rows where it DID match,
-- was splitting one population in two on a coincidence. Both halves are the
-- same thing and are now named as such.
--
-- `legacy_rounding` (1 row) — the quarterly grade agrees, and `initial_grade`
-- differs in the fourth decimal only: stored 89.8740 against a computed
-- 89.8739. TS gives 89.87394957983194, which rounds to 89.8739, so the stored
-- value is not this formula's output either — it is an older writer's, rounded
-- to three decimals and widened on storage. No grade is affected. The bound is
-- 0.001 rather than "anything close", because a difference that can move a
-- floor boundary must not be waved through as rounding.
--
-- ⚠ WHAT IS *NOT* BEING DONE HERE, DELIBERATELY. 3,476 entries carry a grade
-- with no marks behind it and 269 carry one their marks do not produce. Those
-- are real, and they are history: imported results on locked sheets. Nothing in
-- this migration recomputes or "corrects" them. Overwriting a stored historical
-- grade with a freshly computed one is a decision about a child's record, not a
-- tidy-up, and it is Mr Ace's to make — Hard Rule #6 exists for exactly this.
-- The report names them so the choice can be made with the numbers in view.

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
           -- No marks at all, but a grade is stored: imported result.
           when ge.qa_score is null
            and not exists (select 1 from unnest(coalesce(ge.ww_scores, '{}')) v where v is not null)
            and not exists (select 1 from unnest(coalesce(ge.pt_scores, '{}')) v where v is not null)
             then 'imported_no_scores'
           -- Marks, but the sheet has no maxes for them: no percentage exists.
           when (exists (select 1 from unnest(coalesce(ge.ww_scores, '{}')) v where v is not null)
                 and coalesce(array_length(gs.ww_totals, 1), 0) = 0)
             or (exists (select 1 from unnest(coalesce(ge.pt_scores, '{}')) v where v is not null)
                 and coalesce(array_length(gs.pt_totals, 1), 0) = 0)
             then 'sheet_not_configured'
           -- The current formula never wrote this row's derived values.
           when ge.initial_grade is null
             then 'derived_never_computed'
           -- Same grade; an older writer stored the intermediate to fewer
           -- decimals. Bounded tightly — a bigger gap could move a floor.
           when ge.quarterly_grade is not distinct from c.quarterly_grade::smallint
            and ge.initial_grade is not null
            and c.initial_grade is not null
            and abs(ge.initial_grade - round(c.initial_grade::numeric, 4)) < 0.001
             then 'legacy_rounding'
           -- The sheet's maxes or weights moved after this entry was saved.
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
