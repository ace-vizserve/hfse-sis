-- 145_approval_step_rules.sql
--
-- A step can need EVERYONE on it to approve, not just the first to act.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHAT CHANGES
--
-- Every step so far has been "the first to act carries it" (126). A step now
-- carries a rule:
--
--   any  one person on the step approves and it moves on. 126's rule, and the
--        default, so no step behaves differently until somebody flips it.
--   all  everyone on the step must approve before it moves on.
--
-- A rejection by anyone still ends the request, on either rule.
--
-- ⚠ 'all' IS ONLY FOR A NAMED STEP. Who counts as a form class adviser changes
-- with relief cover (117/123), so "everyone" on a form_adviser step is a set
-- that moves while the step waits. A CHECK refuses it on both tables.
--
-- ⚠ AN EMPTY POOL IS NEVER "EVERYONE APPROVED". "Every member of nothing" is
-- true, and a step with nobody on it must stall visibly (126), not slide
-- through. `approval_step_everyone_approved` asks `cardinality > 0` first.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY A DECISIONS TABLE
--
-- An 'all' step collects several approvals before it closes, and the step row
-- holds one decider. `approval_request_stage_decisions` holds one row per
-- person per step, on either rule. The step row's decided_by / decided_at /
-- decision_note are still written — only when the step CLOSES, by the last
-- approver or by whoever turned it down — so every existing reader of the step
-- row reads exactly what it read before.
--
-- ⚠ THE RULE IS COPIED ONTO THE LADDER AT FILING, like the pool, and frozen
-- once the step is live. Flipping a step's rule later reaches only steps still
-- 'waiting' (lib/approvals/materialise.ts::repointWaitingStages): changing the
-- terms of a step people are part-way through approving would rewrite what the
-- ones who already said yes agreed to.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY A REEVALUATE RPC
--
-- An 'all' step can be waiting on exactly one person when the school takes that
-- person off the step. The pool is rebuilt (repointWaitingStages) and now
-- everyone left on it has approved — but nobody is left to click, so without a
-- second look the request waits forever. `approval_reevaluate_stage` is that
-- look, under the same row lock `approval_advance` takes.
--
-- Idempotent — safe to re-run.

-- ── 1. The rule, on the configuration and on the ladder ────────────────────

alter table public.approval_stages
  add column if not exists approval_rule text not null default 'any';

alter table public.approval_stages
  drop constraint if exists approval_stages_approval_rule_chk;
alter table public.approval_stages
  add constraint approval_stages_approval_rule_chk
  check (approval_rule in ('any', 'all'));

alter table public.approval_stages
  drop constraint if exists approval_stages_all_needs_named_chk;
alter table public.approval_stages
  add constraint approval_stages_all_needs_named_chk
  check (approval_rule = 'any' or resolver = 'named');

comment on column public.approval_stages.approval_rule is
  'How many of the step''s people must approve. ''any'' = the first to act carries it (the rule since 126). ''all'' = everyone on the step must approve before it moves on; named steps only, because who advises a class changes with relief cover. A rejection by anyone ends the request on either rule.';

alter table public.approval_request_stages
  add column if not exists approval_rule text not null default 'any';

alter table public.approval_request_stages
  drop constraint if exists approval_request_stages_approval_rule_chk;
alter table public.approval_request_stages
  add constraint approval_request_stages_approval_rule_chk
  check (approval_rule in ('any', 'all'));

alter table public.approval_request_stages
  drop constraint if exists approval_request_stages_all_needs_named_chk;
alter table public.approval_request_stages
  add constraint approval_request_stages_all_needs_named_chk
  check (approval_rule = 'any' or resolver = 'named');

comment on column public.approval_request_stages.approval_rule is
  'The step''s rule as filed, copied from approval_stages like the pool. Reaches a step still ''waiting'' when the configuration changes; frozen once the step is ''pending''.';

-- ── 2. One row per person per step ─────────────────────────────────────────

create table if not exists public.approval_request_stage_decisions (
  id               uuid primary key default gen_random_uuid(),
  request_stage_id uuid not null references public.approval_request_stages(id) on delete cascade,
  -- ⚠ NO foreign key to auth.users, matching `decided_by` in 126. A decision
  -- is history: deleting a staff account must neither fail on it nor erase it,
  -- and `user_email` keeps the name readable afterwards.
  user_id          uuid not null,
  user_email       text,
  decision         text not null check (decision in ('approve', 'reject')),

  -- ⚠ The approver's own words, and OUT of audit_log for the reason 126 gives
  -- for decision_note. HTML from a formatting editor: the person is held to
  -- 300 characters of prose in lib/schemas/; 4000 is 140's runaway backstop.
  note             text check (note is null or char_length(note) <= 4000),

  decided_at       timestamptz not null default now(),

  -- Once per person per step. `approval_advance` refuses a second yes with
  -- 'already_approved' BEFORE it inserts, so a violation here is a bug, not a
  -- double-click — and it raises rather than being swallowed.
  constraint approval_request_stage_decisions_once unique (request_stage_id, user_id)
);

