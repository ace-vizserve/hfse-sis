-- 174_admission_options.sql
--
-- The SIS decides which level / class type / schedule combinations a parent
-- can pick on the enrolment forms, per academic year.
--
-- ⚠ NUMBERED 174. 172 is still reserved for the realtime-publication cleanup
-- (written, deliberately unapplied until a browser pass confirms a badge
-- moves), and 173 is the Youngstarters level. This is unrelated to both.
--
-- WHY THIS EXISTS. The parent portal (`app-online-admission`) hardcodes all
-- three fields:
--   - the LEVEL list is `classLevels` in `src/data.ts`;
--   - the level → CLASS TYPE table is copied by hand into four forms (new,
--     re-enrolment, open house, and `complete-enrolment.tsx`'s
--     `classTypeOptionsForLevel`);
--   - the SCHEDULE rules are `src/lib/schedule-rules.ts`.
-- So every capacity decision is a code deploy. The schedule rules changed five
-- times between 25 Aug and 16 Sep ("close Morning for Standard P2/P3/P4/P6",
-- "reopen Morning for P4", ...), and a label rename on 2026-07-20 left 12 level
-- names the SIS could not resolve, so those children fell into
-- /records/level-mismatches.
--
-- ONE ROW PER PICKABLE COMBINATION. The portal builds its dropdowns from the
-- open rows alone: levels = distinct `level_label` with an open row; class
-- types = open rows for that level; schedules = open rows for that level and
-- type. Closing an option is unticking `is_open` — the row stays, so a closed
-- Morning is visible to staff as a switch rather than simply missing.
--
--   level_label       exactly what parents see and what lands in `levelApplied`
--   level_id          the SIS level it means — so section assignment never has
--                     to guess from the text
--   class_type_label  exactly what lands in `classType`
--   track             the section track that class type belongs to. Two only:
--                     Cambridge is Global (Mr Ace, 2026-09-24)
--   schedule          same vocabulary as `sections.schedule` (migration 074);
--                     the portal's "Morning"/"Afternoon"/"Whole Day" is a
--                     presentation of it
--
-- The label columns are free text on purpose: the portal's re-enrolment
-- progression and fee groups still key on the level TEXT, so a rename here is
-- a real change with a real blast radius, not a display tweak.
--
-- ⚠ RLS ENABLED WITH NO POLICIES — SERVICE ROLE ONLY, AND THAT IS THE DESIGN.
-- The portal never reads this table directly: it calls an SIS endpoint
-- (`/api/parent/v2/admission-options`), which reads with the service client.
-- So no browser role needs a grant, and giving none closes the door this repo
-- already left open once — the `ay{YYYY}_*` admissions tables are readable
-- with the public anon key (measured 2026-09-17). A table with RLS on and no
-- policy is invisible to anon and authenticated alike; add a policy only
-- together with a reader that genuinely needs one.
--
-- Additive only; nothing existing is altered. Seeded separately by
-- `scripts/backfill/seed-admission-options.ts` (dry-run by default).

begin;

create table if not exists public.admission_options (
  id                uuid primary key default gen_random_uuid(),
  academic_year_id  uuid not null references public.academic_years(id) on delete cascade,
  level_label       text not null
                    check (level_label = btrim(level_label) and level_label <> ''),
  level_id          uuid not null references public.levels(id),
  class_type_label  text not null
                    check (class_type_label = btrim(class_type_label) and class_type_label <> ''),
  track             text not null check (track in ('Global', 'Standard')),
  schedule          text not null check (schedule in ('morning', 'afternoon', 'whole_day')),
  is_open           boolean not null default true,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (academic_year_id, level_label, class_type_label, schedule)
);

-- The unique key already leads with academic_year_id, but the endpoint and the
-- admin page both read a whole AY at a time; a dedicated index keeps that plan
-- obvious rather than incidental to the constraint's column order.
create index if not exists admission_options_academic_year_id_idx
  on public.admission_options (academic_year_id);

-- updated_at is bumped by the database, not trusted to every write route.
create or replace function public.admission_options_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists admission_options_touch_updated_at on public.admission_options;
create trigger admission_options_touch_updated_at
  before update on public.admission_options
  for each row execute function public.admission_options_touch_updated_at();

alter table public.admission_options enable row level security;

comment on table public.admission_options is
  'Per-AY level / class type / schedule combinations offered on the parent enrolment forms. One row per combination; is_open=false withdraws it from the form without deleting it. RLS on with no policies: service role only — the portal reads through /api/parent/v2/admission-options.';

commit;
