-- 033_track_parent_portal_reuploads.sql
--
-- P-Files revision history previously only captured the SIS-officer upload
-- flow (`/api/p-files/[enroleeNumber]/upload`). Parents can also re-upload
-- a Rejected or Expired doc directly from the enrolment-portal's enrollment
-- details page — that path bypasses the SIS entirely and silently overwrites
-- the URL on `ay{YYYY}_enrolment_documents` with no archive row written.
--
-- This migration adds a DB trigger on each AY's docs table that captures
-- URL changes regardless of who's writing. It is gated on enrolled status:
-- pre-enrolment doc churn is application progress and is captured by the
-- existing audit log path, NOT in p_file_revisions.
--
-- Schema changes on `p_file_revisions`:
--   - `archived_url`, `archived_path` → nullable. The trigger doesn't move
--     files; it just records metadata. The SIS-officer upload route keeps
--     setting both (it does its own file move).
--   - New `previous_url` column — the OLD URL at the time of replacement,
--     populated by both write paths.
--   - New `source` column — discriminates 'pfile-upload' / 'parent-portal'
--     / 'sis-direct'. Existing rows backfill to 'pfile-upload'.
--   - Partial unique index on (ay_code, enrolee_number, slot_key,
--     previous_url) so the trigger's INSERT collides with the SIS route's
--     explicit INSERT and silently skips via ON CONFLICT DO NOTHING. The
--     route writes its row first (with archived_url filled); the trigger
--     fires after the UPDATE and tries to insert the same previous_url —
--     unique constraint catches it.
--
-- File-content preservation is OUT OF SCOPE here. If the parent portal
-- overwrites the canonical path (vs. writing a versioned path), the OLD
-- file's bytes are gone and `previous_url` resolves to the NEW file. That
-- coordination work belongs in the parent-portal repo. This migration just
-- ensures we have the metadata (who, when, status, expiry) regardless.
--
-- Apply after 032. Safe to re-run (CREATE OR REPLACE on functions, IF NOT
-- EXISTS on indexes, idempotent ALTER TABLE statements).
--
-- Tolerates missing STP slot columns: AY tables created before Sprint 27
-- (e.g. ay2025) lack icaPhoto / financialSupportDocs / vaccinationInformation.
-- attach_doc_revision_trigger introspects information_schema.columns and
-- only lists slots that exist on the target table.

-- =====================================================================
-- 1. Schema changes on p_file_revisions
-- =====================================================================

alter table public.p_file_revisions alter column archived_url drop not null;
alter table public.p_file_revisions alter column archived_path drop not null;

alter table public.p_file_revisions add column if not exists previous_url text;
alter table public.p_file_revisions add column if not exists source text not null default 'pfile-upload';

-- CHECK constraint added separately so re-running is safe — drop first.
alter table public.p_file_revisions drop constraint if exists p_file_revisions_source_check;
alter table public.p_file_revisions add constraint p_file_revisions_source_check
  check (source in ('pfile-upload', 'parent-portal', 'sis-direct'));

-- Partial unique index for dedupe between route's explicit insert + trigger insert.
create unique index if not exists p_file_revisions_dedupe
  on public.p_file_revisions (ay_code, enrolee_number, slot_key, previous_url)
  where previous_url is not null;

-- =====================================================================
-- 2. Trigger function — capture_doc_revision
-- =====================================================================
--
-- AFTER UPDATE on each ay{YYYY}_enrolment_documents table. Iterates the
-- 16 slot URL columns via to_jsonb(OLD/NEW), looks up matching status +
-- expiry from the same row, inserts one revision row per changed slot
-- where the OLD url was non-null. Short-circuits unless the student is
-- in an enrolled state.

