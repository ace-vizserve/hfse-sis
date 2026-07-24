-- ay2026-t3-events-audience-fix.sql
--
-- Audit-trail record of a one-shot production correction (applied
-- 2026-07-24). The AY2026 T3 attendance-import generator
-- (lib/sis/backfill/attendance/build-attendance-import-t3.ts) originally
-- hardcoded every calendar_events row it produced to audience='all',
-- discarding the actual primary(P1-P6)/secondary(S1-S4) distinction
-- available per-section in the source workbook. This caused primary
-- attendance sheets to incorrectly show secondary-only exam dates.
--
-- Root cause fixed at the source in build-attendance-import-t3.ts (see
-- lib/sis/backfill/attendance/event-audience.ts) so future re-runs are
-- correct. This file documents the correction applied to the 4 already-live
-- rows that were wrong. Verified against the real T3 workbook at the
-- per-date, per-level-type tag level before applying: primary sections
-- carry exam tags only on 2026-08-26/27 (shared combined papers, correctly
-- 'all'); secondary sections additionally carry exam tags on 2026-08-20,
-- 21, 24, 25 (subject-specific papers primary students don't sit at all —
-- correctly 'secondary', not a parsing gap).
--
-- Applied via a one-shot script using the service-role Supabase client
-- (not raw SQL execution) after a human-reviewed preview diff. This SQL is
-- the human-readable record of exactly what changed, for future reference
-- — it is NOT meant to be re-run (the 4 rows are already corrected; running
-- this again is a no-op since the WHERE clause only matches rows still at
-- the old 'all' value).

with tgt as (
  select t.id as term_id
  from terms t
  join academic_years ay on ay.id = t.academic_year_id
  where ay.ay_code = 'AY2026' and t.term_number = 3
),
corrected(start_date, category, audience, label) as (values
  (date '2026-08-20', 'term_exam', 'secondary', 'Term 3 Exam (Science Paper 1)'),
  (date '2026-08-21', 'term_exam', 'secondary', 'Term 3 Exam (English Paper 1&2)'),
  (date '2026-08-24', 'term_exam', 'secondary', 'Term 3 Exam (Math Paper 1, MT)'),
  (date '2026-08-25', 'term_exam', 'secondary', 'Term 3 Exam (Math Paper 1, English)')
)
update calendar_events ce
set audience = c.audience
from tgt, corrected c
where ce.term_id = tgt.term_id
  and ce.start_date = c.start_date and ce.end_date = c.start_date
  and ce.category = c.category
  and ce.audience <> c.audience;

-- Verified post-apply: all 15 AY2026 T3 calendar_events rows checked
-- against the regenerated workbook output — 0 mismatches remaining.
