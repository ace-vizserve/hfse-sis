-- Migration 163 — a withdrawal records the two dates the school actually keeps
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- HFSE tracks two dates when a child leaves, and writes them as prose in the
-- admissions remarks because there has never been anywhere else to put them.
-- Ashley Rae Cama (E260359), `ay2026_enrolment_status.applicationRemarks`:
--
--   "<p>Withdrawal approved 11 May 2026<br>Last Day: 26 April 2026</p>"
--
-- Mr Ace, 2026-09-16: "we should capture this in enrolled student being
-- withdrawn too in SIS ... we are not capturing this details."
--
-- 🔴 THE SIS DID NOT CAPTURE EITHER — IT INVENTED A THIRD DATE.
-- `app/api/sections/[id]/students/[enrolmentId]/route.ts` stamped
-- `withdrawal_date = sgToday()` on the transition to withdrawn, so the stored
-- date means "the day a registrar opened the screen". For Cama the two real
-- dates are two weeks apart; whatever the SIS had written would have matched
-- neither. Every downstream reader — the Records Withdrawals count, the
-- permanent record, any attendance question about when marks should stop —
-- was reading an admin-action timestamp as though it were a fact about a child.
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────
--
--   withdrawal_date           now means LAST DAY OF ATTENDANCE, supplied by
--                             the registrar. No longer auto-stamped.
--   withdrawal_approved_date  NEW. When the school approved the withdrawal.
--
-- Two columns rather than one because the school genuinely keeps both and they
-- differ by weeks. The last day is the one that answers questions about the
-- child (when did attendance stop, which term do they count in); the approval
-- date answers questions about the process.
--
-- ── STATE OF THE DATA, MEASURED BEFORE WRITING THIS ───────────────────────
--
--   825 section_students rows, all academic years
--    43 withdrawn
--    11 of those 43 hold a withdrawal_date
--     0 hold a withdrawal_reason
--     0 non-withdrawn rows hold a withdrawal_date
--
-- ⚠ THOSE 11 DATES ARE ADMIN-ACTION DATES AND ARE NOT BACKFILLED HERE.
-- After this migration the column means something different from what those
-- rows recorded, and nothing in the database says which of the 11 were clicked
-- on the day the child left and which were clicked weeks later. Guessing would
-- replace a known-vague value with a confident wrong one. They stay as they
-- are; the office's remarks are the only real source and reading them is a
-- separate, reviewed job.
--
-- ⚠ NO CHECK THAT approved >= last day. It reads like an invariant and is not
-- one: Cama was approved on 11 May for a last day of 26 April, i.e. approval
-- came AFTER she stopped attending, which is ordinary when a family leaves
-- first and the paperwork follows. A constraint here would refuse the truth.
--
-- ── ACCEPTANCE ───────────────────────────────────────────────────────────
--
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_name = 'section_students'
--      and column_name in ('withdrawal_date', 'withdrawal_approved_date');
--   -- Expect 2 rows, both date, both YES.
--
--   select count(*) from public.section_students
--    where withdrawal_approved_date is not null;
--   -- Expect 0 immediately after applying.

begin;

alter table public.section_students
  add column if not exists withdrawal_approved_date date;

comment on column public.section_students.withdrawal_date is
  'LAST DAY OF ATTENDANCE — the last day the student was in school. Entered by the registrar, never auto-stamped (migration 163). Rows written before 163 hold the date a registrar marked the student withdrawn, which is not the same thing.';

comment on column public.section_students.withdrawal_approved_date is
  'The day the school approved the withdrawal. May fall AFTER the last day of attendance — a family often leaves before the paperwork completes (migration 163).';

commit;
