-- 117_relief_as_column.sql
--
-- Replaces the `assignment_reliefs` table (migration 112) with ONE NULLABLE
-- COLUMN on `teacher_assignments`.
--
-- WHY THIS REVERSES 112.
--
-- Cover is a switch, not a lifecycle. A class either has a substitute right now
-- or it does not. 112 built the second thing: a start date, an end date, a
-- reason, notes, who arranged it, who ended it, a partial unique index to keep
-- one cover active at a time, a SECURITY DEFINER helper to test the window, and
-- four migrations of corrections on top (114 taught RLS about it, 115 fixed the
-- window being ignored, 116 repaired the EXECUTE grant 114 revoked — which
-- blanked every cookie-scoped read of teacher_assignments in production).
--
-- All of that machinery existed to serve a requirement nobody asked for: that
-- cover keep its own history. It does not need to. `audit_log` already records
-- who set a cover and when, which is the only history anyone has ever wanted
-- from it. The date window was worse than unnecessary — it was a second source
-- of truth about who may act on a class, and 115 exists because the SQL and the
-- app disagreed about it.
--
-- What the column cannot express, and why that is fine:
--   * scheduled cover ("starts Monday") — arrange it on Monday;
--   * a record of past covers — audit_log has it;
--   * a reason code — audit_log has that too, and nothing read it back.
--
-- What the column expresses BETTER than the table: "a teacher cannot cover
-- their own class" was a route-level check in 112 because it compared two
-- tables. On one row it is a CHECK constraint, so the database enforces it.
--
-- MIGRATING LIVE DATA. Any cover that is running today (started, not yet
-- ended) moves onto the column. Cover that has already ended is dropped — that
-- is the history this change deliberately stops keeping, and it stays readable
-- in audit_log. Where a class somehow has two rows qualifying, the most
-- recently started wins.
--
-- Idempotent — safe to re-run.

-- ── 1. The column ──────────────────────────────────────────────────────────

alter table public.teacher_assignments
  add column if not exists relief_teacher_user_id uuid;

comment on column public.teacher_assignments.relief_teacher_user_id is
  'auth.users(id) of a substitute currently working this class while the regular teacher is away, or null when nobody is covering. Setting it grants the substitute the same access as the teacher; clearing it takes that access away. The regular teacher named in teacher_user_id stays the name of record throughout — on report cards, grading sheets and the masterfile. No declared FK across schemas (same convention as teacher_user_id, migration 003); lib/sis/user-deletion.ts blocks deleting an account still named here.';

-- A teacher cannot cover their own class. Under migration 112 this lived in the
-- route because it compared two tables; on one row the database can hold it.
alter table public.teacher_assignments
  drop constraint if exists teacher_assignments_relief_not_self;
alter table public.teacher_assignments
  add constraint teacher_assignments_relief_not_self
  check (relief_teacher_user_id is null
         or relief_teacher_user_id <> teacher_user_id);

-- "What am I covering?" — hit on every request that resolves a teacher's
-- effective access. Partial: the overwhelming majority of rows are not covered.
create index if not exists teacher_assignments_relief_teacher_idx
  on public.teacher_assignments (relief_teacher_user_id)
  where relief_teacher_user_id is not null;

-- ── 2. Move any cover that is running today ────────────────────────────────

do $$
begin
  if to_regclass('public.assignment_reliefs') is not null then
    update public.teacher_assignments ta
       set relief_teacher_user_id = live.relief_teacher_user_id
      from (
        select distinct on (ar.assignment_id)
               ar.assignment_id,
               ar.relief_teacher_user_id
          from public.assignment_reliefs ar
         where ar.started_on <= (now() at time zone 'Asia/Singapore')::date
           and (ar.ended_on is null
                or ar.ended_on >= (now() at time zone 'Asia/Singapore')::date)
         order by ar.assignment_id, ar.started_on desc, ar.created_at desc
      ) live
     where live.assignment_id = ta.id
       and ta.relief_teacher_user_id is null
       -- Defensive: the table had no constraint against self-cover, and a row
       -- that violates the new CHECK would abort this whole migration.
       and live.relief_teacher_user_id <> ta.teacher_user_id;
  end if;
end $$;

-- ── 3. Teach RLS to read the column, and stop calling the helper ───────────
--
-- All four definitions below previously called
-- `has_active_relief_for_assignment(ta.id)`, a SECURITY DEFINER function that
-- ran a subquery per row. Cover is now a column on the row they already have,
-- so the test is a comparison. That deletes the function, its EXECUTE grant and
-- the entire class of failure migration 116 had to repair.

-- Any assignment in the section — held or covered. Gates students +
-- section_students (the roster).
create or replace function public.is_teacher_for_section(p_section_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teacher_assignments ta
    where ta.section_id = p_section_id
      and (ta.teacher_user_id = auth.uid()
           or ta.relief_teacher_user_id = auth.uid())
  );
$$;

-- Form adviser of the section — held or covered. Gates attendance_records and
-- attendance_daily; taking the register is the substitute's job.
create or replace function public.is_adviser_for_section(p_section_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teacher_assignments ta
    where ta.section_id = p_section_id
      and ta.role = 'form_adviser'
      and (ta.teacher_user_id = auth.uid()
           or ta.relief_teacher_user_id = auth.uid())
  );
$$;

-- The sheet's own subject teacher, or the section's adviser — held or covered.
-- Gates grading_sheets and grade_entries.
create or replace function public.is_teacher_for_sheet(p_sheet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.grading_sheets gs
    join public.teacher_assignments ta
      on ta.section_id = gs.section_id
     and (
       ta.role = 'form_adviser'
       or (ta.role = 'subject_teacher' and ta.subject_id = gs.subject_id)
     )
     and (ta.teacher_user_id = auth.uid()
          or ta.relief_teacher_user_id = auth.uid())
    where gs.id = p_sheet_id
  );
$$;

-- A teacher may read their own assignment rows, and any row they are covering.
-- Without the second arm a substitute cannot see the class they were given, and
-- the effective-assignment loader returns "you are covering nothing" with no
-- error anywhere — the quiet failure migration 115 was written to fix.
drop policy if exists teacher_assignments_scoped_read on public.teacher_assignments;
create policy teacher_assignments_scoped_read
  on public.teacher_assignments for select
  to authenticated
  using (
    public.is_registrar_or_above()
    or teacher_user_id = auth.uid()
    or relief_teacher_user_id = auth.uid()
  );

-- ── 4. Retire the table and its helper ─────────────────────────────────────
--
-- The function first: it reads the table, so dropping the table under it would
-- leave a definition that errors on call. Nothing references it after step 3.

drop function if exists public.has_active_relief_for_assignment(uuid);

drop table if exists public.assignment_reliefs;
