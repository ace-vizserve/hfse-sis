-- Migration 079: section_subjects — per-section subject overrides.
--
-- Subjects have always been 100% derived from a section's LEVEL via
-- subject_configs (subject x level x AY, KD #4). There was no way to say
-- "this specific section doesn't teach subject X" or "this section teaches
-- an extra subject its level normally doesn't" (the old curriculum_track
-- column that could have served this was deliberately removed, migration
-- 063). This table adds that per-section layer without touching
-- subject_configs (weights/slot-counts stay a single per-level source of
-- truth, KD #4 unchanged) — section_subjects only decides WHICH of a
-- level's configured subjects apply to a given section.
--
-- CRITICAL: every existing section is backfilled with one row per subject
-- currently offered at its level, in the same statement. Grading-sheet
-- generation (app/api/grading-sheets/bulk-create/route.ts) is being changed
-- in the same release to intersect with this table — without the backfill,
-- every live section would silently lose every subject the moment that
-- ships. Idempotent (on conflict do nothing) — safe to re-run.

begin;

create table if not exists public.section_subjects (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections(id) on delete cascade,
  subject_config_id uuid not null references public.subject_configs(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (section_id, subject_config_id)
);

create index if not exists section_subjects_section_idx on public.section_subjects (section_id);
create index if not exists section_subjects_config_idx on public.section_subjects (subject_config_id);

-- RLS — same role-gated read + explicit write-deny pattern as
-- ay_level_offerings (migration 078) / sections (migration 004). Writes go
-- through service-role API routes only; the deny policies fail closed if a
-- cookie-bound client ever tries.
alter table public.section_subjects enable row level security;

drop policy if exists section_subjects_role_read on public.section_subjects;
create policy section_subjects_role_read
  on public.section_subjects for select to authenticated
  using (public.current_user_role() is not null);

drop policy if exists section_subjects_no_insert on public.section_subjects;
create policy section_subjects_no_insert
  on public.section_subjects for insert to authenticated with check (false);

drop policy if exists section_subjects_no_update on public.section_subjects;
create policy section_subjects_no_update
  on public.section_subjects for update to authenticated
  using (false) with check (false);

drop policy if exists section_subjects_no_delete on public.section_subjects;
create policy section_subjects_no_delete
  on public.section_subjects for delete to authenticated using (false);

-- Backfill: every existing section gets one row per subject currently
-- configured (subject_configs) at its (level, AY) — byte-identical behaviour
-- to today's "subjects = derived from level" model until someone customizes
-- a section via the new UI.
insert into public.section_subjects (section_id, subject_config_id)
select s.id, sc.id
from public.sections s
join public.subject_configs sc
  on sc.level_id = s.level_id
 and sc.academic_year_id = s.academic_year_id
on conflict (section_id, subject_config_id) do nothing;

commit;

-- ─── sync_section_subjects_for_ay — reusable idempotent defaults sync ─────
-- Grants every (section, subject_config) pair currently implied by level +
-- AY that section_subjects doesn't already have. ON CONFLICT DO NOTHING
-- means it never removes a deliberate per-section customization (a removed
-- subject stays removed) — it only ever ADDS missing defaults. Callable
-- from three places that create sections or subject_configs after this
-- migration: create_academic_year (AY rollover — step 5b below), the
-- mid-year "New section" route, and the class-template "Apply" route.
begin;

create or replace function public.sync_section_subjects_for_ay(p_ay_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ay_id uuid;
  v_inserted int := 0;
begin
  select id into v_ay_id from public.academic_years where ay_code = p_ay_code;
  if v_ay_id is null then
    return jsonb_build_object('inserted', 0, 'reason', 'ay_not_found');
  end if;

  insert into public.section_subjects (section_id, subject_config_id)
  select s.id, sc.id
  from public.sections s
  join public.subject_configs sc
    on sc.level_id = s.level_id
   and sc.academic_year_id = s.academic_year_id
  where s.academic_year_id = v_ay_id
  on conflict (section_id, subject_config_id) do nothing;
  get diagnostics v_inserted = row_count;

  return jsonb_build_object('inserted', v_inserted);
end;
$$;

revoke all on function public.sync_section_subjects_for_ay(text) from public;
grant execute on function public.sync_section_subjects_for_ay(text) to service_role;

commit;

-- ─── create_academic_year re-emit (newest live body: migration 078) ──────────
-- Identical to 078's body except one new branch-agnostic step (5b) added
-- right after step 5 (subject_configs copy): grants section_subjects
-- defaults for the new AY via the function just created above. Placed
-- after subject_configs are copied (5) since it depends on them, and before
-- the admissions DDL (6) since it doesn't. KD #119 hazard: re-emitted from
-- the newest live body, not an older migration's copy.

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

  -- 4b. Volatile-level offerings — branch-agnostic, runs regardless of
  -- which step-4 branch fired (template / legacy-fallback / sections
  -- already existed). A volatile level is offered in this AY iff it has at
  -- least one section here. Fixes the original draft, which placed this
  -- insert only inside the legacy-fallback branch and so gave zero
  -- offerings on the template path — the one every real environment uses.
  insert into public.ay_level_offerings (academic_year_id, level_id)
  select distinct s.academic_year_id, s.level_id
  from public.sections s
  join public.levels l on l.id = s.level_id
  where s.academic_year_id = v_ay_id and l.is_core = false
  on conflict (academic_year_id, level_id) do nothing;

  -- 5. subject_configs
  if not exists (select 1 from public.subject_configs where academic_year_id = v_ay_id) then
    if v_use_template and v_template_configs_count > 0 then
      insert into public.subject_configs (
        academic_year_id, subject_id, level_id,
        ww_weight, pt_weight, qa_weight,
        ww_max_slots, pt_max_slots, qa_max
      )
      select v_ay_id, subject_id, level_id,
             ww_weight, pt_weight, qa_weight,
             ww_max_slots, pt_max_slots, qa_max
      from public.template_subject_configs;
      get diagnostics v_configs_copied = row_count;
      if v_source is null then v_source := 'template'; end if;
    elsif v_source_ay_id is not null then
      insert into public.subject_configs (
        academic_year_id, subject_id, level_id,
        ww_weight, pt_weight, qa_weight,
        ww_max_slots, pt_max_slots, qa_max
      )
      select v_ay_id, subject_id, level_id,
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
    end if;
  end if;

  -- 5b. Section-subjects defaults — branch-agnostic, mirrors 4b's pattern.
  -- Grants every section its level's just-copied subjects as a starting
  -- default (preserves today's "subjects derive from level" behaviour on a
  -- freshly rolled-over AY until the registrar customizes a section).
  perform public.sync_section_subjects_for_ay(v_code);

  -- 6. Admissions DDL — already idempotent.
  perform public.create_ay_admissions_tables(v_slug);

  return jsonb_build_object(
    'ay_id',                  v_ay_id,
    'ay_code',                v_code,
    'ay_slug',                v_slug,
    'ay_existed',             v_existed,
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
