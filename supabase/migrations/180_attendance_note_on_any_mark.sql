-- 180_attendance_note_on_any_mark.sql
--
-- A teacher can attach a note to a Present, Late or Absent mark, not only an
-- Excused one ("arrived 08:40, bus delayed", "left at 11:00 for the dentist",
-- "mother called, fever").
--
-- WHY. Miss Koh asked, 2026-09-28. Migration 109 made the note Excused-only
-- because it was built as the interim for an MC upload; the request now is the
-- same free-text "why" on every mark a child can get.
--
-- WHAT CHANGES. Only the rule. `attendance_daily_ex_note_requires_ex_chk`
-- (109: `ex_note is null or status = 'EX'`) is replaced by one that allows a
-- note on P / L / A / EX. The column keeps its name `ex_note`, its length cap
-- (140), its privacy rule (the text never reaches `audit_log` — the trigger
-- from 166 records presence only, for any status), and append-only history.
--
-- NOT ON NC. "No class" is the calendar saying the class did not meet, not a
-- mark on a child. A cleared day (status null) still carries nothing —
-- `attendance_daily_cleared_has_no_reason_chk` (134) is untouched.
--
-- A NOTE BELONGS TO ITS MARK. Changing the mark starts the new one with an
-- empty note; that is enforced by the writers (they only send a note with the
-- mark it was typed for), not here.
--
-- SAFE ON EXISTING ROWS. The new rule is strictly looser than 109's for every
-- status except NC, and 109 already refused a note on NC, so no row can
-- violate it. Safe to re-run.

alter table public.attendance_daily
  drop constraint if exists attendance_daily_ex_note_requires_ex_chk;

alter table public.attendance_daily
  drop constraint if exists attendance_daily_note_requires_mark_chk;

alter table public.attendance_daily
  add constraint attendance_daily_note_requires_mark_chk
  check (ex_note is null or status in ('P', 'L', 'A', 'EX'));

comment on column public.attendance_daily.ex_note is
  'Teacher''s free-text note on a Present, Late, Absent or Excused mark (Excused only before migration 180). Rich text, capped by attendance_daily_ex_note_len_chk. Never copied into audit_log — presence only.';
