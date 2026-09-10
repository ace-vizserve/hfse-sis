-- 143_admissions_absorbs_p_file_officer.sql
--
-- Retires the P-Files Officer role by moving its permissions onto admissions.
--
-- WHY. Exactly one account held `p_file_officer` (louilyn.gutierrez@), and the
-- job it describes — chase a parent for a passport, approve what arrives,
-- upload a replacement — is the same job admissions already does on the
-- applicant side. Two roles for one lifecycle meant every document rule had to
-- be written twice and kept in step; migration 106 is the record of them
-- drifting apart and being pushed back together.
--
-- WHAT MOVES
--
--   admissions      GAINS  documents_pre_enrolment.upload
--                          documents_post_enrolment.read / chase / upload / validate
--                          (it already held pre_enrolment read / chase / validate)
--
--   p_file_officer  LOSES  all eight. The role keeps existing as a STRING in
--                          audit_log.actor_role on historical rows — this
--                          migration does not touch those and must not.
--
-- ⚠ ORDER OF OPERATIONS. Every account holding `p_file_officer` must be moved
-- to `admissions` BEFORE the application code drops the role (the commit that
-- edits lib/auth/roles.ts). An account whose role no longer resolves is read by
-- this app as a PARENT. Running this migration alone is safe and reversible —
-- it only changes what the role MAY do, not who holds it.
--
-- Idempotent: inserts skip conflicts, the delete is unconditional on absence.

-- ── Grants added ────────────────────────────────────────────────────────────
insert into public.role_permissions (role, capability) values
  ('admissions', 'documents_pre_enrolment.upload'),
  ('admissions', 'documents_post_enrolment.read'),
  ('admissions', 'documents_post_enrolment.chase'),
  ('admissions', 'documents_post_enrolment.upload'),
  ('admissions', 'documents_post_enrolment.validate')
on conflict (role, capability) do nothing;

-- ── Grants removed ──────────────────────────────────────────────────────────
delete from public.role_permissions where role = 'p_file_officer';
