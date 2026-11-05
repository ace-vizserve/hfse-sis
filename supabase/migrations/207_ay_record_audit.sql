-- 207_ay_record_audit.sql
--
-- Every change to an admissions record that does NOT come through the SIS now
-- leaves an audit row.
--
-- THE GAP THIS CLOSES
--
-- ay{YYYY}_enrolment_applications / _status / _documents are written from four
-- places, and only the SIS logs anything:
--   * the parent portal, from the browser with the parent's token;
--   * the portal's edge functions (recovery link, move student), service role;
--   * Directus, which connects straight to the database;
--   * scripts.
-- So a parent changing a child's name, or staff changing a status in Directus,
-- left nothing behind except an updated date.
--
-- WHAT IS LOGGED
--
-- One `sis.record.change` row per changed row. `context.source` says where it
-- came from:
--   parent_portal       signed in, no staff role. actor_id is the parent.
--   signed_in_staff     signed in with a staff role, outside the SIS's server.
--   function_or_script  service role, not the SIS: portal functions, scripts.
--   direct_database     no token at all: Directus, SQL. actor_email names the
--                       database login, because a trigger cannot see the
--                       Directus user. That is the most it can say.
--
-- The SIS's own writes are skipped, because each one writes a better row itself
-- (named person, stage, reason). `createServiceClient()` marks them with the
-- `x-hfse-app: sis` header. The header only counts together with the service
-- role, so a parent cannot send it to hide a change.
--
-- DEPLOY ORDER: either order works. Until the SIS with the header is deployed,
-- its writes also show here as function_or_script. Extra rows, nothing lost.
--
-- WHAT IS NOT LOGGED
--
-- Values of medical and identity fields: the row says the field changed, not
-- what it held. Same rule as discipline notes and write-ups (presence, never
-- the text). A brand-new row logs that it was created, not all its answers.
-- A deleted row keeps its values, since nothing else will.
--
-- A FAILED AUDIT NEVER BLOCKS THE WRITE. A parent submitting an application must
-- not fail because of this. A failure is raised as a warning in the database log.
--
-- NEW YEARS: `create_ay_admissions_tables` calls `attach_document_slots` last,
-- when all the tables exist, so the attach is called from there. That avoids
-- re-emitting the 400-line function from a stale body (the KD #119 hazard).
--
-- Idempotent. Apply after 206.

-- ─── 1. The trigger ────────────────────────────────────────────────────────
create or replace function public.audit_ay_record_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Not content: keys, the search column, and the stamps
  -- stamp_enrolment_status_touch writes itself.
  v_excluded text[] := array[
    'id','created_at','fts',
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
  -- The row says these changed, never what they held.
  v_private text[] := array[
    'allergies','allergyDetails','asthma','foodAllergies','foodAllergyDetails',
    'heartConditions','epilepsy','diabetes','eczema','otherMedicalConditions',
    'additionalLearningNeeds','otherLearningNeeds','dietaryRestrictions',
    'assessmentMedical','medical','vaccinationInformation',
    'passportNumber','passport','nric','pass','passCodeStudent',
    'fatherPassport','fatherNric','fatherPass',
    'motherPassport','motherNric','motherPass',
    'guardianPassport','guardianNric','guardianPass'
  ];
  v_new jsonb;
  v_old jsonb;
  v_row jsonb;
  v_key text;
  v_changes jsonb := '[]'::jsonb;
  v_jwt_role text;
  v_uid uuid;
  v_role text;
  v_source text;
  v_email text;
  v_headers text;
begin
  begin
    v_jwt_role := auth.role();
    v_headers := nullif(current_setting('request.headers', true), '');

    if v_jwt_role = 'service_role'
       and v_headers is not null
       and (v_headers::jsonb ->> 'x-hfse-app') = 'sis' then
      return null;
    end if;

    if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
    if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
    v_row := coalesce(v_new, v_old);

    if tg_op <> 'INSERT' then
      for v_key in select jsonb_object_keys(v_old) loop
        continue when v_key = any(v_excluded);
        -- A deleted row keeps what it held; empty fields say nothing.
        continue when tg_op = 'DELETE'
          and jsonb_typeof(v_old -> v_key) = 'null';
        continue when tg_op = 'UPDATE'
          and (v_old -> v_key) is not distinct from (v_new -> v_key);
        if v_key = any(v_private) then
          v_changes := v_changes
            || jsonb_build_object('field', v_key, 'private', true);
        else
          v_changes := v_changes || jsonb_build_object(
            'field', v_key,
            'from', v_old -> v_key,
            'to', case when tg_op = 'DELETE' then 'null'::jsonb else v_new -> v_key end
          );
        end if;
      end loop;
      -- Touched, nothing changed (the portal re-saves whole rows).
      if tg_op = 'UPDATE' and jsonb_array_length(v_changes) = 0 then
        return null;
      end if;
    end if;

    v_uid := auth.uid();
    if v_uid is not null then
      v_role := public.current_user_role();
      v_source := case when v_role is null then 'parent_portal' else 'signed_in_staff' end;
      v_email := coalesce(auth.jwt() ->> 'email', '(unknown)');
    elsif v_jwt_role = 'service_role' then
      v_source := 'function_or_script';
      v_email := 'Portal function or script';
    elsif v_jwt_role = 'anon' then
      v_source := 'function_or_script';
      v_email := 'Not signed in';
    else
      v_source := 'direct_database';
      v_email := 'Direct database (' || session_user || ')';
    end if;

    insert into public.audit_log
      (actor_id, actor_email, actor_role, action, entity_type, entity_id, context)
    values (
      v_uid,
      v_email,
      v_role,
      'sis.record.change',
      'enrolment_status',
      v_row ->> 'enroleeNumber',
      jsonb_build_object(
        'ay_code', upper(split_part(tg_table_name, '_', 1)),
        'record', regexp_replace(tg_table_name, '^ay[0-9]{4}_enrolment_', ''),
        'operation', lower(tg_op),
        'source', v_source,
        'enroleeNumber', v_row ->> 'enroleeNumber',
        'studentNumber', v_row ->> 'studentNumber',
        'name', coalesce(v_row ->> 'enroleeFullName', v_row ->> 'enroleeName'),
        'changes', v_changes
      )
    );
  exception when others then
    raise warning '[audit] % on % not logged: %', tg_op, tg_table_name, sqlerrm;
  end;
  return null;
end;
$$;

comment on function public.audit_ay_record_change() is
  'AFTER row trigger on ay{YYYY}_enrolment_applications/_status/_documents. Writes a sis.record.change audit row for every change not made by the SIS itself (the x-hfse-app header, honoured only with the service role). Medical and identity values are never stored. Never blocks the write. Migration 207.';

-- ─── 2. The attach helper ──────────────────────────────────────────────────
create or replace function public.attach_ay_record_audit(p_ay_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text;
begin
  foreach v_table in array array[
    p_ay_slug || '_enrolment_applications',
    p_ay_slug || '_enrolment_status',
    p_ay_slug || '_enrolment_documents'
  ] loop
    if to_regclass(format('public.%I', v_table)) is null then
      continue;
    end if;
    execute format(
      'drop trigger if exists ay_record_audit_trigger on public.%I', v_table
    );
    execute format(
      'create trigger ay_record_audit_trigger after insert or update or delete on public.%I for each row execute function public.audit_ay_record_change()',
      v_table
    );
  end loop;
end;
$$;

revoke all on function public.audit_ay_record_change() from public, anon, authenticated;
revoke all on function public.attach_ay_record_audit(text) from public, anon, authenticated;

-- ─── 3. New years: 182's body verbatim, plus the attach ────────────────────
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
  -- Added by 207. This is the last call create_ay_admissions_tables makes, so
  -- every table of a new year exists by now.
  perform public.attach_ay_record_audit(p_ay_slug);

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

-- ─── 4. Every year that already exists ─────────────────────────────────────
do $$
declare
  v_slug text;
begin
  for v_slug in
    select distinct split_part(tablename, '_', 1)
    from pg_tables
    where schemaname = 'public'
      and tablename ~ '^ay[0-9]{4}_enrolment_(applications|status|documents)$'
  loop
    perform public.attach_ay_record_audit(v_slug);
    raise notice '[207] audit trigger attached to %', v_slug;
  end loop;
end;
$$;
