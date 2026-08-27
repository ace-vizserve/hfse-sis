-- 129_approval_stage_own_work_read.sql
--
-- A person may read the approval steps THEY can act on — and nothing else.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS: THE NOTIFICATION HAS NOTHING TO WATCH
--
-- Mr Ace, 2026-08-27, on how a declaration should reach its approver: "the
-- whole UI flow is the same as grade change request." That flow gives an
-- approver a number on the sidebar and a bell in the header, both live, from
-- anywhere in the app.
--
-- It can do that because `grade_change_requests` is READABLE FROM THE BROWSER
-- under RLS: the count hook subscribes to the table as the signed-in user and
-- recounts. Declarations have nothing equivalent, and every candidate fails:
--
--   * `approval_request_stages` — migration 126 gave all four engine tables
--     RLS with an explicit `using (false)` SELECT policy. Nothing to watch.
--   * `student_declarations` (125) — admits registrar-and-above, or a teacher
--     who holds that class. THE OFFICER IN CHARGE MATCHES NEITHER: Ms Elaine
--     holds a plain `teacher` account and does not teach these children. The
--     staff queue only works because it reads through the service client.
--   * `audit_log` — `is_registrar_or_above()`, so the P-Files badge pattern
--     (listen to audit rows, refresh) never reaches a form class adviser.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHAT 126 WAS PROTECTING, AND WHY THIS DOES NOT UNDO IT
--
-- 126's reasoning was: "`approver_pool` is a list of who decides what, and a
-- signed-in user must not be able to enumerate it." That is right, and it
-- stays right. The hole it closed was ENUMERATION — reading the whole table to
-- learn who approves what across the school.
--
-- This policy does not open that. It admits a row only when the reader is
-- ALREADY ON IT: named in that row's own pool, or the adviser of that row's
-- own class. You can see your own work. You cannot see anybody else's, you
-- cannot list the pools, and you learn nothing about a step you are not on.
--
-- ⚠ The other three tables are UNTOUCHED and still deny SELECT outright.
-- `approval_stage_approvers` in particular is the configuration — who holds
-- which post for which half of the school — and that stays service-role only.
--
-- ⚠ EVERY STATUS IS READABLE, NOT JUST THE STEP THAT IS LIVE. Restricting to
-- `status = 'pending'` reads tighter and was tried first, but it breaks the
-- thing this migration exists for: when an adviser approves, the row leaves
-- `pending` and would leave the reader's visibility at the same instant, so
-- the UPDATE never arrives and a co-adviser's badge keeps showing work that is
-- already done. A stale count that looks authoritative is worse than a slightly
-- wider read — and the wider read is still only rows the person is on. The
-- COUNT narrows to `pending`; the POLICY does not.
--
-- Idempotent — safe to re-run.

-- ── 1. Replace the blanket SELECT denial on this ONE table ─────────────────

drop policy if exists approval_request_stages_no_select
  on public.approval_request_stages;

drop policy if exists approval_request_stages_own_work_select
  on public.approval_request_stages;

create policy approval_request_stages_own_work_select
  on public.approval_request_stages
  for select
  to authenticated
  using (
    -- A named step: the reader is one of the people it was frozen onto.
    auth.uid() = any (approver_pool)
    -- A derived step: the reader advises that class right now, which includes
    -- a co-adviser and anyone inside a live relief cover window. Same single
    -- definition the RPC authorises against (126), so a person can never see a
    -- step they would then be refused on.
    or (
      section_id is not null
      and public.is_adviser_for_section(section_id)
    )
  );

comment on policy approval_request_stages_own_work_select
  on public.approval_request_stages is
  'You may read an approval step you are on: named in its pool, or the adviser of its class. Nothing else. This is what lets the browser keep a live count of work waiting for you — the same thing grade_change_requests already does for grade changes — without letting anybody enumerate who approves what, which is what migration 126 was protecting.';

-- Writes stay denied. Deciding goes through `approval_advance`, which is
-- service-role only and re-checks authorisation itself; 126's no_insert /
-- no_update / no_delete policies are deliberately left exactly as they are.

-- ── 2. Realtime ────────────────────────────────────────────────────────────
--
-- ⚠ REPLICA IDENTITY FULL, and it is not optional here. Realtime evaluates RLS
-- against the row in the WAL record. With the default replica identity an
-- UPDATE carries only the primary key for the OLD row, so Realtime cannot tell
-- whether the reader was allowed to see it and drops the event. That is
-- precisely the event this feature needs: a step going from waiting to pending
-- is the moment it becomes somebody's job.
alter table public.approval_request_stages replica identity full;

-- `alter publication ... add table` errors if the table is already a member,
-- so it is guarded rather than made unconditional.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'approval_request_stages'
  ) then
    alter publication supabase_realtime add table public.approval_request_stages;
  end if;
end $$;
