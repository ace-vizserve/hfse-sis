-- Migration 165 — the first score a teacher types is audited too
--
-- THE GAP. Migration 152 moved the ordinary score save into the browser and gave
-- `grade_entries` an audit trigger — `grade_entries_audit_trg` — that writes one
-- `audit_log` row per changed field. It was `after update` only, which was
-- correct on the day: every student had a blank row seeded in advance, so every
-- score, first one included, was an UPDATE.
--
-- Migration 156 stopped seeding those rows. The grid now lists the roster and
-- the FIRST score typed for a student is what creates their row — an upsert that
-- lands as an INSERT. An insert never reached the trigger, so the first mark
-- every student got on every sheet since 156 left no audit row at all. Only the
-- second and later edits were recorded. "Who entered this score" had no answer
-- for exactly the scores most likely to be asked about.
--
-- THE FIX. The same trigger now fires on INSERT as well, and an insert is logged
-- the way an edit is: one row per field that holds something, from blank to the
-- value. A blank row (nothing typed) writes nothing, exactly as a no-op update
-- writes nothing, so `seed_grade_entries_for_sheet` — still called by
-- `create_grading_sheets_for_ay` — does not flood the log.
--
-- WHY `tg_op` AND NOT `old.*` ON AN INSERT. Postgres 11+ reads `old` as null in
-- an insert trigger, so `old.ww_scores` would work — but it reads as a bug to
-- the next person, and it is the kind of thing a Postgres upgrade note changes.
-- The old values are copied into locals once, and are null on an insert on
-- purpose.
--
-- ALSO: THE ROW NOW SAYS WHICH CHILD. The context gains `student_number` and
-- `student_name`, looked up from the entry. The existing keys are unchanged, so
-- every reader of the old shape still works; the activity views simply have a
-- name to show instead of an id.
--
-- STILL SIGNED-IN CALLERS ONLY (`auth.uid()` present). The service-role routes
-- write their own rows, with an approval_reference where one is due — see the
-- note in migration 152 section 4. That is unchanged.
--
-- Idempotent: `create or replace` for both functions, drop-then-create for the
-- trigger. No data is touched. Safe to apply before or after the code that ships
-- alongside it — nothing in the app reads these rows by the new keys.

create or replace function public.log_grade_entry_change(
  p_entry_id  uuid,
  p_sheet_id  uuid,
  p_field     text,
  p_old       text,
  p_new       text,
  p_actor_id  uuid,
  p_email     text,
  p_role      text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_log
    (actor_id, actor_email, actor_role, action, entity_type, entity_id, context)
  select
    p_actor_id,
    coalesce(p_email, 'system'),
    p_role,
    'entry.update',
    'grade_entry',
    p_entry_id,
    jsonb_build_object(
      'grading_sheet_id', p_sheet_id,
      'grade_entry_id',   p_entry_id,
      'field',            p_field,
      'old',              p_old,
      'new',              p_new,
      'was_locked',       false,
      -- Null when the lookup finds nothing; the row is still written.
      'student_number',   s.student_number,
      'student_name',     case
                            when s.id is null then null
                            else trim(both ' ' from
                              coalesce(s.last_name, '') || ', ' || coalesce(s.first_name, ''))
                          end
    )
  from (select 1) as one
  left join public.grade_entries ge    on ge.id = p_entry_id
  left join public.section_students ss on ss.id = ge.section_student_id
  left join public.students s          on s.id = ss.student_id;
$$;

create or replace function public.grade_entries_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text;
  v_role    text;
  v_i       int;
  v_old     numeric;
  v_new     numeric;
  v_len     int;
  -- The row as it was. All null on an insert: every value is "from blank".
  v_old_ww  numeric[];
  v_old_pt  numeric[];
  v_old_qa  numeric;
  v_old_lg  text;
  v_old_na  boolean := false;
begin
  if auth.uid() is null then
    return null;                      -- service role: the route owns the trail
  end if;

  if tg_op = 'UPDATE' then
    v_old_ww := old.ww_scores;
    v_old_pt := old.pt_scores;
    v_old_qa := old.qa_score;
    v_old_lg := old.letter_grade;
    v_old_na := coalesce(old.is_na, false);
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();
  v_role := public.current_user_role();

  -- ww_scores / pt_scores, slot by slot.
  v_len := greatest(
    coalesce(array_length(v_old_ww, 1), 0),
    coalesce(array_length(new.ww_scores, 1), 0)
  );
  for v_i in 1 .. v_len loop
    v_old := v_old_ww[v_i];
    v_new := (new.ww_scores)[v_i];
    if v_old is distinct from v_new then
      perform public.log_grade_entry_change(
        new.id, new.grading_sheet_id,
        'ww_scores[' || (v_i - 1) || ']',
        case when v_old is null then null else trim_scale(v_old)::text end,
        case when v_new is null then null else trim_scale(v_new)::text end,
        auth.uid(), v_email, v_role
      );
    end if;
  end loop;

  v_len := greatest(
    coalesce(array_length(v_old_pt, 1), 0),
    coalesce(array_length(new.pt_scores, 1), 0)
  );
  for v_i in 1 .. v_len loop
    v_old := v_old_pt[v_i];
    v_new := (new.pt_scores)[v_i];
    if v_old is distinct from v_new then
      perform public.log_grade_entry_change(
        new.id, new.grading_sheet_id,
        'pt_scores[' || (v_i - 1) || ']',
        case when v_old is null then null else trim_scale(v_old)::text end,
        case when v_new is null then null else trim_scale(v_new)::text end,
        auth.uid(), v_email, v_role
      );
    end if;
  end loop;

  if v_old_qa is distinct from new.qa_score then
    perform public.log_grade_entry_change(
      new.id, new.grading_sheet_id, 'qa_score',
      case when v_old_qa is null then null else trim_scale(v_old_qa)::text end,
      case when new.qa_score is null then null else trim_scale(new.qa_score)::text end,
      auth.uid(), v_email, v_role
    );
  end if;

  if v_old_lg is distinct from new.letter_grade then
    perform public.log_grade_entry_change(
      new.id, new.grading_sheet_id, 'letter_grade',
      v_old_lg, new.letter_grade,
      auth.uid(), v_email, v_role
    );
  end if;

  -- An insert starts from `false`, the column default, so a new row marked
  -- N/A is logged and an ordinary new row is not.
  if v_old_na is distinct from coalesce(new.is_na, false) then
    perform public.log_grade_entry_change(
      new.id, new.grading_sheet_id, 'is_na',
      lower(v_old_na::text),
      lower(coalesce(new.is_na, false)::text),
      auth.uid(), v_email, v_role
    );
  end if;

  return null;
end;
$$;

drop trigger if exists grade_entries_audit_trg on public.grade_entries;
create trigger grade_entries_audit_trg
  after insert or update on public.grade_entries
  for each row execute function public.grade_entries_audit();
