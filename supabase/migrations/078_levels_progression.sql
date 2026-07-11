-- Migration 078: levels become a managed entity — display order, progression
-- pointer, core-vs-volatile, and per-AY offerings for volatile levels.
-- Spec: docs/superpowers/specs/2026-07-11-levels-and-progression-design.md
--
-- create_academic_year is re-emitted from its NEWEST live body (migration 074,
-- KD #119 hazard — never re-emit from a stale body). Only ONE new statement is
-- added: copying volatile-level offerings from the source AY, placed in the
-- legacy-fallback branch (the only branch with a source AY id — the
-- template-driven branch inserts nothing, so a template-sourced new AY starts
-- with core levels only).

begin;

alter table public.levels add column if not exists sort_order smallint;
alter table public.levels add column if not exists next_level_id uuid references public.levels(id) on delete set null;
alter table public.levels add column if not exists is_core boolean not null default false;

-- Backfill sort_order in the canonical display order (mirrors lib/sis/levels.ts LEVEL_CODES).
with ordered(code, ord) as (
  values ('YS-L',1),('YS-J',2),('YS-S',3),
         ('P1',4),('P2',5),('P3',6),('P4',7),('P5',8),('P6',9),
         ('S1',10),('S2',11),('S3',12),('S4',13),
         ('CS1',14),('CS2',15)
)
update public.levels l set sort_order = o.ord from ordered o where l.code = o.code;
-- Any level not in the canonical list (none expected) sorts last.
update public.levels set sort_order = 99 where sort_order is null;
alter table public.levels alter column sort_order set not null;

-- Core = P1-P6, S1-S4 (permanent; never deactivated/deleted; always offered).
update public.levels set is_core = true
where code in ('P1','P2','P3','P4','P5','P6','S1','S2','S3','S4');

-- Seed the progression chain: YS-L→YS-J→YS-S→P1→…→P6→S1→…→S4(null); CS1→CS2(null).
with chain(code, next_code) as (
  values ('YS-L','YS-J'),('YS-J','YS-S'),('YS-S','P1'),
         ('P1','P2'),('P2','P3'),('P3','P4'),('P4','P5'),('P5','P6'),('P6','S1'),
         ('S1','S2'),('S2','S3'),('S3','S4'),
         ('CS1','CS2')
)
update public.levels l
set next_level_id = n.id
from chain c
join public.levels n on n.code = c.next_code
where l.code = c.code and l.next_level_id is null;

-- Per-AY offerings — VOLATILE levels only (core levels are always offered, no rows).
create table if not exists public.ay_level_offerings (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  level_id uuid not null references public.levels(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (academic_year_id, level_id)
);
alter table public.ay_level_offerings enable row level security;
create policy ay_level_offerings_read on public.ay_level_offerings
  for select to authenticated using (true);
-- Writes go through the service role only (same posture as levels itself).

-- Backfill: a volatile level is offered in an AY iff it has sections there.
insert into public.ay_level_offerings (academic_year_id, level_id)
select distinct s.academic_year_id, s.level_id
from public.sections s
join public.levels l on l.id = s.level_id
where l.is_core = false
on conflict (academic_year_id, level_id) do nothing;

commit;

-- ─── create_academic_year re-emit (newest live body: migration 074) ──────────
-- Identical to 074's body except for the one new offerings-copy insert added
-- inside the legacy-fallback sections branch (step 4, `elsif v_source_ay_id is
-- not null then`) — the only branch that has a source AY. The template branch
-- (step 4's `if v_use_template and v_template_sections_count > 0`) inserts no
-- offerings: a template-sourced new AY starts with core levels only.

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

      -- Copy volatile-level offerings from the source AY (levels & progression, spec 2026-07-11).
      insert into public.ay_level_offerings (academic_year_id, level_id)
      select v_ay_id, o.level_id
      from public.ay_level_offerings o
      where o.academic_year_id = v_source_ay_id
      on conflict (academic_year_id, level_id) do nothing;
    end if;
  end if;

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
