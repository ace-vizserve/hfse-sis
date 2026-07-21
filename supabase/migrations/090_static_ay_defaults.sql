-- 090_static_ay_defaults.sql
--
-- Replaces migration 089's "copy sections/subjects/weights from the most
-- recently created prior AY" mechanism with a fixed, hardcoded default —
-- every new AY starts from the SAME baseline every time, not from
-- whatever the previous AY currently happens to look like. See
-- docs/superpowers/specs/2026-07-21-static-ay-defaults-design.md.
--
-- Also drops the confirmation-gate columns 089 added — nothing to
-- confirm anymore since the baseline never varies AY to AY.

-- =====================================================================
-- 1. Drop the confirmation-gate columns.
-- =====================================================================

alter table public.academic_years
  drop column if exists structure_confirmed_at,
  drop column if exists structure_confirmed_by;

-- =====================================================================
-- 2. Ensure ECON and CCA exist in the global subjects catalog —
--    catalog-only, no offering, no weight config, for future-readiness.
--    No-op if already present (both are already in supabase/seed.sql,
--    but the live prod database's actual state is unverified — this is
--    safe either way).
-- =====================================================================

insert into public.subjects (code, name, is_examinable)
values
  ('ECON', 'Economics', true),
  ('CCA', 'Co-curricular Activities', false)
on conflict (code) do nothing;

