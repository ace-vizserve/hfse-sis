-- ═════════════════════════════════════════════════════════════════════
-- Migration 083 — grading_method='no_sheet' filter in the sheet-creation
-- RPCs (Config-Driven Subject Registry + Secondary Tracks, Phase 2 / Task
-- 2; plan: C:\Users\Ace\.claude\plans\my-bad-its-not-graceful-creek.md).
--
-- Context: migration 082 (Task 1) added `subjects.grading_method` — a
-- flag distinguishing "has a normal WW/PT/QA grading sheet"
-- (`standard_sheet`, the default) from "recorded some other way, don't
-- generate a sheet" (`no_sheet`). The flag existed but nothing read it
-- yet — every subject still got a grading sheet regardless. This
-- migration closes that gap: `create_grading_sheets_for_ay`,
-- `create_grading_sheets_for_section`, and `create_grading_sheets_for_scopes`
-- (all three `create_grading_sheets_for_*` RPCs, KD #119 hazard) now
-- exclude `grading_method='no_sheet'` subjects from the candidate set
-- that decides which sheets to create. Attaching such a subject to a
-- section (section_subjects row) still succeeds — it just produces no
-- grid, by design (brief item 2).
--
-- KD #119 hazard discipline — newest live body confirmed BEFORE writing
-- this migration: grepped every migration 001-082 for
-- `create_grading_sheets_for_ay` / `_for_section` / `_for_scopes`.
-- Migration 080 (subject_weights_collapse) §8 is the newest — its own
-- header comment documents it as a re-emit of migration 036 (`_for_ay`/
-- `_for_section`) + migration 060 (`_for_scopes`), and no migration
-- 081/082 touches these three function names (grepped, zero hits).
-- Migration 080's bodies (§8, roughly lines 1034-1358 of
-- 080_subject_weights_collapse.sql) are therefore the base re-emitted
-- here. The diff against that base is exactly:
--   (a) `_for_ay` / `_for_section` candidate CTE: add
--       `join public.subjects subj on subj.id = sc.subject_id` and
--       `and subj.grading_method <> 'no_sheet'` to the where clause.
--   (b) `_for_scopes` single-row config lookup: same join + same
--       predicate — a no_sheet subject now falls through the existing
--       `if not found then continue;` skip-silently branch, no new
--       control-flow path needed.
-- Every other line (comments, step numbering, insert/update logic,
-- return shapes, grants, RLS posture) is byte-identical to migration
-- 080 — no other behavior changes.
-- ═════════════════════════════════════════════════════════════════════

begin;

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
  -- defaults from subject_configs. Eligibility (which subjects a section
  -- gets sheets for) resolves through section_subjects — the per-section
  -- subject list (migration 079, level defaults + overrides) — NOT a bare
  -- sections↔subject_configs join on academic_year_id alone, which would
  -- cross every section against every subject in the AY regardless of
  -- level now that subject_configs has no level_id to filter on. Weight
  -- itself resolves by subject_id alone (migration 080 collapse).
  --
  -- Migration 083: subjects with grading_method='no_sheet' (migration
  -- 082) are excluded here — they get a section_subjects row (still
  -- "attached") but never a grading_sheets row.
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
    join public.section_subjects ss
      on ss.section_id = s.id
    join public.subject_configs sc
      on sc.id = ss.subject_config_id
    join public.subjects subj
      on subj.id = sc.subject_id
    join public.terms t
      on t.academic_year_id = s.academic_year_id
    where s.academic_year_id = p_ay_id
      and subj.grading_method <> 'no_sheet'
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
  'Idempotent bulk-create + self-heal of (term × section × subject) grading sheets for every (section, subject_config) pair in the AY. Defaults ww_totals/pt_totals/qa_total from subject_configs. Repairs pre-existing unconfigured sheets and resizes empty entry score arrays in place. Skips subjects with grading_method=''no_sheet'' (migration 083). Returns {ay_id, inserted, repaired_unconfigured_sheets, resized_entry_arrays, sheets_seeded}.';

revoke all on function public.create_grading_sheets_for_ay(uuid) from public;
grant execute on function public.create_grading_sheets_for_ay(uuid) to service_role;

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
  -- Step 1: Insert any missing sheets with defaults. Eligibility resolves
  -- through section_subjects, same reasoning as create_grading_sheets_for_ay
  -- above — a bare sections↔subject_configs join on academic_year_id alone
  -- would pull in every subject in the AY regardless of level.
  --
  -- Migration 083: subjects with grading_method='no_sheet' (migration
  -- 082) are excluded here — they get a section_subjects row (still
  -- "attached") but never a grading_sheets row.
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
    join public.section_subjects ss
      on ss.section_id = s.id
    join public.subject_configs sc
      on sc.id = ss.subject_config_id
    join public.subjects subj
      on subj.id = sc.subject_id
    join public.terms t
      on t.academic_year_id = s.academic_year_id
    where s.id = p_section_id
      and subj.grading_method <> 'no_sheet'
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
  'Idempotent bulk-create + self-heal for one section across every subject offered at its level (via subject_configs, one row per subject as of migration 080) × every term in its AY. Repairs pre-existing unconfigured sheets in place and resizes empty entry score arrays. Skips subjects with grading_method=''no_sheet'' (migration 083). Returns {section_id, inserted, repaired_unconfigured_sheets, resized_entry_arrays, sheets_seeded}.';

