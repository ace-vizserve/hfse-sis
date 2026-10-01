-- 182_pfiles_document_slots_round_two.sql
--
-- Adds four more school-form slots to every ay{YYYY}_enrolment_documents
-- table, and teaches the revision trigger about them:
--
--   letterOfOffer        Letter of Offer
--   mediaConsent         Student Media Consent and Release Form
--   whatsappConsent      WhatsApp
--   orientationChecklist Orientation Checklist
--
-- WHERE THE LIST CAME FROM
--
-- Mr Ace, 2026-10-01, pasted the school's new-student document list and asked
-- which were already on P-Files. Ten were; these four were not. "add the 4
-- missing ones as school forms".
--
-- SAME SHAPE AS 135
--
-- Two columns per slot, "{key}" text (file URL) + "{key}Status" character
-- varying, and NO "{key}Expiry" — none of the four expire. Nullable, no
-- default, so every existing row reads exactly as before. Which students are
-- asked for them is decided in lib/p-files/document-config.ts, not here.
--
-- HOW
--
--   1. attach_document_slots (135) is re-emitted with the four keys appended
--      to its array. Its body is otherwise 135's verbatim. create_ay_admissions
--      _tables already calls it, so a future AY gets all twelve for free and
--      that function is NOT touched.
--   2. Every existing AY is healed by the same academic_years walk 135 used.
--   3. capture_doc_revision AND attach_doc_revision_trigger (136) are both
--      re-emitted with the four keys appended. BOTH, because the trigger is
--      `after update OF <column list>` and that list comes from the attach
--      helper's own copy of the keys — extending only capture_doc_revision
--      would leave a trigger that never fires for the new columns (136's
--      header). Bodies otherwise 136's verbatim.
--   4. The trigger is re-attached on every existing AY so the wider column
--      list takes effect.
--
-- Idempotent throughout and safe to re-run whole.
--
-- Apply after 181.

-- ─── 1. The slot helper, four keys longer ──────────────────────────────────
create or replace function public.attach_document_slots(p_ay_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_documents text := p_ay_slug || '_enrolment_documents';
  v_slot text;
  -- Keyed exactly as lib/p-files/document-config.ts keys them. Each one
  -- becomes two columns: "{key}" for the file URL and "{key}Status" for the
  -- status string. No expiry column -- none of these expire.
  v_slots text[] := array[
    'lastSchoolRecommendation',  -- Last School Recommendation and Good Moral
    'assessmentResult',          -- Assessment Result and Interview
    'signedContract',            -- Signed Student Contract
    'newStudentChecksheet',      -- New Student Checksheet
    'pfilesChecklist',           -- Student P-Files Checklist
    'preCounsellingAck',         -- Pre-Counselling Acknowledgement Form
    'conditionalEnrolment',      -- Conditional Enrolment
    'lateEnrolmentForm',         -- Late Enrolment Form
    -- Added by 182.
    'letterOfOffer',             -- Letter of Offer
    'mediaConsent',              -- Student Media Consent and Release Form
    'whatsappConsent',           -- WhatsApp
    'orientationChecklist'       -- Orientation Checklist
  ];
begin
  if to_regclass(format('public.%I', v_documents)) is null then
    return;  -- no such AY documents table; nothing to attach
  end if;

  foreach v_slot in array v_slots loop
    execute format(
      'alter table public.%I add column if not exists %I text',
      v_documents,
      v_slot
    );

    execute format(
      'alter table public.%I add column if not exists %I character varying',
      v_documents,
      v_slot || 'Status'
    );
  end loop;
end;
$$;

comment on function public.attach_document_slots(text) is
  'Add the twelve non-expiring P-Files school-form slots to ay{YYYY}_enrolment_documents: eight from 135 (lastSchoolRecommendation, assessmentResult, signedContract, newStudentChecksheet, pfilesChecklist, preCounsellingAck, conditionalEnrolment, lateEnrolmentForm) and four from 182 (letterOfOffer, mediaConsent, whatsappConsent, orientationChecklist). Two columns each ("{key}" text + "{key}Status" character varying); no expiry column. Idempotent. Called automatically by create_ay_admissions_tables since migration 135.';

revoke all on function public.attach_document_slots(text) from public;
grant execute on function public.attach_document_slots(text) to service_role;

-- ─── 2. Heal every AY table set that already exists ────────────────────────
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

-- ─── 3a. The revision trigger function, four keys longer ───────────────────
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
    'icaPhoto','financialSupportDocs','vaccinationInformation',
    -- Added by 135 (P-Files officer uploads; none of these expire).
    'lastSchoolRecommendation','assessmentResult','signedContract',
    'newStudentChecksheet','pfilesChecklist','preCounsellingAck',
    'conditionalEnrolment','lateEnrolmentForm',
    -- Added by 182 (same kind).
    'letterOfOffer','mediaConsent','whatsappConsent','orientationChecklist'
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

comment on function public.capture_doc_revision is
  'AFTER UPDATE trigger on ay{YYYY}_enrolment_documents. Writes the replaced URL into p_file_revisions for every tracked slot (033, KD #63). Slot list extended by 136 (eight P-Files slots from 135) and 182 (four more). Enrolled-only.';

-- ─── 3b. The attach helper, same four keys, so the trigger actually FIRES ──
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
    'icaPhoto','financialSupportDocs','vaccinationInformation',
    -- Added by 135 (P-Files officer uploads; none of these expire).
    'lastSchoolRecommendation','assessmentResult','signedContract',
    'newStudentChecksheet','pfilesChecklist','preCounsellingAck',
    'conditionalEnrolment','lateEnrolmentForm',
    -- Added by 182 (same kind).
    'letterOfOffer','mediaConsent','whatsappConsent','orientationChecklist'
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

-- ─── 4. Re-attach on every AY that already exists ──────────────────────────
do $$
declare
  v_ay record;
begin
  for v_ay in
    select lower('ay' || replace(upper(ay_code), 'AY', '')) as slug
    from academic_years
  loop
    if to_regclass(format('public.%I', v_ay.slug || '_enrolment_documents')) is not null then
      perform public.attach_doc_revision_trigger(v_ay.slug || '_enrolment_documents');
      raise notice '[182] re-attached capture_doc_revision_trigger to %_enrolment_documents', v_ay.slug;
    end if;
  end loop;
end;
$$;