create or replace function public.capture_doc_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slots text[] := array[
    'idPicture','birthCert','educCert','medical','form12',
    'passport','pass',
    'motherPassport','motherPass',
    'fatherPassport','fatherPass',
    'guardianPassport','guardianPass',
    'icaPhoto','financialSupportDocs','vaccinationInformation'
  ];
  v_expiring_slots text[] := array[
    'passport','pass',
    'motherPassport','motherPass',
    'fatherPassport','fatherPass',
    'guardianPassport','guardianPass'
  ];
  v_ay_slug text;
  v_ay_code text;
  v_status_table text;
  v_app_status text;
  v_email text;
  v_source text;
  v_old_row jsonb;
  v_new_row jsonb;
  v_slot text;
  v_old_url text;
  v_new_url text;
  v_old_status text;
  v_old_expiry text;
begin
  -- TG_TABLE_NAME is 'ay2026_enrolment_documents'. Strip '_enrolment_documents'
  -- to get 'ay2026'. Uppercase to AY code.
  v_ay_slug := regexp_replace(TG_TABLE_NAME, '_enrolment_documents$', '');
  v_ay_code := upper(v_ay_slug);
  v_status_table := v_ay_slug || '_enrolment_status';

  -- Look up the student's application status from the matching _status table.
  -- Use EXECUTE since the table name is dynamic.
  begin
    execute format(
      'select "applicationStatus" from public.%I where "enroleeNumber" = $1 limit 1',
      v_status_table
    )
    into v_app_status
    using OLD."enroleeNumber";
  exception when others then
    -- If the status table doesn't exist or the lookup fails, bail safely.
    -- Better to skip the revision than to fail the underlying UPDATE.
    return NEW;
  end;

  -- Enrolled-only gate. Pre-enrolment writes belong in audit_log, not here.
  if v_app_status is null or v_app_status not in ('Enrolled', 'Enrolled (Conditional)') then
    return NEW;
  end if;

  -- Acting user — auth.jwt() resolves to the parent portal user when
  -- writing via anon/authenticated; null when writing via service_role.
  v_email := coalesce(nullif(auth.jwt() ->> 'email', ''), '(unknown)');

  -- Source discriminator. The SIS upload route writes via service-role
  -- (auth.jwt() is null), but its explicit createRevision insert lands
  -- BEFORE this trigger fires AND uses the same previous_url, so the
  -- partial unique index dedupes it. So 'sis-direct' here is for any
  -- other service-role writer that doesn't insert its own revision —
  -- a defensive label, not a common case.
  if auth.jwt() is not null then
    v_source := 'parent-portal';
  else
    v_source := 'sis-direct';
  end if;

  v_old_row := to_jsonb(OLD);
  v_new_row := to_jsonb(NEW);

  foreach v_slot in array v_slots loop
    v_old_url := v_old_row ->> v_slot;
    v_new_url := v_new_row ->> v_slot;

    -- Skip if no change or if there was nothing there to replace.
    if v_old_url is null or v_old_url is not distinct from v_new_url then
      continue;
    end if;

    v_old_status := v_old_row ->> (v_slot || 'Status');
    if v_slot = any(v_expiring_slots) then
      v_old_expiry := v_old_row ->> (v_slot || 'Expiry');
    else
      v_old_expiry := null;
    end if;

    insert into public.p_file_revisions (
      ay_code,
      enrolee_number,
      slot_key,
      previous_url,
      status_snapshot,
      expiry_snapshot,
      replaced_by_email,
      source
    )
    values (
      v_ay_code,
      OLD."enroleeNumber",
      v_slot,
      v_old_url,
      v_old_status,
      case when v_old_expiry is null or v_old_expiry = '' then null else v_old_expiry::date end,
      v_email,
      v_source
    )
    on conflict (ay_code, enrolee_number, slot_key, previous_url) where previous_url is not null
    do nothing;
  end loop;

  return NEW;
end;
$$;

revoke all on function public.capture_doc_revision() from public;

-- =====================================================================
-- 3. Helper to attach the trigger to a docs table — used here + by
--    create_ay_admissions_tables for newly-created tables.
-- =====================================================================

