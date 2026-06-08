-- Migration 072 — generate_section_index_numbers (section-tenure bucketing)
--
-- Supersedes migration 071's enum-based bucketing
-- (CASE enrollment_status WHEN 'active' THEN 0 ELSE 1 END).
--
-- PROBLEM with 071: a mid-year TRANSFER is stored as enrollment_status='active'
-- (Hard Rule #6 / KD #67: transfer = withdraw old row + insert NEW active row in
-- destination).  Because its status is 'active' it fell into bucket 0 and was
-- alphabetised into the main sequence instead of being bottom-pinned — even though
-- it joined the section mid-year.
--
-- FIX: bucket by SECTION-TENURE DATE instead of the enum.
--   on-time   → enrollment_date IS NULL OR enrollment_date <= v_t1_start
--             → bucket 0, sorted alphabetically (last, first, middle)
--   mid-year  → enrollment_date > v_t1_start (transfer OR late_enrollee)
--             → bucket 1, sorted by arrival (enrollment_date, then index_number)
--
-- v_t1_start = min(terms.start_date) for the section's AY — the first day the
-- school year opened.  NULL-safe: if no terms exist everyone is treated on-time.
--
-- Everything else is identical to migration 071:
--   • Withdrawn rows are NEVER touched — their index numbers are retired/burned.
--   • Burned-number availability loop — unchanged.
--   • Two-phase negative-index staging — unchanged.
--   • Returns jsonb { rows_renumbered, before, after } — unchanged.
--   • security definer / set search_path = public / grant to authenticated — unchanged.