comment on table public.approval_request_stage_decisions is
  'Every decision on every approval step, one row per person per step (migration 145). An ''all'' step collects several approvals here before it closes; the step row''s decided_by names only whoever closed it. Written only by approval_advance.';

create index if not exists approval_request_stage_decisions_user_idx
  on public.approval_request_stage_decisions (user_id);

-- ── 3. History has one shape ───────────────────────────────────────────────
--
-- Every step decided before this migration gets its decision row, so a reader
-- never has to ask whether a step predates the table. ⚠ Only for a decider who
-- still has an account: the FK would refuse the rest and fail the migration,
-- and the step row keeps their name and email either way.

insert into public.approval_request_stage_decisions
  (request_stage_id, user_id, user_email, decision, note, decided_at)
select
  s.id,
  s.decided_by,
  s.decided_by_email,
  case s.status when 'approved' then 'approve' else 'reject' end,
  s.decision_note,
  s.decided_at
from public.approval_request_stages s
where s.status in ('approved', 'rejected')
  and s.decided_by is not null
  and s.decided_at is not null
  and exists (select 1 from auth.users u where u.id = s.decided_by)
on conflict (request_stage_id, user_id) do nothing;

-- ── 4. RLS — your own decisions, and nothing else ──────────────────────────
--
-- The browser badge subtracts the steps its reader has already decided
-- (lib/sidebar/use-staged-approval-count.ts), so it must be able to read its
-- own rows. Nobody else's: who approved what is 129's "no enumeration" line.
-- Writes are denied; deciding goes through approval_advance.

alter table public.approval_request_stage_decisions enable row level security;

drop policy if exists approval_request_stage_decisions_own_select
  on public.approval_request_stage_decisions;
create policy approval_request_stage_decisions_own_select
  on public.approval_request_stage_decisions
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists approval_request_stage_decisions_no_insert
  on public.approval_request_stage_decisions;
create policy approval_request_stage_decisions_no_insert
  on public.approval_request_stage_decisions
  for insert to authenticated with check (false);

drop policy if exists approval_request_stage_decisions_no_update
  on public.approval_request_stage_decisions;
create policy approval_request_stage_decisions_no_update
  on public.approval_request_stage_decisions
  for update to authenticated using (false) with check (false);

drop policy if exists approval_request_stage_decisions_no_delete
  on public.approval_request_stage_decisions;
create policy approval_request_stage_decisions_no_delete
  on public.approval_request_stage_decisions
  for delete to authenticated using (false);

-- ── 5. Realtime ────────────────────────────────────────────────────────────
--
-- A yes on an 'all' step that does not close it changes NO step row, so the
-- badge's subscription to approval_request_stages hears nothing. It listens
-- here instead. Replica identity full for 129's reason: Realtime evaluates RLS
-- against the row in the WAL record.

alter table public.approval_request_stage_decisions replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'approval_request_stage_decisions'
  ) then
    alter publication supabase_realtime add table public.approval_request_stage_decisions;
  end if;
end $$;

-- ── 6. Private helpers ─────────────────────────────────────────────────────
--
-- ⚠ NEITHER TAKES A LOCK. Both are called only from approval_advance and
-- approval_reevaluate_stage, AFTER those have locked the request row, and they
-- are granted to nobody (section 9) so nothing else can call them.

create or replace function public.approval_step_everyone_approved(
  p_request_stage_id uuid,
  p_pool             uuid[]
)
returns boolean
language sql
-- ⚠ VOLATILE (the default), not STABLE. approval_advance asks this right
-- after inserting the actor's own decision; a fresh snapshot per query is what
-- guarantees that row is counted.
set search_path = public
as $$
  select cardinality(coalesce(p_pool, '{}')) > 0
     and not exists (
       select 1
       from unnest(p_pool) as pool(member_id)
       where not exists (
         select 1
         from public.approval_request_stage_decisions d
         where d.request_stage_id = p_request_stage_id
           and d.user_id = pool.member_id
           and d.decision = 'approve'
       )
     );
$$;

comment on function public.approval_step_everyone_approved(uuid, uuid[]) is
  'True when every person in the pool has an approve decision on the step. False for an empty pool — a step with nobody on it stalls, it never counts as everyone having approved.';

create or replace function public.approval_close_step_and_advance(
  p_request_id  uuid,
  p_stage_id    uuid,
  p_closer      uuid,
  p_closer_email text,
  p_decided_at  timestamptz,
  p_note        text
)
returns table (
  outcome             text,
  request_status      text,
  decided_stage_order smallint,
  next_stage_order    smallint
)
language plpgsql
set search_path = public
as $$
declare
  v_order smallint;
  v_next  smallint;
