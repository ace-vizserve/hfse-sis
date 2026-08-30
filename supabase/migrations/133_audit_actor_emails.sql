-- 133_audit_actor_emails.sql
--
-- Gives the module audit-log pages a way to ask "who has ever acted here"
-- without reading the log to find out.
--
-- WHAT THE PAGES WERE DOING
--
-- Three of the seven audit-log pages build an Actor filter dropdown. Each one
-- selected the `actor_email` COLUMN and de-duplicated the result in JavaScript
-- with a Set. Two of them bounded that read with `.limit(200)`, and a row limit
-- is not an actor limit: ordered by email, 200 rows can be two people who were
-- busy. The third had no limit at all, which is correct until the day it is
-- not -- PostgREST returns the first 1,000 rows of an over-cap response with no
-- error and no flag, so that page is one busy term away from the same silent
-- shortfall, with nothing to announce it.
--
-- WHAT WAS MEASURED BEFORE WRITING THIS (production, 2026-08-30)
--
--   markbook    306 rows   9 distinct actors   limit(200) showed 8  <-- LIVE
--   attendance  138 rows   8 distinct actors   limit(200) showed 8
--   evaluation   29 rows   4 distinct actors   unbounded, showed 4
--
--   audit_log total: 1,499 rows.
--
-- So exactly one of the three is wrong on today's data: the markbook dropdown
-- is missing a person, and has been. The other two are accurate right now and
-- are being changed because the shape is wrong, not because the answer is.
--
-- Note what that table does NOT say. The dropdown is a filter -- an actor
-- missing from it cannot be selected, but their rows still appear in the log
-- itself. Nothing was hidden from the record; one name was missing from a
-- picker. That is worth fixing and is not worth overstating.
--
-- WHY AN RPC AND NOT A BIGGER LIMIT
--
-- PostgREST has no DISTINCT. Every alternative available to the client reads
-- rows to derive a handful of names:
--
--   * A bigger `.limit(N)` restates the same bug with a larger N. It is right
--     until the log grows past it, and it fails the same way -- quietly.
--   * Paging the projection (fetchAllPages) is correct and gets slower every
--     term, because it reads the entire log on every render of every one of
--     these pages to populate a nine-item <Select>.
--
-- `select distinct` in the database returns nine rows for nine actors and stays
-- nine rows when the log holds a hundred thousand. The `audit_log_action_idx`
-- index added in migration 006 already covers the `action = any(...)` filter.
--
-- SECURITY INVOKER, DELIBERATELY
--
-- This is NOT the SECURITY DEFINER shape that migrations 103 and 104 had to
-- lock down. It is declared `security invoker`, so the body runs as whoever
-- calls it and migration 006's `audit_log_registrar_read` policy still decides
-- what they may see. A teacher who calls this over PostgREST gets the same
-- empty result their own SELECT would give them. There is no privilege here to
-- escalate, which is the entire reason it can be granted safely below.
--
-- THE GRANT IS LOAD-BEARING -- DO NOT REMOVE IT
--
-- Migration 114 revoked EXECUTE on exactly this kind of helper from
-- `authenticated`, copying the lockdown pattern from 103/104 without noticing
-- that the function was called by the very role it governs. Every teacher's
-- section Teachers tab went blank until 116 put the grant back. This function
-- is called from a server component running on the signed-in user's cookie
-- client -- that is `authenticated`, not `service_role`. Without the grant the
-- three dropdowns raise `permission denied for function audit_actor_emails`.
--
-- `anon` is deliberately not granted. Nothing unauthenticated renders an audit
-- log, and with a null `auth.uid()` the RLS policy would return zero rows
-- regardless -- a grant with no purpose is a grant somebody has to explain
-- later.
--
-- DEPLOY ORDERING -- THIS MIGRATION MUST BE APPLIED BEFORE THE CODE SHIPS
--
-- All three Actor dropdowns now call this function and nothing else --
-- `lib/audit/actor-emails.ts` has no second path, by decision. So: code calls
-- `audit_actor_emails`, therefore 133 must be applied before deploy. Deploy
-- first and every one of the three filters renders with no options, which is a
-- REGRESSION on the two that were accurate before this change (attendance and
-- evaluation both listed their actors correctly; only markbook was short a
-- name). Treat this the same way KD #153 treats migration 078: not a nicety,
-- an ordering requirement.
--
-- WHY THERE IS NO FALLBACK, WHICH IS ALSO A DECISION
--
-- The degrade is a deliberately empty list, and it stays that way:
--
--   * It is VISIBLE. An empty <Select> is not a silent wrong answer -- the
--     shape of failure this whole pass exists to remove.
--   * It is LOGGED, by page, naming this file. `loadAuditActorEmails` prints
--     "has migration 133_audit_actor_emails.sql been applied?" so the first
--     person to look knows the answer without reading any source.
--   * It is HARMLESS. The dropdown is a FILTER. An actor missing from it
--     cannot be picked; every one of their rows still appears in the log. No
--     record is hidden and no page fails to render.
--   * It SELF-HEALS the instant this file is applied. There is no cache to
--     bust, no data to backfill, no code to redeploy.
--
-- A fallback would trade all four of those for the `.limit(200)` projection
-- this migration was written to delete -- a query measured wrong on production
-- data (see the table above). A fallback that is wrong is worse than a gap that
-- is obvious, because the wrong one never tells anybody it happened. DO NOT
-- ADD ONE, and do not restore the limit query.
--
-- STANDS ALONE. 132_ay_enrolment_indexes.sql is also written and not yet
-- applied; this migration shares no object with it, touches none of the AY
-- tables, and can be applied before it, after it, or without it. That is
-- independence between the two MIGRATIONS -- it says nothing about the
-- ordering above, which is between this migration and the CODE.
--
-- Idempotent -- safe to re-run.

create or replace function public.audit_actor_emails(p_actions text[])
returns table (actor_email text)
language sql
stable
security invoker
set search_path = public
as $$
  -- `al.` qualification is required, not cosmetic: `actor_email` is also the
  -- name of this function's OUT column, and an unqualified reference to it
  -- inside the body is ambiguous.
  select distinct al.actor_email
  from public.audit_log al
  where al.action = any(p_actions)
    -- `audit_log.actor_email` is declared `text not null` in migration 006, so
    -- this predicate removes nothing today. It is kept because the JS this
    -- replaces carried a `.filter(Boolean)`, and dropping the guard silently
    -- while moving the logic into SQL is how a constraint change three years
    -- from now becomes an empty option in a <Select>.
    and al.actor_email is not null
  order by 1
$$;

-- `create function` grants EXECUTE to PUBLIC by default, which would include
-- `anon`. Revoke first, then grant the one role that actually calls it.
revoke all on function public.audit_actor_emails(text[]) from public;
revoke all on function public.audit_actor_emails(text[]) from anon;

grant execute on function public.audit_actor_emails(text[]) to authenticated;
grant execute on function public.audit_actor_emails(text[]) to service_role;

comment on function public.audit_actor_emails(text[]) is
  'Distinct non-null actor_email values in audit_log for the given action allowlist, ordered. Backs the Actor filter dropdown on the module audit-log pages, which previously read the actor_email column and de-duplicated in JS -- a row limit that was never an actor limit. SECURITY INVOKER on purpose: migration 006''s audit_log_registrar_read policy still applies to the caller, so this grants no visibility the caller did not already have. The execute grant to authenticated is required (see migration 114/116) because the caller is a server component on the user cookie client.';
