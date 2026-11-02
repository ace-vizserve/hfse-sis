-- 203_parent_events.sql
--
-- Parent event registration: the school publishes an event (a consent slip or a
-- sign-up), parents answer it once per family, and each child gets a row.
--
--   parent_events               one row per event, with its form as jsonb
--   parent_event_submissions    one row per parent per event (family answers, signature)
--   parent_event_registrations  one row per child per event (registered / not joining)
--
-- Service-client only: RLS is on and there are deliberately no policies, the
-- same as admission_options. Rows are never deleted out from under answers
-- (on delete restrict).

create table if not exists public.parent_events (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id),
  slug text not null unique,
  title text not null,
  description text not null default '',
  starts_on date not null,
  ends_on date,
  time_label text not null default '',
  venue text not null default '',
  audience text not null check (audience in ('all', 'primary', 'secondary')),
  levels text[] not null default '{}',
  section_ids uuid[] not null default '{}',
  answer_mode text not null check (answer_mode in ('consent', 'register')),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  form jsonb not null default '{"sections":[]}'::jsonb,
  published_at timestamptz,
  closed_early_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closes_at > opens_at)
);

create table if not exists public.parent_event_submissions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.parent_events (id) on delete restrict,
  parent_email text not null,
  parent_name text not null,
  parent_phone text not null,
  family_answers jsonb not null default '{}'::jsonb,
  signature_name text,
  signed_at timestamptz,
  submitted_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, parent_email)
);

create table if not exists public.parent_event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.parent_events (id) on delete restrict,
  submission_id uuid not null references public.parent_event_submissions (id),
  student_id uuid not null references public.students (id),
  section_id uuid references public.sections (id),
  status text not null check (status in ('registered', 'not_joining')),
  not_joining_reason text,
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, student_id)
);

create index if not exists parent_events_academic_year_id_idx
  on public.parent_events (academic_year_id);
create index if not exists parent_event_registrations_event_status_idx
  on public.parent_event_registrations (event_id, status);
-- The parent events list looks up a family's registrations by child, across
-- events; the unique (event_id, student_id) index does not serve that.
create index if not exists parent_event_registrations_student_id_idx
  on public.parent_event_registrations (student_id);

-- updated_at is bumped by the database, not trusted to every write route.
create or replace function public.parent_events_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists parent_events_touch_updated_at on public.parent_events;
create trigger parent_events_touch_updated_at
  before update on public.parent_events
  for each row execute function public.parent_events_touch_updated_at();

drop trigger if exists parent_event_submissions_touch_updated_at on public.parent_event_submissions;
create trigger parent_event_submissions_touch_updated_at
  before update on public.parent_event_submissions
  for each row execute function public.parent_events_touch_updated_at();

drop trigger if exists parent_event_registrations_touch_updated_at on public.parent_event_registrations;
create trigger parent_event_registrations_touch_updated_at
  before update on public.parent_event_registrations
  for each row execute function public.parent_events_touch_updated_at();

alter table public.parent_events enable row level security;
alter table public.parent_event_submissions enable row level security;
alter table public.parent_event_registrations enable row level security;
