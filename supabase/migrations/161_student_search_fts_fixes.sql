-- 161_student_search_fts_fixes.sql
--
-- Two defects in 160, both found by running it against the live database
-- rather than by reading it. 160 is already applied; this is the correction,
-- not a rewrite of history.
--
-- ─────────────────────────────────────────────────────────────────────────
-- DEFECT 1 — the function raised on EVERY search.
--
--   column reference "ay_code" is ambiguous
--
-- `returns table (ay_code text, ...)` makes `ay_code` an OUT parameter, and
-- the loop then ran `select ay_code from public.academic_years`. plpgsql
-- cannot tell the OUT parameter from the table's column, so it refuses —
-- at RUN time, not at CREATE time, which is why 160 applied cleanly and
-- still could not answer a single query. Fixed by aliasing the table and
-- selecting a differently-named column.
--
-- ⚠ The practical consequence: had the code deployed against 160 alone,
-- student search would have been dead in both the ⌘K palette and the
-- cross-AY box. Not slow — dead.
--
-- ─────────────────────────────────────────────────────────────────────────
-- DEFECT 2 — the fts column was added to ZERO tables.
--
-- 160's backfill matched `^ay[0-9]{2}_enrolment_applications$`, copied from
-- 025. But this database names those tables with a FOUR-digit year:
--
--   ayCodeToSlug('AY2026') -> 'ay2026'      (lib/sis/ay-setup/admissions-ddl.ts:25)
--   prefixFor('AY2026')    -> 'ay2026'      (lib/sis/queries.ts:21)
--
-- so the real table is `ay2026_enrolment_applications` and the two-digit
-- pattern matched nothing. The loop ran, reported success, and did nothing.
--
-- Search still WORKED after 160 (the function falls back to an inline
-- to_tsvector when the column is absent, which was the point of building it
-- that way) — it was simply unindexed. A correctness problem avoided; a
-- performance one left in place.
--
-- ⚠ CARRIED BUG, NOT FIXED HERE: migration 025 backfills RLS with the same
-- two-digit pattern, so its loop matched nothing either. Whether the AY
-- admissions tables actually have RLS enabled needs checking separately —
-- 025 may have reported success over an empty set for the same reason.
-- Flagged rather than fixed: RLS on live admissions tables is not a change
-- to make as a side effect of a search migration.
--
-- Both patterns below accept {2,4} digits so a two-digit table (should one
-- exist from 012's own guard) is covered too.
--
-- Idempotent. Safe to re-run.

-- =====================================================================
-- 1. Backfill the column + index, this time matching the real table names
-- =====================================================================

do $$
declare
  v_row record;
begin
  for v_row in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
      and tablename ~ '^ay[0-9]{2,4}_enrolment_applications$'
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

      raise notice 'added fts to %', v_row.tablename;
    end if;

    execute format(
      'create index if not exists %I on %I.%I using gin (fts);',
      v_row.tablename || '_fts_idx', v_row.schemaname, v_row.tablename
    );
  end loop;
end $$;

-- =====================================================================
-- 2. The function, with the ambiguity fixed
-- =====================================================================
--
-- Unchanged from 160 apart from the loop's select. Restated in full because
-- `create or replace function` has no partial form.

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

  -- ⚠ `y.ay_code as code`, NOT `ay_code`. `ay_code` is an OUT parameter of
  -- this function (see `returns table` above), so an unqualified reference
  -- is ambiguous and plpgsql raises at run time. This was defect 1.
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

    -- Use the indexed column when present, an equivalent inline expression
    -- when not, so a newly rolled-over AY searches correctly before anyone
    -- remembers to run add_ay_search_fts. Degrades in speed, not correctness.
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
      v_ay.code,
      v_fts_expr,
      v_slug || '_enrolment_applications',
      v_slug || '_enrolment_status',
      v_fts_expr
    )
    using v_like, v_tsquery, p_limit;
  end loop;
end;
$fn$;

revoke execute on function public.search_students_across_ay(text, int) from public, anon, authenticated;
grant  execute on function public.search_students_across_ay(text, int) to service_role;

-- =====================================================================
-- 3. The per-AY helper, accepting the real slug shape
-- =====================================================================

create or replace function public.add_ay_search_fts(p_ay_slug text)
returns void
language plpgsql
as $$
declare
  v_slug text := lower(trim(p_ay_slug));
  v_table text;
begin
  -- {2,4}: this database uses four-digit slugs ('ay2026'), while 012's own
  -- guard states two. Accept both rather than pick a side in a migration
  -- about search.
  if v_slug !~ '^ay[0-9]{2,4}$' then
    raise exception 'Invalid AY slug: %. Expected format like "ay2027".', p_ay_slug;
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
