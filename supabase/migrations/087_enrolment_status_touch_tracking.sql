-- 087_enrolment_status_touch_tracking.sql
--
-- ay{YYYY}_enrolment_status carries 8 "*UpdatedDate"-family columns
-- (applicationUpdatedDate + 7 per-stage siblings: registrationUpdateDate,
-- documentUpdatedDate, assessmentUpdatedDate, contractUpdatedDate,
-- feeUpdatedDate, classUpdatedDate, suppliesUpdatedDate,
-- orientationUpdatedDate) that were meant to track when each part of an
-- application was last edited. None of them are DB-maintained — they only
-- get set at a couple of ad-hoc app-code call sites (section-students
-- withdrawal/re-enrol route). In production, applicationUpdatedDate is
-- 0/490 populated (docs/data-capture-gaps.md), so:
--   (a) the admissions "needs follow-up" staleness feature (KD #149) falls
--       back to created_at (app-age, not edit-age) — lib/admissions/
--       dashboard.ts loadJoinedRowsUncached — while the applications-table
--       Staleness column reads the raw (always-null) column directly, so
--       the dashboard count and its own drill-through disagree; and
--   (b) the "stage-level funnel drop-off" insight never lights up
--       (data-capture-gaps.md gap #1) because nothing stamps the 6 stage
--       timestamps regardless of which UI path changed the stage.
--
-- This migration makes both honest going forward with a single BEFORE
-- UPDATE trigger, mirroring the existing capture_doc_revision_trigger
-- pattern (migration 033, KD #63) already running on
-- ay{YYYY}_enrolment_documents. It does NOT touch the "*Updatedby" (who)
-- columns — those aren't consumed anywhere in the codebase today (only the
-- Date columns feed staleness.ts / the funnel), and these tables are
-- written almost exclusively via the service-role client (no reliable
-- per-request actor identity available inside a DB trigger). Attribution
-- stays app-code's job; scope here is strictly the Date columns.
--
-- SEPARATE REGRESSION FOUND + FIXED IN THE SAME MIGRATION: migration 050's
-- re-emit of create_ay_admissions_tables (the very next one after 033)
-- silently dropped the trailing `perform
-- public.attach_doc_revision_trigger(...)` call that 033 had added — and
-- it stayed dropped through 067, 069, 075, and 076. This is the exact
-- hazard KD #119 already documents ("create or replace function re-emitted
-- from a stale body silently drops every column/clause added by later
-- migrations") — it happened again anyway. Practical effect: any AY whose
-- 4 admissions tables were created via this RPC after migration 050 was
-- applied never got the parent-portal re-upload tracking trigger attached,
-- so those re-uploads silently bypass p_file_revisions (KD #63) with no
-- error. This migration restores the call AND re-runs
-- attach_doc_revision_trigger over every existing ay*_enrolment_documents
-- table (idempotent — drops + recreates the trigger, harmless on tables
-- that already had it) so any AY created in that window self-heals.
--
-- Idempotent + safe to re-run (CREATE OR REPLACE, DROP TRIGGER IF EXISTS).
-- Apply after 086.
--
-- DEPLOY ORDERING: lib/admissions/dashboard.ts's next commit removes the
-- `?? a.created_at` staleness fallback (Task 2 of the same plan) — that
-- code MUST NOT ship before this migration is applied, or every
-- application's staleness silently reads "Never updated" with nothing to
-- fall back to until the trigger is live. Same ordering rule as KD #144/#119.

-- =====================================================================
-- 1. Trigger function — stamp_enrolment_status_touch
-- =====================================================================
--
-- BEFORE UPDATE FOR EACH ROW. Mutates NEW directly (no secondary UPDATE,
-- so no recursion guard needed — this is the standard self-mutating
-- trigger shape, distinct from capture_doc_revision's AFTER UPDATE +
-- separate-table INSERT).

create or replace function public.stamp_enrolment_status_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Columns excluded from the general "was this row touched" diff: primary
  -- key, creation timestamp, and every one of the 8 stage-metadata pairs
  -- this trigger itself writes (excluding them prevents the diff from
  -- treating our own stamps as "new user content" on a future update).
  v_excluded text[] := array[
    'id','created_at',
    'applicationUpdatedDate','applicationUpdatedBy',
    'registrationUpdateDate','registrationUpdatedby',
    'documentUpdatedDate','documentUpdatedby',
    'assessmentUpdatedDate','assessmentUpdatedby',
    'contractUpdatedDate','contractUpdatedby',
    'feeUpdatedDate','feeUpdatedby',
    'classUpdatedDate','classUpdatedby',
    'suppliesUpdatedDate','suppliesUpdatedby',
    'orientationUpdatedDate','orientationUpdateby'
  ];
  v_today date := current_date;
begin
  -- General "row touched" signal (feeds staleness, KD #149). Any real
  -- content column changed — applicationStatus/applicationRemarks,
  -- any stage's status/remarks/data fields, applicationTerminalReason/
  -- Notes, enrolledAt, everything except the excluded metadata above.
  if (to_jsonb(NEW) - v_excluded) is distinct from (to_jsonb(OLD) - v_excluded) then
    NEW."applicationUpdatedDate" := v_today;
  end if;

  -- Per-stage signals (feeds the stage-level funnel drop-off insight,
  -- data-capture-gaps.md gap #1). Fires regardless of which UI path
  -- changed the column — a bulk status edit counts the same as a
  -- per-stage form save.
  if NEW."registrationStatus" is distinct from OLD."registrationStatus"
     or NEW."registrationInvoice" is distinct from OLD."registrationInvoice"
     or NEW."registrationPaymentDate" is distinct from OLD."registrationPaymentDate"
     or NEW."registrationRemarks" is distinct from OLD."registrationRemarks" then
    NEW."registrationUpdateDate" := v_today;
  end if;

  if NEW."documentStatus" is distinct from OLD."documentStatus"
     or NEW."documentRemarks" is distinct from OLD."documentRemarks" then
    NEW."documentUpdatedDate" := v_today;
  end if;

  if NEW."assessmentStatus" is distinct from OLD."assessmentStatus"
     or NEW."assessmentSchedule" is distinct from OLD."assessmentSchedule"
     or NEW."assessmentGradeMath" is distinct from OLD."assessmentGradeMath"
     or NEW."assessmentGradeEnglish" is distinct from OLD."assessmentGradeEnglish"
     or NEW."assessmentRemarks" is distinct from OLD."assessmentRemarks"
     or NEW."assessmentMedical" is distinct from OLD."assessmentMedical" then
    NEW."assessmentUpdatedDate" := v_today;
  end if;

  if NEW."contractStatus" is distinct from OLD."contractStatus"
     or NEW."contractRemarks" is distinct from OLD."contractRemarks" then
    NEW."contractUpdatedDate" := v_today;
  end if;

  if NEW."feeStatus" is distinct from OLD."feeStatus"
     or NEW."feeInvoice" is distinct from OLD."feeInvoice"
     or NEW."feePaymentDate" is distinct from OLD."feePaymentDate"
     or NEW."feeStartDate" is distinct from OLD."feeStartDate"
     or NEW."feeRemarks" is distinct from OLD."feeRemarks" then
    NEW."feeUpdatedDate" := v_today;
  end if;

  if NEW."classStatus" is distinct from OLD."classStatus"
     or NEW."classAY" is distinct from OLD."classAY"
     or NEW."classLevel" is distinct from OLD."classLevel"
     or NEW."classSection" is distinct from OLD."classSection"
     or NEW."classRemarks" is distinct from OLD."classRemarks" then
    NEW."classUpdatedDate" := v_today;
  end if;

  if NEW."suppliesStatus" is distinct from OLD."suppliesStatus"
     or NEW."suppliesClaimedDate" is distinct from OLD."suppliesClaimedDate"
     or NEW."suppliesRemarks" is distinct from OLD."suppliesRemarks" then
    NEW."suppliesUpdatedDate" := v_today;
  end if;

  if NEW."orientationStatus" is distinct from OLD."orientationStatus"
     or NEW."orientationScheduleDate" is distinct from OLD."orientationScheduleDate"
     or NEW."orientationRemarks" is distinct from OLD."orientationRemarks" then
    NEW."orientationUpdatedDate" := v_today;
  end if;

  return NEW;
end;
$$;

revoke all on function public.stamp_enrolment_status_touch() from public;

-- =====================================================================
-- 2. Helper to attach the trigger — used below + by
--    create_ay_admissions_tables for newly-created AYs.
-- =====================================================================

create or replace function public.attach_enrolment_status_touch_trigger(p_status_table text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trigger_name text := 'stamp_enrolment_status_touch_trigger';
begin
  execute format('drop trigger if exists %I on public.%I', v_trigger_name, p_status_table);
  execute format(
    'create trigger %I before update on public.%I for each row execute function public.stamp_enrolment_status_touch()',
    v_trigger_name,
    p_status_table
  );
end;
$$;

revoke all on function public.attach_enrolment_status_touch_trigger(text) from public;
grant execute on function public.attach_enrolment_status_touch_trigger(text) to service_role;

-- =====================================================================
-- 3. Apply the new trigger to every existing AY status table.
-- =====================================================================

do $$
declare
  v_table record;
begin
  for v_table in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename ~ '^ay[0-9]{4}_enrolment_status$'
  loop
    perform public.attach_enrolment_status_touch_trigger(v_table.tablename);
    raise notice '[087] attached stamp_enrolment_status_touch_trigger to %.%',
      'public', v_table.tablename;
  end loop;
end$$;

-- =====================================================================
-- 4. Heal the KD #119-class regression: re-attach capture_doc_revision_
--    trigger (migration 033) to every existing AY docs table. Idempotent
--    — drops + recreates, harmless where it was already present; heals
--    any AY created between migration 050 and this one where it was
--    silently missing.
-- =====================================================================

do $$
declare
  v_table record;
begin
  for v_table in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename ~ '^ay[0-9]{4}_enrolment_documents$'
  loop
    perform public.attach_doc_revision_trigger(v_table.tablename);
    raise notice '[087] re-attached capture_doc_revision_trigger to %.%',
      'public', v_table.tablename;
  end loop;
end$$;

-- =====================================================================
-- 5. Re-emit create_ay_admissions_tables — migration 076 body (the
--    newest live definition, KD #119 hazard: diff against the newest,
--    not an older copy) verbatim, with the doc-revision trigger attach
--    RESTORED and the new touch trigger attach ADDED at the tail.
-- =====================================================================

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
end;
$$;

revoke all on function public.create_ay_admissions_tables(text) from public;
grant execute on function public.create_ay_admissions_tables(text) to service_role;

comment on function public.create_ay_admissions_tables is
  'Creates the 4-table admissions set for a new AY. Applications carries stpApplicationType (026) + stpApplicationStatus (050, restored 069) + preferredPaymentScheme/preferredPaymentMethod/marketingReferrerName (076); status carries applicationTerminalReason/Notes (067) + write-once enrolledAt (075). Attaches capture_doc_revision_trigger (033, KD #63, restored 087 after being dropped by 050) + stamp_enrolment_status_touch_trigger (087, KD #149 follow-up). KD #61/#96/#111/#119.';
