-- Migration 138: the report label becomes per academic year, and a subject
-- gains a per-year description.
--
-- WHY. Migration 137 put `display_name` on `subject_configs` so the school
-- could rename MAPEH to STAR for AY2026 while AY2025 kept saying MAPEH. That
-- left `subjects.report_label` (migration 087) as the odd one out: a rename
-- mechanism that is GLOBAL, on a table with no academic year, doing a job that
-- is now per-year everywhere else.
--
-- Mr Ace, 2026-08-31: "now that i think about the report label its useful tho
-- make it per AY as well too. but description is addition anwyays".
--
-- ⚠ THE TWO FIELDS ARE NOT THE SAME QUESTION, AND KEEPING THEM APART IS THE
-- POINT OF THIS MIGRATION.
--
--   display_name  — what this subject is CALLED in this year. Everywhere:
--                   grading sheets, markbook, classroom, admin.
--   report_label  — what it is called ON THE REPORT CARD in this year, when
--                   that differs from the above.
--
-- Before this migration they were one fallback chain
-- (display_name -> report_label -> name) in lib/sis/subjects/display-name.ts,
-- and that chain had no callers until the 2026-08-31 read sweep wired it into
-- the markbook, classroom and grading screens. The moment it did, MAPEH's
-- global report_label of 'STAR' started showing on AY2025 markbook screens —
-- the exact thing AY2025 was supposed to keep calling MAPEH. Splitting the
-- column splits the resolver, and a report label can no longer leak onto a
-- screen that is not a report card.
--
-- ⚠ NO BACKFILL, DELIBERATELY. Exactly three subjects carry a report_label in
-- production (read 2026-08-31), and not one of them should be carried forward:
--
--   MAPEH     name="MAPEH"     report_label="STAR"
--     Redundant. This is the rename, and display_name on the AY2026 config is
--     where it belongs. Copying it into BOTH years' configs would recreate the
--     bug described above, in a new place.
--
--   FIL       name="Filipino"  report_label="Mother Tongue (Filipino)"
--   MANDARIN  name="Mandarin"  report_label="Mother Tongue (Mandarin)"
--     These are not renames at all. They hand-write a heading that
--     `resolveReportSubjects` ALREADY composes from subject_report_map, which
--     maps both languages to "Mother Tongue". Carrying them over reproduces
--     the doubling they cause today:
--       AY2026 heading, measured: "Mother Tongue (Mother Tongue (Filipino))"
--       AY2026 heading, once dropped: "Mother Tongue (Filipino)"
--
-- The three values are written out above rather than migrated, so nothing is
-- lost and the decision is auditable. If the school does want a report label
-- on any subject, it is now typed once, on the year it applies to.
--
-- ⚠ WHY THE SCHOOL HAS BOTH A "Mother Tongue" SUBJECT AND TWO LANGUAGES.
-- They changed how they grade it, and the sheet counts show the switch:
--   AY2025  Mother Tongue 88 sheets (53 with marks) · Filipino 8 / Mandarin 4,
--           both with ZERO marks
--   AY2026  Mother Tongue no sheets · Filipino 31 (8 with marks) /
--           Mandarin 10 (5 with marks)
-- So AY2025 graded one combined sheet and AY2026 grades the languages
-- separately. That is a per-year fact about a subject, which is what this whole
-- pair of migrations exists to express.
--
-- ⚠ subjects.code IS UNTOUCHED AND MUST STAY UNTOUCHED. Every code-keyed list
-- in the app depends on it — MAPEH_FAMILY_CODES and its 20/60/20 weight split,
-- MOTHER_TONGUE_SUBJECT_CODES, the deployment importer's SUBJECT_MAP. Mr Ace:
-- "keep in mind the static list of subjects we have are not affected".

-- ── 1. The per-year report label ────────────────────────────────────────────
alter table public.subject_configs
  add column if not exists report_label text;

comment on column public.subject_configs.report_label is
  'What the REPORT CARD calls this subject in this academic year. NULL means '
  'fall back to display_name, then subjects.name. Distinct from display_name, '
  'which is what every other screen calls it. See migration 138.';

alter table public.subject_configs
  drop constraint if exists subject_configs_report_label_not_blank;

alter table public.subject_configs
  add constraint subject_configs_report_label_not_blank
  check (report_label is null or length(btrim(report_label)) > 0);

-- ── 2. The per-year description ─────────────────────────────────────────────
-- Shown on the GRADING SHEET PAGE, under the subject heading, so a teacher
-- opening a STAR sheet reads what the acronym stands for. Staff only:
-- deliberately not on the sheet list (it would make every row two lines deep)
-- and deliberately not on the report card, which uses the subject name.
-- Mr Ace, 2026-08-31: "sheet page, dont in report card. with report card use
-- the subject name."
alter table public.subject_configs
  add column if not exists description text;

comment on column public.subject_configs.description is
  'What this subject is, in this academic year — e.g. STAR is "Sports, '
  'Talent, Arts and Rhythm". Rendered on the grading sheet page under the '
  'heading. Staff-facing only; never printed on a report card. See '
  'migration 138.';

alter table public.subject_configs
  drop constraint if exists subject_configs_description_not_blank;

alter table public.subject_configs
  add constraint subject_configs_description_not_blank
  check (description is null or length(btrim(description)) > 0);

-- ── 3. Drop the global one ──────────────────────────────────────────────────
-- Last, so the two replacements exist before the thing they replace goes. The
-- three live values are recorded in the header above.
alter table public.subjects
  drop column if exists report_label;
