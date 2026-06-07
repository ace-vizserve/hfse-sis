-- Migration 071 — generate_section_index_numbers RPC
--
-- Supersedes the DORMANT realphabetize_section_index_numbers from migration 042.
-- That function renumbered withdrawn rows too (appending them at the bottom),
-- which freed their numbers for reuse — wrong for HFSE: withdrawn index numbers
-- are RETIRED PERMANENTLY and must never be reused.
--
-- Behaviour of the new RPC:
--   1. Withdrawn rows are NEVER touched — their index_number stays fixed.
--   2. Non-withdrawn rows are re-ordered:
--        a. active rows first, sorted alphabetically by (last_name, first_name, middle_name)
--        b. late_enrollee rows second, sorted by their existing index_number
--           (preserving "appended at the bottom in arrival order")
--      Ordering key: CASE enrollment_status WHEN 'active' THEN 0 ELSE 1 END,
--                    then last_name/first_name/middle_name for the ACTIVE block
--                    only (CASE-gated to '' for late rows), then existing
--                    index_number — which orders the late block by arrival.
--   3. Numbers are assigned from the ASCENDING SEQUENCE of positive integers NOT
--      currently held by any withdrawn row in the section. So burned numbers are
--      skipped. At start-of-year (no withdrawn) this yields a clean 1..N; mid-year
--      the gaps left by withdrawn rows are preserved.
--   4. Two-phase negative-index staging is used (same technique as migration 042)
--      because the unique(section_id, index_number) constraint is non-deferrable:
--        Phase 1 — flip all non-withdrawn rows to -index_number (still unique)
--        Phase 2 — assign new positive numbers from the available set
--      Withdrawn rows are never included in either phase.
--   5. Returns jsonb { rows_renumbered int, before jsonb[], after jsonb[] }
--      where before/after contain only the non-withdrawn rows
--      (name, old_index / new_index, enrollment_status) for the audit log.
--
-- Name chosen to avoid confusion with the retired 042 function.

create or replace function public.generate_section_index_numbers(
  p_section_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
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
  --   active rows  : sorted by (last_name, first_name, middle_name) alphabetically
  --   late_enrollee: sorted by their CURRENT index_number (arrival order preserved)
  -- Both share the same status-bucket sort key (0 vs 1); within each bucket the
  -- tiebreaker is index_number so ties inside the active block are stable too.
  -- -----------------------------------------------------------------------
  -- Active rows: bucket 0, sorted alphabetically (last, first, middle), with
  --   existing index_number as a same-name tiebreaker.
  -- Late-enrollee rows: bucket 1, sorted PURELY by existing index_number so
  --   they keep their arrival order at the bottom (HFSE: late enrollees always
  --   append; they are NOT alphabetized into the sequence). The name columns
  --   are CASE-gated to empty for the late block so they don't reorder it.
  select array_agg(ss.id order by
      case ss.enrollment_status when 'active' then 0 else 1 end,
      case ss.enrollment_status when 'active' then s.last_name else '' end,
      case ss.enrollment_status when 'active' then s.first_name else '' end,
      case ss.enrollment_status when 'active' then coalesce(s.middle_name, '') else '' end,
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
  'Supersedes the dormant realphabetize_section_index_numbers (migration 042). '
  'Re-numbers non-withdrawn section_students.index_number in a section, '
  'ordering active rows alphabetically first then late_enrollee rows by arrival order. '
  'WITHDRAWN ROWS ARE INTENTIONALLY NEVER TOUCHED — their index numbers are '
  'retired/burned and must never be reused (HFSE rule). '
  'Burned numbers are skipped when assigning the new sequence. '
  'Two-phase negative-index staging handles the non-deferrable unique(section_id,index_number) constraint. '
  'Returns jsonb { rows_renumbered, before, after } for the audit log.';

grant execute on function public.generate_section_index_numbers(uuid) to authenticated;
