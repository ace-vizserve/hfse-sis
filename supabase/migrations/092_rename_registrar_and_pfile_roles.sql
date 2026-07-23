-- 092_rename_registrar_and_pfile_roles.sql
--
-- Rename two role values app-wide: 'registrar' -> 'academic_coordinator',
-- 'p-file' -> 'p_file_officer'. This is a rename, not a permissions change —
-- every RLS policy and application-level ROUTE_ACCESS rule keeps its exact
-- existing logic; only the role string each checks against changes.
--
-- Context: 'registrar' misdescribed the role's actual job (school-wide
-- academic artifacts — grading sheets, attendance workbooks, report cards —
-- not enrollment/records-office work); 'p-file' was internal jargon. See
-- KD #155 (docs) for the full rationale and the 3-family display grouping
-- this pairs with.
--
-- Precedent: migration 039 (admin -> school_admin) kept the SQL helper
-- function's name unchanged through an earlier role merge, updating only
-- its body via CREATE OR REPLACE. This migration follows the same pattern —
-- renaming the function itself would require touching every RLS policy that
-- calls it, for zero functional gain.
--
-- Idempotent — re-running on a database that already lacks 'registrar'/
-- 'p-file' users is a no-op for the UPDATE, and the function CREATE OR
-- REPLACE re-issues the same definition.

-- 1) Flip live auth users from the old role strings to the new ones.
update auth.users
set raw_app_meta_data = jsonb_set(
  raw_app_meta_data,
  '{role}',
  '"academic_coordinator"'
)
where (raw_app_meta_data ->> 'role') = 'registrar';

update auth.users
set raw_app_meta_data = jsonb_set(
  raw_app_meta_data,
  '{role}',
  '"p_file_officer"'
)
where (raw_app_meta_data ->> 'role') = 'p-file';

-- 2) Refresh is_registrar_or_above() to check the renamed role string.
--    Function NAME is intentionally unchanged (see header note above).
create or replace function public.is_registrar_or_above()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('academic_coordinator', 'school_admin', 'superadmin');
$$;

comment on function public.is_registrar_or_above() is
  'True when the caller has a role of academic_coordinator, school_admin, or superadmin. Function name predates the registrar->academic_coordinator rename (KD #155) and is kept for RLS policy-reference stability. Used to gate registrar-only tables (e.g. grade_audit_log).';
