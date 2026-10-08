-- Migration 186 — archive a grading sheet (and a subject)
--
-- Mr Ace, 2026-10-07/08: three actions on a grading sheet — Switch (185),
-- Archive (any sheet, even with grades; every record kept; can be viewed and
-- restored) and Force delete (ONLY an archived sheet; deletes the sheet and
-- every record on it). Archive replaces the old empty-only "Remove sheet".
-- Plan: docs/superpowers/plans/2026-10-08-grading-sheet-archive.md.
--
-- 1. grading_sheets.archived_at / archived_by.
-- 2. One ACTIVE sheet per (term, section, subject): the table-wide unique
--    constraint becomes a partial unique index on non-archived sheets, so an
--    archived sheet frees its slot.
-- 3. The three bulk-create RPCs (latest bodies: 083, as live) name that index
--    in their ON CONFLICT — an ON CONFLICT on a partial index needs the same
--    `where archived_at is null` predicate. They also stop repairing,
--    resizing and seeding archived sheets (an archived sheet is frozen).
-- 4. KD #230: the best term average never reads an archived sheet, and the
--    cascade never writes one. Bodies are 183/184's, plus that filter only.
-- 5. force_delete_grading_sheet(): snapshot + delete in one transaction.
-- 6. subjects.archived_at / archived_by (Task 6 of the plan).
--
-- grade_entries_derive / compute_quarterly / grade_component_ps untouched
-- (Hard Rule #1).

begin;

-- ---------------------------------------------------------------------------
-- 1. Archive columns
-- ---------------------------------------------------------------------------
alter table public.grading_sheets
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

comment on column public.grading_sheets.archived_at is
  'When the sheet was archived. Archived sheets are invisible wherever grades are read (report cards, Masterfile, dashboards, best term average) except the archive list, the sheet''s own read-only page and audit views. NULL = active.';
comment on column public.grading_sheets.archived_by is
  'Who archived the sheet (auth.users). NULL when active, or when that account was later deleted.';

-- ---------------------------------------------------------------------------
-- 2. One active sheet per (term, section, subject)
-- ---------------------------------------------------------------------------
alter table public.grading_sheets
  drop constraint if exists grading_sheets_term_id_section_id_subject_id_key;

create unique index if not exists grading_sheets_active_slot_key
  on public.grading_sheets (term_id, section_id, subject_id)
  where archived_at is null;

comment on index public.grading_sheets_active_slot_key is
  'One ACTIVE sheet per (term, section, subject). Archived sheets are outside it. ON CONFLICT against it must carry `where archived_at is null`.';

-- ---------------------------------------------------------------------------
-- 3. Bulk create — ON CONFLICT on the partial index; archived sheets frozen
-- ---------------------------------------------------------------------------
create or replace function public.create_grading_sheets_for_ay(p_ay_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
  v_repaired int;
  v_resized int;
  v_seeded int := 0;
  v_sheet record;
begin
  -- Step 1: Insert any missing (term × section × subject) sheets with
  -- defaults from subject_configs. Eligibility (which subjects a section
  -- gets sheets for) resolves through section_subjects — the per-section
  -- subject list (migration 079, level defaults + overrides) — NOT a bare
  -- sections↔subject_configs join on academic_year_id alone, which would
  -- cross every section against every subject in the AY regardless of
  -- level now that subject_configs has no level_id to filter on. Weight
  -- itself resolves by subject_id alone (migration 080 collapse).
  -- An existing ACTIVE sheet holds the slot; an archived one does not (186).
  with candidate as (
    select
      t.id        as term_id,
      s.id        as section_id,
      sc.subject_id as subject_id,
      sc.id       as subject_config_id,
      sc.ww_max_slots as ww_max_slots,
      sc.pt_max_slots as pt_max_slots,
      sc.qa_max as qa_max
    from public.sections s
    join public.section_subjects ss
      on ss.section_id = s.id
    join public.subject_configs sc
      on sc.id = ss.subject_config_id
    join public.terms t
      on t.academic_year_id = s.academic_year_id
    where s.academic_year_id = p_ay_id
  ),
  ins as (
    insert into public.grading_sheets
      (term_id, section_id, subject_id, subject_config_id, is_locked,
       ww_totals, pt_totals, qa_total)
    select
      term_id, section_id, subject_id, subject_config_id, false,
      array_fill(10::numeric, array[ww_max_slots]),
      array_fill(10::numeric, array[pt_max_slots]),
      qa_max
    from candidate
    on conflict (term_id, section_id, subject_id) where archived_at is null do nothing
    returning id, section_id
  )
  select count(*) into v_inserted from ins;

  -- Step 2: Repair pre-existing sheets that were created before this
  -- RPC's defaults logic was in place. Only touches sheets in the
  -- unconfigured-default state (empty arrays AND null qa_total) so any
  -- registrar-customized sheet keeps its values. Archived sheets are frozen.
  with repair as (
    update public.grading_sheets gs
    set
      ww_totals = array_fill(10::numeric, array[sc.ww_max_slots]),
      pt_totals = array_fill(10::numeric, array[sc.pt_max_slots]),
      qa_total = sc.qa_max
    from public.subject_configs sc, public.sections s
    where gs.subject_config_id = sc.id
      and gs.section_id = s.id
      and s.academic_year_id = p_ay_id
      and gs.archived_at is null
      and coalesce(array_length(gs.ww_totals, 1), 0) = 0
      and coalesce(array_length(gs.pt_totals, 1), 0) = 0
      and gs.qa_total is null
    returning gs.id
  )
  select count(*) into v_repaired from repair;

  -- Step 3: Resize existing grade_entries score arrays whose ww_scores /
  -- pt_scores are still empty so they match the (now-defaulted) sheet's
  -- slot count. Without this step, entries created before step 2 would
  -- carry length-0 score arrays forever and the grid would render
  -- columns but no fillable cells. Only touches entries with empty
  -- arrays — registrar/teacher-saved scores are not affected.
  with resize as (
    update public.grade_entries ge
    set
      ww_scores = array_fill(null::numeric, array[coalesce(array_length(gs.ww_totals, 1), 0)]),
      pt_scores = array_fill(null::numeric, array[coalesce(array_length(gs.pt_totals, 1), 0)])
    from public.grading_sheets gs, public.sections s
    where ge.grading_sheet_id = gs.id
      and gs.section_id = s.id
      and s.academic_year_id = p_ay_id
      and gs.archived_at is null
      and coalesce(array_length(ge.ww_scores, 1), 0) = 0
      and coalesce(array_length(ge.pt_scores, 1), 0) = 0
      and (
        coalesce(array_length(gs.ww_totals, 1), 0) > 0
        or coalesce(array_length(gs.pt_totals, 1), 0) > 0
      )
    returning ge.id
  )
  select count(*) into v_resized from resize;

  -- Step 4: Seed entries for every ACTIVE sheet in this AY (covers both
  -- newly-inserted sheets AND any pre-existing ones whose roster has changed
  -- since generate). Idempotent — ON CONFLICT DO NOTHING.
  for v_sheet in
    select gs.id as sheet_id, gs.section_id
    from public.grading_sheets gs
    join public.sections s on s.id = gs.section_id
    where s.academic_year_id = p_ay_id
      and gs.archived_at is null
  loop
    perform public.seed_grade_entries_for_sheet(v_sheet.sheet_id, v_sheet.section_id);
    v_seeded := v_seeded + 1;
  end loop;

  return jsonb_build_object(
    'ay_id', p_ay_id,
    'inserted', coalesce(v_inserted, 0),
    'repaired_unconfigured_sheets', coalesce(v_repaired, 0),
    'resized_entry_arrays', coalesce(v_resized, 0),
    'sheets_seeded', v_seeded
  );
end;
$$;

create or replace function public.create_grading_sheets_for_scopes(p_scopes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope        jsonb;
  v_section_id   uuid;
  v_subject_id   uuid;
  v_term_id      uuid;
  v_config_id    uuid;
  v_ww_slots     int;
  v_pt_slots     int;
  v_qa_max       int;
  v_new_sheet_id uuid;
  v_inserted     int := 0;
begin
  for v_scope in select value from jsonb_array_elements(p_scopes)
  loop
    v_section_id := (v_scope->>'section_id')::uuid;
    v_subject_id := (v_scope->>'subject_id')::uuid;
    v_term_id    := (v_scope->>'term_id')::uuid;

    -- Derive subject config from the section's AY + the scope's subject —
    -- one weight row per (subject, AY) now (migration 080), so no level
    -- join is needed to disambiguate.
    select sc.id, sc.ww_max_slots, sc.pt_max_slots, sc.qa_max
      into v_config_id, v_ww_slots, v_pt_slots, v_qa_max
      from public.subject_configs sc
      join public.sections s on s.academic_year_id = sc.academic_year_id
     where s.id = v_section_id
       and sc.subject_id = v_subject_id
     limit 1;

    if not found then
      continue; -- no config for this scope, skip silently
    end if;

    -- Insert sheet (ON CONFLICT DO NOTHING — idempotent). An existing ACTIVE
    -- sheet holds the slot; an archived one does not (186).
    insert into public.grading_sheets (
      section_id, subject_id, term_id, subject_config_id,
      ww_totals, pt_totals, qa_total
    )
    values (
      v_section_id, v_subject_id, v_term_id, v_config_id,
      array(select 10::numeric from generate_series(1, v_ww_slots)),
      array(select 10::numeric from generate_series(1, v_pt_slots)),
      v_qa_max
    )
    on conflict (section_id, subject_id, term_id) where archived_at is null do nothing
    returning id into v_new_sheet_id;

    if v_new_sheet_id is not null then
      v_inserted := v_inserted + 1;

      -- Seed null-filled grade_entries for active + late-enrolled students
      insert into public.grade_entries (
        grading_sheet_id, section_student_id, ww_scores, pt_scores
      )
      select
        v_new_sheet_id,
        ss.id,
        array(select null::numeric from generate_series(1, v_ww_slots)),
        array(select null::numeric from generate_series(1, v_pt_slots))
      from public.section_students ss
      where ss.section_id = v_section_id
        and ss.enrollment_status in ('active', 'late_enrollee')
      on conflict (grading_sheet_id, section_student_id) do nothing;
    end if;

  end loop;

  return jsonb_build_object('inserted', v_inserted);
end;
$$;

create or replace function public.create_grading_sheets_for_section(p_section_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
  v_repaired int;
  v_resized int;
  v_seeded int := 0;
  v_sheet record;
begin
  -- Step 1: Insert any missing sheets with defaults. Eligibility resolves
  -- through section_subjects, same reasoning as create_grading_sheets_for_ay
  -- above — a bare sections↔subject_configs join on academic_year_id alone
  -- would pull in every subject in the AY regardless of level.
  -- An existing ACTIVE sheet holds the slot; an archived one does not (186).
  with candidate as (
    select
      t.id        as term_id,
      s.id        as section_id,
      sc.subject_id as subject_id,
      sc.id       as subject_config_id,
      sc.ww_max_slots as ww_max_slots,
      sc.pt_max_slots as pt_max_slots,
      sc.qa_max as qa_max
    from public.sections s
    join public.section_subjects ss
      on ss.section_id = s.id
    join public.subject_configs sc
      on sc.id = ss.subject_config_id
    join public.terms t
      on t.academic_year_id = s.academic_year_id
    where s.id = p_section_id
  ),
  ins as (
    insert into public.grading_sheets
      (term_id, section_id, subject_id, subject_config_id, is_locked,
       ww_totals, pt_totals, qa_total)
    select
      term_id, section_id, subject_id, subject_config_id, false,
      array_fill(10::numeric, array[ww_max_slots]),
      array_fill(10::numeric, array[pt_max_slots]),
      qa_max
    from candidate
    on conflict (term_id, section_id, subject_id) where archived_at is null do nothing
    returning id, section_id
  )
  select count(*) into v_inserted from ins;

  -- Step 2: Repair pre-existing unconfigured sheets in place (active only).
  with repair as (
    update public.grading_sheets gs
    set
      ww_totals = array_fill(10::numeric, array[sc.ww_max_slots]),
      pt_totals = array_fill(10::numeric, array[sc.pt_max_slots]),
      qa_total = sc.qa_max
    from public.subject_configs sc
    where gs.subject_config_id = sc.id
      and gs.section_id = p_section_id
      and gs.archived_at is null
      and coalesce(array_length(gs.ww_totals, 1), 0) = 0
      and coalesce(array_length(gs.pt_totals, 1), 0) = 0
      and gs.qa_total is null
    returning gs.id
  )
  select count(*) into v_repaired from repair;

  -- Step 3: Resize empty entry score arrays for active sheets in this section.
  with resize as (
    update public.grade_entries ge
    set
      ww_scores = array_fill(null::numeric, array[coalesce(array_length(gs.ww_totals, 1), 0)]),
      pt_scores = array_fill(null::numeric, array[coalesce(array_length(gs.pt_totals, 1), 0)])
    from public.grading_sheets gs
    where ge.grading_sheet_id = gs.id
      and gs.section_id = p_section_id
      and gs.archived_at is null
      and coalesce(array_length(ge.ww_scores, 1), 0) = 0
      and coalesce(array_length(ge.pt_scores, 1), 0) = 0
      and (
        coalesce(array_length(gs.ww_totals, 1), 0) > 0
        or coalesce(array_length(gs.pt_totals, 1), 0) > 0
      )
    returning ge.id
  )
  select count(*) into v_resized from resize;

  -- Step 4: Seed entries for every ACTIVE sheet on this section.
  for v_sheet in
    select id as sheet_id
    from public.grading_sheets
    where section_id = p_section_id
      and archived_at is null
  loop
    perform public.seed_grade_entries_for_sheet(v_sheet.sheet_id, p_section_id);
    v_seeded := v_seeded + 1;
  end loop;

  return jsonb_build_object(
    'section_id', p_section_id,
    'inserted', coalesce(v_inserted, 0),
    'repaired_unconfigured_sheets', coalesce(v_repaired, 0),
    'resized_entry_arrays', coalesce(v_resized, 0),
    'sheets_seeded', v_seeded
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. KD #230 — the best term average and the cascade skip archived sheets
-- ---------------------------------------------------------------------------
-- Body as 183, plus `gs.archived_at is null` (an archived sheet is never a
-- source). best_term_averages_for_sheet is unchanged: it reads entries of
-- the one sheet it is given and calls this function.
create or replace function public.student_best_term_average(
  p_student_id       uuid,
  p_academic_year_id uuid
)
returns table (best numeric, term_number smallint)
language sql
stable
security definer
set search_path = public
as $$
  with one_per_subject as (
    select distinct on (t.term_number, gs.subject_id)
           t.term_number, ge.quarterly_grade
      from grade_entries ge
      join grading_sheets gs   on gs.id = ge.grading_sheet_id
      join terms t             on t.id = gs.term_id
      join subjects s          on s.id = gs.subject_id
      join section_students ss on ss.id = ge.section_student_id
     where ss.student_id = p_student_id
       and t.academic_year_id = p_academic_year_id
       and t.term_number between 1 and 3
       and s.is_examinable
       -- a framework sheet is never a source, whatever term it sits on
       and gs.sheet_type = 'standard'
       -- nor is an archived sheet (186)
       and gs.archived_at is null
       and not ge.is_na
       and ge.quarterly_grade is not null
     order by t.term_number, gs.subject_id,
              (ss.enrollment_status = 'withdrawn'), ge.updated_at desc
  )
  select round(avg(quarterly_grade)::numeric, 1) as best, term_number
    from one_per_subject
   group by term_number
   order by 1 desc, term_number desc
   limit 1;
$$;

-- Body as 184, plus `gs.archived_at is null` on the targets (an archived
-- Term 4 sheet is frozen).
create or replace function public.grade_entries_best_term_cascade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_term    smallint;
  v_ay      uuid;
  v_student uuid;
  v_type    text;
begin
  if tg_op = 'UPDATE'
     and new.quarterly_grade is not distinct from old.quarterly_grade
     and new.is_na = old.is_na then
    return null;
  end if;
  -- Bare seeding rows carry no grade; nothing to cascade.
  if tg_op = 'INSERT' and new.quarterly_grade is null then
    return null;
  end if;

  select t.term_number, t.academic_year_id, gs.sheet_type into v_term, v_ay, v_type
    from grading_sheets gs join terms t on t.id = gs.term_id
   where gs.id = new.grading_sheet_id;
  -- Recursion guard: a term4_framework row never cascades (nothing in the DB
  -- ties that sheet type to term 4).
  if v_type = 'term4_framework' then
    return null;
  end if;
  if v_term is null or v_term not between 1 and 3 then
    return null;
  end if;

  select student_id into v_student from section_students where id = new.section_student_id;

  update grade_entries ge
     set updated_at = now()
    from grading_sheets gs, terms t, section_students ss
   where ge.grading_sheet_id = gs.id
     and gs.term_id = t.id
     and gs.sheet_type = 'term4_framework'
     and gs.archived_at is null
     and t.term_number = 4
     and t.academic_year_id = v_ay
     and ss.id = ge.section_student_id
     and ss.student_id = v_student;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Force delete an ARCHIVED sheet
-- ---------------------------------------------------------------------------
-- Called by DELETE /api/grading-sheets/[id] with the service role. One
-- transaction: lock the sheet, refuse unless it exists and is archived
-- (SQLSTATE HFARC), snapshot the sheet row + its entries + change requests +
-- grade_audit_log rows, then delete grade_audit_log (FK RESTRICT) →
-- grade_change_requests (FK CASCADE, deleted explicitly so the counts are
-- exact) → grade_entries (FK RESTRICT) → the sheet. The route writes the
-- returned snapshot into one `audit_log` row (`sheet.force_delete`);
-- audit_log rows are never deleted. No trigger fires on these DELETEs
-- (grade_entries' audit/derive/fill/cascade triggers are INSERT/UPDATE only).
create or replace function public.force_delete_grading_sheet(p_sheet_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sheet    public.grading_sheets%rowtype;
  v_entries  jsonb;
  v_requests jsonb;
  v_history  jsonb;
  v_n_entries  int;
  v_n_requests int;
  v_n_history  int;
begin
  select * into v_sheet from public.grading_sheets where id = p_sheet_id for update;
  if not found then
    raise exception 'That grading sheet no longer exists.' using errcode = 'HFARC';
  end if;
  if v_sheet.archived_at is null then
    raise exception 'Archive the sheet first.' using errcode = 'HFARC';
  end if;

  select coalesce(jsonb_agg(to_jsonb(ge) order by ge.created_at, ge.id), '[]'::jsonb)
    into v_entries
    from public.grade_entries ge
   where ge.grading_sheet_id = p_sheet_id;

  select coalesce(jsonb_agg(to_jsonb(cr) order by cr.requested_at, cr.id), '[]'::jsonb)
    into v_requests
    from public.grade_change_requests cr
   where cr.grading_sheet_id = p_sheet_id
      or cr.grade_entry_id in (select id from public.grade_entries where grading_sheet_id = p_sheet_id);

  select coalesce(jsonb_agg(to_jsonb(gal) order by gal.changed_at, gal.id), '[]'::jsonb)
    into v_history
    from public.grade_audit_log gal
   where gal.grading_sheet_id = p_sheet_id
      or gal.grade_entry_id in (select id from public.grade_entries where grading_sheet_id = p_sheet_id);

  delete from public.grade_audit_log gal
   where gal.grading_sheet_id = p_sheet_id
      or gal.grade_entry_id in (select id from public.grade_entries where grading_sheet_id = p_sheet_id);
  get diagnostics v_n_history = row_count;

  delete from public.grade_change_requests cr
   where cr.grading_sheet_id = p_sheet_id
      or cr.grade_entry_id in (select id from public.grade_entries where grading_sheet_id = p_sheet_id);
  get diagnostics v_n_requests = row_count;

  delete from public.grade_entries where grading_sheet_id = p_sheet_id;
  get diagnostics v_n_entries = row_count;

  delete from public.grading_sheets where id = p_sheet_id;

  return jsonb_build_object(
    'sheet',           to_jsonb(v_sheet),
    'entries',         v_entries,
    'change_requests', v_requests,
    'grade_audit_log', v_history,
    'counts', jsonb_build_object(
      'entries',         v_n_entries,
      'change_requests', v_n_requests,
      'grade_audit_log', v_n_history
    )
  );
end;
$$;

revoke all on function public.force_delete_grading_sheet(uuid) from public, anon, authenticated;
grant execute on function public.force_delete_grading_sheet(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Subjects get the same archive (plan Task 6)
-- ---------------------------------------------------------------------------
alter table public.subjects
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

comment on column public.subjects.archived_at is
  'When the subject was archived. Archived subjects leave the catalog and every picker that offers a subject for NEW use; classes and grades that already use it are untouched. NULL = active.';
comment on column public.subjects.archived_by is
  'Who archived the subject (auth.users). NULL when active, or when that account was later deleted.';

commit;
