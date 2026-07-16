-- Migration 084: Secondary track (Global / Standard) — Phase 3 of the
-- "Config-Driven Subject Registry + Secondary Tracks" plan
-- (C:\Users\Ace\.claude\plans\my-bad-its-not-graceful-creek.md).
--
-- Adds a nullable, no-default `track` column to `sections` +
-- `template_sections`. This is a BULK-ASSIGNMENT TRIGGER ONLY — a
-- one-click "flag this section as Global or Standard" action (the
-- application-layer route, not this migration) resolves a static
-- in-code bundle (`lib/sis/track-bundles.ts`) to `section_subjects` rows.
-- `track` itself is NEVER read to gate, filter, or restrict what subjects
-- a section can have — `section_subjects` (migration 079) stays the sole
-- source of truth for that, completely unaffected by this column. A
-- registrar can always manually add/remove any subject on any section
-- regardless of its track, via the existing per-section attach route.
--
-- No default, no backfill of existing rows — they legitimately have no
-- track (not a gap to fill; the column is opt-in, set only when a
-- registrar deliberately flags a section).
--
-- Structure mirrors migration 074 (`sections.schedule` +
-- `template_sections.schedule`) exactly — same "nullable text + CHECK,
-- added to both tables, `add column if not exists`" shape. Deliberately
-- narrower than 074's own scope, though: 074 ALSO re-emitted
-- `apply_template_to_ay` + `create_academic_year` to thread `schedule`
-- through the AY-copy paths. This migration does NOT do that for `track`
-- — the AY-copy RPCs are left untouched, so a section copied into a new
-- AY (from a track-flagged template row, or from a prior AY) lands with
-- `track = NULL`, exactly like it already lands with an empty
-- `section_subjects` set that needs the registrar to (re-)run "Load
-- default subject set" / "Set track" for that AY. Reasoning: (1) the
-- bundle-apply action's real payoff — the section_subjects inserts +
-- grading-sheet generation — is per-AY data that is NEVER copied forward
-- by the AY-copy RPCs anyway (subject_configs/section_subjects are fresh
-- per AY), so merely carrying the `track` LABEL forward across a rollover
-- would not actually re-attach that AY's bundle — the registrar still has
-- to click "Set track" again to get real section_subjects rows for the
-- new AY, at which point the pre-copied label saves nothing meaningful;
-- (2) re-emitting ~330 lines of two large, already-hazard-prone RPCs
-- (KD #119 — a stale re-emit has silently dropped columns before) without
-- a live database to verify against is a materially larger, harder-to-
-- verify migration than the literal ALTER TABLE this task actually needs;
-- (3) keeps the "cheap to remove" property sharpest — dropping `track`
-- later touches exactly this one migration + the bundle-apply route, not
-- two additionally-modified copy-forward functions. `template_sections`
-- still gets the column (per the brief) so the section-creation dialogs
-- have parity with `schedule` and a template row can display/store an
-- intended track for humans reading the template list — it just isn't
-- wired into the copy RPCs' column lists yet. If a future task wants
-- rollover-carried track labels, that is a small, well-scoped follow-up
-- (thread `track` through both RPCs' section INSERT/UPDATE column lists,
-- re-emitted from their newest live bodies — migration 080 as of this
-- writing, per that migration's own header note).
--
-- No unique constraint anywhere touches `track` (the direct lesson from
-- `sections.curriculum_track`, migration 058 — see that migration's own
-- header for the full story of why it was fully ripped out a few weeks
-- after shipping).
--
-- No dev database is reachable from this worktree (no automated
-- migration-apply tooling in this repo) — this migration has NOT been run
-- against a live database. Verification here is structural only:
-- paren/begin-commit balance, mirrored against 074's already-shipped
-- structure for this exact column shape.

BEGIN;

alter table public.sections
  add column if not exists track text
  check (track is null or track in ('global', 'standard'));

alter table public.template_sections
  add column if not exists track text
  check (track is null or track in ('global', 'standard'));

COMMIT;

-- ═════════════════════════════════════════════════════════════════════
-- Post-apply manual review queries:
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--     where table_schema = 'public' and table_name = 'sections' and column_name = 'track';
--   -- Expect: text, YES, null.
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--     where table_schema = 'public' and table_name = 'template_sections' and column_name = 'track';
--   -- Expect: text, YES, null.
--   select count(*) from public.sections where track is not null;
--   -- Expect: 0 immediately after apply (no backfill).
-- ═════════════════════════════════════════════════════════════════════
