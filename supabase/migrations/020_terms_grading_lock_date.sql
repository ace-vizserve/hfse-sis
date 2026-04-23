-- 020_terms_grading_lock_date.sql
--
-- Adds `terms.grading_lock_date` — an advisory date per term that tells
-- teachers / registrar when grading sheets SHOULD be locked. It's purely
-- informational: the actual sheet lock is a separate per-sheet operation
-- (`grading_sheets.is_locked`) controlled by the registrar. Think of this
-- as "the school calendar says term 1 grades should be in by X".
--
-- Nullable: terms that pre-date this column or aren't time-critical skip it.
-- No CHECK constraint; registrar can set any date (past is valid for
-- historical AYs).
--
-- Apply after 019. Safe to re-run — IF NOT EXISTS.

alter table public.terms
  add column if not exists grading_lock_date date;

comment on column public.terms.grading_lock_date is
  'Advisory cutoff for this term''s grading. Informational only — the actual per-sheet lock is `grading_sheets.is_locked`. NULL when unset. Surfaced on /markbook/grading as a chip next to the term selector.';
