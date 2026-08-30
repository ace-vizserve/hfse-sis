-- 134_attendance_clear_mark.sql
--
-- Lets a marked day be returned to UNMARKED.
--
-- Today there is no way to undo an attendance entry in either view, and the
-- gap is in the vocabulary rather than the UI: `status` is NOT NULL with a
-- CHECK of ('P','L','EX','A','NC'), so no value means "not marked". The wide
-- grid's popover offers only the five marks, and the Daily view's
-- `computeSubmitEntries` treats an unmarked eligible student as 'P' — so
-- clearing a mark there does not blank it, it writes Present, which is a
-- WRONG mark rather than an absent one.
--
-- WHY NULL AND NOT A SIXTH STATUS. A sentinel ('CL', 'CLR', …) would have to
-- be excluded by hand from every aggregate, and the one that matters is
-- `school_days`, computed as `count(*) filter (where status <> 'NC')` in
-- recompute_attendance_rollup. A sentinel satisfies `<> 'NC'`, so a cleared
-- day would keep counting as a school day with no mark against it and quietly
-- drag `attendance_pct` down. NULL cannot: `NULL <> 'NC'` evaluates to NULL,
-- FILTER counts only TRUE, so a cleared row drops out of school_days, present,
-- late, excused and absent alike — exactly "as if never marked", with no
-- change to the rollup at all. ('CL' is also already the Christian Living
-- subject code in this system, which is its own reason not to reuse it.)
--
-- It also matches Hard Rule #6's existing shape for grades — deletion is a
-- null plus an audit row, never a DELETE — and the client already models an
-- empty cell as `status: AttendanceStatus | null`, so nothing has to learn a
-- new idea.
--
-- STILL APPEND-ONLY. Clearing INSERTs a row whose status is NULL; the prior
-- mark stays in the ledger and the latest `recorded_at` per
-- (section_student_id, date, period_id) wins, unchanged. `recorded_by` on the
-- cleared row is who cleared it, so "who blanked this day" is answerable from
-- the table itself, as well as from audit_log.
--
-- DELIBERATELY NOT RE-EMITTING recompute_attendance_rollup. Its current
-- definition is 068 and its current GRANTS are 103's (execute revoked from
-- public + authenticated, granted to service_role only). Re-emitting 068
-- verbatim would carry 068's trailing `grant execute … to authenticated` and
-- silently undo that lockdown — the same class of regression migration 114
-- caused. The function needs no change here anyway, per the NULL reasoning
-- above.
--
-- Apply after 133. Safe to re-run — every step is guarded.

-- =====================================================================
-- 1. status becomes nullable, NULL meaning "not marked"
-- =====================================================================

alter table public.attendance_daily
  alter column status drop not null;

-- The original CHECK was declared inline in 014 (`status text not null check
-- (...)`) so Postgres auto-named it. Drop whatever it is called rather than
-- assuming, then re-add under the repo's `_chk` convention.
do $$
declare
  v_conname text;
begin
  select conname
  into   v_conname
  from   pg_constraint
  where  conrelid = 'public.attendance_daily'::regclass
    and  contype  = 'c'
    and  pg_get_constraintdef(oid) ilike '%status%'
    and  pg_get_constraintdef(oid) ilike '%''NC''%'
    and  pg_get_constraintdef(oid) not ilike '%ex_note%'
  limit  1;

  if v_conname is not null then
    execute format(
      'alter table public.attendance_daily drop constraint %I',
      v_conname
    );
  end if;
end $$;

alter table public.attendance_daily
  add constraint attendance_daily_status_chk
  check (
    status is null
    or status in ('P','L','EX','A','NC')
  );

-- =====================================================================
-- 2. A cleared day carries no reason and no note
-- =====================================================================
--
-- 109 added `check (ex_note is null or status = 'EX')`. With a NULL status
-- that becomes `ex_note is null OR NULL`, and a CHECK only fails on FALSE —
-- so a cleared row could keep an ex_note. Clearing a mark has to clear the
-- excuse with it, or the day reads as unmarked while still carrying "medical
-- certificate submitted" underneath.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'attendance_daily_cleared_has_no_reason_chk'
      and conrelid = 'public.attendance_daily'::regclass
  ) then
    alter table public.attendance_daily
      drop constraint attendance_daily_cleared_has_no_reason_chk;
  end if;
end $$;

alter table public.attendance_daily
  add constraint attendance_daily_cleared_has_no_reason_chk
  check (
    status is not null
    or (ex_reason is null and ex_note is null)
  );

-- =====================================================================
-- 3. Documentation
-- =====================================================================

comment on column public.attendance_daily.status is
  'P = present, L = late (counts as present), EX = excused (MC / compassionate / school activity; counts as present), A = absent, NC = no class (holiday or not-yet-enrolled; excluded from school_days), NULL = not marked. A NULL row is how a mark is UNDONE: it is appended like any correction, supersedes the prior mark by recorded_at, and falls out of every rollup aggregate because FILTER counts only TRUE and `NULL <> ''NC''` is NULL. ex_reason and ex_note must both be NULL when status is.';

comment on table public.attendance_daily is
  'Raw daily attendance ledger. Append-only: corrections write a new row; latest `recorded_at` per (section_student_id, date, period_id) wins. A row with a NULL status returns the day to unmarked without erasing the history. Source of truth for the `attendance_records` rollup.';

-- =====================================================================
-- Acceptance
-- =====================================================================
--
-- 1. The column admits NULL and the CHECK survives a bad value:
--
--      select is_nullable from information_schema.columns
--       where table_name = 'attendance_daily' and column_name = 'status';
--      -- expect: YES
--
--      select pg_get_constraintdef(oid) from pg_constraint
--       where conname = 'attendance_daily_status_chk';
--      -- expect: CHECK (status IS NULL OR status = ANY (ARRAY['P','L','EX','A','NC']))
--
-- 2. A cleared row cannot smuggle an excuse through:
--
--      insert into public.attendance_daily
--        (section_student_id, term_id, date, status, ex_reason)
--      select section_student_id, term_id, date, null, 'mc'
--        from public.attendance_daily limit 1;
--      -- expect: ERROR  new row violates check constraint
--      --         "attendance_daily_cleared_has_no_reason_chk"
--
-- 3. The rollup ignores a cleared day WITHOUT being changed. Against a
--    student with a known rollup, append a NULL-status row for a date that
--    currently carries a mark, then:
--
--      select * from public.recompute_attendance_rollup(:term_id, :ssid);
--
--    -- expect school_days to DROP BY ONE versus the pre-clear value, and the
--    -- present/late/excused/absent bucket that day belonged to to drop by one
--    -- as well. If school_days is unchanged, the FILTER reasoning above is
--    -- wrong and this migration is not safe to keep — say so rather than
--    -- adjusting the expectation.
--
-- 4. The lockdown from 103 is untouched (this migration emits no GRANT):
--
--      select grantee, privilege_type
--        from information_schema.routine_privileges
--       where routine_name = 'recompute_attendance_rollup';
--      -- expect: service_role only. NOT authenticated, NOT anon.
