-- Migration 081: MAPEH / language catalog corrections. Design doc:
-- docs/superpowers/specs/2026-07-15-ay-setup-subject-weights-redesign-design.md
--
-- Two real HFSE catalog corrections, confirmed with the user (do not
-- re-litigate the "is this right" question — only the mechanics below are
-- this migration's job):
--
--   1. Primary "MAPEH" is graded as ONE combined subject in real HFSE
--      practice. The catalog currently — incorrectly — models it as 4
--      independent letter-graded subjects (MUSIC, ARTS, PE, HE). User
--      confirmed zero real grade data exists under any of the four — this
--      migration hard-deletes them, gated behind a runtime assertion (see
--      §5 below) that turns that confirmation into an ENFORCED
--      precondition rather than a trusted assumption. The new consolidated
--      `MAPEH` subject is numeric-graded (20/60/20) — a deliberate change
--      from the four letter-graded predecessors it replaces. Secondary has
--      no MAPEH concept; Secondary's own subjects (incl. `PEH`, a
--      different, unrelated subject) are untouched.
--   2. "Mother Tongue" (`MT`) is currently the directly-graded subject; it
--      becomes report-only. Two new subjects, `Filipino` (`FIL`) and
--      `Mandarin` (`MANDARIN`), both numeric (30/50/20), become the real
--      graded subjects — each fans into MT via `subject_report_map`
--      (migration 080, KD #155-candidate design doc). User confirmed MT
--      itself has zero real grade data — same enforced-assertion pattern.
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
--   §6. Retargets MT to report-only: same hard-assertion pattern, then
--       removes MT's own subject_configs / subject_level_offerings /
--       template_subject_configs / template_subject_level_offerings rows
--       (section_subjects cascades automatically, migration 079) + its own
--       MT→MT self-map row. The `subjects` row for MT is NOT deleted — it
--       is now the report target `subject_report_map.report_subject_id`
--       for Filipino/Mandarin.
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
-- Idempotency: §1–§4 are pure ON CONFLICT DO NOTHING inserts, safe to
-- re-run unconditionally. §5/§6 are gated on the four subjects / MT's
-- subject_configs row still existing — a re-run after a successful apply
-- is a safe no-op (RAISE NOTICE only, no assertion re-run, since the target
-- rows are already gone).

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
    -- migration. Empty numeric[] arrays are NOT null in Postgres —
    -- array_length() returns NULL (not 0) for an empty array, hence the
    -- coalesce(..., 0) > 0 form (same idiom migration 080 uses).
    select count(*) into v_bad_count
    from public.grade_entries ge
    join public.grading_sheets gs on gs.id = ge.grading_sheet_id
    join public.subjects subj on subj.id = gs.subject_id
    where subj.code in ('MUSIC', 'ARTS', 'PE', 'HE')
      and (
        coalesce(array_length(ge.ww_scores, 1), 0) > 0
        or coalesce(array_length(ge.pt_scores, 1), 0) > 0
        or ge.qa_score is not null
        or ge.quarterly_grade is not null
        or ge.letter_grade is not null
      );

    if v_bad_count > 0 then
      raise exception '[081] ABORT — % grade_entries row(s) under MUSIC/ARTS/PE/HE carry real score/grade content (non-null ww_scores/pt_scores/qa_score/quarterly_grade/letter_grade). Retirement was only confirmed safe on the assumption these four subjects have zero real grade data. Migration aborted BEFORE any deletion — investigate the flagged rows before re-running this migration.', v_bad_count;
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
-- 6. Retarget MT (Mother Tongue) to report-only — same hard-assertion
--    pattern as §5. The `subjects` row for MT is NOT deleted (it is now
--    the report target Filipino/Mandarin fan into, §4) — only its own
--    direct-offering footprint (subject_configs / subject_level_offerings
--    / template_subject_configs / template_subject_level_offerings / its
--    own MT→MT self-map) is removed.
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
begin
  if not exists (
    select 1
    from public.subject_configs sc
    join public.subjects subj on subj.id = sc.subject_id
    where subj.code = 'MT'
  ) then
    raise notice '[081] MT already retargeted to report-only — skipping (already applied).';
  else
    -- Same enforced precondition as §5a, scoped to MT.
    select count(*) into v_bad_count
    from public.grade_entries ge
    join public.grading_sheets gs on gs.id = ge.grading_sheet_id
    join public.subjects subj on subj.id = gs.subject_id
    where subj.code = 'MT'
      and (
        coalesce(array_length(ge.ww_scores, 1), 0) > 0
        or coalesce(array_length(ge.pt_scores, 1), 0) > 0
        or ge.qa_score is not null
        or ge.quarterly_grade is not null
        or ge.letter_grade is not null
      );

    if v_bad_count > 0 then
      raise exception '[081] ABORT — % grade_entries row(s) under MT (Mother Tongue) carry real score/grade content (non-null ww_scores/pt_scores/qa_score/quarterly_grade/letter_grade). Retargeting MT to report-only was only confirmed safe on the assumption it has zero real grade data. Migration aborted BEFORE any deletion — investigate the flagged rows before re-running this migration.', v_bad_count;
    end if;

    raise notice '[081] Assertion passed — zero real grade data under MT. Proceeding with retargeting to report-only.';

    -- grade_entries first — same ON DELETE RESTRICT chain as §5b.
    with doomed_sheets as (
      select gs.id
      from public.grading_sheets gs
      join public.subjects subj on subj.id = gs.subject_id
      where subj.code = 'MT'
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
      using public.subjects subj
      where subj.id = gs.subject_id
        and subj.code = 'MT'
      returning gs.id
    )
    select count(*) into v_gs_deleted from del;

    -- section_subjects rows pointing at MT's subject_configs row cascade
    -- automatically (ON DELETE CASCADE, migration 079) on this delete.
    with del as (
      delete from public.subject_configs sc
      using public.subjects subj
      where subj.id = sc.subject_id
        and subj.code = 'MT'
      returning sc.id
    )
    select count(*) into v_sc_deleted from del;

    with del as (
      delete from public.template_subject_configs t
      using public.subjects subj
      where subj.id = t.subject_id
        and subj.code = 'MT'
      returning t.id
    )
    select count(*) into v_tsc_deleted from del;

    with del as (
      delete from public.subject_level_offerings slo
      using public.subjects subj
      where subj.id = slo.subject_id
        and subj.code = 'MT'
      returning slo.id
    )
    select count(*) into v_slo_deleted from del;

    with del as (
      delete from public.template_subject_level_offerings tslo
      using public.subjects subj
      where subj.id = tslo.subject_id
        and subj.code = 'MT'
      returning tslo.id
    )
    select count(*) into v_tslo_deleted from del;

    -- MT's own self-map (MT -> MT) is cosmetic clutter now that Filipino
    -- and Mandarin also fan into MT (a self-map that's also a fan-in
    -- target reads confusingly in the Task 2 monitoring table) — the
    -- Task 1 grouping algorithm works correctly either way (MT's mapper
    -- count from Filipino+Mandarin alone is already > 1), this is purely
    -- cosmetic cleanliness per the brief.
    with del as (
      delete from public.subject_report_map srm
      using public.subjects subj
      where srm.subject_id = subj.id
        and srm.report_subject_id = subj.id
        and subj.code = 'MT'
      returning srm.id
    )
    select count(*) into v_srm_deleted from del;

    raise notice '[081] Retargeted MT to report-only — grade_entries: %, grading_sheets: %, subject_configs: %, template_subject_configs: %, subject_level_offerings: %, template_subject_level_offerings: %, self-map rows removed: %. The subjects row for MT is preserved — it is still the report target for Filipino/Mandarin.',
      v_ge_deleted, v_gs_deleted, v_sc_deleted, v_tsc_deleted, v_slo_deleted, v_tslo_deleted, v_srm_deleted;
  end if;
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