-- =====================================================================
-- 3. Re-emit create_academic_year — migration 089 body (the newest live
--    definition, KD #119 hazard) with the copy-forward source resolution
--    and both copy branches removed, replaced by static-default seeding.
--    Every other step (academic_years upsert, terms, sync_section_
--    subjects_for_ay call REMOVED — see design doc §3, admissions DDL)
--    unchanged in spirit; sections/subject_configs/subject_level_
--    offerings insertion is entirely new.
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
  v_code                 text := upper(trim(p_ay_code));
  v_label                text := trim(p_label);
  v_slug                 text;
  v_ay_id                uuid;
  v_existing_ay_id        uuid;
  v_existed               boolean;
  v_terms_inserted        int := 0;
  v_sections_seeded       int := 0;
  v_subject_configs_seeded int := 0;
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

  -- 3. sections — fixed HFSE virtue-name list (KD #144), only when the
  --    AY has no sections yet. class_type left null — the registrar
  --    assigns Global/Standard per Secondary section when relevant.
  if not exists (select 1 from public.sections where academic_year_id = v_ay_id) then
    insert into public.sections (academic_year_id, level_id, name, class_type, schedule, form_class_adviser)
    select v_ay_id, l.id, x.name, null, x.schedule, null
    from (values
      ('P1', 'Obedience', 'morning'),
      ('P1', 'Patience', 'morning'),
      ('P1', 'Respect', 'afternoon'),
      ('P2', 'Honesty', 'morning'),
      ('P2', 'Humility', 'morning'),
      ('P2', 'Gentleness', 'afternoon'),
      ('P3', 'Courageous', 'morning'),
      ('P3', 'Courtesy', 'morning'),
      ('P3', 'Responsibility', 'afternoon'),
      ('P4', 'Diligence', 'morning'),
      ('P4', 'Trust', 'morning'),
      ('P4', 'Compassion', 'afternoon'),
      ('P5', 'Commitment', 'morning'),
      ('P5', 'Tenacity', 'morning'),
      ('P5', 'Perseverance', 'afternoon'),
      ('P6', 'Grit', 'morning'),
      ('P6', 'Loyalty', 'afternoon'),
      ('S1', 'Discipline', 'whole_day'),
      ('S2', 'Integrity', 'whole_day'),
      ('S3', 'Consistency', 'whole_day'),
      ('S4', 'Excellence', 'whole_day')
    ) as x(level_code, name, schedule)
    join public.levels l on l.code = x.level_code;
    get diagnostics v_sections_seeded = row_count;
  end if;

  -- 4. subject_level_offerings — fixed per-level subject applicability,
  --    only when the AY has none yet. Verified against real AY2026 data
  --    with two corrections: P6 gains MANDARIN (was a gap, not
  --    intentional — every other Primary level has it); Secondary S3/S4
  --    stays at its current real 9-subject set (no Global-track-only
  --    subjects — HFSE doesn't run Global track that far yet).
  if not exists (select 1 from public.subject_level_offerings where academic_year_id = v_ay_id) then
    insert into public.subject_level_offerings (academic_year_id, subject_id, level_id)
    select v_ay_id, s.id, l.id
    from (values
      ('P1', 'CL'), ('P1', 'ENG'), ('P1', 'FIL'), ('P1', 'MANDARIN'), ('P1', 'MAPEH'), ('P1', 'MATH'), ('P1', 'SCI'),
      ('P2', 'CL'), ('P2', 'ENG'), ('P2', 'FIL'), ('P2', 'MANDARIN'), ('P2', 'MAPEH'), ('P2', 'MATH'), ('P2', 'SCI'),
      ('P3', 'CL'), ('P3', 'ENG'), ('P3', 'FIL'), ('P3', 'MANDARIN'), ('P3', 'MAPEH'), ('P3', 'MATH'), ('P3', 'SCI'),
      ('P4', 'CL'), ('P4', 'ENG'), ('P4', 'FIL'), ('P4', 'MANDARIN'), ('P4', 'MAPEH'), ('P4', 'MATH'), ('P4', 'SCI'),
      ('P5', 'CL'), ('P5', 'ENG'), ('P5', 'FIL'), ('P5', 'MANDARIN'), ('P5', 'MAPEH'), ('P5', 'MATH'), ('P5', 'SCI'),
      ('P6', 'CL'), ('P6', 'ENG'), ('P6', 'FIL'), ('P6', 'MANDARIN'), ('P6', 'MAPEH'), ('P6', 'MATH'), ('P6', 'SCI'),
      ('S1', 'ARTD'), ('S1', 'CA'), ('S1', 'COMP'), ('S1', 'ENG'), ('S1', 'FIL'), ('S1', 'GP'), ('S1', 'HIST'), ('S1', 'HUM'), ('S1', 'LIT'), ('S1', 'MATH'), ('S1', 'PEH'), ('S1', 'PESTD'), ('S1', 'SCI'),
      ('S2', 'ARTD'), ('S2', 'CA'), ('S2', 'COMP'), ('S2', 'ENG'), ('S2', 'FIL'), ('S2', 'GP'), ('S2', 'HIST'), ('S2', 'HUM'), ('S2', 'LIT'), ('S2', 'MATH'), ('S2', 'PEH'), ('S2', 'PESTD'), ('S2', 'SCI'),
      ('S3', 'CA'), ('S3', 'ENG'), ('S3', 'FIL'), ('S3', 'LIT'), ('S3', 'MATH'), ('S3', 'PEH'), ('S3', 'PESTD'), ('S3', 'SCI'), ('S3', 'SS'),
      ('S4', 'CA'), ('S4', 'ENG'), ('S4', 'FIL'), ('S4', 'LIT'), ('S4', 'MATH'), ('S4', 'PEH'), ('S4', 'PESTD'), ('S4', 'SCI'), ('S4', 'SS')
    ) as x(level_code, subject_code)
    join public.levels l on l.code = x.level_code
    join public.subjects s on s.code = x.subject_code
    on conflict (subject_id, level_id, academic_year_id) do nothing;
  end if;

  -- 5. subject_configs (weights) — one row per DISTINCT subject code
  --    actually referenced by step 4 (subject_configs has no level
  --    dimension, migration 080), only when the AY has none yet. Weights
  --    match lib/sis/subjects/weight-defaults.ts's bucket logic exactly
  --    — keep both in sync by hand if HFSE's weight table ever changes.
  if not exists (select 1 from public.subject_configs where academic_year_id = v_ay_id) then
    insert into public.subject_configs (
      academic_year_id, subject_id,
      ww_weight, pt_weight, qa_weight,
      ww_max_slots, pt_max_slots, qa_max
    )
    select v_ay_id, s.id, x.ww, x.pt, x.qa, 5, 5, 30
    from (values
      ('MATH', 0.40, 0.40, 0.20),
      ('SCI', 0.40, 0.40, 0.20),
      ('MAPEH', 0.20, 0.60, 0.20),
      ('CL', 0.20, 0.60, 0.20),
      ('CA', 0.20, 0.60, 0.20),
      ('PEH', 0.20, 0.60, 0.20),
      ('PESTD', 0.20, 0.60, 0.20),
      ('ENG', 0.30, 0.50, 0.20),
      ('FIL', 0.30, 0.50, 0.20),
      ('MANDARIN', 0.30, 0.50, 0.20),
      ('HIST', 0.30, 0.50, 0.20),
      ('HUM', 0.30, 0.50, 0.20),
      ('LIT', 0.30, 0.50, 0.20),
      ('SS', 0.30, 0.50, 0.20),
      ('GP', 0.30, 0.50, 0.20),
      ('COMP', 0.30, 0.50, 0.20),
      ('ARTD', 0.30, 0.50, 0.20)
    ) as x(subject_code, ww, pt, qa)
    join public.subjects s on s.code = x.subject_code
    where exists (
      select 1 from public.subject_level_offerings slo
      where slo.academic_year_id = v_ay_id and slo.subject_id = s.id
    );
    get diagnostics v_subject_configs_seeded = row_count;
  end if;

  -- 6. Admissions DDL — already idempotent.
  perform public.create_ay_admissions_tables(v_slug);

  return jsonb_build_object(
    'ay_id',                    v_ay_id,
    'ay_code',                  v_code,
    'ay_slug',                  v_slug,
    'ay_existed',               v_existed,
    'terms_inserted',           v_terms_inserted,
    'sections_seeded',          v_sections_seeded,
    'subject_configs_seeded',   v_subject_configs_seeded,
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
