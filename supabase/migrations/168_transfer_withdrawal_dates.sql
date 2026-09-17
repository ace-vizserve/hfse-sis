-- 168_transfer_withdrawal_dates.sql
--
-- A section transfer stops leaving withdrawal dates behind that nobody can
-- see, and tells its caller what it cleared.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- Migration 163 made `section_students.withdrawal_date` mean LAST DAY OF
-- ATTENDANCE and added `withdrawal_approved_date`. `transfer_student_section`
-- (097, rewritten by 119) predates both and had two gaps:
--
--   1. RETURNING TO AN OLD SECTION cleared `withdrawal_date`,
--      `withdrawal_reason` and `withdrawal_notes` on the reused row but NOT
--      `withdrawal_approved_date` — so a student back in their old class
--      carried an approval date from a withdrawal that no longer applies, on a
--      row that now says active. The next withdrawal would read it as its own.
--
--   2. WHAT IT CLEARED WAS UNRECORDED. The reused row's previous last day,
--      approval date, reason and notes were overwritten inside the function
--      and never returned, so the transfer's audit row could not name them.
--      119's header already accepts that one row cannot hold two spells; the
--      audit log is the place the earlier spell survives, and it was not
--      being given the values.
--
-- ── THE SOURCE ROW'S DATE: KEPT AS THE TRANSFER DATE, DELIBERATELY ─────────
--
-- The brief for this change was "stop inventing the date — pick null unless the
-- RPC receives a real date". It does receive one: `p_today` is the date the
-- move takes effect, and it is ALSO what the target row's `enrollment_date`
-- is set to. The source spell ends the day the target spell starts. That is a
-- fact about the placement, not a guess about when a child left school.
--
-- Null would be actively wrong, not merely vague. The report card and publish
-- readiness build each student's enrolment coverage from the union of their
-- [enrollment_date, withdrawal_date] intervals (lib/report-card/
-- enrolment-coverage.ts: "a transfer = two abutting rows → continuous"), and a
-- null end means OPEN-ENDED. The source class would then claim the child for
-- the rest of the year, and the attendance summary for that class would keep
-- counting school days against a student who is no longer in it.
--
-- `withdrawal_approved_date` on the source row is set to null: a move between
-- classes is not a withdrawal from school and nobody approved one.
--
-- ⚠ Readers that count withdrawals already exclude transfers (the Records
-- Withdrawals KPI dedupes genuine leavers — KD #82/#124), so keeping the date
-- does not inflate that number.
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────
--
--   * Source row: `withdrawal_approved_date = null` alongside the existing
--     status + transfer date.
--   * Reused target row: `withdrawal_approved_date = null` too.
--   * The returned jsonb gains:
--       source_index_number
--       source_withdrawal_date         (the transfer date written)
--       target_prior_status            (null when the section is new to them)
--       target_prior_enrollment_date
--       target_prior_withdrawal_date
--       target_prior_withdrawal_approved_date
--       target_prior_withdrawal_reason
--       target_prior_withdrawal_notes
--     Existing keys are unchanged, so an older caller keeps working.
--
-- Signature unchanged, so `create or replace` keeps the grants.
--
-- ── DEPLOY ORDERING ──────────────────────────────────────────────────────
--
-- Apply 168 BEFORE deploying the matching code (lib/sis/section-transfer.ts,
-- app/api/sis/students/[enroleeNumber]/transfer-section/route.ts). The code
-- reads the new keys and falls back to null when they are absent, so the old
-- function with the new code only loses audit detail — but the approval-date
-- fix lives here alone. Requires 163 (the column).
--
-- ── ACCEPTANCE ───────────────────────────────────────────────────────────
--
--   select pg_get_functiondef('public.transfer_student_section(uuid, uuid, text, date)'::regprocedure)
--     ilike '%target_prior_withdrawal_approved_date%';
--   -- Expect true.
--
--   select count(*) from public.section_students
--    where enrollment_status <> 'withdrawn'
--      and withdrawal_approved_date is not null;
--   -- Expect 0 (no active row carries an approval date).

begin;

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
  select id, student_id, section_id, index_number, enrollment_status,
         enrollment_date, late_enrollee_term_number
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
  -- the row is free to reactivate. The withdrawal columns are read so the
  -- values this function is about to clear can be returned to the caller.
  select id, index_number, enrollment_status, enrollment_date,
         withdrawal_date, withdrawal_approved_date,
         withdrawal_reason, withdrawal_notes
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

  -- A. Leave the source. The date is the transfer's effective date — the same
  -- day the target spell starts — see this migration's header for why it is
  -- not null. Nobody approved a withdrawal from school, so no approval date.
  update section_students
     set enrollment_status        = 'withdrawn',
         withdrawal_date          = p_today,
         withdrawal_approved_date = null
   where id = v_src.id;

  -- B. Enter the target, PRESERVING the source's enrolment semantics. An
  -- active student transfers as active starting today; a late enrollee stays a
  -- late enrollee with its original joining date + term override, so attendance
  -- proration (KD #113/#130) and the joining-term badge (KD #68/#117) carry
  -- over instead of resetting to today.
  if v_tgt.id is not null then
    -- Returning. Reuse the row they left behind, keeping its index_number.
    -- The withdrawal fields describe the row's CURRENT state, so all four are
    -- cleared (the approval date was missed before 168). Their prior values
    -- go back to the caller for the audit row.
    update section_students
       set enrollment_status         = case when v_is_late then 'late_enrollee' else 'active' end,
           enrollment_date           = case when v_is_late then v_src.enrollment_date else p_today end,
           late_enrollee_term_number = case when v_is_late then v_src.late_enrollee_term_number else null end,
           enrolee_number            = coalesce(p_enrolee_number, enrolee_number),
           withdrawal_date           = null,
           withdrawal_approved_date  = null,
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
    'reused_enrolment',  v_reused,
    -- 168: what the caller needs to write a complete audit row.
    'source_index_number',                   v_src.index_number,
    'source_withdrawal_date',                p_today,
    'target_prior_status',                   v_tgt.enrollment_status,
    'target_prior_enrollment_date',          v_tgt.enrollment_date,
    'target_prior_withdrawal_date',          v_tgt.withdrawal_date,
    'target_prior_withdrawal_approved_date', v_tgt.withdrawal_approved_date,
    'target_prior_withdrawal_reason',        v_tgt.withdrawal_reason,
    'target_prior_withdrawal_notes',         v_tgt.withdrawal_notes
  );
end;
$$;

comment on function public.transfer_student_section(uuid, uuid, text, date) is
  'Atomically move a student between sections: withdraw the source row (withdrawal_date = the transfer date, which is also the target row''s enrollment_date, so the two spells abut; no approval date) and enter the target in one transaction. Entering REUSES the student''s existing withdrawn row in that section when there is one, keeping its index_number and clearing all four withdrawal columns. Returns the cleared values (target_prior_*) so the caller can audit them (migration 168).';

-- Server-side only. Unchanged from 097/119, restated because create or replace
-- does not reset privileges but a future reader should see them here.
revoke all on function public.transfer_student_section(uuid, uuid, text, date) from public;
grant execute on function public.transfer_student_section(uuid, uuid, text, date) to service_role;

commit;
