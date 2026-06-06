-- 070_align_ex_reason_to_hfse.sql
--
-- Align the attendance EX-reason subtypes to HFSE's actual attendance sheet.
--
-- Verified against HFSE's T1 attendance workbook legend: EX = "Excused
-- (MC-Excuse Leave)", plus a Vacation Leave quota (1 per term) and an
-- Urgent/Compassionate quota (5 per year). The `school_activity` subtype was
-- never part of HFSE's policy — it was an unfounded carry-over from the
-- original migration-015 enum. This migration drops it and reclassifies any
-- existing `school_activity` rows as the generic MC / Excuse-leave excused.
--
-- Final ex_reason set:
--   mc            — MC / Excuse leave   (HFSE bundles MC + Excuse Leave under EX)
--   compassionate — Urgent / compassionate (consumes the per-year quota, KD #94)
--   vacation      — Vacation leave        (consumes the per-term quota, KD #94)
--
-- See KD #94 (vacation-leave subtype + per-term quotas). Apply after 069.
-- Idempotent + safe to re-run.

-- =====================================================================
-- 1. Remap existing rows: school_activity -> mc
-- =====================================================================
--
-- Reclassify as the generic MC / Excuse-leave excused so rows stay valid
-- under the tightened CHECK below. In practice this is test-only data.

update public.attendance_daily
  set ex_reason = 'mc'
  where ex_reason = 'school_activity';

-- =====================================================================
-- 2. attendance_daily.ex_reason: tighten check constraint
-- =====================================================================
--
-- Drop the migration-048 constraint and re-add it without 'school_activity'.
-- Preserves the NULL-allowed behaviour (NULL = EX with no recorded subtype).

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'attendance_daily_ex_reason_chk'
      and conrelid = 'public.attendance_daily'::regclass
  ) then
    alter table public.attendance_daily drop constraint attendance_daily_ex_reason_chk;
  end if;
end $$;

alter table public.attendance_daily
  add constraint attendance_daily_ex_reason_chk
  check (
    ex_reason is null
    or ex_reason in ('mc', 'compassionate', 'vacation')
  );

comment on column public.attendance_daily.ex_reason is
  'Optional EX subtype: mc (MC / Excuse leave) | compassionate (Urgent / compassionate) | vacation (Vacation leave). ''compassionate'' consumes the student''s urgent_compassionate_allowance (per AY); ''vacation'' consumes vacation_leave_allowance_per_term (per term).';
