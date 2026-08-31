-- 136_pfiles_document_slot_revisions.sql
--
-- Teaches the revision-capture trigger about the eight document slots that
-- migration 135 added, so replacing one of them keeps the copy it replaced.
--
-- THE GAP THIS CLOSES
--
-- `capture_doc_revision()` is an AFTER UPDATE trigger on every
-- ay{YYYY}_enrolment_documents table (033, KD #63). It walks a HARDCODED list
-- of slot keys, and for each one whose URL changed from something to something
-- else it writes the previous URL into `p_file_revisions` — that is how a
-- replaced document keeps its predecessor rather than being silently
-- overwritten.
--
-- That list was written in 033 and has never been extended. 135 added eight
-- new slots (lastSchoolRecommendation, assessmentResult, signedContract,
-- newStudentChecksheet, pfilesChecklist, preCounsellingAck,
-- conditionalEnrolment, lateEnrolmentForm) and did not touch this function, so
-- as things stand a P-Files officer re-uploading a corrected Signed Student
-- Contract overwrites the original with NO copy kept — while doing the same to
-- a birth certificate keeps one. The eight would behave differently from every
-- other document on the same screen, for no reason anybody chose.
--
-- Nothing is lost retroactively: the eight columns were created empty by 135
-- and this lands before any of them has been written, so there is no window in
-- which a replacement went unrecorded.
--
-- WHAT WAS VERIFIED BEFORE WRITING THIS
--
--   * 033 is the CURRENT and ONLY definition of capture_doc_revision().
--     `grep -n "create or replace function public.capture_doc_revision"` over
--     supabase/migrations/*.sql matches 033 and nothing else. 087 RE-ATTACHED
--     the trigger after 050's re-emit dropped it (KD #119) but did not re-emit
--     the function itself, and 099/132/135 re-emit create_ay_admissions_tables,
--     not this.
--   * The body below was NOT retyped. It was extracted from 033 (lines 73-195,
--     md5 604043cb4af3a9bb4ddc8ac3cf593210), edited in place, and diffed back:
--     the only change is ONE added line inside v_slots. Zero deletions, zero
--     modifications elsewhere.
--   * 🔴 EXTENDING THE FUNCTION ALONE WOULD HAVE DONE NOTHING, and this is the
--     trap in this migration. The trigger is created as
--     `after update OF <named column list>`, not a bare `after update` — so it
--     only fires when one of the LISTED columns appears in the UPDATE's SET
--     clause. That list is built by attach_doc_revision_trigger() from its OWN
--     hardcoded v_all_slots array, which is a second copy of the same 16 keys.
--     Extending only capture_doc_revision()'s v_slots leaves a trigger that
--     never fires for the new columns, so the fix would look complete and
--     capture nothing. BOTH functions are re-emitted below, and every existing
--     AY table has its trigger re-attached so the wider column list takes
--     effect on data that already exists.
--   * attach_doc_revision_trigger introspects information_schema before naming
--     a column, and skips any the table lacks — so widening its array is safe
--     even for a table that never got 135. That guard is why this migration
--     does not have to care whether 135 reached every AY.
--   * create_ay_admissions_tables (132/135) is NOT touched. It already calls
--     attach_doc_revision_trigger, so a future AY picks up the wider list for
--     free once this migration has redefined that helper.
--   * v_expiring_slots is deliberately NOT extended. None of the eight expires
--     — they are one-off forms, which is why 135 gave them no {key}Expiry
--     column. Adding them here would make the trigger read a column that does
--     not exist.
--   * The three STP keys (icaPhoto, financialSupportDocs, vaccinationInformation)
--     stay in the list even though KD #96 removed them as slots. Their columns
--     still exist, and a key naming a column nobody writes is inert. Removing
--     them is a separate decision and not this migration's business.
--
-- Idempotent: `create or replace function` is safe to re-run.
--
-- Apply after 135.

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
    'conditionalEnrolment','lateEnrolmentForm'
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
  'AFTER UPDATE trigger on ay{YYYY}_enrolment_documents. Writes the replaced URL into p_file_revisions for every tracked slot (033, KD #63). Slot list extended by 136 to cover the eight P-Files slots added in 135. Enrolled-only.';

-- ─── The attach helper: same eight keys, so the trigger actually FIRES ──────
-- Byte-for-byte from 033 (lines 204-254, md5 aeef93b98327f3bae1cb690d868c3038)
-- with one added line in v_all_slots. The information_schema introspection
-- below is unchanged and is what makes the wider array safe on any table that
-- happens to lack a column.
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
    'conditionalEnrolment','lateEnrolmentForm'
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

-- ─── Re-attach on every AY that already exists ─────────────────────────────
-- The helper above only changes what a FUTURE call produces; the triggers
-- already sitting on ay2025/2026/2027 still carry the old 16-column list until
-- they are dropped and recreated. Walks academic_years, the way 132/135 do —
-- NOT pg_tables, whose 025-era walk matches the two-digit slug and therefore
-- matches zero tables while reporting success.
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
      raise notice '[136] re-attached capture_doc_revision_trigger to %_enrolment_documents', v_ay.slug;
    end if;
  end loop;
end;
$$;
