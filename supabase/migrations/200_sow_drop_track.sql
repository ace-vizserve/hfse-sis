-- 200: A scheme of work has no track.
--
-- 198 made one scheme per term, subject, level AND track (Standard / Global,
-- from sections.class_type). The school never split it that way: its scheme of
-- work is one workbook per subject per term with one tab per level. Mr Ace
-- dropped the track on 2026-10-28, so a scheme is now one per term, subject and
-- level, and every section of that level can follow it, whatever its class type.
--
-- ⚠ FAILS RATHER THAN MERGES. If two schemes share a term, subject and level
-- (one Standard, one Global), dropping the track would leave two plans for one
-- key. Nothing here picks a winner or deletes one: the migration stops with the
-- clashing keys, and a person decides which scheme stays.
--
-- Idempotent: the clash check and the column drop only run while `track`
-- exists; `drop ... if exists` and a guarded `add constraint`, safe to re-run.

-- ── 1. Stop on a clash ─────────────────────────────────────────────────────

do $$
declare
  clashes text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'schemes_of_work'
      and column_name = 'track'
  ) then
    select string_agg(format('term %s, subject %s, level %s (%s schemes)',
                             term_id, subject_id, level_id, n), '; ')
      into clashes
      from (
        select term_id, subject_id, level_id, count(*) as n
        from public.schemes_of_work
        group by term_id, subject_id, level_id
        having count(*) > 1
      ) d;

    if clashes is not null then
      raise exception
        'schemes_of_work has more than one scheme for the same term, subject and level; decide which to keep before dropping track: %',
        clashes;
    end if;
  end if;
end $$;

-- ── 2. Drop the track ──────────────────────────────────────────────────────

alter table public.schemes_of_work
  drop constraint if exists schemes_of_work_term_subject_level_track_key;

alter table public.schemes_of_work
  drop column if exists track;

-- ── 3. One scheme per term, subject and level ──────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.schemes_of_work'::regclass
      and conname = 'schemes_of_work_term_subject_level_key'
  ) then
    alter table public.schemes_of_work
      add constraint schemes_of_work_term_subject_level_key
      unique (term_id, subject_id, level_id);
  end if;
end $$;

comment on table public.schemes_of_work is
  'One scheme of work: the teaching plan for a subject and level in one term, with its module details and its approval state.';
