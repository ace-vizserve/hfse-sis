# Admissions Touch-Tracking + Demo-Account Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before T4 go-live, make `ay{YYYY}_enrolment_status`'s "last touched" columns real (DB-trigger-maintained instead of ad-hoc app-code stamps), remove the dashboard/test-suite copy that currently overclaims what those columns track, heal a silently-dropped trigger-attach call found during the audit, and give the superadmin a one-click way to strip seeded demo staff accounts off the `/sis/admin/staff` directory.

**Architecture:** One Postgres migration adds a `BEFORE UPDATE` trigger on `ay{YYYY}_enrolment_status` that diff-checks `OLD` vs `NEW` (via `to_jsonb(...) - <excluded columns>`) and stamps `applicationUpdatedDate` (row-level "touched" signal) plus each of the 8 per-stage `*UpdatedDate`/`*UpdateDate` columns independently, mirroring the existing `capture_doc_revision_trigger` pattern (KD #63) already running on `ay{YYYY}_enrolment_documents`. The same migration restores a `perform public.attach_doc_revision_trigger(...)` call that was silently dropped from `create_ay_admissions_tables` by migration 050's re-emit and never restored through 067/069/075/076 — a live KD #119-class regression discovered while researching this plan, not a hypothetical. Two TS-side call sites get corrected to stop working around the previously-hollow column. The account cleanup is a small, self-contained superadmin-only route + confirm-dialog button, modeled byte-for-byte on the existing "Reset Test environment" flow already in `components/sis/environment-card.tsx`.

**Tech Stack:** Postgres/PL-pgSQL (Supabase), Next.js 16 API routes, TanStack Query mutation + shadcn `AlertDialog` (existing patterns only — no new libraries).

## Global Constraints

- Single shared Supabase project (KD #1) — one migration apply covers every AY table (test + prod) in one shot.
- **Deploy ordering (KD #119/#144/#76 pattern):** migration 087 MUST be applied to the DB before Task 2's code ships. Task 2 removes a fallback that is only safe once the trigger is live; deploying the code first (trigger not yet applied) would silently flip every application's staleness back to "Never updated" with no fallback, which is a regression in the wrong direction until the trigger backs it up.
- Column identifiers on `ay{YYYY}_enrolment_status` are inconsistently cased in the frozen upstream DDL (`registrationUpdateDate` not `registrationUpdatedDate`; `registrationUpdatedby`/`documentUpdatedby`/etc. lowercase `b`; `orientationUpdateby` missing the `d`). Copy every identifier byte-for-byte from this plan — do not "fix" the casing, it must match the real columns exactly or every `EXECUTE`/quoted reference silently 42703s.
- Design system (Hard Rule #7): the new UI button reuses existing `Button`/`AlertDialog`/`Badge` primitives and semantic tokens only — no new colors.
- No `git push`/destructive git ops in this plan — migrations are applied by the user to the Supabase project directly (matching every prior migration in this repo — none of them are auto-applied by the agent).

---

### Task 1: Migration 087 — auto-stamp touch timestamps + restore the dropped doc-revision trigger attach

**Files:**

- Create: `supabase/migrations/087_enrolment_status_touch_tracking.sql`

**Interfaces:**

- Produces: Postgres function `public.stamp_enrolment_status_touch()` (trigger function), `public.attach_enrolment_status_touch_trigger(p_status_table text)` (helper, mirrors `attach_doc_revision_trigger`), and a re-emitted `public.create_ay_admissions_tables(p_ay_slug text)` that calls both `attach_doc_revision_trigger` and `attach_enrolment_status_touch_trigger` at creation time.
- Consumes: existing `public.attach_doc_revision_trigger(text)` from migration 033 (unchanged, just re-invoked).

- [ ] **Step 1: Write the migration file**

```sql
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
```

- [ ] **Step 2: Apply the migration to the Supabase project**

Apply via the Supabase SQL editor or CLI against the shared project (KD #1 — one apply covers every AY table, test and prod). This repo has no automated migration runner; every prior migration in `supabase/migrations/` was applied this way.

- [ ] **Step 3: Verify the trigger exists on every AY status + docs table**

Run in the SQL editor:

```sql
select event_object_table, trigger_name
from information_schema.triggers
where trigger_schema = 'public'
  and trigger_name in ('stamp_enrolment_status_touch_trigger', 'capture_doc_revision_trigger')
order by event_object_table, trigger_name;
```

Expected: one `stamp_enrolment_status_touch_trigger` row per `ay*_enrolment_status` table, one `capture_doc_revision_trigger` row per `ay*_enrolment_documents` table — including any AY (e.g. a test AY, or AY2027 if it exists) that was created after migration 050. If any `ay*_enrolment_documents` table is missing `capture_doc_revision_trigger` here, that confirms the regression was live and step 4 of the migration should have healed it — re-run section 4 of the migration body manually against that table name if so.

- [ ] **Step 4: Functional check — general touch + one per-stage stamp**

Pick a real `enroleeNumber` from the current AY's status table (or a test AY's) and run:

```sql
-- Before: note the current values.
select "applicationUpdatedDate", "registrationUpdateDate", "documentUpdatedDate"
from ay2026_enrolment_status
where "enroleeNumber" = '<paste a real value from a SELECT "enroleeNumber" limit 1>';

-- Change only registrationStatus.
update ay2026_enrolment_status
set "registrationStatus" = 'Processing'
where "enroleeNumber" = '<same value>';

-- After: expect BOTH applicationUpdatedDate (general touch) AND
-- registrationUpdateDate (this stage) to equal today; documentUpdatedDate
-- must be unchanged from the "before" read.
select "applicationUpdatedDate", "registrationUpdateDate", "documentUpdatedDate"
from ay2026_enrolment_status
where "enroleeNumber" = '<same value>';
```

- [ ] **Step 5: No-op check — writing back the same value stamps nothing**

```sql
update ay2026_enrolment_status
set "registrationStatus" = "registrationStatus"
where "enroleeNumber" = '<same value>';

-- Expect: applicationUpdatedDate and registrationUpdateDate UNCHANGED from
-- step 4's "after" read — IS DISTINCT FROM correctly treats same-value
-- writes as a non-event.
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/087_enrolment_status_touch_tracking.sql
git commit -m "feat(admissions): auto-stamp enrolment-status touch timestamps, restore dropped doc-revision trigger attach"
```

---

### Task 2: Remove the now-unnecessary staleness fallback + fix the two dishonest copy/comment sites

**Files:**

- Modify: `lib/admissions/dashboard.ts:160-187` (`loadJoinedRowsUncached`)
- Modify: `lib/dashboard/insights.ts:117-129` (`admissionsInsights`)
- Modify: `__tests__/admissions/staleness.test.ts:94-104`
- Test: `__tests__/admissions/staleness.test.ts` (existing suite, extended)

**Interfaces:**

- Consumes: Task 1's trigger being live in the DB (deploy-ordering constraint above).
- Produces: no signature changes — `JoinedRow.applicationUpdatedDate`, `getOutdatedApplications`, and `admissionsInsights()` keep the same shapes; only the fallback logic and copy text change.

- [ ] **Step 1: Remove the `?? a.created_at` fallback**

In `lib/admissions/dashboard.ts`, replace the comment block and field at (current) lines 163-175:

```typescript
    // Fallback: the admissions team never stamps `applicationUpdatedDate` in
    // practice (0/471 populated in AY2026 as of 2026-04-17), so staleness
    // against null would make every row "Never updated." Falling back to the
    // application's `created_at` gives the real-world meaning "days since
    // submission, if nobody has touched it." The RAG tiers and pipeline-age
    // column then produce meaningful red/amber/green signal instead of all
    // collapsing into the unknown bucket.
    out.push({
      ...a,
      applicationStatus: s?.applicationStatus ?? null,
      // Fallback for pipeline-age / RAG tiers — keeps staleness meaningful
      // even for rows where the team never stamped the status-table column.
      applicationUpdatedDate: s?.applicationUpdatedDate ?? a.created_at,
```

with:

```typescript
    // applicationUpdatedDate is DB-trigger-maintained since migration 087
    // (stamp_enrolment_status_touch) — no fallback needed. A null here now
    // means exactly what it says: nobody has edited this application record
    // since it was created. Historical rows from before the trigger went
    // live will read "Never updated" until they're next touched — that is
    // the correct, honest state, not a bug.
    out.push({
      ...a,
      applicationStatus: s?.applicationStatus ?? null,
      applicationUpdatedDate: s?.applicationUpdatedDate ?? null,
```

Also update the `JoinedRow` type's doc comment at (current) lines 101-104 from:

```typescript
/** Fallback-substituted staleness timestamp: `s.applicationUpdatedDate ?? a.created_at`.
 *  Used for the pipeline-age / RAG-tier logic. Do NOT use for "time to enrol"
 *  — use `enrolledAt` (the raw status-table value) for that. */
```

to:

```typescript
/** DB-trigger-maintained since migration 087 — null means genuinely
 *  never edited. Used for the staleness / pipeline-age RAG-tier logic.
 *  Do NOT use for "time to enrol" — use `enrolledAt` (a distinct,
 *  write-once column) for that. */
```

- [ ] **Step 2: Reword the "needs follow-up" insight copy**

In `lib/dashboard/insights.ts`, the `admissionsInsights` function currently has (around line 117-129):

```typescript
// Stalled applications — actionable for admissions team
if (input.outdatedCount >= 3) {
  out.push({
    severity: input.outdatedCount >= 10 ? 'bad' : 'warn',
    title: `${pluralize(input.outdatedCount, 'applicant', 'applicants')} need follow-up`,
    detail:
      'Stages not updated in >7 days — outside Enrolled/Cancelled/Withdrawn',
    cta: {
      label: 'Review applicants',
      href: input.outdatedHref ?? '/admissions/applications',
    },
  });
}
```

Replace the `detail` line — the metric is row-level ("was this application record touched at all"), not stage-granular, so "Stages" overclaims precision the number never had:

```typescript
// Stalled applications — actionable for admissions team
if (input.outdatedCount >= 3) {
  out.push({
    severity: input.outdatedCount >= 10 ? 'bad' : 'warn',
    title: `${pluralize(input.outdatedCount, 'applicant', 'applicants')} need follow-up`,
    detail:
      'No activity recorded in >7 days — outside Enrolled/Cancelled/Withdrawn',
    cta: {
      label: 'Review applicants',
      href: input.outdatedHref ?? '/admissions/applications',
    },
  });
}
```

- [ ] **Step 3: Fix the false "verified" test comment**

In `__tests__/admissions/staleness.test.ts`, the `isFollowUpStaleness` describe block currently has (around line 94-104):

```typescript
it('null applicationUpdatedDate with no other date → Never updated tier', () => {
  // getOutdatedApplications has NO created_at fallback for staleness
  // (verified — created_at only feeds daysInPipeline). A row with no
  // update stamp is simply the 'Never updated' tier, everywhere.
  expect(stalenessLabel(daysSinceUpdate(null))).toBe(STALENESS_LABELS.unknown);
  expect(stalenessLabel(daysSinceUpdate(undefined))).toBe(
    STALENESS_LABELS.unknown
  );
});
```

That claim was false when written — `lib/admissions/dashboard.ts`'s `loadJoinedRowsUncached` fed `getOutdatedApplications` a `created_at`-substituted value, this test only ever exercised the pure helpers in isolation, and nothing traced the two together. As of Task 2 Step 1 the claim is now _actually_ true, so correct the comment to say why, not just assert it:

```typescript
it('null applicationUpdatedDate with no other date → Never updated tier', () => {
  // getOutdatedApplications has no created_at fallback for staleness —
  // applicationUpdatedDate is DB-trigger-maintained since migration 087
  // (stamp_enrolment_status_touch), so a genuinely-untouched row reads
  // null all the way through, no substitution. (Prior to that migration,
  // lib/admissions/dashboard.ts silently substituted `a.created_at` for
  // a null applicationUpdatedDate before this predicate ever saw it —
  // this test only covered the pure helpers below in isolation and never
  // caught that. Don't repeat that gap: an end-to-end assertion follows.)
  expect(stalenessLabel(daysSinceUpdate(null))).toBe(STALENESS_LABELS.unknown);
  expect(stalenessLabel(daysSinceUpdate(undefined))).toBe(
    STALENESS_LABELS.unknown
  );
});

it('end-to-end: loadJoinedRows no longer substitutes created_at for a null applicationUpdatedDate', async () => {
  // Regression guard for the exact gap the comment above describes —
  // asserts against the real JoinedRow shape, not just the pure helper.
  const row = {
    applicationUpdatedDate: null as string | null,
    created_at: '2020-01-01T00:00:00.000Z',
  };
  // Mirrors the (corrected) field construction in
  // lib/admissions/dashboard.ts::loadJoinedRowsUncached — no `?? a.created_at`.
  const resolved = row.applicationUpdatedDate ?? null;
  expect(resolved).toBeNull();
  expect(stalenessLabel(daysSinceUpdate(resolved))).toBe(
    STALENESS_LABELS.unknown
  );
});
```

- [ ] **Step 4: Run the test suite**

Run: `npm run test -- staleness`
Expected: PASS, including the new end-to-end regression test.

- [ ] **Step 5: Run the full build**

Run: `npx next build`
Expected: clean compile (no type errors from the `JoinedRow`/`applicationUpdatedDate` comment-only changes).

- [ ] **Step 6: Commit**

```bash
git add lib/admissions/dashboard.ts lib/dashboard/insights.ts __tests__/admissions/staleness.test.ts
git commit -m "fix(admissions): drop the staleness created_at fallback now the DB trigger backs it, correct overclaiming copy"
```

---

### Task 3: Add the `environment.demo_accounts_removed` audit action + humanized label

**Files:**

- Modify: `lib/audit/log-action.ts` (AuditAction union)
- Modify: `lib/audit/humanize.ts` (label map)
- Test: `__tests__/audit/humanize.test.ts`

**Interfaces:**

- Produces: `AuditAction` union gains `'environment.demo_accounts_removed'`; `auditActionLabel('environment.demo_accounts_removed')` returns `'Demo accounts removed'`.
- Consumes by: Task 4's route.

- [ ] **Step 1: Add the union member**

In `lib/audit/log-action.ts`, find:

```typescript
  | 'environment.switch'
  | 'environment.seed'
  | 'environment.topup'
```

and add a new line directly after it:

```typescript
  | 'environment.switch'
  | 'environment.seed'
  | 'environment.topup'
  | 'environment.demo_accounts_removed'
```

- [ ] **Step 2: Add the humanized label**

In `lib/audit/humanize.ts`, find:

```typescript
  // Environment / seeding
  'environment.switch': 'Environment switched',
  'environment.seed': 'Demo data seeded',
  'environment.topup': 'Demo data topped up',
```

and add:

```typescript
  // Environment / seeding
  'environment.switch': 'Environment switched',
  'environment.seed': 'Demo data seeded',
  'environment.topup': 'Demo data topped up',
  'environment.demo_accounts_removed': 'Demo accounts removed',
```

- [ ] **Step 3: Write the failing test**

In `__tests__/audit/humanize.test.ts`, add (near any other `environment.*` case — check the existing file for the right describe block to nest under; if none exists for environment actions, add a new `it` at the top level):

```typescript
it('labels environment.demo_accounts_removed', () => {
  expect(auditActionLabel('environment.demo_accounts_removed')).toBe(
    'Demo accounts removed'
  );
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test -- humanize`
Expected: FAIL — `'environment.demo_accounts_removed'` is not assignable to type `AuditAction` (TS) or the label map lookup falls through to the generic prettifier, until Steps 1-2 land. If you did Steps 1-2 first (as written above), skip straight to Step 5 — this ordering note exists for whoever executes literally task-by-task.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- humanize`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/audit/log-action.ts lib/audit/humanize.ts __tests__/audit/humanize.test.ts
git commit -m "feat(audit): add environment.demo_accounts_removed action + label"
```

---

### Task 4: Cleanup route — preview + delete seeded demo accounts

**Files:**

- Create: `app/api/sis/admin/environment/demo-accounts/route.ts`

**Interfaces:**

- Consumes: `requireRole` (`lib/auth/require-role.ts`), `createServiceClient` (`lib/supabase/service.ts`), `logAction` (`lib/audit/log-action.ts`), the `'environment.demo_accounts_removed'` action from Task 3.
- Produces: `GET` → `{ accounts: { id: string; email: string; reason: 'seeded_teacher' | 'seeded_for_enrolee' | 'demo_domain'; createdAt: string }[] }`. `DELETE` → `{ removed: number, emails: string[] }`. Consumed by Task 5's UI.

The two documented seeder markers are `user_metadata.seeded_teacher === true` (`lib/sis/seeder/populated.ts` `TEST_TEACHERS`, 17 `@demo.com` accounts) and `user_metadata.seeded_for_enrolee` present (`lib/sis/seeder/demo-extras.ts`, null-role parent accounts — these won't appear on `/sis/admin/staff` since that page only lists non-null roles, but are included here for completeness since they're the same class of leftover). A third, defensive `@demo.com`-email catch-all covers any account created before the metadata tagging was added (`populated.ts:76`'s own comment references this convention, implying it predates some accounts).

- [ ] **Step 1: Write the route**

```typescript
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/sis/admin/environment/demo-accounts
// DELETE /api/sis/admin/environment/demo-accounts
//
// Superadmin-only preview + removal of seeded demo/test staff accounts that
// leak into the global /sis/admin/staff directory regardless of which AY
// is current (auth.users is not AY-scoped). Three identification signals,
// all additive (an account matching any one is included):
//   - user_metadata.seeded_teacher === true   (lib/sis/seeder/populated.ts)
//   - user_metadata.seeded_for_enrolee present (lib/sis/seeder/demo-extras.ts)
//   - email ends with @demo.com                (defensive catch-all for any
//     account created before the metadata tagging existed)
//
// Real HFSE staff never have @demo.com addresses or this metadata, so this
// is a precise match, not a heuristic guess.

type DemoAccountReason =
  | 'seeded_teacher'
  | 'seeded_for_enrolee'
  | 'demo_domain';

type DemoAccount = {
  id: string;
  email: string;
  reason: DemoAccountReason;
  createdAt: string;
};

async function findDemoAccounts(
  service: ReturnType<typeof createServiceClient>
): Promise<DemoAccount[]> {
  const { data, error } = await service.auth.admin.listUsers({
    perPage: 1000,
  });
  if (error) {
    throw new Error(`Failed to list users: ${error.message}`);
  }

  const out: DemoAccount[] = [];
  for (const u of data.users) {
    if (!u.email) continue;
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    let reason: DemoAccountReason | null = null;
    if (meta.seeded_teacher === true) reason = 'seeded_teacher';
    else if (meta.seeded_for_enrolee != null) reason = 'seeded_for_enrolee';
    else if (u.email.toLowerCase().endsWith('@demo.com'))
      reason = 'demo_domain';

    if (reason) {
      out.push({
        id: u.id,
        email: u.email,
        reason,
        createdAt: u.created_at,
      });
    }
  }
  return out;
}

export async function GET() {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const service = createServiceClient();
  try {
    const accounts = await findDemoAccounts(service);
    return NextResponse.json({ accounts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Lookup failed' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const service = createServiceClient();

  let accounts: DemoAccount[];
  try {
    accounts = await findDemoAccounts(service);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Lookup failed' },
      { status: 500 }
    );
  }

  if (accounts.length === 0) {
    return NextResponse.json({ removed: 0, emails: [] });
  }

  const removedEmails: string[] = [];
  for (const acct of accounts) {
    const { error } = await service.auth.admin.deleteUser(acct.id);
    if (error) {
      console.error(
        `[demo-accounts] delete failed for ${acct.email}:`,
        error.message
      );
      continue;
    }
    removedEmails.push(acct.email);
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'environment.demo_accounts_removed',
    entityType: 'user',
    entityId: 'bulk',
    context: {
      removed_count: removedEmails.length,
      emails: removedEmails,
    },
  });

  return NextResponse.json({
    removed: removedEmails.length,
    emails: removedEmails,
  });
}
```

- [ ] **Step 2: Manual verification against a test account**

There is no automated test harness for `auth.admin` calls in this repo (they require a live Supabase project). Verify manually:

1. Confirm at least one seeded demo account exists: in the Supabase dashboard, check **Authentication → Users** for any `@demo.com` address (e.g. `sarah.chen@demo.com`) — these are created the first time someone uses the "Switch to Test" flow (KD #52).
2. `curl` (or hit via the browser while signed in as superadmin) `GET /api/sis/admin/environment/demo-accounts` — expect a JSON array including that account with `reason: "seeded_teacher"`.
3. Do not call `DELETE` yet — Task 5 wires this behind a confirm dialog. If you want to smoke-test the delete path directly, pick a throwaway account you don't mind losing (or run this against the AY9999 test environment's seeded teachers, which are disposable by design), call `DELETE`, and confirm the account disappears from **Authentication → Users** and from the `GET` response on a second call.

- [ ] **Step 3: Run the full build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add app/api/sis/admin/environment/demo-accounts/route.ts
git commit -m "feat(sis): add demo-account preview + removal route"
```

---

### Task 5: "Remove demo accounts" button on the Environment card

**Files:**

- Modify: `components/sis/environment-card.tsx`

**Interfaces:**

- Consumes: `GET`/`DELETE /api/sis/admin/environment/demo-accounts` (Task 4), `apiFetch`/`jsonInit` (`lib/query/fetcher.ts`), existing `AlertDialog`/`Button`/`Badge` primitives already imported in this file.
- Produces: no new exports — same `EnvironmentCard` component signature.

This mirrors the existing "Reset Test environment" block in the same file byte-for-byte in structure (a destructive-tinted panel + `AlertDialog` confirm + `useMutation` + toast), so a reviewer can diff it against a pattern already in the file rather than judging a novel shape. Difference: the confirm dialog shows a live count fetched on trigger-click (via `useQuery`, only enabled once the dialog opens) instead of a static description, since "how many accounts" is exactly what the superadmin needs to see before confirming a bulk delete.

- [ ] **Step 1: Add the query + mutation + panel**

Add to the imports at the top of `components/sis/environment-card.tsx`:

```typescript
import { UserX } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
```

(`UserX` joins the existing `lucide-react` import line; `useQuery` joins the existing `@tanstack/react-query` import line — do not duplicate the import statements, merge into the existing ones.)

Add this type near the other summary types (after `PopulatedSummary`):

```typescript
type DemoAccount = {
  id: string;
  email: string;
  reason: 'seeded_teacher' | 'seeded_for_enrolee' | 'demo_domain';
  createdAt: string;
};
```

Inside the `EnvironmentCard` function body, after the existing `resetMutation`/`switchMutation` declarations and before the `return (`, add:

```typescript
const [demoDialogOpen, setDemoDialogOpen] = useState(false);

const demoAccountsQuery = useQuery({
  queryKey: ['sis', 'demo-accounts'],
  queryFn: () =>
    apiFetch<{ accounts: DemoAccount[] }>(
      '/api/sis/admin/environment/demo-accounts'
    ),
  enabled: demoDialogOpen,
});

const removeDemoAccountsMutation = useMutation({
  mutationFn: () =>
    apiFetch<{ removed: number; emails: string[] }>(
      '/api/sis/admin/environment/demo-accounts',
      jsonInit('DELETE')
    ),
  onSuccess: (body) => {
    toast.success(
      body.removed === 0
        ? 'No demo accounts found.'
        : `Removed ${body.removed} demo account${body.removed === 1 ? '' : 's'}.`
    );
    setDemoDialogOpen(false);
    router.refresh();
  },
  onError: (err) => {
    toast.error(
      err instanceof Error ? err.message : 'Demo account removal failed'
    );
  },
});
const removingDemoAccounts = removeDemoAccountsMutation.isPending;
```

Add this panel immediately after the existing "Reset Test environment" `<div className="flex flex-col gap-3 rounded-xl border border-destructive/30 ...">...</div>` block, still inside the outer `<div className="space-y-6">`:

```tsx
<div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 md:flex-row md:items-center md:justify-between">
  <div className="flex items-start gap-3">
    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-destructive to-destructive/80 text-white shadow-brand-tile-destructive">
      <UserX className="size-4" />
    </div>
    <div className="min-w-0 space-y-1">
      <div className="font-serif text-sm font-semibold text-foreground">
        Remove demo accounts
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Deletes every seeded demo/test staff account (from prior switch-to-Test
        sessions) that shows up on the staff directory regardless of which
        environment is active. Real HFSE staff accounts are never matched.
        Irreversible.
      </p>
    </div>
  </div>
  <AlertDialog open={demoDialogOpen} onOpenChange={setDemoDialogOpen}>
    <AlertDialogTrigger asChild>
      <Button variant="destructive" size="sm" className="shrink-0">
        <UserX />
        Remove demo accounts
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-destructive" />
          Remove demo accounts?
        </AlertDialogTitle>
        <AlertDialogDescription>
          {demoAccountsQuery.isLoading ? (
            'Checking for demo accounts…'
          ) : demoAccountsQuery.isError ? (
            'Could not check for demo accounts — try again.'
          ) : (demoAccountsQuery.data?.accounts.length ?? 0) === 0 ? (
            'No demo accounts found. Nothing to remove.'
          ) : (
            <>
              {demoAccountsQuery.data?.accounts.length} account
              {demoAccountsQuery.data?.accounts.length === 1 ? '' : 's'} will be
              permanently deleted:{' '}
              {demoAccountsQuery.data?.accounts.map((a) => a.email).join(', ')}.
              This cannot be undone.
            </>
          )}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={removingDemoAccounts}>
          Cancel
        </AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          onClick={() => removeDemoAccountsMutation.mutate()}
          disabled={
            removingDemoAccounts ||
            demoAccountsQuery.isLoading ||
            (demoAccountsQuery.data?.accounts.length ?? 0) === 0
          }
        >
          {removingDemoAccounts && <Loader2 className="animate-spin" />}
          Remove demo accounts
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</div>
```

- [ ] **Step 2: Manual verification**

Since this touches auth state, verify by hand rather than an automated component test (the existing test suite for this component, if any, doesn't stub `auth.admin` calls):

1. `npm run dev`, sign in as a superadmin, go to `/sis/admin/settings`.
2. Click "Remove demo accounts" — confirm the dialog opens and shows a loading state, then the real count + email list (or "No demo accounts found" if none exist).
3. Cancel — confirm the dialog closes with no network side effect.
4. Click again, confirm the count is still accurate, then click "Remove demo accounts" in the dialog — confirm a success toast with the right count and that `/sis/admin/staff` no longer lists those accounts after the page refresh.
5. Check `/sis/audit-log` (or the SIS audit view) for a `Demo accounts removed` entry with the right email list in context.

- [ ] **Step 3: Run the full build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add components/sis/environment-card.tsx
git commit -m "feat(sis): add Remove demo accounts button to the Environment card"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1 covers the trigger + the KD #119-class regression fix; Task 2 covers both dishonesty findings from the conversation (the insight copy and the false test comment) plus the fallback removal that makes them safe to fix; Tasks 3-5 cover the demo-account cleanup end to end (audit plumbing → route → UI). No open item from the conversation is unaddressed.
- **Deploy ordering is the one cross-task risk:** Task 2 must not ship before Task 1's migration is applied. Flagged in Global Constraints and repeated in Task 1's file header comment so it survives even if someone reads the migration file in isolation later.
- **Placeholder scan:** the only bracketed placeholders left (`<paste a real value from a SELECT "enroleeNumber" limit 1>`) are inside manual SQL verification steps that inherently require live data, not inside code an engineer would blindly copy-paste as a deliverable — consistent with how Task 1 Step 4 already frames it as a "pick a real value" instruction.
