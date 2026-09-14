-- Migration 148 — aggregate the attendance dashboard's reads in Postgres
--
-- WHY. Every attendance dashboard and insights loader called `loadDailyRows`,
-- which pulled the WHOLE academic year's `attendance_daily` into Node and
-- reduced it there. Measured on AY2026: 48,589 rows, 53 round trips, ~3.3s for
-- a page showing a handful of KPIs and a donut. 95% of those rows are plain
-- `status = 'P'` — shipped across the wire to be counted and thrown away.
--
--     P   45,924  (95%)
--     EX   1,260  (3%)
--     A      978  (2%)
--     L      402  (1%)
--
-- Nothing the dashboard renders needs a row. Four of its six consumers need
-- per-(date, status) COUNTS; one needs EX counts by reason; only the
-- top-absentees list needs anything per student, and only for A and L.
--
-- ⚠ THE DEDUPE CANNOT MOVE TO THE CLIENT. `attendance_daily` is append-only: a
-- correction is a new row superseding the old by `recorded_at`. Filtering to
-- A/L in the query and deduping the RESULT would keep an absence that had been
-- corrected to Present — the superseding row is not in the filtered set to beat
-- it. So both functions below dedupe FIRST and filter second, which is the
-- whole reason this is SQL and not a `.in('status', …)` call.
--
-- Tie-break is `recorded_at desc, id` — the same rule as
-- `lib/attendance/queries.ts::listDailyEntries` and the TS dedupe in
-- `lib/attendance/dashboard.ts`. A register submit writes ~25 rows sharing one
-- `recorded_at` to the microsecond, so `recorded_at` alone does not determine a
-- winner.
--
-- Both are `stable` (not `volatile`) so Postgres may cache them within a
-- statement, and `security definer` + revoked like every other RPC here —
-- `authenticated` INCLUDES PARENTS in this project (KD #11/#165), and these
-- read every child's attendance.

-- ---------------------------------------------------------------------------
-- 1. Per-date status counts — serves the KPIs, the daily % series, the EX
--    reason donut, and both cross-year term comparisons.
-- ---------------------------------------------------------------------------
--
-- `ex_reason` is carried so the donut can group on it without a second call;
-- it is NULL for every status except EX. Cardinality is dates × statuses plus a
-- few EX-reason variants — a few thousand rows at most against ~48,000.

create or replace function public.attendance_mark_counts_by_date(
  p_academic_year_id uuid
)
returns table (
  mark_date  date,
  status     text,
  ex_reason  text,
  mark_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (ad.section_student_id, ad.date, ad.period_id)
           ad.date      as mark_date,
           ad.status    as status,
           ad.ex_reason as ex_reason
    from   public.attendance_daily ad
    join   public.section_students ss on ss.id = ad.section_student_id
    join   public.sections s          on s.id  = ss.section_id
    where  s.academic_year_id = p_academic_year_id
    order  by ad.section_student_id,
              ad.date,
              ad.period_id,
              ad.recorded_at desc,
              ad.id
  )
  select l.mark_date,
         l.status,
         l.ex_reason,
         count(*)::int as mark_count
  from   latest l
  where  l.status is not null
  group  by l.mark_date, l.status, l.ex_reason;
$$;

comment on function public.attendance_mark_counts_by_date(uuid) is
  'Per-(date, status, ex_reason) mark counts for an academic year, deduped to '
  'the surviving mark per (section_student_id, date, period_id) by '
  'recorded_at desc, id. Replaces pulling the whole year''s attendance_daily '
  'into the app to be counted there (~48k rows -> a few thousand). Feeds the '
  'attendance KPIs, the daily-% series, the EX-reason donut and the per-term '
  'cross-year comparisons.';

-- ---------------------------------------------------------------------------
-- 2. Absence + late marks per student — serves the top-absentees list only.
-- ---------------------------------------------------------------------------
--
-- The one consumer that genuinely needs per-student grain. Returns ~1,400 rows
-- for AY2026 rather than ~48,000, because the 95% that are `P` never leave the
-- database.
--
-- The status filter sits OUTSIDE the dedupe deliberately — see the header.

create or replace function public.attendance_absence_marks(
  p_academic_year_id uuid
)
returns table (
  section_student_id uuid,
  mark_date          date,
  status             text
)
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (ad.section_student_id, ad.date, ad.period_id)
           ad.section_student_id,
           ad.date   as mark_date,
           ad.status as status
    from   public.attendance_daily ad
    join   public.section_students ss on ss.id = ad.section_student_id
    join   public.sections s          on s.id  = ss.section_id
    where  s.academic_year_id = p_academic_year_id
    order  by ad.section_student_id,
              ad.date,
              ad.period_id,
              ad.recorded_at desc,
              ad.id
  )
  select l.section_student_id, l.mark_date, l.status
  from   latest l
  where  l.status in ('A', 'L');
$$;

comment on function public.attendance_absence_marks(uuid) is
  'The surviving A and L marks per student for an academic year, deduped by '
  '(section_student_id, date, period_id) on recorded_at desc, id. Feeds the '
  'top-absentees list. The status filter is applied AFTER the dedupe on '
  'purpose: filtering first would keep an absence that a later correction had '
  'already replaced with Present.';

-- ---------------------------------------------------------------------------
-- 3. Lock both down (migrations 103 + 104)
-- ---------------------------------------------------------------------------
--
-- Supabase grants EXECUTE on new public functions to anon, authenticated and
-- service_role, with PUBLIC's implicit default on top. `authenticated` includes
-- parents here, and both functions read every child's attendance for a year.
-- Called only through the service client. Safe to re-run.

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.attendance_mark_counts_by_date(uuid)',
    'public.attendance_absence_marks(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
