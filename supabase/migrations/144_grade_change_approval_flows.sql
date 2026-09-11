-- 144_grade_change_approval_flows.sql
--
-- Grade change requests move onto the ordered approval engine (126/127).
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHAT CHANGES
--
-- A teacher no longer picks two approvers. When a change is filed, the system
-- picks one of two flows, and the school configures who sits on each:
--
--   markbook.grade_change       the report card has not reached parents yet
--   markbook.grade_change_aeb   parents have been able to see it, so the
--                               Academic and Examination Board decides
--
-- `grade_change_requests` stays the subject (subject_type
-- 'grade_change_request') and its `status` becomes a projection, exactly as
-- `student_declarations.status` is (125). The engine holds no key back.
--
-- ⚠ `approval_flow` IS NULL ON EVERY EXISTING ROW, AND THAT IS THE SWITCH.
-- A null row keeps the legacy two-approver path end to end; nothing already
-- in flight is re-routed onto a ladder it was never filed against.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY A CANCEL RPC
--
-- A teacher can withdraw a grade change before anyone decides it. Declarations
-- never needed that, so the engine had no way to close a request except by a
-- decision. Cancelling is a write that must serialise with `approval_advance`
-- — otherwise an approver's click and a teacher's withdrawal can both land,
-- and a change gets applied that its author had already taken back.
--
-- ⚠ A CANCELLED STAGE HAS NO DECIDER. Nobody on the ladder decided it; the
-- request was closed around them. So `decision_shape_chk` treats 'cancelled'
-- like 'waiting' and 'pending': no person, no time. The request row carries
-- `decided_at`, which is when it closed.
--
-- WHO may cancel is the calling route's rule, not this function's — the RPC
-- has no idea what a grade change is, by design.
--
-- Idempotent — safe to re-run. Not applied with 143; the two are independent.

-- ── 1. Which flow a grade change was filed against ─────────────────────────

alter table public.grade_change_requests
  add column if not exists approval_flow text null;

alter table public.grade_change_requests
  drop constraint if exists grade_change_requests_approval_flow_chk;

alter table public.grade_change_requests
  add constraint grade_change_requests_approval_flow_chk
  check (
    approval_flow is null
    or approval_flow in ('markbook.grade_change', 'markbook.grade_change_aeb')
  );

comment on column public.grade_change_requests.approval_flow is
  'The ordered approval flow this request was filed against, picked by the system at filing: markbook.grade_change before the report card reached parents, markbook.grade_change_aeb once it had. NULL = filed before migration 144, and keeps the legacy two-approver path (primary_approver_id / secondary_approver_id).';

-- ── 2. A stage can be cancelled ────────────────────────────────────────────

-- ⚠ THE STATUS CHECK WAS DECLARED INLINE IN 126, SO POSTGRES NAMED IT.
-- Found by what it checks, as 140 did, because a guessed name that misses
-- drops nothing and leaves 'cancelled' refused while this reports success.
-- `decided_by` is excluded so the decision-shape check is never caught here.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.approval_request_stages'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
      and pg_get_constraintdef(oid) ilike '%waiting%'
      and pg_get_constraintdef(oid) not ilike '%decided_by%'
  loop
    execute format(
      'alter table public.approval_request_stages drop constraint %I',
      c.conname
    );
  end loop;
end $$;

alter table public.approval_request_stages
  add constraint approval_request_stages_status_check
  check (status in ('waiting', 'pending', 'approved', 'rejected', 'cancelled'));

alter table public.approval_request_stages
  drop constraint if exists approval_request_stages_decision_shape_chk;

alter table public.approval_request_stages
  add constraint approval_request_stages_decision_shape_chk
  check (
    (status in ('waiting', 'pending', 'cancelled')
      and decided_by is null and decided_at is null)
    or
    (status in ('approved', 'rejected')
      and decided_by is not null and decided_at is not null)
  );

comment on column public.approval_request_stages.status is
  'waiting → pending → approved | rejected, or cancelled when the request is withdrawn while this stage is live. ⚠ Exactly one stage per open request is ''pending''; the ones after it are ''waiting''. A cancelled stage carries no decider — nobody on the ladder decided it.';

-- ── 3. approval_cancel ─────────────────────────────────────────────────────

create or replace function public.approval_cancel(p_request_id uuid)
returns table (outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.approval_requests%rowtype;
begin
  -- ⚠ The same lock approval_advance takes, and NO `skip locked`: a cancel and
  -- a decision on one request must run one after the other, never both.
  select * into v_req
  from public.approval_requests
  where id = p_request_id
  for update;

  if not found then
    return query select 'request_not_found'::text;
    return;
  end if;

  if v_req.status <> 'pending' then
    -- Somebody decided it first. The caller says so in plain words.
    return query select 'request_closed'::text;
    return;
  end if;

  update public.approval_requests
  set status     = 'cancelled',
      decided_at = now(),
      updated_at = now()
  where id = v_req.id;

  -- Only the live stage closes. Later stages stay 'waiting' — the ladder reads
  -- as "it never got there", the same as after a rejection.
  update public.approval_request_stages
  set status = 'cancelled'
  where request_id  = v_req.id
    and stage_order = v_req.current_stage_order
    and status      = 'pending';

  return query select 'cancelled'::text;
end;
$$;

comment on function public.approval_cancel(uuid) is
  'Withdraws one open ordered approval. Locks the request row exactly as approval_advance does (no skip locked), so a withdrawal and a decision serialise. Closes the request as cancelled and the live stage with it; later stages stay waiting. Checks nothing about WHO is cancelling — that is the calling route''s rule. Touches no consumer table and writes no audit row.';

-- ── Lock-down ──────────────────────────────────────────────────────────────
--
-- 127's block, same shape. Revoking from PUBLIC alone does not work here —
-- Supabase grants `anon` directly (103 → 104).

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.approval_cancel(uuid)'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', fn);
      execute format('grant execute on function %s to service_role', fn);
    else
      raise notice 'skipping %, no such function', fn;
    end if;
  end loop;
end $$;

-- Verify after applying by calling it with the ANON key: expect `42501
-- permission denied`. scripts/verify-approval-migrations.ts does this.
