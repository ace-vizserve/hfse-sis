-- Migration 147 — manual index-number correction + a preview for Generate
--
-- WHY. Until now `generate_section_index_numbers` was the ONLY way to change a
-- section index number, and it is a DERIVATION, not an edit: it recomputes the
-- whole roster from (a) the student's name, (b) enrollment_date vs. the first
-- day of the year, and (c) the burned set held by withdrawn rows. It is
-- deterministic, so when its answer is wrong — a misspelled surname, an
-- enrollment_date the sync stamped as today, a wrongly-withdrawn row that burns
-- a number, or simply a paper register that was never numbered by that rule —
-- running it a second time produces exactly the same wrong answer. There was no
-- second lever and no way to correct one student.
--
-- This migration adds the two halves of the fix:
--
--   1. swap_section_index_numbers(section, enrolment_a, enrolment_b)
--      Exchanges two students' numbers. A swap is a PERMUTATION: the set of
--      numbers held by the section is identical before and after, so it can
--      open no gap, create no duplicate, and un-burn nothing. That is why it is
--      the safe primitive to expose, and why it is the only manual write on
--      index_number in the system.
--
--   2. p_dry_run on generate_section_index_numbers
--      Lets the confirm dialog show the before→after map BEFORE anything is
--      written, so a wrong renumber is seen rather than discovered afterwards.
--
-- SAFETY — why moving a number is cheap. Nothing at runtime identifies a
-- student by index_number. Grades (grade_entries.section_student_id),
-- attendance (attendance_daily / attendance_records .section_student_id) and
-- the per-term rollups all key off the section_students UUID, which a swap does
-- not touch. A swap therefore moves labels, never records. (The one place that
-- resolves a student BY (section, index_number) is the one-off backfill
-- importers under lib/sis/backfill/enrollment/ — scripts, not runtime.)
--
-- WITHDRAWN ROWS ARE STILL UNTOUCHABLE. Their numbers are retired and never
-- reused (HFSE rule, KD #85/#136). A swap that involved one would un-burn a
-- retired number, so both sides must be non-withdrawn — enforced below, not
-- just in the route.
--
-- PURE TS MIRROR: lib/sis/index-ordering.ts :: computeIndexAssignments() is the
-- unit-tested executable spec of the GENERATE ordering rules. This migration
-- does not change those rules, so that mirror stays valid as-is. The swap has
-- its own mirror + tests at lib/sis/index-swap.ts.

-- ---------------------------------------------------------------------------
-- 1. generate_section_index_numbers — add p_dry_run
-- ---------------------------------------------------------------------------
--
-- The 1-arg signature is DROPPED rather than left alongside the new one: with
-- `p_dry_run boolean default false`, keeping both would make a one-argument
-- call ambiguous and every existing caller would start erroring. Callers that
-- pass only p_section_id keep working unchanged against the new signature.
--
-- Two behavioural changes beyond the flag, both additive:
--
--   • `after` is now built from the COMPUTED assignment instead of being read
--     back from the table. A preview and the real run therefore return the same
--     map by construction — a preview that could disagree with the write it is
--     previewing would be worse than no preview at all. Each `after` row also
--     carries `old_index` now, so a caller can diff without joining `before`.
--
--   • `rows_changed` joins `rows_renumbered` in the return. rows_renumbered has
--     always been the COUNT OF NON-WITHDRAWN ROWS, not the number of rows whose
--     value actually moved — a re-run on an already-correct roster reports the
--     full class. The preview needs the honest number ("3 of 28 students move"),
--     and so does the toast. rows_renumbered keeps its old meaning so existing
--     audit rows and the humanizer that reads them are unaffected.

drop function if exists public.generate_section_index_numbers(uuid);

create or replace function public.generate_section_index_numbers(
  p_section_id uuid,
  p_dry_run    boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t1_start      date;
  v_burned        int[];
  v_available     int[];
  v_max_needed    int;
  v_i             int;
  v_pos           int;
  v_ordered_ids   uuid[];
  v_before        jsonb;
  v_after         jsonb;
  v_count         int := 0;
  v_changed       int := 0;
begin
  -- T1 start = earliest term start_date for this section's AY (year open date).
  -- NULL-safe: with no terms everyone lands in bucket 0 (on-time).
  select min(t.start_date)
  into   v_t1_start
  from   terms t
  join   sections s on s.academic_year_id = t.academic_year_id
  where  s.id = p_section_id;

  -- Before-state (non-withdrawn rows only, ordered by current index_number)
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',                ss.id,
        'student_number',    s.student_number,
        'name',              concat_ws(', ', s.last_name, s.first_name, s.middle_name),
        'old_index',         ss.index_number,
        'enrollment_status', ss.enrollment_status
      )
      order by ss.index_number
    ),
    '[]'::jsonb
  )
  into v_before
  from section_students ss
  join students s on s.id = ss.student_id
  where ss.section_id = p_section_id
    and ss.enrollment_status <> 'withdrawn';

  -- Burned numbers = held by withdrawn rows in this section (never reused)
  select coalesce(array_agg(index_number order by index_number), '{}')
  into v_burned
  from section_students
  where section_id = p_section_id
    and enrollment_status = 'withdrawn';

  select count(*)::int
  into v_count
  from section_students
  where section_id = p_section_id
    and enrollment_status <> 'withdrawn';

  if v_count = 0 then
    return jsonb_build_object(
      'rows_renumbered', 0,
      'rows_changed',    0,
      'dry_run',         p_dry_run,
      'before',          coalesce(v_before, '[]'::jsonb),
      'after',           '[]'::jsonb
    );
  end if;

  -- Available = the first v_count positive integers not in v_burned.
  v_max_needed := v_count + cardinality(v_burned);
  v_available  := '{}';
  v_i          := 1;

  while cardinality(v_available) < v_count loop
    if v_i > v_max_needed then
      raise exception 'generate_section_index_numbers: ran out of available numbers (section_id=%)', p_section_id;
    end if;
    if not (v_i = any(v_burned)) then
      v_available := v_available || v_i;
    end if;
    v_i := v_i + 1;
  end loop;

  -- Ordered non-withdrawn row ids, bucketed by SECTION-TENURE DATE:
  --   on-time  (enrollment_date IS NULL OR <= v_t1_start) → alphabetical
  --   mid-year (enrollment_date > v_t1_start)             → bottom, by arrival
  -- Unchanged from migration 072.
  select array_agg(ss.id order by
      (case when ss.enrollment_date is not null
                 and v_t1_start is not null
                 and ss.enrollment_date > v_t1_start
            then 1 else 0 end),
      (case when ss.enrollment_date is not null
                 and v_t1_start is not null
                 and ss.enrollment_date > v_t1_start
            then '' else s.last_name end),
      (case when ss.enrollment_date is not null
                 and v_t1_start is not null
                 and ss.enrollment_date > v_t1_start
            then '' else s.first_name end),
      (case when ss.enrollment_date is not null
                 and v_t1_start is not null
                 and ss.enrollment_date > v_t1_start
            then '' else coalesce(s.middle_name, '') end),
      ss.enrollment_date,
      ss.index_number
    )
  into v_ordered_ids
  from section_students ss
  join students s on s.id = ss.student_id
  where ss.section_id = p_section_id
    and ss.enrollment_status <> 'withdrawn';

  -- After-state, computed (NOT read back) so preview == write by construction.
  -- Must be built before the updates run, since it reads ss.index_number as the
  -- old value.
  select coalesce(jsonb_agg(x.obj order by x.new_index), '[]'::jsonb)
  into v_after
  from (
    -- o.pos is bigint (WITH ORDINALITY); cast explicitly rather than lean on
    -- the assignment cast Postgres applies to array subscripts.
    select v_available[o.pos::int] as new_index,
           jsonb_build_object(
             'id',                ss.id,
             'student_number',    s.student_number,
             'name',              concat_ws(', ', s.last_name, s.first_name, s.middle_name),
             'old_index',         ss.index_number,
             'new_index',         v_available[o.pos::int],
             'enrollment_status', ss.enrollment_status
           ) as obj
    from unnest(v_ordered_ids) with ordinality as o(id, pos)
    join section_students ss on ss.id = o.id
    join students s on s.id = ss.student_id
  ) x;

  -- How many rows actually move (the honest number for the preview + toast).
  select count(*)::int
  into v_changed
  from unnest(v_ordered_ids) with ordinality as o(id, pos)
  join section_students ss on ss.id = o.id
  where ss.index_number is distinct from v_available[o.pos::int];

  if not p_dry_run then
    -- Phase 1: flip non-withdrawn rows negative (still unique, no conflicts).
    -- Required because unique(section_id, index_number) is non-deferrable.
    update section_students
    set index_number = -index_number
    where section_id = p_section_id
      and enrollment_status <> 'withdrawn';

    -- Phase 2: assign the available numbers in computed order.
    for v_pos in 1 .. cardinality(v_ordered_ids) loop
      update section_students
      set index_number = v_available[v_pos]
      where id = v_ordered_ids[v_pos];
    end loop;
  end if;

  return jsonb_build_object(
    'rows_renumbered', v_count,
    'rows_changed',    v_changed,
    'dry_run',         p_dry_run,
    'before',          v_before,
    'after',           v_after
  );
