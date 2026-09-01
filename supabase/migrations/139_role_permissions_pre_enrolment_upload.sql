-- 139_role_permissions_pre_enrolment_upload.sql
--
-- Staff can upload a document into an APPLICANT's folder.
--
-- WHY THIS EXISTS. `documents_pre_enrolment` had three actions — read, chase,
-- validate — and no `upload`, because P-Files was enrolled-only (KD #31) and an
-- applicant's files were assumed to arrive from the parent portal. The single
-- upload route therefore asked for `documents_post_enrolment.upload` AND
-- refused anyone who had not enrolled.
--
-- KD #204 (2026-09-01) put applicants on the P-Files list and gave them
-- folders. That turned the assumption into a visible gap: `assessmentResult`
-- ("Assessment Result and Interview") is a document THE SCHOOL PRODUCES and is
-- never offered by the parent portal, so it had no staff path into an
-- applicant's folder at all. The office's only options were to email the file
-- to the parent and ask them to upload it, or to wait for enrolment.
--
-- Mr Ace, asked whether staff should reach every slot for an applicant or only
-- the eight school-produced forms: "yes let them upload everthing".
--
-- WHAT MOVES
--
--   p_file_officer  }
--   school_admin    }  GAIN  documents_pre_enrolment.upload
--   superadmin      }
--
-- NOBODY NEW CAN UPLOAD ANYTHING. These are exactly the three roles that
-- already hold `documents_post_enrolment.upload` (101 + 106), so the holder set
-- for `upload` is now identical on both sides of enrolment. What changes is
-- WHICH STUDENTS they can upload for, not who they are.
--
-- `admissions` is deliberately NOT granted, though it owns the applicant side
-- and the case for it is real. There is nowhere for them to use it: the only
-- upload surface is the P-Files student page, `/p-files` excludes them at
-- ROUTE_ACCESS, and the applicant file's DocumentsViewer has no upload path.
-- A grant here would be a ticked box wired to no gate. Build them a control
-- first; the grant is then a data edit at /sis/admin/roles, not a migration.
--
-- KD #147's Lock #2 is NOT reversed. The document axis still belongs to
-- Admissions before enrolment and P-Files after; the route still picks its
-- capability from the student's enrolment state, exactly as the document PATCH
-- picks between the two `validate`s. All that changed is that the
-- pre-enrolment side now HAS an upload capability to be picked.
--
-- Idempotent.

insert into public.role_permissions (role, capability) values
  ('p_file_officer', 'documents_pre_enrolment.upload'),
  ('school_admin', 'documents_pre_enrolment.upload'),
  ('superadmin', 'documents_pre_enrolment.upload')
on conflict (role, capability) do nothing;
