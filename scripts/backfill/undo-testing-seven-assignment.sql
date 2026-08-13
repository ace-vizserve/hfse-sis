-- Undo the AY2026 class assignment for TESTING SEVEN (E260535 / H260535)
-- so the assign-a-class flow can be tested again from a clean start.
--
-- Written 2026-08-14. One-off, for a test student. Not a migration.
--
-- WHY A DELETE AND NOT A WITHDRAWAL. Hard Rule #6 keeps departed students on
-- the roster as `enrollment_status = 'withdrawn'`, and that is right for a
-- child who actually left a class. This student never belonged to one — the
-- row exists only because the assignment was being tested. Marking it
-- withdrawn would also NOT restore the state being tested: "Students needing
-- setup" counts any roster row, withdrawn included, as evidence the student
-- has been given a class, so they would stay missing from the queue.
--
-- SAFE BY CONSTRUCTION. `grade_entries`, `attendance_records` and
-- `attendance_daily` all reference `section_students(id)` ON DELETE RESTRICT.
-- If anything has been recorded against this enrolment since it was created,
-- step 2 fails, the transaction rolls back, and nothing changes. Measured at
-- zero rows in all three on 2026-08-14 before writing this.
--
-- Run in the Supabase SQL editor. Admissions and grading live in the same
-- project, so this is one script.

-- ── 1. Look before you leap ────────────────────────────────────────────────
-- Run this on its own first. Expect exactly ONE row:
--   Primary One / Respect · #2 · late_enrollee
select ss.id,
       ss.index_number,
       ss.enrollment_status,
       lv.label   as level,
       sec.name   as section,
       ay.ay_code
  from public.section_students ss
  join public.students        s   on s.id   = ss.student_id
  join public.sections        sec on sec.id = ss.section_id
  join public.levels          lv  on lv.id  = sec.level_id
  join public.academic_years  ay  on ay.id  = sec.academic_year_id
 where s.student_number = 'H260535'
   and ay.ay_code       = 'AY2026';

-- ── 2. The undo ────────────────────────────────────────────────────────────
begin;

-- Remove the roster row. Matched by student number and academic year rather
-- than by a pasted id, so a stale id cannot delete the wrong child's place.
delete from public.section_students ss
 using public.students       s,
       public.sections       sec,
       public.academic_years ay
 where ss.student_id  = s.id
   and ss.section_id  = sec.id
   and sec.academic_year_id = ay.id
   and s.student_number = 'H260535'
   and ay.ay_code       = 'AY2026';

-- Put the admissions row back to "enrolled, waiting for a class".
--
-- `classUpdatedDate` is deliberately not reset: migration 087 installs a
-- trigger that stamps it with today's date whenever any class column changes,
-- so any value written here would be overwritten in the same statement. It
-- read as today's date in the unassigned state before this test anyway.
update public.ay2026_enrolment_status
   set "classSection"   = null,
       "classLevel"     = null,
       "classStatus"    = null,
       "classUpdatedby" = null
 where "enroleeNumber" = 'E260535';

commit;

-- ── 3. Confirm ─────────────────────────────────────────────────────────────
-- Step 1's query should now return no rows, and this should show the
-- admissions row with three nulls.
select "enroleeNumber",
       "applicationStatus",
       "classLevel",
       "classSection",
       "classStatus"
  from public.ay2026_enrolment_status
 where "enroleeNumber" = 'E260535';
