-- 037_calendar_audience_and_categories.sql
--
-- Calendar audience scope + event categories + tentative flag.
--
-- KD #50 stays binding: the 5 day-types (school_day / public_holiday /
-- school_holiday / hbl / no_class) remain the attendance gate. New
-- precedence rule layered on top: an audience-specific school_calendar
-- row beats the audience='all' row for the same date when an attendance
-- writer's section level matches.
--
-- calendar_events grows a typed `category` enum so the admin can filter
-- and color-code by event type (term_exam / term_break / start_of_term /
-- parents_dialogue / subject_week / school_event / pfe / ptc / other).
-- Display-only — does not gate attendance.
--
-- `tentative` carries provisional dates copied from a prior AY so the
-- registrar reviews each row before locking. Defaults false; copy-from-
-- prior-AY dialog flips it to true on every copied row.
--
-- Backfill: every existing row receives audience='all', category='other'
-- (events only), tentative=false. Legacy AYs work unchanged — no rework
-- needed; primary/secondary filter views just show the unified 'all' set
-- until the registrar tags rows individually.
--
-- Apply after 036. Safe to re-run — IF NOT EXISTS / DO blocks throughout.

-- =====================================================================
-- 1. school_calendar — audience column + widen unique key
-- =====================================================================

alter table public.school_calendar
  add column if not exists audience text not null default 'all';

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'school_calendar_audience_chk'
      and conrelid = 'public.school_calendar'::regclass
  ) then
    alter table public.school_calendar drop constraint school_calendar_audience_chk;
  end if;
end $$;

alter table public.school_calendar
  add constraint school_calendar_audience_chk
  check (audience in ('all', 'primary', 'secondary'));

comment on column public.school_calendar.audience is
  'Audience scope: ''all'' (every section), ''primary'' / ''secondary'' (level-specific override). Audience-specific rows beat the ''all'' row for the same date. Preschool sections always read ''all''.';

-- Widen the unique key from (term_id, date) → (term_id, audience, date)
-- so primary + secondary can each have a row on the same date (e.g.
-- primary HBL while secondary stays a school_day).
--
-- Migration 015 declared `unique (term_id, date)` inline; Postgres
-- auto-named the constraint `school_calendar_term_id_date_key`.
alter table public.school_calendar
  drop constraint if exists school_calendar_term_id_date_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'school_calendar_term_audience_date_uniq'
      and conrelid = 'public.school_calendar'::regclass
  ) then
    alter table public.school_calendar
      add constraint school_calendar_term_audience_date_uniq
      unique (term_id, audience, date);
  end if;
end $$;

create index if not exists school_calendar_term_audience_date_idx
  on public.school_calendar (term_id, audience, date);

-- =====================================================================
-- 2. calendar_events — audience + category + tentative
-- =====================================================================

alter table public.calendar_events
  add column if not exists audience text not null default 'all';

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'calendar_events_audience_chk'
      and conrelid = 'public.calendar_events'::regclass
  ) then
    alter table public.calendar_events drop constraint calendar_events_audience_chk;
  end if;
end $$;

alter table public.calendar_events
  add constraint calendar_events_audience_chk
  check (audience in ('all', 'primary', 'secondary'));

alter table public.calendar_events
  add column if not exists category text not null default 'other';

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'calendar_events_category_chk'
      and conrelid = 'public.calendar_events'::regclass
  ) then
    alter table public.calendar_events drop constraint calendar_events_category_chk;
  end if;
end $$;

alter table public.calendar_events
  add constraint calendar_events_category_chk
  check (category in (
    'term_exam',
    'term_break',
    'start_of_term',
    'parents_dialogue',
    'subject_week',
    'school_event',
    'pfe',
    'ptc',
    'other'
  ));

alter table public.calendar_events
  add column if not exists tentative boolean not null default false;

create index if not exists calendar_events_term_audience_idx
  on public.calendar_events (term_id, audience, start_date);

comment on column public.calendar_events.audience is
  'Audience scope: all / primary / secondary. Drives admin filter views and per-level overlays.';
comment on column public.calendar_events.category is
  'Typed event category. Drives color-coding + filtering. ''other'' is the fallback for legacy rows.';
comment on column public.calendar_events.tentative is
  'Provisional date pending registrar review. Default false. Copy-from-prior-AY sets this to true on every copied row.';
