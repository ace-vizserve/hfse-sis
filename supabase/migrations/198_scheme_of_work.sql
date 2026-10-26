-- 198: Scheme of Work (SOW) tables.
--
-- A SOW is the week-by-week teaching plan for one subject, one level and one
-- track in one term. A teacher writes it, a subject head approves it through
-- the approval engine (126/127/145), and each week is then ticked off as taught.
--
-- ⚠ POSTURE. Every table here denies `authenticated` everything and is reached
-- only through the service role, exactly like the approval tables (126). The
-- app checks roles in code; nothing in the browser talks to these tables.
--
-- ⚠ NO FOREIGN KEYS to auth.users. User columns are plain uuids so decision
-- rows outlive an account (KD #196). `approval_requests.subject_id` for a SOW
-- is scheme_of_work_submissions.id; the engine never has an FK on subject_id.
--
-- Idempotent: `if not exists`, `drop ... if exists`, safe to re-run.

-- ── 1. The scheme itself ────────────────────────────────────────────────────

create table if not exists public.schemes_of_work (
  id                    uuid primary key default gen_random_uuid(),
  academic_year_id      uuid not null references public.academic_years (id) on delete restrict,
  term_id               uuid not null references public.terms (id) on delete restrict,
  subject_id            uuid not null references public.subjects (id) on delete restrict,
  level_id              uuid not null references public.levels (id) on delete restrict,
  track                 text not null check (track in ('Standard', 'Global')),
  state                 text not null default 'draft'
                          check (state in ('draft', 'in_review', 'returned', 'approved')),
  -- title, syllabus, hoursPerWeek, teachingMethods, passRequirement,
  -- textbook, references, remarks
  module                jsonb not null default '{}'::jsonb,
  approved_snapshot     jsonb,
  approved_at           timestamptz,
  current_submission_id uuid,
  started_from          text not null default 'blank'
                          check (started_from in ('copy', 'blank', 'import')),
  copied_from_sow_id    uuid,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint schemes_of_work_term_subject_level_track_key
    unique (term_id, subject_id, level_id, track)
);

comment on table public.schemes_of_work is
  'One scheme of work: the teaching plan for a subject, level and track in one term, with its module details and its approval state.';
comment on column public.schemes_of_work.approved_snapshot is
  'A frozen copy of the module and weeks taken when the scheme was approved, so later edits do not rewrite what was signed off.';
comment on column public.schemes_of_work.current_submission_id is
  'The submission now in review or last decided; no foreign key, to keep the two tables free to be written in either order.';

-- ── 2. Which classes follow it ──────────────────────────────────────────────

create table if not exists public.scheme_of_work_classes (
  sow_id     uuid not null references public.schemes_of_work (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (sow_id, section_id)
);

comment on table public.scheme_of_work_classes is
  'The classes (sections) that follow a scheme of work; the rule that one class sits on only one scheme per subject and term is enforced in code because the subject lives on the parent row.';

create index if not exists scheme_of_work_classes_section_idx
  on public.scheme_of_work_classes (section_id);

-- ── 3. The weekly rows ──────────────────────────────────────────────────────

create table if not exists public.scheme_of_work_weeks (
  id                uuid primary key default gen_random_uuid(),
  sow_id            uuid not null references public.schemes_of_work (id) on delete cascade,
  week_number       integer not null check (week_number >= 1),
  starts_on         date not null,
  ends_on           date not null,
  topic             text,
  learning_outcomes text,   -- rich text (HTML)
  textbook_pages    text,
  activities        text,   -- rich text (HTML)
  assessment        text,
  remarks           text,   -- rich text (HTML)
  updated_at        timestamptz not null default now(),
  constraint scheme_of_work_weeks_sow_week_key unique (sow_id, week_number),
  constraint scheme_of_work_weeks_dates_chk check (ends_on >= starts_on)
);

comment on table public.scheme_of_work_weeks is
  'The week-by-week plan of a scheme of work: one row per numbered teaching week, with its topic, outcomes, activities and assessment.';

-- ⚠ A WEEK CHANGES ONLY WHILE ITS SCHEME IS A DRAFT OR RETURNED. The app checks
-- the state first (lib/sow/edit.ts), but a send can land between that check
-- and the week write, which would change the plan under review. supabase-js has
-- no transactions, so the rule lives here: the parent row is read FOR SHARE,
-- which waits for a send's state update to commit (and makes a send wait for
-- this write), then the state decides. SQLSTATE 55000 is mapped to a 423.
-- Inserts are not checked (a scheme's weeks are written when it is made), and
-- a delete cascading from a deleted scheme finds no parent row and passes.
create or replace function public.scheme_of_work_weeks_editable()
returns trigger
language plpgsql
as $$
declare
  parent_state text;
begin
  select s.state into parent_state
    from public.schemes_of_work s
   where s.id = old.sow_id
     for share;
  if parent_state in ('in_review', 'approved') then
    raise exception using
      errcode = '55000',
      message = 'scheme_of_work_locked',
      detail  = 'A scheme of work in review or approved cannot have its weeks changed.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists scheme_of_work_weeks_editable on public.scheme_of_work_weeks;
create trigger scheme_of_work_weeks_editable
  before update or delete on public.scheme_of_work_weeks
  for each row execute function public.scheme_of_work_weeks_editable();

-- ── 4. Each time it was sent for approval ───────────────────────────────────

create table if not exists public.scheme_of_work_submissions (
  id                 uuid primary key default gen_random_uuid(),
  sow_id             uuid not null references public.schemes_of_work (id) on delete cascade,
  submitted_by       uuid,
  submitted_at       timestamptz not null default now(),
  outcome            text not null default 'pending'
                       check (outcome in ('pending', 'approved', 'returned', 'cancelled')),
  return_note        text,
  return_week_number integer
);

comment on table public.scheme_of_work_submissions is
  'Each time a scheme of work was sent for approval and how it ended; its id is the subject_id of the approval request in the approval engine.';

create index if not exists scheme_of_work_submissions_sow_idx
  on public.scheme_of_work_submissions (sow_id, submitted_at desc);

-- ── 5. Weekly "was it taught?" checks ───────────────────────────────────────

create table if not exists public.scheme_of_work_checks (
  id              uuid primary key default gen_random_uuid(),
  sow_id          uuid not null references public.schemes_of_work (id) on delete cascade,
  week_number     integer not null check (week_number >= 1),
  section_id      uuid not null references public.sections (id) on delete restrict,
  teacher_user_id uuid not null,
  option          text not null
                    check (option in ('as_planned', 'adjusted', 'delayed', 'extra')),
  note            text,
  recorded_at     timestamptz not null default now()
);

comment on table public.scheme_of_work_checks is
  'A teacher''s weekly answer on whether a class taught the planned week; append-only, the newest row per week, class and teacher wins.';

create index if not exists scheme_of_work_checks_lookup_idx
  on public.scheme_of_work_checks (sow_id, week_number, section_id, teacher_user_id, recorded_at desc);

-- ── 6. Relief-teacher notes ─────────────────────────────────────────────────

create table if not exists public.scheme_of_work_relief_notes (
  id                     uuid primary key default gen_random_uuid(),
  -- Null when the class has no scheme of work for that subject and day.
  sow_id                 uuid references public.schemes_of_work (id) on delete set null,
  week_number            integer,
  section_id             uuid not null references public.sections (id) on delete restrict,
  subject_id             uuid not null references public.subjects (id) on delete restrict,
  taught_on              date not null,
  relief_teacher_user_id uuid not null,
  note                   text not null,
  created_at             timestamptz not null default now()
);

comment on table public.scheme_of_work_relief_notes is
  'What a relief teacher covered in a class on one day, kept against the scheme and week when the class has one.';

create index if not exists scheme_of_work_relief_notes_sow_idx
  on public.scheme_of_work_relief_notes (sow_id, week_number);

-- One note per relief teacher, class, subject and day: saving again the same
-- day replaces it (an upsert on this key, lib/sow/relief.ts). The key is what
-- makes "one per day" true under two saves at once, not just a code habit.
create unique index if not exists scheme_of_work_relief_notes_one_per_day
  on public.scheme_of_work_relief_notes (relief_teacher_user_id, section_id, subject_id, taught_on);

-- ── 7. Sign-offs ────────────────────────────────────────────────────────────

create table if not exists public.scheme_of_work_signoffs (
  id          uuid primary key default gen_random_uuid(),
  sow_id      uuid not null references public.schemes_of_work (id) on delete cascade,
  week_number integer not null check (week_number >= 1),
  section_id  uuid not null references public.sections (id) on delete restrict,
  signed_by   uuid not null,
  remarks     text,
  kind        text not null check (kind in ('signed', 'asked')),
  created_at  timestamptz not null default now()
);

comment on table public.scheme_of_work_signoffs is
  'A subject head''s sign-off (or request for more detail) on a class''s week; append-only, the newest row wins.';

create index if not exists scheme_of_work_signoffs_lookup_idx
  on public.scheme_of_work_signoffs (sow_id, week_number, section_id, created_at desc);

-- ── 8. Subject heads ────────────────────────────────────────────────────────

-- ⚠ CASCADE, not restrict: a head of a deleted subject means nothing. The
-- Subject Setup delete removes the subject LAST, after its setup rows; a
-- restrict here failed that last step with the setup already gone. (A subject
-- a scheme of work uses is refused before anything is deleted — the schemes
-- themselves stay restrict.)
create table if not exists public.subject_heads (
  id                    uuid primary key default gen_random_uuid(),
  subject_id            uuid not null references public.subjects (id) on delete cascade,
  user_id               uuid not null,
  applies_to_level_type text check (applies_to_level_type in ('primary', 'secondary')),
  created_at            timestamptz not null default now(),
  created_by            uuid
);

comment on table public.subject_heads is
  'Who heads a subject, optionally for only the primary or only the secondary levels; they approve that subject''s schemes of work.';

-- Same coalesce trick as 128: a plain unique index treats two NULLs as
-- different, which would let the same head be listed twice for "all levels".
create unique index if not exists subject_heads_once
  on public.subject_heads (subject_id, user_id, coalesce(applies_to_level_type, '*'));

-- ── 9. A stage can resolve to a subject head ────────────────────────────────
-- Only the stage CONFIG learns the new value. approval_request_stages keeps
-- resolver = 'named': a subject-head step is turned into a named pool when the
-- request is filed, like any other frozen list.

alter table public.approval_stages
  drop constraint if exists approval_stages_resolver_check;

alter table public.approval_stages
  add constraint approval_stages_resolver_check
  check (resolver in ('named', 'form_adviser', 'subject_head'));

-- ── 10. Closed to the browser ───────────────────────────────────────────────

alter table public.schemes_of_work             enable row level security;
alter table public.scheme_of_work_classes      enable row level security;
alter table public.scheme_of_work_weeks        enable row level security;
alter table public.scheme_of_work_submissions  enable row level security;
alter table public.scheme_of_work_checks       enable row level security;
alter table public.scheme_of_work_relief_notes enable row level security;
alter table public.scheme_of_work_signoffs     enable row level security;
alter table public.subject_heads               enable row level security;

revoke all on public.schemes_of_work             from authenticated;
revoke all on public.scheme_of_work_classes      from authenticated;
revoke all on public.scheme_of_work_weeks        from authenticated;
revoke all on public.scheme_of_work_submissions  from authenticated;
revoke all on public.scheme_of_work_checks       from authenticated;
revoke all on public.scheme_of_work_relief_notes from authenticated;
revoke all on public.scheme_of_work_signoffs     from authenticated;
revoke all on public.subject_heads               from authenticated;

revoke all on public.schemes_of_work             from anon;
revoke all on public.scheme_of_work_classes      from anon;
revoke all on public.scheme_of_work_weeks        from anon;
revoke all on public.scheme_of_work_submissions  from anon;
revoke all on public.scheme_of_work_checks       from anon;
revoke all on public.scheme_of_work_relief_notes from anon;
revoke all on public.scheme_of_work_signoffs     from anon;
revoke all on public.subject_heads               from anon;

-- Belt and braces, the same four deny policies as 126.
do $$
declare
  t text;
begin
  foreach t in array array[
    'schemes_of_work',
    'scheme_of_work_classes',
    'scheme_of_work_weeks',
    'scheme_of_work_submissions',
    'scheme_of_work_checks',
    'scheme_of_work_relief_notes',
    'scheme_of_work_signoffs',
    'subject_heads'
  ]
  loop
    execute format('drop policy if exists %I_no_select on public.%I', t, t);
    execute format('create policy %I_no_select on public.%I for select to authenticated using (false)', t, t);

    execute format('drop policy if exists %I_no_insert on public.%I', t, t);
    execute format('create policy %I_no_insert on public.%I for insert to authenticated with check (false)', t, t);

    execute format('drop policy if exists %I_no_update on public.%I', t, t);
    execute format('create policy %I_no_update on public.%I for update to authenticated using (false) with check (false)', t, t);

    execute format('drop policy if exists %I_no_delete on public.%I', t, t);
    execute format('create policy %I_no_delete on public.%I for delete to authenticated using (false)', t, t);
  end loop;
end $$;
