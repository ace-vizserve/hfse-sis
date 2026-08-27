-- 127_approval_advance.sql
--
-- The one write that moves an ordered approval forward.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY AN RPC AND NOT THREE UPDATES FROM THE ROUTE
--
-- "First to act carries it" means two people can legitimately click Approve on
-- the same stage at the same moment. Done from the application in three
-- statements, both would read the stage as pending, both would mark it
-- approved, and both would advance — the second one moving a request that had
-- already moved, so a two-stage flow could complete on one person's click.
--
-- `select … for update` on the REQUEST row serialises them. The second caller
-- waits, then finds the stage already decided and is told so.
--
-- ⚠ NO `skip locked`. Migration 044 wrote down the same rule for
-- `apply_change_request_atomic`: skipping would race past the very state change
-- the lock exists to observe. The loser must block and then lose, not miss.
--
-- ─────────────────────────────────────────────────────────────────────────
-- AUTHORISATION IS RE-CHECKED HERE, NOT TRUSTED FROM THE CALLER
--
-- The route has already worked out who the actor is. This checks again anyway,
-- against the stage's own pool — because "who may act" is a property of the
-- ladder, and a function that mutates approval state on the strength of an
-- argument saying "trust me" is one refactor away from being wrong.
--
--   named        → the actor is in the frozen pool
--   form_adviser → is_section_adviser(section, actor), resolved LIVE, which is
--                  what makes a relief teacher able to decide the class they
--                  are actually covering this week
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- It does not touch `student_declarations`, or any other consumer. The engine
-- points at its subject and holds no key back (see 125 and 126), so the route
-- projects the outcome onto the subject after this returns. Migration 044 drew
-- the same line for the same reason and said so: the RPC owns only the
-- mutations that must be atomic with the lock.
--
-- It also writes no audit row. `audit_log` reads the actor from the cookie
-- session and belongs outside SECURITY DEFINER — again 044's rule.
--
-- Idempotent — safe to re-run.

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
  v_next    smallint;
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
    -- Already approved, rejected or withdrawn. The caller turns this into a
    -- plain sentence, not an error — somebody clicking a stale screen has done
    -- nothing wrong.
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

  -- ── Reject: one no ends the whole request ────────────────────────────────
  if p_action = 'reject' then
    update public.approval_request_stages
    set status           = 'rejected',
        decided_by       = p_actor,
        decided_by_email = p_actor_email,
        decided_at       = now(),
        decision_note    = p_note
    where id = v_stage.id;

    update public.approval_requests
    set status     = 'rejected',
        decided_at = now(),
        updated_at = now()
    where id = v_req.id;

    -- Later stages stay 'waiting' rather than being marked skipped: the ladder
    -- should read as "it never got there", which is what happened.
    return query select 'rejected'::text, 'rejected'::text, v_stage.stage_order, null::smallint;
    return;
  end if;

  -- ── Approve ──────────────────────────────────────────────────────────────
  update public.approval_request_stages
  set status           = 'approved',
      decided_by       = p_actor,
      decided_by_email = p_actor_email,
      decided_at       = now(),
      decision_note    = p_note
  where id = v_stage.id;

  select min(stage_order) into v_next
  from public.approval_request_stages
  where request_id  = v_req.id
    and status      = 'waiting'
    and stage_order > v_stage.stage_order;

  if v_next is null then
    update public.approval_requests
    set status     = 'approved',
        decided_at = now(),
        updated_at = now()
    where id = v_req.id;

    return query select 'completed'::text, 'approved'::text, v_stage.stage_order, null::smallint;
    return;
  end if;

  update public.approval_request_stages
  set status = 'pending'
  where request_id = v_req.id
    and stage_order = v_next;

  update public.approval_requests
  set current_stage_order = v_next,
      updated_at          = now()
  where id = v_req.id;

  return query select 'advanced'::text, 'pending'::text, v_stage.stage_order, v_next;
end;
$$;

comment on function public.approval_advance(uuid, uuid, text, text, text) is
  'Advances one ordered approval by one decision. Locks the request row (no skip locked) so two approvers clicking at once serialise — the loser gets ''stage_already_decided'', not a duplicate advance. Re-checks the actor against the stage''s own pool. Touches no consumer table and writes no audit row: the route projects the outcome onto the subject and logs it, so the RPC owns only what must be atomic with the lock.';

-- ── Lock-down ──────────────────────────────────────────────────────────────
--
-- ⚠ REVOKING FROM `PUBLIC` IS NOT ENOUGH, and this is not theoretical.
-- Migration 103 revoked seven SECURITY DEFINER RPCs from `public` and
-- `authenticated` and it DID NOT WORK: verified against the live database
-- afterwards, an anonymous caller holding only the public anon key still
-- executed all seven. Supabase grants EXECUTE to `anon` DIRECTLY, and a direct
-- grant is not removed by revoking from PUBLIC. Migration 104 is the fix and
-- this block is 104's, verbatim in shape.
--
-- 🔴 `apply_change_request_atomic` IS IN THIS LIST AND IS NOT NEW WORK.
-- Migration 044 granted it to `authenticated` (044:206) and it was then missed
-- by BOTH 103 and 104 — it appears in neither lockdown list. It is SECURITY
-- DEFINER, takes five caller-supplied values, and performs no role check of its
-- own: its only guard is `status = 'approved'` on the request row. That is the
-- same class of hole 103/104 closed for its seven siblings, left open for a
-- year because nobody re-grepped. Closing it here costs one array entry.
-- ⚠ Its legitimate caller
-- (app/api/grading-sheets/[id]/entries/[entryId]/route.ts) uses the SERVICE
-- client, so it is unaffected — but verify that in the browser, because the
-- whole point of migrations 114/116 is that this assumption is worth checking.

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.approval_advance(uuid, uuid, text, text, text)',
    'public.apply_change_request_atomic(uuid, uuid, uuid, jsonb, uuid)'
  ]
  loop
    -- to_regprocedure returns null rather than raising when the signature does
    -- not exist, so a renamed function skips instead of failing the migration.
    if to_regprocedure(fn) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', fn);
      execute format('grant execute on function %s to service_role', fn);
    else
      raise notice 'skipping %, no such function', fn;
    end if;
  end loop;
end $$;

-- Verify after applying by calling either with the ANON key: expect
-- `42501 permission denied`, not an execution error. An execution error means
-- the body ran, which means the revoke did not take.
