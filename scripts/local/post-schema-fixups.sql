-- Post-dump fixups for the LOCAL database, applied by `npm run local:rebuild`
-- right after supabase/prod-schema.sql is loaded.
--
-- Changes production made directly (outside supabase/migrations) AFTER the
-- schema dump was taken. Each one is idempotent: it applies only while the
-- dump's old shape is still there, so it is a no-op on a dump taken after the
-- change. Once everyone has re-dumped (`npx supabase db dump`), an entry can
-- be deleted.

-- 2026-10-07: the careers site's tables in the shared database were renamed
-- with a `careers_` prefix — 3 tables, 5 views, their sequences, indexes,
-- primary keys and the one check constraint. Views follow their tables by
-- OID, so only the names change.
do $$
declare
  t text;
  v text;
  i text;
begin
  if to_regclass('public.submission_log') is null
     and to_regclass('public.submission_issues') is null
     and to_regclass('public.problem_reports') is null then
    return; -- already renamed (or a dump taken after 2026-10-07)
  end if;

  foreach t in array array['submission_log', 'submission_issues', 'problem_reports'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I rename to %I', t, 'careers_' || t);
      execute format('alter table public.%I rename constraint %I to %I',
                     'careers_' || t, t || '_pkey', 'careers_' || t || '_pkey');
    end if;
    if to_regclass('public.' || t || '_id_seq') is not null then
      execute format('alter sequence public.%I rename to %I',
                     t || '_id_seq', 'careers_' || t || '_id_seq');
    end if;
  end loop;

  foreach v in array array[
    'submission_issues_by_browser', 'submission_issues_by_stage',
    'submission_log_by_browser', 'submission_log_by_platform',
    'problem_reports_open'
  ] loop
    if to_regclass('public.' || v) is not null then
      execute format('alter view public.%I rename to %I', v, 'careers_' || v);
    end if;
  end loop;

  foreach i in array array[
    'problem_reports_reported_at_idx', 'submission_issues_occurred_at_idx',
    'submission_issues_session_idx', 'submission_log_submitted_at_idx'
  ] loop
    if to_regclass('public.' || i) is not null then
      execute format('alter index public.%I rename to %I', i, 'careers_' || i);
    end if;
  end loop;

  if exists (select 1 from pg_constraint where conname = 'submission_issues_outcome_check') then
    alter table public.careers_submission_issues
      rename constraint submission_issues_outcome_check to careers_submission_issues_outcome_check;
  end if;
end $$;
