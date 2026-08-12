-- 115_relief_visibility_and_window.sql
--
-- Two corrections to the relief-teacher work in 112/114, both found in review
-- before any cover existed in production.
--
-- ── 1. A SUBSTITUTE COULD NOT SEE THE ASSIGNMENT THEY WERE COVERING ─────────
--
-- `teacher_assignments_scoped_read` (005:184-190) exposes a teacher only their
-- OWN rows. Migration 114 taught the scoped-read HELPERS about cover but left
-- that policy alone, so on any cookie-scoped client the covered assignment row
-- was invisible to the substitute.
--
-- That broke the feature quietly rather than loudly. The effective-assignment
-- loader resolves cover with an inner join from `assignment_reliefs` to
-- `teacher_assignments`; with the parent row filtered out by RLS the join
-- dropped the relief entirely, and the loader returned "you are covering
-- nothing" with no error. A substitute would have been refused on entering a
-- mark, renaming an activity and filing a change request, and seen an empty
-- sheet list — every one of them a 403 or a blank, none of them explicable.
-- Service-client call paths worked, so the feature half-functioned, which is
-- worse than not functioning at all.
--
-- Widening is also correct on its own terms: someone standing in for a
-- colleague should be able to see the assignment they are standing in for.
--
-- ── 2. COVER IGNORED ITS OWN DATES ─────────────────────────────────────────
--
-- `has_active_relief_for_assignment` (114) tested `ended_on is null` alone. So
-- cover arranged today to start next Monday granted access immediately, and
-- cover ended with a date a week out revoked access the moment it was recorded
-- rather than when it runs out. Both wrong in the same direction: the dates on
-- the row meant nothing.
--
-- Active is now: started on or before today, and not yet ended — where
-- `ended_on` is the LAST day of cover, so a substitute keeps access through the
-- day it ends rather than losing it that morning mid-register.
--
-- Dates are compared in Singapore time. `current_date` on a UTC server rolls
-- over at 08:00 SGT, which would have started and ended cover eight hours late
-- for a school that opens at 08:15.
--
-- Idempotent — safe to re-run.

create or replace function public.has_active_relief_for_assignment(
  p_assignment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.assignment_reliefs ar
    where ar.assignment_id = p_assignment_id
      and ar.relief_teacher_user_id = auth.uid()
      and ar.started_on <= (now() at time zone 'Asia/Singapore')::date
      and (
        ar.ended_on is null
        or ar.ended_on >= (now() at time zone 'Asia/Singapore')::date
      )
  );
$$;

comment on function public.has_active_relief_for_assignment(uuid) is
  'True when the calling user is covering the given teacher_assignments row TODAY (Singapore time): started on or before today, and either open-ended or ending today or later. Used by the three scoped-read helpers so a substitute reads the class they are covering.';

-- A teacher may read their own assignment rows, and any row they are actively
-- covering. Without the second arm the loader''s join to this table returns
-- nothing for a substitute and cover silently confers no access at all.
drop policy if exists teacher_assignments_scoped_read on public.teacher_assignments;
create policy teacher_assignments_scoped_read
  on public.teacher_assignments for select
  to authenticated
  using (
    public.is_registrar_or_above()
    or teacher_user_id = auth.uid()
    or public.has_active_relief_for_assignment(id)
  );