begin
  update public.approval_request_stages
  set status           = 'approved',
      decided_by       = p_closer,
      decided_by_email = p_closer_email,
      decided_at       = p_decided_at,
      decision_note    = p_note
  where id = p_stage_id
  returning stage_order into v_order;

  select min(s.stage_order) into v_next
  from public.approval_request_stages s
  where s.request_id  = p_request_id
    and s.status      = 'waiting'
    and s.stage_order > v_order;

  if v_next is null then
    update public.approval_requests
    set status     = 'approved',
        decided_at = now(),
        updated_at = now()
    where id = p_request_id;

    return query select 'completed'::text, 'approved'::text, v_order, null::smallint;
    return;
  end if;

  update public.approval_request_stages
  set status = 'pending'
  where request_id  = p_request_id
    and stage_order = v_next;

  update public.approval_requests
  set current_stage_order = v_next,
      updated_at          = now()
  where id = p_request_id;

  return query select 'advanced'::text, 'pending'::text, v_order, v_next;
end;
$$;

comment on function public.approval_close_step_and_advance(uuid, uuid, uuid, text, timestamptz, text) is
  'Closes one approved step and moves its request on — to the next waiting step, or to approved. Takes no lock: call it only with the request row already locked. Shared by approval_advance and approval_reevaluate_stage so the two cannot advance differently.';

-- ── 7. approval_advance, with the rule ─────────────────────────────────────
--
-- Same signature, same return columns, same refusal order as 127, with one
-- refusal added LAST: 'already_approved' comes after 'not_authorised', so a
-- person taken off a step is told it is not theirs rather than that they
-- already approved it.

