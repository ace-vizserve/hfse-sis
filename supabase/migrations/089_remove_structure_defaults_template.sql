-- 089_remove_structure_defaults_template.sql
--
-- Removes the Structure Defaults (template) layer entirely. Verified
-- during design: create_academic_year (migration 080) already contains
-- the exact copy-forward mechanism this replaces it with, as a DORMANT
-- fallback — "Legacy fallback: most recent non-test AY (preserves
-- migration 030's behaviour for empty-template installs)" — gated on
-- v_use_template = false. It only activates today when the template
-- tables happen to be empty. This migration makes that fallback the ONLY
-- path: a new AY's sections/subject_configs/subject_level_offerings are
-- always copied from the most recently created non-test AY, unconditionally.
--
-- Adds the one genuinely new piece: an explicit, audit-logged confirmation
-- gate (structure_confirmed_at/by on academic_years) so a registrar must
-- acknowledge the carried-forward starting setup before the AY-readiness
-- checklist counts it done.
--
-- Idempotent + safe to re-run (DROP ... IF EXISTS, ADD COLUMN IF NOT
-- EXISTS, CREATE OR REPLACE). Apply on its own branch/timeline — no
-- ordering dependency on migrations 087/088.

-- =====================================================================
-- 1. Confirmation-gate columns.
-- =====================================================================

alter table public.academic_years
  add column if not exists structure_confirmed_at timestamptz null,
  add column if not exists structure_confirmed_by uuid null references auth.users(id);

comment on column public.academic_years.structure_confirmed_at is
  'When a registrar confirmed this AY''s carried-forward starting sections/subjects/weights. Null = not yet confirmed. See docs/superpowers/specs/2026-07-20-remove-structure-defaults-template-design.md.';

-- =====================================================================
-- 2. Drop the template layer.
-- =====================================================================

drop function if exists public.apply_template_to_ay(text);
drop table if exists public.template_subject_level_offerings;
drop table if exists public.template_subject_configs;
drop table if exists public.template_sections;

