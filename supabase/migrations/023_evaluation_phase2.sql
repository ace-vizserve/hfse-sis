-- 023_evaluation_phase2.sql
--
-- Evaluation module Phase 2 — the tables deferred from the 018 MVP:
--
--   1. evaluation_checklist_items      — per-term topic list per subject × level.
--                                        Registrar / superadmin seeds at
--                                        /sis/admin/evaluation-checklists.
--   2. evaluation_checklist_responses  — one row per student × checklist item.
--                                        Subject teacher ticks boxes on
--                                        /evaluation/sections/[id] Checklists tab.
--   3. evaluation_ptc_feedback         — free-text parent feedback per student
--                                        × term. PTC use only; never flows to
--                                        the report card (KD #49).
--
-- Subject + level are UUID FKs per project convention (KD #4) — deviates
-- from the spec's `subject TEXT / level TEXT`. Same rationale applied to
-- evaluation_subject_comments in migration 018.
--
-- RLS matches the 018 pattern: reads scoped to current_user_role() not null;
-- all writes go through service-role API routes (deny-writes on authenticated).
--
-- Apply after 022. Safe to re-run — IF NOT EXISTS everywhere.

-- =====================================================================
-- 1. evaluation_checklist_items
-- =====================================================================
--
-- One row per (term × subject × level × topic). `sort_order` drives the
-- display order; a compound unique key on (term, subject, level, sort_order)
-- makes reordering painless (registrar edits the number and the row moves).

create table if not exists public.evaluation_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  term_id     uuid not null references public.terms(id) on delete cascade,
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  level_id    uuid not null references public.levels(id) on delete cascade,
  item_text   text not null,
  sort_order  smallint not null default 0,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists evaluation_checklist_items_term_subject_level_idx
  on public.evaluation_checklist_items (term_id, subject_id, level_id, sort_order);

comment on table public.evaluation_checklist_items is
  'Per-term topic list per (subject × level). Subject teachers tick responses against these items for each student via evaluation_checklist_responses. PTC use only — does not flow to the report card (KD #49).';

alter table public.evaluation_checklist_items enable row level security;

drop policy if exists eval_checklist_items_role_read  on public.evaluation_checklist_items;
drop policy if exists eval_checklist_items_no_insert  on public.evaluation_checklist_items;
drop policy if exists eval_checklist_items_no_update  on public.evaluation_checklist_items;
drop policy if exists eval_checklist_items_no_delete  on public.evaluation_checklist_items;

create policy eval_checklist_items_role_read
  on public.evaluation_checklist_items for select
  to authenticated
  using (public.current_user_role() is not null);

create policy eval_checklist_items_no_insert
  on public.evaluation_checklist_items for insert to authenticated with check (false);
create policy eval_checklist_items_no_update
  on public.evaluation_checklist_items for update to authenticated using (false) with check (false);
create policy eval_checklist_items_no_delete
  on public.evaluation_checklist_items for delete to authenticated using (false);

-- =====================================================================
-- 2. evaluation_checklist_responses
-- =====================================================================
--
-- One row per (student × checklist_item). Unique key keeps the write-path
-- idempotent (teacher re-ticks a box, we upsert not duplicate). Scoped by
-- term_id + section_id for fast roster queries.

create table if not exists public.evaluation_checklist_responses (
  id                  uuid primary key default gen_random_uuid(),
  term_id             uuid not null references public.terms(id) on delete cascade,
  student_id          uuid not null references public.students(id) on delete cascade,
  section_id          uuid not null references public.sections(id) on delete cascade,
  checklist_item_id   uuid not null references public.evaluation_checklist_items(id) on delete cascade,
  is_checked          boolean not null default false,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (term_id, student_id, checklist_item_id)
);

create index if not exists evaluation_checklist_responses_section_term_idx
  on public.evaluation_checklist_responses (section_id, term_id);

comment on table public.evaluation_checklist_responses is
  'Per-student tick state for each checklist_item in a term. Subject teachers write from /evaluation/sections/[id] Checklists tab. Never flows to the report card.';

alter table public.evaluation_checklist_responses enable row level security;

drop policy if exists eval_checklist_responses_role_read  on public.evaluation_checklist_responses;
drop policy if exists eval_checklist_responses_no_insert  on public.evaluation_checklist_responses;
drop policy if exists eval_checklist_responses_no_update  on public.evaluation_checklist_responses;
drop policy if exists eval_checklist_responses_no_delete  on public.evaluation_checklist_responses;

create policy eval_checklist_responses_role_read
  on public.evaluation_checklist_responses for select
  to authenticated
  using (public.current_user_role() is not null);

create policy eval_checklist_responses_no_insert
  on public.evaluation_checklist_responses for insert to authenticated with check (false);
create policy eval_checklist_responses_no_update
  on public.evaluation_checklist_responses for update to authenticated using (false) with check (false);
create policy eval_checklist_responses_no_delete
  on public.evaluation_checklist_responses for delete to authenticated using (false);

-- =====================================================================
-- 3. evaluation_ptc_feedback
-- =====================================================================
--
-- One row per (student × term) for parent-teacher-conference feedback.
-- Free text; recorded by staff (registrar / school_admin) during PTC, not
-- by parents directly. Never flows to the report card.

create table if not exists public.evaluation_ptc_feedback (
  id           uuid primary key default gen_random_uuid(),
  term_id      uuid not null references public.terms(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  section_id   uuid not null references public.sections(id) on delete cascade,
  feedback     text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (term_id, student_id)
);

create index if not exists evaluation_ptc_feedback_section_term_idx
  on public.evaluation_ptc_feedback (section_id, term_id);

comment on table public.evaluation_ptc_feedback is
  'Parent-teacher-conference feedback per student per term. Staff-recorded (registrar / school_admin); never flows to the report card.';

alter table public.evaluation_ptc_feedback enable row level security;

drop policy if exists eval_ptc_feedback_role_read  on public.evaluation_ptc_feedback;
drop policy if exists eval_ptc_feedback_no_insert  on public.evaluation_ptc_feedback;
drop policy if exists eval_ptc_feedback_no_update  on public.evaluation_ptc_feedback;
drop policy if exists eval_ptc_feedback_no_delete  on public.evaluation_ptc_feedback;

create policy eval_ptc_feedback_role_read
  on public.evaluation_ptc_feedback for select
  to authenticated
  using (public.current_user_role() is not null);

create policy eval_ptc_feedback_no_insert
  on public.evaluation_ptc_feedback for insert to authenticated with check (false);
create policy eval_ptc_feedback_no_update
  on public.evaluation_ptc_feedback for update to authenticated using (false) with check (false);
create policy eval_ptc_feedback_no_delete
  on public.evaluation_ptc_feedback for delete to authenticated using (false);
