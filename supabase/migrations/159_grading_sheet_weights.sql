-- Migration 159 — a grading sheet can carry its own WW/PT/QA weights
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- Miss Joann, 2026-09-15 registrar training: S3 Filipino has an exam in some
-- terms and not others, and Global Perspectives had no exam in Term 3 — "those
-- subjects have PT scores only, and the PT score effectively is the exam". She
-- asked whether she has to untick something per term. There is nothing to
-- untick.
--
-- Weights live on `subject_configs`, one row per (subject, academic year).
-- There has never been a per-term weight anywhere in the schema, and
-- `lib/compute/quarterly.ts` sums the components like this:
--
--     initial = (ww_ps ?? 0) * ww_weight
--             + (pt_ps ?? 0) * pt_weight
--             + (qa_ps ?? 0) * qa_weight
--
-- A missing component contributes ZERO — it does not give its weight back. So
-- in a term with no exam a Filipino student on full marks computes to an
-- initial of 80 and a quarterly of 87, and Global Perspectives with
-- performance tasks only computes to 50, transmuting to 72.
--
-- ⚠ THE FLAG THAT LOOKS LIKE THE ANSWER IS THE WRONG ONE.
-- `subjects.is_examinable` means numeric WW/PT/QA grading versus LETTER
-- grading (migration 049), not "has an exam". Unticking it for Filipino would
-- turn Filipino into a letter-graded subject, in every academic year at once —
-- the column has no AY dimension, and migration 080 already considered and
-- refused a per-AY `grade_type` for that reason. Mr Ace, 2026-09-15: "our
-- definition of examinable is wrong ... its the grading sheet that needs it
-- instead of the subject."
--
-- ── WHY THE SHEET, AND NOT A NEW TABLE ───────────────────────────────────
--
-- This is the pattern `qa_total` already follows. KD #176: "a subject config's
-- slot/score numbers are a CEILING, not a broadcast value" — `grading_sheets`
-- already holds `ww_totals`, `pt_totals` and `qa_total` as the live values,
-- defaulted from the config. Weights were the one grading number left behind
-- at config level. This completes an existing pattern rather than inventing a
-- third place for grading numbers to live.
--
-- It also means the formula keeps ONE read: the sheet the entry belongs to.
-- `lib/compute/quarterly.ts` is NOT modified by this work and must not be —
-- with qa_weight 0 the term `(qa_ps ?? 0) * 0` is already zero and the
-- remaining weights already sum to 1. Hard Rule #1 and #2 stand untouched.
--
-- ── WHY NULL MEANS INHERIT ───────────────────────────────────────────────
--
-- All three columns are nullable and every existing row keeps NULL, so this
-- migration changes not one computed grade. A sheet resolves its weights from
-- `subject_configs` exactly as it does today until somebody deliberately sets
-- them. Verified against production before writing this file: no
-- `subject_configs` row anywhere carries a zero component weight (AY2025 and
-- AY2026 alike), so there is no existing "no exam" representation to migrate
-- and nothing can violate the CHECK below.
--
-- ⚠ NO TRIGGER AND NO BACKFILL, DELIBERATELY. Migration 158's lesson: a
-- derive-unconditionally trigger overwrites correct rows on the next touch of
-- any kind. Weights are set by a person, through a route that recomputes the
-- affected entries. A SQL function cannot call lib/compute/quarterly.ts, which
-- is exactly how `sync_grading_sheets_from_config` (migration 052) came to move
-- denominators without recomputing the grades on top of them — the defect
-- `scripts/audit-grade-recompute-drift.ts` exists to find.
--
-- ── ACCEPTANCE ───────────────────────────────────────────────────────────
--
--   select count(*) from public.grading_sheets
--    where ww_weight is not null or pt_weight is not null or qa_weight is not null;
--   -- Expect 0 immediately after applying.
--
--   select column_name, is_nullable, data_type
--     from information_schema.columns
--    where table_name = 'grading_sheets'
--      and column_name in ('ww_weight','pt_weight','qa_weight');
--   -- Expect 3 rows, all is_nullable = YES, numeric.

begin;

alter table public.grading_sheets
  add column if not exists ww_weight numeric(4, 2),
  add column if not exists pt_weight numeric(4, 2),
  add column if not exists qa_weight numeric(4, 2);

-- Either the sheet defers to its subject config entirely, or it states all
-- three weights and they sum to 1.00. A half-set row would silently mix the
-- two sources and produce a grade nobody could explain.
alter table public.grading_sheets
  drop constraint if exists grading_sheets_weights_all_or_none_check;

alter table public.grading_sheets
  add constraint grading_sheets_weights_all_or_none_check
  check (
    (ww_weight is null and pt_weight is null and qa_weight is null)
    or (
      ww_weight is not null and pt_weight is not null and qa_weight is not null
      and ww_weight >= 0 and pt_weight >= 0 and qa_weight >= 0
      and ww_weight + pt_weight + qa_weight = 1.00
    )
  );

comment on column public.grading_sheets.ww_weight is
  'Written-work weight for THIS term''s sheet, 0.00-1.00. NULL = inherit subject_configs.ww_weight. Set all three or none (migration 159).';
comment on column public.grading_sheets.pt_weight is
  'Performance-task weight for THIS term''s sheet, 0.00-1.00. NULL = inherit subject_configs.pt_weight. Set all three or none (migration 159).';
comment on column public.grading_sheets.qa_weight is
  'Exam weight for THIS term''s sheet, 0.00-1.00. NULL = inherit subject_configs.qa_weight. 0.00 means the term has no exam and its share is carried by the other components (migration 159).';

commit;