create or replace function public.attach_doc_revision_trigger(p_docs_table text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trigger_name text := 'capture_doc_revision_trigger';
  v_all_slots text[] := array[
    'idPicture','birthCert','educCert','medical','form12',
    'passport','pass',
    'motherPassport','motherPass',
    'fatherPassport','fatherPass',
    'guardianPassport','guardianPass',
    'icaPhoto','financialSupportDocs','vaccinationInformation'
  ];
  v_existing_cols text[];
  v_col_list text;
begin
  -- STP slots (icaPhoto / financialSupportDocs / vaccinationInformation)
  -- were added in Sprint 27 and may be missing on older AY docs tables
  -- (e.g. ay2025). CREATE TRIGGER ... AFTER UPDATE OF <col> errors if
  -- <col> doesn't exist, so introspect first and only list the slots
  -- the table actually has. The trigger body itself is jsonb-keyed and
  -- handles missing slots gracefully.
  select array_agg(quote_ident(column_name))
    into v_existing_cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = p_docs_table
    and column_name = any(v_all_slots);

  if v_existing_cols is null or array_length(v_existing_cols, 1) = 0 then
    raise notice '[033] no slot URL columns on %.% — skipping trigger', 'public', p_docs_table;
    return;
  end if;

  v_col_list := array_to_string(v_existing_cols, ',');

  execute format('drop trigger if exists %I on public.%I', v_trigger_name, p_docs_table);
  -- AFTER UPDATE OF <url cols present on the table> — fires only when at
  -- least one URL column appears in the UPDATE's SET clause, so status-only
  -- updates (e.g. freshenAyDocuments flipping Valid → Expired) don't trigger.
  execute format(
    'create trigger %I after update of %s on public.%I for each row execute function public.capture_doc_revision()',
    v_trigger_name,
    v_col_list,
    p_docs_table
  );
end;
$$;

revoke all on function public.attach_doc_revision_trigger(text) from public;
grant execute on function public.attach_doc_revision_trigger(text) to service_role;

-- =====================================================================
-- 4. Apply the trigger to existing AY docs tables
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
    raise notice '[033] attached capture_doc_revision_trigger to %.%',
      'public', v_table.tablename;
  end loop;
end$$;

-- =====================================================================
-- 5. Update create_ay_admissions_tables to attach the trigger for
--    future AY tables. Function body otherwise identical to migration
--    026's version; only the tail-end addition is new.
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

  -- ay{YYYY}_enrolment_applications — full admissions form (~150 columns).
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
      "contractSignatory" text null, "vizSchoolProgram" text null,
      "feedbackRating" smallint null, "feedbackComments" text null,
      "feedbackConsent" boolean null, "feedbackSubmittedAt" timestamp without time zone null,
      "preCourseAnswer" text null, "preCourseDate" timestamp without time zone null,
      "preCourseAcknowledgedAt" timestamp without time zone null,
      "stpApplicationType" text null,
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
      constraint %I primary key (id)
    );
  $ddl$, v_slug || '_enrolment_applications', v_slug || '_enrolment_applications_pkey');

  -- ay{YYYY}_enrolment_status — per-stage status flags.
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
      constraint %I primary key (id)
    );
  $ddl$, v_slug || '_enrolment_status', v_slug || '_enrolment_status_pkey');

  -- ay{YYYY}_enrolment_documents — per-slot URL + status.
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

  -- ay{YYYY}_discount_codes — enrolment promotion catalogue.
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

  -- Enable RLS + add the canonical permissive policy on each new table.
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

  -- Attach the doc-revision trigger to the new docs table (migration 033).
  perform public.attach_doc_revision_trigger(v_slug || '_enrolment_documents');
end;
$$;

revoke all on function public.create_ay_admissions_tables(text) from public;
grant execute on function public.create_ay_admissions_tables(text) to service_role;
