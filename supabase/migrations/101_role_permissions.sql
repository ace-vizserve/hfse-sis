-- 101_role_permissions.sql
--
-- Per-role capability grants, editable by a superadmin at /sis/admin/roles.
--
-- Splits authorization into a fixed vocabulary and editable grants:
--
--   * The VOCABULARY (which capabilities exist) is code —
--     lib/auth/capabilities.ts. A row here naming a capability the code does
--     not gate on is a permission that appears granted and enforces nothing,
--     so the write route validates every `capability` against that module's
--     own list before inserting.
--   * The GRANTS (which role holds which capability) are these rows.
--
-- Why: the six roles are too coarse for two real situations at HFSE. One
-- person validates documents on BOTH sides of enrolment, and a person holds
-- exactly one role; and `school_admin` does two jobs. Both become grant edits
-- instead of code changes.
--
-- ROLES ARE NOT CREATED HERE. `role` is a plain text column, not an FK — the
-- authoritative role list lives in auth.users.raw_app_meta_data (there is no
-- roles table anywhere in this schema) and is mirrored by the `Role` union in
-- lib/auth/roles.ts. A brand-new role would also be invisible to
-- is_registrar_or_above() (migration 092), which hardcodes three role names and
-- is the database's ONLY elevated-read tier. Adding a role stays a code change.
--
-- APPLYING THIS MIGRATION CHANGES NO BEHAVIOUR. The seed below is a
-- transcription of DEFAULT_ROLE_CAPABILITIES in lib/auth/capabilities.ts, which
-- is itself a transcription of the role sets already enforced at each site.
-- A test asserts the two lists match, so they cannot drift.

-- =====================================================================
-- role_permissions
-- =====================================================================

create table if not exists public.role_permissions (
  role        text not null,
  capability  text not null,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  primary key (role, capability)
);

-- The editor and every gate read by role; the audit page reads by capability
-- ("who can validate documents?"), hence the second index.
create index if not exists role_permissions_capability_idx
  on public.role_permissions (capability);

alter table public.role_permissions enable row level security;

drop policy if exists role_permissions_no_select on public.role_permissions;
drop policy if exists role_permissions_no_insert on public.role_permissions;
drop policy if exists role_permissions_no_update on public.role_permissions;
drop policy if exists role_permissions_no_delete on public.role_permissions;

-- Deny-all to the cookie client; every read and write goes through a
-- service-role route. Same posture as approver_assignments (migration 013),
-- the existing precedent for a superadmin-managed grant table.
--
-- Note the SELECT denial matters more here than elsewhere: this table decides
-- authorization, so a client that could read it could enumerate the entire
-- permission model, and a client that could write it could grant itself
-- anything. The write route takes the acting user from the verified session and
-- refuses to edit the superadmin row at all.
create policy role_permissions_no_select
  on public.role_permissions for select
  to authenticated
  using (false);

create policy role_permissions_no_insert
  on public.role_permissions for insert
  to authenticated
  with check (false);

create policy role_permissions_no_update
  on public.role_permissions for update
  to authenticated
  using (false) with check (false);

create policy role_permissions_no_delete
  on public.role_permissions for delete
  to authenticated
  using (false);

-- =====================================================================
-- Seed — today's behaviour, exactly
-- =====================================================================
--
-- Idempotent (`on conflict do nothing`), so re-running is safe and an existing
-- grant a superadmin has since edited is never clobbered back to the default.
--
-- Two entries look wrong and are correct; both are documented at length in
-- lib/auth/capabilities.ts:
--
--   * superadmin does NOT get grade_changes.approve. decide.ts permits only
--     school_admin — a superadmin decides who may approve, and does not
--     approve. Granting it here would be a real privilege change.
--   * academic_coordinator gets documents_post_enrolment.validate WITHOUT
--     .read, and academic_year.edit_terms WITHOUT .read. Both mirror live
--     route-vs-page asymmetries; tidying them here would silently change
--     access.

insert into public.role_permissions (role, capability) values
  -- teacher
  ('teacher', 'sections.read'),

  -- academic_coordinator
  ('academic_coordinator', 'documents_pre_enrolment.read'),
  ('academic_coordinator', 'documents_pre_enrolment.chase'),
  ('academic_coordinator', 'documents_pre_enrolment.validate'),
  ('academic_coordinator', 'documents_post_enrolment.validate'),
  ('academic_coordinator', 'academic_year.edit_terms'),
  ('academic_coordinator', 'school_calendar.read'),
  ('academic_coordinator', 'school_calendar.edit'),
  ('academic_coordinator', 'sections.read'),
  ('academic_coordinator', 'sections.create'),
  ('academic_coordinator', 'sections.edit'),
  ('academic_coordinator', 'sections.delete'),
  ('academic_coordinator', 'staff.read'),
  ('academic_coordinator', 'staff.edit_assignments'),
  ('academic_coordinator', 'grade_changes.read'),

  -- school_admin
  ('school_admin', 'documents_pre_enrolment.read'),
  ('school_admin', 'documents_pre_enrolment.chase'),
  ('school_admin', 'documents_post_enrolment.read'),
  ('school_admin', 'academic_year.read'),
  ('school_admin', 'academic_year.create'),
  ('school_admin', 'academic_year.edit'),
  ('school_admin', 'academic_year.edit_terms'),
  ('school_admin', 'school_calendar.read'),
  ('school_admin', 'school_calendar.edit'),
  ('school_admin', 'sections.read'),
  ('school_admin', 'sections.create'),
  ('school_admin', 'sections.edit'),
  ('school_admin', 'sections.delete'),
  ('school_admin', 'staff.read'),
  ('school_admin', 'staff.view_accounts'),
  ('school_admin', 'staff.edit_assignments'),
  ('school_admin', 'grade_changes.read'),
  ('school_admin', 'grade_changes.approve'),

  -- superadmin
  ('superadmin', 'documents_pre_enrolment.read'),
  ('superadmin', 'documents_pre_enrolment.chase'),
  ('superadmin', 'documents_pre_enrolment.validate'),
  ('superadmin', 'documents_post_enrolment.read'),
  ('superadmin', 'documents_post_enrolment.chase'),
  ('superadmin', 'documents_post_enrolment.upload'),
  ('superadmin', 'documents_post_enrolment.validate'),
  ('superadmin', 'academic_year.read'),
  ('superadmin', 'academic_year.create'),
  ('superadmin', 'academic_year.edit'),
  ('superadmin', 'academic_year.edit_terms'),
  ('superadmin', 'academic_year.delete'),
  ('superadmin', 'school_calendar.read'),
  ('superadmin', 'school_calendar.edit'),
  ('superadmin', 'sections.read'),
  ('superadmin', 'sections.create'),
  ('superadmin', 'sections.edit'),
  ('superadmin', 'sections.delete'),
  ('superadmin', 'staff.read'),
  ('superadmin', 'staff.view_accounts'),
  ('superadmin', 'staff.manage_accounts'),
  ('superadmin', 'staff.edit_assignments'),
  ('superadmin', 'approvers.manage'),
  ('superadmin', 'grade_changes.read'),

  -- p_file_officer
  ('p_file_officer', 'documents_post_enrolment.read'),
  ('p_file_officer', 'documents_post_enrolment.chase'),
  ('p_file_officer', 'documents_post_enrolment.upload'),
  ('p_file_officer', 'documents_post_enrolment.validate'),

  -- admissions
  ('admissions', 'documents_pre_enrolment.read'),
  ('admissions', 'documents_pre_enrolment.chase'),
  ('admissions', 'documents_pre_enrolment.validate')
on conflict (role, capability) do nothing;
