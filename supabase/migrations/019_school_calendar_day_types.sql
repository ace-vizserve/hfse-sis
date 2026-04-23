-- 019_school_calendar_day_types.sql
--
-- School calendar 5 day-type expansion (KD #50). Replaces the binary
-- is_holiday flag with a typed day_type column that distinguishes:
--
--   school_day      — regular in-school day (encodable)
--   public_holiday  — national / public closure (CNY, National Day; not encodable)
--   school_holiday  — school-only closure (staff PD, founder's day; not encodable)
--   hbl             — home-based learning (encodable; teachers mark from home)
--   no_class        — school-wide no-class day (not encodable)
--
-- Encodable vs not-encodable drives the attendance grid:
--   day_type in ('school_day','hbl')  → attendance grid accepts writes
--   day_type in ('public_holiday','school_holiday','no_class') → grid greyed,
--     POST /api/attendance/daily returns 409.
--
-- The existing `is_holiday` column is kept and synced via BEFORE trigger so
-- every consumer that still reads it (copy-holidays dialog, prior-AY list,
-- calendar admin queries) keeps working without line-by-line rewrite. Full
-- retirement of is_holiday happens in a follow-up once every read has moved
-- to day_type.
--
-- Attendance rollup (migration 014) is NOT changed. school_days already
-- counts non-NC daily rows — encodable days produce those rows, non-encodable
-- days don't, so the denominator naturally reflects the new classification.
--
-- RLS unchanged — service-role-only writes (migration 004 pattern).
--
-- Apply after 018. Safe to re-run — IF NOT EXISTS + conditional constraint
-- drop + CREATE OR REPLACE trigger function.

-- =====================================================================
-- 1. day_type column + backfill + NOT NULL + CHECK
-- =====================================================================

alter table public.school_calendar
  add column if not exists day_type text;

-- Backfill: existing is_holiday=true rows land in public_holiday (safe default
-- bucket — registrar reclassifies PD days / no-class days per row post-deploy).
update public.school_calendar
  set day_type = case when is_holiday then 'public_holiday' else 'school_day' end
  where day_type is null;

alter table public.school_calendar
  alter column day_type set not null;

-- Idempotent CHECK: drop if exists then add.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'school_calendar_day_type_chk'
      and conrelid = 'public.school_calendar'::regclass
  ) then
    alter table public.school_calendar drop constraint school_calendar_day_type_chk;
  end if;
end $$;

alter table public.school_calendar
  add constraint school_calendar_day_type_chk
  check (day_type in (
    'school_day',
    'public_holiday',
    'school_holiday',
    'hbl',
    'no_class'
  ));

comment on column public.school_calendar.day_type is
  'Calendar day classification (school_day / public_holiday / school_holiday / hbl / no_class). Drives attendance-grid editability: only school_day and hbl are encodable. Prefer day_type for new code — is_holiday is a derived legacy column synced via trigger.';

-- =====================================================================
-- 2. Sync trigger — keep is_holiday derived from day_type
-- =====================================================================
--
-- Any write that sets day_type automatically corrects is_holiday. Writers
-- can supply whatever value for is_holiday; the trigger overrides it.

create or replace function public.school_calendar_sync_is_holiday()
returns trigger
language plpgsql
as $$
begin
  new.is_holiday := new.day_type not in ('school_day', 'hbl');
  return new;
end
$$;

drop trigger if exists school_calendar_sync_is_holiday on public.school_calendar;

create trigger school_calendar_sync_is_holiday
  before insert or update on public.school_calendar
  for each row
  execute function public.school_calendar_sync_is_holiday();

-- Re-sync existing rows (idempotent — the trigger re-derives is_holiday
-- from each row's day_type, so a no-op update fires it for every row).
-- Only runs on rows where a drift would matter; cheap for HFSE volumes.
update public.school_calendar
  set day_type = day_type
  where is_holiday is distinct from (day_type not in ('school_day', 'hbl'));
