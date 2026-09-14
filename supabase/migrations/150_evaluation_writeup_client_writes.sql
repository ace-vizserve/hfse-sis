-- Migration 150 — let the adviser save a write-up from the browser
--
-- Second of three (attendance was 149, grading is next). Same shape: everything
-- PATCH /api/evaluation/writeups enforced moves into Postgres so the page can
-- call supabase-js directly and stop awaiting a whole-page re-render to report
-- a save.
--
-- WHAT THE ROUTE ENFORCED, AND WHERE IT LIVES NOW:
--
--   1. Role gate (teacher | academic_coordinator | school_admin | superadmin)
--      and, for a teacher, form-adviser of the target section
--                                            -> RLS insert/update policies
--   2. The student must be on THAT section's current roster — the route's own
--      comment explains why this is separate from (1): "the sectionId check
--      above only proves adviser-of-sectionId, not that studentId is on that
--      roster", so without it an adviser of ANY section could forge a write-up
--      for someone else's student
--                                            -> same policy, one clause
--   3. `updated_at` bumped on every write     -> BEFORE trigger
--   4. One audit row per user action, and the ACTION DEPENDS ON THE TRANSITION
--      (submit / resubmit / save)             -> AFTER trigger
--
-- (1) and (2) collapse into a single EXISTS here, which is tighter than the
-- route managed: the policy asks whether this exact (section, student) pair is
-- a live roster row in a section the caller advises. The route asked those two
-- questions separately and could only reject after both round trips.
--
-- DELETE stays denied. Nothing in the app deletes a write-up; clearing one is
-- an update to empty text, which keeps the audit trail intact.

-- ---------------------------------------------------------------------------
-- 1. updated_at
-- ---------------------------------------------------------------------------

create or replace function public.evaluation_writeups_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- ⚠ OLD IS UNASSIGNED ON INSERT. Reading `old.<col>` in an INSERT trigger
  -- raises "record old is not assigned yet", so every reference to the prior
  -- row is resolved here, once, behind a tg_op check.
  v_was_submitted boolean := case when tg_op = 'UPDATE'
                                  then coalesce(old.submitted, false)
                                  else false end;
begin
  new.updated_at := now();

  -- `submitted_at` is DERIVED, and the browser does not get to set it. Stamped
  -- when a write-up is finalised, cleared when it is demoted back to draft —
  -- exactly what the route did. Left alone when `submitted` did not move, so
  -- editing the text of an already-submitted write-up keeps the original
  -- finalisation time rather than sliding it forward on every save.
  if coalesce(new.submitted, false) and not v_was_submitted then
    new.submitted_at := now();
  elsif not coalesce(new.submitted, false) then
    new.submitted_at := null;
  elsif tg_op = 'UPDATE' then
    new.submitted_at := old.submitted_at;
  end if;

  -- Likewise `created_by`: whoever wrote the row first, never re-attributed by
  -- a later editor.
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
  end if;

  return new;
end;
$$;

drop trigger if exists evaluation_writeups_touch_trg on public.evaluation_writeups;
create trigger evaluation_writeups_touch_trg
  before insert or update on public.evaluation_writeups
  for each row execute function public.evaluation_writeups_touch();

-- ---------------------------------------------------------------------------
-- 2. Audit
-- ---------------------------------------------------------------------------
--
-- Mirrors the route's decision exactly:
--
--   submitted true, was NOT submitted before  -> evaluation.writeup.submit
--   submitted true, WAS submitted before      -> evaluation.writeup.resubmit
--   text changed, or a finalised one demoted  -> evaluation.writeup.save
--   nothing of substance changed              -> no row at all
--
-- That last line matters. An adviser opening a write-up and saving it untouched
-- should not leave a trail implying they revised it — the audit log answers
-- "who changed this", and a row that means "nobody changed anything" makes it
-- answer worse. Context keys match lib/audit/humanize.ts's `submitted` /
-- `un_submitted` / `length` reads so these rows render identically to the ones
-- the route wrote.