-- =====================================================================
-- 3. Re-emit create_academic_year — migration 086 body (the newest live
--    definition as of this migration's authoring, KD #119 hazard —
--    corrected during Phase 4 execution from an earlier draft of this
--    migration that mistakenly assumed migration 080 was newest; 086
--    (applied before this plan was written) already re-emitted the
--    function to drop step "4b" (the ay_level_offerings insert — that
--    table no longer exists, dropped by 086 alongside the volatile-level
--    catalog, KD #153's SUPERSEDED note) and to drop the
--    v_template_sections_count/v_template_configs_count/v_use_template
--    decision variables' *table existence*, though 086 itself still had
--    the v_use_template branch logic — THIS migration is what finally
--    removes that decision + every "if v_use_template ... elsif
--    v_source_ay_id ..." template branch, making the v_source_ay_id
--    ("most recent non-test AY") resolution unconditional. Every other
--    step (terms, sync_section_subjects_for_ay, admissions DDL, return
--    shape) is byte-identical to 086.
-- =====================================================================

create or replace function public.create_academic_year(
  p_ay_code text,
  p_label   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code             text := upper(trim(p_ay_code));
  v_label            text := trim(p_label);
  v_slug             text;
  v_ay_id            uuid;
  v_existing_ay_id   uuid;
  v_existed          boolean;
  v_source_ay_id     uuid;
  v_terms_inserted   int := 0;
  v_sections_copied  int := 0;
  v_configs_copied   int := 0;
  v_source           text := null;
begin
  if v_code !~ '^AY[0-9]{4}$' then
    raise exception 'Invalid AY code: %. Expected format AY2027.', p_ay_code;
  end if;
  if v_label is null or v_label = '' then
    raise exception 'AY label is required.';
  end if;

  v_slug := 'ay' || substring(v_code from 3);

  -- 1. academic_years — reuse if present, otherwise insert.
  select id into v_existing_ay_id
  from public.academic_years
  where ay_code = v_code;

  if v_existing_ay_id is not null then
    v_ay_id   := v_existing_ay_id;
    v_existed := true;
  else
    insert into public.academic_years (ay_code, label, is_current)
    values (v_code, v_label, false)
    returning id into v_ay_id;
    v_existed := false;
  end if;

  -- 2. terms (T1–T4) — insert only the missing term_numbers.
  insert into public.terms (academic_year_id, term_number, label, is_current)
  select v_ay_id, n, 'Term ' || n || ' — ' || v_code, false
  from generate_series(1, 4) as g(n)
  where not exists (
    select 1 from public.terms
    where academic_year_id = v_ay_id and term_number = n
  );
  get diagnostics v_terms_inserted = row_count;

  -- 3. Resolve copy source: most recent non-test AY. Unconditional —
  --    Structure Defaults / template removed, this is now the only path
  --    (previously a fallback only reached when the template was empty).
  select id into v_source_ay_id
  from public.academic_years
  where id <> v_ay_id
    and ay_code !~ '^AY9'
  order by ay_code desc
  limit 1;

  -- 4. sections — copied from the source AY when one exists. Empty when
  --    none (bootstrap case — acceptable, effectively unreachable for
  --    HFSE now that AY2025/2026/2027 already exist).
  if not exists (select 1 from public.sections where academic_year_id = v_ay_id) then
    if v_source_ay_id is not null then
      insert into public.sections (academic_year_id, level_id, name, class_type, schedule, form_class_adviser)
      select v_ay_id, level_id, name, class_type, schedule, null
      from public.sections
      where academic_year_id = v_source_ay_id;
      get diagnostics v_sections_copied = row_count;
      select ay_code into v_source
      from public.academic_years
      where id = v_source_ay_id;
    end if;
  end if;

  -- (No 4b: the ay_level_offerings insert that used to live here was
  --  already removed by migration 086, which dropped the table entirely
  --  — KD #153's SUPERSEDED note. Nothing to re-emit.)

  -- 5. subject_configs (weights, one row per subject) + subject_level_
  --    offerings (which subjects apply to which levels this AY) — copied
  --    from the source AY when one exists.
  if not exists (select 1 from public.subject_configs where academic_year_id = v_ay_id) then
    if v_source_ay_id is not null then
      insert into public.subject_configs (
        academic_year_id, subject_id,
        ww_weight, pt_weight, qa_weight,
        ww_max_slots, pt_max_slots, qa_max
      )
      select v_ay_id, subject_id,
             ww_weight, pt_weight, qa_weight,
             ww_max_slots, pt_max_slots, qa_max
      from public.subject_configs
      where academic_year_id = v_source_ay_id;
      get diagnostics v_configs_copied = row_count;
      if v_source is null then
        select ay_code into v_source
        from public.academic_years
        where id = v_source_ay_id;
      end if;

      insert into public.subject_level_offerings (academic_year_id, subject_id, level_id)
      select v_ay_id, subject_id, level_id
      from public.subject_level_offerings
      where academic_year_id = v_source_ay_id
      on conflict (subject_id, level_id, academic_year_id) do nothing;
    end if;
  end if;

  -- 5b. Section-subjects defaults — branch-agnostic, resolves via
  --     subject_level_offerings (migration 086 body).
  perform public.sync_section_subjects_for_ay(v_code);

  -- 6. Admissions DDL — already idempotent.
  perform public.create_ay_admissions_tables(v_slug);

  return jsonb_build_object(
    'ay_id',                  v_ay_id,
    'ay_code',                v_code,
    'ay_slug',                v_slug,
    'ay_existed',              v_existed,
    'terms_inserted',         v_terms_inserted,
    'sections_copied',        v_sections_copied,
    'subject_configs_copied', v_configs_copied,
    'source',                 v_source,
    'tables_created', jsonb_build_array(
      v_slug || '_enrolment_applications',
      v_slug || '_enrolment_status',
      v_slug || '_enrolment_documents',
      v_slug || '_discount_codes'
    )
  );
end;
$$;

revoke all on function public.create_academic_year(text, text) from public;
grant execute on function public.create_academic_year(text, text) to service_role;
