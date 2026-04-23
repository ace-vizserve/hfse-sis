-- 021_subject_configs_qa_max.sql
--
-- Adds `subject_configs.qa_max` — the maximum possible QA (Quarterly
-- Assessment) score for this (subject × level × AY), defaulting to 30
-- (HFSE's canonical case per Hard Rule #1). Until now QA max lived only on
-- `grading_sheets.qa_score` as an implicit per-sheet value; promoting it to
-- the config row means:
--   - Every grading sheet for that (subject × level) inherits the same cap.
--   - The registrar can vary cap per subject in SIS Admin (e.g. 50 for Math,
--     20 for Art) instead of asking teachers to remember.
--   - Grade computation in `lib/compute/quarterly.ts` can later gate on a
--     known max rather than accepting any numerator.
--
-- NOT NULL with default 30 — existing rows get 30 on migration (safe, matches
-- the canonical test case formula). Range check 1–100 (a QA out of 0 or
-- over 100 is never a realistic rubric).
--
-- Apply after 020. Safe to re-run — IF NOT EXISTS + idempotent CHECK.

alter table public.subject_configs
  add column if not exists qa_max smallint not null default 30;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'subject_configs_qa_max_range_chk'
      and conrelid = 'public.subject_configs'::regclass
  ) then
    alter table public.subject_configs drop constraint subject_configs_qa_max_range_chk;
  end if;
end $$;

alter table public.subject_configs
  add constraint subject_configs_qa_max_range_chk
  check (qa_max between 1 and 100);

comment on column public.subject_configs.qa_max is
  'Maximum possible QA (Quarterly Assessment) score for this (subject × level × AY). Default 30 — HFSE canonical per Hard Rule #1. Teachers enter a numerator up to this value; denominator is always qa_max.';
