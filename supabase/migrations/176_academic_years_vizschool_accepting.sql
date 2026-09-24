-- 176_academic_years_vizschool_accepting.sql
--
-- Gives each academic year its own "VizSchool applications open" switch, so
-- the parent portal's year picker can come from the SIS for both programmes.
--
-- ⚠ NUMBERED 176. 172 is still reserved for the realtime-publication cleanup
-- (written, deliberately unapplied until a browser pass confirms a badge
-- moves), and 175 is the admissions section-create permission. This is
-- unrelated to both.
--
-- WHY THIS EXISTS. The parent portal (`app-online-admission`) hardcodes its
-- year cards — which years a parent may apply for, for HFSE and for
-- VizSchool — so opening a year is a code deploy. The HFSE half already has a
-- flag in the SIS: `accepting_applications` (KD #77, single-select for
-- upcoming years per KD #118). VizSchool has none.
--
-- WHY A SEPARATE COLUMN, NOT `accepting_applications`. VizSchool is not a
-- separate set of tables: its applications land in the same
-- `ay{YYYY}_enrolment_*` tables as HFSE's, told apart only by `category`
-- ('VizSchool New' / 'VizSchool Current'). So the year is shared, but whether
-- it is OPEN is not — VizSchool can be taking applications for a year HFSE has
-- closed, or the other way round. Reusing the HFSE flag would tie the two
-- programmes' windows together.
--
-- NO SINGLE-SELECT RULE. The early-bird invariant (at most one upcoming year
-- open) belongs to HFSE's window and is enforced by the accepting-applications
-- route, not by the database. VizSchool has no such rule: this is just a
-- switch, and any number of years may have it on.
--
-- Default false, so a newly created year starts closed to VizSchool.
-- `create_academic_year` (090) inserts `(ay_code, label, is_current)` only,
-- so the column default applies there and the function is left alone.
--
-- BACKFILL: today the portal offers exactly one VizSchool year, AY2026, so
-- that row — and only that row — starts on.
--
-- The public reader is `GET /api/parent/v2/academic-years`, which reads with
-- the service client; no RLS change is needed.
--
-- Additive and idempotent.

begin;

alter table public.academic_years
  add column if not exists vizschool_accepting_applications boolean not null default false;

comment on column public.academic_years.vizschool_accepting_applications is
  'VizSchool parents can apply for this year on the parent portal. Independent of accepting_applications (HFSE); no single-select rule.';

update public.academic_years
   set vizschool_accepting_applications = true
 where ay_code = 'AY2026'
   and vizschool_accepting_applications = false;

commit;
