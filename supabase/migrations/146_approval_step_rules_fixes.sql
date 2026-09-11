-- 146_approval_step_rules_fixes.sql
--
-- Four repairs to 145's "everyone must approve" steps, found in review before
-- the code shipped. 145 is applied and is not edited; everything here is new.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 1. A LADDER ROW REMEMBERS WHICH CONFIGURED STEP IT CAME FROM
--
-- `repointWaitingStages` (lib/approvals/materialise.ts) found the in-flight
-- copies of a step by LABEL. Renaming the step on /sis/admin/approvers
-- therefore cut every request already on it off from later changes to its
-- people: take someone off the renamed step and the waiting requests kept them.
-- `config_stage_id` is stamped at filing and matched first; the label is only
-- the fallback for rows filed before this migration that the backfill below
-- could not place.
--
-- ⚠ NO FOREIGN KEY. Configured steps are retired (`is_active = false`), never
-- deleted, so a key would hold — but a ladder row is a snapshot, and nothing
-- about a later change to the configuration should be able to fail or cascade
-- into a request somebody already decided.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 2. CHANGING A STEP'S PEOPLE OR RULE TAKES THE REQUEST LOCK
--
-- 145 rebuilt an in-flight pool with a plain UPDATE from the app and then
-- asked `approval_reevaluate_stage` for a second look. Between those two
-- statements an approver could decide the step against the OLD pool, and the
-- rewrite could land over a step `approval_advance` had just closed.
-- `approval_repoint_request_stage` does the rewrite and the second look as one
-- call, under the same `for update` on the request row that approval_advance
-- takes, so the two run one after the other.
--
-- ⚠ THE RULE NOW REACHES THE LIVE STEP TOO, not only a step still 'waiting'
-- (reversing the note on 145's column comment). The two directions are safe
-- for different reasons:
--
--   any → all  A pending 'any' step has no approvals — the first yes closes
--              it — so nobody's yes is reinterpreted. Nothing can close.
--   all → any  Somebody may already have said yes. Under 'any' one yes is
--              enough, so the step closes in the name of the EARLIEST approver
--              still on it, with their note and their time, and the request
--              moves on. Their yes meant "I approve", which is exactly what
--              'any' asks of them.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 3. DELETED DECIDERS GET THEIR HISTORY ROW
--
-- 145's backfill skipped every decided step whose decider's account no longer
-- exists, because the file at the time declared a foreign key to auth.users.
-- The key was removed from the file before it was applied, so the live
-- database may or may not carry it. It is dropped here if present, and the
-- backfill re-run without the filter. `user_email` keeps the name readable.
--
-- Idempotent — safe to re-run.

-- ── 1. config_stage_id ─────────────────────────────────────────────────────

alter table public.approval_request_stages
  add column if not exists config_stage_id uuid;

comment on column public.approval_request_stages.config_stage_id is
  'The approval_stages row this ladder step was copied from (migration 146). How a change to a configured step''s people or rule finds its in-flight copies after the step is renamed. No foreign key: configured steps are retired, never deleted, and a snapshot must not depend on the configuration. Null on rows filed before 146 that the backfill could not place; those fall back to matching by label.';

create index if not exists approval_request_stages_config_stage_idx
  on public.approval_request_stages (config_stage_id)
  where config_stage_id is not null;

-- Open requests only: a closed ladder is never rewritten, so there is nothing
-- to find. ⚠ ONLY WHERE THE MATCH IS UNAMBIGUOUS — exactly one active step in
-- the flow carries the label. Two active steps sharing a name are left null
-- and keep matching by label, which is what they did before.
update public.approval_request_stages s
set config_stage_id = m.stage_id
from public.approval_requests r,
     (
       select c.flow, c.label, (array_agg(c.id))[1] as stage_id
       from public.approval_stages c
       where c.is_active
       group by c.flow, c.label
       having count(*) = 1
     ) m
where s.request_id = r.id
  and r.status = 'pending'
  and s.config_stage_id is null
  and m.flow = r.flow
  and m.label = s.label;

comment on column public.approval_request_stages.approval_rule is
  'The step''s rule as filed, copied from approval_stages like the pool. Since migration 146 a change to the configured rule reaches the live step too, under the request lock (approval_repoint_request_stage): tightening to ''all'' cannot close a pending step, and relaxing to ''any'' closes one somebody on it has already approved.';

-- ── 2. approval_repoint_request_stage ──────────────────────────────────────
--
-- Reuses 145's private helpers as they are: `approval_step_everyone_approved`
-- for the 'all' test and `approval_close_step_and_advance` for closing, so a
-- step closed here cannot advance differently from one closed by a click.
-- The 'any' test is written inline below — no helper of 145's answers it.

create or replace function public.approval_repoint_request_stage(
  p_request_stage_id uuid,
  p_pool             uuid[],
  p_rule             text
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
  v_request_id uuid;
  v_req        public.approval_requests%rowtype;
  v_stage      public.approval_request_stages%rowtype;
  v_pool       uuid[];
  v_rule       text;
  v_closer     public.approval_request_stage_decisions%rowtype;
begin
  if p_rule is null or p_rule not in ('any', 'all') then
    raise exception 'invalid_rule' using errcode = 'P0001';
  end if;

  select s.request_id into v_request_id
  from public.approval_request_stages s
  where s.id = p_request_stage_id;

  if not found then
    return query select 'skipped'::text, null::text, null::smallint, null::smallint;
    return;
  end if;

  -- ⚠ The same lock approval_advance takes, and NO `skip locked`: a decision
  -- and a change to the step's people must run one after the other.
  select * into v_req
  from public.approval_requests
  where id = v_request_id
  for update;

  if not found or v_req.status <> 'pending' then
    return query select 'skipped'::text, v_req.status, null::smallint, null::smallint;
    return;
  end if;

  -- Re-read under the lock: a decision may have closed the step while we
  -- waited for it, and a decided step keeps the pool it was decided with.
  select * into v_stage
  from public.approval_request_stages
  where id = p_request_stage_id;

  if not found or v_stage.status not in ('waiting', 'pending') then
    return query select 'skipped'::text, v_req.status, null::smallint, null::smallint;
    return;
  end if;

  -- A derived step holds no pool (126's shape CHECK) and can only be 'any'
  -- (145's CHECK), so both are held to that rather than refused.
  if v_stage.resolver = 'named' then
    v_pool := coalesce(p_pool, '{}');
    v_rule := p_rule;
  else
    v_pool := v_stage.approver_pool;
    v_rule := 'any';
  end if;

  update public.approval_request_stages
  set approver_pool = v_pool,
      approval_rule = v_rule
  where id = v_stage.id
    and (approver_pool is distinct from v_pool
         or approval_rule is distinct from v_rule);

  -- Only the live step can move. A waiting step is simply brought in line.
  if v_stage.status <> 'pending'
     or v_stage.stage_order <> v_req.current_stage_order
     or v_stage.resolver <> 'named' then
    return query select 'unchanged'::text, v_req.status, null::smallint, null::smallint;
    return;
  end if;

  if v_rule = 'all' then
    -- ⚠ Never true for an empty pool (145's helper asks cardinality first).
    if not public.approval_step_everyone_approved(v_stage.id, v_pool) then
      return query select 'unchanged'::text, v_req.status, null::smallint, null::smallint;
      return;
    end if;

    -- Closes in the name of the latest approver still on it, exactly as
    -- approval_reevaluate_stage does.
    select d.* into v_closer
    from public.approval_request_stage_decisions d
    where d.request_stage_id = v_stage.id
      and d.decision = 'approve'
      and d.user_id = any (v_pool)
    order by d.decided_at desc, d.id desc
    limit 1;
  else
    -- 'any': one approval by somebody still on the step is enough. Closes in
    -- the name of the EARLIEST of them — the yes that would have carried the
    -- step had it been 'any' all along.
    select d.* into v_closer
    from public.approval_request_stage_decisions d
    where d.request_stage_id = v_stage.id
      and d.decision = 'approve'
      and d.user_id = any (v_pool)
    order by d.decided_at asc, d.id asc
    limit 1;
  end if;

  if v_closer.id is null then
    return query select 'unchanged'::text, v_req.status, null::smallint, null::smallint;
    return;
  end if;

  return query
    select * from public.approval_close_step_and_advance(
      v_req.id, v_stage.id, v_closer.user_id, v_closer.user_email, v_closer.decided_at, v_closer.note
    );
end;
$$;

comment on function public.approval_repoint_request_stage(uuid, uuid[], text) is
  'Brings one in-flight approval step in line with its configured people and rule, under the request row lock approval_advance takes. Refuses (''skipped'') a closed request or a decided step. Rewrites the pool (named steps only) and the rule; then, if it is the live step, closes it when the new terms are met — ''all'': everyone in the non-empty pool has approved, closed in the latest approver''s name; ''any'': somebody still in the pool has approved, closed in the earliest approver''s name — and moves the request on (''advanced'' / ''completed''). Otherwise ''unchanged''. Touches no consumer table and writes no audit row: the caller runs the subject''s follow-up.';

do $$
declare
  fn text := 'public.approval_repoint_request_stage(uuid, uuid[], text)';
begin
  if to_regprocedure(fn) is not null then
    -- Revoking from PUBLIC alone does not work here — Supabase grants `anon`
    -- directly (103 → 104).
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  else
    raise notice 'skipping %, no such function', fn;
  end if;
end $$;

-- ── 3. Decisions of people whose accounts are gone ─────────────────────────

alter table public.approval_request_stage_decisions
  drop constraint if exists approval_request_stage_decisions_user_id_fkey;

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
on conflict (request_stage_id, user_id) do nothing;

-- Verify after applying: scripts/verify-approval-migrations.ts calls
-- approval_repoint_request_stage with the service key (expects 'skipped' for a
-- step that does not exist) and with the ANON key (expects 42501).
