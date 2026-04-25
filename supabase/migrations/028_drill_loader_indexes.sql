-- Sprint 24 — drill-loader covering indexes
--
-- Adds composite/secondary indexes to cover the hot query patterns produced by
-- the Sprints 22–24 drill loaders (lib/{markbook,sis}/drill.ts,
-- lib/sis/records-history.ts, lib/sis/dashboard.ts) and the rollup helpers
-- they depend on. Existing unique constraints already cover queries whose
-- leading column matches; this migration fills the remaining gaps.
--
-- Idempotent: every statement uses `if not exists` and is safe to re-run.
--
-- Optional pre-flight audit (run in Supabase SQL editor before applying):
--   select tablename, indexname, indexdef
--   from pg_indexes
--   where schemaname = 'public'
--     and tablename in ('grade_entries', 'grading_sheets', 'section_students')
--   order by tablename, indexname;

-- grade_entries(section_student_id)
--   Hot for: markbook student-history drill (per-student grade rows across
--   sheets). The unique index on (grading_sheet_id, section_student_id)
--   does not help when filtering by section_student_id alone.
create index if not exists grade_entries_section_student_idx
  on public.grade_entries (section_student_id);

-- section_students(student_id)
--   Hot for: lib/sis/records-history.ts cross-AY enrollment lookups.
--   The unique indexes lead with section_id, so student_id-only filters
--   currently fall back to a sequential scan.
create index if not exists section_students_student_idx
  on public.section_students (student_id);

-- section_students(section_id, enrollment_status)
--   Hot for: SIS / Markbook / Attendance "active students in section" rollups
--   and class-assignment readiness joins. Composite beats the leading-column
--   unique index when the status filter is selective.
create index if not exists section_students_section_status_idx
  on public.section_students (section_id, enrollment_status);

-- grading_sheets(section_id, term_id)
--   Hot for: section-scoped listings (sheets in section across terms,
--   used by the markbook dashboard + Records → markbook drill jumps).
--   The unique index leads with term_id, so section-only / section-leading
--   queries miss it.
create index if not exists grading_sheets_section_term_idx
  on public.grading_sheets (section_id, term_id);

-- grading_sheets(term_id, is_locked)
--   Hot for: dashboard "open sheets in window" KPI + drill filter.
--   Composite covers the two-column predicate without scanning the whole
--   term's sheets to filter by lock status.
create index if not exists grading_sheets_term_locked_idx
  on public.grading_sheets (term_id, is_locked);
