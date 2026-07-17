-- Migration 086: remove the volatile-level catalog + per-AY offering
-- mechanism (KD #153, migration 078). Reversed by explicit user decision:
-- reviewing real grading/attendance data confirmed HFSE has never used the
-- 5 volatile levels (Youngstarters preschool tiers YS-L/YS-J/YS-S, Cambridge
-- Secondary CS1/CS2) — zero grading sheets, zero real sections with
-- students, ever. Curriculum differentiation (e.g. a Cambridge-style class)
-- is a SECTION concern (class_type + per-section subject attachment,
-- KD #154/subject-setup work), not a separate grade-level entity. The
-- catalog becomes the 10 fixed core levels (P1-P6, S1-S4) — always offered,
-- nothing to toggle per AY.
--
-- Guarded, not a blind delete: raises an exception if any real data
-- (sections, template_sections) ever referenced these 5 levels — the same
-- "never destroy real history" posture as delete_academic_year (KD #40).
-- Confirmed via the seeder audit that no section fixture ever targets these
-- levels; this guard is belt-and-suspenders for the live/prod database this
-- migration also applies to.
--
-- Does NOT drop `levels.is_core` / `sort_order` / `next_level_id` — those
-- columns stay (is_core is now trivially true for every remaining row,
-- next_level_id was already dormant per KD #153's own note). Narrowing that
-- further is a separate, lower-priority cleanup, not required for this
-- removal.

begin;

do $$
declare
  v_bad_count int;
begin
  select count(*) into v_bad_count
  from public.sections s
  join public.levels l on l.id = s.level_id
  where l.code in ('YS-L', 'YS-J', 'YS-S', 'CS1', 'CS2');

  if v_bad_count > 0 then
    raise exception
      'Refusing to remove volatile levels: % real section(s) reference them. Investigate before re-running this migration.',
      v_bad_count;
  end if;

  select count(*) into v_bad_count
  from public.template_sections ts
  join public.levels l on l.id = ts.level_id
  where l.code in ('YS-L', 'YS-J', 'YS-S', 'CS1', 'CS2');

  if v_bad_count > 0 then
    raise exception
      'Refusing to remove volatile levels: % template_sections row(s) reference them. Investigate before re-running this migration.',
      v_bad_count;
  end if;
end $$;

-- ay_level_offerings' own FK to levels is `on delete cascade`, so this would
-- clean itself up on the level delete below regardless — dropped explicitly
-- first anyway, since the whole per-AY-offering concept goes away with it,
-- not just the rows for these 5 levels.
drop table if exists public.ay_level_offerings;

delete from public.levels
where code in ('YS-L', 'YS-J', 'YS-S', 'CS1', 'CS2');

commit;

-- ─── create_academic_year re-emit (newest live body: migration 080) ──────
-- Byte-identical to 080's body except step "4b" (the ay_level_offerings
-- insert) is removed entirely — the table it wrote to no longer exists.
-- sync_section_subjects_for_ay is untouched (080's body didn't reference
-- ay_level_offerings), so it is not re-emitted here.

begin;

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
  v_template_sections_count int;
  v_template_configs_count  int;
  v_use_template     boolean := false;
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

  -- 3. Decide source. Templates win when populated.
  select count(*) into v_template_sections_count from public.template_sections;
  select count(*) into v_template_configs_count  from public.template_subject_configs;
  v_use_template := (v_template_sections_count > 0 or v_template_configs_count > 0);

  if not v_use_template then
    -- Legacy fallback: most recent non-test AY (preserves migration 030's
    -- behaviour for empty-template installs).
    select id into v_source_ay_id
    from public.academic_years
    where id <> v_ay_id
      and ay_code !~ '^AY9'
    order by ay_code desc
    limit 1;
  end if;

  -- 4. sections
  if not exists (select 1 from public.sections where academic_year_id = v_ay_id) then
    if v_use_template and v_template_sections_count > 0 then
      insert into public.sections (academic_year_id, level_id, name, class_type, schedule, form_class_adviser)
      select v_ay_id, level_id, name, class_type, schedule, null
      from public.template_sections;
      get diagnostics v_sections_copied = row_count;
      v_source := 'template';
    elsif v_source_ay_id is not null then
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

  -- 5. subject_configs (weights, one row per subject) + subject_level_
  --    offerings (which subjects apply to which levels this AY).
  if not exists (select 1 from public.subject_configs where academic_year_id = v_ay_id) then
    if v_use_template and v_template_configs_count > 0 then
      insert into public.subject_configs (
        academic_year_id, subject_id,
        ww_weight, pt_weight, qa_weight,
        ww_max_slots, pt_max_slots, qa_max
      )
      select v_ay_id, subject_id,
             ww_weight, pt_weight, qa_weight,
             ww_max_slots, pt_max_slots, qa_max
      from public.template_subject_configs;
      get diagnostics v_configs_copied = row_count;
      if v_source is null then v_source := 'template'; end if;

      insert into public.subject_level_offerings (academic_year_id, subject_id, level_id)
      select v_ay_id, subject_id, level_id
      from public.template_subject_level_offerings
      on conflict (subject_id, level_id, academic_year_id) do nothing;
    elsif v_source_ay_id is not null then
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

  -- 5b. Section-subjects defaults — branch-agnostic, mirrors step 4's pattern.
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

commit;
