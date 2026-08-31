-- Migration 137: subject_configs.display_name — a subject's name, per
-- academic year.
--
-- WHY THIS EXISTS. The school renamed MAPEH to STAR ("Sports, Talent, Arts and
-- Rhythm") for AY2026. That rename could not be made anywhere in the app, for
-- two separate reasons:
--
--   1. `subjects.name` is not editable — SubjectCatalogUpdateSchema
--      (lib/schemas/subject.ts) accepts is_examinable, grading_method and
--      report_label, and refuses anything else.
--   2. More fundamentally, `subjects` has NO academic_year_id. One row serves
--      every year, so "rename it for AY2026" had nowhere to be stored: any
--      rename would also relabel AY2025's records.
--
-- Mr Ace, 2026-08-31: "its better if renaming is per year not globally".
-- `subject_configs` is already the per-AY layer — one row per (academic year,
-- subject, level), carrying the weights, qa_max and weights_confirmed — so the
-- per-year name belongs on it, added exactly the way 021 added `qa_max` and
-- 085 added `weights_confirmed`.
--
-- ⚠ THIS IS A DISPLAY NAME AND NOTHING ELSE. `subjects.code` is untouched and
-- MUST stay untouched: the code is what every static list in the codebase keys
-- on — MAPEH_FAMILY_CODES (lib/sis/subjects/weight-defaults.ts, which sets the
-- 20/60/20 split), MOTHER_TONGUE_SUBJECT_CODES (lib/schemas/subject.ts),
-- EQUIVALENT_SUBJECT_CODES and SUBJECT_MAP in the deployment importer, and the
-- grades backfill's own subject map. Mr Ace, 2026-08-31: "keep in mind the
-- static list of subjects we have are not affected". A renamed subject is the
-- SAME subject with the same code, the same weights and the same grades; only
-- the words on the screen change, and only for the year they changed in.
--
-- ⚠ NULL MEANS "USE THE CATALOGUE NAME", NOT "BLANK". The resolution order is
-- display_name -> report_label -> name (lib/sis/subjects/display-name.ts), so
-- every existing row keeps rendering exactly what it renders today. This
-- migration changes no output on its own — it only makes the override
-- possible. That is deliberate: applying it must be a no-op until somebody
-- types a name on the Subject Setup page.
--
-- ⚠ NOT A REPLACEMENT FOR report_label (migration 087). That one is global and
-- answers "what should the REPORT CARD call this subject" — a fan-in label,
-- shared across years. This one answers "what did the school call this subject
-- IN THIS YEAR". They compose: a year without an override still honours the
-- report label.

alter table public.subject_configs
  add column if not exists display_name text;

comment on column public.subject_configs.display_name is
  'What this subject is called in THIS academic year. NULL means fall back to '
  'subjects.report_label, then subjects.name. Display only — subjects.code is '
  'the identity every code-keyed list in the app depends on, and never changes '
  'with a rename. See migration 137.';

-- A name that is present but blank/whitespace is the same mistake as a missing
-- one, and would render an empty subject heading. Store NULL or real text.
alter table public.subject_configs
  drop constraint if exists subject_configs_display_name_not_blank;

alter table public.subject_configs
  add constraint subject_configs_display_name_not_blank
  check (display_name is null or length(btrim(display_name)) > 0);
