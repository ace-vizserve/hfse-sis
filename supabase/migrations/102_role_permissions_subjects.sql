-- 102_role_permissions_subjects.sql
--
-- Seeds the `subjects` capability group added when the subject-weight routes
-- were migrated onto the capability layer.
--
-- WHY A SEPARATE GROUP. Those routes (/api/sis/admin/subjects/**) admit exactly
-- the same two roles as academic_year.edit, so they could have reused it. They
-- don't, because then unticking "Change" under Academic Year in
-- /sis/admin/roles would silently also revoke subject weights — two things a
-- superadmin would reasonably expect to control separately.
--
-- APPLYING THIS CHANGES NO BEHAVIOUR. The grants below are exactly the role set
-- those routes already enforced (school_admin + superadmin; the academic
-- coordinator is excluded, as she is on /sis/admin/subjects itself). A test
-- asserts this file and DEFAULT_ROLE_CAPABILITIES in lib/auth/capabilities.ts
-- stay identical.
--
-- No `subjects.delete`: a subject is referenced by historical grade entries
-- through subject_configs, so removal stays SQL-only (KD #72). A capability for
-- it would be a permission with no route behind it.
--
-- Idempotent, like 101 — safe to re-run, and it never clobbers a grant a
-- superadmin has since edited.

insert into public.role_permissions (role, capability) values
  ('school_admin', 'subjects.read'),
  ('school_admin', 'subjects.create'),
  ('school_admin', 'subjects.edit'),

  ('superadmin', 'subjects.read'),
  ('superadmin', 'subjects.create'),
  ('superadmin', 'subjects.edit')
on conflict (role, capability) do nothing;
