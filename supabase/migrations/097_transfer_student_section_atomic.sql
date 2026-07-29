-- 097_transfer_student_section_atomic.sql
--
-- Makes a mid-year section transfer atomic, so a concurrent double-submit
-- cannot leave a student active in two sections at once.
--
-- THE BUG THIS FIXES
--
-- lib/sis/section-transfer.ts did the move as two independent statements:
--   A. withdraw the source section_students row
--   B. insert the destination row
-- with a "best-effort rollback" of A if B failed.
--
-- Under a genuine double-submit both requests read the same active source row
-- before either wrote. The winner completed A and B. The loser's B then
-- collided with the `section_students (section_id, student_id)` unique
-- constraint, so its rollback fired — and that rollback restored the SOURCE row
-- to active, after the winner had already committed both halves. Net result:
-- the student is active in the old section AND the new one.
--
-- That is precisely the dual-section bug this module's own header says it was
-- created to prevent (KD #67 — it replaced the class-stage PATCH path for
-- exactly this reason).
--
-- Inside one transaction the failure mode disappears without any rollback code:
-- the loser's insert raises, Postgres unwinds its own withdraw with it, and the
-- winner's committed state is untouched.
--
-- ALSO FIXED HERE: index_number assignment. The old code read `max(index_number)
-- + 1` in JS before the mutation, so two transfers into the same target section
-- could compute the same next index. The RPC reads it inside the transaction,
-- with the source row already locked.
--
-- Pre-flight against production: zero students are currently active in more than
-- one section, so this is latent — no repair needed alongside it.
--
-- Apply after 096.

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
  v_next_index integer;
  v_new_id     uuid;
  v_is_late    boolean;
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

  -- Next index within the target, computed under the same transaction rather
  -- than in the caller, so two concurrent transfers can't pick the same one.
  select coalesce(max(index_number), 0) + 1
    into v_next_index
    from section_students
   where section_id = p_target_section_id;

  -- A. Withdraw from the source.
  update section_students
     set enrollment_status = 'withdrawn',
         withdrawal_date   = p_today
   where id = v_src.id;

  -- B. Insert into the target, PRESERVING the source's enrolment semantics.
  -- An active student transfers as active starting today; a late enrollee stays
  -- a late enrollee with its original joining date + term override, so
  -- attendance proration (KD #113/#130) and the joining-term badge (KD #68/#117)
  -- carry over instead of resetting to today.
  v_is_late := v_src.enrollment_status = 'late_enrollee';

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

  return jsonb_build_object(
    'new_enrolment_id',  v_new_id,
    'index_number',      v_next_index,
    'source_status',     v_src.enrollment_status,
    'preserved_late',    v_is_late
  );
end;
$$;

comment on function public.transfer_student_section(uuid, uuid, text, date) is
  'Atomically move a student between sections: withdraw the source row and insert the target row in one transaction. Replaces a two-statement sequence whose best-effort rollback could restore a source row after a concurrent transfer had already committed, leaving the student active in two sections.';

-- Server-side only. Revoke + explicit service_role grant, matching
-- create_academic_year (090) and claim_pfile_reminder (096).
revoke all on function public.transfer_student_section(uuid, uuid, text, date) from public;
grant execute on function public.transfer_student_section(uuid, uuid, text, date) to service_role;
