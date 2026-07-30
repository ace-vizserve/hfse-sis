-- 106_role_permissions_document_reassignment.sql
--
-- Writes into the seed what production already does: document validation was
-- moved off the academic coordinator and onto the P-Files officer and
-- school_admin.
--
-- THIS MIGRATION MOSTLY DOCUMENTS REALITY. The reassignment was made directly
-- in `role_permissions` (via /sis/admin/roles or a script) some time before
-- 2026-07-31, when `scripts/audit-role-permissions.ts` compared the live table
-- against DEFAULT_ROLE_CAPABILITIES and found 7 live grants declared in no
-- file and 5 declared grants not actually in force. Mr Ace confirmed the swap
-- was intentional, so the CODE was the thing out of date — not the database.
-- Running this against production is therefore close to a no-op; running it
-- against a fresh database reproduces the same state.
--
-- It is the first migration in this series to DELETE grants. 101 and 102 were
-- transcriptions and 105 was purely additive; codifying a reassignment needs
-- both halves, or a rebuilt database would silently restore capabilities that
-- were deliberately taken away.
--
-- WHAT MOVES
--
--   academic_coordinator  LOSES  documents_pre_enrolment.read / chase / validate
--                                documents_post_enrolment.validate
--                                (she now holds no document capability at all)
--
--   p_file_officer        GAINS  documents_pre_enrolment.read / chase / validate
--                                — the "one person validates both sides of
--                                enrolment" case the capability layer was built
--                                for (KD #166). No route change needed:
--                                /p-files/document-validation is already the
--                                unified queue and loads the applicant rows for
--                                anyone holding documents_pre_enrolment.read.
--                                `/admissions` still excludes them at
--                                ROUTE_ACCESS on purpose — this grants the WORK,
--                                not the Admissions module.
--
--   school_admin          GAINS  documents_pre_enrolment.validate
--                                documents_post_enrolment.chase / upload / validate
--                                — she was read-and-chase only, while the queue
--                                rendered Approve/Reject buttons that then 403'd
--                                (KD #74 + KD #31). This resolves that by making
--                                the buttons work.
--
-- ALSO RESTORED: academic_coordinator's `academic_year.edit_terms`, which the
-- audit found missing from the live table. Almost certainly collateral from the
-- same edit rather than a decision — nothing else would explain granting her
-- academic_year read/create/edit (migration 105) while removing her ability to
-- set term dates, which is the part of AY Setup she actually needs. Confirmed
-- with Mr Ace before restoring.
--
-- KD #147's Lock #2 is NOT reversed. Documents still belong to Admissions
-- before enrolment and P-Files after, and the route still picks its capability
-- from the student's enrolment state. All that changed is who holds each side.
--
-- Idempotent: inserts skip conflicts, deletes are unconditional on absence.

-- ── Grants added ────────────────────────────────────────────────────────────
insert into public.role_permissions (role, capability) values
  ('p_file_officer', 'documents_pre_enrolment.read'),
  ('p_file_officer', 'documents_pre_enrolment.chase'),
  ('p_file_officer', 'documents_pre_enrolment.validate'),

  ('school_admin', 'documents_pre_enrolment.validate'),
  ('school_admin', 'documents_post_enrolment.chase'),
  ('school_admin', 'documents_post_enrolment.upload'),
  ('school_admin', 'documents_post_enrolment.validate'),

  ('academic_coordinator', 'academic_year.edit_terms')
on conflict (role, capability) do nothing;

-- ── Grants removed ──────────────────────────────────────────────────────────
delete from public.role_permissions where (role, capability) in (
  ('academic_coordinator', 'documents_pre_enrolment.read'),
  ('academic_coordinator', 'documents_pre_enrolment.chase'),
  ('academic_coordinator', 'documents_pre_enrolment.validate'),
  ('academic_coordinator', 'documents_post_enrolment.validate')
);
