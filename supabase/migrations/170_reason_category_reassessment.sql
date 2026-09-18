-- 170_reason_category_reassessment.sql
--
-- Add `reassessment` to the reasons a grade change can be filed under.
--
-- WHY. The school's own AEB Approval Form (CO.1.1-F01-V02) has a "Nature of
-- request" box, and the copy in the repo reads "Retest": two P6 Grit students
-- who could not complete a composition and scored 0 were to sit it again.
-- That is the commonest thing the board is asked for, and the SIS had no
-- reason that fitted it — teachers were filing it as `regrading` or `other`,
-- which made the question "how many retests did the board approve this year"
-- unanswerable without reading every justification.
--
-- WHAT THE CATEGORY MEANS, and why it is not just "retest". The distinction
-- that matters is WHERE THE NEW MARK CAME FROM:
--
--   regrading       the SAME work, marked again — the marker's judgement
--                   changed, the student did nothing further.
--   reassessment    NEW work. The student sat the assessment again, or sat it
--                   for the first time: retest, retake, resit, makeup. This is
--                   the AEB's "Retest".
--   data_entry_error the mark was right, the typing was wrong.
--   late_submission  work that arrived after the deadline is now marked.
--   academic_appeal  the student or parent contested the mark.
--
-- So `reassessment` is named for the act that produced the mark, which is what
-- makes it a category rather than one word off a form. "Retest or retake" is
-- what a teacher sees; the stored value covers resits and makeups too.
--
-- ⚠ NOTHING IS BACKFILLED. Existing rows filed as `regrading` or `other` that
-- were really retests are not re-categorised: nothing in the data says which
-- they were, and guessing from free-text justification would put a category on
-- a request the board decided under a different label. The new reason applies
-- from here.
--
-- ⚠ A CHECK constraint, not an enum type — matching how migration 009 wrote it,
-- so `field_changed` and `reason_category` stay the same shape.

-- 🔴 THE OLD CONSTRAINT IS DROPPED BY WHAT IT CHECKS, NOT BY ITS NAME.
-- Migration 009 declared it INLINE on the column, so Postgres generated the
-- name. `drop constraint if exists <guessed name>` would silently do nothing
-- if the guess were wrong, the ADD below would then sit BESIDE the old one,
-- and `reassessment` would still be refused — a migration that reports success
-- and changes nothing. This finds every CHECK on the table mentioning the
-- column and drops it, whatever it is called.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.grade_change_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%reason_category%'
  loop
    execute format(
      'alter table public.grade_change_requests drop constraint %I',
      c.conname
    );
  end loop;
end $$;

alter table public.grade_change_requests
  add constraint grade_change_requests_reason_category_check
  check (reason_category in (
    'regrading',
    'reassessment',
    'data_entry_error',
    'late_submission',
    'academic_appeal',
    'other'
  ));

comment on column public.grade_change_requests.reason_category is
  'Why the mark is moving. `reassessment` means the student was assessed AGAIN '
  '(retest, retake, resit, makeup) and the new mark comes from new work — as '
  'distinct from `regrading`, which is the same work marked differently. '
  'Mirrors the "Nature of request" box on the school''s AEB Approval Form.';
