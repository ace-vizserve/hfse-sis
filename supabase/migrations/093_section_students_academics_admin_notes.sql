-- 093_section_students_academics_admin_notes.sql
--
-- Two free-text note columns for the attendance-sheet Details view, siblings
-- to bus_no / classroom_officer_role (migration 015). Display + notes only;
-- no reporting impact. Per-field write gating lives in the PATCH route
-- (app/api/sections/[id]/students/[enrolmentId]/route.ts), not RLS:
--   academics_notes -> academic_coordinator | school_admin | superadmin
--   admin_notes     -> school_admin | superadmin only
--
-- MUST be applied BEFORE deploying the code that selects these columns — the
-- attendance page + enrolment PATCH route reference them. Apply after 092.
-- Safe to re-run (IF NOT EXISTS).

alter table public.section_students
  add column if not exists academics_notes text,
  add column if not exists admin_notes     text;

comment on column public.section_students.academics_notes is
  'Free-text academic notes shown in the attendance sheet Details view. Editable by academic_coordinator / school_admin / superadmin.';
comment on column public.section_students.admin_notes is
  'Free-text admin notes shown in the attendance sheet Details view. Editable by school_admin / superadmin only.';
