-- 036_seed_grade_entries.sql
--
-- Sheet-roster sync — ensures every section_student has a grade_entries
-- row for every grading sheet covering their section. Closes the bug where
-- the grading grid (`/markbook/grading/[id]`) only showed students who
-- already had scores saved, because the page sources rows from
-- `grade_entries` joined to `section_students`. Sheets are per-section
-- (`grading_sheets` is keyed by `(term, section, subject)`); entries
-- materialize the per-student rows inside that sheet.
--
-- Two surfaces:
--
--   1. `seed_grade_entries_for_sheet(p_sheet_id, p_section_id)` — seeds
--      one sheet's entries against the current section roster. Called by:
--        - the grading sheet page on render (self-healing safety net for
--          late enrollees added after sheet generation)
--        - the bulk-create RPCs below (so initial generate covers the
--          roster upfront and the page-open seed becomes a no-op)
--
--   2. Extensions to `create_grading_sheets_for_ay` and
--      `create_grading_sheets_for_section` (migration 016) — after the
--      INSERT...ON CONFLICT for sheets, iterate every newly-inserted
--      sheet and call the seed function so entries land in the same
--      transaction.
--
-- Idempotent throughout — ON CONFLICT DO NOTHING via the unique
-- constraint added in migration 035. Default values on grade_entries
-- (per migration 001 lines 147-167) cover every column the insert
-- doesn't set explicitly.

-- ─── Seed RPC ─────────────────────────────────────────────────────────
--
-- Pre-sizes each new entry's score arrays to match the sheet's slot
-- counts (`ww_totals` / `pt_totals` on `grading_sheets`). For a typical
-- HFSE sheet with W1–W5 + P1–P5 configured, every seeded entry lands
-- with `ww_scores = [null,null,null,null,null]` and `pt_scores =
-- [null,null,null,null,null]` so the grid renders one fillable cell per
-- declared slot from the moment the row exists. When the sheet has no
-- totals yet (pre-configuration), arrays land as `'{}'` — same as
-- before — and resize lazily once the registrar sets totals.

