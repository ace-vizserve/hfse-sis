-- 035_grade_entries_unique.sql
--
-- One grade_entries row per (grading_sheet_id, section_student_id). The
-- existing flow already treats this pair as the natural key (one entry per
-- student per sheet) but never declared the constraint — entries were
-- created on first cell-save and the score-save API is what kept the pair
-- unique by always upserting the same `id` once it existed.
--
-- Required for the page-open seed step in `seed_grade_entries_for_sheet`
-- (migration 036) which uses ON CONFLICT DO NOTHING to ensure every active
-- section_student has a grid row.
--
-- If any duplicates exist (pre-existing data bug), the ALTER will fail and
-- a manual dedupe is needed first. In normal operation no dups exist.

alter table public.grade_entries
  add constraint grade_entries_sheet_student_uniq
  unique (grading_sheet_id, section_student_id);

comment on constraint grade_entries_sheet_student_uniq on public.grade_entries is
  'One entry per (sheet, student). Required for ON CONFLICT in the seed RPC.';
