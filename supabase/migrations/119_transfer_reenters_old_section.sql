-- 119_transfer_reenters_old_section.sql
--
-- A student can be moved BACK to a section they have already been in.
--
-- THE BUG THIS FIXES
--
-- 097 ends with an unconditional INSERT into section_students. That is right
-- the first time a student enters a section and wrong every time after, because
-- `section_students` carries a unique (section_id, student_id) and a departed
-- student's row is KEPT — withdrawn, never deleted. So moving a student out of
-- Respect into Patience and then back to Respect raised
--
--   duplicate key value violates unique constraint
--   "section_students_section_id_student_id_key"
--
-- and the whole transfer unwound. Reported by Mr Ace on 2026-08-13 while moving
-- a student back; the same student's earlier move out is what created the row
-- being collided with.
--
-- WHAT IT DOES INSTEAD
--
-- If the student already has a row in the target section, that row is
-- REACTIVATED rather than duplicated. There is no alternative available: the
-- unique constraint means one (section, student) can only ever be one row, so
-- a returning student's spell has to be written onto the row they left behind.
--
-- IT KEEPS THE ORIGINAL index_number. An index number is a permanent
-- per-section ID — teachers call students by it, the roster is never re-sorted,
-- and a withdrawn student's number is greyed rather than handed to somebody
-- else. A student coming back to their old class therefore comes back to their
-- old number, which is also the only reading under which "permanent" is true.
-- The number is theirs; it was never released.
--
-- WHAT IT COSTS, stated rather than discovered later. One row per
-- (section, student) means the schema cannot hold two separate spells in the
-- same section, so the earlier spell's enrolment and withdrawal dates are
-- overwritten by the new one. The move itself is still recorded — `audit_log`
-- carries every transfer, and the Mid-year section moves list is built from it
-- — but the Placements table, which reads these rows directly, will show one
-- Respect spell rather than two. Changing that means a second table, and
-- nobody has asked for one.
--
-- Apply after 118.

create or replace function public.transfer_student_section(
  p_source_enrolment_id uuid,
  p_target_section_id   uuid,
  p_enrolee_number      text,
  p_today               date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src        record;
  v_tgt        record;
  v_next_index integer;
  v_new_id     uuid;
  v_is_late    boolean;
  v_reused     boolean := false;
begin
  -- Lock the source enrolment for the duration of the transaction. A second
  -- concurrent transfer of the same student blocks here rather than racing.
  select id, student_id, section_id, enrollment_status, enrollment_date,
         late_enrollee_term_number
    into v_src
    from section_students
   where id = p_source_enrolment_id
     for update;

  if v_src.id is null then
    raise exception 'Source enrolment % not found', p_source_enrolment_id
      using errcode = 'no_data_found';
  end if;

  -- Once the lock is acquired, re-check the state the caller decided on. The
  -- loser of a race arrives here to find the row already withdrawn and stops,
  -- instead of proceeding on its stale read.
  if v_src.enrollment_status = 'withdrawn' then
    raise exception 'Enrolment % is already withdrawn — transfer already applied',
      p_source_enrolment_id
      using errcode = 'check_violation';
  end if;

  if v_src.section_id = p_target_section_id then
    raise exception 'Student is already in the target section'
      using errcode = 'check_violation';
  end if;

  v_is_late := v_src.enrollment_status = 'late_enrollee';

  -- Has this student been in the target section before? Locked in the same
  -- transaction as the source, so two concurrent transfers cannot both decide
  -- the row is free to reactivate.
  select id, index_number, enrollment_status
    into v_tgt
    from section_students
   where section_id = p_target_section_id
     and student_id = v_src.student_id
     for update;

  -- Defensive: the caller is expected to reject this earlier, but if the
  -- target row is somehow already live we would otherwise silently "transfer"
  -- a student into a section they are active in and withdraw their real row.
  if v_tgt.id is not null and v_tgt.enrollment_status <> 'withdrawn' then
    raise exception 'Student is already enrolled in the target section (enrolment %)',
      v_tgt.id
      using errcode = 'check_violation';
  end if;

  -- A. Withdraw from the source.
  update section_students
     set enrollment_status = 'withdrawn',
         withdrawal_date   = p_today
   where id = v_src.id;

  -- B. Enter the target, PRESERVING the source's enrolment semantics. An
  -- active student transfers as active starting today; a late enrollee stays a
  -- late enrollee with its original joining date + term override, so attendance
  -- proration (KD #113/#130) and the joining-term badge (KD #68/#117) carry
  -- over instead of resetting to today.
  if v_tgt.id is not null then
    -- Returning. Reuse the row they left behind, keeping its index_number.
    -- The withdrawal fields describe the row's CURRENT state, so they are
    -- cleared: leaving last spell's reason on a now-active row would read as
    -- a live withdrawal to anything that checks it.
    update section_students
       set enrollment_status         = case when v_is_late then 'late_enrollee' else 'active' end,
           enrollment_date           = case when v_is_late then v_src.enrollment_date else p_today end,
           late_enrollee_term_number = case when v_is_late then v_src.late_enrollee_term_number else null end,
           enrolee_number            = coalesce(p_enrolee_number, enrolee_number),
           withdrawal_date           = null,
           withdrawal_reason         = null,
           withdrawal_notes          = null
     where id = v_tgt.id;

    v_new_id     := v_tgt.id;
    v_next_index := v_tgt.index_number;
    v_reused     := true;
  else
    -- First time in this section. Next index within the target, computed under
    -- the same transaction rather than in the caller, so two concurrent
    -- transfers can't pick the same one. max() spans withdrawn rows too —
    -- their numbers are not free.
    select coalesce(max(index_number), 0) + 1
      into v_next_index
      from section_students
     where section_id = p_target_section_id;

    insert into section_students (
      section_id, student_id, enrolee_number, index_number,
      enrollment_status, enrollment_date, late_enrollee_term_number
    )
    values (
      p_target_section_id,
      v_src.student_id,
      p_enrolee_number,
      v_next_index,
      case when v_is_late then 'late_enrollee' else 'active' end,
      case when v_is_late then v_src.enrollment_date else p_today end,
      case when v_is_late then v_src.late_enrollee_term_number else null end
    )
    returning id into v_new_id;
  end if;

  return jsonb_build_object(
    'new_enrolment_id',  v_new_id,
    'index_number',      v_next_index,
    'source_status',     v_src.enrollment_status,
    'preserved_late',    v_is_late,
    'reused_enrolment',  v_reused
  );
end;
$$;

comment on function public.transfer_student_section(uuid, uuid, text, date) is
  'Atomically move a student between sections: withdraw the source row and enter the target in one transaction. Entering REUSES the student''s existing withdrawn row in that section when there is one — the unique (section_id, student_id) means a return can only be written onto the row they left — keeping its original index_number, which is a permanent per-section ID. Replaces a two-statement sequence whose best-effort rollback could restore a source row after a concurrent transfer had already committed.';

-- Server-side only. Unchanged from 097, restated because create or replace
-- does not reset privileges but a future reader should see them here.
revoke all on function public.transfer_student_section(uuid, uuid, text, date) from public;
grant execute on function public.transfer_student_section(uuid, uuid, text, date) to service_role;
