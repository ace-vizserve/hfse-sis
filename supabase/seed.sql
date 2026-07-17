-- HFSE Markbook — seed data
-- Contents: AY2026, 10 levels, 17 subjects, AY2026 sections,
-- AY2026 terms (T1–T4), subject_configs (weights per subject), and
-- subject_level_offerings (which levels each subject is taught at).
-- Idempotent: safe to re-run.

-- ---------- Academic year ----------
insert into public.academic_years (ay_code, label, is_current) values
  ('AY2026', 'Academic Year 2026', true)
on conflict (ay_code) do nothing;

-- ---------- Levels ----------
-- sort_order + is_core are NOT NULL as of migration 078 (Levels & Grade
-- Progression) — sort_order has no column default, so a fresh install that
-- omitted it here would 400 on this insert. is_core is trivially true for
-- every row now — migration 086 removed the volatile Youngstarters/
-- Cambridge Secondary levels + the ay_level_offerings per-AY concept
-- entirely (KD #153); the level catalog is a fixed 10-row P1-P6/S1-S4 band.
insert into public.levels (code, label, level_type, sort_order, is_core) values
  ('P1',   'Primary One',                       'primary',    1, true),
  ('P2',   'Primary Two',                       'primary',    2, true),
  ('P3',   'Primary Three',                     'primary',    3, true),
  ('P4',   'Primary Four',                      'primary',    4, true),
  ('P5',   'Primary Five',                      'primary',    5, true),
  ('P6',   'Primary Six',                       'primary',    6, true),
  ('S1',   'Secondary One',                     'secondary',  7, true),
  ('S2',   'Secondary Two',                     'secondary',  8, true),
  ('S3',   'Secondary Three',                   'secondary',  9, true),
  ('S4',   'Secondary Four',                    'secondary', 10, true)
on conflict (code) do nothing;

-- Seed the progression chain (mirrors migration 086's re-emitted chain
-- exactly — the volatile-level legs were dropped alongside the rows).
-- On a fresh install this is the only place next_level_id gets populated;
-- on the shared/already-migrated project the insert above is a no-op
-- (on conflict) and every row's next_level_id is already set by 086, so
-- the `next_level_id is null` guard makes this safely idempotent either way.
with chain(code, next_code) as (
  values ('P1','P2'),('P2','P3'),('P3','P4'),('P4','P5'),('P5','P6'),('P6','S1'),
         ('S1','S2'),('S2','S3'),('S3','S4')
)
update public.levels l
set next_level_id = n.id
from chain c
join public.levels n on n.code = c.next_code
where l.code = c.code and l.next_level_id is null;

-- ---------- Subjects — Primary ----------
-- Christian Living is non-examinable per HFSE's canonical grading spec —
-- letter graded only, never numeric. See KD #95 + migration 049.
--
-- Migration 081 (MAPEH / language catalog corrections): MUSIC/ARTS/PE/HE
-- were 4 independent letter-graded subjects modeling what is actually ONE
-- combined, numeric-graded subject in real HFSE practice — replaced by the
-- single `MAPEH` row below (20/60/20, is_examinable=true, a deliberate
-- change from its 4 letter-graded predecessors). `MT` (Mother Tongue)
-- stays in this catalog insert — it's still the report-card column target
-- — but is no longer directly graded; `FIL` (Filipino) + `MANDARIN` now
-- carry the real per-student scores and fan into MT via
-- subject_report_map (see the report-map block below). Both new language
-- subjects are numeric (30/50/20).
insert into public.subjects (code, name, is_examinable) values
  ('ENG',      'English',                true),
  ('MATH',     'Mathematics',            true),
  ('MT',       'Mother Tongue',          true),
  ('FIL',      'Filipino',               true),
  ('MANDARIN', 'Mandarin',               true),
  ('SCI',      'Science',                true),
  ('SS',       'Social Studies',         true),
  ('MAPEH',    'MAPEH',                  true),
  ('CL',       'Christian Living',       false)
on conflict (code) do nothing;

-- ---------- Subjects — Secondary ----------
-- Contemporary Art / PE+Health / Pastoral / CCA are non-examinable.
insert into public.subjects (code, name, is_examinable) values
  ('HIST', 'History',                                  true),
  ('LIT',  'Literature',                               true),
  ('HUM',  'Humanities',                               true),
  ('ECON', 'Economics',                                true),
  ('CA',   'Contemporary Art',                         false),
  ('PEH',  'Physical Education and Health',            false),
  ('PMPD', 'Pastoral Ministry and Personal Development', false),
  ('CCA',  'Co-curricular Activities',                 false)
on conflict (code) do nothing;

-- ---------- Subject report map (self-map) ----------
-- Migration 080 seeds a 1:1 self-map for every subject that exists AT
-- MIGRATION-RUN TIME — on a fresh install, seed.sql runs after migrations,
-- so the 18 subjects inserted just above never got a row. Re-affirm here
-- (idempotent no-op on an already-migrated project, since every subject
-- there already has its self-map from 080) — EXCLUDING Filipino/Mandarin,
-- which fan into Mother Tongue's column instead of self-mapping (migration
-- 081); on an already-migrated project this exclusion is also a no-op,
-- since 081 never gave them a self-map row to begin with.
insert into public.subject_report_map (subject_id, report_subject_id)
select id, id from public.subjects
where code not in ('FIL', 'MANDARIN')
on conflict (subject_id, report_subject_id) do nothing;