create or replace function public.seed_grade_entries_for_sheet(
  p_sheet_id uuid,
  p_section_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
  v_ww_len int;
  v_pt_len int;
  v_ww_arr numeric[];
  v_pt_arr numeric[];
begin
  -- Resolve the sheet's current slot counts. Empty arrays → length 0 →
  -- entry gets `'{}'` which matches the column default.
  select
    coalesce(array_length(ww_totals, 1), 0),
    coalesce(array_length(pt_totals, 1), 0)
  into v_ww_len, v_pt_len
  from public.grading_sheets
  where id = p_sheet_id;

  v_ww_arr := case
    when v_ww_len > 0 then array_fill(null::numeric, array[v_ww_len])
    else '{}'::numeric[]
  end;
  v_pt_arr := case
    when v_pt_len > 0 then array_fill(null::numeric, array[v_pt_len])
    else '{}'::numeric[]
  end;

  with ins as (
    insert into public.grade_entries (grading_sheet_id, section_student_id, ww_scores, pt_scores)
    select p_sheet_id, ss.id, v_ww_arr, v_pt_arr
    from public.section_students ss
    where ss.section_id = p_section_id
    on conflict (grading_sheet_id, section_student_id) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  return jsonb_build_object(
    'sheet_id', p_sheet_id,
    'section_id', p_section_id,
    'inserted', coalesce(v_inserted, 0),
    'ww_slots', v_ww_len,
    'pt_slots', v_pt_len
  );
end;
$$;

comment on function public.seed_grade_entries_for_sheet(uuid, uuid) is
  'Idempotent — ensures one grade_entries row per (sheet, section_student) for the given sheet + section. Called on page render + at bulk sheet generate time.';

grant execute on function public.seed_grade_entries_for_sheet(uuid, uuid) to authenticated;

-- ─── Extend create_grading_sheets_for_ay ─────────────────────────────

-- Per-slot raw max default. HFSE convention is 10 per assessment slot —
-- matches Hard Rule #1's canonical test case (WW=[10,10] / max=[10,10]).
-- Registrars override via TotalsEditor when a particular sheet needs
-- different per-slot maxes; this is just the seed value so newly-created
-- sheets land with `ww_totals=[10,10,10,10,10]` and `pt_totals=[10,10,10,10,10]`
-- already populated, instead of the registrar having to fill 1200+ sheets
-- by hand.
--
-- Self-healing: re-clicking Generate sheets on an AY whose sheets were
-- created before this RPC's defaults logic was in place repairs them in
-- place via the `unconfigured` UPDATE step. Sheets that the registrar
-- has manually customized (any non-empty `ww_totals` / `pt_totals` or
-- non-null `qa_total`) are NOT touched.
create or replace function public.create_grading_sheets_for_ay(p_ay_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
  v_repaired int;
  v_resized int;
  v_seeded int := 0;
  v_sheet record;
begin
  -- Step 1: Insert any missing (term × section × subject) sheets with
  -- defaults from subject_configs.
  with candidate as (
    select
      t.id        as term_id,
      s.id        as section_id,
      sc.subject_id as subject_id,
      sc.id       as subject_config_id,
      sc.ww_max_slots as ww_max_slots,
      sc.pt_max_slots as pt_max_slots,
      sc.qa_max as qa_max
    from public.sections s
    join public.subject_configs sc
      on sc.academic_year_id = s.academic_year_id
     and sc.level_id = s.level_id
    join public.terms t
      on t.academic_year_id = s.academic_year_id
    where s.academic_year_id = p_ay_id
  ),
  ins as (
    insert into public.grading_sheets
      (term_id, section_id, subject_id, subject_config_id, is_locked,
       ww_totals, pt_totals, qa_total)
    select
      term_id, section_id, subject_id, subject_config_id, false,
      array_fill(10::numeric, array[ww_max_slots]),
      array_fill(10::numeric, array[pt_max_slots]),
      qa_max
    from candidate
    on conflict (term_id, section_id, subject_id) do nothing
    returning id, section_id
  )
  select count(*) into v_inserted from ins;

  -- Step 2: Repair pre-existing sheets that were created before this
  -- RPC's defaults logic was in place. Only touches sheets in the
  -- unconfigured-default state (empty arrays AND null qa_total) so any
  -- registrar-customized sheet keeps its values.
  with repair as (
    update public.grading_sheets gs
    set
      ww_totals = array_fill(10::numeric, array[sc.ww_max_slots]),
      pt_totals = array_fill(10::numeric, array[sc.pt_max_slots]),
      qa_total = sc.qa_max
    from public.subject_configs sc, public.sections s
    where gs.subject_config_id = sc.id
      and gs.section_id = s.id
      and s.academic_year_id = p_ay_id
      and coalesce(array_length(gs.ww_totals, 1), 0) = 0
      and coalesce(array_length(gs.pt_totals, 1), 0) = 0
      and gs.qa_total is null
    returning gs.id
  )
  select count(*) into v_repaired from repair;

  -- Step 3: Resize existing grade_entries score arrays whose ww_scores /
  -- pt_scores are still empty so they match the (now-defaulted) sheet's
  -- slot count. Without this step, entries created before step 2 would
  -- carry length-0 score arrays forever and the grid would render
  -- columns but no fillable cells. Only touches entries with empty
  -- arrays — registrar/teacher-saved scores are not affected.
  with resize as (
    update public.grade_entries ge
    set
      ww_scores = array_fill(null::numeric, array[coalesce(array_length(gs.ww_totals, 1), 0)]),
      pt_scores = array_fill(null::numeric, array[coalesce(array_length(gs.pt_totals, 1), 0)])
    from public.grading_sheets gs, public.sections s
    where ge.grading_sheet_id = gs.id
      and gs.section_id = s.id
      and s.academic_year_id = p_ay_id
      and coalesce(array_length(ge.ww_scores, 1), 0) = 0
      and coalesce(array_length(ge.pt_scores, 1), 0) = 0
      and (
        coalesce(array_length(gs.ww_totals, 1), 0) > 0
        or coalesce(array_length(gs.pt_totals, 1), 0) > 0
      )
    returning ge.id
  )
  select count(*) into v_resized from resize;

  -- Step 4: Seed entries for every sheet in this AY (covers both newly-
  -- inserted sheets AND any pre-existing ones whose roster has changed
  -- since generate). Idempotent — ON CONFLICT DO NOTHING.
  for v_sheet in
    select gs.id as sheet_id, gs.section_id
    from public.grading_sheets gs
    join public.sections s on s.id = gs.section_id
    where s.academic_year_id = p_ay_id
  loop
    perform public.seed_grade_entries_for_sheet(v_sheet.sheet_id, v_sheet.section_id);
    v_seeded := v_seeded + 1;
  end loop;

  return jsonb_build_object(
    'ay_id', p_ay_id,
    'inserted', coalesce(v_inserted, 0),
    'repaired_unconfigured_sheets', coalesce(v_repaired, 0),
    'resized_entry_arrays', coalesce(v_resized, 0),
    'sheets_seeded', v_seeded
  );
end;
$$;

comment on function public.create_grading_sheets_for_ay(uuid) is
  'Idempotent bulk-create + self-heal of (term × section × subject) grading sheets for every (section, subject_config) pair in the AY. Defaults ww_totals/pt_totals/qa_total from subject_configs. Repairs pre-existing unconfigured sheets and resizes empty entry score arrays in place. Returns {ay_id, inserted, repaired_unconfigured_sheets, resized_entry_arrays, sheets_seeded}.';

-- ─── Extend create_grading_sheets_for_section ────────────────────────

create or replace function public.create_grading_sheets_for_section(p_section_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
  v_repaired int;
  v_resized int;
  v_seeded int := 0;
  v_sheet record;
begin
  -- Step 1: Insert any missing sheets with defaults.
  with candidate as (
    select
      t.id        as term_id,
      s.id        as section_id,
      sc.subject_id as subject_id,
      sc.id       as subject_config_id,
      sc.ww_max_slots as ww_max_slots,
      sc.pt_max_slots as pt_max_slots,
      sc.qa_max as qa_max
    from public.sections s
    join public.subject_configs sc
      on sc.academic_year_id = s.academic_year_id
     and sc.level_id = s.level_id
    join public.terms t
      on t.academic_year_id = s.academic_year_id
    where s.id = p_section_id
  ),
  ins as (
    insert into public.grading_sheets
      (term_id, section_id, subject_id, subject_config_id, is_locked,
       ww_totals, pt_totals, qa_total)
    select
      term_id, section_id, subject_id, subject_config_id, false,
      array_fill(10::numeric, array[ww_max_slots]),
      array_fill(10::numeric, array[pt_max_slots]),
      qa_max
    from candidate
    on conflict (term_id, section_id, subject_id) do nothing
    returning id, section_id
  )
  select count(*) into v_inserted from ins;

  -- Step 2: Repair pre-existing unconfigured sheets in place.
  with repair as (
    update public.grading_sheets gs
    set
      ww_totals = array_fill(10::numeric, array[sc.ww_max_slots]),
      pt_totals = array_fill(10::numeric, array[sc.pt_max_slots]),
      qa_total = sc.qa_max
    from public.subject_configs sc
    where gs.subject_config_id = sc.id
      and gs.section_id = p_section_id
      and coalesce(array_length(gs.ww_totals, 1), 0) = 0
      and coalesce(array_length(gs.pt_totals, 1), 0) = 0
      and gs.qa_total is null
    returning gs.id
  )
  select count(*) into v_repaired from repair;

  -- Step 3: Resize empty entry score arrays for sheets in this section.
  with resize as (
    update public.grade_entries ge
    set
      ww_scores = array_fill(null::numeric, array[coalesce(array_length(gs.ww_totals, 1), 0)]),
      pt_scores = array_fill(null::numeric, array[coalesce(array_length(gs.pt_totals, 1), 0)])
    from public.grading_sheets gs
    where ge.grading_sheet_id = gs.id
      and gs.section_id = p_section_id
      and coalesce(array_length(ge.ww_scores, 1), 0) = 0
      and coalesce(array_length(ge.pt_scores, 1), 0) = 0
      and (
        coalesce(array_length(gs.ww_totals, 1), 0) > 0
        or coalesce(array_length(gs.pt_totals, 1), 0) > 0
      )
    returning ge.id
  )
  select count(*) into v_resized from resize;

  -- Step 4: Seed entries for every sheet on this section.
  for v_sheet in
    select id as sheet_id
    from public.grading_sheets
    where section_id = p_section_id
  loop
    perform public.seed_grade_entries_for_sheet(v_sheet.sheet_id, p_section_id);
    v_seeded := v_seeded + 1;
  end loop;

  return jsonb_build_object(
    'section_id', p_section_id,
    'inserted', coalesce(v_inserted, 0),
    'repaired_unconfigured_sheets', coalesce(v_repaired, 0),
    'resized_entry_arrays', coalesce(v_resized, 0),
    'sheets_seeded', v_seeded
  );
end;
$$;

comment on function public.create_grading_sheets_for_section(uuid) is
  'Idempotent bulk-create + self-heal for one section across every subject in its level × every term in its AY. Repairs pre-existing unconfigured sheets in place and resizes empty entry score arrays. Returns {section_id, inserted, repaired_unconfigured_sheets, resized_entry_arrays, sheets_seeded}.';
