-- Migration 074: structured section schedule + official HFSE template list.
--
-- Adds sections.schedule + template_sections.schedule (morning/afternoon/whole_day),
-- resets the class template's P1–P6 + S1–S4 rows to HFSE's official virtue sections,
-- and threads `schedule` through every template→sections copy. YS/CS rows untouched.
--
-- The two copy RPCs are re-emitted from their NEWEST live bodies verbatim
-- (KD #119 hazard — never re-emit from a stale body):
--   - apply_template_to_ay   → newest in migration 063 (post curriculum_track drop)
--   - create_academic_year   → newest in migration 031 (template-aware copy)
-- Only the template→sections SELECT/INSERT (+ the UPSERT update-set in
-- apply_template_to_ay) gains `schedule`. Everything else is identical.

BEGIN;

-- ─── 1. Columns ──────────────────────────────────────────────────────────────

alter table public.sections
  add column if not exists schedule text
  check (schedule is null or schedule in ('morning','afternoon','whole_day'));

alter table public.template_sections
  add column if not exists schedule text
  check (schedule is null or schedule in ('morning','afternoon','whole_day'));

-- ─── 2. Official primary/secondary template sections ─────────────────────────
-- Idempotent: delete-then-insert, scoped to the 10 levels P1–P6 + S1–S4.
-- YS-L/J/S + CS1/CS2 template rows are left intact.

delete from public.template_sections
where level_id in (
  select id from public.levels
  where code in ('P1','P2','P3','P4','P5','P6','S1','S2','S3','S4')
);

insert into public.template_sections (level_id, name, schedule)
select l.id, v.name, v.schedule
from (values
  ('P1','Obedience','morning'),   ('P1','Patience','morning'),   ('P1','Respect','afternoon'),
  ('P2','Honesty','morning'),     ('P2','Humility','morning'),   ('P2','Gentleness','afternoon'),
  ('P3','Courageous','morning'),  ('P3','Courtesy','morning'),   ('P3','Responsibility','afternoon'),
  ('P4','Diligence','morning'),   ('P4','Trust','morning'),      ('P4','Compassion','afternoon'),
  ('P5','Commitment','morning'),  ('P5','Tenacity','morning'),   ('P5','Perseverance','afternoon'),
  ('P6','Grit','morning'),        ('P6','Loyalty','afternoon'),
  ('S1','Discipline','whole_day'),
  ('S2','Integrity','whole_day'),
  ('S3','Consistency','whole_day'),
  ('S4','Excellence','whole_day')
) as v(level_code, name, schedule)
join public.levels l on l.code = v.level_code;

-- ─── 3. apply_template_to_ay (re-emit from 063 + schedule) ───────────────────

CREATE OR REPLACE FUNCTION public.apply_template_to_ay(p_ay_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code               text := upper(trim(p_ay_code));
  v_ay_id              uuid;
  v_sections_inserted  int := 0;
  v_sections_updated   int := 0;
  v_configs_inserted   int := 0;
  v_configs_updated    int := 0;
BEGIN
  IF v_code !~ '^AY[0-9]{4}$' THEN
    RAISE EXCEPTION 'Invalid AY code: %. Expected format AY2027.', p_ay_code;
  END IF;

  SELECT id INTO v_ay_id
  FROM public.academic_years
  WHERE ay_code = v_code;

  IF v_ay_id IS NULL THEN
    RAISE EXCEPTION 'AY % not found.', v_code;
  END IF;

  -- Sections — INSERT new, UPDATE existing class_type + schedule.
  -- form_class_adviser is per-AY — never overwritten.
  WITH upsert AS (
    INSERT INTO public.sections
      (academic_year_id, level_id, name, class_type, schedule, form_class_adviser)
    SELECT v_ay_id, ts.level_id, ts.name, ts.class_type, ts.schedule, null
    FROM public.template_sections ts
    ON CONFLICT (academic_year_id, level_id, name) DO UPDATE
      SET class_type = EXCLUDED.class_type,
          schedule   = EXCLUDED.schedule
    RETURNING (xmax = 0) AS is_insert
  )
  SELECT
    COUNT(*) FILTER (WHERE is_insert)     AS inserted,
    COUNT(*) FILTER (WHERE NOT is_insert) AS updated
    INTO v_sections_inserted, v_sections_updated
  FROM upsert;

  -- Subject configs — UPSERT on (ay, subject, level). All template fields pushed.
  WITH upsert AS (
    INSERT INTO public.subject_configs (
      academic_year_id, subject_id, level_id,
      ww_weight, pt_weight, qa_weight,
      ww_max_slots, pt_max_slots, qa_max
    )
    SELECT v_ay_id, t.subject_id, t.level_id,
           t.ww_weight, t.pt_weight, t.qa_weight,
           t.ww_max_slots, t.pt_max_slots, t.qa_max
    FROM public.template_subject_configs t
    ON CONFLICT (academic_year_id, subject_id, level_id) DO UPDATE
      SET ww_weight    = EXCLUDED.ww_weight,
          pt_weight    = EXCLUDED.pt_weight,
          qa_weight    = EXCLUDED.qa_weight,
          ww_max_slots = EXCLUDED.ww_max_slots,
          pt_max_slots = EXCLUDED.pt_max_slots,
          qa_max       = EXCLUDED.qa_max
    RETURNING (xmax = 0) AS is_insert
  )
  SELECT
    COUNT(*) FILTER (WHERE is_insert)     AS inserted,
    COUNT(*) FILTER (WHERE NOT is_insert) AS updated
    INTO v_configs_inserted, v_configs_updated
  FROM upsert;

  RETURN jsonb_build_object(
    'ay_code',            v_code,
    'sections_inserted',  v_sections_inserted,
    'sections_updated',   v_sections_updated,
    'configs_inserted',   v_configs_inserted,
    'configs_updated',    v_configs_updated
  );
END;
$$;

-- ─── 4. create_academic_year (re-emit from 031 + schedule) ───────────────────
-- Step ordering identical to migration 031. Only the section copy SELECTs gain
-- `schedule` (both the template branch and the legacy prior-AY fallback).

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

COMMIT;
