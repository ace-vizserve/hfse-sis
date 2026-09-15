-- 162_student_search_global_rank.sql
--
-- THE DEFECT. `search_students_across_ay` applied its ORDER BY and its LIMIT
-- inside the per-academic-year loop, so both were per-year, not global:
--
--   * p_limit was a cap PER YEAR. Asking for 5 returned up to 5 from each of
--     the three years — 12 rows in the observed run, and up to 150 for the
--     p_limit of 50 the API actually passes.
--   * Ordering was year-descending first, rank second. So the single best
--     match in AY2025 sorted below every AY2027 row regardless of score, and
--     "best match first" — the whole reason for adding ts_rank — was only
--     ever true within a year.
--
-- Found by running the function, not by reading it: the ranking output listed
-- twelve rows under a heading that asked for five, in three clean year blocks.
--
-- THE FIX. Build one UNION ALL across the years and sort and limit ONCE,
-- outside. That also collapses N executed statements into one, so the planner
-- sees the whole job.
--
-- Ties break on `created_at` descending — newest application first, which is
-- what the pre-FTS version did with its `.order('created_at')`. Rank ties are
-- common here because most names share a token, so the tiebreak is doing real
-- work rather than covering an edge case.
--
-- Idempotent. Safe to re-run.

create or replace function public.search_students_across_ay(
  p_query text,
  p_limit int default 50
)
returns table (
  ay_code text,
  enrolee_number text,
  student_number text,
  full_name text,
  level text,
  section text,
  status text,
  rank real
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ay record;
  v_slug text;
  v_trimmed text := btrim(coalesce(p_query, ''));
  v_like text;
  v_tsquery tsquery;
  v_tokens text[];
  v_token text;
  v_parts text[] := '{}';
  v_fts_expr text;
  v_branches text[] := '{}';
begin
  if length(v_trimmed) < 2 then
    return;
  end if;

  -- The user's own % and _ are escaped so "50%" is not a wildcard.
  v_like := '%' || replace(replace(v_trimmed, '%', '\%'), '_', '\_') || '%';

  -- Built by hand rather than with plainto_tsquery, because a type-ahead
  -- needs the LAST token to match as a prefix: typing "Tan Wei" must find
  -- "Tan Wei Ming" before the word is finished. plainto_tsquery cannot
  -- express that and PostgREST cannot send ':*' at all.
  --
  -- Tokens are stripped to alphanumerics because everything else is tsquery
  -- syntax — a name typed as "Tan, Wei" must not be parsed as operators.
  v_tokens := regexp_split_to_array(lower(v_trimmed), '\s+');
  foreach v_token in array v_tokens loop
    v_token := regexp_replace(v_token, '[^a-z0-9]', '', 'g');
    if v_token <> '' then
      v_parts := v_parts || (v_token || ':*');
    end if;
  end loop;

  if array_length(v_parts, 1) is null then
    v_tsquery := to_tsquery('simple', 'zzzznomatchzzzz');
  else
    v_tsquery := to_tsquery('simple', array_to_string(v_parts, ' & '));
  end if;

  -- Collect one SELECT per academic year. Nothing is executed in this loop —
  -- ordering and limiting have to see every year at once, which is the whole
  -- point of this migration.
  --
  -- ⚠ `y.ay_code as code`, not `ay_code`: `ay_code` is an OUT parameter of
  -- this function, and an unqualified reference is ambiguous (fixed in 161).
  for v_ay in
    select y.ay_code as code
    from public.academic_years y
    order by y.ay_code desc
  loop
    v_slug := 'ay' || lower(regexp_replace(v_ay.code, '^AY', '', 'i'));

    if not exists (
      select 1 from pg_tables
      where schemaname = 'public'
        and tablename = v_slug || '_enrolment_applications'
    ) then
      continue;
    end if;

    -- Indexed column when present, equivalent inline expression when not, so
    -- a newly rolled-over AY searches correctly before anyone runs
    -- add_ay_search_fts. Degrades in speed, never in correctness.
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = v_slug || '_enrolment_applications'
        and column_name = 'fts'
    ) then
      v_fts_expr := 'a.fts';
    else
      v_fts_expr := 'to_tsvector(''simple'', coalesce(a."enroleeFullName", ''''))';
    end if;

    v_branches := v_branches || format($q$
      select
        %L::text as ay_code,
        a."enroleeNumber"::text as enrolee_number,
        a."studentNumber"::text as student_number,
        a."enroleeFullName"::text as full_name,
        s."classLevel"::text as level,
        s."classSection"::text as section,
        s."applicationStatus"::text as status,
        ts_rank(%s, $2)::real as rank,
        a.created_at as created_at
      from public.%I a
      left join public.%I s on s."enroleeNumber" = a."enroleeNumber"
      where a."enroleeNumber" is not null
        and (
          %s @@ $2
          or a."enroleeNumber" ilike $1
          or a."studentNumber" ilike $1
        )
    $q$,
      v_ay.code,
      v_fts_expr,
      v_slug || '_enrolment_applications',
      v_slug || '_enrolment_status',
      v_fts_expr
    );
  end loop;

  -- No academic year had a table to search.
  if array_length(v_branches, 1) is null then
    return;
  end if;

  return query execute format($outer$
    select
      t.ay_code, t.enrolee_number, t.student_number, t.full_name,
      t.level, t.section, t.status, t.rank
    from ( %s ) t
    order by t.rank desc, t.created_at desc
    limit $3
  $outer$, array_to_string(v_branches, ' union all '))
  using v_like, v_tsquery, p_limit;
end;
$fn$;

revoke execute on function public.search_students_across_ay(text, int) from public, anon, authenticated;
grant  execute on function public.search_students_across_ay(text, int) to service_role;
