-- Migration 082: Subject registry hardening — Phase 1 of the
-- "Config-Driven Subject Registry + Secondary Tracks" plan
-- (C:\Users\Ace\.claude\plans\my-bad-its-not-graceful-creek.md).
--
-- Two pieces of foundation work so a future subject addition is a pure
-- config action (no code change), as long as it fits the existing
-- weighted-component (WW/PT/QA or letter) grade model:
--
--   §1. `subjects.grading_method` — a new flag distinguishing "has a
--       normal WW/PT/QA grading sheet" from "recorded some other way,
--       don't generate a sheet." This is a FLAG ONLY in this migration —
--       Phase 2 of the plan is what actually makes the sheet-creation RPCs
--       filter on it. Every existing subject defaults to
--       'standard_sheet' (correct — no subject in the catalog today is
--       "no sheet").
--
--       Deliberately NOT a `grade_type` column — migration 080's header
--       (lines ~97–103) already rejected that exact idea:
--       `subjects.is_examinable` already drives every numeric-vs-letter
--       decision in the codebase (KD #104: the annual-letter route,
--       score-entry-grid, grading routes, letter-grade compute all branch
--       on it). `grading_method` is an orthogonal axis (sheet vs no-sheet),
--       not a second is_examinable.
--
--       Column placement: `subjects`, not `subject_configs` — it's an
--       intrinsic property of the subject (like `is_examinable`), and
--       `subjects` has no AY dimension, so a value set once survives every
--       future AY rollover automatically with zero extra plumbing. There
--       is no `template_subjects` table to keep in sync (confirmed: grep
--       for `template_subjects` across supabase/migrations/*.sql returns
--       nothing — only `template_subject_configs` and
--       `template_subject_level_offerings` exist, both of which reference
--       `subjects(id)` rather than duplicating subject-level columns).
--
--   §2. Four new catalog subjects HFSE actually needs for AY2026 —
--       Global Perspectives (GP), Computing (COMP), Arts & Design (ARTD),
--       and a standalone Secondary Physical Education (PESTD — a fresh
--       code, NOT the retired `PE` code that migration 081's MAPEH
--       consolidation hard-deleted; reusing it would read confusingly
--       against historical audit data referencing the old, different
--       meaning of `PE`). All four: `is_examinable = true`,
--       `grading_method = 'standard_sheet'`, weights 30/50/20 (WW/PT/QA),
--       offered at every Secondary level (S1–S4 + CS1/CS2 — i.e. every
--       level with `level_type = 'secondary'`, verified against migration
--       029 §3: CS1/CS2 are inserted with `level_type = 'secondary'`
--       exactly like S1–S4, so a plain `level_type = 'secondary'` join
--       covers the full 6-level Secondary set with no separate CS1/CS2
--       clause needed — this is the exact same pattern migration 081 §3
--       used for Filipino's `level_type in ('primary', 'secondary')`
--       join, narrowed to secondary-only here).
--
--       WEIGHTS ARE A STATED ASSUMPTION, NOT YET CONFIRMED WITH THE
--       SCHOOL (per the plan's own "Open items to confirm on plan review"
--       section) — 30/50/20 is the standard non-Math/Science/MAPEH bucket
--       every other ordinary Secondary subject already uses (English,
--       Filipino, Mandarin, History, Literature, Humanities, Economics all
--       carry it — see supabase/seed.sql + migration 081 §2). If HFSE
--       corrects any of these four, it is a one-line
--       `update public.subject_configs set ww_weight=…, pt_weight=…,
--       qa_weight=… where subject_id = (select id from public.subjects
--       where code = '<CODE>')`-style SQL update (repeated against
--       `template_subject_configs` for future AYs) — not an archaeology
--       dig, because this comment names the exact assumption and where it
--       lives.
--
--       Each of the four gets the SAME footprint migration 081 gave
--       MAPEH/Filipino/Mandarin — `subjects` row, per-AY `subject_configs`
--       (gated on the AY already having subject_configs rows, so every AY
--       that's been touched by the Subject Weights redesign gets the new
--       subject too, not just the current AY) + `template_subject_configs`
--       (AY-agnostic, feeds future rollovers), per-AY
--       `subject_level_offerings` + `template_subject_level_offerings`.
--
--       Deliberately NOT included (confirmed against 081's own explicit
--       footprint list AND the actual UI fallback behaviour): a
--       `subject_report_map` self-map row. Migration 081's MAPEH insert
--       added an explicit self-map row because 080's blanket self-map
--       seed pass ran before MAPEH existed as a subject — but the actual
--       consumers (`components/sis/subject-level-tree.tsx` line ~249 +
--       `components/sis/subject-monitoring-table.tsx` line ~206, both:
--       `reportSubjectIdBySubjectId.get(subject.id) ?? subject.id`) already
--       treat a MISSING subject_report_map row as an implicit self-map at
--       render time. A DB row is optional polish, not a functional
--       requirement — the Subject Weights UI already shows these four as
--       "reports as itself" the moment they exist, with zero extra rows.
--       (An admin can still set an explicit fan-in later via the existing
--       Reports-to picker on `SubjectConfigEditDialog`, same as any other
--       subject — nothing about this migration forecloses that.)
--
-- Idempotency (mirrors 081's own documented idempotency contract exactly):
--   §1 — `add column if not exists` is a safe no-op re-run.
--   §2's four inserts (`subjects`, `subject_configs`,
--   `template_subject_configs`, `subject_level_offerings`,
--   `template_subject_level_offerings`) are all pure `on conflict do
--   nothing`, safe to re-run unconditionally.
--
-- Non-atomicity note (matches 080/081's own precedent): each numbered
-- section commits independently (per-block begin/commit), not one outer
-- transaction — if a later block ever needed to abort (none of the blocks
-- here have an assertion that can abort; this migration is pure additive
-- inserts, no delete/retire logic like 081 §5/§6), earlier committed blocks
-- stay committed, and re-running the file after fixing whatever failed
-- completes the rest via the same on-conflict-do-nothing idempotency.
--
-- REQUIRED DEPLOY STEP — same caveat as migration 081's own note: until
-- someone runs `select sync_section_subjects_for_ay('<current AY code>')`
-- (migration 079) for the operational AY(s) and then generates grading
-- sheets for the affected sections, these four subjects exist in the
-- catalog and are "offered" per `subject_level_offerings`, but appear on
-- NO section's roster and generate NO grading sheets. That is also,
-- separately, explicitly out of scope for this migration/task (Phase 2 of
-- the plan is the auto-attach/auto-sheet-creation UX) — flagging the
-- deploy-sequencing dependency here so it isn't mistaken for "these
-- subjects are now live."
--
-- No dev database is reachable from this worktree (no automated
-- migration-apply tooling in this repo) — this migration has NOT been run
-- against a live database. Verification here is structural only: paren/
-- begin-commit balance, mirrored against 081's already-reviewed structure,
-- confirmed no code-level collision on the four new codes (`GP`, `COMP`,
-- `ARTD`, `PESTD`) against the full existing catalog (grepped seed.sql +
-- every migration file).

-- ═════════════════════════════════════════════════════════════════════
-- 1. subjects.grading_method — flag only; Phase 2 makes the sheet-
--    creation RPCs actually filter on it.
-- ═════════════════════════════════════════════════════════════════════

begin;

alter table public.subjects
  add column if not exists grading_method text not null default 'standard_sheet'
  check (grading_method in ('standard_sheet', 'no_sheet'));

commit;

-- ═════════════════════════════════════════════════════════════════════
-- 2. Four new catalog subjects — Global Perspectives (GP), Computing
--    (COMP), Arts & Design (ARTD), Secondary PE (PESTD). All numeric,
--    standard-sheet, 30/50/20 (assumption, see header note above).
-- ═════════════════════════════════════════════════════════════════════

begin;

insert into public.subjects (code, name, is_examinable, grading_method) values
  ('GP',    'Global Perspectives', true, 'standard_sheet'),
  ('COMP',  'Computing',           true, 'standard_sheet'),
  ('ARTD',  'Arts & Design',       true, 'standard_sheet'),
  ('PESTD', 'Physical Education',  true, 'standard_sheet')
on conflict (code) do nothing;

commit;

-- ═════════════════════════════════════════════════════════════════════
-- 3. subject_configs (per-AY, gated on the AY already having
--    subject_configs rows) + template_subject_configs (AY-agnostic).
--    30/50/20 for all four — see header note; ww_max_slots / pt_max_slots
--    / qa_max deliberately omitted from the insert column lists, same as
--    081 §2 — every other subject in this codebase's seed data relies on
--    the column defaults (5 / 5 / 30, Hard Rule #1 canonical qa_max) too.
-- ═════════════════════════════════════════════════════════════════════

begin;

insert into public.subject_configs (
  academic_year_id, subject_id, ww_weight, pt_weight, qa_weight
)
select ay.id, subj.id, v.ww, v.pt, v.qa
from public.academic_years ay
cross join (values
  ('GP',    0.30, 0.50, 0.20),
  ('COMP',  0.30, 0.50, 0.20),
  ('ARTD',  0.30, 0.50, 0.20),
  ('PESTD', 0.30, 0.50, 0.20)
) as v(code, ww, pt, qa)
join public.subjects subj on subj.code = v.code
where exists (
  select 1 from public.subject_configs sc2
  where sc2.academic_year_id = ay.id
)
on conflict (academic_year_id, subject_id) do nothing;

insert into public.template_subject_configs (
  subject_id, ww_weight, pt_weight, qa_weight
)
select subj.id, v.ww, v.pt, v.qa
from (values
  ('GP',    0.30, 0.50, 0.20),
  ('COMP',  0.30, 0.50, 0.20),
  ('ARTD',  0.30, 0.50, 0.20),
  ('PESTD', 0.30, 0.50, 0.20)
) as v(code, ww, pt, qa)
join public.subjects subj on subj.code = v.code
on conflict (subject_id) do nothing;

commit;

-- ═════════════════════════════════════════════════════════════════════
-- 4. subject_level_offerings (per-AY) + template_subject_level_offerings
--    (AY-agnostic) — every Secondary level (S1–S4 + CS1/CS2, all carrying
--    level_type = 'secondary' per migration 029 §3) for all four subjects.
-- ═════════════════════════════════════════════════════════════════════

begin;

insert into public.subject_level_offerings (subject_id, level_id, academic_year_id)
select subj.id, lv.id, ay.id
from public.academic_years ay
join public.subjects subj on subj.code in ('GP', 'COMP', 'ARTD', 'PESTD')
join public.levels lv on lv.level_type = 'secondary'
where exists (
  select 1 from public.subject_configs sc2 where sc2.academic_year_id = ay.id
)
on conflict (subject_id, level_id, academic_year_id) do nothing;

insert into public.template_subject_level_offerings (subject_id, level_id)
select subj.id, lv.id
from public.subjects subj
join public.levels lv on lv.level_type = 'secondary'
where subj.code in ('GP', 'COMP', 'ARTD', 'PESTD')
on conflict (subject_id, level_id) do nothing;

commit;

-- ═════════════════════════════════════════════════════════════════════
-- Post-apply manual review queries:
--   select code, name, is_examinable, grading_method from public.subjects
--     where code in ('GP','COMP','ARTD','PESTD') order by code;
--   -- Expect: all 4 present, is_examinable=true, grading_method='standard_sheet'.
--   select ay.ay_code, subj.code, sc.ww_weight, sc.pt_weight, sc.qa_weight
--     from public.subject_configs sc
--     join public.academic_years ay on ay.id = sc.academic_year_id
--     join public.subjects subj on subj.id = sc.subject_id
--     where subj.code in ('GP','COMP','ARTD','PESTD')
--     order by ay.ay_code, subj.code;
--   -- Expect: 0.30 / 0.50 / 0.20 for every row, one row per AY that
--   -- already had subject_configs rows.
--   select subj.code, lv.code as level_code
--     from public.subject_level_offerings slo
--     join public.subjects subj on subj.id = slo.subject_id
--     join public.levels lv on lv.id = slo.level_id
--     where subj.code in ('GP','COMP','ARTD','PESTD')
--     order by subj.code, lv.code;
--   -- Expect: CS1, CS2, S1, S2, S3, S4 for each of the 4 subjects, per AY.
--   select count(*) from public.subjects where grading_method not in ('standard_sheet', 'no_sheet');
--   -- Expect: 0.
-- ═════════════════════════════════════════════════════════════════════
