-- Migration 084: Subject registry weight / grade-type corrections — found
-- during the "Unified Subject Setup page" plan's mockup review
-- (C:\Users\Ace\.claude\plans\my-bad-its-not-graceful-creek.md, Task 1).
--
-- Corrects three things migration 082 got wrong (082 is itself STILL
-- UNAPPLIED to any live database — this is "correct before first apply,"
-- not a rollback; per KD #119 discipline, an already-written migration
-- file is never silently re-edited even when unapplied, so this is a new
-- file rather than a hand-edit of 082) plus one PRE-082 subject (PEH)
-- whose live weight the plan flagged as also wrong, plus a defensive HUM
-- S3/S4 offering backfill Task 3 (level-aware Standard bundle) depends on.
--
--   §1. PESTD (Physical Education, Standard/Secondary — migration 082) —
--       weight corrected from 082's assumed 30/50/20 to the
--       verified-correct 20/60/20. PE sits in the same performance-heavy
--       weighting bucket as MAPEH (20/60/20, migration 081 — see
--       supabase/seed.sql's `case when sub.code = 'MAPEH' then 0.20 …
--       0.60 …` branch), not the ordinary-subject 30/50/20 bucket 082
--       assumed for it.
--
--   §2. PEH (Physical Education and Health, Global/Secondary —
--       pre-existing, predates 082) — corrected the same way,
--       CONDITIONALLY: only UPDATEs rows currently at exactly
--       0.30/0.50/0.20. Verified via supabase/seed.sql's subject_configs
--       insert (lines ~174-196): PEH is not in the `('ENG','MATH','SCI',
--       'SS','CL')` 40/40/20 bucket and is not `MAPEH`, so it falls into
--       the generic `else` branch — 0.30/0.50/0.20 — confirming it does
--       need the same fix. The WHERE guard means a row already corrected
--       by hand (or one that, in some environment this migration can't
--       see, was never actually seeded at 30/50/20) is left untouched
--       rather than blindly overwritten, per the brief's explicit
--       instruction not to assume.
--
--   §3. HUM (Humanities) — subject_level_offerings backfill for S3/S4,
--       every AY that already has subject_configs rows (mirrors migration
--       082 §4's own gating pattern) + the AY-agnostic template table.
--       supabase/seed.sql's fresh-install path already gives HUM every
--       secondary level — its Secondary subjects_level_offerings insert
--       joins on the broad `lv.level_type = 'secondary'` predicate (which
--       covers S1-S4 + CS1/CS2 uniformly, migration 029 §3), and HUM is
--       listed in that branch's subject-code set (seed.sql lines
--       ~220-221) — so on a fresh install this section is a pure no-op.
--       No live/already-migrated database is reachable from this
--       worktree to independently confirm the same holds true THERE (an
--       already-migrated environment's HUM offering history could in
--       principle have diverged from the fresh-install seed, e.g. via
--       migration 080's per-subject reconciliation logic picking a
--       different canonical level set than seed.sql's uniform join) — so
--       this migration defensively (re-)inserts the two S3/S4 rows
--       unconditionally via `on conflict do nothing`, safe either way.
--       Task 3's level-aware Standard bundle (HIST at S1/S2, HUM at
--       S3/S4) depends on this offering existing — without it, attaching
--       HUM to an S3/S4 section's bundle would fail the level-offering
--       check in `POST /api/sections/[id]/subjects` (`lib/sis/queries.ts`
--       — "That subject isn't configured at this section's level").
--
--   §4. ARTD (Arts & Design — migration 082) — grade type corrected from
--       082's `is_examinable = true` (Numeric) to the verified-correct
--       `false` (Letter), matching PEH's grade type. It's flagged
--       "needs attention" on the new Subject Setup page regardless (no
--       subject_report_map self-map confirmation yet), but the pre-filled
--       default the admin sees when they open it to confirm shouldn't
--       mislead them into thinking Numeric is already correct.
--
-- Idempotency: every statement below is either a guarded UPDATE (its
-- WHERE clause requires the pre-correction value, so re-running after the
-- fix has landed is a no-op) or an INSERT ... ON CONFLICT DO NOTHING —
-- safe to re-run unconditionally, matching 081/082/083's own documented
-- idempotency contract.
--
-- No dev/live database is reachable from this worktree — same caveat as
-- migrations 082/083: this migration has NOT been run or verified
-- against a live database. Verification here is structural only
-- (begin/commit balance; cross-checked against supabase/seed.sql's actual
-- seeded values and migrations 080-083's actual inserted values; no
-- code-level collision on subject codes).

-- ═════════════════════════════════════════════════════════════════════
-- §1. PESTD — 30/50/20 → 20/60/20 (subject_configs, every AY + the
--     AY-agnostic template row).
-- ═════════════════════════════════════════════════════════════════════

begin;

update public.subject_configs sc
set ww_weight = 0.20, pt_weight = 0.60, qa_weight = 0.20
from public.subjects subj
where subj.id = sc.subject_id
  and subj.code = 'PESTD'
  and sc.ww_weight = 0.30
  and sc.pt_weight = 0.50
  and sc.qa_weight = 0.20;

update public.template_subject_configs tc
set ww_weight = 0.20, pt_weight = 0.60, qa_weight = 0.20
from public.subjects subj
where subj.id = tc.subject_id
  and subj.code = 'PESTD'
  and tc.ww_weight = 0.30
  and tc.pt_weight = 0.50
  and tc.qa_weight = 0.20;

commit;

-- ═════════════════════════════════════════════════════════════════════
-- §2. PEH — 30/50/20 → 20/60/20, conditionally (only rows currently at
--     the pre-correction value; see header note for the seed.sql
--     cross-check confirming PEH is currently 30/50/20).
-- ═════════════════════════════════════════════════════════════════════

begin;

update public.subject_configs sc
set ww_weight = 0.20, pt_weight = 0.60, qa_weight = 0.20
from public.subjects subj
where subj.id = sc.subject_id
  and subj.code = 'PEH'
  and sc.ww_weight = 0.30
  and sc.pt_weight = 0.50
  and sc.qa_weight = 0.20;

update public.template_subject_configs tc
set ww_weight = 0.20, pt_weight = 0.60, qa_weight = 0.20
from public.subjects subj
where subj.id = tc.subject_id
  and subj.code = 'PEH'
  and tc.ww_weight = 0.30
  and tc.pt_weight = 0.50
  and tc.qa_weight = 0.20;

commit;

-- ═════════════════════════════════════════════════════════════════════
-- §3. HUM — defensive subject_level_offerings backfill at S3/S4, every AY
--     that already has subject_configs rows (mirrors migration 082 §4's
--     gating) + the AY-agnostic template_subject_level_offerings table.
-- ═════════════════════════════════════════════════════════════════════

begin;

insert into public.subject_level_offerings (subject_id, level_id, academic_year_id)
select subj.id, lv.id, ay.id
from public.academic_years ay
join public.subjects subj on subj.code = 'HUM'
join public.levels lv on lv.code in ('S3', 'S4')
where exists (
  select 1 from public.subject_configs sc2 where sc2.academic_year_id = ay.id
)
on conflict (subject_id, level_id, academic_year_id) do nothing;

insert into public.template_subject_level_offerings (subject_id, level_id)
select subj.id, lv.id
from public.subjects subj
join public.levels lv on lv.code in ('S3', 'S4')
where subj.code = 'HUM'
on conflict (subject_id, level_id) do nothing;

commit;

-- ═════════════════════════════════════════════════════════════════════
-- §4. ARTD — is_examinable true → false (Numeric → Letter).
-- ═════════════════════════════════════════════════════════════════════

begin;

update public.subjects
set is_examinable = false
where code = 'ARTD'
  and is_examinable = true;

commit;

-- ═════════════════════════════════════════════════════════════════════
-- Post-apply manual review queries:
--   select ay.ay_code, subj.code, sc.ww_weight, sc.pt_weight, sc.qa_weight
--     from public.subject_configs sc
--     join public.academic_years ay on ay.id = sc.academic_year_id
--     join public.subjects subj on subj.id = sc.subject_id
--     where subj.code in ('PESTD', 'PEH')
--     order by ay.ay_code, subj.code;
--   -- Expect: 0.20 / 0.60 / 0.20 for every row of both subjects, every AY.
--
--   select subj.code, tc.ww_weight, tc.pt_weight, tc.qa_weight
--     from public.template_subject_configs tc
--     join public.subjects subj on subj.id = tc.subject_id
--     where subj.code in ('PESTD', 'PEH');
--   -- Expect: 0.20 / 0.60 / 0.20 for both.
--
--   select ay.ay_code, lv.code as level_code
--     from public.subject_level_offerings slo
--     join public.academic_years ay on ay.id = slo.academic_year_id
--     join public.subjects subj on subj.id = slo.subject_id
--     join public.levels lv on lv.id = slo.level_id
--     where subj.code = 'HUM' and lv.code in ('S3', 'S4')
--     order by ay.ay_code, lv.code;
--   -- Expect: both S3 and S4 present for every AY with subject_configs rows.
--
--   select code, is_examinable from public.subjects where code = 'ARTD';
--   -- Expect: is_examinable = false.
-- ═════════════════════════════════════════════════════════════════════
