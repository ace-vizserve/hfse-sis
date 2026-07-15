-- Migration 080: Subject Weights Collapse — Phase 1 of the AY-Setup +
-- Subject Weights redesign. Design doc:
-- docs/superpowers/specs/2026-07-15-ay-setup-subject-weights-redesign-design.md
--
-- Verified bug: WW/PT/QA weights are currently derived from LEVEL TYPE
-- (lib/sis/level-profiles.ts::weightProfileFor — primary→40/40/20,
-- secondary→30/50/20) instead of SUBJECT IDENTITY. Real HFSE data shows
-- weight is a property of the subject, not the level it happens to be
-- taught at — English is 30/50/20 at every level it's taught (P1 through
-- S4); MAPEH-family subjects are 20/60/20 everywhere. `subject_configs` is
-- keyed (academic_year_id, subject_id, level_id) today, so the same
-- subject at two levels is two independent, driftable rows.
--
-- This migration:
--   1. New `subject_level_offerings(subject_id, level_id, academic_year_id)`
--      — "this subject is part of this level's curriculum this year" —
--      backfilled from every (subject, level, AY) combo that exists in
--      `subject_configs` BEFORE the collapse below removes them. Same
--      role-gated-read / deny-write RLS pattern as `ay_level_offerings`
--      (migration 078) / `section_subjects` (migration 079).
--   2. New `template_subject_level_offerings(subject_id, level_id)` — the
--      AY-agnostic sibling for the Structure Defaults master, same
--      backfill-before-collapse treatment against `template_subject_configs`.
--   3. New `subject_report_map(subject_id, report_subject_id)` — many-to-
--      many "reports to" mapping, infrastructure for future report-card
--      column consolidation (e.g. a deferred MAPEH fan-out). Seeded 1:1
--      self-map for every existing subject — zero behaviour change.
--      `report_subject_id` references `subjects(id)` directly — Mother
--      Tongue ('MT') already exists as its own directly-graded subject row
--      (verified in supabase/seed.sql + lib/sis/seeder/fixtures.ts), and no
--      Filipino/Mandarin rows exist yet that would need a separate
--      report-only catalog table. If those ever get added as real taught
--      subjects, they map into MT the same way every other row does.
--   4. `subject_configs` collapsed in place (alters the existing table —
--      `grading_sheets.subject_config_id` / `section_subjects.subject_config_id`
--      keep pointing at `public.subject_configs(id)`, no FK retarget) to one
--      row per (subject_id, academic_year_id). Reconciliation pass: groups
--      today's per-level rows by (academic_year_id, subject_id), and for
--      any group where the levels genuinely disagree on config (a real
--      possibility — divergence today is a symptom of the
--      weightProfileFor(levelType) bug, not a deliberate choice), picks the
--      MOST COMMON full row (ww/pt/qa weight + ww/pt max slots + qa_max) as
--      canonical and logs every divergent subject — both via RAISE NOTICE
--      and a persistent `public.subject_weight_reconciliation_log` table —
--      for manual review. `grading_sheets` and `section_subjects` rows
--      that pointed at a row about to be deleted are repointed to the
--      surviving canonical row first (required — `grading_sheets`'s FK is
--      ON DELETE RESTRICT and would abort the migration otherwise;
--      `section_subjects`'s FK is ON DELETE CASCADE and would silently
--      destroy per-section subject customizations otherwise). Then
--      `level_id` is dropped and the unique constraint narrows to
--      (academic_year_id, subject_id).
--   5. Same split for `template_subject_configs` (Structure Defaults
--      master, migration 031) — no per-AY dimension, no FK pointing at it
--      so no repoint step needed.
--   6. `apply_template_to_ay` (newest live body: migration 074, NOT 063 —
--      074 threaded `schedule` through this function after 063; a stale-
--      base re-emit here would have silently regressed KD #144's schedule
--      propagation on every future "Apply template" run. Verified via grep
--      for BOTH `create or replace function` and the uppercase
--      `CREATE OR REPLACE FUNCTION` spelling that 063 (and 074) used; KD
--      #119 hazard) and `create_academic_year` + `sync_section_subjects_for_ay`
--      (newest live body: migration 079) are re-emitted to read/write the
--      new subject-scoped `subject_configs` shape and the new offerings
--      tables. These three are fixed here — even though they're not
--      individually named as this task's deliverable list — because this
--      migration's own column drop is what breaks them, and leaving
--      AY-rollover / template-apply completely non-functional between
--      phases was judged worse than the letter of "schema + kill-the-
--      default-fill only." See the Task 1 report for the full reasoning.
--   7. `create_grading_sheets_for_ay` / `create_grading_sheets_for_section`
--      / `create_grading_sheets_for_scopes` (newest live bodies: 036 / 036
--      / 060) are ALSO re-emitted — `create_grading_sheets_for_ay` is
--      called directly by the seeder (this task's own file), so it had to
--      be fixed; the other two share the exact same one-line join fix, so
--      they're fixed alongside for consistency (see §8 below for the full
--      reasoning + what's still NOT restored end-to-end by this).
--
-- Deliberately NOT touched by this migration (left for later phases — the
-- /sis/admin/subjects tree UI rebuild is explicitly later-phase work):
--   - `sync_grading_sheets_from_config` (migration 052) does not reference
--     level_id at all — verified, unaffected, not touched.
--   - `app/api/grading-sheets/bulk-create/route.ts` + its `preview/route.ts`
--     sibling run their own inline subject_configs.level_id queries in
--     TypeScript BEFORE calling create_grading_sheets_for_scopes — fixing
--     the RPC (§8) does not restore that guided-generation flow end-to-end;
--     only the seeder + new-section paths are fully restored. Bulk grading-
--     sheet creation is broken until that lands.
--   - Every TypeScript call site that still selects/joins on
--     `subject_configs.level_id` (the /sis/admin/subjects matrix, the
--     /sis/admin/template editor, grading-sheet API routes, the masterfile
--     loader, etc.) — the Supabase client here is untyped (no generated
--     Database types), so none of these fail `tsc`/`next build`; they will
--     fail at RUNTIME (PostgREST 400, missing column) until later phases
--     update them. Explicitly sanctioned by the Task 1 brief.
--
-- `grade_type` column: NOT added. `subjects.is_examinable` already drives
-- every numeric-vs-letter decision in the codebase today (KD #104 — the
-- annual-letter route, score-entry-grid, grading routes, letter-grade
-- compute all branch on it) and is even MORE global than the per-AY
-- `subject_configs` row this migration collapses to. Adding `grade_type`
-- here would be a second source of truth for data that's already modelled
-- correctly. See the Task 1 report for the verification trail.
--
-- Idempotency: the two collapse blocks (subject_configs, template_subject_
-- configs) are gated on the target column (`level_id`) still existing, so
-- re-running this file after a successful apply is a safe no-op for those
-- sections (the reconciliation logic itself reads `level_id`, which no
-- longer exists post-collapse — re-running blind would otherwise error).
-- Table creation / RLS / seed sections use the standard IF NOT EXISTS +
-- ON CONFLICT DO NOTHING idempotency already established by 078/079. The
-- RPC re-emits are CREATE OR REPLACE — always safe to re-run.

-- ═════════════════════════════════════════════════════════════════════
-- 1. subject_level_offerings — table + RLS (backfill happens in §4, which
--    needs the pre-collapse subject_configs.level_id column to still exist)
-- ═════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.subject_level_offerings (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  level_id uuid not null references public.levels(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (subject_id, level_id, academic_year_id)
);

create index if not exists subject_level_offerings_ay_idx
  on public.subject_level_offerings (academic_year_id);
create index if not exists subject_level_offerings_level_idx
  on public.subject_level_offerings (level_id);

-- RLS — same role-gated read + explicit write-deny pattern as
-- ay_level_offerings (078) / section_subjects (079). Writes go through
-- service-role RPCs/routes only; the deny policies fail closed if a
-- cookie-bound client ever tries.
alter table public.subject_level_offerings enable row level security;

drop policy if exists subject_level_offerings_role_read on public.subject_level_offerings;
create policy subject_level_offerings_role_read
  on public.subject_level_offerings for select to authenticated
  using (public.current_user_role() is not null);

drop policy if exists subject_level_offerings_no_insert on public.subject_level_offerings;
create policy subject_level_offerings_no_insert
  on public.subject_level_offerings for insert to authenticated with check (false);

drop policy if exists subject_level_offerings_no_update on public.subject_level_offerings;
create policy subject_level_offerings_no_update
  on public.subject_level_offerings for update to authenticated
  using (false) with check (false);

drop policy if exists subject_level_offerings_no_delete on public.subject_level_offerings;
create policy subject_level_offerings_no_delete
  on public.subject_level_offerings for delete to authenticated using (false);

commit;

-- ═════════════════════════════════════════════════════════════════════
-- 2. template_subject_level_offerings — table + RLS (AY-agnostic sibling)
-- ═════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.template_subject_level_offerings (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  level_id uuid not null references public.levels(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (subject_id, level_id)
);

create index if not exists template_subject_level_offerings_level_idx
  on public.template_subject_level_offerings (level_id);

alter table public.template_subject_level_offerings enable row level security;

drop policy if exists template_subject_level_offerings_role_read on public.template_subject_level_offerings;
create policy template_subject_level_offerings_role_read
  on public.template_subject_level_offerings for select to authenticated
  using (public.current_user_role() is not null);

drop policy if exists template_subject_level_offerings_no_insert on public.template_subject_level_offerings;
create policy template_subject_level_offerings_no_insert
  on public.template_subject_level_offerings for insert to authenticated with check (false);

drop policy if exists template_subject_level_offerings_no_update on public.template_subject_level_offerings;
create policy template_subject_level_offerings_no_update
  on public.template_subject_level_offerings for update to authenticated
  using (false) with check (false);

drop policy if exists template_subject_level_offerings_no_delete on public.template_subject_level_offerings;
create policy template_subject_level_offerings_no_delete
  on public.template_subject_level_offerings for delete to authenticated using (false);

commit;

-- ═════════════════════════════════════════════════════════════════════
-- 3. subject_report_map — table + RLS + 1:1 self-map seed
-- ═════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.subject_report_map (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  report_subject_id uuid not null references public.subjects(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (subject_id, report_subject_id)
);

create index if not exists subject_report_map_report_subject_idx
  on public.subject_report_map (report_subject_id);

alter table public.subject_report_map enable row level security;

drop policy if exists subject_report_map_role_read on public.subject_report_map;
create policy subject_report_map_role_read
  on public.subject_report_map for select to authenticated
  using (public.current_user_role() is not null);

drop policy if exists subject_report_map_no_insert on public.subject_report_map;
create policy subject_report_map_no_insert
  on public.subject_report_map for insert to authenticated with check (false);

drop policy if exists subject_report_map_no_update on public.subject_report_map;
create policy subject_report_map_no_update
  on public.subject_report_map for update to authenticated
  using (false) with check (false);

drop policy if exists subject_report_map_no_delete on public.subject_report_map;
create policy subject_report_map_no_delete
  on public.subject_report_map for delete to authenticated using (false);

-- Seed: every existing subject self-maps to its own report column.
-- Zero behaviour change — no consumer reads this table yet. A future phase
-- adds real fan-in (Filipino/Mandarin → Mother Tongue) or fan-out (MAPEH,
-- pending HFSE confirmation, KD reference in the design doc) rows without
-- touching this seed.
insert into public.subject_report_map (subject_id, report_subject_id)
select id, id from public.subjects
on conflict (subject_id, report_subject_id) do nothing;

commit;

-- ═════════════════════════════════════════════════════════════════════
-- 4. subject_configs collapse — reconciliation, repoint, delete, alter.
--    Gated on level_id still existing so a re-run of this file is a no-op.
-- ═════════════════════════════════════════════════════════════════════

begin;

-- Persistent reconciliation log — NOT dropped after the migration; kept so
-- a human can review every subject where per-level configs genuinely
-- disagreed before the collapse picked one. Covers both subject_configs
-- (per-AY, `source = 'subject_configs'`) and template_subject_configs
-- (AY-agnostic, `source = 'template_subject_configs'`, academic_year_id/
-- ay_code left null) in one table.
create table if not exists public.subject_weight_reconciliation_log (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('subject_configs', 'template_subject_configs')),
  academic_year_id uuid,
  ay_code text,
  subject_id uuid not null,
  subject_code text,
  level_count int not null,
  distinct_combo_count int not null,
  canonical_combo jsonb not null,
  all_combos jsonb not null,
  logged_at timestamptz not null default now()
);

alter table public.subject_weight_reconciliation_log enable row level security;

drop policy if exists subject_weight_reconciliation_log_role_read on public.subject_weight_reconciliation_log;
create policy subject_weight_reconciliation_log_role_read
  on public.subject_weight_reconciliation_log for select to authenticated
  using (public.current_user_role() is not null);

drop policy if exists subject_weight_reconciliation_log_no_insert on public.subject_weight_reconciliation_log;
create policy subject_weight_reconciliation_log_no_insert
  on public.subject_weight_reconciliation_log for insert to authenticated with check (false);

drop policy if exists subject_weight_reconciliation_log_no_update on public.subject_weight_reconciliation_log;
create policy subject_weight_reconciliation_log_no_update
  on public.subject_weight_reconciliation_log for update to authenticated
  using (false) with check (false);

drop policy if exists subject_weight_reconciliation_log_no_delete on public.subject_weight_reconciliation_log;
create policy subject_weight_reconciliation_log_no_delete
  on public.subject_weight_reconciliation_log for delete to authenticated using (false);

do $$
declare
  v_has_level_id boolean;
  v_total_divergent int := 0;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'subject_configs'
      and column_name = 'level_id'
  ) into v_has_level_id;

  if not v_has_level_id then
    raise notice '[080] subject_configs.level_id already dropped — skipping collapse (already applied).';
    return;
  end if;

  -- ── 4a. Backfill subject_level_offerings from every pre-collapse row ──
  execute $sql$
    insert into public.subject_level_offerings (subject_id, level_id, academic_year_id)
    select distinct subject_id, level_id, academic_year_id
    from public.subject_configs
    on conflict (subject_id, level_id, academic_year_id) do nothing
  $sql$;

  -- ── 4b. Resolve one canonical subject_configs.id per (ay, subject) ──
  -- "Canonical" = the id belonging to the most common full row
  -- (ww/pt/qa weight + ww/pt max slots + qa_max) within that subject's
  -- group; ties on count broken deterministically by the combo's own
  -- values, then by lowest level_id among rows sharing the winning combo.
  execute 'drop table if exists public._sw080_canonical';
  execute $sql$
    create table public._sw080_canonical as
    with combo_counts as (
      select academic_year_id, subject_id,
             ww_weight, pt_weight, qa_weight,
             ww_max_slots, pt_max_slots, qa_max,
             count(*) as n
      from public.subject_configs
      group by academic_year_id, subject_id,
               ww_weight, pt_weight, qa_weight,
               ww_max_slots, pt_max_slots, qa_max
    ),
    ranked_combo as (
      select *,
        row_number() over (
          partition by academic_year_id, subject_id
          order by n desc, ww_weight, pt_weight, qa_weight,
                   ww_max_slots, pt_max_slots, qa_max
        ) as combo_rank
      from combo_counts
    ),
    winning_combo as (
      select academic_year_id, subject_id,
             ww_weight, pt_weight, qa_weight,
             ww_max_slots, pt_max_slots, qa_max
      from ranked_combo where combo_rank = 1
    ),
    candidate_rows as (
      select sc.id, sc.academic_year_id, sc.subject_id,
        row_number() over (
          partition by sc.academic_year_id, sc.subject_id
          order by sc.level_id
        ) as pick_rank
      from public.subject_configs sc
      join winning_combo w
        on w.academic_year_id = sc.academic_year_id
       and w.subject_id       = sc.subject_id
       and w.ww_weight        = sc.ww_weight
       and w.pt_weight        = sc.pt_weight
       and w.qa_weight        = sc.qa_weight
       and w.ww_max_slots     = sc.ww_max_slots
       and w.pt_max_slots     = sc.pt_max_slots
       and w.qa_max           = sc.qa_max
    )
    select id as canonical_id, academic_year_id, subject_id
    from candidate_rows
    where pick_rank = 1
  $sql$;

  -- ── 4c. Log every subject+AY where levels genuinely disagreed ──
  execute $sql$
    insert into public.subject_weight_reconciliation_log (
      source, academic_year_id, ay_code, subject_id, subject_code,
      level_count, distinct_combo_count, canonical_combo, all_combos
    )
    select
      'subject_configs', g.academic_year_id, ay.ay_code, g.subject_id, subj.code,
      g.level_count, g.distinct_combo_count,
      jsonb_build_object(
        'ww_weight', canon.ww_weight, 'pt_weight', canon.pt_weight, 'qa_weight', canon.qa_weight,
        'ww_max_slots', canon.ww_max_slots, 'pt_max_slots', canon.pt_max_slots, 'qa_max', canon.qa_max
      ),
      g.all_combos
    from (
      select
        sc.academic_year_id, sc.subject_id,
        count(*) as level_count,
        count(distinct (sc.ww_weight, sc.pt_weight, sc.qa_weight, sc.ww_max_slots, sc.pt_max_slots, sc.qa_max)) as distinct_combo_count,
        jsonb_agg(jsonb_build_object(
          'level_id', sc.level_id,
          'ww_weight', sc.ww_weight, 'pt_weight', sc.pt_weight, 'qa_weight', sc.qa_weight,
          'ww_max_slots', sc.ww_max_slots, 'pt_max_slots', sc.pt_max_slots, 'qa_max', sc.qa_max
        )) as all_combos
      from public.subject_configs sc
      group by sc.academic_year_id, sc.subject_id
      having count(distinct (sc.ww_weight, sc.pt_weight, sc.qa_weight, sc.ww_max_slots, sc.pt_max_slots, sc.qa_max)) > 1
    ) g
    join public.academic_years ay on ay.id = g.academic_year_id
    join public.subjects subj on subj.id = g.subject_id
    join public._sw080_canonical tc
      on tc.academic_year_id = g.academic_year_id and tc.subject_id = g.subject_id
    join public.subject_configs canon on canon.id = tc.canonical_id
  $sql$;

  select count(*) into v_total_divergent
  from public.subject_weight_reconciliation_log
  where source = 'subject_configs';

  if v_total_divergent = 0 then
    raise notice '[080] subject_configs: no weight divergence found — every subject already agreed across levels.';
  else
    raise notice '[080] subject_configs: % subject/AY group(s) had divergent weights across levels — canonical (most-common) combo picked for each; see public.subject_weight_reconciliation_log.', v_total_divergent;
  end if;

  -- ── 4d. Repoint FK consumers to the surviving canonical row ──
  -- grading_sheets.subject_config_id is ON DELETE RESTRICT — the delete
  -- below would abort without this. section_subjects.subject_config_id is
  -- ON DELETE CASCADE — without this, deleting a non-canonical row would
  -- silently destroy that section's subject customization.
  execute $sql$
    update public.grading_sheets gs
    set subject_config_id = tc.canonical_id
    from public.subject_configs sc
    join public._sw080_canonical tc
      on tc.academic_year_id = sc.academic_year_id and tc.subject_id = sc.subject_id
    where gs.subject_config_id = sc.id
      and sc.id <> tc.canonical_id
  $sql$;

  execute $sql$
    update public.section_subjects ss
    set subject_config_id = tc.canonical_id
    from public.subject_configs sc
    join public._sw080_canonical tc
      on tc.academic_year_id = sc.academic_year_id and tc.subject_id = sc.subject_id
    where ss.subject_config_id = sc.id
      and sc.id <> tc.canonical_id
    -- A section could already have a section_subjects row for the
    -- canonical id (e.g. two levels' rows both pointed at configs that
    -- collapse together for a section that — implausibly, since
    -- section_subjects is per-section-per-config — already had both).
    -- ON CONFLICT isn't available on UPDATE; guard defensively instead so
    -- a conflicting repoint is skipped rather than erroring the migration.
    and not exists (
      select 1 from public.section_subjects ss2
      where ss2.section_id = ss.section_id
        and ss2.subject_config_id = tc.canonical_id
    )
  $sql$;

  -- Any section_subjects rows that couldn't repoint (the guard above) are
  -- now redundant duplicates of an already-repointed row for the same
  -- section — safe to drop since the section's subject selection is
  -- already represented via the canonical row.
  execute $sql$
    delete from public.section_subjects ss
    using public.subject_configs sc
    join public._sw080_canonical tc
      on tc.academic_year_id = sc.academic_year_id and tc.subject_id = sc.subject_id
    where ss.subject_config_id = sc.id
      and sc.id <> tc.canonical_id
  $sql$;

  -- ── 4e. Delete non-canonical subject_configs rows ──
  execute $sql$
    delete from public.subject_configs sc
    using public._sw080_canonical tc
    where tc.academic_year_id = sc.academic_year_id
      and tc.subject_id = sc.subject_id
      and sc.id <> tc.canonical_id
  $sql$;

  -- ── 4f. Drop level_id, narrow the unique constraint ──
  execute 'alter table public.subject_configs drop constraint if exists subject_configs_academic_year_id_subject_id_level_id_key';
  execute 'alter table public.subject_configs drop column if exists level_id';
  execute 'alter table public.subject_configs add constraint subject_configs_academic_year_id_subject_id_key unique (academic_year_id, subject_id)';

  execute 'drop table if exists public._sw080_canonical';
end $$;

commit;

-- ═════════════════════════════════════════════════════════════════════
-- 5. template_subject_configs collapse — same treatment, no per-AY
--    dimension and no FK pointing at it (no repoint step needed).
-- ═════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  v_has_level_id boolean;
  v_total_divergent int := 0;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'template_subject_configs'
      and column_name = 'level_id'
  ) into v_has_level_id;

  if not v_has_level_id then
    raise notice '[080] template_subject_configs.level_id already dropped — skipping collapse (already applied).';
    return;
  end if;

  -- Backfill template_subject_level_offerings from every pre-collapse row.
  execute $sql$
    insert into public.template_subject_level_offerings (subject_id, level_id)
    select distinct subject_id, level_id
    from public.template_subject_configs
    on conflict (subject_id, level_id) do nothing
  $sql$;

  execute 'drop table if exists public._sw080_tcanonical';
  execute $sql$
    create table public._sw080_tcanonical as
    with combo_counts as (
      select subject_id,
             ww_weight, pt_weight, qa_weight,
             ww_max_slots, pt_max_slots, qa_max,
             count(*) as n
      from public.template_subject_configs
      group by subject_id, ww_weight, pt_weight, qa_weight,
               ww_max_slots, pt_max_slots, qa_max
    ),
    ranked_combo as (
      select *,
        row_number() over (
          partition by subject_id
          order by n desc, ww_weight, pt_weight, qa_weight,
                   ww_max_slots, pt_max_slots, qa_max
        ) as combo_rank
      from combo_counts
    ),
    winning_combo as (
      select subject_id,
             ww_weight, pt_weight, qa_weight,
             ww_max_slots, pt_max_slots, qa_max
      from ranked_combo where combo_rank = 1
    ),
    candidate_rows as (
      select t.id, t.subject_id,
        row_number() over (
          partition by t.subject_id
          order by t.level_id
        ) as pick_rank
      from public.template_subject_configs t
      join winning_combo w
        on w.subject_id     = t.subject_id
       and w.ww_weight      = t.ww_weight
       and w.pt_weight      = t.pt_weight
       and w.qa_weight      = t.qa_weight
       and w.ww_max_slots   = t.ww_max_slots
       and w.pt_max_slots   = t.pt_max_slots
       and w.qa_max         = t.qa_max
    )
    select id as canonical_id, subject_id
    from candidate_rows
    where pick_rank = 1
  $sql$;

  execute $sql$
    insert into public.subject_weight_reconciliation_log (
      source, academic_year_id, ay_code, subject_id, subject_code,
      level_count, distinct_combo_count, canonical_combo, all_combos
    )
    select
      'template_subject_configs', null, null, g.subject_id, subj.code,
      g.level_count, g.distinct_combo_count,
      jsonb_build_object(
        'ww_weight', canon.ww_weight, 'pt_weight', canon.pt_weight, 'qa_weight', canon.qa_weight,
        'ww_max_slots', canon.ww_max_slots, 'pt_max_slots', canon.pt_max_slots, 'qa_max', canon.qa_max
      ),
      g.all_combos
    from (
      select
        t.subject_id,
        count(*) as level_count,
        count(distinct (t.ww_weight, t.pt_weight, t.qa_weight, t.ww_max_slots, t.pt_max_slots, t.qa_max)) as distinct_combo_count,
        jsonb_agg(jsonb_build_object(
          'level_id', t.level_id,
          'ww_weight', t.ww_weight, 'pt_weight', t.pt_weight, 'qa_weight', t.qa_weight,
          'ww_max_slots', t.ww_max_slots, 'pt_max_slots', t.pt_max_slots, 'qa_max', t.qa_max
        )) as all_combos
      from public.template_subject_configs t
      group by t.subject_id
      having count(distinct (t.ww_weight, t.pt_weight, t.qa_weight, t.ww_max_slots, t.pt_max_slots, t.qa_max)) > 1
    ) g
    join public.subjects subj on subj.id = g.subject_id
    join public._sw080_tcanonical tc on tc.subject_id = g.subject_id
    join public.template_subject_configs canon on canon.id = tc.canonical_id
  $sql$;

  select count(*) into v_total_divergent
  from public.subject_weight_reconciliation_log
  where source = 'template_subject_configs';

  if v_total_divergent = 0 then
    raise notice '[080] template_subject_configs: no weight divergence found — every subject already agreed across levels.';
  else
    raise notice '[080] template_subject_configs: % subject(s) had divergent weights across levels — canonical (most-common) combo picked for each; see public.subject_weight_reconciliation_log.', v_total_divergent;
  end if;

  -- No FK anywhere points at template_subject_configs.id — plain delete.
  execute $sql$
    delete from public.template_subject_configs t
    using public._sw080_tcanonical tc
    where tc.subject_id = t.subject_id
      and t.id <> tc.canonical_id
  $sql$;

  execute 'alter table public.template_subject_configs drop constraint if exists template_subject_configs_subject_id_level_id_key';
  execute 'alter table public.template_subject_configs drop column if exists level_id';
  execute 'alter table public.template_subject_configs add constraint template_subject_configs_subject_id_key unique (subject_id)';

  execute 'drop table if exists public._sw080_tcanonical';
end $$;

commit;

-- ═════════════════════════════════════════════════════════════════════
-- 6. apply_template_to_ay re-emit — newest live body is migration 074
--    (NOT 063 — 074 threaded `schedule` through this same function after
--    063; a prior draft of this migration re-emitted from 063 and would
--    have silently regressed KD #144's schedule propagation. Grep hazard
--    noted for the record: 063 used uppercase `CREATE OR REPLACE FUNCTION`,
--    which a lowercase-only grep for `create or replace function` misses —
--    KD #119). Sections branch is byte-identical to 074 (schedule threaded
--    through the INSERT column list, SELECT, and ON CONFLICT DO UPDATE SET);
--    subject_configs branch drops level_id from the select/insert list and
--    upserts on (academic_year_id, subject_id) instead of the 3-column key;
--    new branch pushes template_subject_level_offerings → subject_level_offerings.
-- ═════════════════════════════════════════════════════════════════════

begin;

create or replace function public.apply_template_to_ay(p_ay_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code                text := upper(trim(p_ay_code));
  v_ay_id               uuid;
  v_sections_inserted   int := 0;
  v_sections_updated    int := 0;
  v_configs_inserted    int := 0;
  v_configs_updated     int := 0;
  v_offerings_inserted  int := 0;
begin
  if v_code !~ '^AY[0-9]{4}$' then
    raise exception 'Invalid AY code: %. Expected format AY2027.', p_ay_code;
  end if;

  select id into v_ay_id
  from public.academic_years
  where ay_code = v_code;

  if v_ay_id is null then
    raise exception 'AY % not found.', v_code;
  end if;

  -- Sections — unchanged from 074. form_class_adviser is per-AY — never
  -- overwritten.
  with upsert as (
    insert into public.sections
      (academic_year_id, level_id, name, class_type, schedule, form_class_adviser)
    select v_ay_id, ts.level_id, ts.name, ts.class_type, ts.schedule, null
    from public.template_sections ts
    on conflict (academic_year_id, level_id, name) do update
      set class_type = excluded.class_type,
          schedule   = excluded.schedule
    returning (xmax = 0) as is_insert
  )
  select
    count(*) filter (where is_insert)     as inserted,
    count(*) filter (where not is_insert) as updated
    into v_sections_inserted, v_sections_updated
  from upsert;

  -- Subject configs — UPSERT on (ay, subject). One weight row per subject
  -- now (migration 080 collapse) — no more level_id in the key.
  with upsert as (
    insert into public.subject_configs (
      academic_year_id, subject_id,
      ww_weight, pt_weight, qa_weight,
      ww_max_slots, pt_max_slots, qa_max
    )
    select v_ay_id, t.subject_id,
           t.ww_weight, t.pt_weight, t.qa_weight,
           t.ww_max_slots, t.pt_max_slots, t.qa_max
    from public.template_subject_configs t
    on conflict (academic_year_id, subject_id) do update
      set ww_weight    = excluded.ww_weight,
          pt_weight    = excluded.pt_weight,
          qa_weight    = excluded.qa_weight,
          ww_max_slots = excluded.ww_max_slots,
          pt_max_slots = excluded.pt_max_slots,
          qa_max       = excluded.qa_max
    returning (xmax = 0) as is_insert
  )
  select
    count(*) filter (where is_insert)     as inserted,
    count(*) filter (where not is_insert) as updated
    into v_configs_inserted, v_configs_updated
  from upsert;

  -- Subject-level applicability — additive only (INSERT ... ON CONFLICT DO
  -- NOTHING never removes a level's offering the target AY already has,
  -- mirroring sections'/configs' never-delete policy).
  insert into public.subject_level_offerings (academic_year_id, subject_id, level_id)
  select v_ay_id, tslo.subject_id, tslo.level_id
  from public.template_subject_level_offerings tslo
  on conflict (subject_id, level_id, academic_year_id) do nothing;
  get diagnostics v_offerings_inserted = row_count;

  return jsonb_build_object(
    'ay_code',            v_code,
    'sections_inserted',  v_sections_inserted,
    'sections_updated',   v_sections_updated,
    'configs_inserted',   v_configs_inserted,
    'configs_updated',    v_configs_updated,
    'offerings_inserted', v_offerings_inserted
  );
end;
$$;

revoke all on function public.apply_template_to_ay(text) from public;
grant execute on function public.apply_template_to_ay(text) to service_role;

commit;

-- ═════════════════════════════════════════════════════════════════════
-- 7. create_academic_year + sync_section_subjects_for_ay re-emit —
--    newest live body: migration 079 for both. create_academic_year's
--    step 5 (subject_configs copy) drops level_id from both copy branches
--    and adds a parallel subject_level_offerings copy (template branch
--    from template_subject_level_offerings, legacy-fallback branch from
--    the source AY's own subject_level_offerings — both additive,
--    ON CONFLICT DO NOTHING). sync_section_subjects_for_ay's join is
--    rewritten to resolve eligibility via subject_level_offerings then
--    weight via subject_configs, instead of joining subject_configs on
--    level_id directly (that column no longer exists). Step ordering,
--    every other step, and the return shape are otherwise byte-identical
--    to 079.
-- ═════════════════════════════════════════════════════════════════════

begin;

create or replace function public.sync_section_subjects_for_ay(p_ay_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ay_id uuid;
  v_inserted int := 0;
begin
  select id into v_ay_id from public.academic_years where ay_code = p_ay_code;
  if v_ay_id is null then
    return jsonb_build_object('inserted', 0, 'reason', 'ay_not_found');
  end if;

  insert into public.section_subjects (section_id, subject_config_id)
  select s.id, sc.id
  from public.sections s
  join public.subject_level_offerings slo
    on slo.level_id = s.level_id
   and slo.academic_year_id = s.academic_year_id
  join public.subject_configs sc
    on sc.subject_id = slo.subject_id
   and sc.academic_year_id = s.academic_year_id
  where s.academic_year_id = v_ay_id
  on conflict (section_id, subject_config_id) do nothing;
  get diagnostics v_inserted = row_count;

  return jsonb_build_object('inserted', v_inserted);
end;
$$;

revoke all on function public.sync_section_subjects_for_ay(text) from public;
grant execute on function public.sync_section_subjects_for_ay(text) to service_role;

commit;

begin;

create or replace function public.create_academic_year(
  p_ay_code text,
  p_label   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code             text := upper(trim(p_ay_code));
  v_label            text := trim(p_label);
  v_slug             text;
  v_ay_id            uuid;
  v_existing_ay_id   uuid;
  v_existed          boolean;
  v_source_ay_id     uuid;
  v_template_sections_count int;
  v_template_configs_count  int;
  v_use_template     boolean := false;
  v_terms_inserted   int := 0;
  v_sections_copied  int := 0;
  v_configs_copied   int := 0;
  v_source           text := null;
begin
  if v_code !~ '^AY[0-9]{4}$' then
    raise exception 'Invalid AY code: %. Expected format AY2027.', p_ay_code;
  end if;
  if v_label is null or v_label = '' then
    raise exception 'AY label is required.';
  end if;

  v_slug := 'ay' || substring(v_code from 3);

  -- 1. academic_years — reuse if present, otherwise insert.
  select id into v_existing_ay_id
  from public.academic_years
  where ay_code = v_code;

  if v_existing_ay_id is not null then
    v_ay_id   := v_existing_ay_id;
    v_existed := true;
  else
    insert into public.academic_years (ay_code, label, is_current)
    values (v_code, v_label, false)
    returning id into v_ay_id;
    v_existed := false;
  end if;

  -- 2. terms (T1–T4) — insert only the missing term_numbers.
  insert into public.terms (academic_year_id, term_number, label, is_current)
  select v_ay_id, n, 'Term ' || n || ' — ' || v_code, false
  from generate_series(1, 4) as g(n)
  where not exists (
    select 1 from public.terms
    where academic_year_id = v_ay_id and term_number = n
  );
  get diagnostics v_terms_inserted = row_count;

  -- 3. Decide source. Templates win when populated.
  select count(*) into v_template_sections_count from public.template_sections;
  select count(*) into v_template_configs_count  from public.template_subject_configs;
  v_use_template := (v_template_sections_count > 0 or v_template_configs_count > 0);

  if not v_use_template then
    -- Legacy fallback: most recent non-test AY (preserves migration 030's
    -- behaviour for empty-template installs).
    select id into v_source_ay_id
    from public.academic_years
    where id <> v_ay_id
      and ay_code !~ '^AY9'
    order by ay_code desc
    limit 1;
  end if;

  -- 4. sections
  if not exists (select 1 from public.sections where academic_year_id = v_ay_id) then
    if v_use_template and v_template_sections_count > 0 then
      insert into public.sections (academic_year_id, level_id, name, class_type, schedule, form_class_adviser)
      select v_ay_id, level_id, name, class_type, schedule, null
      from public.template_sections;
      get diagnostics v_sections_copied = row_count;
      v_source := 'template';
    elsif v_source_ay_id is not null then
      insert into public.sections (academic_year_id, level_id, name, class_type, schedule, form_class_adviser)
      select v_ay_id, level_id, name, class_type, schedule, null
      from public.sections
      where academic_year_id = v_source_ay_id;
      get diagnostics v_sections_copied = row_count;
      select ay_code into v_source
      from public.academic_years
      where id = v_source_ay_id;
    end if;
  end if;

  -- 4b. Volatile-level offerings — branch-agnostic (078). Unchanged.
  insert into public.ay_level_offerings (academic_year_id, level_id)
  select distinct s.academic_year_id, s.level_id
  from public.sections s
  join public.levels l on l.id = s.level_id
  where s.academic_year_id = v_ay_id and l.is_core = false
  on conflict (academic_year_id, level_id) do nothing;

  -- 5. subject_configs (weights, one row per subject) + subject_level_
  --    offerings (which subjects apply to which levels this AY).
  if not exists (select 1 from public.subject_configs where academic_year_id = v_ay_id) then
    if v_use_template and v_template_configs_count > 0 then
      insert into public.subject_configs (
        academic_year_id, subject_id,
        ww_weight, pt_weight, qa_weight,
        ww_max_slots, pt_max_slots, qa_max
      )
      select v_ay_id, subject_id,
             ww_weight, pt_weight, qa_weight,
             ww_max_slots, pt_max_slots, qa_max
      from public.template_subject_configs;
      get diagnostics v_configs_copied = row_count;
      if v_source is null then v_source := 'template'; end if;

      insert into public.subject_level_offerings (academic_year_id, subject_id, level_id)
      select v_ay_id, subject_id, level_id
      from public.template_subject_level_offerings
      on conflict (subject_id, level_id, academic_year_id) do nothing;
    elsif v_source_ay_id is not null then
      insert into public.subject_configs (
        academic_year_id, subject_id,
        ww_weight, pt_weight, qa_weight,
        ww_max_slots, pt_max_slots, qa_max
      )
      select v_ay_id, subject_id,
             ww_weight, pt_weight, qa_weight,
             ww_max_slots, pt_max_slots, qa_max
      from public.subject_configs
      where academic_year_id = v_source_ay_id;
      get diagnostics v_configs_copied = row_count;
      if v_source is null then
        select ay_code into v_source
        from public.academic_years
        where id = v_source_ay_id;
      end if;

      insert into public.subject_level_offerings (academic_year_id, subject_id, level_id)
      select v_ay_id, subject_id, level_id
      from public.subject_level_offerings
      where academic_year_id = v_source_ay_id
      on conflict (subject_id, level_id, academic_year_id) do nothing;
    end if;
  end if;

  -- 5b. Section-subjects defaults — branch-agnostic, mirrors 4b's pattern.
  -- Now resolves via subject_level_offerings (updated function body,
  -- re-emitted above in this same migration).
  perform public.sync_section_subjects_for_ay(v_code);

  -- 6. Admissions DDL — already idempotent.
  perform public.create_ay_admissions_tables(v_slug);

  return jsonb_build_object(
    'ay_id',                  v_ay_id,
    'ay_code',                v_code,
    'ay_slug',                v_slug,
    'ay_existed',              v_existed,
    'terms_inserted',         v_terms_inserted,
    'sections_copied',        v_sections_copied,
    'subject_configs_copied', v_configs_copied,
    'source',                 v_source,
    'tables_created', jsonb_build_array(
      v_slug || '_enrolment_applications',
      v_slug || '_enrolment_status',
      v_slug || '_enrolment_documents',
      v_slug || '_discount_codes'
    )
  );
end;
$$;

revoke all on function public.create_academic_year(text, text) from public;
grant execute on function public.create_academic_year(text, text) to service_role;

commit;

-- ═════════════════════════════════════════════════════════════════════
-- 8. Grading-sheet generation RPCs — the join simplification the design
--    doc predicts ("weight resolves by subject_id alone — no more
--    section→level→config join") turned out to be REQUIRED here, not
--    deferred work: `create_grading_sheets_for_ay` is called directly by
--    the seeder (lib/sis/seeder/structural.ts, this task's own file) on
--    every switch-to-Test, so leaving it joining on the now-dropped
--    `subject_configs.level_id` would break the seeder immediately.
--    `create_grading_sheets_for_section` (new-section auto-generate,
--    app/api/sections/route.ts) and `create_grading_sheets_for_scopes`
--    (guided bulk-create, app/api/grading-sheets/bulk-create/route.ts)
--    have the exact same one-line fix, so both are re-emitted alongside
--    for consistency — leaving grading-sheet generation working in one
--    RPC and silently broken in its two siblings would be a worse landing
--    state than fixing all three identical joins together.
--
--    NOT fixed (still broken until a later phase, per the Task 1 report):
--    `app/api/grading-sheets/bulk-create/route.ts` and its
--    `preview/route.ts` sibling both run their OWN inline
--    `.select('...level_id...')` / `.in('level_id', levelIds)` queries
--    against subject_configs in TypeScript to build the scopes payload
--    BEFORE calling create_grading_sheets_for_scopes — fixing the RPC
--    alone does not restore that guided-generation UI flow end-to-end;
--    only the seeder path (bare ay_id, no inline query) and the
--    new-section path (bare section_id, no inline query) are fully
--    restored by this section. `sync_grading_sheets_from_config`
--    (migration 052) does NOT reference level_id at all — verified,
--    untouched, unaffected by this migration.
--
--    Newest live bodies verified via case-insensitive grep for the
--    function names (KD #119 hazard): create_grading_sheets_for_ay +
--    create_grading_sheets_for_section → migration 036;
--    create_grading_sheets_for_scopes → migration 060. `_for_ay` and
--    `_for_section` are otherwise byte-identical to 036 — only their
--    Step-1 candidate CTE changes: eligibility (which subjects a section
--    gets sheets for) now resolves through `section_subjects` (migration
--    079's per-section subject list) instead of the dropped
--    `sc.level_id = s.level_id` join condition. IMPORTANT — a first draft
--    of this fix simply deleted that join condition and left
--    `sections JOIN subject_configs ON academic_year_id` as the only
--    predicate; that's a real bug, not a simplification — with no
--    level_id left on subject_configs, a bare AY join cross-joins every
--    subject in the AY against every section regardless of level (a P1
--    section would get History/Economics sheets). Routing through
--    section_subjects instead is both correct AND exactly what the design
--    doc specifies: "Eligibility... still resolves through
--    section_subjects, which was already correct." `_for_scopes` is
--    unaffected by this — the caller already supplies an explicit
--    (section_id, subject_id) pair per scope, so its lookup only needs
--    subject_id + the section's academic_year_id to resolve the one
--    matching subject_configs row (no eligibility decision happens
--    inside this RPC); it drops `AND s.level_id = sc.level_id` from its
--    single lookup query with no cross-join risk.
-- ═════════════════════════════════════════════════════════════════════

begin;

create or replace function public.create_grading_sheets_for_ay(p_ay_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
  v_repaired int;
  v_resized int;
  v_seeded int := 0;
  v_sheet record;
begin
  -- Step 1: Insert any missing (term × section × subject) sheets with
  -- defaults from subject_configs. Eligibility (which subjects a section
  -- gets sheets for) resolves through section_subjects — the per-section
  -- subject list (migration 079, level defaults + overrides) — NOT a bare
  -- sections↔subject_configs join on academic_year_id alone, which would
  -- cross every section against every subject in the AY regardless of
  -- level now that subject_configs has no level_id to filter on. Weight
  -- itself resolves by subject_id alone (migration 080 collapse).
  with candidate as (
    select
      t.id        as term_id,
      s.id        as section_id,
      sc.subject_id as subject_id,
      sc.id       as subject_config_id,
      sc.ww_max_slots as ww_max_slots,
      sc.pt_max_slots as pt_max_slots,
      sc.qa_max as qa_max
    from public.sections s
    join public.section_subjects ss
      on ss.section_id = s.id
    join public.subject_configs sc
      on sc.id = ss.subject_config_id
    join public.terms t
      on t.academic_year_id = s.academic_year_id
    where s.academic_year_id = p_ay_id
  ),
  ins as (
    insert into public.grading_sheets
      (term_id, section_id, subject_id, subject_config_id, is_locked,
       ww_totals, pt_totals, qa_total)
    select
      term_id, section_id, subject_id, subject_config_id, false,
      array_fill(10::numeric, array[ww_max_slots]),
      array_fill(10::numeric, array[pt_max_slots]),
      qa_max
    from candidate
    on conflict (term_id, section_id, subject_id) do nothing
    returning id, section_id
  )
  select count(*) into v_inserted from ins;

  -- Step 2: Repair pre-existing sheets that were created before this
  -- RPC's defaults logic was in place. Only touches sheets in the
  -- unconfigured-default state (empty arrays AND null qa_total) so any
  -- registrar-customized sheet keeps its values.
  with repair as (
    update public.grading_sheets gs
    set
      ww_totals = array_fill(10::numeric, array[sc.ww_max_slots]),
      pt_totals = array_fill(10::numeric, array[sc.pt_max_slots]),
      qa_total = sc.qa_max
    from public.subject_configs sc, public.sections s
    where gs.subject_config_id = sc.id
      and gs.section_id = s.id
      and s.academic_year_id = p_ay_id
      and coalesce(array_length(gs.ww_totals, 1), 0) = 0
      and coalesce(array_length(gs.pt_totals, 1), 0) = 0
      and gs.qa_total is null
    returning gs.id
  )
  select count(*) into v_repaired from repair;

  -- Step 3: Resize existing grade_entries score arrays whose ww_scores /
  -- pt_scores are still empty so they match the (now-defaulted) sheet's
  -- slot count. Without this step, entries created before step 2 would
  -- carry length-0 score arrays forever and the grid would render
  -- columns but no fillable cells. Only touches entries with empty
  -- arrays — registrar/teacher-saved scores are not affected.
  with resize as (
    update public.grade_entries ge
    set
      ww_scores = array_fill(null::numeric, array[coalesce(array_length(gs.ww_totals, 1), 0)]),
      pt_scores = array_fill(null::numeric, array[coalesce(array_length(gs.pt_totals, 1), 0)])
    from public.grading_sheets gs, public.sections s
    where ge.grading_sheet_id = gs.id
      and gs.section_id = s.id
      and s.academic_year_id = p_ay_id
      and coalesce(array_length(ge.ww_scores, 1), 0) = 0
      and coalesce(array_length(ge.pt_scores, 1), 0) = 0
      and (
        coalesce(array_length(gs.ww_totals, 1), 0) > 0
        or coalesce(array_length(gs.pt_totals, 1), 0) > 0
      )
    returning ge.id
  )
  select count(*) into v_resized from resize;

  -- Step 4: Seed entries for every sheet in this AY (covers both newly-
  -- inserted sheets AND any pre-existing ones whose roster has changed
  -- since generate). Idempotent — ON CONFLICT DO NOTHING.
  for v_sheet in
    select gs.id as sheet_id, gs.section_id
    from public.grading_sheets gs
    join public.sections s on s.id = gs.section_id
    where s.academic_year_id = p_ay_id
  loop
    perform public.seed_grade_entries_for_sheet(v_sheet.sheet_id, v_sheet.section_id);
    v_seeded := v_seeded + 1;
  end loop;

  return jsonb_build_object(
    'ay_id', p_ay_id,
    'inserted', coalesce(v_inserted, 0),
    'repaired_unconfigured_sheets', coalesce(v_repaired, 0),
    'resized_entry_arrays', coalesce(v_resized, 0),
    'sheets_seeded', v_seeded
  );
end;
$$;

comment on function public.create_grading_sheets_for_ay(uuid) is
  'Idempotent bulk-create + self-heal of (term × section × subject) grading sheets for every (section, subject_config) pair in the AY. Defaults ww_totals/pt_totals/qa_total from subject_configs. Repairs pre-existing unconfigured sheets and resizes empty entry score arrays in place. Returns {ay_id, inserted, repaired_unconfigured_sheets, resized_entry_arrays, sheets_seeded}.';

revoke all on function public.create_grading_sheets_for_ay(uuid) from public;
grant execute on function public.create_grading_sheets_for_ay(uuid) to service_role;

create or replace function public.create_grading_sheets_for_section(p_section_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
  v_repaired int;
  v_resized int;
  v_seeded int := 0;
  v_sheet record;
begin
  -- Step 1: Insert any missing sheets with defaults. Eligibility resolves
  -- through section_subjects, same reasoning as create_grading_sheets_for_ay
  -- above — a bare sections↔subject_configs join on academic_year_id alone
  -- would pull in every subject in the AY regardless of level.
  with candidate as (
    select
      t.id        as term_id,
      s.id        as section_id,
      sc.subject_id as subject_id,
      sc.id       as subject_config_id,
      sc.ww_max_slots as ww_max_slots,
      sc.pt_max_slots as pt_max_slots,
      sc.qa_max as qa_max
    from public.sections s
    join public.section_subjects ss
      on ss.section_id = s.id
    join public.subject_configs sc
      on sc.id = ss.subject_config_id
    join public.terms t
      on t.academic_year_id = s.academic_year_id
    where s.id = p_section_id
  ),
  ins as (
    insert into public.grading_sheets
      (term_id, section_id, subject_id, subject_config_id, is_locked,
       ww_totals, pt_totals, qa_total)
    select
      term_id, section_id, subject_id, subject_config_id, false,
      array_fill(10::numeric, array[ww_max_slots]),
      array_fill(10::numeric, array[pt_max_slots]),
      qa_max
    from candidate
    on conflict (term_id, section_id, subject_id) do nothing
    returning id, section_id
  )
  select count(*) into v_inserted from ins;

  -- Step 2: Repair pre-existing unconfigured sheets in place.
  with repair as (
    update public.grading_sheets gs
    set
      ww_totals = array_fill(10::numeric, array[sc.ww_max_slots]),
      pt_totals = array_fill(10::numeric, array[sc.pt_max_slots]),
      qa_total = sc.qa_max
    from public.subject_configs sc
    where gs.subject_config_id = sc.id
      and gs.section_id = p_section_id
      and coalesce(array_length(gs.ww_totals, 1), 0) = 0
      and coalesce(array_length(gs.pt_totals, 1), 0) = 0
      and gs.qa_total is null
    returning gs.id
  )
  select count(*) into v_repaired from repair;

  -- Step 3: Resize empty entry score arrays for sheets in this section.
  with resize as (
    update public.grade_entries ge
    set
      ww_scores = array_fill(null::numeric, array[coalesce(array_length(gs.ww_totals, 1), 0)]),
      pt_scores = array_fill(null::numeric, array[coalesce(array_length(gs.pt_totals, 1), 0)])
    from public.grading_sheets gs
    where ge.grading_sheet_id = gs.id
      and gs.section_id = p_section_id
      and coalesce(array_length(ge.ww_scores, 1), 0) = 0
      and coalesce(array_length(ge.pt_scores, 1), 0) = 0
      and (
        coalesce(array_length(gs.ww_totals, 1), 0) > 0
        or coalesce(array_length(gs.pt_totals, 1), 0) > 0
      )
    returning ge.id
  )
  select count(*) into v_resized from resize;

  -- Step 4: Seed entries for every sheet on this section.
  for v_sheet in
    select id as sheet_id
    from public.grading_sheets
    where section_id = p_section_id
  loop
    perform public.seed_grade_entries_for_sheet(v_sheet.sheet_id, p_section_id);
    v_seeded := v_seeded + 1;
  end loop;

  return jsonb_build_object(
    'section_id', p_section_id,
    'inserted', coalesce(v_inserted, 0),
    'repaired_unconfigured_sheets', coalesce(v_repaired, 0),
    'resized_entry_arrays', coalesce(v_resized, 0),
    'sheets_seeded', v_seeded
  );
end;
$$;

comment on function public.create_grading_sheets_for_section(uuid) is
  'Idempotent bulk-create + self-heal for one section across every subject offered at its level (via subject_configs, one row per subject as of migration 080) × every term in its AY. Repairs pre-existing unconfigured sheets in place and resizes empty entry score arrays. Returns {section_id, inserted, repaired_unconfigured_sheets, resized_entry_arrays, sheets_seeded}.';

revoke all on function public.create_grading_sheets_for_section(uuid) from public;
grant execute on function public.create_grading_sheets_for_section(uuid) to service_role;

commit;

begin;

create or replace function public.create_grading_sheets_for_scopes(p_scopes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope        jsonb;
  v_section_id   uuid;
  v_subject_id   uuid;
  v_term_id      uuid;
  v_config_id    uuid;
  v_ww_slots     int;
  v_pt_slots     int;
  v_qa_max       int;
  v_new_sheet_id uuid;
  v_inserted     int := 0;
begin
  for v_scope in select value from jsonb_array_elements(p_scopes)
  loop
    v_section_id := (v_scope->>'section_id')::uuid;
    v_subject_id := (v_scope->>'subject_id')::uuid;
    v_term_id    := (v_scope->>'term_id')::uuid;

    -- Derive subject config from the section's AY + the scope's subject —
    -- one weight row per (subject, AY) now (migration 080), so no level
    -- join is needed to disambiguate.
    select sc.id, sc.ww_max_slots, sc.pt_max_slots, sc.qa_max
      into v_config_id, v_ww_slots, v_pt_slots, v_qa_max
      from public.subject_configs sc
      join public.sections s on s.academic_year_id = sc.academic_year_id
     where s.id = v_section_id
       and sc.subject_id = v_subject_id
     limit 1;

    if not found then
      continue; -- no config for this scope, skip silently
    end if;

    -- Insert sheet (ON CONFLICT DO NOTHING — idempotent)
    insert into public.grading_sheets (
      section_id, subject_id, term_id, subject_config_id,
      ww_totals, pt_totals, qa_total
    )
    values (
      v_section_id, v_subject_id, v_term_id, v_config_id,
      array(select 10::numeric from generate_series(1, v_ww_slots)),
      array(select 10::numeric from generate_series(1, v_pt_slots)),
      v_qa_max
    )
    on conflict (section_id, subject_id, term_id) do nothing
    returning id into v_new_sheet_id;

    if v_new_sheet_id is not null then
      v_inserted := v_inserted + 1;

      -- Seed null-filled grade_entries for active + late-enrolled students
      insert into public.grade_entries (
        grading_sheet_id, section_student_id, ww_scores, pt_scores
      )
      select
        v_new_sheet_id,
        ss.id,
        array(select null::numeric from generate_series(1, v_ww_slots)),
        array(select null::numeric from generate_series(1, v_pt_slots))
      from public.section_students ss
      where ss.section_id = v_section_id
        and ss.enrollment_status in ('active', 'late_enrollee')
      on conflict (grading_sheet_id, section_student_id) do nothing;
    end if;

  end loop;

  return jsonb_build_object('inserted', v_inserted);
end;
$$;

revoke all on function public.create_grading_sheets_for_scopes(jsonb) from public;
grant execute on function public.create_grading_sheets_for_scopes(jsonb) to service_role;

commit;

-- ═════════════════════════════════════════════════════════════════════
-- Post-apply manual review query:
--   select * from public.subject_weight_reconciliation_log order by logged_at;
-- Post-apply row-count sanity check (should be equal):
--   select count(*) from public.subject_configs;
--   -- vs. a pre-migration snapshot of:
--   -- select count(distinct (subject_id, academic_year_id)) from subject_configs;
-- ═════════════════════════════════════════════════════════════════════
