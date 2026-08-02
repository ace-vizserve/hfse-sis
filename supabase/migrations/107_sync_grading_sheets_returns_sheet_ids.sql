-- 107_sync_grading_sheets_returns_sheet_ids.sql
--
-- Two changes to sync_grading_sheets_from_config, one functional and one
-- security. Both are safe to re-run.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 1. RETURN THE SHEET IDS IT TOUCHED
--
-- The RPC resizes ww_totals / pt_totals / qa_total on every unlocked sheet
-- for a config, and resizes the matching grade_entries score arrays. It does
-- NOT recompute ww_ps / pt_ps / qa_ps / initial_grade / quarterly_grade, and
-- being a SQL function it cannot: lib/compute/quarterly.ts is the single
-- source of truth for the formula (Hard Rule #2) and there must not be a
-- second copy of the transmutation table in PL/pgSQL.
--
-- So the denominator moved and the stored grade did not. That stored
-- quarterly_grade is what the report card prints
-- (lib/report-card/build-report-card.ts reads it directly), so it is a wrong
-- grade rather than a stale cache, and it stays wrong until someone happens
-- to re-save a score on that sheet.
--
-- The recompute now happens in the caller
-- (app/api/sis/admin/subjects/[configId]/route.ts, via
-- lib/grading/recompute-sheet.ts). For that the caller has to know WHICH
-- sheets were touched. Re-querying by config id afterwards would race: a
-- sheet locked between the RPC and the follow-up query would have been
-- resized and never recomputed, leaving a stale LOCKED sheet — the worst
-- case, since locked sheets are the ones feeding published report cards.
-- Returning the ids from inside the loop closes that window.
--
-- The two existing keys are unchanged, so a deployed older build reading only
-- `updated_sheets` keeps working: this migration is safe to apply before the
-- code that uses it.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 2. LOCK IT DOWN (KD #167)
--
-- This function is SECURITY DEFINER and was MISSED by migrations 103 and 104,
-- which revoked the other seven definer RPCs. Verified: it appears in neither
-- one's list. Supabase grants EXECUTE on functions in `public` to `anon` and
-- `authenticated` directly, so — exactly as 104 documents — it has been
-- callable through PostgREST by any anon-key holder this whole time, and
-- DEFINER means it bypasses both RLS and migration 004's blanket write denial.
--
-- What that buys an attacker is not cosmetic. The function TRUNCATES
-- grade_entries.ww_scores / pt_scores (`[1:v_max_slots]`) on every unlocked
-- sheet for the config, so a caller supplying a subject_config id destroys
-- real marks. It takes a uuid it cannot guess, but config ids appear in admin
-- URLs and API responses, so this is a leak away from being live.
--
-- CREATE OR REPLACE preserves existing privileges, so the revoke has to be
-- explicit and has to name `anon` — 103 failed precisely by omitting it.
-- Verify with the anon key afterwards: expect 42501 permission denied, not an
-- execution error.

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
  -- Load config values.
  SELECT ww_max_slots, pt_max_slots, qa_max
  INTO v_ww_max_slots, v_pt_max_slots, v_qa_max
  FROM subject_configs
  WHERE id = p_config_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'subject_config % not found', p_config_id;
  END IF;

  -- Iterate over every unlocked grading sheet that uses this config.
  FOR v_sheet IN
    SELECT id, ww_totals, pt_totals
    FROM grading_sheets
    WHERE subject_config_id = p_config_id
      AND is_locked = false
  LOOP
    -- ── WW totals ──────────────────────────────────────────────────────────
    v_old_ww_len := COALESCE(array_length(v_sheet.ww_totals, 1), 0);
    v_new_ww_totals := v_sheet.ww_totals;

    IF v_old_ww_len < v_ww_max_slots THEN
      -- Extend: pad with default max score of 10.
      v_new_ww_totals := v_sheet.ww_totals
        || array_fill(10::numeric, ARRAY[v_ww_max_slots - v_old_ww_len]);
    ELSIF v_old_ww_len > v_ww_max_slots THEN
      -- Truncate.
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
    UPDATE grading_sheets
    SET
      ww_totals  = v_new_ww_totals,
      pt_totals  = v_new_pt_totals,
      qa_total   = v_qa_max,
      updated_at = now()
    WHERE id = v_sheet.id;

    v_updated_sheets := v_updated_sheets + 1;
    v_sheet_ids := v_sheet_ids || v_sheet.id;

    -- ── Resize grade_entries arrays ────────────────────────────────────────
    -- WW scores: extend with NULL for new slots; truncate if shrinking.
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

    -- PT scores.
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
    -- New in 107. The caller recomputes these sheets; see the header.
    'sheet_ids',       COALESCE(to_jsonb(v_sheet_ids), '[]'::jsonb)
  );
END;
$$;

-- KD #167 lockdown — see header section 2. Names `anon` explicitly, which is
-- the omission that made migration 103 ineffective.
do $$
declare
  fn text := 'public.sync_grading_sheets_from_config(uuid)';
begin
  if to_regprocedure(fn) is not null then
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  else
    raise notice 'skipping %, no such function', fn;
  end if;
end $$;
