-- 142 — A ROLE IS A LIST NOW, AND `active_role` NAMES THE ONE IN FORCE.
--
-- ⚠ ALREADY APPLIED. Mr Ace ran this against production BEFORE the matching
-- application code existed. That ordering was deliberate and is the safe one:
-- see "why this could land first" below. This file is the repo's record of what
-- is live. `create or replace function` is idempotent, so re-running it is
-- harmless.
--
-- ── what changed above the database ──────────────────────────────────────
--
-- An account may hold more than one role — the case this exists for is the six
-- live `school_admin` accounts at this school that also teach, four of them the
-- form adviser of record for a class. So `app_metadata` now carries:
--
--     role        = ['school_admin', 'teacher']   -- what the account MAY be
--     active_role = 'teacher'                     -- what it IS right now
--
-- ⚠ THERE IS STILL EXACTLY ONE ROLE IN FORCE AT ANY MOMENT, and that is the
-- whole reason this migration is four lines rather than a rewrite of the RLS
-- layer. `current_user_role()` keeps returning ONE role, so the ~34 policies
-- built on it, `is_registrar_or_above()`, and every `current_user_role() in
-- (...)` test are untouched. Switching role is a real change of what the person
-- may do, not a rendering preference layered on top of one.
--
-- ── the trap this encodes ────────────────────────────────────────────────
--
-- 🔴 `->> 'role'` ON AN ARRAY RETURNS TEXT, NOT NULL. Once `role` holds
-- `["school_admin","teacher"]`, the old
--
--     coalesce(app_metadata ->> 'role', user_metadata ->> 'role')
--
-- hands back the literal string `["school_admin","teacher"]` — a value that is
-- not null, is not a role, and matches no policy. Every account with an array
-- would silently resolve to "not staff", which in this app means PARENT: the
-- proxy routes them to /parent and every RLS policy refuses them. A lockout,
-- not a bug report.
--
-- So each fallback is guarded with `jsonb_typeof(...) = 'string'` — it answers
-- only for the scalar shape it was written for, and yields to `active_role` for
-- the array shape. The same trap is guarded on the TypeScript side in
-- `lib/auth/roles.ts`, which is the only place the app interprets the shape.
--
-- ── why this could land first ────────────────────────────────────────────
--
-- It was a NO-OP on the day it ran. Every one of the 44 accounts stored `role`
-- as a plain string and none had an `active_role`, so `active_role` was null,
-- the scalar branch answered exactly as before, and nothing observable changed.
-- That is what took the only lockout risk in this piece of work off the path:
-- the database was ready for both shapes before either the app or a single
-- account moved. There is no backfill — accounts move to the list as they are
-- edited on /sis/admin/staff.
--
-- ⚠ NOTHING IN THIS REPO CAN VERIFY THIS MIGRATION, for the same reason
-- migration 140 could not be verified (see
-- `scripts/verify-rich-text-note-migration.ts`): a function body lives in
-- `pg_catalog`, PostgREST cannot read it, and there is no `DATABASE_URL` here.
-- The non-invasive proof is a SQL-editor query:
--
--     select pg_get_functiondef('public.current_user_role()'::regprocedure);
--
-- and the expected result is the body below. The behavioural proof is the
-- browser pass: grant an account two roles, switch, and confirm the pages the
-- new role does not reach actually bounce.

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(
    coalesce(
      -- The role in force. Written by POST /api/account/active-role, which
      -- checks the requested value against the roles the account holds before
      -- storing it, so this can only ever name a role the account has.
      auth.jwt() -> 'app_metadata' ->> 'active_role',
      -- The 44 accounts that still store a single role string. Guarded: see
      -- the array trap above.
      case
        when jsonb_typeof(auth.jwt() -> 'app_metadata' -> 'role') = 'string'
          then auth.jwt() -> 'app_metadata' ->> 'role'
      end,
      -- Legacy fallback from 004, kept and guarded the same way. `active_role`
      -- is deliberately NOT read from `user_metadata`: that object is writable
      -- by the account holder through Supabase's own client, and a new key that
      -- outranks `role` must never be.
      case
        when jsonb_typeof(auth.jwt() -> 'user_metadata' -> 'role') = 'string'
          then auth.jwt() -> 'user_metadata' ->> 'role'
      end
    ),
    ''
  );
$$;

comment on function public.current_user_role() is
  'Returns the caller''s role in force: JWT app_metadata.active_role, else a scalar app_metadata.role, else a scalar user_metadata.role (legacy). An account may hold several roles in app_metadata.role as an array; exactly one is in force at a time, so RLS policies keep comparing against a single value. Returns null for unauthenticated or no-role JWTs.';
