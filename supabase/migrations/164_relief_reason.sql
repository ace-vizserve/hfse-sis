-- 164_relief_reason.sql
--
-- Cover says WHY it was booked.
--
-- Mr Ace, 2026-09-17: "in booking a cover i noticed we dont add remarks or
-- reason why the booking is happening should be required".
--
-- ⚠ THIS DOES NOT REVERSE 117's DELETION OF THE RELIEF TABLE. 112 had a closed
-- reason list plus notes on a history table; 117 removed both as a requirement
-- nobody had asked for. This one has been asked for, and it is ONE nullable
-- free-text column on the assignment row that already carries the cover —
-- still no table, no history, no reason codes. The audit log keeps the reason
-- of a finished cover the same way it keeps its dates.
--
-- REQUIRED BY THE ROUTES, NOT BY A CHECK. Covers booked before this migration
-- have no reason and must stay valid rows; a CHECK would reject every one of
-- them. POST /api/relief/book and PATCH /api/teacher-assignments/[id] refuse a
-- new or edited cover without one, so an old cover gains a reason the first
-- time anyone edits it. Ending a cover clears the reason with the name and the
-- dates, exactly as those already are.
--
-- Idempotent — safe to re-run. ⚠ APPLY BEFORE DEPLOYING THE CODE: the Cover
-- page selects this column.

alter table public.teacher_assignments
  add column if not exists relief_reason text;

comment on column public.teacher_assignments.relief_reason is
  'Why cover was booked, in the words of whoever booked it (e.g. "Medical leave"). Required by the write routes whenever relief_teacher_user_id is set; NULL on covers booked before migration 164 and cleared whenever the cover is ended.';
