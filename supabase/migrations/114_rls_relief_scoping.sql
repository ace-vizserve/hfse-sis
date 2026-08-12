-- 114_rls_relief_scoping.sql
--
-- Teaches the row-level security helpers about relief teachers (migration 112).
-- Until this runs, a substitute can be granted cover in the app and still read
-- nothing: every scoped-read policy resolves "is this your class?" from
-- `teacher_assignments` alone.
--
-- WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT
--
--   is_teacher_for_section  WIDENED — the roster. A substitute must see who is
--                           in the class they are taking.
--   is_teacher_for_sheet    WIDENED — grading sheets and grade entries. Entering
--                           marks is the substitute's job.
--   is_adviser_for_section  WIDENED — attendance_records and attendance_daily.
--                           Taking the register is the substitute's job too.
--
-- `is_adviser_for_section` was the one that looked awkward, because it used to
-- gate `report_card_comments` as well — and the report card comment stays with
-- the regular adviser during cover (Mr Ace, 2026-08-11), so widening it would
-- have handed a substitute the adviser's own writing. It turns out not to be a
-- problem: migration 024 DROPPED report_card_comments, and its policy went with
-- the table. The only two policies left behind this helper are
-- attendance_records (005:167-178) and attendance_daily (014:84-95), and the
-- substitute needs both. No split required.
--
-- THE GAP THIS DOES NOT CLOSE. Write-ups moved to `evaluation_writeups`
-- (KD #49), whose policy is `current_user_role() is not null` — every
-- authenticated staff role can already read every write-up, with no adviser
-- predicate at all. So RLS is not what keeps a substitute out of the adviser's
-- write-ups; the application does, in five places listed in
-- __tests__/auth/assignment-read-classification.test.ts. That is worth knowing
-- rather than assuming a database backstop exists here. Closing it properly is
-- a separate change to migration 018's policy, not something to bolt on here.
--
-- Every helper stays `security definer` + `set search_path = public` and keeps
-- its signature, so the policies referencing them need no edits — this file
-- replaces three function bodies and nothing else.
--
-- Idempotent — safe to re-run.

-- Does this user have an ACTIVE cover on the given assignment? Active means
-- `ended_on is null`; ending a cover is what removes the access.
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
      and ar.ended_on is null
  );
$$;

comment on function public.has_active_relief_for_assignment(uuid) is
  'True when the calling user is currently covering the given teacher_assignments row. Used by the three scoped-read helpers so a substitute reads the class they are covering.';

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
      and (
        ta.teacher_user_id = auth.uid()
        or public.has_active_relief_for_assignment(ta.id)
      )
  );
$$;

-- Form adviser of the section — held or covered. Gates attendance_records and
-- attendance_daily. See the header for why widening this is safe now.
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
      and (
        ta.teacher_user_id = auth.uid()
        or public.has_active_relief_for_assignment(ta.id)
      )
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
     and (
       ta.teacher_user_id = auth.uid()
       or public.has_active_relief_for_assignment(ta.id)
     )
    where gs.id = p_sheet_id
  );
$$;

-- The new helper is called from inside security-definer functions that already
-- run as the definer, but revoke direct execution anyway: nothing outside these
-- three helpers has a reason to call it, and migrations 103/104 established
-- that pattern for every definer function in this schema.
revoke all on function public.has_active_relief_for_assignment(uuid) from public;
revoke all on function public.has_active_relief_for_assignment(uuid) from anon;
revoke all on function public.has_active_relief_for_assignment(uuid) from authenticated;
grant execute on function public.has_active_relief_for_assignment(uuid) to service_role;
