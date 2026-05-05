-- 039_consolidate_admin_into_school_admin.sql
--
-- Retire the `admin` role. The HFSE SIS shipped with two functionally
-- identical generalist roles (`admin` and `school_admin`); this migration
-- collapses them into one. Existing `admin` users flip to `school_admin`,
-- and the registrar-or-above RLS helper is updated so the merged role
-- inherits admin's read access on grade/attendance/audit tables.
--
-- After this migration the remaining role set is:
--   teacher | registrar | school_admin | superadmin | p-file | admissions
--
-- Migration is idempotent — re-running on a database that already lacks
-- 'admin' users is a no-op for the UPDATE, and the function CREATE OR
-- REPLACE re-issues the same definition.

-- 1) Flip live auth users from 'admin' to 'school_admin'.
update auth.users
set raw_app_meta_data = jsonb_set(
  raw_app_meta_data,
  '{role}',
  '"school_admin"'
)
where (raw_app_meta_data ->> 'role') = 'admin';

-- 2) Refresh is_registrar_or_above() so the merged school_admin gets the
--    RLS-level read access that admin used to enjoy. Used by SELECT
--    policies on grade_audit_log, students, section_students,
--    grading_sheets, grade_entries, report_card_comments,
--    attendance_records, teacher_assignments, audit_log,
--    report_card_publications, attendance_daily.
create or replace function public.is_registrar_or_above()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('registrar', 'school_admin', 'superadmin');
$$;
