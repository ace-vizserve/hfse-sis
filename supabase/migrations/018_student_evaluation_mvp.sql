-- 018_student_evaluation_mvp.sql
--
-- Student Evaluation Module — MVP slice. Ships the writeup pipeline so the
-- next report-card run sources its "Form Class Adviser's Comments" field
-- from Evaluation instead of Markbook's report_card_comments table.
--
-- Scope (Sprint 15.Evaluation MVP):
--   1. `terms.virtue_theme`     — free-text virtue theme per term (SIS Admin).
--   2. `evaluation_terms`        — per-term open/close state for the module.
--   3. `evaluation_writeups`     — form class adviser's paragraph per student
--                                  × term. Sole source of FCA comments on
--                                  T1–T3 report cards going forward (KD #49).
--   4. `evaluation_subject_comments` — placeholder table. No UI writes to it
--                                  this sprint; ships now so migration 018 is
--                                  one-shot. Follow-up sprint populates.
--   5. One-time data migration   — copies existing `report_card_comments`
--                                  rows into `evaluation_writeups` so the
--                                  new read path picks up historical data.
--
-- RLS: reads scoped to `current_user_role() is not null`; all writes go
-- through service-role API routes (deny-writes on `authenticated`, matching
-- migrations 004 / 014 / 015).
--
-- `report_card_comments` is NOT dropped. It stays as legacy storage until
-- the new pipeline has produced at least one real report-card cycle. The
-- two Markbook comment UIs (`/markbook/sections/[id]/comments`,
-- `/markbook/grading/advisory/[id]/comments`) redirect to Evaluation in
-- Bite 6 but the table stays readable.
--
-- Apply after 017. Safe to re-run — all DDL uses IF NOT EXISTS / DO blocks
-- and the data migration uses ON CONFLICT DO NOTHING.

-- =====================================================================
-- 1. terms.virtue_theme
-- =====================================================================

alter table public.terms add column if not exists virtue_theme text;

comment on column public.terms.virtue_theme is
  'Free-text virtue theme for the term (e.g. "Faith, Hope, Love"). Set by registrar in SIS Admin; appears as a prompt to form class advisers in the Evaluation module and as a parenthetical on T1–T3 report cards. NULL = not yet set; evaluation window cannot open until populated.';

-- =====================================================================
-- 2. evaluation_terms
-- =====================================================================
--
-- Controls whether the evaluation window is open for a given term.
-- Separate from `terms.virtue_theme` because the theme is set early (config)
-- and the window opens later (publication).

create table if not exists public.evaluation_terms (
  id          uuid primary key default gen_random_uuid(),
  term_id     uuid not null unique references public.terms(id) on delete cascade,
  is_open     boolean not null default false,
  opened_at   timestamptz,
  opened_by   uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.evaluation_terms is
  'Per-term open/close state for the Student Evaluation module. One row per term once created; is_open=false is the default (teachers see a locked state).';

alter table public.evaluation_terms enable row level security;

drop policy if exists evaluation_terms_role_read  on public.evaluation_terms;
drop policy if exists evaluation_terms_no_insert  on public.evaluation_terms;
drop policy if exists evaluation_terms_no_update  on public.evaluation_terms;
drop policy if exists evaluation_terms_no_delete  on public.evaluation_terms;

create policy evaluation_terms_role_read
  on public.evaluation_terms for select
  to authenticated
  using (public.current_user_role() is not null);

create policy evaluation_terms_no_insert
  on public.evaluation_terms for insert to authenticated with check (false);
create policy evaluation_terms_no_update
  on public.evaluation_terms for update to authenticated using (false) with check (false);
create policy evaluation_terms_no_delete
  on public.evaluation_terms for delete to authenticated using (false);

-- =====================================================================
-- 3. evaluation_writeups
-- =====================================================================
--
-- Form class adviser's holistic paragraph per student per term. KD #49:
-- this is the sole source for T1–T3 report card FCA comments going
-- forward. `submitted=true` is a soft marker (KD #28 soft-gate pattern) —
-- edits remain possible until the follow-up sprint decides lock semantics.

create table if not exists public.evaluation_writeups (
  id            uuid primary key default gen_random_uuid(),
  term_id       uuid not null references public.terms(id) on delete cascade,
  student_id    uuid not null references public.students(id) on delete cascade,
  section_id    uuid not null references public.sections(id) on delete cascade,
  writeup       text,
  submitted     boolean not null default false,
  submitted_at  timestamptz,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (term_id, student_id)
);

create index if not exists evaluation_writeups_section_term_idx
  on public.evaluation_writeups (section_id, term_id);

comment on table public.evaluation_writeups is
  'Form class adviser''s holistic paragraph per student per term. Sole source of the "Form Class Adviser''s Comments" field on T1–T3 report cards (KD #49). T4 is excluded — the T4 final card has no comment section.';

comment on column public.evaluation_writeups.submitted is
  'Soft marker indicating the adviser has finalised this write-up. Edits remain possible by the adviser and by registrar+ (KD #28). The report-card reader does not gate on this field — unsubmitted write-ups still render.';

alter table public.evaluation_writeups enable row level security;

drop policy if exists evaluation_writeups_role_read  on public.evaluation_writeups;
drop policy if exists evaluation_writeups_no_insert  on public.evaluation_writeups;
drop policy if exists evaluation_writeups_no_update  on public.evaluation_writeups;
drop policy if exists evaluation_writeups_no_delete  on public.evaluation_writeups;

create policy evaluation_writeups_role_read
  on public.evaluation_writeups for select
  to authenticated
  using (public.current_user_role() is not null);

create policy evaluation_writeups_no_insert
  on public.evaluation_writeups for insert to authenticated with check (false);
create policy evaluation_writeups_no_update
  on public.evaluation_writeups for update to authenticated using (false) with check (false);
create policy evaluation_writeups_no_delete
  on public.evaluation_writeups for delete to authenticated using (false);

-- =====================================================================
-- 4. evaluation_subject_comments  (placeholder — no UI this sprint)
-- =====================================================================
--
-- Per-subject teacher comment per student per term. The spec calls this
-- the "Comments if any" field on the Excel evaluation workbook. Ships
-- now (not later) so migration 018 is a single shot; follow-up sprint
-- wires the UI + API. Subject/level normalised to UUID FK per project
-- convention (KD #4), deviating from the spec's `subject TEXT` shape.

create table if not exists public.evaluation_subject_comments (
  id          uuid primary key default gen_random_uuid(),
  term_id     uuid not null references public.terms(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  section_id  uuid not null references public.sections(id) on delete cascade,
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  comment     text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (term_id, student_id, subject_id)
);

comment on table public.evaluation_subject_comments is
  'Subject teacher''s optional per-student comment ("Comments if any" in the legacy Excel workbook). PTC use only — never flows to the report card. Placeholder in Sprint Evaluation MVP; follow-up sprint adds the write UI.';

alter table public.evaluation_subject_comments enable row level security;

drop policy if exists evaluation_subject_comments_role_read  on public.evaluation_subject_comments;
drop policy if exists evaluation_subject_comments_no_insert  on public.evaluation_subject_comments;
drop policy if exists evaluation_subject_comments_no_update  on public.evaluation_subject_comments;
drop policy if exists evaluation_subject_comments_no_delete  on public.evaluation_subject_comments;

create policy evaluation_subject_comments_role_read
  on public.evaluation_subject_comments for select
  to authenticated
  using (public.current_user_role() is not null);

create policy evaluation_subject_comments_no_insert
  on public.evaluation_subject_comments for insert to authenticated with check (false);
create policy evaluation_subject_comments_no_update
  on public.evaluation_subject_comments for update to authenticated using (false) with check (false);
create policy evaluation_subject_comments_no_delete
  on public.evaluation_subject_comments for delete to authenticated using (false);

-- =====================================================================
-- 5. One-time data migration
-- =====================================================================
--
-- Copy every existing report_card_comments row into evaluation_writeups.
-- Marked submitted=true (historical: these rows already produced printed
-- report cards). Idempotent via ON CONFLICT — safe to re-run. Skips rows
-- with empty/null comment.

insert into public.evaluation_writeups (
  term_id, student_id, section_id, writeup, submitted, submitted_at,
  created_at, updated_at
)
select
  term_id,
  student_id,
  section_id,
  comment,
  true,
  created_at,
  created_at,
  coalesce(updated_at, created_at)
from public.report_card_comments
where comment is not null and comment <> ''
on conflict (term_id, student_id) do nothing;
