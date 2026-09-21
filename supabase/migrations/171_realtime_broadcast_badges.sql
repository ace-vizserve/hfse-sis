-- 171_realtime_broadcast_badges.sql
--
-- Move the four live badge subscriptions off Postgres Changes and onto
-- Broadcast from the database.
--
-- WHY. Supabase recommends Broadcast over Postgres Changes at scale, but the
-- reason it is nearly free HERE is a property of this codebase: not one of the
-- four handlers reads the event payload. They all re-count against the server
-- and let RLS produce the number. The event has only ever meant "something
-- moved, go look again", which is exactly what a broadcast ping is.
--
-- ADDITIVE ONLY. Nothing is removed from the `supabase_realtime` publication,
-- so both transports are live at once and reverting the client commit is a
-- complete rollback with no second migration. Dropping the publication entries
-- is a later migration, gated on a browser verification.
--
-- Full reasoning: docs/superpowers/specs/2026-09-21-realtime-broadcast-transport-design.md

-- ---------------------------------------------------------------------------
-- 1. Trigger functions
-- ---------------------------------------------------------------------------

-- Fixed-topic ping. The topic is passed as a trigger argument so one function
-- serves three tables.
--
-- ⚠ THE EXCEPTION HANDLER IS LOAD-BEARING, NOT DEFENSIVE HABIT. This runs
-- inside the transaction of the write that fired it. `audit_log` takes a row on
-- every grade entry, and grade entries and audit rows are append-only by Hard
-- Rule #6 — a badge ping is not permitted to be the thing that breaks a write.
-- An AFTER trigger's return value is ignored, so returning null is correct.
create or replace function public.broadcast_badge_ping()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
begin
  perform realtime.send('{}'::jsonb, 'badge', tg_argv[0], true);
  return null;
exception when others then
  return null;
end;
$$;

comment on function public.broadcast_badge_ping() is
  'Broadcasts an empty "badge" ping on the topic named in tg_argv[0]. Payload is deliberately empty: a badge count differs per viewer, so the client re-counts under RLS. Swallows all exceptions so a failed broadcast cannot roll back the write that fired it.';

-- Per-user ping, for the one topic that is addressed to an individual.
create or replace function public.broadcast_badge_ping_for_user()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
begin
  perform realtime.send(
    '{}'::jsonb,
    'badge',
    'sis:approval-decisions:' || new.user_id::text,
    true
  );
  return null;
exception when others then
  return null;
end;
$$;

comment on function public.broadcast_badge_ping_for_user() is
  'As broadcast_badge_ping, but on the per-user topic sis:approval-decisions:<user_id>. Used by approval_request_stage_decisions, whose subscription was already per-user under Postgres Changes.';

-- ---------------------------------------------------------------------------
-- 2. Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists broadcast_badge_grade_change_requests on public.grade_change_requests;
create trigger broadcast_badge_grade_change_requests
after insert or update on public.grade_change_requests
for each row
execute function public.broadcast_badge_ping('sis:grade-change-requests');

drop trigger if exists broadcast_badge_approval_stages on public.approval_request_stages;
create trigger broadcast_badge_approval_stages
after insert or update on public.approval_request_stages
for each row
execute function public.broadcast_badge_ping('sis:approval-stages');

drop trigger if exists broadcast_badge_approval_decisions on public.approval_request_stage_decisions;
create trigger broadcast_badge_approval_decisions
after insert on public.approval_request_stage_decisions
for each row
execute function public.broadcast_badge_ping_for_user();

-- ⚠ THE `when` CLAUSE IS THE PERFORMANCE GUARD. audit_log takes a row on every
-- grade entry; without this gate every one of them would enter plpgsql to
-- decide it had nothing to do. Under Postgres Changes this same filter was
-- `action=in.(...)` evaluated by Realtime; in Postgres it is strictly cheaper,
-- because a non-matching row never calls the function at all.
drop trigger if exists broadcast_badge_pfile_verification on public.audit_log;
create trigger broadcast_badge_pfile_verification
after insert on public.audit_log
for each row
when (
  new.action in (
    'pfile.upload',
    'pfile.reminder.sent',
    'sis.document.approve',
    'sis.document.reject',
    'sis.documents.auto-expire',
    'sis.documents.auto-revive'
  )
)
execute function public.broadcast_badge_ping('sis:pfile-verification');

-- ---------------------------------------------------------------------------
-- 3. Who may join which topic
-- ---------------------------------------------------------------------------

-- Private channels read `realtime.messages`, so joining a topic is a SELECT and
-- this policy is the whole authorization model.
--
-- ⚠ THE ROLE LISTS ARE RESTATED FROM TYPESCRIPT AND ARE NOW DUPLICATED IN TWO
-- LANGUAGES. `GATE_ROLES` is components/notifications/notification-bell.tsx:21
-- and `PFILE_BADGE_ROLES` is lib/sidebar/use-realtime-badges.ts:50. A role added
-- to one without the other gets a subscription this policy refuses, which
-- presents as a badge that is dead for that role only.
--
-- ⚠ `current_user_role()` (migration 142) returns the role IN FORCE, reading
-- app_metadata.active_role first. An account holding a role LIST with no
-- active_role set reads as a non-role — a parent — and is refused here. That is
-- the same array trap 142 documents, and it lands as a silently dead badge
-- rather than a visible error.
--
-- ⚠ `else false` makes this default-deny for every other topic. There are no
-- other private channels in the app today. Policies are OR'd, so a future
-- feature adds its own policy rather than widening this one.
drop policy if exists "sis badge topics" on realtime.messages;
create policy "sis badge topics"
on realtime.messages
for select
to authenticated
using (
  case
    when realtime.topic() in ('sis:grade-change-requests', 'sis:approval-stages')
      then public.current_user_role() in (
        'teacher', 'academic_coordinator', 'school_admin', 'superadmin'
      )
    when realtime.topic() = 'sis:pfile-verification'
      then public.current_user_role() in (
        'admissions', 'school_admin', 'superadmin'
      )
    when realtime.topic() like 'sis:approval-decisions:%'
      then realtime.topic() = 'sis:approval-decisions:' || auth.uid()::text
    else false
  end
);