create or replace function public.evaluation_writeups_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Same OLD-is-unassigned-on-INSERT rule as the BEFORE trigger above.
  v_was_submitted boolean := case when tg_op = 'UPDATE'
                                  then coalesce(old.submitted, false)
                                  else false end;
  v_prior_text    text    := case when tg_op = 'UPDATE'
                                  then coalesce(old.writeup, '')
                                  else null end;
  v_now_submitted boolean := coalesce(new.submitted, false);
  v_text_changed  boolean := tg_op = 'INSERT'
                             or v_prior_text is distinct from coalesce(new.writeup, '');
  v_action        text;
  v_email         text;
begin
  if v_now_submitted and not v_was_submitted then
    v_action := 'evaluation.writeup.submit';
  elsif v_now_submitted and v_was_submitted then
    v_action := 'evaluation.writeup.resubmit';
  elsif v_text_changed or (not v_now_submitted and v_was_submitted) then
    v_action := 'evaluation.writeup.save';
  else
    return null;                                  -- nothing worth recording
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();

  insert into public.audit_log (actor_id, actor_email, actor_role, action, entity_type, entity_id, context)
  values (
    auth.uid(),
    coalesce(v_email, 'system'),
    public.current_user_role(),
    v_action,
    'evaluation_writeup',
    new.id,
    jsonb_build_object(
      'submitted', v_now_submitted,
      'un_submitted', (v_was_submitted and not v_now_submitted),
      -- The humanizer reports a character count. `writeup` holds HTML from the
      -- rich-text editor (KD #205), so this is the stored length, same as the
      -- route passed.
      'length', length(coalesce(new.writeup, ''))
    )
  );
  return null;
end;
$$;

drop trigger if exists evaluation_writeups_audit_trg on public.evaluation_writeups;
create trigger evaluation_writeups_audit_trg
  after insert or update on public.evaluation_writeups
  for each row execute function public.evaluation_writeups_audit();

-- ---------------------------------------------------------------------------
-- 3. Who may write
-- ---------------------------------------------------------------------------
--
-- Replaces the blanket `with check (false)` denials from migration 018.
-- `is_adviser_for_section` carries relief cover (migration 114), so a teacher
-- covering an absent adviser can write — which the route's hand-rolled
-- `teacher_assignments` lookup did not handle.
--
-- Registrar+ keep their edit rights (KD #28 — they can fix typos or fill gaps
-- when the adviser is unavailable), which is why the soft `submitted` marker
-- never locks the row.

drop policy if exists evaluation_writeups_no_insert on public.evaluation_writeups;
drop policy if exists evaluation_writeups_no_update on public.evaluation_writeups;

create policy evaluation_writeups_scoped_insert
  on public.evaluation_writeups for insert
  to authenticated
  with check (
    public.is_registrar_or_above()
    or exists (
      select 1
      from public.section_students ss
      where ss.section_id = evaluation_writeups.section_id
        and ss.student_id = evaluation_writeups.student_id
        and ss.enrollment_status <> 'withdrawn'
        and public.is_adviser_for_section(ss.section_id)
    )
  );

create policy evaluation_writeups_scoped_update
  on public.evaluation_writeups for update
  to authenticated
  using (
    public.is_registrar_or_above()
    or exists (
      select 1
      from public.section_students ss
      where ss.section_id = evaluation_writeups.section_id
        and ss.student_id = evaluation_writeups.student_id
        and ss.enrollment_status <> 'withdrawn'
        and public.is_adviser_for_section(ss.section_id)
    )
  )
  with check (
    public.is_registrar_or_above()
    or exists (
      select 1
      from public.section_students ss
      where ss.section_id = evaluation_writeups.section_id
        and ss.student_id = evaluation_writeups.student_id
        and ss.enrollment_status <> 'withdrawn'
        and public.is_adviser_for_section(ss.section_id)
    )
  );

-- `using` AND `with check` on the update, deliberately: `using` decides which
-- rows you may touch, `with check` what they may become. With only `using`, an
-- adviser could move a write-up to another section by editing `section_id` —
-- the row they started from is theirs, and nothing would examine the row they
-- ended with.
