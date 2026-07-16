-- Migration 081: MAPEH / language catalog corrections. Design doc:
-- docs/superpowers/specs/2026-07-15-ay-setup-subject-weights-redesign-design.md
--
-- Two real HFSE catalog corrections, confirmed with the user (do not
-- re-litigate the "is this right" question — only the mechanics below are
-- this migration's job):
--
--   1. Primary "MAPEH" is graded as ONE combined subject in real HFSE
--      practice. The catalog currently — incorrectly — models it as 4
--      independent letter-graded subjects (MUSIC, ARTS, PE, HE).
--   2. "Mother Tongue" (`MT`) is currently the directly-graded subject; it
--      becomes report-only. Two new subjects, `Filipino` (`FIL`) and
--      `Mandarin` (`MANDARIN`), both numeric (30/50/20), become the real
--      graded subjects — each fans into MT via `subject_report_map`
--      (migration 080, KD #155-candidate design doc).
--
-- ⚠ REQUIRED PRE-STEP (2026-07-16, post-first-attempt abort) — READ BEFORE
-- APPLYING: this migration was first run against a real database and
-- aborted at §5's assertion — the "zero real grade data under MUSIC/
-- ARTS/PE/HE" assumption was WRONG. Live investigation found AY2025 (the
-- historical, fully masterfile-backfilled year) has 1090 real
-- (section_student, term) groups with genuine MAPEH grades — mechanically
-- duplicated across all four old subjects during that backfill because
-- the catalog only offered 4 separate subjects at the time (the real
-- source Excel files are literally one combined "MAPEH - <section>" sheet
-- per section, never 4 separate ones — see
-- grade-skill-result/primary/T1/AY2025-T1-grading-sheet-mapping.csv,
-- where every "MAPEH -" sheet is `mapping_confidence: unmapped`). 1085 of
-- 1090 groups have the identical value across all four; the remaining 5
-- have a MUSIC-specific import slip (ARTS/PE/HE agree, MUSIC alone
-- differs) — user-confirmed resolution: majority vote.
--
-- `scripts/backfill/ay2025-mapeh-consolidation-{preview,apply}.sql` MUST
-- be run BEFORE this migration (preview first, eyeball its counts, then
-- apply). That script migrates the real MAPEH data forward (creates the
-- MAPEH grading_sheets/grade_entries with the resolved grade) and then
-- NULLS OUT the old MUSIC/ARTS/PE/HE rows' content — the sanctioned Hard
-- Rule #6 "deletion" (set to null, not a physical DELETE). Once that has
-- run, §5 below — UNCHANGED from its original, already-reviewed form —
-- correctly finds zero real content and proceeds with its FK-safe hard
-- delete exactly as designed. This migration's own §5 needed NO code
-- changes; only the precondition it depends on (via the separate backfill
-- script) changed.
--
-- MT is a different shape of problem from MUSIC/ARTS/PE/HE — it is ONE
-- real subject with its own legitimate historical grades (confirmed:
-- AY2025 has real MT data too), not four duplicates of one fact, so there
-- is no "migrate forward" target to consolidate into (Filipino/Mandarin
-- cannot be retroactively assigned per AY2025 student — this system never
-- captured which language track each historical student was in). §6
-- below is therefore scoped PER-AY, not by a single global assertion: any
-- AY with real MT grade content keeps its own MT subject_configs /
-- subject_level_offerings rows completely untouched forever (its
-- historical report cards keep rendering MT exactly as before); only AYs
-- confirmed (per-AY, not assumed) to have zero real MT content get their
-- MT footprint stripped, alongside the AY-agnostic template tables (no
-- historical-data risk there). The `subjects` row for MT was never
-- deleted in any version of this migration — that part of the design was
-- already correct.
--
-- This migration (mirrors migration 080's conventions — begin/commit per
-- logical block, do $$ … $$ guards only where conditional logic is
-- required, on conflict do nothing / if-exists guards throughout so a
-- re-run is a safe no-op):
--   §1. Adds the 3 new catalog subjects (`subjects` — MAPEH, FIL, MANDARIN).
--   §2. Adds their `subject_configs` weight row for every AY that already
--       has subject_configs rows (not just the current AY, so the Task 2
--       monitoring table + report cards stay consistent across every AY),
--       plus one `template_subject_configs` row each (AY-agnostic, so
--       future AY rollovers pick them up automatically via Apply Template).
--   §3. Adds `subject_level_offerings` (per-AY) + `template_subject_level_
--       offerings` (AY-agnostic) rows: MAPEH → every Primary level; FIL →
--       every Primary AND every Secondary level; MANDARIN → P1–P4 for AYs
--       coded before 2026, P1–P4 + P5 for AY2026 onward (per-AY table
--       resolves this per academic_years.ay_code; the AY-agnostic template
--       table — which only ever feeds AY2026-onward rollovers going
--       forward — uses the P1–P5 "current" convention).
--   §4. Adds `subject_report_map` rows: FIL → MT, MANDARIN → MT (fan-in;
--       deliberately NOT a self-map — Filipino/Mandarin do not get their
--       own report-card column, they roll into MT's); MAPEH → itself
--       (explicit self-map — migration 080's blanket self-map seed only
--       covered subjects that existed at 080's run time, so MAPEH, being
--       new here, needs its own row).
--   §5. Retires MUSIC/ARTS/PE/HE: hard assertion (zero rows with real
--       score/grade CONTENT under any of the four — a `grade_entries` row
--       existing at all is NOT disqualifying, Hard Rule #3, null = "not
--       taken"), then FK-safe ordered delete (grade_entries →
--       grading_sheets → subject_configs → template_subject_configs →
--       subjects; verified against the actual ON DELETE
--       RESTRICT/CASCADE constraint definitions this session — see the
--       inline comments at each step for the exact constraint each delete
--       clears).
--   §6. Retargets MT to report-only: PER-AY (not global) — loops every AY
--       that has an MT subject_configs row, checks that ONE AY's grade
--       content, and strips its subject_configs / subject_level_offerings
--       rows ONLY when clean (an AY with real MT data is skipped and left
--       untouched, never asserted/aborted on); the AY-agnostic
--       template_subject_configs / template_subject_level_offerings rows
--       and the cosmetic MT→MT self-map are always stripped afterward (no
--       historical-data risk in either). The `subjects` row for MT is NOT
--       deleted — it is now the report target
--       `subject_report_map.report_subject_id` for Filipino/Mandarin.
--
-- Deliberately NOT done here (out of this migration's explicit scope —
-- flagged in the Task 3 report for the controller's awareness, not acted
-- on unilaterally): no `section_subjects` backfill for the 3 new subjects
-- on already-existing sections (that table is populated by
-- `sync_section_subjects_for_ay`, migration 079 — additive/idempotent and
-- safe to run later; running it here was judged outside the letter of this
-- migration's brief) and no `create_grading_sheets_for_ay` call (would
-- materialize brand-new empty grading sheets under every historical AY,
-- including closed/archived ones — a much bigger blast radius than a
-- catalog correction warrants).
--
-- REQUIRED DEPLOY STEP — without this, MAPEH/Filipino/Mandarin are inert:
-- until someone runs `select sync_section_subjects_for_ay('<current AY
-- code>')` (and then generates grading sheets for the affected sections,
-- same as any other new subject rollout) for at least the current
-- operational AY, these 3 subjects exist in the catalog and are "offered"
-- per `subject_level_offerings`, but appear on NO section's roster and
-- generate NO grading sheets. Add this to the deploy runbook alongside
-- applying this migration — do not treat the migration alone as
-- "MAPEH/Filipino/Mandarin are now live."
--
-- Idempotency: §1–§4 are pure ON CONFLICT DO NOTHING inserts, safe to
-- re-run unconditionally. §5 is gated on the four subjects still existing
-- — a re-run after a successful apply is a safe no-op (RAISE NOTICE only,
-- no assertion re-run, since the target rows are already gone). §6's
-- per-AY loop is naturally idempotent per row: an AY already stripped has
-- no subject_configs row left to match the loop's own source query, so it
-- simply stops appearing in a re-run; an AY that was skipped for real data
-- is re-evaluated and skipped again identically. The AY-agnostic
-- template-table + self-map deletes at the end of §6 are themselves
-- idempotent no-ops once already run (DELETE matching zero rows).
--
-- Non-atomicity note (accepted, matches migration 080's own precedent):
-- §1–§4 each commit independently (per-block begin/commit, not one
-- outer transaction), so if §5 aborts on its assertion, the 3 new
-- subjects + their configs/offerings/report-map rows stay committed while
-- MUSIC/ARTS/PE/HE remain in place — a mixed-but-idempotently-recoverable
-- state, not data loss. Re-running the migration after resolving whatever
-- the assertion flagged completes the rest cleanly (§1–§4 no-op via ON
-- CONFLICT, §5 picks up where it left off). §6 never raises/aborts at all
-- (per-AY rows with real data are silently, permanently skipped rather
-- than blocking anything) — its own do $$ block either fully completes or
-- fails on a genuine unexpected error, in which case standard Postgres
-- single-statement-block rollback applies (the whole §6 do $$ block is
-- itself one implicit transaction when not already inside an explicit
-- begin/commit). This mirrors 080's own transaction-per-block structure;
-- changing it to one all-or-nothing transaction is a separate, larger
-- decision, not made here.

-- ═════════════════════════════════════════════════════════════════════
-- 1. New catalog subjects
-- ═════════════════════════════════════════════════════════════════════

begin;

insert into public.subjects (code, name, is_examinable) values
  ('MAPEH',    'MAPEH',    true),
  ('FIL',      'Filipino', true),
  ('MANDARIN', 'Mandarin', true)
on conflict (code) do nothing;

commit;

-- ═════════════════════════════════════════════════════════════════════
-- 2. subject_configs (per-AY, gated on the AY already having subject_
--    configs rows) + template_subject_configs (AY-agnostic). Weights per
--    the resolved-data table: MAPEH 20/60/20, FIL/MANDARIN 30/50/20 each.
--    ww_max_slots / pt_max_slots / qa_max deliberately omitted from the
--    insert column lists — every other subject in this codebase's seed
--    data relies on the column defaults (5 / 5 / 30) rather than
--    hardcoding them; same here (Hard Rule #1 canonical qa_max default).
-- ═════════════════════════════════════════════════════════════════════

begin;

insert into public.subject_configs (
  academic_year_id, subject_id, ww_weight, pt_weight, qa_weight
)
select ay.id, subj.id, v.ww, v.pt, v.qa
from public.academic_years ay
cross join (values
  ('MAPEH',    0.20, 0.60, 0.20),
  ('FIL',      0.30, 0.50, 0.20),
  ('MANDARIN', 0.30, 0.50, 0.20)
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
  ('MAPEH',    0.20, 0.60, 0.20),
  ('FIL',      0.30, 0.50, 0.20),
  ('MANDARIN', 0.30, 0.50, 0.20)
) as v(code, ww, pt, qa)
join public.subjects subj on subj.code = v.code
on conflict (subject_id) do nothing;

commit;

-- ═════════════════════════════════════════════════════════════════════
-- 3. subject_level_offerings (per-AY) + template_subject_level_offerings
--    (AY-agnostic). MT's CURRENT offering levels are deliberately NOT
--    mirrored for Filipino — MT is Primary-only today, which is wrong for
--    this purpose (Filipino needs Secondary too); we derive from
--    levels.level_type directly per the resolved-data table instead.
-- ═════════════════════════════════════════════════════════════════════

begin;

-- MAPEH — every Primary level (level_type = 'primary', i.e. P1–P6).
insert into public.subject_level_offerings (subject_id, level_id, academic_year_id)
select subj.id, lv.id, ay.id
from public.academic_years ay
join public.subjects subj on subj.code = 'MAPEH'
join public.levels lv on lv.level_type = 'primary'
where exists (
  select 1 from public.subject_configs sc2 where sc2.academic_year_id = ay.id
)
on conflict (subject_id, level_id, academic_year_id) do nothing;

insert into public.template_subject_level_offerings (subject_id, level_id)
select subj.id, lv.id
from public.subjects subj
join public.levels lv on lv.level_type = 'primary'
where subj.code = 'MAPEH'
on conflict (subject_id, level_id) do nothing;

-- Filipino — every Primary level AND every Secondary level.
insert into public.subject_level_offerings (subject_id, level_id, academic_year_id)
select subj.id, lv.id, ay.id
from public.academic_years ay
join public.subjects subj on subj.code = 'FIL'
join public.levels lv on lv.level_type in ('primary', 'secondary')
where exists (
  select 1 from public.subject_configs sc2 where sc2.academic_year_id = ay.id
)
on conflict (subject_id, level_id, academic_year_id) do nothing;

insert into public.template_subject_level_offerings (subject_id, level_id)
select subj.id, lv.id
from public.subjects subj
join public.levels lv on lv.level_type in ('primary', 'secondary')
where subj.code = 'FIL'
on conflict (subject_id, level_id) do nothing;

-- Mandarin — P1–P4 for AYs coded before 2026, P1–P4 + P5 for AY2026
-- onward. AY codes are ^AY[0-9]{4}$ (KD #13); comparing
-- substring(ay_code from 3)::int against 2026 per the brief's resolved
-- rule. Test-AY codes (AY9998/AY9999/...) resolve >= 2026 — treated as
-- "current era", consistent with how test AYs are handled elsewhere.
insert into public.subject_level_offerings (subject_id, level_id, academic_year_id)
select subj.id, lv.id, ay.id
from public.academic_years ay
join public.subjects subj on subj.code = 'MANDARIN'
join public.levels lv
  on lv.level_type = 'primary'
 and (
   (substring(ay.ay_code from 3)::int < 2026 and lv.code in ('P1', 'P2', 'P3', 'P4'))
   or
   (substring(ay.ay_code from 3)::int >= 2026 and lv.code in ('P1', 'P2', 'P3', 'P4', 'P5'))
 )
where exists (
  select 1 from public.subject_configs sc2 where sc2.academic_year_id = ay.id
)
on conflict (subject_id, level_id, academic_year_id) do nothing;

-- Template (AY-agnostic) — feeds AY2026-onward rollovers only going
-- forward, so it uses the "current" P1–P5 convention.
insert into public.template_subject_level_offerings (subject_id, level_id)
select subj.id, lv.id
from public.subjects subj
join public.levels lv on lv.code in ('P1', 'P2', 'P3', 'P4', 'P5')
where subj.code = 'MANDARIN'
on conflict (subject_id, level_id) do nothing;

commit;

-- ═════════════════════════════════════════════════════════════════════
-- 4. subject_report_map — Filipino/Mandarin fan into MT (NOT a self-map —
--    they do not get their own report-card column); MAPEH self-maps
--    explicitly (new subject, migration 080's blanket self-map seed ran
--    before MAPEH existed so it never inherited one).
-- ═════════════════════════════════════════════════════════════════════

begin;

insert into public.subject_report_map (subject_id, report_subject_id)
select subj.id, mt.id
from public.subjects subj
join public.subjects mt on mt.code = 'MT'
where subj.code in ('FIL', 'MANDARIN')
on conflict (subject_id, report_subject_id) do nothing;

insert into public.subject_report_map (subject_id, report_subject_id)
select subj.id, subj.id
from public.subjects subj
where subj.code = 'MAPEH'
on conflict (subject_id, report_subject_id) do nothing;

commit;

-- ═════════════════════════════════════════════════════════════════════
-- 5. Retire MUSIC / ARTS / PE / HE — hard-assertion-gated FK-safe delete.
--    Exact order verified this session against the live constraint
--    definitions (see inline comments per step):
--      grade_entries.grading_sheet_id  -> grading_sheets   ON DELETE RESTRICT
--      grading_sheets.subject_id       -> subjects          ON DELETE RESTRICT
--      grading_sheets.subject_config_id-> subject_configs   ON DELETE RESTRICT
--      subject_configs.subject_id      -> subjects          ON DELETE RESTRICT
--      section_subjects.subject_config_id -> subject_configs ON DELETE CASCADE
--      template_subject_configs.subject_id -> subjects      ON DELETE RESTRICT
-- ═════════════════════════════════════════════════════════════════════

do $$
declare
  v_bad_count    bigint;
  v_ge_deleted   bigint := 0;
  v_gs_deleted   bigint := 0;
  v_sc_deleted   bigint := 0;
  v_tsc_deleted  bigint := 0;
  v_slo_deleted  bigint := 0;
  v_tslo_deleted bigint := 0;
  v_srm_deleted  bigint := 0;
  v_subj_deleted bigint := 0;
begin
  if not exists (
    select 1 from public.subjects where code in ('MUSIC', 'ARTS', 'PE', 'HE')
  ) then
    raise notice '[081] MUSIC/ARTS/PE/HE already retired — skipping (already applied).';
  else
    -- ── 5a. THE enforced precondition ──────────────────────────────────
    -- A grade_entries row existing at all is NOT disqualifying — Hard
    -- Rule #3: null = "not taken", not zero, and every grading-sheet
    -- creation path (create_grading_sheets_for_ay/_for_section/_for_scopes)
    -- pre-seeds a null-filled placeholder row for every active/late-
    -- enrolled roster student the moment a sheet exists, regardless of
    -- whether anyone ever entered a score. Only non-null score/grade
    -- CONTENT counts as real graded history that must block this
    -- migration.
    --
    -- CORRECTNESS-CRITICAL (final-review fix): the placeholder arrays
    -- `seed_grade_entries_for_sheet` (migration 036) writes are NULL-
    -- FILLED, not empty — `ww_scores = array_fill(null::numeric,
    -- array[v_ww_len])`, e.g. `{null,null,null,null,null}`.
    -- `array_length()` on THAT array returns the element count (5), not
    -- NULL — only a truly EMPTY `{}` array makes array_length() return
    -- NULL. A bare `coalesce(array_length(ge.ww_scores,1),0) > 0` check
    -- (this assertion's first-draft form) would therefore count every
    -- null-filled placeholder as "real data" and abort against any
    -- database with generated grading sheets — the normal, expected
    -- state, including the AY9999 test environment. `array_remove(arr,
    -- null)` strips the nulls first, so a fully-null placeholder
    -- correctly reduces to an empty array (array_length -> NULL ->
    -- coalesced to 0), while an array holding even one real score
    -- correctly stays non-empty.
    --
    -- Also checks `grade_audit_log` — an append-only record (Hard Rule
    -- #6) that current grade_entries content alone does not capture: a
    -- grade entered then nulled back out still leaves a real audit trail
    -- proving graded history occurred. Its own FK
    -- (`grading_sheet_id -> grading_sheets ON DELETE RESTRICT`, migration
    -- 001) would otherwise abort the delete at §5c with an opaque FK
    -- error instead of this clean, intentional message — and per Hard
    -- Rule #6 the audit rows themselves can never be deleted to work
    -- around it, so their existence is a hard, permanent block on
    -- retiring these subjects.
    select count(*) into v_bad_count
    from public.grade_entries ge
    join public.grading_sheets gs on gs.id = ge.grading_sheet_id
    join public.subjects subj on subj.id = gs.subject_id
    where subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
      and (
        coalesce(array_length(array_remove(ge.ww_scores, null), 1), 0) > 0
        or coalesce(array_length(array_remove(ge.pt_scores, null), 1), 0) > 0
        or ge.qa_score is not null
        or ge.quarterly_grade is not null
        or ge.letter_grade is not null
        or exists (
          select 1 from public.grade_audit_log gal
          where gal.grading_sheet_id = gs.id
        )
      );

    if v_bad_count > 0 then
      raise exception '[081] ABORT — % grade_entries row(s) under MUSIC/ARTS/PE/HE carry real score/grade content (non-null ww_scores/pt_scores/qa_score/quarterly_grade/letter_grade) or have grade_audit_log history. Retirement was only confirmed safe on the assumption these four subjects have zero real grade data. Migration aborted BEFORE any deletion — investigate the flagged rows before re-running this migration.', v_bad_count;
    end if;

    raise notice '[081] Assertion passed — zero real grade data under MUSIC/ARTS/PE/HE. Proceeding with retirement.';

    -- ── 5b. grade_entries — must go first; grading_sheets.id <-
    -- grade_entries.grading_sheet_id is ON DELETE RESTRICT, so
    -- grading_sheets cannot be deleted while ANY grade_entries row
    -- references it (empty placeholder or not — the assertion above only
    -- cleared them of REAL content, they still exist as rows).
    with doomed_sheets as (
      select gs.id
      from public.grading_sheets gs
      join public.subjects subj on subj.id = gs.subject_id
      where subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
    ),
    del as (
      delete from public.grade_entries ge
      using doomed_sheets ds
      where ge.grading_sheet_id = ds.id
      returning ge.id
    )
    select count(*) into v_ge_deleted from del;

    -- ── 5c. grading_sheets — subject_id AND subject_config_id are both
    -- ON DELETE RESTRICT against subjects/subject_configs respectively;
    -- must clear before both of those tables' deletes below.
    with del as (
      delete from public.grading_sheets gs
      using public.subjects subj
      where subj.id = gs.subject_id
        and subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
      returning gs.id
    )
    select count(*) into v_gs_deleted from del;

    -- ── 5d. subject_configs — ON DELETE RESTRICT against subjects.
    -- section_subjects.subject_config_id -> subject_configs is ON DELETE
    -- CASCADE (migration 079) — cleans up automatically, no separate
    -- delete needed for that table.
    with del as (
      delete from public.subject_configs sc
      using public.subjects subj
      where subj.id = sc.subject_id
        and subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
      returning sc.id
    )
    select count(*) into v_sc_deleted from del;

    -- ── 5e. template_subject_configs — separate ON DELETE RESTRICT
    -- against subjects, not touched by 5d.
    with del as (
      delete from public.template_subject_configs t
      using public.subjects subj
      where subj.id = t.subject_id
        and subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
      returning t.id
    )
    select count(*) into v_tsc_deleted from del;

    -- ── 5f. Optional polish — explicit cleanup of non-FK-blocking CASCADE
    -- children purely for clean RAISE NOTICE audit counts. subjects(id)
    -- cascades subject_level_offerings, template_subject_level_offerings,
    -- subject_report_map (both subject_id and report_subject_id columns),
    -- teacher_assignments.subject_id, and the dormant evaluation_* tables
    -- automatically on the subjects DELETE in 5g regardless of whether
    -- these run — not FK-blocking, just audit-trail clarity.
    with del as (
      delete from public.subject_level_offerings slo
      using public.subjects subj
      where subj.id = slo.subject_id
        and subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
      returning slo.id
    )
    select count(*) into v_slo_deleted from del;

    with del as (
      delete from public.template_subject_level_offerings tslo
      using public.subjects subj
      where subj.id = tslo.subject_id
        and subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
      returning tslo.id
    )
    select count(*) into v_tslo_deleted from del;

    with del as (
      delete from public.subject_report_map srm
      using public.subjects subj
      where (subj.id = srm.subject_id or subj.id = srm.report_subject_id)
        and subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
      returning srm.id
    )
    select count(*) into v_srm_deleted from del;

    -- ── 5g. The subjects rows themselves — now safe. Every remaining
    -- CASCADE child (teacher_assignments.subject_id, evaluation_* dormant
    -- provenance columns, any stray subject_report_map row 5f missed)
    -- cleans up automatically.
    with del as (
      delete from public.subjects
      where code in ('MUSIC', 'ARTS', 'PE', 'HE')
      returning id
    )
    select count(*) into v_subj_deleted from del;

    raise notice '[081] Retired MUSIC/ARTS/PE/HE — grade_entries: %, grading_sheets: %, subject_configs: %, template_subject_configs: %, subject_level_offerings: %, template_subject_level_offerings: %, subject_report_map: %, subjects: %.',
      v_ge_deleted, v_gs_deleted, v_sc_deleted, v_tsc_deleted, v_slo_deleted, v_tslo_deleted, v_srm_deleted, v_subj_deleted;
  end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════
-- 6. Retarget MT (Mother Tongue) to report-only — PER-AY scoped (see the
--    header's "REQUIRED PRE-STEP" note for why: MT has no consolidation
--    target the way MUSIC/ARTS/PE/HE do, so any AY with real MT grade
--    content is skipped and left completely untouched forever; only AYs
--    confirmed clean have their MT footprint stripped). The `subjects`
--    row for MT is NOT deleted (it is now the report target Filipino/
--    Mandarin fan into, §4) — never was, in any version of this
--    migration. The AY-agnostic template tables + the cosmetic MT->MT
--    self-map are stripped unconditionally at the end (no historical-data
--    risk in either).
-- ═════════════════════════════════════════════════════════════════════

do $$
declare
  v_ay            record;
  v_bad_count     bigint;
  v_ge_deleted    bigint;
  v_gs_deleted    bigint;
  v_sc_deleted    bigint;
  v_slo_deleted   bigint;
  v_ay_skipped    int := 0;
  v_ay_stripped   int := 0;
  v_ge_total      bigint := 0;
  v_gs_total      bigint := 0;
  v_sc_total      bigint := 0;
  v_slo_total     bigint := 0;
  v_tsc_deleted   bigint := 0;
  v_tslo_deleted  bigint := 0;
  v_srm_deleted   bigint := 0;
begin
  if not exists (
    select 1
    from public.subject_configs sc
    join public.subjects subj on subj.id = sc.subject_id
    where subj.code = 'MT'
  ) then
    raise notice '[081] MT — no per-AY subject_configs rows remain; skipping the per-AY pass (already applied or never offered directly).';
  else
    -- Per-AY: only strip an AY's MT footprint when that AY has ZERO real
    -- grade content under MT — same Hard-Rule-3-aware content check +
    -- grade_audit_log check as §5a, scoped to this one AY instead of
    -- globally.
    for v_ay in
      select ay.id, ay.ay_code
      from public.academic_years ay
      join public.subject_configs sc on sc.academic_year_id = ay.id
      join public.subjects subj on subj.id = sc.subject_id
      where subj.code = 'MT'
    loop
      select count(*) into v_bad_count
      from public.grade_entries ge
      join public.grading_sheets gs on gs.id = ge.grading_sheet_id
      join public.subjects subj on subj.id = gs.subject_id
      join public.sections sec on sec.id = gs.section_id
      where subj.code = 'MT'
        and sec.academic_year_id = v_ay.id
        and (
          coalesce(array_length(array_remove(ge.ww_scores, null), 1), 0) > 0
          or coalesce(array_length(array_remove(ge.pt_scores, null), 1), 0) > 0
          or ge.qa_score is not null
          or ge.quarterly_grade is not null
          or ge.letter_grade is not null
          or exists (
            select 1 from public.grade_audit_log gal
            where gal.grading_sheet_id = gs.id
          )
        );

      if v_bad_count > 0 then
        raise notice '[081] MT — % has % real grade_entries row(s) or grade_audit_log history; SKIPPING (this AY''s MT history stays exactly as recorded).', v_ay.ay_code, v_bad_count;
        v_ay_skipped := v_ay_skipped + 1;
        continue;
      end if;

      -- Clean AY — strip MT's footprint for this AY only. grade_entries
      -- first (ON DELETE RESTRICT chain, same order as §5b/§5c).
      with doomed_sheets as (
        select gs.id
        from public.grading_sheets gs
        join public.subjects subj on subj.id = gs.subject_id
        join public.sections sec on sec.id = gs.section_id
        where subj.code = 'MT' and sec.academic_year_id = v_ay.id
      ),
      del as (
        delete from public.grade_entries ge
        using doomed_sheets ds
        where ge.grading_sheet_id = ds.id
        returning ge.id
      )
      select count(*) into v_ge_deleted from del;

      with del as (
        delete from public.grading_sheets gs
        using public.subjects subj, public.sections sec
        where subj.id = gs.subject_id
          and sec.id = gs.section_id
          and subj.code = 'MT'
          and sec.academic_year_id = v_ay.id
        returning gs.id
      )
      select count(*) into v_gs_deleted from del;

      -- section_subjects rows pointing at this AY's MT subject_configs
      -- row cascade automatically (ON DELETE CASCADE, migration 079).
      with del as (
        delete from public.subject_configs sc
        using public.subjects subj
        where subj.id = sc.subject_id
          and subj.code = 'MT'
          and sc.academic_year_id = v_ay.id
        returning sc.id
      )
      select count(*) into v_sc_deleted from del;

      with del as (
        delete from public.subject_level_offerings slo
        using public.subjects subj
        where subj.id = slo.subject_id
          and subj.code = 'MT'
          and slo.academic_year_id = v_ay.id
        returning slo.id
      )
      select count(*) into v_slo_deleted from del;

      v_ay_stripped := v_ay_stripped + 1;
      v_ge_total := v_ge_total + v_ge_deleted;
      v_gs_total := v_gs_total + v_gs_deleted;
      v_sc_total := v_sc_total + v_sc_deleted;
      v_slo_total := v_slo_total + v_slo_deleted;

      raise notice '[081] MT — % confirmed clean, stripped (grade_entries: % [placeholders only], grading_sheets: %, subject_configs: %, subject_level_offerings: %).',
        v_ay.ay_code, v_ge_deleted, v_gs_deleted, v_sc_deleted, v_slo_deleted;
    end loop;

    raise notice '[081] MT per-AY pass complete — % AY(s) stripped (grade_entries: % [placeholders only], grading_sheets: %, subject_configs: %, subject_level_offerings: %), % AY(s) skipped (real historical data preserved untouched).',
      v_ay_stripped, v_ge_total, v_gs_total, v_sc_total, v_slo_total, v_ay_skipped;
  end if;

  -- AY-agnostic template tables — always safe (no historical grade data
  -- attached to a template row; future AY rollovers simply stop offering
  -- MT going forward regardless of what any past/present AY did above).
  with del as (
    delete from public.template_subject_configs t
    using public.subjects subj
    where subj.id = t.subject_id
      and subj.code = 'MT'
    returning t.id
  )
  select count(*) into v_tsc_deleted from del;

  with del as (
    delete from public.template_subject_level_offerings tslo
    using public.subjects subj
    where subj.id = tslo.subject_id
      and subj.code = 'MT'
    returning tslo.id
  )
  select count(*) into v_tslo_deleted from del;

  -- MT's own self-map (MT -> MT) is cosmetic clutter now that Filipino
  -- and Mandarin also fan into MT (a self-map that's also a fan-in target
  -- reads confusingly in the Task 2 monitoring table) — the Task 1
  -- grouping algorithm works correctly either way (MT's mapper count from
  -- Filipino+Mandarin alone is already > 1), this is purely cosmetic
  -- cleanliness per the brief. Not gated on any AY — removing a report-map
  -- row carries no grade-data risk.
  with del as (
    delete from public.subject_report_map srm
    using public.subjects subj
    where srm.subject_id = subj.id
      and srm.report_subject_id = subj.id
      and subj.code = 'MT'
    returning srm.id
  )
  select count(*) into v_srm_deleted from del;

  raise notice '[081] MT retargeting to report-only complete — template_subject_configs: %, template_subject_level_offerings: %, self-map rows removed: %. The subjects row for MT is preserved — it is still the report target for Filipino/Mandarin.',
    v_tsc_deleted, v_tslo_deleted, v_srm_deleted;
end $$;

-- ═════════════════════════════════════════════════════════════════════
-- Post-apply manual review queries:
--   select code, name, is_examinable from public.subjects
--     where code in ('MAPEH','FIL','MANDARIN','MT','MUSIC','ARTS','PE','HE')
--     order by code;
--   -- Expect: MAPEH/FIL/MANDARIN/MT present; MUSIC/ARTS/PE/HE absent.
--   select ay.ay_code, subj.code, sc.ww_weight, sc.pt_weight, sc.qa_weight
--     from public.subject_configs sc
--     join public.academic_years ay on ay.id = sc.academic_year_id
--     join public.subjects subj on subj.id = sc.subject_id
--     where subj.code in ('MAPEH','FIL','MANDARIN')
--     order by ay.ay_code, subj.code;
--   select subj.code as subject, rpt.code as reports_to
--     from public.subject_report_map srm
--     join public.subjects subj on subj.id = srm.subject_id
--     join public.subjects rpt on rpt.id = srm.report_subject_id
--     where rpt.code = 'MT' or subj.code = 'MAPEH'
--     order by subj.code;
-- ═════════════════════════════════════════════════════════════════════
