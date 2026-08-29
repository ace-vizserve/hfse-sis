-- 132_ay_enrolment_indexes.sql
--
-- Puts five btree indexes on the per-AY admissions tables -- the only columns
-- in the whole app that the code filters on constantly and that no migration
-- has ever indexed:
--
--   ay{YYYY}_enrolment_applications ("enroleeNumber")
--   ay{YYYY}_enrolment_applications ("studentNumber")
--   ay{YYYY}_enrolment_status       ("enroleeNumber")
--   ay{YYYY}_enrolment_status       ("applicationStatus")
--   ay{YYYY}_enrolment_documents    ("enroleeNumber")
--
-- This ACTIONS the one open item in docs/context/11-performance-patterns.md
-- section 10 ("Supabase / Postgres backlog, audited 2026-07-08, not yet
-- actioned"), which named exactly this gap and was never picked up.
--
-- THIS IS FUTURE-PROOFING, NOT A SPEED-UP. SAY SO PLAINLY.
--
-- The largest of these tables in production is ay2025_enrolment_applications at
-- 822 rows (ay2026 = 499, ay2027 = 264), measured 2026-08-29. A sequential scan
-- of 822 rows is sub-millisecond, and the planner will very often keep choosing
-- one. Nothing on a screen gets faster today. The reasons to do it anyway:
--
--   1. The gap is real, has been written down since 2026-07-08, and is cheap.
--   2. These are the only tables in the app that grow without bound -- every
--      other table is capped per-AY by roster size (~400 students, 21 sections)
--      or is a fixed-size config table. Intake volume is not.
--   3. Wiring it into create_ay_admissions_tables means every future AY gets it
--      for free, so the cost is paid once and never revisited.
--
-- WHAT WAS VERIFIED BEFORE WRITING THIS
--
--   * No index of any kind on these three tables beyond "constraint %I primary
--     key (id)". The DDL lives inside the create_ay_admissions_tables RPC body
--     and declares nothing else; grepping every literal "create index" across
--     supabase/migrations/*.sql finds none naming an ay-prefixed table. The
--     only index ever attached to an AY table is attach_discount_code_unique
--     (098/099), and that is on _discount_codes, a fourth table.
--   * 099 is the CURRENT definition of create_ay_admissions_tables, not 012.
--     The function has been re-emitted eleven times; "create or replace
--     function public.create_ay_admissions_tables" appears in 012, 025, 026,
--     033, 050, 067, 069, 075, 076, 087 and 099, and nothing after 099 touches
--     it. Editing 012 -- which both the plan and 11-performance-patterns.md:110
--     tell you to do -- would have reverted eleven migrations of column work.
--   * The AY slug is four digits (ay2025 / ay2026 / ay2027), and has been since
--     migration 026. 025's pg_tables walk still matches the two-digit "ay26"
--     form, so copying that walk verbatim matches ZERO tables and reports
--     success. The backfill below therefore walks academic_years the way 098
--     does, not pg_tables.
--   * Column names are camelCase and are double-quoted in every statement.
--     Unquoted, Postgres folds them to lowercase and the DDL fails on a column
--     that does not exist.
--   * The indexes are NON-UNIQUE on purpose. "enroleeNumber" is the natural key
--     and is very probably unique in practice, but a unique index is a
--     behaviour change that can fail against live data and would turn a silent
--     duplicate into a hard write error. That is a separate decision.
--   * No "concurrently" -- it is impossible inside a function's transaction and
--     pointless at 822 rows. No foreign keys: the AY DDL is frozen (KD #10a)
--     and FKs are out of scope here.
--
-- WHY A HELPER PLUS ONE LINE, RATHER THAN AN INLINE RE-EMIT
--
-- Re-emitting create_ay_admissions_tables from a stale or retyped body has
-- already caused a real five-migration regression in this repo: 099's own
-- header records the doc-revision trigger being "silently dropped by migration
-- 050's re-emit and stayed dropped through 067/069/075/076" (KD #119). 098/099
-- answered that with a pattern -- an idempotent attach_*(slug) helper carrying
-- all the DDL, a backfill for the AYs that already exist, and exactly ONE new
-- line inside the RPC -- so the risky edit is a single addition that a diff can
-- prove. This migration follows it exactly.
--
-- So the function body below was NOT retyped or reconstructed. It was copied
-- byte-for-byte from 099 (cp, md5 verified identical) and then edited in place.
-- Diffed against the 099 extract afterwards, the function region shows exactly
-- ONE hunk: an ADDITION of 8 lines (7 comment, 1 perform), with zero deletions
-- and zero modifications. Everything 087/099 established is therefore still
-- here: stpApplicationType/Status, preferredPaymentScheme/Method,
-- marketingReferrerName, applicationTerminalReason/Notes, write-once
-- enrolledAt, RLS + the canonical policy loop, and all three existing attach_*
-- calls.
--
-- If you ever need to edit this function again: extract, add, diff. Do not
-- retype it, and do not start from an older migration's copy.
--
-- 099 already validates the slug shape ('^ay[0-9]{4}$') before emitting any
-- DDL, so the helper does not re-check it.
--
-- Idempotent throughout and safe to re-run whole: the helper uses "create index
-- if not exists" and returns early on a missing table, the backfill is a plain
-- walk, and the rest of the function is unchanged from what production already
-- runs.
--
-- Apply after 131.

-- ─── The helper: idempotent, safe to call repeatedly ────────────────────────
create or replace function public.attach_enrolment_indexes(p_ay_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applications text := p_ay_slug || '_enrolment_applications';
  v_status       text := p_ay_slug || '_enrolment_status';
  v_documents    text := p_ay_slug || '_enrolment_documents';
begin
  if to_regclass(format('public.%I', v_applications)) is null then
    return;  -- no such AY table set; nothing to attach
  end if;

  -- The join key between admissions and every other module: lib/sis/,
  -- lib/p-files/, lib/sync/students.ts, lib/classroom/.
  execute format(
    'create index if not exists %I on public.%I ("enroleeNumber")',
    v_applications || '_enrolee_idx',
    v_applications
  );

  -- Hard Rule #4's stable cross-year id -- the fallback lookup in
  -- lib/sis/drill.ts and lib/supabase/admissions.ts.
  execute format(
    'create index if not exists %I on public.%I ("studentNumber")',
    v_applications || '_student_idx',
    v_applications
  );

  -- The sibling tables carry their own guard rather than riding on the
  -- applications check: they are separate relations, and a partially-created
  -- AY should attach what it can instead of failing the whole call.
  if to_regclass(format('public.%I', v_status)) is not null then
    -- Every P-Files and process-pipeline read joins status to applications
    -- on this column.
    execute format(
      'create index if not exists %I on public.%I ("enroleeNumber")',
      v_status || '_enrolee_idx',
      v_status
    );

    -- The enrolment gate: .in('applicationStatus', ['Enrolled',
    -- 'Enrolled (Conditional)']), on the hot path of P-Files, the
    -- document-chase queue and the SIS drills.
    execute format(
      'create index if not exists %I on public.%I ("applicationStatus")',
      v_status || '_appstatus_idx',
      v_status
    );
  end if;

  if to_regclass(format('public.%I', v_documents)) is not null then
    -- The document-completeness matrix reads this table per enrolee.
    execute format(
      'create index if not exists %I on public.%I ("enroleeNumber")',
      v_documents || '_enrolee_idx',
      v_documents
    );
  end if;
end;
$$;

comment on function public.attach_enrolment_indexes(text) is
  'Add the five btree indexes on ay{YYYY}_enrolment_applications("enroleeNumber","studentNumber"), _enrolment_status("enroleeNumber","applicationStatus") and _enrolment_documents("enroleeNumber"). Non-unique on purpose. Idempotent. Called automatically by create_ay_admissions_tables since migration 132, so new AYs get them without intervention; call directly only to heal an existing table set.';

-- ─── Heal every AY table set that already exists ────────────────────────────
-- Walks academic_years, NOT pg_tables. 025's pg_tables walk still matches the
-- pre-026 two-digit slug ('ay26'), so reusing it would match zero tables and
-- report success. This is 098's walk verbatim.
do $$
declare
  v_ay record;
begin
  for v_ay in
    select 'ay' || substring(ay_code from 3) as slug
    from academic_years
  loop
    perform public.attach_enrolment_indexes(v_ay.slug);
  end loop;
end;
$$;

revoke all on function public.attach_enrolment_indexes(text) from public;
grant execute on function public.attach_enrolment_indexes(text) to service_role;

-- ─── Wire it in, so every future AY gets the indexes for free ───────────────
-- Body below copied byte-for-byte from 099. One hunk added, nothing else.

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
end;
$$;

revoke all on function public.create_ay_admissions_tables(text) from public;
grant execute on function public.create_ay_admissions_tables(text) to service_role;

comment on function public.create_ay_admissions_tables is
  'Creates the 4-table admissions set for a new AY. Applications carries stpApplicationType (026) + stpApplicationStatus (050, restored 069) + preferredPaymentScheme/preferredPaymentMethod/marketingReferrerName (076); status carries applicationTerminalReason/Notes (067) + write-once enrolledAt (075). Attaches capture_doc_revision_trigger (033, KD #63, restored 087 after being dropped by 050) + stamp_enrolment_status_touch_trigger (087, KD #149 follow-up) + attach_discount_code_unique (098, wired in 099) + attach_enrolment_indexes (132). KD #61/#96/#111/#119.';
