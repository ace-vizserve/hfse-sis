-- 196_school_calendar_level_audience.sql
--
-- A calendar day can be aimed at ONE LEVEL, not only at a half of the school
-- (plan docs/superpowers/plans/2026-10-22-calendar-level-scope.md, Phase 1).
-- "No class — P1" has to close Primary One that day and leave every other
-- level a normal school day, and until now the only audiences a
-- `school_calendar` row could carry were 'all' / 'primary' / 'secondary'.
--
-- Two parts:
--
--   1. `school_calendar_audience_chk` widens to the ten level codes P1–P6,
--      S1–S4 (one row per level). Youngstarters (YS) gets no code of its own:
--      it keeps reading its band and 'all', exactly as before.
--   2. `attendance_write_blocked` — the SQL mirror of
--      lib/attendance/school-days.ts — matches the student's level code too,
--      and ranks the rows for a date: level code → band → 'all'.
--
-- `calendar_events_audience_chk` is NOT touched. Events already scope to
-- levels and classes through `levels` / `section_ids` (migration 158).
--
-- Existing rows are untouched — every one is 'all' / 'primary' / 'secondary'
-- and reads exactly as it did.
--
-- Idempotent and safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Widen the audience CHECK
-- ---------------------------------------------------------------------------

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
  check (audience in (
    'all', 'primary', 'secondary',
    'P1', 'P2', 'P3', 'P4', 'P5', 'P6',
    'S1', 'S2', 'S3', 'S4'
  ));

comment on column public.school_calendar.audience is
  'Audience scope: ''all'' (every section), ''primary'' / ''secondary'' (one half of the school), or a level code ''P1''–''P6'' / ''S1''–''S4'' (one level). For a section on a date the row that applies is its level code, else its half, else ''all''. Preschool sections always read ''all''; Youngstarters reads its half and ''all'' (no code rows).';

-- ---------------------------------------------------------------------------
-- 2. The write gate reads the level code too
-- ---------------------------------------------------------------------------
--
-- Carried over from migration 149 unchanged except for the audience match:
--
--   * Encodable is 'school_day', 'hbl', AND 'school_holiday' when
--     `hbl_overlay` is true — teachers deliver home-based learning while the
--     day is officially a closure for students (KD #50, migration 051).
--     Forgetting that fourth case would block a legitimate HBL register.
--   * A TERM WITH NO CALENDAR ROWS BLOCKS NOTHING. Legacy mode, same behaviour
--     as before migration 019 — a school that has not filled in a calendar can
--     still take attendance.
--   * BUT a term that HAS a calendar and simply does not list this date blocks
--     it: the date is an implicit holiday. That asymmetry is the whole guard —
--     it is what stops a class being marked on a weekend nobody enumerated.
--   * Audience: a row for the student's own level beats a row for their half,
--     which beats the school-wide 'all' row. Level code P1–P6 -> 'primary',
--     S1–S4 -> 'secondary', anything else (preschool) -> no half and no code,
--     so it reads only 'all' (KD #76). Only the ten core codes are matched as
--     a code — the CHECK above admits no other.

create or replace function public.attendance_write_blocked(
  p_term_id            uuid,
  p_date               date,
  p_section_student_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with lvl as (
    select case
             when l.code ~ '^P[1-6]$' then 'primary'
             when l.code ~ '^S[1-4]$' then 'secondary'
             -- Youngstarters reads Primary's rows, as levelTypeForAudienceLookup
             -- has since migration 173 — the two used to disagree.
             when l.code = 'YS'         then 'primary'
             else null
           end as audience,
           case
             when l.code ~ '^(P[1-6]|S[1-4])$' then l.code
             else null
           end as code
    from   public.section_students ss
    join   public.sections s on s.id = ss.section_id
    join   public.levels   l on l.id = s.level_id
    where  ss.id = p_section_student_id
  ),
  -- The level's own row wins, then the half's, then the school-wide 'all'
  -- row.
  hit as (
    select sc.day_type, coalesce(sc.hbl_overlay, false) as hbl_overlay
    from   public.school_calendar sc, lvl
    where  sc.term_id = p_term_id
      and  sc.date    = p_date
      and  (sc.audience = 'all'
            or sc.audience = lvl.audience
            or sc.audience = lvl.code)
    order  by case
                when sc.audience = lvl.code     then 0
                when sc.audience = lvl.audience then 1
                else 2
              end
    limit  1
  ),
  term_has_calendar as (
    select exists (
      select 1 from public.school_calendar sc where sc.term_id = p_term_id
    ) as present
  )
  select case
           -- No calendar for the term at all: legacy mode, nothing is blocked.
           when not (select present from term_has_calendar) then false
           -- Term HAS a calendar but this date is not in it: the date is an
           -- implicit holiday and IS blocked. Getting this backwards is how a
           -- class ends up marked absent on a Saturday that nobody listed.
           when not exists (select 1 from hit) then true
           else not (
             select h.day_type in ('school_day', 'hbl')
                 or (h.day_type = 'school_holiday' and h.hbl_overlay)
             from hit h
           )
         end;
$$;

comment on function public.attendance_write_blocked(uuid, date, uuid) is
  'True when a mark may NOT be placed on this date for this student — the '
  'calendar calls the day something other than school_day/hbl for their '
  'level, else their half of the school, else the whole school. A term with '
  'no calendar rows blocks nothing (legacy mode). '
  'SQL mirror of lib/attendance/school-days.ts; change both together.';
