-- 116_relief_helper_execute_grant.sql
--
-- Repairs a break introduced by migration 114.
--
-- WHAT WENT WRONG
--
-- 114 created `has_active_relief_for_assignment` and then revoked EXECUTE on it
-- from `public`, `anon` and `authenticated`, granting it to `service_role`
-- alone. That pattern was copied from migrations 103/104, which lock down
-- SECURITY DEFINER *RPCs* — functions a browser could otherwise call directly
-- over PostgREST. Locking those down is right.
--
-- This function is not that. It is a helper called from INSIDE row-level
-- security policies, and an RLS policy is evaluated as the querying role. So
-- `teacher_assignments_scoped_read` — rewritten by 115 to call it — became a
-- policy that the very role it governs is not allowed to execute. The result
-- is `permission denied for function has_active_relief_for_assignment`, and
-- because that policy gates the table, EVERY cookie-scoped read of
-- `teacher_assignments` fails.
--
-- The damage is wider than the relief feature. The section Teachers tab went
-- blank — a class with three staff on it rendered "No form adviser assigned
-- yet" — while the staff directory, which reads through the service client and
-- so bypasses RLS entirely, went on showing the same assignments correctly.
-- Two screens disagreeing about whether a teacher exists.
--
-- WHY GRANTING IS SAFE
--
-- The function is `security definer`, so it runs with the definer's rights
-- whoever calls it, and it takes no untrusted input beyond an assignment id.
-- All it can answer is "is the CALLER (auth.uid()) currently covering this
-- assignment" — a fact that caller is entitled to. It leaks nothing about
-- anybody else, which is exactly why the three sibling helpers in
-- 005_rls_teacher_scoping.sql have always been executable by `authenticated`:
-- a policy helper has to be.
--
-- Idempotent — safe to re-run.

grant execute on function public.has_active_relief_for_assignment(uuid) to authenticated;

-- `anon` is deliberately NOT granted. Nothing unauthenticated reads
-- teacher_assignments, and auth.uid() is null there, so the function could only
-- ever return false — a grant with no purpose is a grant to explain later.

comment on function public.has_active_relief_for_assignment(uuid) is
  'True when the calling user is covering the given teacher_assignments row TODAY (Singapore time). Called from the scoped-read RLS policies, so `authenticated` MUST hold EXECUTE — see migration 116; revoking it silently blanks every assignment read.';