end;
$$;

comment on function public.generate_section_index_numbers(uuid, boolean) is
  'Supersedes the 1-arg form (migrations 071/072). '
  'Re-numbers non-withdrawn section_students.index_number in a section, '
  'bucketing by SECTION-TENURE DATE: on-time rows (enrollment_date IS NULL or '
  '<= AY T1 start) are sorted alphabetically first; mid-year rows '
  '(enrollment_date > T1 start — transfers stored as active OR late_enrollee) '
  'are bottom-pinned, sorted by arrival date then existing index_number. '
  'WITHDRAWN ROWS ARE INTENTIONALLY NEVER TOUCHED — their index numbers are '
  'retired/burned and must never be reused (HFSE rule). '
  'Burned numbers are skipped when assigning the new sequence. '
  'Two-phase negative-index staging handles the non-deferrable unique(section_id,index_number) constraint. '
  'p_dry_run = true computes and returns the same map WITHOUT writing, for the confirm-dialog preview. '
  'Returns jsonb { rows_renumbered, rows_changed, dry_run, before, after }; '
  'rows_renumbered is the non-withdrawn row COUNT, rows_changed is how many actually move.';

-- ---------------------------------------------------------------------------
-- 2. swap_section_index_numbers — the manual correction
-- ---------------------------------------------------------------------------
--
-- Three statements, not one. A single UPDATE setting both rows via CASE would
-- still trip unique(section_id, index_number): the constraint is non-deferrable,
-- so it is checked per row as the statement walks them, and whichever row is
-- written first collides with the other's untouched value. The negative-staging
-- pattern from migrations 042/071/072 (KD #85) is reused: park A on -A, move B
-- into A's vacated slot, then move A into B's.
--
-- Validation is defensive here AND friendly in the route. The route checks
-- first so the admin gets a readable message; these guards exist because the
-- RPC must not be corruptible by a caller that skips them, and because the
-- SELECT ... FOR UPDATE below is what makes the check-then-write atomic against
-- a concurrent transfer or withdrawal.

create or replace function public.swap_section_index_numbers(
  p_section_id  uuid,
  p_enrolment_a uuid,
  p_enrolment_b uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a_index  int;
  v_b_index  int;
  v_a_obj    jsonb;
  v_b_obj    jsonb;
  v_locked   int;
begin
  if p_enrolment_a is null or p_enrolment_b is null or p_section_id is null then
    raise exception 'swap_section_index_numbers: section and both students are required'
      using errcode = '22023';
  end if;

  if p_enrolment_a = p_enrolment_b then
    raise exception 'swap_section_index_numbers: pick two different students'
      using errcode = '22023';
  end if;

  -- Lock both rows before reading them. Ordered by id so two concurrent swaps
  -- over an overlapping pair queue instead of deadlocking.
  --
  -- Two statements because `FOR UPDATE` and an aggregate cannot share a query
  -- level ("FOR UPDATE is not allowed with aggregate functions") — PERFORM
  -- takes the locks, then the count re-reads them under those locks.
  perform 1
  from section_students
  where id in (p_enrolment_a, p_enrolment_b)
    and section_id = p_section_id
  order by id
  for update;

  select count(*)::int
  into v_locked
  from section_students
  where id in (p_enrolment_a, p_enrolment_b)
    and section_id = p_section_id;

  if v_locked <> 2 then
    raise exception 'swap_section_index_numbers: both students must be on this section''s roster'
      using errcode = '22023';
  end if;

  -- Read both sides under the lock.
  select ss.index_number,
         jsonb_build_object(
           'id',             ss.id,
           'student_number', s.student_number,
           'name',           concat_ws(', ', s.last_name, s.first_name, s.middle_name),
           'old_index',      ss.index_number
         )
  into v_a_index, v_a_obj
  from section_students ss
  join students s on s.id = ss.student_id
  where ss.id = p_enrolment_a
    and ss.enrollment_status <> 'withdrawn';

  select ss.index_number,
         jsonb_build_object(
           'id',             ss.id,
           'student_number', s.student_number,
           'name',           concat_ws(', ', s.last_name, s.first_name, s.middle_name),
           'old_index',      ss.index_number
         )
  into v_b_index, v_b_obj
  from section_students ss
  join students s on s.id = ss.student_id
  where ss.id = p_enrolment_b
    and ss.enrollment_status <> 'withdrawn';

  -- A withdrawn row fails the status filter above and arrives here as NULL.
  -- Its number is retired; swapping would put it back in circulation.
  if v_a_obj is null or v_b_obj is null then
    raise exception 'swap_section_index_numbers: a withdrawn student''s number is retired and cannot be swapped'
      using errcode = '22023';
  end if;

  if v_a_index is null or v_b_index is null then
    raise exception 'swap_section_index_numbers: both students must already have a number'
      using errcode = '22023';
  end if;

  -- Negative-index staging (non-deferrable unique constraint).
  update section_students set index_number = -v_a_index where id = p_enrolment_a;
  update section_students set index_number =  v_a_index where id = p_enrolment_b;
  update section_students set index_number =  v_b_index where id = p_enrolment_a;

  return jsonb_build_object(
    'section_id', p_section_id,
    'a', v_a_obj || jsonb_build_object('new_index', v_b_index),
    'b', v_b_obj || jsonb_build_object('new_index', v_a_index)
  );
end;
$$;

comment on function public.swap_section_index_numbers(uuid, uuid, uuid) is
  'Exchange two students'' section index numbers. A swap is a permutation — the '
  'set of numbers held by the section is unchanged, so it opens no gap, creates '
  'no duplicate and un-burns nothing. Both rows must be on the given section and '
  'NON-WITHDRAWN: a withdrawn row''s number is retired and must never re-enter '
  'circulation (HFSE rule, KD #85/#136). Rows are locked FOR UPDATE in id order '
  'before the check, so the validation is atomic against a concurrent transfer or '
  'withdrawal and an overlapping pair queues rather than deadlocks. Writes via '
  'negative-index staging because unique(section_id, index_number) is '
  'non-deferrable. Nothing at runtime identifies a student by index_number — '
  'grades and attendance key off section_students.id — so this moves labels, not '
  'records. Returns jsonb { section_id, a, b } with old_index + new_index each, '
  'for the audit log.';

-- ---------------------------------------------------------------------------
-- 3. Lock both down (migrations 103 + 104)
-- ---------------------------------------------------------------------------
--
-- Supabase grants EXECUTE on new functions in `public` to anon, authenticated
-- and service_role directly, and PUBLIC holds the implicit default on top. In
-- this system `authenticated` INCLUDES PARENTS (KD #11/#165) and every function
-- is a PostgREST endpoint, so a `security definer` function left at its default
-- grants is callable by a parent with RLS doing nothing to stop it — which is
-- exactly how a parent could once have renumbered a class (KD, migration 103).
--
-- Revoke from every role that can reach PostgREST, then re-grant to service_role
-- alone. Both functions are called only through the service client.
-- The 1-arg generate signature was dropped above, taking its grants with it.
-- Safe to re-run.

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.generate_section_index_numbers(uuid, boolean)',
    'public.swap_section_index_numbers(uuid, uuid, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
