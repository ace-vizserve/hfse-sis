-- 160_student_search_fts.sql
--
-- Cross-AY student search becomes ONE query instead of one per column per
-- academic year.
--
-- THE PROBLEM. `searchStudentsAcrossAY` (lib/sis/queries.ts) issues five
-- `.ilike('%term%')` calls — one per searched column — against every AY's
-- applications table, then a status lookup per AY, then unions/sorts/caps the
-- result lists in JavaScript. That is `1 + (academic_years * 6)` requests for
-- a single search, and it grows by six every AY rollover, permanently. It is
-- five calls rather than one `.or()` because `.or()`'s argument is a PostgREST
-- filter DSL where `,` is grammar: a search for "Tan, Wei Ming" corrupted the
-- condition list and silently returned nothing.
--
-- WHAT THIS CHANGES. A generated `fts` column per applications table plus one
-- SECURITY DEFINER function that loops the academic years server-side. The
-- app makes one call. The count no longer scales with the number of years.
--
-- WHAT IS SEARCHED — three things, deliberately:
--   1. "enroleeFullName" via full-text search.
--   2. "enroleeNumber"  via ILIKE.
--   3. "studentNumber"  via ILIKE.
--
-- WHY THE IDENTIFIERS STAY OUT OF THE TSVECTOR. `to_tsvector` does not treat
-- '2024-0117' as an identifier, and identifier lookup has to stay exact —
-- "studentNumber" is the only stable student ID (Hard Rule #4) and the one key
-- cross-year linking runs on. Names want fuzzy matching; keys do not.
--
-- WHY 'simple' AND NOT 'english'. The 'english' configuration stems words.
-- Names are not English words, and stemming them changes matches for no gain
-- (the Supabase guide's examples all use 'english' because it searches prose).
--
-- WHY A GENERATED COLUMN rather than `to_tsvector(...)` in the predicate: a
-- generated column is maintained by Postgres on every write, so the index can
-- never drift from the data, and the parent portal writes these rows without
-- knowing this column exists.
--
-- Idempotent — `if not exists` throughout. Safe to re-run.
--
-- ⚠ DEPLOY ORDER: this migration BEFORE the code that calls the function.
-- Applied alone it is inert: it adds a column and a function nothing calls
-- yet, and the existing ILIKE path keeps working untouched. The reverse order
-- would have the app calling a function that does not exist.

-- =====================================================================
-- 1. Backfill: fts column + GIN index on every existing AY applications table
-- =====================================================================
--
-- Walks pg_tables the same way 025 does. Tables are created per AY by the
-- rollover wizard, so their names are not knowable statically.

do $$
declare
  v_row record;
begin
  for v_row in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
      and tablename ~ '^ay[0-9]{2}_enrolment_applications$'
  loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = v_row.schemaname
        and table_name = v_row.tablename
        and column_name = 'fts'
    ) then
      execute format($ddl$
        alter table %I.%I
        add column fts tsvector
        generated always as (
          to_tsvector('simple', coalesce("enroleeFullName", ''))
        ) stored;
      $ddl$, v_row.schemaname, v_row.tablename);
    end if;

    execute format(
      'create index if not exists %I on %I.%I using gin (fts);',
      v_row.tablename || '_fts_idx', v_row.schemaname, v_row.tablename
    );
  end loop;
end $$;

-- =====================================================================
-- 2. The search function
-- =====================================================================
--
-- One call, every academic year. Returns at most p_limit rows, best match
-- first, newest academic year breaking ties.
--
-- ⚠ The table names are per-AY, so the body is dynamic SQL — the same
-- `execute format` shape 012 and 025 already use. Every interpolated
-- identifier goes through %I; the user's search text is NEVER interpolated,
-- it is passed as a bind parameter ($1/$2) to the executed statement. That is
-- what makes this immune to the comma problem that killed the `.or()` version.

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
begin
  -- Mirrors the route's own guard; a 1-character search would scan everything.
  if length(v_trimmed) < 2 then
    return;
  end if;

  -- ILIKE pattern for the identifier columns. The user's own % and _ are
  -- escaped so a search for "50%" is not a wildcard.
  v_like := '%' || replace(replace(v_trimmed, '%', '\%'), '_', '\_') || '%';

  -- Build the tsquery by hand rather than with plainto_tsquery, because a
  -- type-ahead needs the LAST token to match as a prefix: typing "Tan Wei"
  -- must find "Tan Wei Ming" before you finish the word. plainto_tsquery has
  -- no way to express that, and the PostgREST client cannot send ':*' at all,
  -- which is the other reason this lives in a function.
  --
  -- Tokens are stripped to alphanumerics: anything else is tsquery syntax
  -- (&, |, !, :, parens) and a name like "Tan, Wei" must not be parsed as it.
  v_tokens := regexp_split_to_array(lower(v_trimmed), '\s+');
  foreach v_token in array v_tokens loop
    v_token := regexp_replace(v_token, '[^a-z0-9]', '', 'g');
    if v_token <> '' then
      v_parts := v_parts || (v_token || ':*');
    end if;
  end loop;

  if array_length(v_parts, 1) is null then
    -- Nothing searchable survived (e.g. the query was all punctuation). The
    -- identifier ILIKE below can still match, so fall back to a query that
    -- matches no name rather than returning early.
    v_tsquery := to_tsquery('simple', 'zzzznomatchzzzz');
  else
    v_tsquery := to_tsquery('simple', array_to_string(v_parts, ' & '));
  end if;

  for v_ay in
    select ay_code from public.academic_years order by ay_code desc
  loop
    v_slug := 'ay' || lower(regexp_replace(v_ay.ay_code, '^AY', '', 'i'));

    -- Skip an AY whose tables the wizard has not created yet, rather than
    -- failing the whole search for the years that do exist.
    if not exists (
      select 1 from pg_tables
      where schemaname = 'public'
        and tablename = v_slug || '_enrolment_applications'
    ) then
      continue;
    end if;

    -- ⚠ DO NOT require the generated column to exist.
    --
    -- The AY-setup wizard builds next year's tables from migration 012's
    -- template, which knows nothing about `fts`. If this function demanded
    -- the column, a new academic year's students would become unfindable by
    -- name with no error at all — a silent outage one rollover from now, and
    -- exactly the kind of lockstep trap that only bites long after the commit.
    --
    -- So: use the indexed column when it is there, and an equivalent inline
    -- expression when it is not. A fresh AY searches correctly from the moment
    -- its tables exist; running `add_ay_search_fts` below then adds the index
    -- and makes it fast. Degrades in speed, never in correctness.
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

    return query execute format($q$
      select
        %L::text as ay_code,
        a."enroleeNumber"::text,
        a."studentNumber"::text,
        a."enroleeFullName"::text,
        s."classLevel"::text,
        s."classSection"::text,
        s."applicationStatus"::text,
        ts_rank(%s, $2)::real as rank
      from public.%I a
      left join public.%I s on s."enroleeNumber" = a."enroleeNumber"
      where a."enroleeNumber" is not null
        and (
          %s @@ $2
          or a."enroleeNumber" ilike $1
          or a."studentNumber" ilike $1
        )
      order by rank desc, a.created_at desc
      limit $3
    $q$,
      v_ay.ay_code,
      v_fts_expr,
      v_slug || '_enrolment_applications',
      v_slug || '_enrolment_status',
      v_fts_expr
    )
    using v_like, v_tsquery, p_limit;
  end loop;
end;
$fn$;

-- =====================================================================
-- 3. Lock it down
-- =====================================================================
--
-- Per 103/104: Supabase grants execute on new functions in `public` to `anon`,
-- `authenticated` and `service_role` DIRECTLY, and revoking from PUBLIC does
-- not remove a named role's own grant. Both revokes are required, and 104's
-- lesson was that missing the `anon` one leaves the function callable with the
-- public anon key.
--
-- This function reads admissions data for every academic year, so it is
-- service_role only — the API route (which checks the caller's role first)
-- is the only thing that may call it. Verify with the anon key: expect 42501.

revoke execute on function public.search_students_across_ay(text, int) from public, anon, authenticated;
grant  execute on function public.search_students_across_ay(text, int) to service_role;

-- =====================================================================
-- 4. Keep the rollover wizard in lockstep
-- =====================================================================
--
-- Run this after the AY-setup wizard creates a new year's tables, to give
-- that year the index.
--
-- It is an OPTIMISATION, not a prerequisite — the search function above works
-- on a table that lacks the column, using an inline expression instead. That
-- is deliberate: 012's template knows nothing about `fts`, and a design where
-- forgetting one call makes a whole year's students unfindable is a trap that
-- springs a year after anyone would remember why.
--
-- It is not folded into `create_ay_admissions_tables` because doing so means
-- restating that function's ~150-column DDL here, which would rot the moment
-- the parent portal adds a field (see docs/context/18-ay-setup.md on keeping
-- the template and its TS mirror in lockstep).

create or replace function public.add_ay_search_fts(p_ay_slug text)
returns void
language plpgsql
as $$
declare
  v_slug text := lower(trim(p_ay_slug));
  v_table text;
begin
  if v_slug !~ '^ay[0-9]{2}$' then
    raise exception 'Invalid AY slug: %. Expected format like "ay27".', p_ay_slug;
  end if;
  v_table := v_slug || '_enrolment_applications';

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = v_table
      and column_name = 'fts'
  ) then
    execute format($ddl$
      alter table public.%I
      add column fts tsvector
      generated always as (
        to_tsvector('simple', coalesce("enroleeFullName", ''))
      ) stored;
    $ddl$, v_table);
  end if;

  execute format(
    'create index if not exists %I on public.%I using gin (fts);',
    v_table || '_fts_idx', v_table
  );
end;
$$;

revoke all on function public.add_ay_search_fts(text) from public, anon, authenticated;
grant execute on function public.add_ay_search_fts(text) to service_role;