revoke all on function public.create_grading_sheets_for_section(uuid) from public;
grant execute on function public.create_grading_sheets_for_section(uuid) to service_role;

commit;

begin;

create or replace function public.create_grading_sheets_for_scopes(p_scopes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope        jsonb;
  v_section_id   uuid;
  v_subject_id   uuid;
  v_term_id      uuid;
  v_config_id    uuid;
  v_ww_slots     int;
  v_pt_slots     int;
  v_qa_max       int;
  v_new_sheet_id uuid;
  v_inserted     int := 0;
begin
  for v_scope in select value from jsonb_array_elements(p_scopes)
  loop
    v_section_id := (v_scope->>'section_id')::uuid;
    v_subject_id := (v_scope->>'subject_id')::uuid;
    v_term_id    := (v_scope->>'term_id')::uuid;

    -- Derive subject config from the section's AY + the scope's subject —
    -- one weight row per (subject, AY) now (migration 080), so no level
    -- join is needed to disambiguate. Migration 083: also join subjects
    -- and require grading_method <> 'no_sheet' — a no_sheet subject now
    -- falls through the existing "not found → skip silently" branch
    -- below, same as a scope with no matching config at all.
    select sc.id, sc.ww_max_slots, sc.pt_max_slots, sc.qa_max
      into v_config_id, v_ww_slots, v_pt_slots, v_qa_max
      from public.subject_configs sc
      join public.sections s on s.academic_year_id = sc.academic_year_id
      join public.subjects subj on subj.id = sc.subject_id
     where s.id = v_section_id
       and sc.subject_id = v_subject_id
       and subj.grading_method <> 'no_sheet'
     limit 1;

    if not found then
      continue; -- no config for this scope (or grading_method='no_sheet'), skip silently
    end if;

    -- Insert sheet (ON CONFLICT DO NOTHING — idempotent)
    insert into public.grading_sheets (
      section_id, subject_id, term_id, subject_config_id,
      ww_totals, pt_totals, qa_total
    )
    values (
      v_section_id, v_subject_id, v_term_id, v_config_id,
      array(select 10::numeric from generate_series(1, v_ww_slots)),
      array(select 10::numeric from generate_series(1, v_pt_slots)),
      v_qa_max
    )
    on conflict (section_id, subject_id, term_id) do nothing
    returning id into v_new_sheet_id;

    if v_new_sheet_id is not null then
      v_inserted := v_inserted + 1;

      -- Seed null-filled grade_entries for active + late-enrolled students
      insert into public.grade_entries (
        grading_sheet_id, section_student_id, ww_scores, pt_scores
      )
      select
        v_new_sheet_id,
        ss.id,
        array(select null::numeric from generate_series(1, v_ww_slots)),
        array(select null::numeric from generate_series(1, v_pt_slots))
      from public.section_students ss
      where ss.section_id = v_section_id
        and ss.enrollment_status in ('active', 'late_enrollee')
      on conflict (grading_sheet_id, section_student_id) do nothing;
    end if;

  end loop;

  return jsonb_build_object('inserted', v_inserted);
end;
$$;

comment on function public.create_grading_sheets_for_scopes(jsonb) is
  'Explicit-scope grading-sheet bulk-create ((section_id, subject_id, term_id) triples). Derives subject_config from the section''s AY + scope subject; skips a scope silently when no matching config exists OR the subject''s grading_method=''no_sheet'' (migration 083). Returns {inserted}.';

revoke all on function public.create_grading_sheets_for_scopes(jsonb) from public;
grant execute on function public.create_grading_sheets_for_scopes(jsonb) to service_role;

commit;

-- ═════════════════════════════════════════════════════════════════════
-- Post-apply verification queries:
--
--   -- 1. Confirm the filter is live — a no_sheet subject's
--   --    section_subjects row should NEVER produce a grading_sheets row,
--   --    even after re-running the bulk RPC.
--   select subj.code, subj.grading_method, count(gs.id) as sheet_count
--   from public.subjects subj
--   join public.subject_configs sc on sc.subject_id = subj.id
--   join public.section_subjects ss on ss.subject_config_id = sc.id
--   left join public.grading_sheets gs on gs.subject_config_id = sc.id
--   where subj.grading_method = 'no_sheet'
--   group by subj.code, subj.grading_method;
--   -- Expect: sheet_count = 0 for every no_sheet subject that has a
--   -- section_subjects row (any nonzero count predates this migration
--   -- and would need a manual cleanup — not expected on a fresh AY9999
--   -- test env since Task 1's 4 new subjects are all standard_sheet).
--
--   -- 2. Confirm standard_sheet subjects are unaffected (regression
--   --    check — every existing subject's sheet count should be
--   --    unchanged by this migration; run once before and once after).
--   select subj.code, count(gs.id) as sheet_count
--   from public.subjects subj
--   join public.subject_configs sc on sc.subject_id = subj.id
--   left join public.grading_sheets gs on gs.subject_config_id = sc.id
--   where subj.grading_method = 'standard_sheet'
--   group by subj.code
--   order by subj.code;
-- ═════════════════════════════════════════════════════════════════════
