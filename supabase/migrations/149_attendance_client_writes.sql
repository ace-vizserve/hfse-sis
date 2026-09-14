-- Migration 149 — let the attendance register write from the browser
--
-- WHY. Marking one cell currently costs: PATCH /api/attendance/daily, then an
-- AWAITED `router.refresh()` that re-renders the whole page so the stat cards
-- above the grid catch up. Measured, the refresh is 800ms–3.3s of that; the
-- write itself is a fraction. The grid is already optimistic, so the teacher
-- sees the mark instantly and then waits on a page render they are not looking
-- at — and the grid locks until it lands, one edit at a time.
--
-- Writing directly with supabase-js removes the route, the refresh and the
-- cache invalidation in one go: `insert` → triggers do the rest → the inserted
-- row comes back with everything the client needs.
--
-- WHAT HAD TO MOVE INTO POSTGRES. The route was not just a proxy; it enforced
-- four things. All four are reproduced below, because dropping any of them to
-- go faster would be trading correctness for latency:
--
--   1. WHO may write            -> RLS insert policy (was `requireRole` +
--                                  `assertAdviserForSections`)
--   2. NOT on a closed day      -> `attendance_write_blocked()` + BEFORE trigger
--   3. Rollup stays in step     -> AFTER trigger calling
--                                  `recompute_attendance_rollup`
--   4. Every mark is audited    -> AFTER trigger writing `audit_log`
--
-- ⚠ (3) IS ALSO A BUG FIX. `lib/attendance/mutations.ts` says of the old path:
-- "The two statements are NOT atomic at the JS level... Between them is a
-- millisecond-scale window where a concurrent recompute could see the insert
-- without triggering its own." In a trigger the insert and the recompute are
-- one transaction, so that window closes.
--
-- APPEND-ONLY IS PRESERVED. UPDATE and DELETE stay denied (Hard Rule #6). A
-- correction is still a new row superseding by `recorded_at desc`.

-- ---------------------------------------------------------------------------
-- 1. Is this date closed for this student's half of the school?
-- ---------------------------------------------------------------------------
--
-- Mirrors `lib/attendance/school-days.ts` exactly, including the parts that
-- look like edge cases and are not:
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
--   * Audience: a row for the student's own half beats the school-wide 'all'
--     row. Level code P1–P6 -> 'primary', S1–S4 -> 'secondary', anything else
--     (preschool) -> no half, so it reads only 'all' (KD #76).

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
             else null
           end as audience
    from   public.section_students ss
    join   public.sections s on s.id = ss.section_id
    join   public.levels   l on l.id = s.level_id
    where  ss.id = p_section_student_id
  ),
  -- The audience-specific row wins over the school-wide 'all' row; `false`
  -- sorts first, so the specific one comes out on top.
  hit as (
    select sc.day_type, coalesce(sc.hbl_overlay, false) as hbl_overlay
    from   public.school_calendar sc, lvl
    where  sc.term_id = p_term_id
      and  sc.date    = p_date
      and  (sc.audience = 'all' or sc.audience = lvl.audience)
    order  by (sc.audience = 'all')
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
  'calendar calls the day something other than school_day/hbl for their half '
  'of the school. A term with no calendar rows blocks nothing (legacy mode). '
  'SQL mirror of lib/attendance/school-days.ts; change both together.';

-- ---------------------------------------------------------------------------
-- 2. Enforce it on write
-- ---------------------------------------------------------------------------
--
-- ⚠ TWO DELIBERATE EXCEPTIONS, both carried over from the route:
--
--   * A CLEAR (status is null) is ALWAYS allowed. The gate exists to stop a
--     mark being PUT on a day the school was shut; clearing only takes one
--     away. Refusing it would strand exactly the rows somebody is cleaning up —
--     a mark made while the calendar still said "school day", then the calendar
--     corrected, is otherwise unreachable: blocked from change AND from
--     removal.
--   * 'NC' is allowed for registrar+, the legitimate way to record "no class"
--     on a pre-calendar date or back-fill a closure.

create or replace function public.attendance_daily_guard_closed_day()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- ⚠ NEVER TRUST `recorded_by` FROM A BROWSER. The column is what the audit
  -- trail and the "who marked this" tooltip read, so a client that could set it
  -- freely could attribute its own mark to another teacher. Stamp it from the
  -- session instead. Service-role callers (imports, backfills) have no
  -- `auth.uid()`, so theirs is left exactly as supplied.
  if auth.uid() is not null then
    new.recorded_by := auth.uid();
  end if;

  if new.status is null then
    return new;                                  -- a clear always passes
  end if;
  if new.status = 'NC' and public.is_registrar_or_above() then
    return new;                                  -- registrar recording closure
  end if;
  if public.attendance_write_blocked(new.term_id, new.date, new.section_student_id) then
    raise exception
      'attendance: % is not a teaching day for this class', new.date
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_daily_guard_closed_day_trg on public.attendance_daily;
create trigger attendance_daily_guard_closed_day_trg
  before insert on public.attendance_daily
  for each row execute function public.attendance_daily_guard_closed_day();

-- ---------------------------------------------------------------------------
-- 3. Keep the rollup in step, atomically
-- ---------------------------------------------------------------------------

create or replace function public.attendance_daily_sync_rollup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_attendance_rollup(new.term_id, new.section_student_id);
  return null;
end;
$$;

drop trigger if exists attendance_daily_sync_rollup_trg on public.attendance_daily;
create trigger attendance_daily_sync_rollup_trg
  after insert on public.attendance_daily
  for each row execute function public.attendance_daily_sync_rollup();

-- ---------------------------------------------------------------------------
-- 4. Audit every mark
-- ---------------------------------------------------------------------------
--
-- Same two actions the route wrote, chosen the same way: a mark dated before
-- today is a correction, anything else is an update. Context keys match the
-- first alternative in each `??` chain in lib/audit/humanize.ts, so these rows
-- render identically to the ones the route produced and the two are
-- indistinguishable in the log.
--
-- `prior_status` is the mark this row supersedes, which is what makes a
-- correction readable ("A -> EX") rather than just "EX".

create or replace function public.attendance_daily_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior  text;
  v_email  text;
begin
  select ad.status into v_prior
  from   public.attendance_daily ad
  where  ad.section_student_id = new.section_student_id
    and  ad.date               = new.date
    and  ad.id <> new.id
  order  by ad.recorded_at desc, ad.id
  limit  1;

  select u.email into v_email from auth.users u where u.id = auth.uid();

  insert into public.audit_log (actor_id, actor_email, actor_role, action, entity_type, entity_id, context)
  values (
    auth.uid(),
    coalesce(v_email, 'system'),
    public.current_user_role(),
    case when new.date < (now() at time zone 'Asia/Singapore')::date
         then 'attendance.daily.correct'
         else 'attendance.daily.update' end,
    'attendance_daily',
    null,
    jsonb_build_object(
      'date', new.date,
      'status', new.status,
      'prior_status', v_prior,
      'ex_reason', new.ex_reason
    )
  );
  return null;
end;
$$;

drop trigger if exists attendance_daily_audit_trg on public.attendance_daily;
create trigger attendance_daily_audit_trg
  after insert on public.attendance_daily
  for each row execute function public.attendance_daily_audit();

-- ---------------------------------------------------------------------------
-- 5. Who may write
-- ---------------------------------------------------------------------------
--
-- Replaces `attendance_daily_no_insert` (migration 014, `with check (false)`).
-- The role set matches the route's `requireRole([teacher, academic_coordinator,
-- school_admin, superadmin])` narrowed by `assertAdviserForSections` — which is
-- exactly what `is_adviser_for_section` expresses, relief cover included
-- (migration 114).
--
-- UPDATE and DELETE stay denied. Append-only is not negotiable (Hard Rule #6).

drop policy if exists attendance_daily_no_insert on public.attendance_daily;

create policy attendance_daily_scoped_insert
  on public.attendance_daily for insert
  to authenticated
  with check (
    public.is_registrar_or_above()
    or exists (
      select 1
      from public.section_students ss
      where ss.id = attendance_daily.section_student_id
        and public.is_adviser_for_section(ss.section_id)
    )
  );

-- `recompute_attendance_rollup` is called by the trigger above, which is
-- `security definer` and therefore runs as the owner — so the execute grant
-- revoked in migrations 103/104 stays revoked. The browser never calls it.
