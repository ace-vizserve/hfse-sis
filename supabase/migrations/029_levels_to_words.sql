-- Migration 029 — class-level labels: digit form ("Primary 1") → word form ("Primary One")
-- Adds 3 Youngstarters preschool tiers + 2 Cambridge Secondary tracks (5 new levels).
-- Widens levels.level_type CHECK to include 'preschool'.
-- Idempotent: existing rows updated only when in the legacy digit form.
-- Affects: levels.label, ay{YYYY}_enrolment_status.classLevel, ay{YYYY}_enrolment_applications.levelApplied.
-- Note: internal grading tables (sections, subject_configs, students, grading_sheets) reference
-- level_id (UUID FK) — they're decoupled from the label string and unaffected.

-- ---------- 1. Widen levels.level_type CHECK ----------
ALTER TABLE public.levels DROP CONSTRAINT IF EXISTS levels_level_type_check;
ALTER TABLE public.levels ADD CONSTRAINT levels_level_type_check
  CHECK (level_type IN ('primary', 'secondary', 'preschool'));

-- ---------- 2. Convert existing 10 levels to word form (idempotent guard) ----------
UPDATE public.levels SET label = 'Primary One'     WHERE code = 'P1' AND label = 'Primary 1';
UPDATE public.levels SET label = 'Primary Two'     WHERE code = 'P2' AND label = 'Primary 2';
UPDATE public.levels SET label = 'Primary Three'   WHERE code = 'P3' AND label = 'Primary 3';
UPDATE public.levels SET label = 'Primary Four'    WHERE code = 'P4' AND label = 'Primary 4';
UPDATE public.levels SET label = 'Primary Five'    WHERE code = 'P5' AND label = 'Primary 5';
UPDATE public.levels SET label = 'Primary Six'     WHERE code = 'P6' AND label = 'Primary 6';
UPDATE public.levels SET label = 'Secondary One'   WHERE code = 'S1' AND label = 'Secondary 1';
UPDATE public.levels SET label = 'Secondary Two'   WHERE code = 'S2' AND label = 'Secondary 2';
UPDATE public.levels SET label = 'Secondary Three' WHERE code = 'S3' AND label = 'Secondary 3';
UPDATE public.levels SET label = 'Secondary Four'  WHERE code = 'S4' AND label = 'Secondary 4';

-- ---------- 3. Insert the 5 new levels ----------
INSERT INTO public.levels (code, label, level_type) VALUES
  ('YS-L', 'Youngstarters | Little Stars',     'preschool'),
  ('YS-J', 'Youngstarters | Junior Stars',     'preschool'),
  ('YS-S', 'Youngstarters | Senior Stars',     'preschool'),
  ('CS1',  'Cambridge Secondary One (Year 8)', 'secondary'),
  ('CS2',  'Cambridge Secondary Two (Year 9)', 'secondary')
ON CONFLICT (code) DO NOTHING;

-- ---------- 4. Convert ay{YYYY}_enrolment_status.classLevel to word form ----------
DO $$
DECLARE
  t_name text;
  digit_to_word jsonb := jsonb_build_object(
    'Primary 1',   'Primary One',
    'Primary 2',   'Primary Two',
    'Primary 3',   'Primary Three',
    'Primary 4',   'Primary Four',
    'Primary 5',   'Primary Five',
    'Primary 6',   'Primary Six',
    'Secondary 1', 'Secondary One',
    'Secondary 2', 'Secondary Two',
    'Secondary 3', 'Secondary Three',
    'Secondary 4', 'Secondary Four'
  );
  k text;
  v text;
BEGIN
  FOR t_name IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename ~ '^ay[0-9]{4}_enrolment_status$'
  LOOP
    FOR k, v IN SELECT * FROM jsonb_each_text(digit_to_word) LOOP
      EXECUTE format('UPDATE public.%I SET "classLevel" = %L WHERE "classLevel" = %L', t_name, v, k);
    END LOOP;
  END LOOP;
END $$;

-- ---------- 5. Convert ay{YYYY}_enrolment_applications.levelApplied to word form ----------
DO $$
DECLARE
  t_name text;
  digit_to_word jsonb := jsonb_build_object(
    'Primary 1',   'Primary One',
    'Primary 2',   'Primary Two',
    'Primary 3',   'Primary Three',
    'Primary 4',   'Primary Four',
    'Primary 5',   'Primary Five',
    'Primary 6',   'Primary Six',
    'Secondary 1', 'Secondary One',
    'Secondary 2', 'Secondary Two',
    'Secondary 3', 'Secondary Three',
    'Secondary 4', 'Secondary Four'
  );
  k text;
  v text;
BEGIN
  FOR t_name IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename ~ '^ay[0-9]{4}_enrolment_applications$'
  LOOP
    FOR k, v IN SELECT * FROM jsonb_each_text(digit_to_word) LOOP
      EXECUTE format('UPDATE public.%I SET "levelApplied" = %L WHERE "levelApplied" = %L', t_name, v, k);
    END LOOP;
  END LOOP;
END $$;

-- Note: step 6 of the spec (re-emit create_ay_admissions_tables RPC) was skipped
-- because the DDL templates in migrations 012/025/026 only declare classLevel/levelApplied
-- as "character varying null" — they don't reference any specific level-label strings.