create or replace function public.generate_section_index_numbers(
  p_section_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- T1 start = earliest term start_date for this section's AY (year open date)
  -- NULL if no terms defined — everyone treated on-time in that edge case
  v_t1_start      date;

  -- burned = index_numbers currently held by withdrawn rows (retired, never reused)
  v_burned        int[];
  -- available = ascending list of positive integers NOT in v_burned
  v_available     int[];
  v_max_needed    int;
  v_i             int;
  v_pos           int;

  -- ordered list of non-withdrawn section_students.id values in the desired order
  v_ordered_ids   uuid[];
  v_row           record;

  v_before        jsonb;
  v_after         jsonb;
  v_count         int := 0;
begin
  -- -----------------------------------------------------------------------
  -- Resolve T1 start: earliest term start_date for the section's AY.
  -- min(start_date) across all terms = the first day of the school year.
  -- NULL-safe: if no terms, v_t1_start remains null and all rows land in
  -- bucket 0 (on-time), preserving full alphabetical ordering.
  -- -----------------------------------------------------------------------
  select min(t.start_date)
  into   v_t1_start
  from   terms t
  join   sections s on s.academic_year_id = t.academic_year_id
  where  s.id = p_section_id;

  -- -----------------------------------------------------------------------
  -- Capture before-state (non-withdrawn rows only, ordered by index_number)
  -- -----------------------------------------------------------------------
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

  -- -----------------------------------------------------------------------
  -- Build the burned-numbers set from withdrawn rows in this section
  -- -----------------------------------------------------------------------
  select coalesce(array_agg(index_number order by index_number), '{}')
  into v_burned
  from section_students
  where section_id = p_section_id
    and enrollment_status = 'withdrawn';

  -- -----------------------------------------------------------------------
  -- Count how many non-withdrawn rows we need to number
  -- -----------------------------------------------------------------------
  select count(*)::int
  into v_count
  from section_students
  where section_id = p_section_id
    and enrollment_status <> 'withdrawn';

  -- If nothing to do, return early
  if v_count = 0 then
    return jsonb_build_object(
      'rows_renumbered', 0,
      'before', coalesce(v_before, '[]'::jsonb),
      'after',  '[]'::jsonb
    );
  end if;

  -- -----------------------------------------------------------------------
  -- Build v_available: the first v_count positive integers not in v_burned.
  -- We scan 1..(v_count + cardinality(v_burned)) — that upper bound is always
  -- enough because at most cardinality(v_burned) numbers are skipped.
  -- -----------------------------------------------------------------------
  v_max_needed := v_count + cardinality(v_burned);
  v_available  := '{}';
  v_i          := 1;

  while cardinality(v_available) < v_count loop
    if v_i > v_max_needed then
      -- Safety guard — should never happen given the math above
      raise exception 'generate_section_index_numbers: ran out of available numbers (section_id=%)', p_section_id;
    end if;
    if not (v_i = any(v_burned)) then
      v_available := v_available || v_i;
    end if;
    v_i := v_i + 1;
  end loop;

  -- -----------------------------------------------------------------------
  -- Collect the ordered list of non-withdrawn row IDs.
  --
  -- Bucket by SECTION-TENURE DATE (not enrollment_status enum):
  --   on-time  (enrollment_date IS NULL  OR  enrollment_date <= v_t1_start)
  --            → bucket 0, sorted alphabetically by (last_name, first_name, middle_name)
  --   mid-year (enrollment_date IS NOT NULL AND enrollment_date > v_t1_start)
  --            → bucket 1, sorted by arrival: enrollment_date then index_number
  --
  -- This correctly bottom-pins TRANSFERS (stored as active with a mid-year date)
  -- as well as late_enrollee rows — both have enrollment_date > v_t1_start.
  --
  -- Name columns are CASE-gated to '' for mid-year rows so they don't sort the
  -- mid-year block alphabetically.  The trailing ss.enrollment_date + ss.index_number
  -- serve as a harmless tiebreaker for the on-time bucket too.
  -- -----------------------------------------------------------------------
  select array_agg(ss.id order by
      -- bucket: 0 = on-time, 1 = mid-year (transfer or late_enrollee)
      (case when ss.enrollment_date is not null
                 and v_t1_start is not null
                 and ss.enrollment_date > v_t1_start
            then 1 else 0 end),
      -- on-time block: alphabetical by name; mid-year block: '' (no-op)
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
      -- mid-year block: arrival order; on-time block: harmless tiebreaker
      ss.enrollment_date,
      ss.index_number
    )
  into v_ordered_ids
  from section_students ss
  join students s on s.id = ss.student_id
  where ss.section_id = p_section_id
    and ss.enrollment_status <> 'withdrawn';

  -- -----------------------------------------------------------------------
  -- Phase 1: flip non-withdrawn rows to negative index_number.
  -- Withdrawn rows are deliberately excluded from this UPDATE.
  -- -----------------------------------------------------------------------
  update section_students
  set index_number = -index_number
  where section_id = p_section_id
    and enrollment_status <> 'withdrawn';

  -- -----------------------------------------------------------------------
  -- Phase 2: assign the available numbers in order.
  -- Walk v_ordered_ids by position; assign v_available[pos].
  -- -----------------------------------------------------------------------
  for v_pos in 1 .. cardinality(v_ordered_ids) loop
    update section_students
    set index_number = v_available[v_pos]
    where id = v_ordered_ids[v_pos];
  end loop;

  -- -----------------------------------------------------------------------
  -- Capture after-state (non-withdrawn rows only)
  -- -----------------------------------------------------------------------
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',                ss.id,
        'student_number',    s.student_number,
        'name',              concat_ws(', ', s.last_name, s.first_name, s.middle_name),
        'new_index',         ss.index_number,
        'enrollment_status', ss.enrollment_status
      )
      order by ss.index_number
    ),
    '[]'::jsonb
  )
  into v_after
  from section_students ss
  join students s on s.id = ss.student_id
  where ss.section_id = p_section_id
    and ss.enrollment_status <> 'withdrawn';

  return jsonb_build_object(
    'rows_renumbered', v_count,
    'before',          v_before,
    'after',           v_after
  );
end;
$$;

comment on function public.generate_section_index_numbers(uuid) is
  'Supersedes migration 071 (enum-bucketed). '
  'Re-numbers non-withdrawn section_students.index_number in a section, '
  'bucketing by SECTION-TENURE DATE: on-time rows (enrollment_date IS NULL or '
  '<= AY T1 start) are sorted alphabetically first; mid-year rows '
  '(enrollment_date > T1 start — transfers stored as active OR late_enrollee) '
  'are bottom-pinned, sorted by arrival date then existing index_number. '
  'WITHDRAWN ROWS ARE INTENTIONALLY NEVER TOUCHED — their index numbers are '
  'retired/burned and must never be reused (HFSE rule). '
  'Burned numbers are skipped when assigning the new sequence. '
  'Two-phase negative-index staging handles the non-deferrable unique(section_id,index_number) constraint. '
  'Returns jsonb { rows_renumbered, before, after } for the audit log.';

grant execute on function public.generate_section_index_numbers(uuid) to authenticated;
