-- 108_sync_stops_clobbering_qa_total.sql
--
-- Stops sync_grading_sheets_from_config from writing qa_total.
--
-- WHY. HFSE agrees a Scheme of Work before each academic year, and the SOW is
-- what a subject-config save expresses: set the shape once, every section
-- adopts it. That broadcast is correct and stays. Mid-year changes happen too
-- — "rare but not impossible" — and that is where the current behaviour bites.
--
-- The RPC wrote `qa_total = v_qa_max` UNCONDITIONALLY to every unlocked sheet
-- on every save, including saves that only touched a slot count. A per-section
-- exam total — a Secondary paper marked out of 140 while the rest of the level
-- sits at 100 — was therefore reverted to the subject default by an unrelated
-- edit, silently, with the teacher who set it never told.
--
-- The values themselves are per (term x section x subject) by design: they
-- live on grading_sheets, and production already runs eleven different Maths
-- exam totals across sections. The config carries a per-subject CEILING. This
-- migration stops the ceiling from behaving like a value.
--
-- WHERE THE LOGIC WENT. Into TypeScript — lib/grading/sync-config-sheets.ts,
-- alongside the recompute that migration 107 moved there for the same reason.
-- The rule needs the PREVIOUS qa_max to tell "never customised" from
-- "deliberately set", and by the time this function runs the config row has
-- already been updated, so the old value is gone from the database. The
-- caller still has it. Splitting cleanly: SQL owns array SHAPE, TypeScript
-- owns VALUES.
--
-- The caller reads each sheet's qa_total BEFORE invoking the RPC, so it is
-- correct whether or not this migration has been applied — deploy in either
-- order. Once applied, the RPC simply stops fighting it.
--
-- Everything else — the array resize, the sheet_ids return added by 107, the
-- locked-sheet exclusion — is unchanged. Safe to re-run.

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
