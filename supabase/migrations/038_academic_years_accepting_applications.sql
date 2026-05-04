-- 038_academic_years_accepting_applications.sql
--
-- Early-bird AY support (KD #77). Adds `accepting_applications` to
-- `academic_years` so admissions can run a parallel pipeline for the
-- upcoming AY while the current AY is still operationally active.
--
-- Decoupled from `is_current`:
--   - `is_current` = "school operations run against this AY" (Markbook,
--     Attendance, Records, Evaluation read from here).
--   - `accepting_applications` = "parent portal can submit applications
--     into this AY's `ay{YYYY}_*` tables; admissions team works the
--     pipeline." Independent of operational state.
--
-- Typical states:
--   AY2025  is_current=false, accepting_applications=false  (past)
--   AY2026  is_current=true,  accepting_applications=true   (current)
--   AY2027  is_current=false, accepting_applications=true   (early-bird open)
--   AY2028  is_current=false, accepting_applications=false  (created, not yet open)
--
-- The Admissions sidebar surfaces "Upcoming AY applications" iff there
-- exists an AY with `accepting_applications=true AND is_current=false`.
-- When AY2027 eventually becomes current via the rollover flow, the
-- Upcoming entry naturally disappears because no upcoming AY satisfies
-- the gate anymore.
--
-- Backfill: the current AY is seeded with `accepting_applications=true`
-- (always-open default for current operational AY). All other AYs land
-- on the column default `false` until the registrar opts them in.
--
-- Apply after 037. Safe to re-run — IF NOT EXISTS guards throughout.

alter table public.academic_years
  add column if not exists accepting_applications boolean not null default false;

comment on column public.academic_years.accepting_applications is
  'Whether the parent portal can submit new applications for this AY (KD #77). Decoupled from is_current so admissions can run an early-bird pipeline for the upcoming AY while the current AY stays operationally active.';

-- One-time backfill: open applications on the current AY so existing
-- behavior is preserved (admissions has always-implicitly accepted apps
-- on the current AY). Past AYs stay closed by default. Idempotent — only
-- flips rows that are still at the column default.
update public.academic_years
  set accepting_applications = true
  where is_current = true
    and accepting_applications = false;
