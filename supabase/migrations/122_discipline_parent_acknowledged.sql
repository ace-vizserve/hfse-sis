-- 122_discipline_parent_acknowledged.sql
--
-- When the parent's signed slip came back.
--
-- Mr Ace, 2026-08-18: "i think we should at least track if the parent has been
-- acknowledged by the parent tho."
--
-- The school's first warning letter ends with a tear-off PARENT'S
-- ACKNOWLEDGEMENT RECEIPT — three tick-boxes, the parent's name, a signature
-- and a date — headed "[Please return this slip by May 27, 2026]", two days
-- after the letter itself. So a letter is not finished when it is sent, and
-- until now this system had nowhere to say so.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ONE NULLABLE DATE, NOT A FLAG AND A DATE
--
-- Null means it has not come back; a value means it came back that day. A
-- boolean beside a date is two records of one fact, and they drift the first
-- time someone sets one without the other — there is no state a flag can
-- express that this column cannot.
--
-- It is also not a workflow. Nothing sends the letter, nothing computes the
-- return-by date, nothing chases. The school prints the letter in Word and
-- sends it home with the student exactly as it does today; somebody types the
-- date when the slip lands on their desk. Same rule as the rest of #7 — staff
-- decide, this records it.
--
-- ⚠ NOBODY HAS ASKED TO CHASE OUTSTANDING SLIPS. The two-day deadline on the
-- letter is the only hint anyone tracks them at all, and "which letters are
-- still outstanding" would be a screen with a queue on it. If that is ever
-- wanted, this column already answers it — do not pre-build the screen.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THE TWO CONSTRAINTS
--
-- LETTERS ONLY. An incident has nothing for a parent to acknowledge, so a date
-- on one is a data-entry mistake, not a fact. Shaped exactly like
-- `attendance_daily_ex_note_requires_ex_chk` (migration 109), and for the same
-- reason: switching the record's TYPE must not be able to strand a value that
-- only makes sense under the old one. A record edited from letter to incident
-- has to clear this column, and the database is what guarantees it.
--
-- NOT BEFORE THE THING HAPPENED. A slip cannot return before the letter went
-- out. This one compares two stored columns, so unlike the "not in the future"
-- rule (see 120, which lives in zod because `current_date` is not immutable and
-- would revalidate on a restore) it is safely a CHECK.
--
-- Idempotent — safe to re-run. APPLIED 2026-08-18, same day as 120 and 121.

alter table public.student_discipline_records
  add column if not exists acknowledged_on date;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'student_discipline_records_ack_letters_only'
      and conrelid = 'public.student_discipline_records'::regclass
  ) then
    alter table public.student_discipline_records
      drop constraint student_discipline_records_ack_letters_only;
  end if;
end $$;

alter table public.student_discipline_records
  add constraint student_discipline_records_ack_letters_only
  check (acknowledged_on is null or record_type = 'letter');

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'student_discipline_records_ack_not_before_sent'
      and conrelid = 'public.student_discipline_records'::regclass
  ) then
    alter table public.student_discipline_records
      drop constraint student_discipline_records_ack_not_before_sent;
  end if;
end $$;

alter table public.student_discipline_records
  add constraint student_discipline_records_ack_not_before_sent
  check (acknowledged_on is null or acknowledged_on >= occurred_on);

comment on column public.student_discipline_records.acknowledged_on is
  'The day the parent''s signed acknowledgement slip came back. NULL means it has not. Letters only — an incident has nothing to acknowledge, and the CHECK is what stops a type change from stranding the value. Recorded by hand when the slip arrives: nothing here sends a letter, computes a return-by date, or chases an outstanding one.';
