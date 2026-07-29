-- 094_classroom_notes.sql
--
-- Classroom Settings (Phase 6, docs/superpowers/specs/2026-07-28-classroom-
-- workspace-design.md) — a private scratch note per (teacher, class). This
-- is the ONLY migration in the whole Classroom plan (constraint 7 in that
-- doc: "No per-teacher/per-section settings table exists"). The sibling
-- Phase 6 preference — student display order — is deliberately NOT here: it
-- is client-persisted (browser localStorage), never touches the server, and
-- needs no schema.
--
-- Shape: one row per (section_id, teacher_user_id), free text, no term axis
-- (mirrors the Students tab's own "roster is a section-wide fact, not a
-- per-term one" precedent — a scratch note about the class doesn't reset
-- every term either). `teacher_user_id` references `auth.users(id)` WITHOUT
-- a declared cross-schema FK, the same convention `teacher_assignments`
-- uses (migration 003) — Supabase auth columns aren't meant to be FK-pinned
-- from app tables; the service-role write route is the sole writer and only
-- ever stamps the id of the caller whose session it just verified.
--
-- RLS is the point of this table: notes are genuinely private, not merely
-- role-gated. The select policy is `teacher_user_id = auth.uid()` with NO
-- is_registrar_or_above()/oversight bypass — unlike every other scoped-read
-- policy in this codebase (005_rls_teacher_scoping.sql), a school_admin or
-- superadmin's own cookie-scoped client cannot read another teacher's note.
-- (The service-role client used by the write route bypasses RLS entirely,
-- as it does everywhere else in this codebase — that's a backend
-- implementation detail, not a UI surface; no route built in this phase
-- ever serves one teacher's note content to a different teacher.)
--
-- Writes are denied outright to `authenticated` (insert/update/delete all
-- `with check (false)` / `using (false)`) — same explicit-deny pattern as
-- section_subjects (migration 079) / ay_level_offerings (migration 078).
-- The only writer is `POST /api/classroom/[sectionId]/notes`, which takes
-- `teacher_user_id` from the verified session (`requireRole` →
-- `claims.sub`), never from the request body — accepting it from the body
-- would let one user overwrite another user's private note.
--
-- Idempotent — safe to re-run. NOT YET APPLIED to any database; the app
-- code that reads/writes this table must not deploy until this migration
-- has been applied.

create table if not exists public.classroom_notes (
  id                uuid primary key default gen_random_uuid(),
  section_id        uuid not null references public.sections(id) on delete cascade,
  teacher_user_id   uuid not null,
  content           text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (section_id, teacher_user_id)
);

comment on table public.classroom_notes is
  'Private per-teacher scratch note about a class (Classroom Settings, Phase 6). One row per (section, teacher). Not visible to anyone but its author, including oversight roles — see this migration''s RLS policies. Display-only; carries no grading/attendance/policy meaning.';
comment on column public.classroom_notes.section_id is
  'The class this note is about. Section-scoped, not term-scoped — mirrors the Students tab roster.';
comment on column public.classroom_notes.teacher_user_id is
  'auth.users(id) of the note''s sole author/reader. No declared FK across schemas (see teacher_assignments, migration 003) — validity is enforced by the service-role write route, which stamps only the verified session''s own id.';
comment on column public.classroom_notes.content is
  'Free text, author''s own words. Never surfaced to any other user or any audit-log context (see the write route) — genuinely private, not merely role-gated.';

create index if not exists classroom_notes_teacher_idx
  on public.classroom_notes (teacher_user_id);

alter table public.classroom_notes enable row level security;

-- Select: caller reads only their own row. Deliberately no
-- public.is_registrar_or_above() bypass — see the migration header.
drop policy if exists classroom_notes_own_read on public.classroom_notes;
create policy classroom_notes_own_read
  on public.classroom_notes for select
  to authenticated
  using (teacher_user_id = auth.uid());

drop policy if exists classroom_notes_no_insert on public.classroom_notes;
create policy classroom_notes_no_insert
  on public.classroom_notes for insert to authenticated with check (false);

drop policy if exists classroom_notes_no_update on public.classroom_notes;
create policy classroom_notes_no_update
  on public.classroom_notes for update to authenticated
  using (false) with check (false);

drop policy if exists classroom_notes_no_delete on public.classroom_notes;
create policy classroom_notes_no_delete
  on public.classroom_notes for delete to authenticated using (false);
