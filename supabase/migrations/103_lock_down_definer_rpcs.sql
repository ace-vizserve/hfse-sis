-- 103_lock_down_definer_rpcs.sql
--
-- Stops seven SECURITY DEFINER functions from being callable by any signed-in
-- session.
--
-- THE PROBLEM. Each was granted `execute` to `authenticated` (migrations 014,
-- 016, 017, 036, 042, 068, 071, 072). `authenticated` is every logged-in
-- session, which in this system includes PARENTS — they authenticate against
-- the same Supabase project and hold a real JWT with a null role (KD #11).
-- PostgREST exposes every function as an endpoint, so a parent could POST to
-- /rest/v1/rpc/generate_section_index_numbers and renumber a class, or call
-- create_grading_sheets_for_ay, seed_grade_entries_for_sheet, or
-- recompute_attendance_rollup. SECURITY DEFINER means they run with the
-- owner's rights, so RLS does not stop any of it, and none of the seven does a
-- role check of its own.
--
-- Nothing in the app ever needed that grant. Verified caller by caller:
--
--   copy_teacher_assignments          app/api/sis/ay-setup/copy-teacher-assignments  service
--   recompute_attendance_rollup       lib/attendance/mutations.ts                    service
--   create_grading_sheets_for_section 5 section routes                               service
--   create_grading_sheets_for_ay      no caller                                      —
--   generate_section_index_numbers    app/api/sections/[id]/generate-index           service
--   realphabetize_section_index_numbers  no caller (dormant since KD #85)            —
--   seed_grade_entries_for_sheet      app/(markbook)/markbook/grading/[id]/page.tsx  WAS cookie
--
-- The last one was the only real dependency: the grading-sheet page self-heals
-- its roster on every open through the viewer's own client. It now uses the
-- service client (same commit), which is what makes this migration safe.
--
-- WHY `public` IS REVOKED TOO. Postgres grants EXECUTE on a new function to
-- PUBLIC by default, so revoking `authenticated` alone leaves it callable. That
-- default is also why the two functions later re-granted to `service_role` only
-- (migrations 080, 083) were still reachable — the grant added a role, it never
-- took the default away.
--
-- Safe to re-run. Revoking a privilege that isn't held is a no-op.

-- Roster / index numbering
revoke execute on function public.generate_section_index_numbers(uuid) from public, authenticated;
grant  execute on function public.generate_section_index_numbers(uuid) to service_role;

revoke execute on function public.realphabetize_section_index_numbers(uuid) from public, authenticated;
grant  execute on function public.realphabetize_section_index_numbers(uuid) to service_role;

-- Grading sheets + entries
revoke execute on function public.create_grading_sheets_for_ay(uuid) from public, authenticated;
grant  execute on function public.create_grading_sheets_for_ay(uuid) to service_role;

revoke execute on function public.create_grading_sheets_for_section(uuid) from public, authenticated;
grant  execute on function public.create_grading_sheets_for_section(uuid) to service_role;

revoke execute on function public.seed_grade_entries_for_sheet(uuid, uuid) from public, authenticated;
grant  execute on function public.seed_grade_entries_for_sheet(uuid, uuid) to service_role;

-- Attendance rollups
revoke execute on function public.recompute_attendance_rollup(uuid, uuid) from public, authenticated;
grant  execute on function public.recompute_attendance_rollup(uuid, uuid) to service_role;

-- Teacher assignment carry-forward
revoke execute on function public.copy_teacher_assignments(uuid, uuid) from public, authenticated;
grant  execute on function public.copy_teacher_assignments(uuid, uuid) to service_role;
