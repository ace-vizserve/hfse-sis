-- Migration 156 — a grade row is created when a score is entered, not in advance
--
-- THE BUG, AND WHERE IT ACTUALLY WAS. The grading sheet page loads its roster
-- with `from('grade_entries')`, so the grid can only draw a student who already
-- has a row on that sheet. A student placed after the sheet was generated has
-- none, and disappears from their own teacher's sheet.
--
-- Everything built around that was a workaround. The page called
-- `seed_grade_entries_for_sheet` on EVERY render to manufacture blank rows so
-- the grid would have something to draw — a write on a page view, measured at
-- 71–121ms, on every open of every sheet, forever. 929 rows across 469 sheets
-- are still missing, which is the same bug still happening.
--
-- Seeding those rows earlier (at placement, by trigger) was my first answer and
-- it was the wrong one: it keeps the requirement that a blank row must exist
-- before a student is visible, and just moves who creates it. The requirement
-- itself is the bug.
--
-- THE FIX IS IN THE READ, and it is not in this file: the page now loads
-- `section_students` and attaches whatever grade row exists. Every enrolled
-- student shows, with marks or without. No row needs to exist in advance, so
-- nothing needs to seed one — not on render, not at placement, not at all.
--
-- WHAT THIS MIGRATION IS FOR. With no pre-seeding, the row has to be created
-- the first time a score is actually typed, which makes the write an UPSERT
-- instead of an UPDATE. Migration 152 gave `grade_entries` an UPDATE policy and
-- deliberately left INSERT denied, on the reasoning that rows were only ever
-- created by the seeder. That reasoning is gone, so INSERT needs the same gate
-- the UPDATE has — and exactly the same one, `can_write_grade_entry`: the
-- assigned subject teacher (relief cover included), on an unlocked sheet, or
-- registrar and above.
--
-- DELETE stays denied. Clearing a score is setting it to null, never removing
-- the row (Hard Rule #6).

create policy grade_entries_scoped_insert
  on public.grade_entries for insert
  to authenticated
  with check (public.can_write_grade_entry(grading_sheet_id));

-- ⚠ THE UPSERT NEEDS A CONFLICT TARGET, AND IT ALREADY HAS ONE.
-- `grade_entries_sheet_student_uniq` on (grading_sheet_id, section_student_id)
-- was added by migration 035 for the seeder's own ON CONFLICT. It is what makes
-- "create it if this student has no row yet, otherwise update the one they
-- have" a single statement, and therefore safe against two teachers typing the
-- first score for the same child at once.

comment on function public.seed_grade_entries_for_sheet(uuid, uuid) is
  'DEPRECATED as of migration 156 — nothing needs pre-seeded blank rows any more. The grading page reads the roster from section_students and the first saved score creates the row. Kept only because create_grading_sheets_for_ay still calls it; safe to drop once that is updated.';
