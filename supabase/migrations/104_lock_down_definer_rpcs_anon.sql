-- 104_lock_down_definer_rpcs_anon.sql
--
-- Finishes what 103 started. 103 revoked execute from `public` and
-- `authenticated` and did NOT work: verified against the live database
-- afterwards, an anonymous caller holding only the public anon key still
-- executed all seven functions (recompute_attendance_rollup got far enough to
-- raise a foreign-key error, which only happens if the body ran).
--
-- WHY 103 MISSED. Supabase grants execute on functions in `public` to the
-- `anon`, `authenticated` and `service_role` roles DIRECTLY, and keeps doing so
-- for new functions via default privileges. A direct grant to `anon` is not
-- removed by revoking from `PUBLIC` — PUBLIC is the implicit
-- everyone-by-default grant, a separate thing from a named role's own grant.
-- 103 took away the default and the `authenticated` grant, and left `anon`
-- holding its own.
--
-- This revokes from every role that can reach PostgREST, then re-grants to
-- service_role alone. Verify after applying by calling one of these with the
-- anon key: expect 42501 permission denied, not an execution error.
--
-- Signatures matter — `revoke` is per overload. Taken from the defining
-- migrations: 014/068 (attendance), 016 (grading sheets), 017 (assignments),
-- 036 (entries), 042 (realphabetize), 071/072 (index numbers).
--
-- Safe to re-run.

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.generate_section_index_numbers(uuid)',
    'public.realphabetize_section_index_numbers(uuid)',
    'public.create_grading_sheets_for_ay(uuid)',
    'public.create_grading_sheets_for_section(uuid)',
    'public.seed_grade_entries_for_sheet(uuid, uuid)',
    'public.recompute_attendance_rollup(uuid, uuid)',
    'public.copy_teacher_assignments(uuid, uuid)'
  ]
  loop
    -- to_regprocedure returns null rather than raising when the signature does
    -- not exist, so a renamed or dropped function skips instead of failing the
    -- whole migration.
    if to_regprocedure(fn) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', fn);
      execute format('grant execute on function %s to service_role', fn);
    else
      raise notice 'skipping %, no such function', fn;
    end if;
  end loop;
end $$;
