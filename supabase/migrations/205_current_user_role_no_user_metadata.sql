-- 205_current_user_role_no_user_metadata.sql
--
-- The role never comes from `user_metadata` any more. The account holder can
-- write that object through Supabase's own client, so the fallback kept by 004
-- and 142 let a parent name their own role for every RLS policy that reads
-- current_user_role(). `lib/auth/roles.ts` drops the same fallback.
--
-- The one thing removed is the third branch of 142's coalesce. Before applying
-- to production, confirm no staff account stores its role only in
-- `user_metadata`:
--
--   select email, raw_user_meta_data ->> 'role' from auth.users
--    where raw_app_meta_data -> 'role' is null
--      and raw_user_meta_data ? 'role';

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
      -- The accounts that still store a single role string. Guarded: an array
      -- would otherwise come back as its literal text (see 142).
      case
        when jsonb_typeof(auth.jwt() -> 'app_metadata' -> 'role') = 'string'
          then auth.jwt() -> 'app_metadata' ->> 'role'
      end
    ),
    ''
  );
$$;

comment on function public.current_user_role() is
  'Returns the caller''s role in force: JWT app_metadata.active_role, else a scalar app_metadata.role. Never reads user_metadata, which the account holder can write. An account may hold several roles in app_metadata.role as an array; exactly one is in force at a time, so RLS policies keep comparing against a single value. Returns null for unauthenticated or no-role JWTs.';
