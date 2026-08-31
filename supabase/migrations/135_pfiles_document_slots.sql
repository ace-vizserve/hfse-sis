-- 135_pfiles_document_slots.sql
--
-- Adds eight new document slots to every ay{YYYY}_enrolment_documents table,
-- so eight more forms the school already collects on paper can be kept on a
-- student's P-File:
--
--   lastSchoolRecommendation  Last School Recommendation and Good Moral
--   assessmentResult          Assessment Result and Interview
--   signedContract            Signed Student Contract
--   newStudentChecksheet      New Student Checksheet
--   pfilesChecklist           Student P-Files Checklist
--   preCounsellingAck         Pre-Counselling Acknowledgement Form
--   conditionalEnrolment      Conditional Enrolment
--   lateEnrolmentForm         Late Enrolment Form
--
-- WHERE THE LIST CAME FROM
--
-- A document list relayed on 2026-08-25, answering items #5 and #11 of the
-- first admin training session (the "what else should a P-File hold" asks).
--
-- THE SENDER OF THAT LIST IS NOT CONFIRMED. Do not attribute it to a named
-- person anywhere in the repo, and do not quote it back to anyone at the
-- school as their own words until somebody has said so. The list itself is
-- plainly a real school artefact -- every line names a form that already
-- exists on paper -- but who sent it is an open question.
--
-- WHY ONLY EIGHT, WHEN THE LIST HAS FOURTEEN LINES
--
-- Of the fourteen lines, only eight name something this system does not
-- already hold. The others were already covered:
--
--   * form12  -- an existing slot since the original 13 (KD #96).
--   * medical -- likewise.
--   * the passport and pass RENEWALS -- these are not new documents at all,
--     they are the existing expiring-slot lifecycle: passport / pass /
--     motherPass* / fatherPass* / guardianPass* each carry a {key}Expiry
--     column, and "renewal" is what the auto-freshen job and the chase queue
--     already do when that date passes (KD #60). Adding a "renewal" slot
--     beside them would create a second, disagreeing record of the same fact.
--   * the signed contract -- named in BOTH halves of the list, so it is one
--     document, counted once, and it is in the eight above as signedContract.
--
-- NO EXPIRY COLUMN FOR ANY OF THE EIGHT
--
-- Each slot is exactly TWO columns, not three:
--
--   "{key}"        text              -- the file URL
--   "{key}Status"  character varying -- the status string
--
-- There is deliberately NO "{key}Expiry". None of these eight expire. They
-- are one-off forms signed or issued once and then true forever: a school
-- recommendation, an interview result, a signed contract, a checklist. That
-- is the whole difference between them and the passports and passes, which
-- are the only documents in this system with a validity window.
--
-- This matters beyond the column count, because the expiry column is what
-- drives behaviour: lib/p-files/document-config.ts's `expires` flag, the
-- Valid -> Expired auto-flip, and the chase queue's urgency sort all key off
-- it. A slot with no expiry column simply never enters that lifecycle. It
-- reads Missing until somebody uploads it, then Uploaded, then Valid, and
-- stays Valid. If one of these eight ever does turn out to expire, that is a
-- new migration adding a third column, not a value written into a column
-- that isn't there.
--
-- THE LAST TWO ARE SHOWN ONLY TO THE STUDENTS THEY APPLY TO
--
-- conditionalEnrolment and lateEnrolmentForm are not asked of everybody --
-- a conditional enrolment form only exists for a student enrolled
-- conditionally, and a late enrolment form only for a student who joined
-- after the term started. But that rule lives in TypeScript, in
-- lib/p-files/document-config.ts (the `conditional` field on a slot, which
-- is how fatherEmail / guardianEmail already gate the parent slots), NOT in
-- this migration.
--
-- THE COLUMNS EXIST FOR EVERY STUDENT EITHER WAY. That is deliberate and it
-- is the same shape the existing conditional slots use: the database holds a
-- column per slot on every row, and the application decides whether to ask
-- for it. A per-student column set is not a thing Postgres has, and making
-- the columns conditional would mean the P-Files reader could not select a
-- fixed column list.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
--   * It does not make anything required. Every new column is nullable with
--     no default, so every existing row reads exactly as it did before, and
--     nothing in the app asks for these documents until the TypeScript half
--     (DOCUMENT_SLOTS) lists them. Applying this migration on its own is
--     invisible to every user.
--   * It does not extend capture_doc_revision_trigger. That trigger's slot
--     list is a hardcoded array of the original 16 URL columns inside
--     attach_doc_revision_trigger (033), so re-uploads of these eight will
--     not write p_file_revisions rows (KD #63). That is a separate decision
--     about whether these one-off forms want revision history at all, and it
--     is not made here. Noting it so it is not discovered as a surprise.
--   * It does not touch the frozen parent-portal DDL contract beyond adding
--     columns. docs/context/10a-parent-portal-ddl.md is the ground truth for
--     these tables and should be updated when the TypeScript half ships.
--
-- WHAT WAS VERIFIED BEFORE WRITING THIS
--
--   * The column convention was READ, not guessed. In the create_ay_admissions
--     _tables body (and in 10a-parent-portal-ddl.md's live copy of
--     ay2026_enrolment_documents), every slot is `{key} text null` plus
--     `"{key}Status" character varying null`. The status column is character
--     varying, NOT text. Both are copied exactly.
--   * Identifiers are camelCase and are emitted through format's %I, which
--     quote_ident's them. Unquoted, Postgres folds them to lowercase and you
--     silently create "lastschoolrecommendation" -- a column nothing reads,
--     with no error at any point.
--   * 132 is the CURRENT definition of create_ay_admissions_tables, not 012
--     and not 099. "create or replace function public.create_ay_admissions
--     _tables" appears in 012, 025, 026, 033, 050, 067, 069, 075, 076, 087,
--     099 and 132, and nothing after 132 touches it (133 is the audit-actor
--     RPC, 134 is attendance). Editing an older copy would revert twelve
--     migrations of column work.
--   * The AY slug is four digits (ay2025 / ay2026 / ay2027) and has been
--     since migration 026. 025's pg_tables walk still matches the pre-026
--     two-digit "ay26" form, so copying that walk matches ZERO tables and
--     reports success. The backfill below walks academic_years the way 098
--     and 132 do.
--
-- WHY A HELPER PLUS ONE LINE, RATHER THAN AN INLINE RE-EMIT
--
-- Re-emitting create_ay_admissions_tables from a stale or retyped body has
-- already caused a real five-migration regression in this repo: 099's header
-- records the doc-revision trigger being "silently dropped by migration 050's
-- re-emit and stayed dropped through 067/069/075/076" (KD #119). 098/099/132
-- answered that with a pattern -- an idempotent attach_*(slug) helper
-- carrying all the DDL, a backfill for the AYs that already exist, and
-- exactly ONE new line inside the RPC -- so the risky edit is a single
-- addition that a diff can prove. This migration follows it exactly.
--
-- So the function body below was NOT retyped from memory or reconstructed
-- from an older migration. It was extracted from 132 to a scratch file, md5
-- recorded, edited in place, and diffed back. The function body shows exactly
-- ONE hunk: an ADDITION of 10 lines (1 blank, 8 comment, 1 perform), with
-- zero deletions and zero modifications. The only other change in the whole
-- region is the trailing "comment on function" string gaining a mention of
-- 135 -- one line replaced by one line, and the reason it is a modification
-- rather than an addition. Everything 087/099/132 established is
-- therefore still here: stpApplicationType/Status, preferredPaymentScheme
-- /Method, marketingReferrerName, applicationTerminalReason/Notes,
-- write-once enrolledAt, residenceHistory, RLS + the canonical policy loop,
-- and all four existing attach_* calls (attach_doc_revision_trigger,
-- attach_enrolment_status_touch_trigger, attach_discount_code_unique,
-- attach_enrolment_indexes).
--
-- If you ever need to edit this function again: extract, add, diff. Do not
-- retype it, and do not start from an older migration's copy.
--
-- 132 already validates the slug shape ('^ay[0-9]{4}$') before emitting any
-- DDL, so the helper does not re-check it.
--
-- Idempotent throughout and safe to re-run whole: the helper uses "add column
-- if not exists" and returns early on a missing table, the backfill is a
-- plain walk, and the rest of the function is unchanged from what production
-- already runs.
--
-- Apply after 134.

-- ─── The helper: idempotent, safe to call repeatedly ────────────────────────
create or replace function public.attach_document_slots(p_ay_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_documents text := p_ay_slug || '_enrolment_documents';
  v_slot text;
  -- The eight new slots, keyed exactly as lib/p-files/document-config.ts
  -- will key them. Each one becomes two columns: "{key}" for the file URL
  -- and "{key}Status" for the status string. No expiry column -- none of
  -- these eight expire; see the header.
  v_slots text[] := array[
    'lastSchoolRecommendation',  -- Last School Recommendation and Good Moral
    'assessmentResult',          -- Assessment Result and Interview
    'signedContract',            -- Signed Student Contract
    'newStudentChecksheet',      -- New Student Checksheet
    'pfilesChecklist',           -- Student P-Files Checklist
    'preCounsellingAck',         -- Pre-Counselling Acknowledgement Form
    'conditionalEnrolment',      -- Conditional Enrolment
    'lateEnrolmentForm'          -- Late Enrolment Form
  ];
begin
  if to_regclass(format('public.%I', v_documents)) is null then
    return;  -- no such AY documents table; nothing to attach
  end if;

  foreach v_slot in array v_slots loop
    -- The file URL. `text`, matching every existing slot's URL column.
    execute format(
      'alter table public.%I add column if not exists %I text',
      v_documents,
      v_slot
    );

    -- The status string. `character varying`, matching every existing
    -- slot's status column -- this really is varchar and not text in the
    -- live DDL, and the two are copied as found rather than normalised.
    execute format(
      'alter table public.%I add column if not exists %I character varying',
      v_documents,
      v_slot || 'Status'
    );
  end loop;
end;
$$;

comment on function public.attach_document_slots(text) is
  'Add the eight non-expiring P-Files document slots to ay{YYYY}_enrolment_documents: lastSchoolRecommendation, assessmentResult, signedContract, newStudentChecksheet, pfilesChecklist, preCounsellingAck, conditionalEnrolment, lateEnrolmentForm. Two columns each ("{key}" text + "{key}Status" character varying); no expiry column, because none of these eight expire. Idempotent. Called automatically by create_ay_admissions_tables since migration 135, so new AYs get them without intervention; call directly only to heal an existing table set.';

-- ─── Heal every AY table set that already exists ────────────────────────────
-- Walks academic_years, NOT pg_tables. 025's pg_tables walk still matches the
-- pre-026 two-digit slug ('ay26'), so reusing it would match zero tables and
-- report success. This is 098's walk verbatim, as used by 132.
do $$
declare
  v_ay record;
begin
  for v_ay in
    select 'ay' || substring(ay_code from 3) as slug
    from academic_years
  loop
    perform public.attach_document_slots(v_ay.slug);
  end loop;
end;
$$;

revoke all on function public.attach_document_slots(text) from public;
grant execute on function public.attach_document_slots(text) to service_role;

-- ─── Wire it in, so every future AY gets the slots for free ─────────────────
-- Body below copied byte-for-byte from 132. One hunk added, nothing else.

create or replace function public.create_ay_admissions_tables(p_ay_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text := lower(trim(p_ay_slug));
  v_table text;
  v_tables text[] := array[
    'enrolment_applications',
    'enrolment_status',
    'enrolment_documents',
    'discount_codes'
  ];
begin
  if v_slug !~ '^ay[0-9]{4}$' then
    raise exception 'Invalid AY slug: %. Expected format like "ay2027".', p_ay_slug;
  end if;

  -- ay{YYYY}_enrolment_applications — migration 076 verbatim, unchanged.
  execute format($ddl$
    create table if not exists public.%I (
      id bigint generated by default as identity not null,
      created_at timestamp with time zone null default (now() at time zone 'Asia/Singapore'::text),
      category character varying null,
      "enroleeNumber" text null,
      "studentNumber" text null,
      "enroleeFullName" text null,
      "lastName" text null,
      "firstName" text null,
      "middleName" text null,
      "preferredName" text null,
      "levelApplied" text null,
      "classType" text null,
      "preferredSchedule" text null,
      "birthDay" date null,
      gender text null,
      "passportNumber" text null,
      "passportExpiry" date null,
      nationality text null,
      religion text null,
      "religionOther" text null,
      nric text null,
      pass text null,
      "passExpiry" date null,
      "homeAddress" text null,
      "postalCode" bigint null,
      "homePhone" bigint null,
      "contactPerson" text null,
      "contactPersonNumber" bigint null,
      "primaryLanguage" text null,
      "parentMaritalStatus" text null,
      "livingWithWhom" text null,
      "fatherFullName" text null, "fatherLastName" text null, "fatherFirstName" text null,
      "fatherMiddleName" text null, "fatherPreferredName" text null, "fatherBirthDay" date null,
      "fatherPassport" text null, "fatherPassportExpiry" date null, "fatherNric" text null,
      "fatherPass" text null, "fatherPassExpiry" date null, "fatherCompanyName" text null,
      "fatherPosition" text null, "fatherNationality" text null, "fatherReligion" text null,
      "fatherMobile" bigint null, "fatherEmail" text null, "fatherMarital" text null,
      "motherFullName" text null, "motherLastName" text null, "motherFirstName" text null,
      "motherMiddleName" text null, "motherPreferredName" text null, "motherBirthDay" date null,
      "motherPassport" text null, "motherPassportExpiry" date null, "motherNric" text null,
      "motherPass" text null, "motherPassExpiry" date null, "motherCompanyName" text null,
      "motherPosition" text null, "motherNationality" text null, "motherReligion" text null,
      "motherMobile" bigint null, "motherEmail" text null, "motherMarital" text null,
      "guardianFullName" text null, "guardianLastName" text null, "guardianFirstName" text null,
      "guardianMiddleName" text null, "guardianPreferredName" text null, "guardianBirthDay" date null,
      "guardianPassport" text null, "guardianPassportExpiry" date null, "guardianNric" text null,
      "guardianPass" text null, "guardianPassExpiry" date null, "guardianCompanyName" text null,
      "guardianPosition" text null, "guardianNationality" text null, "guardianReligion" text null,
      "guardianMobile" bigint null, "guardianEmail" text null,
      "siblingFullName1" text null, "siblingBirthDay1" date null, "siblingReligion1" text null,
      "siblingEducationOccupation1" text null, "siblingSchoolCompany1" text null,
      "siblingFullName2" text null, "siblingBirthDay2" date null, "siblingReligion2" text null,
      "siblingEducationOccupation2" text null, "siblingSchoolCompany2" text null,
      "siblingFullName3" text null, "siblingBirthDay3" date null, "siblingReligion3" text null,
      "siblingEducationOccupation3" text null, "siblingSchoolCompany3" text null,
      "siblingFullName4" text null, "siblingBirthDay4" date null, "siblingReligion4" text null,
      "siblingEducationOccupation4" text null, "siblingSchoolCompany4" text null,
      "siblingFullName5" text null, "siblingBirthDay5" date null, "siblingReligion5" text null,
      "siblingEducationOccupation5" text null, "siblingSchoolCompany5" text null,
      "availSchoolBus" text null, "availUniform" text null, "availStudentCare" text null,
      "additionalLearningNeeds" text null, "previousSchool" text null,
      "documentsStatus" text null, "registrationInvoice" text null,
      "registrationInvoiceDate" date null, "assessmentDate" date null,
      "assessmentStatus" text null, "startDate" text null,
      "enrollmentInvoice" text null, "enrollmentInvoiceDate" date null,
      "acctsRemarks" text null, "enroleePhoto" text null, "creatorUid" text null,
      "howDidYouKnowAboutHFSEIS" text null, "otherSource" text null,
      "applicationStatus" text null,
      "fatherReligionOther" text null, "motherReligionOther" text null, "guardianReligionOther" text null,
      "passCodeStudent" text null,
      discount1 text null, discount2 text null, discount3 text null,
      "referrerName" text null, "paymentOption" text null, "referrerMobile" text null,
      "marketingReferrerName" text null,
      "preferredPaymentScheme" text null, "preferredPaymentMethod" text null,
      "contractSignatory" text null, "vizSchoolProgram" text null,
      "feedbackRating" smallint null, "feedbackComments" text null,
      "feedbackConsent" boolean null, "feedbackSubmittedAt" timestamp without time zone null,
      "preCourseAnswer" text null, "preCourseDate" timestamp without time zone null,
      "preCourseAcknowledgedAt" timestamp without time zone null,
      "stpApplicationType" text null,
      "stpApplicationStatus" text null,
      allergies boolean null, "allergyDetails" text null, asthma boolean null,
      "foodAllergies" boolean null, "foodAllergyDetails" text null,
      "heartConditions" boolean null, epilepsy boolean null, diabetes boolean null, eczema boolean null,
      "otherMedicalConditions" text null, "paracetamolConsent" boolean null,
      "otherLearningNeeds" text null, "studentCareProgram" text null,
      "socialMediaConsent" boolean null,
      "guardianWhatsappTeamsConsent" boolean null,
      "fatherWhatsappTeamsConsent" boolean null,
      "motherWhatsappTeamsConsent" boolean null,
      "residenceHistory" jsonb null,
      "dietaryRestrictions" text null,
      constraint %I primary key (id),
      constraint %I check (
        "stpApplicationStatus" is null
        or "stpApplicationStatus" in ('Pending', 'Submitted', 'Approved', 'Rejected')
      )
    );
  $ddl$,
    v_slug || '_enrolment_applications',
    v_slug || '_enrolment_applications_pkey',
    v_slug || '_enrolment_applications_stpapp_status_chk');

  -- ay{YYYY}_enrolment_status — migration 076 verbatim, unchanged.
  execute format($ddl$
    create table if not exists public.%I (
      id bigint generated by default as identity not null,
      created_at timestamp with time zone not null default now(),
      "enroleeNumber" text null,
      "enrolmentDate" date null,
      "enroleeName" text null,
      "applicationStatus" character varying null,
      "applicationRemarks" text null,
      "applicationUpdatedDate" date null,
      "applicationUpdatedBy" text null,
      "registrationStatus" character varying null,
      "registrationInvoice" text null,
      "registrationPaymentDate" date null,
      "registrationRemarks" text null,
      "registrationUpdateDate" date null,
      "registrationUpdatedby" text null,
      "documentStatus" character varying null,
      "documentRemarks" text null,
      "documentUpdatedDate" date null,
      "documentUpdatedby" text null,
      "assessmentStatus" character varying null,
      "assessmentSchedule" date null,
      "assessmentGradeMath" text null,
      "assessmentGradeEnglish" text null,
      "assessmentRemarks" text null,
      "assessmentMedical" text null,
      "assessmentUpdatedDate" date null,
      "assessmentUpdatedby" text null,
      "contractStatus" character varying null,
      "contractRemarks" text null,
      "contractUpdatedDate" date null,
      "contractUpdatedby" text null,
      "feeStatus" character varying null,
      "feeInvoice" text null,
      "feePaymentDate" date null,
      "feeStartDate" date null,
      "feeRemarks" text null,
      "feeUpdatedDate" date null,
      "feeUpdatedby" text null,
      "classStatus" character varying null,
      "classAY" character varying null,
      "classLevel" character varying null,
      "classSection" character varying null,
      "classRemarks" text null,
      "classUpdatedDate" date null,
      "classUpdatedby" text null,
      "suppliesStatus" character varying null,
      "suppliesClaimedDate" date null,
      "suppliesRemarks" text null,
      "suppliesUpdatedDate" date null,
      "suppliesUpdatedby" text null,
      "orientationStatus" character varying null,
      "orientationScheduleDate" date null,
      "orientationRemarks" text null,
      "orientationUpdatedDate" date null,
      "orientationUpdateby" text null,
      "enroleeType" character varying null,
      "levelApplied" text null,
      "applicationTerminalReason" text null,
      "applicationTerminalNotes"  text null,
      "enrolledAt" timestamptz null,
      constraint %I primary key (id)
    );
  $ddl$, v_slug || '_enrolment_status', v_slug || '_enrolment_status_pkey');

  -- ay{YYYY}_enrolment_documents — migration 076 verbatim, unchanged.
  execute format($ddl$
    create table if not exists public.%I (
      id bigint generated by default as identity not null,
      created_at timestamp with time zone null default (now() at time zone 'Asia/Singapore'::text),
      "studentNumber" text null,
      "enroleeNumber" text null,
      form12 text null, "form12Status" character varying null,
      medical text null, "medicalStatus" character varying null,
      passport text null, "passportStatus" character varying null, "passportExpiry" date null,
      "birthCert" text null, "birthCertStatus" character varying null,
      pass text null, "passStatus" character varying null, "passExpiry" date null,
      "educCert" text null, "educCertStatus" character varying null,
      "motherPassport" text null, "motherPassportStatus" character varying null, "motherPassportExpiry" date null,
      "motherPass" text null, "motherPassStatus" character varying null, "motherPassExpiry" date null,
      "fatherPassport" text null, "fatherPassportStatus" character varying null, "fatherPassportExpiry" date null,
      "fatherPass" text null, "fatherPassStatus" character varying null, "fatherPassExpiry" date null,
      "guardianPassport" text null, "guardianPassportStatus" character varying null, "guardianPassportExpiry" date null,
      "guardianPass" text null, "guardianPassStatus" character varying null, "guardianPassExpiry" date null,
      "idPicture" text null, "idPictureStatus" character varying null, "idPictureUploadedDate" date null,
      "uploadFormDocument" uuid null,
      "icaPhoto" text null, "icaPhotoStatus" character varying null,
      "financialSupportDocs" text null, "financialSupportDocsStatus" character varying null,
      "vaccinationInformation" text null, "vaccinationInformationStatus" character varying null,
      constraint %I primary key (id)
    );
  $ddl$, v_slug || '_enrolment_documents', v_slug || '_enrolment_documents_pkey');

  -- ay{YYYY}_discount_codes — migration 076 verbatim, unchanged.
  execute format($ddl$
    create table if not exists public.%I (
      id bigint generated by default as identity not null,
      created_at timestamp with time zone not null default now(),
      "discountCode" text null,
      "startDate" date null,
      "endDate" date null,
      details text null,
      "enroleeType" character varying null,
      constraint %I primary key (id)
    );
  $ddl$, v_slug || '_discount_codes', v_slug || '_discount_codes_pkey');

  -- Enable RLS + canonical permissive policy on each table (076 verbatim).
  foreach v_table in array v_tables loop
    execute format(
      'alter table public.%I enable row level security',
      v_slug || '_' || v_table
    );

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = v_slug || '_' || v_table
        and policyname = 'Policy with security definer functions'
    ) then
      execute format($pol$
        create policy "Policy with security definer functions"
        on public.%I
        for all
        to public
        using (true)
        with check (true);
      $pol$, v_slug || '_' || v_table);
    end if;
  end loop;

  -- Attach the doc-revision trigger (migration 033) — RESTORED here after
  -- being silently dropped by migration 050's re-emit and staying dropped
  -- through 067/069/075/076 (KD #119-class regression, found 2026-07-17
  -- while building this migration). See the healing loop in section 4
  -- above for tables created during the gap.
  perform public.attach_doc_revision_trigger(v_slug || '_enrolment_documents');

  -- Attach the new touch-tracking trigger (this migration, KD #149
  -- follow-up) so every future AY auto-stamps applicationUpdatedDate +
  -- the 8 per-stage UpdatedDate columns instead of relying on the ad-hoc
  -- app-code stamps that only ever covered 2 of ~9 write paths.
  perform public.attach_enrolment_status_touch_trigger(v_slug || '_enrolment_status');

  -- Attach the discount-code uniqueness index (migration 098). Without this
  -- line a newly created AY's ay{YY}_discount_codes table starts with no
  -- unique constraint on "discountCode", so a double-clicked "Add discount
  -- code" creates two identical rows - the exact defect 098 fixed for the
  -- AYs that already existed. The helper is idempotent, so re-running
  -- create_ay_admissions_tables on an existing AY is safe.
  perform public.attach_discount_code_unique(v_slug);

  -- Attach the five enrolment lookup indexes (migration 132). Without this
  -- line a newly created AY's three enrolment tables start with no index
  -- beyond the id primary key, on the columns the whole app joins them by -
  -- the gap 11-performance-patterns.md section 10 recorded on 2026-07-08.
  -- The helper is idempotent, so re-running create_ay_admissions_tables on an
  -- existing AY is safe.
  perform public.attach_enrolment_indexes(v_slug);

  -- Attach the eight non-expiring P-Files document slots (migration 135).
  -- Without this line a newly created AY's documents table starts with only
  -- the original slot columns, so the school recommendation, assessment
  -- result, signed contract, checksheets, pre-counselling acknowledgement,
  -- conditional enrolment and late enrolment form have nowhere to be stored
  -- for that AY - and P-Files would read them as permanently Missing with no
  -- error. The helper is idempotent, so re-running create_ay_admissions
  -- _tables on an existing AY is safe.
  perform public.attach_document_slots(v_slug);
end;
$$;

revoke all on function public.create_ay_admissions_tables(text) from public;
grant execute on function public.create_ay_admissions_tables(text) to service_role;

comment on function public.create_ay_admissions_tables is
  'Creates the 4-table admissions set for a new AY. Applications carries stpApplicationType (026) + stpApplicationStatus (050, restored 069) + preferredPaymentScheme/preferredPaymentMethod/marketingReferrerName (076); status carries applicationTerminalReason/Notes (067) + write-once enrolledAt (075). Attaches capture_doc_revision_trigger (033, KD #63, restored 087 after being dropped by 050) + stamp_enrolment_status_touch_trigger (087, KD #149 follow-up) + attach_discount_code_unique (098, wired in 099) + attach_enrolment_indexes (132) + attach_document_slots (135). KD #61/#96/#111/#119.';