create or replace function public.approval_advance(
  p_request_id  uuid,
  p_actor       uuid,
  p_actor_email text,
  p_action      text,
  p_note        text default null
)
returns table (
  outcome             text,
  request_status      text,
  decided_stage_order smallint,
  next_stage_order    smallint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req     public.approval_requests%rowtype;
  v_stage   public.approval_request_stages%rowtype;
  v_allowed boolean;
  v_now     timestamptz := now();
begin
  if p_action is null or p_action not in ('approve', 'reject') then
    raise exception 'invalid_action' using errcode = 'P0001';
  end if;

  -- ⚠ The lock. Everything below happens once per request at a time.
  select * into v_req
  from public.approval_requests
  where id = p_request_id
  for update;

  if not found then
    return query select 'request_not_found'::text, null::text, null::smallint, null::smallint;
    return;
  end if;

  if v_req.status <> 'pending' then
    return query select 'request_closed'::text, v_req.status, null::smallint, null::smallint;
    return;
  end if;

  select * into v_stage
  from public.approval_request_stages
  where request_id = v_req.id
    and stage_order = v_req.current_stage_order;

  if not found or v_stage.status <> 'pending' then
    return query select 'stage_already_decided'::text, v_req.status, null::smallint, null::smallint;
    return;
  end if;

  if v_stage.resolver = 'named' then
    v_allowed := p_actor = any (v_stage.approver_pool);
  else
    v_allowed := public.is_section_adviser(v_stage.section_id, p_actor);
  end if;

  if not coalesce(v_allowed, false) then
    return query select 'not_authorised'::text, v_req.status, null::smallint, null::smallint;
    return;
  end if;

  -- ⚠ For approve AND reject: somebody who has said yes to an 'all' step has
  -- decided their part of it. Checked before the insert below, which is what
  -- keeps the unique constraint a bug detector rather than a click handler.
  if v_stage.approval_rule = 'all' and exists (
    select 1
    from public.approval_request_stage_decisions d
    where d.request_stage_id = v_stage.id
      and d.user_id = p_actor
      and d.decision = 'approve'
  ) then
    return query select 'already_approved'::text, v_req.status, null::smallint, null::smallint;
    return;
  end if;

  insert into public.approval_request_stage_decisions
    (request_stage_id, user_id, user_email, decision, note, decided_at)
  values
    (v_stage.id, p_actor, p_actor_email, p_action, p_note, v_now);

  -- ── Reject: one no ends the whole request, on either rule ─────────────────
  if p_action = 'reject' then
    update public.approval_request_stages
    set status           = 'rejected',
        decided_by       = p_actor,
        decided_by_email = p_actor_email,
        decided_at       = v_now,
        decision_note    = p_note
    where id = v_stage.id;

    update public.approval_requests
    set status     = 'rejected',
        decided_at = now(),
        updated_at = now()
    where id = v_req.id;

    -- Later stages stay 'waiting': the ladder reads as "it never got there".
    return query select 'rejected'::text, 'rejected'::text, v_stage.stage_order, null::smallint;
    return;
  end if;

  -- ── Approve on an 'all' step that still waits on others ───────────────────
  -- The yes is kept; the step row is untouched, so it stays 'pending' with no
  -- decider, exactly as 144's decision_shape_chk requires.
  if v_stage.approval_rule = 'all'
     and not public.approval_step_everyone_approved(v_stage.id, v_stage.approver_pool) then
    return query select 'recorded'::text, 'pending'::text, v_stage.stage_order, null::smallint;
    return;
  end if;

  -- ── Approve that closes the step — 'any', or the last yes on 'all' ────────
  return query
    select * from public.approval_close_step_and_advance(
      v_req.id, v_stage.id, p_actor, p_actor_email, v_now, p_note
    );
end;
$$;

comment on function public.approval_advance(uuid, uuid, text, text, text) is
  'Advances one ordered approval by one decision. Locks the request row (no skip locked) so two approvers clicking at once serialise. Re-checks the actor against the step''s own pool. Records every decision in approval_request_stage_decisions; an approval on an ''all'' step closes it only once every person in its non-empty pool has approved, answering ''recorded'' until then and ''already_approved'' to a second yes. Touches no consumer table and writes no audit row.';

-- ── 8. approval_reevaluate_stage ───────────────────────────────────────────

create or replace function public.approval_reevaluate_stage(p_request_stage_id uuid)
returns table (
  outcome             text,
  request_status      text,
  decided_stage_order smallint,
  next_stage_order    smallint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_req        public.approval_requests%rowtype;
  v_stage      public.approval_request_stages%rowtype;
  v_last       public.approval_request_stage_decisions%rowtype;
begin
  select s.request_id into v_request_id
  from public.approval_request_stages s
  where s.id = p_request_stage_id;

  if not found then
    return query select 'unchanged'::text, null::text, null::smallint, null::smallint;
    return;
  end if;

  -- ⚠ The same lock approval_advance takes, and NO `skip locked`: this and a
  -- decision on the same request must run one after the other.
  select * into v_req
  from public.approval_requests
  where id = v_request_id
  for update;

  if not found or v_req.status <> 'pending' then
    return query select 'unchanged'::text, v_req.status, null::smallint, null::smallint;
    return;
  end if;

  -- Re-read under the lock: a decision may have landed while we waited for it.
  select * into v_stage
  from public.approval_request_stages
  where id = p_request_stage_id;

  if v_stage.status <> 'pending'
     or v_stage.stage_order <> v_req.current_stage_order
     or v_stage.resolver <> 'named'
     or v_stage.approval_rule <> 'all'
     or not public.approval_step_everyone_approved(v_stage.id, v_stage.approver_pool) then
    return query select 'unchanged'::text, v_req.status, null::smallint, null::smallint;
    return;
  end if;

  -- The step closes in the name of the latest approver still on it.
  select d.* into v_last
  from public.approval_request_stage_decisions d
  where d.request_stage_id = v_stage.id
    and d.decision = 'approve'
    and d.user_id = any (v_stage.approver_pool)
  order by d.decided_at desc, d.id desc
  limit 1;

  return query
    select * from public.approval_close_step_and_advance(
      v_req.id, v_stage.id, v_last.user_id, v_last.user_email, v_last.decided_at, v_last.note
    );
end;
$$;

comment on function public.approval_reevaluate_stage(uuid) is
  'Takes a second look at one approval step after its people change. If it is the live ''all'' step of an open request and everyone left in its non-empty pool has approved, closes it in the name of the latest of them and moves the request on (''advanced'' / ''completed''); otherwise ''unchanged''. Locks the request row exactly as approval_advance does. Touches no consumer table and writes no audit row — the caller runs the subject''s follow-up.';

-- ── 9. Lock-down ───────────────────────────────────────────────────────────
--
-- 127's block, same shape. Revoking from PUBLIC alone does not work here —
-- Supabase grants `anon` directly (103 → 104).

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.approval_advance(uuid, uuid, text, text, text)',
    'public.approval_reevaluate_stage(uuid)'
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

-- ⚠ The helpers go to NOBODY, service_role included. They take no lock, so a
-- direct call could close a step without the serialisation the two functions
-- above exist for. Those two are SECURITY DEFINER and run as the owner, which
-- keeps its own right to execute.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.approval_step_everyone_approved(uuid, uuid[])',
    'public.approval_close_step_and_advance(uuid, uuid, uuid, text, timestamptz, text)'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
    else
      raise notice 'skipping %, no such function', fn;
    end if;
  end loop;
end $$;

-- Verify after applying: scripts/verify-approval-migrations.ts calls both
-- public functions with the ANON key and expects `42501 permission denied`.
