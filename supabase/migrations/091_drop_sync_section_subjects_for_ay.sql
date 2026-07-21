-- 091_drop_sync_section_subjects_for_ay.sql
--
-- Removes the RPC behind the blanket "attach every level subject to
-- every new section" behavior (migrations 079/080) — its two real
-- callers (app/api/sections/route.ts, lib/sis/seeder/structural.ts)
-- were both migrated off it to explicit, registrar-realistic attachment
-- in the same branch as this migration. See
-- docs/superpowers/specs/2026-07-21-static-ay-defaults-design.md §3.

drop function if exists public.sync_section_subjects_for_ay(text);
