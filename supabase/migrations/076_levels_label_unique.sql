-- supabase/migrations/076_levels_label_unique.sql
--
-- Adds a UNIQUE constraint to public.levels.label to ensure level display labels
-- are never duplicated. This supports the admissions-driven level reconciliation
-- system (Phase 1 — KD #152) which reads the canonical level label when
-- normalizing admissions applications (applications.levelApplied → levels.label).
--
-- The constraint is safe to apply: all seeded levels have unique labels, and
-- the schema generator (create_academic_year RPC + the AY-setup wizard) never
-- copies or generates duplicate labels.
--
-- Idempotent + safe to re-run. Apply after 075.

ALTER TABLE public.levels
  ADD CONSTRAINT levels_label_unique UNIQUE (label);

COMMENT ON CONSTRAINT levels_label_unique ON public.levels IS
  'Ensures level display labels are unique — required for admissions-driven level reconciliation (KD #152).';