-- ---------- Subject report map (Filipino/Mandarin -> Mother Tongue) ------
-- Migration 081's own fan-in insert runs at MIGRATION-RUN TIME, before this
-- file's `subjects` rows exist on a fresh install — so on that path it's a
-- no-op there, and this is the row's only real source. Re-affirmed here for
-- the same reason as the self-map block above; idempotent no-op on an
-- already-migrated project (081 already inserted these rows).
insert into public.subject_report_map (subject_id, report_subject_id)
select fm.id, mt.id
from public.subjects fm
join public.subjects mt on mt.code = 'MT'
where fm.code in ('FIL', 'MANDARIN')
on conflict (subject_id, report_subject_id) do nothing;

-- ---------- Sections (AY2026) ----------
-- Source: docs/context/03-workflow-and-roles.md
-- Canonical spellings (sync normalizes admissions typos like "Courageos" → "Courageous").
insert into public.sections (academic_year_id, level_id, name)
select ay.id, lv.id, sec.name
from (values
  ('P1', 'Patience'),
  ('P1', 'Obedience'),
  ('P2', 'Honesty'),
  ('P2', 'Humility'),
  ('P3', 'Courtesy'),
  ('P3', 'Courageous'),
  ('P3', 'Responsibility'),
  ('P4', 'Diligence'),
  ('P4', 'Trust'),
  ('P5', 'Commitment'),
  ('P5', 'Perseverance'),
  ('P5', 'Tenacity'),
  ('P6', 'Grit'),
  ('P6', 'Loyalty'),
  ('S1', 'Discipline 1'),
  ('S1', 'Discipline 2'),
  ('S2', 'Integrity 1'),
  ('S2', 'Integrity 2'),
  ('S3', 'Consistency'),
  ('S4', 'Excellence')
) as sec(level_code, name)
join public.levels lv on lv.code = sec.level_code
cross join public.academic_years ay
where ay.ay_code = 'AY2026'
on conflict (academic_year_id, level_id, name) do nothing;

-- ---------- Terms (AY2026) ----------
-- Dates intentionally left null for now — registrar can backfill.
-- Term 1 marked is_current so the grading UI has a default selection.
insert into public.terms (academic_year_id, term_number, label, is_current)
select ay.id, t.n, 'Term ' || t.n || ' — AY2026', (t.n = 1)
from public.academic_years ay
cross join (values (1), (2), (3), (4)) as t(n)
where ay.ay_code = 'AY2026'
on conflict (academic_year_id, term_number) do nothing;

-- ---------- Subject configs (AY2026) ----------
-- Migration 080 collapsed subject_configs off the level dimension — weight
-- is a property of the subject, not the level. Migration 081 (MAPEH /
-- language catalog corrections) removed MUSIC/ARTS/PE/HE + MT from the
-- graded set and added MAPEH/FIL/MANDARIN — MAPEH gets its OWN 20/60/20
-- bucket (it is Primary-taught but is NOT part of the uniform 40/40/20
-- primary bucket below, hence its own `case` branch); Filipino/Mandarin
-- fall through to the existing 30/50/20 "else" bucket unmodified (same
-- value the brief's resolved-data table specifies, so no new branch is
-- needed for them). Every other subject's bucket membership is UNCHANGED
-- from before 081 — this is a minimal, scoped correction, not a general
-- weight-bucket redesign.
-- Non-examinable subjects (CL, PMPD, CCA) still get a row for schema completeness,
-- but the grade entry UI uses the letter-grade path and skips the weights.
insert into public.subject_configs (
  academic_year_id, subject_id, ww_weight, pt_weight, qa_weight
)
select ay.id, sub.id,
       case
         when sub.code = 'MAPEH' then 0.20
         when sub.code in ('ENG','MATH','SCI','SS','CL') then 0.40
         else 0.30
       end,
       case
         when sub.code = 'MAPEH' then 0.60
         when sub.code in ('ENG','MATH','SCI','SS','CL') then 0.40
         else 0.50
       end,
       0.20
from public.academic_years ay
cross join public.subjects sub
where ay.ay_code = 'AY2026'
  and sub.code in (
    'ENG','MATH','FIL','MANDARIN','SCI','SS','MAPEH','CL',
    'HIST','LIT','HUM','ECON','CA','PEH','PMPD','CCA'
  )
on conflict (academic_year_id, subject_id) do nothing;

-- ---------- Subject level offerings (AY2026) ----------
-- Migration 080's new source of truth for "which levels teach this
-- subject" — the level dimension weight config used to carry before the
-- collapse above. MAPEH gets every Primary level (P1–P6); Filipino gets
-- every Primary AND every Secondary level; Mandarin is P1–P5 only (this
-- seed's single AY2026 is >= 2026, so it gets migration 081's
-- "AY2026-onward" range, not the older P1–P4-only range) — both need a
-- level-CODE restriction rather than the simple level-TYPE partition the
-- other subjects use, so they get their own `or` branches below. `MT`
-- (Mother Tongue) is deliberately absent — it's report-only now (081).
insert into public.subject_level_offerings (
  subject_id, level_id, academic_year_id
)
select sub.id, lv.id, ay.id
from public.academic_years ay
cross join public.subjects sub
cross join public.levels lv
where ay.ay_code = 'AY2026'
  and (
    (lv.level_type = 'primary'
      and sub.code in ('ENG','MATH','SCI','SS','MAPEH','CL'))
    or
    (lv.level_type = 'secondary'
      and sub.code in ('HIST','LIT','HUM','ECON','CA','PEH','PMPD','CCA'))
    or
    (lv.level_type in ('primary','secondary') and sub.code = 'FIL')
    or
    (lv.code in ('P1','P2','P3','P4','P5') and sub.code = 'MANDARIN')
  )
on conflict (subject_id, level_id, academic_year_id) do nothing;
