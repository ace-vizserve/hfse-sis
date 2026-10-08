-- Migration 186 — the grading lock has a time of day, and holds at that minute.
--
-- WHY. Term dates carried "Grading lock by" as a DATE (migration 020), and the
-- daily cron (06:00 SGT) locked every sheet whose date was before today — so a
-- sheet actually locked the morning AFTER the deadline, and anything typed in
-- between still saved. Mr Ace asked for a date AND time.
--
-- WHAT.
--   1. `terms.grading_lock_at timestamptz` — the exact deadline. Backfilled
--      from `grading_lock_date` as that day 23:59 Singapore time, the same
--      "teachers get the whole day" the date meant.
--   2. `grading_lock_date` stays, kept in step by a trigger (it is the
--      Singapore calendar day of `grading_lock_at`), so any old reader or
--      script that still sets the date alone keeps working. Every app reader
--      has moved to `grading_lock_at`.
--   3. `grading_sheets.unlocked_at` — when a coordinator last unlocked the
--      sheet. A deadline that has passed counts as a lock UNLESS the sheet was
--      unlocked after it (the unlock route's deliberate ?force=true override);
--      without this column a force-unlocked sheet past its deadline could never
--      be written again.
--   4. `can_write_grade_entry` (the RLS gate for browser score writes, migration
--      152) refuses a sheet whose term's lock time has passed, exactly as it
--      refuses a locked one. The cron's daily schedule is unchanged; the stored
--      `is_locked` flag catches up the next morning, or on the first server
--      write after the deadline.
--
-- Grade computation is untouched (Hard Rule #1). A past-deadline sheet takes
-- the same post-lock path as a locked one (Hard Rule #5).

alter table public.terms
  add column if not exists grading_lock_at timestamptz;

comment on column public.terms.grading_lock_at is
  'Grading deadline (exact instant). Once passed, the term''s sheets count as locked for score writes; the daily cron then sets grading_sheets.is_locked. Migration 186.';

update public.terms
   set grading_lock_at = ((grading_lock_date::text || ' 23:59')::timestamp
                          at time zone 'Asia/Singapore')
 where grading_lock_date is not null
   and grading_lock_at is null;

-- Keep the old date column in step with the new instant, whichever is written.
create or replace function public.terms_sync_grading_lock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.grading_lock_at is not null then
      new.grading_lock_date := (new.grading_lock_at at time zone 'Asia/Singapore')::date;
    elsif new.grading_lock_date is not null then
      new.grading_lock_at := (new.grading_lock_date::text || ' 23:59')::timestamp
                             at time zone 'Asia/Singapore';
    end if;
    return new;
  end if;

  if new.grading_lock_at is distinct from old.grading_lock_at then
    new.grading_lock_date := case
      when new.grading_lock_at is null then null
      else (new.grading_lock_at at time zone 'Asia/Singapore')::date
    end;
  elsif new.grading_lock_date is distinct from old.grading_lock_date then
    new.grading_lock_at := case
      when new.grading_lock_date is null then null
      else (new.grading_lock_date::text || ' 23:59')::timestamp
           at time zone 'Asia/Singapore'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists terms_sync_grading_lock_trg on public.terms;
create trigger terms_sync_grading_lock_trg
  before insert or update of grading_lock_at, grading_lock_date on public.terms
  for each row execute function public.terms_sync_grading_lock();

alter table public.grading_sheets
  add column if not exists unlocked_at timestamptz;

comment on column public.grading_sheets.unlocked_at is
  'When the sheet was last unlocked by a coordinator. An unlock after the term''s grading_lock_at overrides the deadline until the next lock. Migration 186.';

-- Past its term's lock time, and not unlocked since. The one definition the
-- write gate uses; lib/grading/deadline-lock.ts mirrors it for the routes.
create or replace function public.grading_sheet_past_lock(p_sheet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.grading_sheets gs
    join public.terms t on t.id = gs.term_id
    where gs.id = p_sheet_id
      and t.grading_lock_at is not null
      and t.grading_lock_at <= now()
      and (gs.unlocked_at is null or gs.unlocked_at < t.grading_lock_at)
  );
$$;

-- Unlocked, before the deadline, and mine to teach. Same body as migration 152
-- plus the deadline clause.
create or replace function public.can_write_grade_entry(p_sheet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.grading_sheets gs
    where gs.id = p_sheet_id
      and gs.is_locked = false
      and not public.grading_sheet_past_lock(gs.id)
      and (public.is_registrar_or_above()
           or public.is_subject_teacher_for_sheet(gs.id))
  );
$$;
